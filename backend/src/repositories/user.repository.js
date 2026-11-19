import { query } from '../config/database.js';

/**
 * Find user by username or email for authentication
 * Checks users table with RBAC permissions join and falls back to admin_users
 * @param {string} identifier
 * @param {import('pg').PoolClient} [client]
 */
export async function findByUsernameOrEmail(identifier, client) {
  const cleanId = String(identifier).trim();
  const executor = client || { query };

  // 1. Check users table (with roles permissions, member_id, trainer_id)
  try {
    const userSql = `
      SELECT u.id, u.username, u.email, u.password_hash, u.full_name, u.role, u.is_active,
             u.member_id, u.trainer_id, u.last_login_at, u.avatar_url, r.role_code, r.permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE (LOWER(u.username) = LOWER($1) OR LOWER(u.email) = LOWER($1) OR u.phone = $1)
      LIMIT 1;
    `;
    const userRes = await executor.query(userSql, [cleanId]);
    if (userRes.rowCount > 0) {
      const u = userRes.rows[0];
      // Normalize permissions
      if (!u.permissions) {
        if (u.role === 'owner' || u.role === 'superadmin') u.permissions = ['*'];
        else if (u.role === 'manager') u.permissions = ['members:*', 'trainers:*', 'plans:*', 'reports:view'];
        else if (u.role === 'trainer') u.permissions = ['schedules:read', 'schedules:write:self'];
        else if (u.role === 'member') u.permissions = ['members:read:self', 'members:checkin:self'];
        else u.permissions = [];
      }
      return u;
    }
  } catch (e) {
    console.error('[UserRepository] findByUsernameOrEmail failed:', e.message);
  }

  // NOTE: the legacy admin_users login fallback was removed (single authentication
  // system = users table). admin_users rows are left untouched in the database.
  return null;
}

/**
 * Find user by ID
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function findById(id, client) {
  const executor = client || { query };

  try {
    const userSql = `
      SELECT u.id, u.username, u.email, u.full_name, u.role, u.phone, u.is_active,
             u.member_id, u.trainer_id, u.last_login_at, u.created_at, u.avatar_url, r.role_code, r.permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1
      LIMIT 1;
    `;
    const userRes = await executor.query(userSql, [id]);
    if (userRes.rowCount > 0) {
      return userRes.rows[0];
    }
  } catch (e) {
    console.error('[UserRepository] findById failed:', e.message);
  }

  return null; // legacy admin_users fallback removed (single authentication system)
}

/**
 * Update user last login timestamp
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function updateLastLogin(id, client) {
  const executor = client || { query };
  try {
    await executor.query(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1;`, [id]);
  } catch (e) {
    // Ignored
  }
}

/**
 * Record an authentication audit log event
 * @param {Object} auditData
 * @param {import('pg').PoolClient} [client]
 */
export async function recordAuthAudit(auditData, client) {
  const {
    userId = null,
    username,
    eventType,
    role = null,
    ipAddress = null,
    userAgent = null,
    details = {},
  } = auditData;

  const sql = `
    INSERT INTO auth_audit_logs (user_id, username, event_type, role, ip_address, user_agent, details)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, created_at;
  `;

  const executor = client || { query };
  try {
    const res = await executor.query(sql, [
      userId,
      username,
      eventType,
      role,
      ipAddress,
      userAgent,
      JSON.stringify(details),
    ]);
    return res.rows[0];
  } catch (err) {
    // Non-fatal if audit logging encounters a database hiccup
    console.warn('[UserRepo] Could not record auth audit log:', err.message);
    return null;
  }
}

/**
 * Retrieve recent authentication audit logs
 * @param {Object} [filter] - { limit, userId, eventType }
 * @param {import('pg').PoolClient} [client]
 */
export async function getAuthAuditLogs({ limit = 50, userId, eventType } = {}, client) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (userId) {
    conditions.push(`user_id = $${idx++}`);
    params.push(userId);
  }
  if (eventType) {
    conditions.push(`event_type = $${idx++}`);
    params.push(eventType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const sql = `
    SELECT id, user_id, username, event_type, role, ip_address, user_agent, details, created_at
    FROM auth_audit_logs
    ${where}
    ORDER BY created_at DESC
    LIMIT $${idx};
  `;
  const executor = client || { query };
  const res = await executor.query(sql, params);
  return res.rows;
}

/**
 * Blacklist a revoked JWT token (by jti) upon logout
 * @param {Object} data - { jti, userId, expiresAt }
 * @param {import('pg').PoolClient} [client]
 */
export async function blacklistToken({ jti, userId, expiresAt }, client) {
  const sql = `
    INSERT INTO token_blacklist (jti, user_id, expires_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (jti) DO NOTHING;
  `;
  const executor = client || { query };
  await executor.query(sql, [jti, userId || null, expiresAt || new Date(Date.now() + 8 * 3600 * 1000)]);
}

/**
 * Check if a token jti is blacklisted
 * @param {string} jti
 * @param {import('pg').PoolClient} [client]
 */
export async function isTokenBlacklisted(jti, client) {
  if (!jti) return false;
  const sql = `SELECT 1 FROM token_blacklist WHERE jti = $1 AND expires_at > CURRENT_TIMESTAMP LIMIT 1;`;
  const executor = client || { query };
  try {
    const res = await executor.query(sql, [jti]);
    return res.rowCount > 0;
  } catch (e) {
    return false;
  }
}

/**
 * List administrative and staff accounts
 * @param {Object} [options]
 * @param {import('pg').PoolClient} [client]
 */
export async function listUsers({ limit = 50 } = {}, client) {
  const sql = `
    SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active, u.member_id, u.trainer_id,
           u.last_login_at, u.created_at, r.name as role_name, r.permissions
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    ORDER BY u.id ASC
    LIMIT $1;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [limit]);
  return res.rows;
}

/**
 * Create a new user account
 * @param {Object} userData
 * @param {import('pg').PoolClient} [client]
 */
export async function createUser(userData, client) {
  const {
    username,
    email,
    passwordHash,
    fullName,
    role = 'trainer',
    roleId,
    phone,
    memberId,
    trainerId,
  } = userData;

  const sql = `
    INSERT INTO users (
      username, email, password_hash, full_name, role, role_id, phone, is_active, member_id, trainer_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9)
    RETURNING id, username, email, full_name, role, is_active, member_id, trainer_id, created_at;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [
    username.trim().toLowerCase(),
    email.trim().toLowerCase(),
    passwordHash,
    fullName,
    role,
    roleId || null,
    phone || null,
    memberId || null,
    trainerId || null,
  ]);
  return res.rows[0];
}

/**
 * Find or create a user by Google ID or email
 * Links Google ID to existing local account if found, or provisions a new user.
 * @param {Object} data - { googleId, email, fullName, role, avatarUrl }
 * @param {import('pg').PoolClient} [client]
 */
export async function findOrCreateGoogleUser(data, client) {
  const { googleId, email, fullName, role = 'member', avatarUrl = null } = data;
  const executor = client || { query };
  const cleanEmail = String(email || '').trim().toLowerCase();

  // 1. Look for existing user by google_id or email
  const existingSql = `
    SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active,
           u.member_id, u.trainer_id, u.last_login_at, u.avatar_url, u.google_id,
           r.role_code, r.permissions
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.google_id = $1 OR LOWER(u.email) = $2
    LIMIT 1;
  `;
  const existingRes = await executor.query(existingSql, [googleId, cleanEmail]);

  if (existingRes.rowCount > 0) {
    const user = existingRes.rows[0];

    // Link google_id or update avatar if missing
    const updates = [];
    const params = [];
    let pIdx = 1;

    if (!user.google_id) {
      updates.push(`google_id = $${pIdx++}`, `auth_provider = 'google'`);
      params.push(googleId);
      user.google_id = googleId;
    }
    if (avatarUrl && !user.avatar_url) {
      updates.push(`avatar_url = $${pIdx++}`);
      params.push(avatarUrl);
      user.avatar_url = avatarUrl;
    }

    if (updates.length > 0) {
      params.push(user.id);
      await executor.query(`UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${pIdx};`, params);
    }

    // Attach permissions
    if (!user.permissions) {
      if (user.role === 'owner' || user.role === 'superadmin') user.permissions = ['*'];
      else if (user.role === 'manager') user.permissions = ['members:*', 'trainers:*', 'plans:*', 'reports:view'];
      else if (user.role === 'trainer') user.permissions = ['schedules:read', 'schedules:write:self'];
      else if (user.role === 'member') user.permissions = ['members:read:self', 'members:checkin:self'];
      else user.permissions = [];
    }
    return user;
  }

  // 2. No login yet: only a member or trainer the GYM already registered with this email gets a login, with
  //    THEIR role. The role sent by the browser is ignored, so Google can never create owner/manager accounts.
  let memberId = null;
  let trainerId = null;
  let assignedRole = null;

  try {
    const memRes = await executor.query(`SELECT id, full_name FROM members WHERE LOWER(email) = $1 LIMIT 1;`, [cleanEmail]);
    if (memRes.rowCount > 0) {
      memberId = memRes.rows[0].id;
      assignedRole = 'member';
    } else {
      const trRes = await executor.query(`SELECT id, full_name FROM trainers WHERE LOWER(email) = $1 LIMIT 1;`, [cleanEmail]);
      if (trRes.rowCount > 0) {
        trainerId = trRes.rows[0].id;
        assignedRole = 'trainer';
      }
    }
  } catch (err) {
    // Ignore lookup errors
  }

  if (!assignedRole) return null;   // unknown Google email → refused (accounts are created by the admin)

  // Generate unique username
  let baseUsername = cleanEmail.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 24);
  if (!baseUsername) baseUsername = 'user';
  let username = baseUsername;
  let suffix = Math.floor(100 + Math.random() * 900);

  const checkUser = await executor.query(`SELECT 1 FROM users WHERE LOWER(username) = $1 LIMIT 1;`, [username]);
  if (checkUser.rowCount > 0) {
    username = `${baseUsername}_${suffix}`;
  }

  const insertSql = `
    INSERT INTO users (
      username, email, full_name, google_id, auth_provider, role, is_active,
      member_id, trainer_id, avatar_url, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, 'google', $5, TRUE, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id, username, email, full_name, role, is_active, member_id, trainer_id, avatar_url, created_at;
  `;
  const insertRes = await executor.query(insertSql, [
    username,
    cleanEmail,
    fullName || username,
    googleId,
    assignedRole,
    memberId,
    trainerId,
    avatarUrl,
  ]);
  const newUser = insertRes.rows[0];

  if (newUser.role === 'owner' || newUser.role === 'superadmin') newUser.permissions = ['*'];
  else if (newUser.role === 'manager') newUser.permissions = ['members:*', 'trainers:*', 'plans:*', 'reports:view'];
  else if (newUser.role === 'trainer') newUser.permissions = ['schedules:read', 'schedules:write:self'];
  else if (newUser.role === 'member') newUser.permissions = ['members:read:self', 'members:checkin:self'];
  else newUser.permissions = [];

  return newUser;
}

