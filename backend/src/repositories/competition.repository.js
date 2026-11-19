/**
 * competition.repository.js - Data Access Layer for Events & Fitness Competitions
 * Integrates with PostgreSQL (gym_robot_db) fitness_competitions,
 * competition_participants, and competition_certificates.
 * 
 * DISTINCT FROM CALENDAR: Focuses on athletic meets, rep challenges,
 * scorecards, leaderboards, rankings, and award certificates.
 */

import { pool } from '../config/database.js';

/**
 * Get Competitions with Filtering
 */
export async function getCompetitions({ type, status, search } = {}) {
  let query = `
    SELECT 
      fc.id,
      fc.title,
      fc.type,
      fc.description,
      fc.start_date,
      fc.end_date,
      fc.registration_deadline,
      fc.status,
      fc.organizer_trainer_id,
      t.full_name AS organizer_name,
      fc.metric_type,
      fc.prize_pool,
      fc.rules,
      fc.banner_url,
      fc.is_outdoor,
      fc.outdoor_details,
      (SELECT to_jsonb(x) ->> 'icon' FROM fitness_competitions x WHERE x.id = fc.id) AS icon, -- works before and after migration 029
      fc.created_at,
      COUNT(DISTINCT cp.id) AS participants_count,
      COUNT(DISTINCT cp.id) FILTER (WHERE cp.is_winner = true) AS winners_count
    FROM fitness_competitions fc
    LEFT JOIN trainers t ON fc.organizer_trainer_id = t.id
    LEFT JOIN competition_participants cp ON fc.id = cp.competition_id
    WHERE 1=1
  `;
  const params = [];

  if (type && type !== 'All') {
    params.push(type);
    if (type === 'Outdoor Games') {
      query += ` AND (fc.type = $${params.length} OR fc.is_outdoor = true)`;
    } else {
      query += ` AND fc.type = $${params.length}`;
    }
  }
  if (status && status !== 'All') {
    params.push(status);
    query += ` AND fc.status = $${params.length}`;
  }
  if (search && search.trim() !== '') {
    params.push(`%${search.trim()}%`);
    query += ` AND (fc.title ILIKE $${params.length} OR fc.description ILIKE $${params.length} OR fc.prize_pool ILIKE $${params.length})`;
  }

  query += ` GROUP BY fc.id, t.full_name, fc.is_outdoor, fc.outdoor_details ORDER BY fc.start_date DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getCompetitionById(id) {
  const query = `
    SELECT 
      fc.*,
      t.full_name AS organizer_name,
      t.specialty AS organizer_specialty
    FROM fitness_competitions fc
    LEFT JOIN trainers t ON fc.organizer_trainer_id = t.id
    WHERE fc.id = $1
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

export async function createCompetition(data) {
  const isOutdoor = Boolean(data.is_outdoor || data.type === 'Outdoor Games');
  const outdoorDetails = typeof data.outdoor_details === 'object' && data.outdoor_details !== null
    ? JSON.stringify(data.outdoor_details)
    : (data.outdoor_details || '{}');

  const query = `
    INSERT INTO fitness_competitions (
      title, type, description, start_date, end_date, registration_deadline,
      status, organizer_trainer_id, metric_type, prize_pool, rules, banner_url,
      is_outdoor, outdoor_details
    )
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'upcoming'), $8, $9, $10, $11, $12, $13, $14::jsonb)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    data.title,
    data.type,
    data.description,
    data.start_date,
    data.end_date,
    data.registration_deadline || null,
    data.status || 'upcoming',
    data.organizer_trainer_id || null,
    data.metric_type || 'Max Repetitions',
    data.prize_pool || '',
    data.rules || '',
    data.banner_url || '',
    isOutdoor,
    outdoorDetails
  ]);
  return rows[0];
}

export async function updateCompetitionStatus(id, status) {
  const query = `
    UPDATE fitness_competitions
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [status, id]);
  return rows[0];
}

/**
 * Participant Management & Registration
 */
export async function getParticipants({ competition_id, member_id, status } = {}) {
  let query = `
    SELECT 
      cp.id,
      cp.competition_id,
      fc.title AS competition_title,
      fc.metric_type,
      cp.member_id,
      m.full_name AS member_name,
      m.member_code,
      m.phone,
      cp.registration_date,
      cp.status,
      cp.division,
      cp.score,
      cp.score_unit,
      cp.rank_position,
      cp.is_winner,
      cp.verified_by_trainer_id,
      t.full_name AS verified_by_trainer_name,
      cp.trainer_notes
    FROM competition_participants cp
    JOIN fitness_competitions fc ON cp.competition_id = fc.id
    JOIN members m ON cp.member_id = m.id
    LEFT JOIN trainers t ON cp.verified_by_trainer_id = t.id
    WHERE 1=1
  `;
  const params = [];

  if (competition_id) {
    params.push(parseInt(competition_id, 10));
    query += ` AND cp.competition_id = $${params.length}`;
  }
  if (member_id) {
    params.push(parseInt(member_id, 10));
    query += ` AND cp.member_id = $${params.length}`;
  }
  if (status && status !== 'All') {
    params.push(status);
    query += ` AND cp.status = $${params.length}`;
  }

  query += ` ORDER BY cp.rank_position ASC NULLS LAST, cp.score DESC NULLS LAST, cp.registration_date ASC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function registerParticipant(data) {
  const query = `
    INSERT INTO competition_participants (
      competition_id, member_id, division, status, score_unit
    )
    VALUES ($1, $2, COALESCE($3, 'Open'), 'registered', COALESCE($4, 'reps'))
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    data.competition_id,
    data.member_id,
    data.division || 'Open',
    data.score_unit || 'reps'
  ]);
  return rows[0];
}

/**
 * Submit Score & Re-Rank Leaderboard
 */
export async function submitScore(participantId, score, verifiedByTrainerId, notes) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update the participant's score
    const uRes = await client.query(`
      UPDATE competition_participants
      SET 
        score = $1,
        status = 'completed',
        verified_by_trainer_id = $2,
        trainer_notes = $3
      WHERE id = $4
      RETURNING competition_id;
    `, [score, verifiedByTrainerId || null, notes || '', participantId]);

    if (uRes.rows.length === 0) {
      throw new Error('Participant not found.');
    }
    const competitionId = uRes.rows[0].competition_id;

    // Recalculate ranks for all completed participants in this competition
    const rankedRes = await client.query(`
      SELECT id, score
      FROM competition_participants
      WHERE competition_id = $1 AND score IS NOT NULL
      ORDER BY score DESC;
    `, [competitionId]);

    for (let i = 0; i < rankedRes.rows.length; i++) {
      const p = rankedRes.rows[i];
      const rank = i + 1;
      const isWinner = (rank <= 3); // Top 3 are podium winners
      await client.query(`
        UPDATE competition_participants
        SET rank_position = $1, is_winner = $2
        WHERE id = $3;
      `, [rank, isWinner, p.id]);
    }

    await client.query('COMMIT');
    return { success: true, competitionId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get Leaderboard for a Specific Competition
 */
export async function getLeaderboard(competitionId) {
  const query = `
    SELECT 
      cp.id,
      cp.rank_position,
      cp.is_winner,
      cp.member_id,
      m.full_name AS member_name,
      m.member_code,
      cp.division,
      cp.score,
      cp.score_unit,
      cp.trainer_notes,
      t.full_name AS verified_by
    FROM competition_participants cp
    JOIN members m ON cp.member_id = m.id
    LEFT JOIN trainers t ON cp.verified_by_trainer_id = t.id
    WHERE cp.competition_id = $1 AND cp.score IS NOT NULL
    ORDER BY cp.rank_position ASC, cp.score DESC;
  `;
  const { rows } = await pool.query(query, [competitionId]);
  return rows;
}

/**
 * Awards & Verifiable Digital Certificates
 */
export async function issueCertificate(data) {
  const code = `VX-CERT-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
  const query = `
    INSERT INTO competition_certificates (
      competition_id, member_id, certificate_code, award_title, rank_awarded, issued_by
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    data.competition_id,
    data.member_id,
    code,
    data.award_title,
    data.rank_awarded || null,
    data.issued_by || 'Virtex Athletics'
  ]);
  return rows[0];
}

export async function getCertificates({ member_id, competition_id } = {}) {
  let query = `
    SELECT 
      cc.id,
      cc.certificate_code,
      cc.award_title,
      cc.rank_awarded,
      cc.issued_at,
      cc.issued_by,
      cc.competition_id,
      fc.title AS competition_title,
      fc.type AS competition_type,
      cc.member_id,
      m.full_name AS member_name,
      m.member_code
    FROM competition_certificates cc
    JOIN fitness_competitions fc ON cc.competition_id = fc.id
    JOIN members m ON cc.member_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (member_id) {
    params.push(parseInt(member_id, 10));
    query += ` AND cc.member_id = $${params.length}`;
  }
  if (competition_id) {
    params.push(parseInt(competition_id, 10));
    query += ` AND cc.competition_id = $${params.length}`;
  }

  query += ` ORDER BY cc.issued_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

/**
 * Module KPIs
 */
export async function getCompetitionModuleKpis() {
  const client = await pool.connect();
  try {
    const totalComps = await client.query(`SELECT COUNT(*) AS total_competitions FROM fitness_competitions;`);
    const activeComps = await client.query(`SELECT COUNT(*) AS active_competitions FROM fitness_competitions WHERE status IN ('upcoming', 'in_progress');`);
    const liveComps = await client.query(`SELECT COUNT(*) AS live_competitions FROM fitness_competitions WHERE status = 'in_progress';`);
    const totalParticipants = await client.query(`SELECT COUNT(*) AS total_participants FROM competition_participants;`);
    const totalCerts = await client.query(`SELECT COUNT(*) AS total_certificates FROM competition_certificates;`);

    const typeDistribution = await client.query(`
      SELECT type, COUNT(*) AS count
      FROM fitness_competitions
      GROUP BY type
      ORDER BY count DESC;
    `);

    return {
      totalCompetitions: parseInt(totalComps.rows[0].total_competitions, 10),
      activeCompetitions: parseInt(activeComps.rows[0].active_competitions, 10),
      liveCompetitions: parseInt(liveComps.rows[0].live_competitions, 10), // in progress only ("Live now")
      totalParticipants: parseInt(totalParticipants.rows[0].total_participants, 10),
      totalCertificatesIssued: parseInt(totalCerts.rows[0].total_certificates, 10),
      typeDistribution: typeDistribution.rows
    };
  } finally {
    client.release();
  }
}


/**
 * Edit every field of a competition (Events → ✏️ Edit). Returns the updated row or null.
 */
export async function updateCompetition(id, data) {
  const isOutdoor = Boolean(data.is_outdoor || data.type === 'Outdoor Games');
  const { rows } = await pool.query(
    `UPDATE fitness_competitions
        SET title = $2, type = $3, description = $4, start_date = $5, end_date = $6, registration_deadline = $7,
            status = COALESCE($8, status), organizer_trainer_id = $9, metric_type = $10, prize_pool = $11, rules = $12,
            banner_url = $13, is_outdoor = $14, outdoor_details = $15::jsonb, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, data.title, data.type, data.description, data.start_date, data.end_date, data.registration_deadline || null,
      data.status || null, data.organizer_trainer_id || null, data.metric_type, data.prize_pool || '', data.rules || '',
      data.banner_url || '', isOutdoor, JSON.stringify(isOutdoor ? (data.outdoor_details || {}) : {})]
  );
  return rows[0] || null;
}

/**
 * Delete a competition. Its participants and certificates are removed with it (ON DELETE CASCADE), so a full
 * copy of all three is written to auth_audit_logs (event COMPETITION_DELETED) first, in the same transaction.
 */
export async function deleteCompetition(id, admin = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const comp = (await client.query('SELECT * FROM fitness_competitions WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!comp) { await client.query('ROLLBACK'); return null; }
    const participants = (await client.query('SELECT * FROM competition_participants WHERE competition_id = $1', [id])).rows;
    const certificates = (await client.query('SELECT * FROM competition_certificates WHERE competition_id = $1', [id])).rows;
    await client.query(
      `INSERT INTO auth_audit_logs (user_id, username, event_type, role, details) VALUES ($1, $2, 'COMPETITION_DELETED', $3, $4)`,
      [admin.id || null, String(admin.username || 'admin').slice(0, 50), admin.role || null, { competition: comp, participants, certificates }]
    );
    await client.query('DELETE FROM fitness_competitions WHERE id = $1', [id]);
    await client.query('COMMIT');
    return { id: comp.id, title: comp.title, participants: participants.length, certificates: certificates.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- competition icon (migration 029)
let iconReady = { at: 0, ok: false };
export async function iconAvailable() {
  if (Date.now() - iconReady.at < 60000) return iconReady.ok;
  const { rows } = await pool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'fitness_competitions' AND column_name = 'icon') AS ok`);
  iconReady = { at: Date.now(), ok: rows[0].ok };
  return iconReady.ok;
}

/** Save the chosen icon (null = automatic icon). No-op before migration 029. Returns the icon now stored. */
export async function setCompetitionIcon(id, icon) {
  if (!(await iconAvailable())) return undefined;
  const { rows } = await pool.query('UPDATE fitness_competitions SET icon = $2 WHERE id = $1 RETURNING icon', [id, icon || null]);
  return rows[0] ? rows[0].icon : undefined;
}
