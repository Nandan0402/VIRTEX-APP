/**
 * recovery.repository.js - Data Access Layer for Recovery & Wellness Management
 * Integrates with PostgreSQL (gym_robot_db) member_recovery_logs,
 * muscle soreness tracking, rest-day scheduling, and trainer recovery reviews.
 * 
 * DISCLAIMER: Non-medical athletic wellness and lifestyle monitoring only.
 */

import { pool } from '../config/database.js';

/**
 * Helper to compute calculated readiness indicators based on user-reported metrics.
 * Clearly separates mathematical indicators from subjective reported values.
 */
export function calculateReadinessMetrics(sleepHrs, sleepQual, energy, stress, soreness) {
  const sleepFactor = Math.min(100, (Number(sleepHrs) / 8.0) * 50 + (Number(sleepQual) / 10.0) * 50);
  const energyFactor = Number(energy) * 10;
  const stressDeduction = Number(stress) * 6;
  const sorenessDeduction = Number(soreness) * 6;

  let score = Math.round((sleepFactor * 0.4) + (energyFactor * 0.35) - (stressDeduction * 0.15) - (sorenessDeduction * 0.2) + 20);
  score = Math.max(15, Math.min(99, score));

  let fatigueIndex = Math.round(100 - score + (Number(stress) * 3));
  fatigueIndex = Math.max(10, Math.min(95, fatigueIndex));

  let status = 'Good';
  let action = 'Normal scheduled training session.';
  if (score >= 85) {
    status = 'Optimal';
    action = 'Peak nervous system readiness. Prime for high-intensity or PR attempts.';
  } else if (score >= 70) {
    status = 'Good';
    action = 'Solid physical state. Execute standard working sets and maintain form.';
  } else if (score >= 55) {
    status = 'Moderate';
    action = 'Moderate fatigue detected. Limit failure sets and hydrate frequently.';
  } else {
    status = 'Needs Recovery';
    action = 'High systemic fatigue. Active rest, sauna, light stretching recommended.';
  }

  return { score, fatigueIndex, status, action };
}

/**
 * Get Recovery Logs with Filtering
 */
export async function getRecoveryLogs({ member_id, start_date, end_date, readiness_status, limit = 30 } = {}) {
  let query = `
    SELECT 
      mrl.id,
      mrl.member_id,
      m.full_name AS member_name,
      m.member_code,
      mrl.log_date,
      mrl.sleep_hours,
      mrl.sleep_quality,
      mrl.energy_level,
      mrl.stress_level,
      mrl.hydration_liters,
      mrl.overall_soreness_rating,
      mrl.is_rest_day,
      mrl.rest_day_activity,
      mrl.readiness_score,
      mrl.fatigue_index,
      mrl.readiness_status,
      mrl.recommended_action,
      mrl.user_notes,
      mrl.logged_by,
      mrl.created_at,
      (to_jsonb(mrl) ->> 'fatigue_level')::int AS fatigue_level,   -- member-reported (migration 022)
      to_jsonb(mrl) ->> 'self_assessment' AS self_assessment       -- member's own assessment (022)
    FROM member_recovery_logs mrl
    JOIN members m ON mrl.member_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (member_id) {
    params.push(parseInt(member_id, 10));
    query += ` AND mrl.member_id = $${params.length}`;
  }
  if (start_date) {
    params.push(start_date);
    query += ` AND mrl.log_date >= $${params.length}`;
  }
  if (end_date) {
    params.push(end_date);
    query += ` AND mrl.log_date <= $${params.length}`;
  }
  if (readiness_status && readiness_status !== 'All') {
    params.push(readiness_status);
    query += ` AND mrl.readiness_status = $${params.length}`;
  }

  query += ` ORDER BY mrl.log_date DESC, mrl.id DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query(query, params);
  return rows;
}

/**
 * Get Single Recovery Log with Muscle Soreness Details
 */
export async function getRecoveryLogById(id) {
  const lQuery = `
    SELECT 
      mrl.*,
      m.full_name AS member_name,
      m.member_code
    FROM member_recovery_logs mrl
    JOIN members m ON mrl.member_id = m.id
    WHERE mrl.id = $1
  `;
  const lRes = await pool.query(lQuery, [id]);
  if (lRes.rows.length === 0) return null;
  const log = lRes.rows[0];

  const sQuery = `
    SELECT muscle_group, soreness_level, notes
    FROM member_muscle_soreness_details
    WHERE recovery_log_id = $1
    ORDER BY soreness_level DESC, muscle_group ASC
  `;
  const sRes = await pool.query(sQuery, [id]);
  log.soreness_details = sRes.rows;

  return log;
}

/**
 * Log Daily Member Recovery & Wellness
 */
export async function logMemberRecovery(logData, sorenessItems = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Defaults apply only when a value is missing/invalid — a genuine 0 (e.g. "no soreness",
    // "no sleep", "no hydration logged") is kept instead of being replaced.
    const num = (v, parse, fallback) => {
      const n = parse(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const sleepHours = num(logData.sleep_hours, parseFloat, 7.5);
    const sleepQuality = num(logData.sleep_quality, (v) => parseInt(v, 10), 7);
    const energy = num(logData.energy_level, (v) => parseInt(v, 10), 7);
    const stress = num(logData.stress_level, (v) => parseInt(v, 10), 3);
    const soreness = num(logData.overall_soreness_rating, (v) => parseInt(v, 10), 2);
    const hydration = num(logData.hydration_liters, parseFloat, 3.0);

    const { score, fatigueIndex, status, action } = calculateReadinessMetrics(
      sleepHours,
      sleepQuality,
      energy,
      stress,
      soreness
    );

    const lQuery = `
      INSERT INTO member_recovery_logs (
        member_id, log_date, sleep_hours, sleep_quality, energy_level, stress_level,
        hydration_liters, overall_soreness_rating, user_notes, is_rest_day, rest_day_activity,
        readiness_score, fatigue_index, readiness_status, recommended_action, logged_by
      )
      VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (member_id, log_date) DO UPDATE SET
        sleep_hours = EXCLUDED.sleep_hours,
        sleep_quality = EXCLUDED.sleep_quality,
        energy_level = EXCLUDED.energy_level,
        stress_level = EXCLUDED.stress_level,
        hydration_liters = EXCLUDED.hydration_liters,
        overall_soreness_rating = EXCLUDED.overall_soreness_rating,
        user_notes = EXCLUDED.user_notes,
        is_rest_day = EXCLUDED.is_rest_day,
        rest_day_activity = EXCLUDED.rest_day_activity,
        readiness_score = EXCLUDED.readiness_score,
        fatigue_index = EXCLUDED.fatigue_index,
        readiness_status = EXCLUDED.readiness_status,
        recommended_action = EXCLUDED.recommended_action
      RETURNING *;
    `;
    const lRes = await client.query(lQuery, [
      logData.member_id,
      logData.log_date || null,
      sleepHours,
      sleepQuality,
      energy,
      stress,
      hydration,
      soreness,
      logData.user_notes || '',
      logData.is_rest_day || false,
      logData.rest_day_activity || null,
      score,
      fatigueIndex,
      status,
      action,
      logData.logged_by || 'Admin'
    ]);
    const savedLog = lRes.rows[0];

    // Remove existing soreness entries if updating
    await client.query(`DELETE FROM member_muscle_soreness_details WHERE recovery_log_id = $1;`, [savedLog.id]);

    for (const item of sorenessItems) {
      if (item.muscle_group) {
        await client.query(`
          INSERT INTO member_muscle_soreness_details (recovery_log_id, muscle_group, soreness_level, notes)
          VALUES ($1, $2, $3, $4);
        `, [
          savedLog.id,
          item.muscle_group,
          parseInt(item.soreness_level, 10) || 0,
          item.notes || ''
        ]);
      }
    }

    await client.query('COMMIT');
    return savedLog;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Muscle Soreness Heatmap Data
 */
export async function getMuscleSorenessHeatmap(memberId) {
  const query = `
    WITH latest_log AS (
      SELECT id, log_date
      FROM member_recovery_logs
      WHERE member_id = $1
      ORDER BY log_date DESC
      LIMIT 1
    )
    SELECT 
      mmsd.muscle_group,
      mmsd.soreness_level,
      mmsd.notes,
      ll.log_date
    FROM latest_log ll
    JOIN member_muscle_soreness_details mmsd ON ll.id = mmsd.recovery_log_id
    ORDER BY mmsd.soreness_level DESC;
  `;
  const { rows } = await pool.query(query, [memberId]);
  return rows;
}

/**
 * Trainer Recovery Overview
 */
export async function getTrainerRecoveryOverview({ trainer_id } = {}) {
  let query = `
    SELECT 
      m.id AS member_id,
      m.full_name AS member_name,
      m.member_code,
      t.id AS trainer_id,
      t.full_name AS trainer_name,
      pta.training_goal,
      mrl.log_date AS last_logged_date,
      mrl.readiness_score,
      mrl.fatigue_index,
      mrl.readiness_status,
      mrl.sleep_hours,
      mrl.overall_soreness_rating,
      mrl.is_rest_day,
      trr.fatigue_risk_level,
      trr.trainer_advice,
      trr.review_date AS last_review_date
    FROM personal_trainer_assignments pta
    JOIN members m ON pta.member_id = m.id
    JOIN trainers t ON pta.trainer_id = t.id
    LEFT JOIN LATERAL (
      SELECT * FROM member_recovery_logs
      WHERE member_id = m.id
      ORDER BY log_date DESC
      LIMIT 1
    ) mrl ON true
    LEFT JOIN LATERAL (
      SELECT * FROM trainer_recovery_reviews
      WHERE member_id = m.id
      ORDER BY review_date DESC
      LIMIT 1
    ) trr ON true
    WHERE pta.status = 'active'
  `;
  const params = [];

  if (trainer_id && trainer_id !== 'All') {
    params.push(parseInt(trainer_id, 10));
    query += ` AND pta.trainer_id = $${params.length}`;
  }

  query += ` ORDER BY mrl.readiness_score ASC NULLS LAST`;
  const { rows } = await pool.query(query, params);
  return rows;
}

/**
 * Add Trainer Recovery Review
 */
export async function addTrainerRecoveryReview(reviewData) {
  const query = `
    INSERT INTO trainer_recovery_reviews (member_id, trainer_id, review_date, fatigue_risk_level, trainer_advice, suggested_rest_days)
    VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    reviewData.member_id,
    reviewData.trainer_id || null,
    reviewData.review_date || null,
    reviewData.fatigue_risk_level || 'Low',
    reviewData.trainer_advice,
    reviewData.suggested_rest_days || 1
  ]);
  return rows[0];
}

/**
 * Member Weekly/Monthly Recovery Longitudinal Report
 */
export async function getMemberRecoveryReport({ member_id, days = 14 }) {
  const logsQuery = `
    SELECT 
      log_date,
      sleep_hours,
      sleep_quality,
      energy_level,
      stress_level,
      overall_soreness_rating,
      hydration_liters,
      is_rest_day,
      readiness_score,
      fatigue_index,
      readiness_status
    FROM member_recovery_logs
    WHERE member_id = $1 AND log_date >= CURRENT_DATE - ($2 || ' days')::INTERVAL
    ORDER BY log_date ASC;
  `;
  const logsRes = await pool.query(logsQuery, [member_id, days]);

  const summaryQuery = `
    SELECT 
      COUNT(*) AS total_days_logged,
      COUNT(*) FILTER (WHERE is_rest_day = true) AS rest_days_count,
      COALESCE(ROUND(AVG(readiness_score)), 0) AS avg_readiness_score,
      COALESCE(ROUND(AVG(sleep_hours)::NUMERIC, 1), 0) AS avg_sleep_hours,
      COALESCE(ROUND(AVG(sleep_quality)::NUMERIC, 1), 0) AS avg_sleep_quality,
      COALESCE(ROUND(AVG(fatigue_index)), 0) AS avg_fatigue_index,
      COALESCE(ROUND(AVG(overall_soreness_rating)::NUMERIC, 1), 0) AS avg_soreness_rating
    FROM member_recovery_logs
    WHERE member_id = $1 AND log_date >= CURRENT_DATE - ($2 || ' days')::INTERVAL;
  `;
  const summaryRes = await pool.query(summaryQuery, [member_id, days]);

  return {
    summary: summaryRes.rows[0],
    dailyLogs: logsRes.rows
  };
}

/**
 * High-Level Recovery Module KPIs
 */
export async function getRecoveryModuleKpis() {
  const client = await pool.connect();
  try {
    const kpiRes = await client.query(`
      SELECT 
        COUNT(DISTINCT member_id) AS total_tracked_members,
        COALESCE(ROUND(AVG(readiness_score)), 0) AS avg_gym_readiness,
        COALESCE(ROUND(AVG(sleep_hours)::NUMERIC, 1), 0) AS avg_sleep_hours,
        COUNT(*) FILTER (WHERE is_rest_day = true AND log_date >= CURRENT_DATE - INTERVAL '7 days') AS rest_days_last_7_days,
        COUNT(*) FILTER (WHERE readiness_status = 'Optimal' AND log_date = CURRENT_DATE) AS optimal_today,
        COUNT(*) FILTER (WHERE readiness_status = 'Needs Recovery' AND log_date = CURRENT_DATE) AS needs_recovery_today
      FROM member_recovery_logs;
    `);

    const statusDistRes = await client.query(`
      SELECT readiness_status, COUNT(*) AS count
      FROM member_recovery_logs
      WHERE log_date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY readiness_status
      ORDER BY count DESC;
    `);

    const sorenessDistRes = await client.query(`
      SELECT muscle_group, ROUND(AVG(soreness_level)::NUMERIC, 1) AS avg_soreness, COUNT(*) AS reports_count
      FROM member_muscle_soreness_details mmsd
      JOIN member_recovery_logs mrl ON mmsd.recovery_log_id = mrl.id
      WHERE mrl.log_date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY muscle_group
      ORDER BY avg_soreness DESC;
    `);

    return {
      kpis: kpiRes.rows[0],
      statusDistribution: statusDistRes.rows,
      sorenessDistribution: sorenessDistRes.rows
    };
  } finally {
    client.release();
  }
}

