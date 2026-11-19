import { query } from '../config/database.js';

/**
 * Fetch gym settings (singleton record id=1)
 * @param {import('pg').PoolClient} [client] - Optional transactional client
 */
export async function getGymSettings(client) {
  const sql = `
    SELECT id, gym_name, tagline, phone, email, address, operating_hours,
           default_language, supported_languages, speech_rate, speech_pitch,
           checkin_cooldown_minutes, updated_at
    FROM gym_settings
    WHERE id = 1
    LIMIT 1;
  `;
  const executor = client || { query };
  const result = await executor.query(sql);
  return result.rows[0] || null;
}

/**
 * Update gym settings
 * @param {Object} settings
 * @param {import('pg').PoolClient} [client]
 */
export async function updateGymSettings(settings, client) {
  const {
    gymName,
    tagline,
    phone,
    email,
    address,
    operatingHours,
    defaultLanguage,
    supportedLanguages,
    speechRate,
    speechPitch,
    checkinCooldownMinutes,
  } = settings;

  const sql = `
    UPDATE gym_settings
    SET gym_name = COALESCE($1, gym_name),
        tagline = COALESCE($2, tagline),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        address = COALESCE($5, address),
        operating_hours = COALESCE($6, operating_hours),
        default_language = COALESCE($7, default_language),
        supported_languages = COALESCE($8, supported_languages),
        speech_rate = COALESCE($9, speech_rate),
        speech_pitch = COALESCE($10, speech_pitch),
        checkin_cooldown_minutes = COALESCE($11, checkin_cooldown_minutes),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
    RETURNING *;
  `;

  const executor = client || { query };
  const result = await executor.query(sql, [
    gymName || null,
    tagline || null,
    phone || null,
    email || null,
    address || null,
    operatingHours ? JSON.stringify(operatingHours) : null,
    defaultLanguage || null,
    supportedLanguages || null,
    speechRate !== undefined ? speechRate : null,
    speechPitch !== undefined ? speechPitch : null,
    checkinCooldownMinutes !== undefined ? checkinCooldownMinutes : null,
  ]);

  // Also synchronize gym_profile table if present
  try {
    await executor.query(`
      UPDATE gym_profile
      SET gym_name = COALESCE($1, gym_name),
          tagline = COALESCE($2, tagline),
          phone = COALESCE($3, phone),
          email = COALESCE($4, email),
          address = COALESCE($5, address),
          operating_hours = COALESCE($6, operating_hours),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1;
    `, [
      gymName || null,
      tagline || null,
      phone || null,
      email || null,
      address || null,
      operatingHours ? JSON.stringify(operatingHours) : null,
    ]);
  } catch (e) {
    // Non-fatal if gym_profile is absent
  }

  return result.rows[0] || null;
}

