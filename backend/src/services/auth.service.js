import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query, isDatabaseConnected } from '../config/database.js';
import { config } from '../config/env.js';
import * as userRepository from '../repositories/user.repository.js';

// In-memory fallback development credentials when PostgreSQL is offline
const MOCK_USERS = [
  {
    id: 1,
    username: 'admin',
    email: 'admin@pulsecorefitness.in',
    password_hash: bcrypt.hashSync('AdminPass2026!', 10),
    full_name: 'Dev Admin Manager',
    role: 'superadmin',
    permissions: ['*'],
    is_active: true,
  },
  {
    id: 2,
    username: 'head_trainer',
    email: 'trainer@pulsecorefitness.in',
    password_hash: bcrypt.hashSync('TrainerPass2026!', 10),
    full_name: 'Head Coach Arjun',
    role: 'trainer',
    trainer_id: 1,
    permissions: ['schedules:read', 'schedules:write:self'],
    is_active: true,
  },
  {
    id: 3,
    username: 'manager_priya',
    email: 'priya.manager@pulsecorefitness.in',
    password_hash: bcrypt.hashSync('ManagerPass2026!', 10),
    full_name: 'Priya Deshmukh',
    role: 'manager',
    permissions: ['members:*', 'trainers:*', 'plans:*', 'reports:view'],
    is_active: true,
  },
  {
    id: 4,
    username: 'member_rahul',
    email: 'rahul.sharma@example.com',
    password_hash: bcrypt.hashSync('MemberPass2026!', 10),
    full_name: 'Rahul Sharma',
    role: 'member',
    member_id: 1,
    permissions: ['members:read:self', 'members:checkin:self'],
    is_active: true,
  },
];

/**
 * Authenticate credentials, record audit log, and issue JWT token
 * @param {string} username
 * @param {string} password
 * @param {Object} [meta] - { ipAddress, userAgent }
 */
export async function loginUser(username, password, meta = {}) {
  const cleanUsername = String(username || '').trim();
  let user = null;

  if (isDatabaseConnected()) {
    user = await userRepository.findByUsernameOrEmail(cleanUsername);
  } else {
    user = MOCK_USERS.find(
      (u) => u.username.toLowerCase() === cleanUsername.toLowerCase() || u.email.toLowerCase() === cleanUsername.toLowerCase()
    );
  }

  // 1. Verify user exists
  if (!user) {
    if (isDatabaseConnected()) {
      userRepository.recordAuthAudit({
        username: cleanUsername,
        eventType: 'LOGIN_FAILURE',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        details: { reason: 'User not found' },
      }).catch(() => {});
    }
    throw new Error('Invalid username or password.');
  }

  // 2. Verify account is active
  if (!user.is_active) {
    if (isDatabaseConnected()) {
      userRepository.recordAuthAudit({
        userId: user.id,
        username: user.username,
        eventType: 'LOGIN_FAILURE',
        role: user.role,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        details: { reason: 'Account deactivated' },
      }).catch(() => {});
    }
    throw new Error('Account is deactivated. Please contact the administrator.');
  }

  // 3. Cryptographic password comparison (NEVER plaintext)
  let isPasswordValid = false;
  try {
    isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  } catch (err) {
    // If pgcrypto blew fish format difference, test query with crypt()
    if (isDatabaseConnected()) {
      try {
        const verifySql = `SELECT (password_hash = crypt($1, password_hash)) AS is_match FROM users WHERE id = $2;`;
        const verifyRes = await query(verifySql, [password, user.id]);
        isPasswordValid = Boolean(verifyRes.rows[0]?.is_match);
      } catch (e) {
        isPasswordValid = false;
      }
    }
  }

  if (!isPasswordValid) {
    if (isDatabaseConnected()) {
      userRepository.recordAuthAudit({
        userId: user.id,
        username: user.username,
        eventType: 'LOGIN_FAILURE',
        role: user.role,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        details: { reason: 'Incorrect password' },
      }).catch(() => {});
    }
    throw new Error('Invalid username or password.');
  }

  // 4. Update last_login_at timestamp
  if (isDatabaseConnected()) {
    userRepository.updateLastLogin(user.id).catch(() => {});
  }

  // 5. Generate secure JWT token with unique session ID (jti) for revokability
  const jti = crypto.randomUUID();
  const permissions = user.permissions || [];

  const tokenPayload = {
    id: user.id,
    sub: String(user.id),
    username: user.username,
    role: user.role,
    fullName: user.full_name,
    permissions,
    memberId: user.member_id || null,
    trainerId: user.trainer_id || null,
    jti,
  };

  const token = jwt.sign(tokenPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

  // 6. Record successful login audit log
  if (isDatabaseConnected()) {
    userRepository.recordAuthAudit({
      userId: user.id,
      username: user.username,
      eventType: 'LOGIN_SUCCESS',
      role: user.role,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { jti },
    }).catch(() => {});
  }

  // 7. Return user details WITHOUT password_hash
  return {
    token,
    tokenType: 'Bearer',
    expiresIn: config.jwt.expiresIn,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      permissions,
      memberId: user.member_id || null,
      trainerId: user.trainer_id || null,
    },
  };
}

/**
 * Logout authenticated user and revoke active JWT token
 * @param {Object} params - { token, user, ipAddress, userAgent }
 */
export async function logoutUser({ token, user, ipAddress, userAgent }) {
  if (token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.jti) {
        const expiresAt = decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 8 * 3600 * 1000);
        if (isDatabaseConnected()) {
          await userRepository.blacklistToken({
            jti: decoded.jti,
            userId: user?.id || decoded.id,
            expiresAt,
          });
        }
      }
    } catch (e) {
      // Ignored
    }
  }

  if (isDatabaseConnected() && user) {
    userRepository.recordAuthAudit({
      userId: user.id,
      username: user.username,
      eventType: 'LOGOUT',
      role: user.role,
      ipAddress,
      userAgent,
      details: { manual: true },
    }).catch(() => {});
  }

  return { success: true, message: 'Logged out successfully.' };
}

/**
 * Get profile for authenticated user
 * @param {number} userId
 */
export async function getUserProfile(userId) {
  if (isDatabaseConnected()) {
    const user = await userRepository.findById(userId);
    if (user) {
      const { password_hash, ...safeUser } = user;
      return safeUser;
    }
  }

  const mock = MOCK_USERS.find((u) => u.id === Number(userId));
  if (!mock) return null;

  const { password_hash, ...safeMock } = mock;
  return safeMock;
}

/**
 * Register / create a new staff account (Owner only)
 * Plaintext passwords are NEVER stored; always bcrypt hashed with 10 salt rounds
 * @param {Object} userData
 */
export async function registerStaffUser(userData) {
  const { username, email, password, fullName, role = 'trainer', phone, memberId, trainerId } = userData;

  if (!username || !email || !password || !fullName) {
    throw new Error('Username, email, password, and full name are required.');
  }

  // Cryptographic hashing (Argon2 / bcrypt with salt rounds >= 10)
  const passwordHash = bcrypt.hashSync(password, 10);

  if (isDatabaseConnected()) {
    return await userRepository.createUser({
      username,
      email,
      passwordHash,
      fullName,
      role,
      phone,
      memberId,
      trainerId,
    });
  }

  const mockId = MOCK_USERS.length + 1;
  const created = {
    id: mockId,
    username,
    email,
    full_name: fullName,
    role,
    phone,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  MOCK_USERS.push({ ...created, password_hash: passwordHash });
  return created;
}
