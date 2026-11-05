import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, isDatabaseConnected } from '../config/database.js';
import { config } from '../config/env.js';
import * as userRepository from '../repositories/user.repository.js';

// Fallback in-memory development credentials when PostgreSQL is offline
const MOCK_USERS = [
  {
    id: 1,
    username: 'admin',
    email: 'admin@pulsecorefitness.in',
    password_hash: bcrypt.hashSync('AdminPass2026!', 10),
    full_name: 'Dev Admin Manager',
    role: 'superadmin',
    is_active: true,
  },
  {
    id: 2,
    username: 'trainer',
    email: 'trainer@pulsecorefitness.in',
    password_hash: bcrypt.hashSync('TrainerPass2026!', 10),
    full_name: 'Head Coach Arjun',
    role: 'trainer',
    is_active: true,
  },
];

/**
 * Authenticate username and password, returns signed JWT token & user info
 * @param {string} username
 * @param {string} password
 */
export async function loginUser(username, password) {
  let user = null;

  if (isDatabaseConnected()) {
    user = await userRepository.findByUsernameOrEmail(username.trim());
  } else {
    user = MOCK_USERS.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase() || u.email === username.trim()
    );
  }

  if (!user) {
    throw new Error('Invalid username or password.');
  }

  if (!user.is_active) {
    throw new Error('Account is deactivated. Please contact the administrator.');
  }

  // Cryptographic password comparison (NEVER plaintext)
  // Supports both standard bcrypt hashes ($2a$, $2b$) and pgcrypto ($2a$)
  let isPasswordValid = false;
  try {
    isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  } catch (err) {
    // If pgcrypto blew fish format difference, test query with crypt()
    if (isDatabaseConnected()) {
      try {
        const verifySql = `SELECT (password_hash = crypt($1, password_hash)) AS is_match FROM admin_users WHERE id = $2;`;
        const verifyRes = await query(verifySql, [password, user.id]);
        isPasswordValid = Boolean(verifyRes.rows[0]?.is_match);
      } catch (e) {
        isPasswordValid = false;
      }
    }
  }

  if (!isPasswordValid) {
    throw new Error('Invalid username or password.');
  }

  // Update last_login_at timestamp
  if (isDatabaseConnected()) {
    userRepository.updateLastLogin(user.id).catch(() => {});
  }

  // Generate JWT token with user context
  const tokenPayload = {
    id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name,
  };

  const token = jwt.sign(tokenPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

  // Return clean user object WITHOUT password_hash
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
    },
  };
}

/**
 * Get profile for authenticated user
 */
export async function getUserProfile(userId) {
  if (isDatabaseConnected()) {
    const user = await userRepository.findById(userId);
    if (user) return user;
  }

  const mock = MOCK_USERS.find((u) => u.id === Number(userId));
  if (!mock) return null;

  return {
    id: mock.id,
    username: mock.username,
    email: mock.email,
    full_name: mock.full_name,
    role: mock.role,
    is_active: mock.is_active,
    created_at: new Date().toISOString(),
  };
}
