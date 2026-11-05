import { query } from '../config/database.js';

/**
 * Retrieve announcements
 * @param {Object} [options] - { activeOnly, priority, limit }
 * @param {import('pg').PoolClient} [client]
 */
export async function findAnnouncements({ activeOnly = false, priority, limit = 50 } = {}, client) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (activeOnly) {
    conditions.push('(is_active = TRUE AND (start_date IS NULL OR start_date <= CURRENT_DATE) AND (end_date IS NULL OR end_date >= CURRENT_DATE))');
  }

  if (priority) {
    conditions.push(`priority = $${paramIdx++}`);
    params.push(priority);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT id, title, message, priority, target_language, start_date, end_date, is_active, created_at, updated_at
    FROM announcements
    ${whereClause}
    ORDER BY 
      CASE priority 
        WHEN 'urgent' THEN 1 
        WHEN 'event' THEN 2 
        WHEN 'maintenance' THEN 3 
        ELSE 4 
      END,
      created_at DESC
    LIMIT $${paramIdx};
  `;
  params.push(limit);

  const executor = client || { query };
  const res = await executor.query(sql, params);
  return res.rows;
}

/**
 * Find announcement by ID
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function findById(id, client) {
  const sql = `
    SELECT id, title, message, priority, target_language, start_date, end_date, is_active, created_at, updated_at
    FROM announcements
    WHERE id = $1
    LIMIT 1;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [id]);
  return res.rows[0] || null;
}

/**
 * Create a new announcement
 * @param {Object} data
 * @param {import('pg').PoolClient} [client]
 */
export async function createAnnouncement(data, client) {
  const {
    title,
    message,
    priority = 'normal',
    targetLanguage = 'all',
    startDate = new Date(),
    endDate,
    createdBy,
  } = data;

  const computedEnd = endDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const sql = `
    INSERT INTO announcements (
      title, message, priority, target_language, start_date, end_date, is_active, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
    RETURNING id, title, message, priority, target_language, start_date, end_date, is_active, created_at, updated_at;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, [
    title,
    message,
    priority,
    targetLanguage,
    startDate,
    computedEnd,
    createdBy || null,
  ]);
  return res.rows[0];
}

/**
 * Update an announcement
 * @param {number} id
 * @param {Object} data
 * @param {import('pg').PoolClient} [client]
 */
export async function updateAnnouncement(id, data, client) {
  const { title, message, priority, targetLanguage, startDate, endDate, isActive } = data;

  const sql = `
    UPDATE announcements
    SET title = COALESCE($1, title),
        message = COALESCE($2, message),
        priority = COALESCE($3, priority),
        target_language = COALESCE($4, target_language),
        start_date = COALESCE($5, start_date),
        end_date = COALESCE($6, end_date),
        is_active = COALESCE($7, is_active),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $8
    RETURNING id, title, message, priority, target_language, start_date, end_date, is_active, created_at, updated_at;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, [
    title,
    message,
    priority,
    targetLanguage,
    startDate,
    endDate,
    isActive,
    id,
  ]);
  return res.rows[0] || null;
}

/**
 * Delete an announcement
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function deleteAnnouncement(id, client) {
  const sql = `
    DELETE FROM announcements
    WHERE id = $1
    RETURNING id;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [id]);
  return res.rows[0] || null;
}

