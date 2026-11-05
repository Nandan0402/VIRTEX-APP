import { query } from '../config/database.js';

/**
 * Find trainers with optional status filter
 * @param {Object} [filter] - { status }
 * @param {import('pg').PoolClient} [client]
 */
export async function findTrainers({ status } = {}, client) {
  const params = [];
  let statusClause = '';

  if (status) {
    statusClause = 'WHERE t.status = $1';
    params.push(status);
  }

  const sql = `
    SELECT 
      t.id, 
      t.trainer_code, 
      t.full_name, 
      t.specialty, 
      t.phone, 
      t.email, 
      t.bio, 
      t.certifications, 
      t.status,
      s.shift_start, 
      s.shift_end
    FROM trainers t
    LEFT JOIN trainer_schedules s 
      ON t.id = s.trainer_id 
      AND s.day_of_week = EXTRACT(DOW FROM CURRENT_TIMESTAMP)::smallint
    ${statusClause}
    ORDER BY 
      CASE t.status 
        WHEN 'on_floor' THEN 1 
        WHEN 'in_session' THEN 2 
        ELSE 3 
      END,
      t.full_name ASC;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, params);
  return res.rows;
}

/**
 * Find trainer by ID
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function findTrainerById(id, client) {
  const sql = `
    SELECT id, trainer_code, full_name, specialty, phone, email, bio, certifications, status, user_id, created_at
    FROM trainers
    WHERE id = $1
    LIMIT 1;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [id]);
  return res.rows[0] || null;
}

/**
 * Find weekly schedules for a trainer
 * @param {number} trainerId
 * @param {import('pg').PoolClient} [client]
 */
export async function findTrainerSchedules(trainerId, client) {
  const sql = `
    SELECT id, trainer_id, day_of_week, shift_start, shift_end, is_available
    FROM trainer_schedules
    WHERE trainer_id = $1
    ORDER BY day_of_week ASC;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [trainerId]);
  return res.rows;
}

/**
 * Update trainer on-floor status
 * @param {number} id
 * @param {string} status - 'on_floor' | 'in_session' | 'off_duty'
 * @param {import('pg').PoolClient} [client]
 */
export async function updateTrainerStatus(id, status, client) {
  const sql = `
    UPDATE trainers
    SET status = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING id, trainer_code, full_name, status, updated_at;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [status, id]);
  return res.rows[0] || null;
}

