import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OAuth2Client } from 'google-auth-library';
import { query, isDatabaseConnected, ensureDatabaseConnected } from '../config/database.js';
import { config } from '../config/env.js';
import * as userRepository from '../repositories/user.repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const googleOAuthClient = new OAuth2Client();

// In-memory fallback development credentials when PostgreSQL is offline
const MOCK_USERS = [
  {
    id: 1,
    username: 'admin',
    email: 'admin@virtexfitness.in',
    password_hash: bcrypt.hashSync('AdminPass2026!', 10),
    full_name: 'Dev Admin Manager',
    role: 'superadmin',
    permissions: ['*'],
    is_active: true,
  },
  {
    id: 2,
    username: 'head_trainer',
    email: 'trainer@virtexfitness.in',
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
    email: 'priya.manager@virtexfitness.in',
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
export async function loginUser(username, password, meta = {}, opts = {}) {
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
      }).catch(() => { });
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
      }).catch(() => { });
    }
    // An admin sign-up waiting for the owner: say so, but only to someone who knows the password.
    try {
      if (bcrypt.compareSync(String(password || ''), user.password_hash || '')) {
        const { isPendingAdminSignup } = await import('../controllers/adminSignup.controller.js');
        if (await isPendingAdminSignup(user.id)) throw Object.assign(new Error('Your admin account is waiting for the owner\'s approval. You can sign in once it is approved.'), { status: 403 });
      }
    } catch (e) { if (e.status === 403) throw e; }
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

  // Passwords set by an admin (trainer / member provisioning) are stored trimmed. A password copied from the
  // "Copy Credentials" text often carries a trailing space or line break, so retry once with it trimmed.
  if (!isPasswordValid && typeof password === 'string' && password.trim() && password.trim() !== password) {
    try { isPasswordValid = bcrypt.compareSync(password.trim(), user.password_hash); } catch { isPasswordValid = false; }
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
      }).catch(() => { });
    }
    throw new Error('Invalid username or password.');
  }

  // 3b. A member frozen by the admin for unpaid fees cannot sign in (checked only after the password is right).
  if (isDatabaseConnected() && String(user.role || '').toLowerCase() === 'member' && user.member_id) {
    const m = (await query('SELECT status FROM members WHERE id = $1', [user.member_id])).rows[0];
    if (m && m.status === 'frozen') {
      userRepository.recordAuthAudit({
        userId: user.id, username: user.username, eventType: 'LOGIN_FAILURE', role: user.role,
        ipAddress: meta.ipAddress, userAgent: meta.userAgent, details: { reason: 'Account frozen (unpaid fees)' },
      }).catch(() => { });
      throw Object.assign(new Error('Your account is frozen. Please pay the fees at the front desk to open your account again.'), { status: 403, code: 'ACCOUNT_FROZEN' });
    }
  }

  // 3c. Members and trainers: 2-step sign-in. Step 1 = email/username + password (done above).
  //     Step 2 = their linked Google account (first sign-in links it). See completeTwoStepWithGoogle().
  if (!opts.skipTwoStep && TWO_STEP_ROLES.has(String(user.role || '').toLowerCase())) {
    // Fail closed: a member / trainer never gets a session without step 2.
    if (!(await ensureDatabaseConnected())) throw Object.assign(new Error('Sign-in is unavailable right now. Please try again in a moment.'), { status: 503 });
    const linked = !!(await query('SELECT google_id FROM users WHERE id = $1', [user.id])).rows[0]?.google_id;
    const challenge = jwt.sign({ purpose: '2fa', uid: user.id, mode: linked ? 'verify' : 'link', jti: crypto.randomUUID() }, config.jwt.secret, { expiresIn: '10m' });
    userRepository.recordAuthAudit({
      userId: user.id, username: user.username, eventType: 'LOGIN_STEP1_OK', role: user.role,
      ipAddress: meta.ipAddress, userAgent: meta.userAgent, details: { next: linked ? 'google_verify' : 'google_link' },
    }).catch(() => { });
    return {
      twoStep: true, mode: linked ? 'verify' : 'link', challenge, expiresIn: 600,
      user: { fullName: user.full_name, role: user.role, email: user.email },
    };
  }

  return issueSession(user, meta);
}

/** Steps 4–7 of a successful sign-in: last login, signed JWT (jti), audit, safe user details. */
async function issueSession(user, meta = {}) {
  // 4. Update last_login_at timestamp
  if (isDatabaseConnected()) {
    userRepository.updateLastLogin(user.id).catch(() => { });
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
    }).catch(() => { });
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
      avatarUrl: user.avatar_url || null,
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
    }).catch(() => { });
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
      return {
        ...safeUser,
        fullName: user.full_name || safeUser.fullName,
        avatarUrl: user.avatar_url || null,
      };
    }
  }

  const mock = MOCK_USERS.find((u) => u.id === Number(userId));
  if (!mock) return null;

  const { password_hash, ...safeMock } = mock;
  return {
    ...safeMock,
    fullName: safeMock.fullName || safeMock.full_name,
    avatarUrl: safeMock.avatar_url || safeMock.avatarUrl || null,
  };
}

/**
 * Update authenticated user profile details
 * @param {number} userId
 * @param {Object} updateData
 */
export async function updateUserProfile(userId, { fullName, phone, email, avatarUrl, currentPassword, newPassword } = {}) {
  if (isDatabaseConnected()) {
    const user = await userRepository.findById(userId);
    if (!user) throw new Error('User not found.');

    let newHash = null;
    if (newPassword) {
      if (!currentPassword) {
        throw new Error('Current password is required to set a new password.');
      }
      let isMatch = false;
      // findById deliberately does not load password_hash (profile reads never carry it), so read the
      // hash on its own here — only for this comparison, never returned.
      const hashRes = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
      const storedHash = hashRes.rows[0]?.password_hash || '';
      try {
        isMatch = bcrypt.compareSync(currentPassword, storedHash);
      } catch {
        const verifySql = `SELECT (password_hash = crypt($1, password_hash)) AS is_match FROM users WHERE id = $2;`;
        const verifyRes = await query(verifySql, [currentPassword, userId]);
        isMatch = Boolean(verifyRes.rows[0]?.is_match);
      }
      if (!isMatch) {
        throw new Error('Current password is incorrect.');
      }
      if (newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters.');
      }
      newHash = bcrypt.hashSync(newPassword, 10);
    }

    const cleanName = fullName ? String(fullName).trim() : user.full_name;
    const cleanPhone = phone !== undefined ? String(phone).trim() : user.phone;
    const cleanEmail = email ? String(email).trim().toLowerCase() : user.email;

    let cleanAvatar = user.avatar_url;
    if (avatarUrl !== undefined) {
      if (!avatarUrl || avatarUrl === 'null' || avatarUrl === 'REMOVE') {
        cleanAvatar = null;
      } else if (typeof avatarUrl === 'string' && avatarUrl.startsWith('data:image/')) {
        try {
          const matches = avatarUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
          if (matches) {
            const rawExt = matches[1].toLowerCase();
            const ext = (rawExt === 'jpeg' ? 'jpg' : rawExt.replace('+xml', '')).slice(0, 4);
            const buffer = Buffer.from(matches[2], 'base64');
            const uploadsDir = path.resolve(__dirname, '../../../frontend/uploads/avatars');
            if (!fs.existsSync(uploadsDir)) {
              fs.mkdirSync(uploadsDir, { recursive: true });
            }
            const filename = `avatar_${userId}_${Date.now()}.${ext}`;
            const filePath = path.join(uploadsDir, filename);
            fs.writeFileSync(filePath, buffer);
            cleanAvatar = `/uploads/avatars/${filename}`;
          }
        } catch (e) {
          console.warn('[AuthService] Could not write avatar file to disk, storing data URL:', e.message);
          cleanAvatar = avatarUrl;
        }
      } else {
        cleanAvatar = String(avatarUrl).trim();
      }
    }

    const sql = `
      UPDATE users
      SET full_name = $1,
          phone = $2,
          email = $3,
          password_hash = COALESCE($4, password_hash),
          avatar_url = $5,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING id, username, email, full_name, role, phone, is_active, last_login_at, avatar_url;
    `;
    const res = await query(sql, [cleanName, cleanPhone, cleanEmail, newHash, cleanAvatar, userId]);
    const updatedUser = res.rows[0];
    return {
      ...updatedUser,
      fullName: updatedUser.full_name,
      avatarUrl: updatedUser.avatar_url,
    };
  }

  const mock = MOCK_USERS.find((u) => u.id === Number(userId));
  if (mock) {
    if (fullName) mock.full_name = fullName;
    if (email) mock.email = email;
    if (avatarUrl !== undefined) mock.avatar_url = avatarUrl;
    return { ...mock, fullName: mock.full_name, avatarUrl: mock.avatar_url };
  }
  return { id: userId, fullName, phone, email, avatarUrl };
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

/**
 * Universal Registration Service for Members, Personal Trainers, and Admins
 * @param {Object} userData
 * @param {Object} [meta] - { ipAddress, userAgent }
 */
export async function registerUser(userData, meta = {}) {
  const {
    role = 'member',
    username,
    email,
    password,
    fullName,
    phone,
    // Member specific
    planId,
    preferredLanguage = 'en-IN',
    emergencyContactName,
    emergencyContactPhone,
    // Trainer specific
    specialty = 'Functional Strength & Conditioning',
    certifications = [],
    bio,
    // Admin specific
    adminSecretKey,
  } = userData;

  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanRole = String(role || 'member').trim().toLowerCase();
  const cleanFullName = String(fullName || '').trim();
  const cleanPhone = phone ? String(phone).trim() : null;

  // 1. Public self-registration is for MEMBERS only (three-portal RBAC).
  //    Trainer accounts are created by Admin (POST /trainers); staff/management accounts
  //    by the Owner (POST /admin/users, /operations/staff). Previously a management account
  //    could be created here simply by omitting the invite key.
  void adminSecretKey;
  // Policy: there is NO public sign-up. The gym admin creates every member (POST /members) and trainer
  // (POST /trainers) login with an email and password; staff accounts are created by the Owner.
  const PUBLIC_SIGNUP_ENABLED = false;
  if (!PUBLIC_SIGNUP_ENABLED || cleanRole !== 'member') {
    const err = new Error('Accounts are created by the gym admin. Please ask the front desk for your login email and password.');
    err.status = 403;
    err.code = 'SELF_REGISTRATION_DISABLED';
    throw err;
  }

  // 2. Check for duplicate username or email
  if (isDatabaseConnected()) {
    const existingUser = await userRepository.findByUsernameOrEmail(cleanUsername);
    if (existingUser) {
      throw new Error(`Username '${cleanUsername}' is already taken. Please choose another.`);
    }
    const existingEmail = await userRepository.findByUsernameOrEmail(cleanEmail);
    if (existingEmail) {
      throw new Error(`Email address '${cleanEmail}' is already registered. Please log in instead.`);
    }
  }

  // 3. Cryptographic Password Hashing
  const passwordHash = bcrypt.hashSync(password, 10);

  let memberId = null;
  let trainerId = null;
  let roleId = null;
  let assignedRole = cleanRole;

  if (isDatabaseConnected()) {
    // Standardize role code
    if (cleanRole === 'admin' || cleanRole === 'superadmin') {
      assignedRole = 'owner';
    }

    const roleRes = await query(`SELECT id FROM roles WHERE role_code = $1 LIMIT 1;`, [assignedRole]);
    roleId = roleRes.rows[0]?.id || null;

    // A. Role: MEMBER
    if (assignedRole === 'member') {
      const randomCode = 'MEM-' + Math.floor(10000 + Math.random() * 90000);
      let planName = 'Standard Fitness Membership';
      let selectedPlanId = planId ? parseInt(planId, 10) : null;

      if (selectedPlanId) {
        const pRes = await query(`SELECT name FROM membership_plans WHERE id = $1;`, [selectedPlanId]);
        if (pRes.rows[0]) planName = pRes.rows[0].name;
      } else {
        const defaultPlanRes = await query(`SELECT id, name FROM membership_plans WHERE is_active = TRUE ORDER BY id ASC LIMIT 1;`);
        if (defaultPlanRes.rows[0]) {
          selectedPlanId = defaultPlanRes.rows[0].id;
          planName = defaultPlanRes.rows[0].name;
        }
      }

      const generatedPhone = cleanPhone || `+91 9${Math.floor(100000000 + Math.random() * 899999999)}`;
      const memSql = `
        INSERT INTO members (
          member_code, full_name, phone, email, plan_id, plan_name, status,
          preferred_language, emergency_contact_name, emergency_contact_phone
        ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9)
        RETURNING id;
      `;
      const memRes = await query(memSql, [
        randomCode,
        cleanFullName,
        generatedPhone,
        cleanEmail,
        selectedPlanId,
        planName,
        preferredLanguage,
        emergencyContactName || 'Family Member',
        emergencyContactPhone || '+91 98765 00000',
      ]);
      memberId = memRes.rows[0].id;
    }

    // B. Role: TRAINER
    else if (assignedRole === 'trainer') {
      const randomCode = 'TRN' + Math.floor(1000 + Math.random() * 9000);
      const generatedPhone = cleanPhone || `+91 9${Math.floor(100000000 + Math.random() * 899999999)}`;
      const certsArray = Array.isArray(certifications) ? certifications : typeof certifications === 'string' && certifications.trim() ? [certifications.trim()] : ['ACE Certified Fitness Coach', 'CPR/AED'];

      const trnSql = `
        INSERT INTO trainers (
          trainer_code, full_name, specialty, phone, email, bio, certifications, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'on_floor')
        RETURNING id;
      `;
      const trnRes = await query(trnSql, [
        randomCode,
        cleanFullName,
        specialty,
        generatedPhone,
        cleanEmail,
        bio || 'Virtex Certified Personal Trainer and Movement Specialist.',
        certsArray,
      ]);
      trainerId = trnRes.rows[0].id;

      // Assign recurring weekday schedules (06:00 - 14:00)
      for (let day = 1; day <= 5; day++) {
        await query(
          `INSERT INTO trainer_schedules (trainer_id, day_of_week, shift_start, shift_end, is_available)
           VALUES ($1, $2, '06:00:00', '14:00:00', TRUE)
           ON CONFLICT DO NOTHING;`,
          [trainerId, day]
        ).catch(() => { });
      }
    }

    // Create record in users table
    const newUser = await userRepository.createUser({
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
      fullName: cleanFullName,
      role: assignedRole,
      roleId,
      phone: cleanPhone,
      memberId,
      trainerId,
    });

    // Generate authenticated JWT session
    const jti = crypto.randomUUID();
    let permissions = ['members:read:self', 'members:checkin:self'];
    if (assignedRole === 'owner') permissions = ['*'];
    else if (assignedRole === 'manager') permissions = ['members:*', 'trainers:*', 'plans:*', 'reports:view'];
    else if (assignedRole === 'trainer') permissions = ['schedules:read', 'schedules:write:self', 'trainers:status:self'];

    const tokenPayload = {
      id: newUser.id,
      sub: String(newUser.id),
      username: newUser.username,
      role: newUser.role,
      fullName: newUser.full_name,
      permissions,
      memberId,
      trainerId,
      jti,
    };

    const token = jwt.sign(tokenPayload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });

    userRepository.recordAuthAudit({
      userId: newUser.id,
      username: newUser.username,
      eventType: 'REGISTER_SUCCESS',
      role: newUser.role,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { role: assignedRole, memberId, trainerId },
    }).catch(() => { });

    return {
      token,
      tokenType: 'Bearer',
      expiresIn: config.jwt.expiresIn,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        fullName: newUser.full_name,
        role: newUser.role,
        memberId,
        trainerId,
        permissions,
      },
    };
  }

  // In-memory fallback
  const mockId = MOCK_USERS.length + 1;
  const mockCreated = {
    id: mockId,
    username: cleanUsername,
    email: cleanEmail,
    full_name: cleanFullName,
    role: assignedRole,
    phone: cleanPhone,
    is_active: true,
    member_id: assignedRole === 'member' ? mockId : null,
    trainer_id: assignedRole === 'trainer' ? mockId : null,
  };
  MOCK_USERS.push({ ...mockCreated, password_hash: passwordHash });

  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { id: mockId, sub: String(mockId), username: cleanUsername, role: assignedRole, fullName: cleanFullName, jti },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  return {
    token,
    tokenType: 'Bearer',
    expiresIn: config.jwt.expiresIn,
    user: mockCreated,
  };
}

/**
 * Authenticate or register a user using Google OAuth ID Token
 * @param {Object} params
 * @param {string} params.idToken - Google JWT credential from GIS
 * @param {string} [params.role='member'] - Desired role context ('member', 'trainer', 'owner', 'manager')
 * @param {Object} [params.meta={}] - Request metadata (ipAddress, userAgent)
 */
// ---------------------------------------------------------------- 2-step sign-in (members + trainers)
export const TWO_STEP_ROLES = new Set(['member', 'trainer']);

async function verifyGoogleIdToken(idToken) {
  let payload;
  try {
    const ticket = await googleOAuthClient.verifyIdToken({ idToken, audience: config.auth?.googleClientId });
    payload = ticket.getPayload();
  } catch (err) {
    throw new Error('Invalid or expired Google authentication token.');
  }
  if (payload?.email_verified !== true) throw new Error('Your Google email is not verified. Verify it with Google first.');
  return payload;
}

/**
 * Step 2: the person proves they own the Google account linked to this login (or links one on their first sign-in).
 * `challenge` is the short-lived token from step 1; it can be used once.
 */
export async function completeTwoStepWithGoogle({ challenge, idToken, meta = {} }) {
  if (!challenge || !idToken) throw Object.assign(new Error('Sign in with your email and password first.'), { status: 400 });
  let c;
  try { c = jwt.verify(challenge, config.jwt.secret); } catch { throw Object.assign(new Error('Step 1 has expired. Please sign in with your email and password again.'), { status: 401 }); }
  if (c.purpose !== '2fa' || !c.uid) throw Object.assign(new Error('Invalid sign-in step.'), { status: 400 });
  if (c.jti && await userRepository.isTokenBlacklisted(c.jti)) throw Object.assign(new Error('This sign-in step was already used. Please sign in again.'), { status: 401 });
  const g = await verifyGoogleIdToken(idToken);
  const row = (await query('SELECT id, username, google_id, is_active, role FROM users WHERE id = $1', [c.uid])).rows[0];
  if (!row || !row.is_active) throw Object.assign(new Error('Account is deactivated. Please contact the administrator.'), { status: 403 });
  if (row.google_id) {
    if (row.google_id !== g.sub) {
      userRepository.recordAuthAudit({ userId: row.id, username: row.username, eventType: 'LOGIN_FAILURE', role: row.role, ipAddress: meta.ipAddress, userAgent: meta.userAgent, details: { reason: '2-step: wrong Google account', googleEmail: g.email } }).catch(() => { });
      throw Object.assign(new Error('That is not the Google account linked to your login. Choose the Gmail you linked the first time, or ask the gym to reset it.'), { status: 403 });
    }
  } else {
    const taken = (await query('SELECT id FROM users WHERE google_id = $1 AND id <> $2', [g.sub, row.id])).rowCount;
    if (taken) throw Object.assign(new Error('That Google account is already linked to another Virtex login. Choose a different Gmail.'), { status: 409 });
    await query(`UPDATE users SET google_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND google_id IS NULL`, [g.sub, row.id]);
    userRepository.recordAuthAudit({ userId: row.id, username: row.username, eventType: 'GOOGLE_LINKED', role: row.role, ipAddress: meta.ipAddress, userAgent: meta.userAgent, details: { googleEmail: g.email } }).catch(() => { });
  }
  if (c.jti) await userRepository.blacklistToken({ jti: c.jti, userId: row.id, expiresAt: new Date((c.exp || 0) * 1000) }).catch(() => { });
  const user = await userRepository.findByUsernameOrEmail(row.username);
  if (!user) throw Object.assign(new Error('Account not found.'), { status: 404 });
  return issueSession(user, { ...meta, twoStep: true });
}

export async function loginWithGoogle({ idToken, role = 'member', meta = {} }) {
  if (!idToken) {
    throw new Error('Google ID token is required.');
  }

  const clientId = config.auth?.googleClientId;
  let googlePayload;

  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken,
      audience: clientId,
    });
    googlePayload = ticket.getPayload();
  } catch (err) {
    console.error('[AuthService] Google ID token verification failed:', err.message);
    throw new Error('Invalid or expired Google authentication token.');
  }
  // Only a Google-VERIFIED email may be matched to a Virtex account.
  if (googlePayload?.email_verified !== true) {
    throw new Error('Your Google email is not verified. Verify it with Google, or sign in with your username and password.');
  }

  const googleId = googlePayload.sub;
  const email = googlePayload.email;
  const fullName = googlePayload.name || email.split('@')[0];
  const avatarUrl = googlePayload.picture || null;

  if (!email) {
    throw new Error('Google account does not provide an email address.');
  }

  // 1. Database flow
  if (isDatabaseConnected()) {
    const user = await userRepository.findOrCreateGoogleUser({
      googleId,
      email,
      fullName,
      role,
      avatarUrl,
    });

    if (user && TWO_STEP_ROLES.has(String(user.role || '').toLowerCase())) {
      throw Object.assign(new Error('Members and trainers sign in with email and password first — Google is the second step.'), { status: 403 });
    }
    if (!user) {
      // Accounts are created only by the gym (admin); Google never creates a new staff/member account.
      throw new Error('No Virtex account uses this Google email. Ask the gym owner to add you, or sign in with your username and password.');
    }

    if (!user.is_active) {
      userRepository.recordAuthAudit({
        userId: user.id,
        username: user.username,
        eventType: 'LOGIN_FAILURE',
        role: user.role,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        details: { reason: 'Account deactivated', provider: 'google' },
      }).catch(() => {});
      throw new Error('Account is deactivated. Please contact the administrator.');
    }

    // Check if account is frozen
    if (String(user.role || '').toLowerCase() === 'member' && user.member_id) {
      try {
        const m = (await query('SELECT status FROM members WHERE id = $1', [user.member_id])).rows[0];
        if (m && m.status === 'frozen') {
          userRepository.recordAuthAudit({
            userId: user.id, username: user.username, eventType: 'LOGIN_FAILURE', role: user.role,
            ipAddress: meta.ipAddress, userAgent: meta.userAgent, details: { reason: 'Account frozen (unpaid fees)', provider: 'google' },
          }).catch(() => {});
          throw Object.assign(new Error('Your account is frozen. Please pay the fees at the front desk to open your account again.'), { status: 403, code: 'ACCOUNT_FROZEN' });
        }
      } catch (e) {
        if (e.status === 403) throw e;
      }
    }

    userRepository.updateLastLogin(user.id).catch(() => {});

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

    userRepository.recordAuthAudit({
      userId: user.id,
      username: user.username,
      eventType: 'LOGIN_SUCCESS',
      role: user.role,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { provider: 'google', email },
    }).catch(() => {});

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
        memberId: user.member_id || null,
        trainerId: user.trainer_id || null,
        avatarUrl: user.avatar_url || avatarUrl,
        permissions,
      },
    };
  }

  // No database: never issue a token for an unknown Google account (the old demo fallback trusted the
  // role sent by the browser).
  throw new Error('Google sign-in is not available right now. Please sign in with your username and password.');

  // eslint-disable-next-line no-unreachable
  const mockUser = {
    id: 999,
    username: email.split('@')[0],
    email,
    full_name: fullName,
    role,
    avatar_url: avatarUrl,
    is_active: true,
  };
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { id: mockUser.id, sub: String(mockUser.id), username: mockUser.username, role, fullName, jti },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  return {
    token,
    tokenType: 'Bearer',
    expiresIn: config.jwt.expiresIn,
    user: mockUser,
  };
}
