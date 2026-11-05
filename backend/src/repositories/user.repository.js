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
             u.member_id, u.trainer_id, u.last_login_at, r.role_code, r.permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE (LOWER(u.username) = LOWER($1) OR LOWER(u.email) = LOWER($1))
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
    // Fall through to admin_users
  }

  // 2. Legacy fallback to admin_users
  try {
    const adminSql = `
      SELECT id, username, email, password_hash, full_name, role, is_active, last_login_at
      FROM admin_users
      WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1))
      LIMIT 1;
    `;
    const adminRes = await executor.query(adminSql, [cleanId]);
    if (adminRes.rowCount > 0) {
      const admin = adminRes.rows[0];
      return {
        ...admin,
        permissions: admin.role === 'superadmin' ? ['*'] : ['members.view', 'trainers.self'],
      };
    }
  } catch (e) {
    // Ignored
  }

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
      SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active,
             u.member_id, u.trainer_id, u.last_login_at, u.created_at, r.role_code, r.permissions
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
    // Fall through
  }

  try {
    const adminSql = `
      SELECT id, username, email, full_name, role, is_active, last_login_at, created_at
      FROM admin_users
      WHERE id = $1
      LIMIT 1;
    `;
    const adminRes = await executor.query(adminSql, [id]);
    if (adminRes.rowCount > 0) {
      return {
        ...adminRes.rows[0],
        permissions: adminRes.rows[0].role === 'superadmin' ? ['*'] : ['members.view'],
      };
    }
  } catch (e) {
    // Fall through
  }

  return null;
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
  try {
    await executor.query(`UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1;`, [id]);
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
