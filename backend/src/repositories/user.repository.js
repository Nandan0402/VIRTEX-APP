import { query } from '../config/database.js';

/**
 * Find user by username or email for authentication
 * Checks both admin_users and users
 * @param {string} identifier
 * @param {import('pg').PoolClient} [client]
 */
export async function findByUsernameOrEmail(identifier, client) {
  const cleanId = String(identifier).trim();
  const executor = client || { query };

  // 1. Check admin_users (for backward compatibility with existing bcrypt test accounts)
  try {
    const adminSql = `
      SELECT id, username, email, password_hash, full_name, role, is_active, last_login_at
      FROM admin_users
      WHERE (username = $1 OR email = $1)
      LIMIT 1;
    `;
    const adminRes = await executor.query(adminSql, [cleanId]);
    if (adminRes.rowCount > 0) {
      return adminRes.rows[0];
    }
  } catch (e) {
    // Fall through to users table
  }

  // 2. Check users table
  const userSql = `
    SELECT u.id, u.username, u.email, u.password_hash, u.full_name, u.role, u.is_active,
           u.last_login_at, r.role_code, r.permissions
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE (u.username = $1 OR u.email = $1)
    LIMIT 1;
  `;
  const userRes = await executor.query(userSql, [cleanId]);
  return userRes.rows[0] || null;
}

/**
 * Find user by ID
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function findById(id, client) {
  const executor = client || { query };

  try {
    const adminSql = `
      SELECT id, username, email, full_name, role, is_active, last_login_at, created_at
      FROM admin_users
      WHERE id = $1
      LIMIT 1;
    `;
    const adminRes = await executor.query(adminSql, [id]);
    if (adminRes.rowCount > 0) {
      return adminRes.rows[0];
    }
  } catch (e) {
    // Fall through
  }

  const userSql = `
    SELECT id, username, email, full_name, role, is_active, last_login_at, created_at
    FROM users
    WHERE id = $1
    LIMIT 1;
  `;
  const userRes = await executor.query(userSql, [id]);
  return userRes.rows[0] || null;
}

/**
 * Update user last login timestamp
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function updateLastLogin(id, client) {
  const executor = client || { query };
  try {
    await executor.query(`UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1;`, [id]);
  } catch (e) {
    // Ignored
  }
  try {
    await executor.query(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1;`, [id]);
  } catch (e) {
    // Ignored
  }
}
