import { query } from '../config/database.js';
import bcrypt from 'bcryptjs';

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
      t.date_of_birth,
      t.user_id,
      u.username as login_username,
      s.shift_start, 
      s.shift_end
    FROM trainers t
    LEFT JOIN users u ON t.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT shift_start, shift_end 
      FROM trainer_schedules 
      WHERE trainer_id = t.id 
        AND day_of_week = EXTRACT(DOW FROM CURRENT_TIMESTAMP)::smallint
      ORDER BY shift_start ASC
      LIMIT 1
    ) s ON true
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
    SELECT id, trainer_code, full_name, specialty, phone, email, bio, certifications, status, date_of_birth, user_id, created_at
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
 * Create a new trainer with optional credentials provisioning for login
 * @param {Object} data
 * @param {import('pg').PoolClient} [client]
 */
export async function createTrainer(data, client) {
  const {
    fullName,
    specialty,
    phone,
    email,
    password,
    username,
    bio,
    certifications,
    status = 'on_floor',
    dateOfBirth,
    trainerCode = `TRN${Date.now().toString().slice(-4)}`,
    shiftStart = '06:00:00',
    shiftEnd = '14:00:00',
  } = data;

  const sql = `
    INSERT INTO trainers (
      trainer_code, full_name, specialty, phone, email, bio, certifications, status, date_of_birth
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, trainer_code, full_name, specialty, phone, email, bio, certifications, status, date_of_birth, user_id, created_at;
  `;

  const executor = client || { query };
  const certs = Array.isArray(certifications)
    ? certifications
    : certifications
      ? certifications.split(',').map((c) => c.trim())
      : [];

  const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;

  const res = await executor.query(sql, [
    trainerCode,
    fullName,
    specialty,
    phone,
    cleanEmail,
    bio || null,
    certs,
    status,
    dateOfBirth || null,
  ]);
  const newTrainer = res.rows[0];

  // Insert standard shifts for Mon-Sat (1 to 6)
  if (newTrainer && shiftStart && shiftEnd) {
    for (let day = 1; day <= 6; day++) {
      await executor.query(
        `INSERT INTO trainer_schedules (trainer_id, day_of_week, shift_start, shift_end, is_available)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT DO NOTHING;`,
        [newTrainer.id, day, shiftStart, shiftEnd]
      ).catch(() => { });
    }
  }

  // Provision / link User login account if email is provided
  if (newTrainer && cleanEmail) {
    try {
      const userRes = await executor.query('SELECT id, username, role, trainer_id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1;', [cleanEmail]);
      let linkedUserId = null;
      let finalUsername = '';
      const existing = userRes.rows[0];
      // Only an unlinked TRAINER login may be adopted. Owner/manager/member logins with the same email are never
      // converted or re-passworded (that would hand someone else's account to the coach).
      const adoptable = existing && String(existing.role || '').toLowerCase() === 'trainer'
        && (existing.trainer_id === null || Number(existing.trainer_id) === Number(newTrainer.id));

      if (existing && !adoptable) {
        newTrainer.user_account_note = `The email ${cleanEmail} already belongs to another ${existing.role || 'user'} account, so no trainer login was created and that account was not changed. Edit the coach with a different email to give them a login.`;
      } else if (existing) {
        linkedUserId = userRes.rows[0].id;
        finalUsername = userRes.rows[0].username;
        if (password && password.trim()) {
          const passHash = bcrypt.hashSync(password.trim(), 10);
          await executor.query(
            `UPDATE users 
             SET password_hash = $1, 
                 role = 'trainer', 
                 role_id = COALESCE((SELECT id FROM roles WHERE role_code = 'trainer'), role_id),
                 trainer_id = $2,
                 phone = COALESCE($3, phone),
                 full_name = COALESCE($4, full_name)
             WHERE id = $5;`,
            [passHash, newTrainer.id, phone || null, fullName, linkedUserId]
          );
        } else {
          await executor.query('UPDATE users SET trainer_id = $1 WHERE id = $2;', [newTrainer.id, linkedUserId]);
        }
      } else if (password && password.trim()) {
        let baseUser = (username || cleanEmail.split('@')[0] || 'coach').toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (baseUser.length < 3) baseUser = 'coach_' + baseUser;
        let candidateUser = baseUser;
        let attempt = 0;
        while (attempt < 5) {
          const check = await executor.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1);', [candidateUser]);
          if (check.rowCount === 0) break;
          attempt++;
          candidateUser = `${baseUser}_${Math.floor(100 + Math.random() * 900)}`;
        }
        finalUsername = candidateUser;

        const passHash = bcrypt.hashSync(password.trim(), 10);
        const insUser = await executor.query(
          `INSERT INTO users (username, email, password_hash, full_name, role, role_id, phone, is_active, trainer_id)
           VALUES ($1, $2, $3, $4, 'trainer', (SELECT id FROM roles WHERE role_code = 'trainer'), $5, TRUE, $6)
           RETURNING id, username;`,
          [finalUsername, cleanEmail, passHash, fullName, phone || null, newTrainer.id]
        );
        if (insUser.rowCount > 0) {
          linkedUserId = insUser.rows[0].id;
        }
      }

      if (linkedUserId) {
        await executor.query('UPDATE trainers SET user_id = $1 WHERE id = $2;', [linkedUserId, newTrainer.id]);
        newTrainer.user_id = linkedUserId;
        if (password && password.trim()) {
          newTrainer.user_account = {
            username: finalUsername,
            email: cleanEmail,
            password: password.trim(),
            role: 'trainer',
            loginUrl: '/trainer-auth.html',
          };
        }
      }
    } catch (authErr) {
      console.warn('[TrainerRepo] Could not auto-provision user account for trainer:', authErr.message);
      newTrainer.user_account_note = 'The coach was saved, but their login could not be created. Edit the coach and set the password again.';
    }
  }

  return newTrainer;
}

/**
 * Update trainer information, including updating/resetting login password
 * @param {number} id
 * @param {Object} data
 * @param {import('pg').PoolClient} [client]
 */
export async function updateTrainer(id, data, client) {
  const { fullName, specialty, phone, email, bio, certifications, status, dateOfBirth, password, username } = data;

  const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;

  const sql = `
    UPDATE trainers
    SET full_name = COALESCE($1, full_name),
        specialty = COALESCE($2, specialty),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        bio = COALESCE($5, bio),
        certifications = COALESCE($6, certifications),
        status = COALESCE($7, status),
        date_of_birth = COALESCE($8, date_of_birth),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $9
    RETURNING id, trainer_code, full_name, specialty, phone, email, bio, certifications, status, date_of_birth, user_id, updated_at;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, [
    fullName,
    specialty,
    phone,
    cleanEmail,
    bio,
    certifications,
    status,
    dateOfBirth,
    id,
  ]);
  const updated = res.rows[0] || null;

  if (updated) {
    const targetEmail = cleanEmail || (updated.email || '').trim().toLowerCase();

    // Check if password update/provisioning requested
    if (password && password.trim()) {
      const passHash = bcrypt.hashSync(password.trim(), 10);
      try {
        // Never move this coach's login onto an email that another account already uses.
        let emailForLogin = targetEmail || null;
        if (updated.user_id && emailForLogin) {
          const clash = await executor.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1;', [emailForLogin, updated.user_id]);
          if (clash.rowCount > 0) {
            emailForLogin = null;
            updated.user_account_note = `The password was updated, but the login email was not changed because ${targetEmail} already belongs to another account.`;
          }
        }
        if (updated.user_id) {
          await executor.query(
            `UPDATE users 
             SET password_hash = $1,
                 email = COALESCE($2, email),
                 phone = COALESCE($3, phone),
                 full_name = COALESCE($4, full_name),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5;`,
            [passHash, emailForLogin, phone || null, fullName || null, updated.user_id]
          );
          const uRes = await executor.query('SELECT username, email FROM users WHERE id = $1;', [updated.user_id]);
          updated.user_account = {
            username: uRes.rows[0]?.username || 'coach',
            email: uRes.rows[0]?.email || targetEmail,
            password: password.trim(),
            updated: true,
            loginUrl: '/trainer-auth.html',
          };
        } else if (targetEmail) {
          const existingUser = await executor.query('SELECT id, username, role, trainer_id FROM users WHERE LOWER(email) = LOWER($1);', [targetEmail]);
          const ex = existingUser.rows[0];
          const adoptable = ex && String(ex.role || '').toLowerCase() === 'trainer'
            && (ex.trainer_id === null || Number(ex.trainer_id) === Number(updated.id));
          if (ex && !adoptable) {
            updated.user_account_note = `The email ${targetEmail} already belongs to another ${ex.role || 'user'} account, so no trainer login was set up and that account was not changed. Use a different email for this coach.`;
          } else if (existingUser.rowCount > 0) {
            const uid = existingUser.rows[0].id;
            await executor.query(
              `UPDATE users 
               SET password_hash = $1,
                   role = 'trainer',
                   role_id = COALESCE((SELECT id FROM roles WHERE role_code = 'trainer'), role_id),
                   trainer_id = $2
               WHERE id = $3;`,
              [passHash, updated.id, uid]
            );
            await executor.query('UPDATE trainers SET user_id = $1 WHERE id = $2;', [uid, updated.id]);
            updated.user_id = uid;
            updated.user_account = {
              username: existingUser.rows[0].username,
              email: targetEmail,
              password: password.trim(),
              updated: true,
              loginUrl: '/trainer-auth.html',
            };
          } else {
            let baseUser = (username || targetEmail.split('@')[0] || 'coach').toLowerCase().replace(/[^a-z0-9_]/g, '');
            if (baseUser.length < 3) baseUser = 'coach_' + baseUser;
            const insUser = await executor.query(
              `INSERT INTO users (username, email, password_hash, full_name, role, role_id, phone, is_active, trainer_id)
               VALUES ($1, $2, $3, $4, 'trainer', (SELECT id FROM roles WHERE role_code = 'trainer'), $5, TRUE, $6)
               RETURNING id, username;`,
              [baseUser, targetEmail, passHash, fullName || updated.full_name, phone || null, updated.id]
            );
            if (insUser.rowCount > 0) {
              const uid = insUser.rows[0].id;
              await executor.query('UPDATE trainers SET user_id = $1 WHERE id = $2;', [uid, updated.id]);
              updated.user_id = uid;
              updated.user_account = {
                username: insUser.rows[0].username,
                email: targetEmail,
                password: password.trim(),
                updated: true,
                loginUrl: '/trainer-auth.html',
              };
            }
          }
        }
      } catch (authErr) {
        console.warn('[TrainerRepo] Could not update trainer user credentials:', authErr.message);
        delete updated.user_account;
        updated.user_account_note = 'The coach was saved, but the login password could not be updated. Please try again.';
      }
    }
  }

  return updated;
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


