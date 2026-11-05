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

/**
 * Create a new trainer
 * @param {Object} data
 * @param {import('pg').PoolClient} [client]
 */
export async function createTrainer(data, client) {
  const {
    fullName,
    specialty,
    phone,
    email,
    bio,
    certifications,
    status = 'on_floor',
    trainerCode = `TRN${Date.now().toString().slice(-4)}`,
    shiftStart = '06:00:00',
    shiftEnd = '14:00:00',
  } = data;

  const sql = `
    INSERT INTO trainers (
      trainer_code, full_name, specialty, phone, email, bio, certifications, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, trainer_code, full_name, specialty, phone, email, bio, certifications, status, created_at;
  `;

  const executor = client || { query };
  const certs = Array.isArray(certifications)
    ? certifications
    : certifications
    ? certifications.split(',').map((c) => c.trim())
    : [];

  const res = await executor.query(sql, [
    trainerCode,
    fullName,
    specialty,
    phone,
    email || null,
    bio || null,
    certs,
    status,
  ]);
  const newTrainer = res.rows[0];

  // Insert standard shifts for Mon-Sat (1 to 6)
  if (newTrainer && shiftStart && shiftEnd) {
    for (let day = 1; day <= 6; day++) {
      await executor.query(
        `INSERT INTO trainer_schedules (trainer_id, day_of_week, shift_start, shift_end, is_available)
         VALUES ($1, $2, $3, $4, TRUE);`,
        [newTrainer.id, day, shiftStart, shiftEnd]
      );
    }
  }

  return newTrainer;
}

/**
 * Update trainer information
 * @param {number} id
 * @param {Object} data
 * @param {import('pg').PoolClient} [client]
 */
export async function updateTrainer(id, data, client) {
  const { fullName, specialty, phone, email, bio, certifications, status } = data;

  const sql = `
    UPDATE trainers
    SET full_name = COALESCE($1, full_name),
        specialty = COALESCE($2, specialty),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        bio = COALESCE($5, bio),
        certifications = COALESCE($6, certifications),
        status = COALESCE($7, status),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $8
    RETURNING id, trainer_code, full_name, specialty, phone, email, bio, certifications, status, updated_at;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, [
    fullName,
    specialty,
    phone,
    email,
    bio,
    certifications,
    status,
    id,
  ]);
  return res.rows[0] || null;
}

/**
 * Delete a trainer record
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function deleteTrainer(id, client) {
  const executor = client || { query };
  await executor.query('DELETE FROM trainer_schedules WHERE trainer_id = $1;', [id]);
  const res = await executor.query('DELETE FROM trainers WHERE id = $1 RETURNING id;', [id]);
  return res.rows[0] || null;
}


