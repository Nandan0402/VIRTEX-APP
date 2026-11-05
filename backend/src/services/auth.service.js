import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, isDatabaseConnected } from '../config/database.js';
import { config } from '../config/env.js';

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
    // Parameterized lookup in admin_users
    const sql = `
      SELECT id, username, email, password_hash, full_name, role, is_active
      FROM admin_users
      WHERE (username = $1 OR email = $1)
      LIMIT 1;
    `;
    const result = await query(sql, [username.trim()]);
    if (result.rowCount > 0) {
      user = result.rows[0];
    }
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
      const verifySql = `SELECT (password_hash = crypt($1, password_hash)) AS is_match FROM admin_users WHERE id = $2;`;
      const verifyRes = await query(verifySql, [password, user.id]);
      isPasswordValid = Boolean(verifyRes.rows[0]?.is_match);
    }
  }

  if (!isPasswordValid) {
    throw new Error('Invalid username or password.');
  }

  // Update last_login_at timestamp
  if (isDatabaseConnected()) {
    query('UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1;', [user.id]).catch(() => {});
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
    const sql = `
      SELECT id, username, email, full_name, role, is_active, last_login_at, created_at
      FROM admin_users
      WHERE id = $1
      LIMIT 1;
    `;
    const result = await query(sql, [userId]);
    return result.rows[0] || null;
  }

  const u = MOCK_USERS.find((x) => x.id === userId);
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    is_active: u.is_active,
  };
}

