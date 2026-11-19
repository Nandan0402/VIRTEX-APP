/**
 * measurement.repository.js - Data Access Layer for Body Measurements & Transformation
 * Integrates with PostgreSQL (gym_robot_db) member_body_measurements and
 * member_transformation_photos.
 * 
 * PRESERVATION RULE: Preserves all historical records chronologically.
 * New measurements are always inserted as new records, never overwriting previous entries.
 */

import { pool } from '../config/database.js';

/**
 * Helper to compute BMI mathematically
 */
export function calculateBmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const hM = Number(heightCm) / 100.0;
  if (hM <= 0) return null;
  return Number((Number(weightKg) / (hM * hM)).toFixed(1));
}

/**
 * Get Measurement History with Member Info
 */
export async function getBodyMeasurements({ member_id, start_date, end_date, limit = 50 } = {}) {
  let query = `
    SELECT 
      mbm.id,
      mbm.member_id,
      m.full_name AS member_name,
      m.member_code,
      mbm.weight_kg,
      mbm.height_cm,
      mbm.bmi,
      mbm.body_fat_pct,
      mbm.muscle_mass_kg,
      mbm.chest_cm,
      mbm.waist_cm,
      mbm.hips_cm,
      mbm.arms_cm,
      mbm.thighs_cm,
      mbm.calves_cm,
      mbm.shoulders_cm,
      mbm.neck_cm,
      mbm.notes,
      mbm.measured_by,
      mbm.logged_at
    FROM member_body_measurements mbm
    JOIN members m ON mbm.member_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (member_id) {
    params.push(parseInt(member_id, 10));
    query += ` AND mbm.member_id = $${params.length}`;
  }
  if (start_date) {
    params.push(start_date);
    query += ` AND mbm.logged_at >= $${params.length}`;
  }
  if (end_date) {
    params.push(end_date);
    query += ` AND mbm.logged_at <= $${params.length}`;
  }

  query += ` ORDER BY mbm.logged_at DESC, mbm.id DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query(query, params);
  return rows;
}

/**
 * Get Single Measurement Entry
 */
export async function getMeasurementById(id) {
  const query = `
    SELECT 
      mbm.*,
      m.full_name AS member_name,
      m.member_code
    FROM member_body_measurements mbm
    JOIN members m ON mbm.member_id = m.id
    WHERE mbm.id = $1
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

/**
 * Record New Body Measurement (Preserves History - Never Overwrites)
 */
export async function recordBodyMeasurement(data) {
  const heightCm = parseFloat(data.height_cm) || 175.0;
  const weightKg = parseFloat(data.weight_kg);
  const computedBmi = calculateBmi(weightKg, heightCm);

  const query = `
    INSERT INTO member_body_measurements (
      member_id, weight_kg, height_cm, bmi, body_fat_pct, muscle_mass_kg,
      chest_cm, waist_cm, hips_cm, arms_cm, thighs_cm, calves_cm, shoulders_cm, neck_cm,
      notes, measured_by, logged_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, COALESCE($17, NOW()))
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    data.member_id,
    weightKg,
    heightCm,
    computedBmi,
    data.body_fat_pct ? parseFloat(data.body_fat_pct) : null,
    data.muscle_mass_kg ? parseFloat(data.muscle_mass_kg) : null,
    data.chest_cm ? parseFloat(data.chest_cm) : null,
    data.waist_cm ? parseFloat(data.waist_cm) : null,
    data.hips_cm ? parseFloat(data.hips_cm) : null,
    data.arms_cm ? parseFloat(data.arms_cm) : null,
    data.thighs_cm ? parseFloat(data.thighs_cm) : null,
    data.calves_cm ? parseFloat(data.calves_cm) : null,
    data.shoulders_cm ? parseFloat(data.shoulders_cm) : null,
    data.neck_cm ? parseFloat(data.neck_cm) : null,
    data.notes || '',
    data.measured_by || 'Trainer',
    data.logged_at || null
  ]);
  return rows[0];
}

/**
 * Transformation Timeline with Deltas from Baseline
 */
export async function getTransformationTimeline(memberId) {
  const query = `
    SELECT *
    FROM member_body_measurements
    WHERE member_id = $1
    ORDER BY logged_at ASC;
  `;
  const { rows } = await pool.query(query, [memberId]);
  if (rows.length === 0) return { baseline: null, latest: null, timeline: [] };

  const baseline = rows[0];
  const latest = rows[rows.length - 1];

  const timelineWithDeltas = rows.map((entry, idx) => {
    const isBaseline = (idx === 0);
    return {
      ...entry,
      is_baseline: isBaseline,
      delta_weight_kg: Number((Number(entry.weight_kg) - Number(baseline.weight_kg)).toFixed(2)),
      delta_body_fat_pct: entry.body_fat_pct && baseline.body_fat_pct ? Number((Number(entry.body_fat_pct) - Number(baseline.body_fat_pct)).toFixed(1)) : null,
      delta_muscle_mass_kg: entry.muscle_mass_kg && baseline.muscle_mass_kg ? Number((Number(entry.muscle_mass_kg) - Number(baseline.muscle_mass_kg)).toFixed(2)) : null,
      delta_waist_cm: entry.waist_cm && baseline.waist_cm ? Number((Number(entry.waist_cm) - Number(baseline.waist_cm)).toFixed(1)) : null,
      delta_chest_cm: entry.chest_cm && baseline.chest_cm ? Number((Number(entry.chest_cm) - Number(baseline.chest_cm)).toFixed(1)) : null,
      delta_arms_cm: entry.arms_cm && baseline.arms_cm ? Number((Number(entry.arms_cm) - Number(baseline.arms_cm)).toFixed(1)) : null
    };
  });

  return {
    baseline,
    latest,
    totalRecords: rows.length,
    timeline: timelineWithDeltas
  };
}

/**
 * Before-and-After Photos with Member Consent Verification
 */
export async function getTransformationPhotos(memberId) {
  const query = `
    SELECT 
      mtp.id,
      mtp.member_id,
      m.full_name AS member_name,
      mtp.photo_url,
      mtp.photo_type,
      mtp.pose,
      mtp.phase,
      mtp.weight_at_photo,
      mtp.body_fat_at_photo,
      mtp.consent_given,
      mtp.consent_signature,
      mtp.caption,
      mtp.logged_at
    FROM member_transformation_photos mtp
    JOIN members m ON mtp.member_id = m.id
    WHERE mtp.member_id = $1 AND mtp.consent_given = true
    ORDER BY mtp.logged_at ASC;
  `;
  const { rows } = await pool.query(query, [memberId]);
  return rows;
}

/**
 * Add Transformation Photo with Explicit Consent
 */
export async function addTransformationPhoto(data) {
  if (!data.consent_given) {
    throw new Error('Member consent is strictly required to store transformation photographs.');
  }

  const query = `
    INSERT INTO member_transformation_photos (
      member_id, photo_url, photo_type, pose, phase, weight_at_photo, body_fat_at_photo, consent_given, consent_signature, caption, logged_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()))
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    data.member_id,
    data.photo_url,
    data.photo_type || 'progress',
    data.pose || 'Front',
    data.phase || 'Current',
    data.weight_at_photo || null,
    data.body_fat_at_photo || null,
    true,
    data.consent_signature || 'Digital Consent Verified',
    data.caption || '',
    data.logged_at || null
  ]);
  return rows[0];
}

/**
 * Monthly Comparison Report
 */
export async function getMonthlyComparisonReport(memberId) {
  const memberQuery = `SELECT id, full_name, member_code, created_at FROM members WHERE id = $1;`;
  const mRes = await pool.query(memberQuery, [memberId]);
  if (mRes.rows.length === 0) return null;
  const member = mRes.rows[0];

  const timelineData = await getTransformationTimeline(memberId);
  const photos = await getTransformationPhotos(memberId);

  const baseline = timelineData.baseline;
  const latest = timelineData.latest;

  let overallSummary = 'No historical baseline recorded yet.';
  if (baseline && latest && baseline.id !== latest.id) {
    const weightDiff = Number((Number(latest.weight_kg) - Number(baseline.weight_kg)).toFixed(1));
    const bfDiff = baseline.body_fat_pct && latest.body_fat_pct ? Number((Number(latest.body_fat_pct) - Number(baseline.body_fat_pct)).toFixed(1)) : null;
    const muscleDiff = baseline.muscle_mass_kg && latest.muscle_mass_kg ? Number((Number(latest.muscle_mass_kg) - Number(baseline.muscle_mass_kg)).toFixed(1)) : null;
    const waistDiff = baseline.waist_cm && latest.waist_cm ? Number((Number(latest.waist_cm) - Number(baseline.waist_cm)).toFixed(1)) : null;

    overallSummary = `Client achieved a net weight change of ${weightDiff > 0 ? '+' : ''}${weightDiff} kg, with ${bfDiff !== null ? `${bfDiff}% body fat change, ` : ''}${muscleDiff !== null ? `${muscleDiff > 0 ? '+' : ''}${muscleDiff} kg muscle mass change, ` : ''}and ${waistDiff !== null ? `${waistDiff} cm waist circumference reduction.` : ''}`;
  }

  return {
    member,
    baseline,
    latest,
    summaryText: overallSummary,
    timeline: timelineData.timeline,
    photos
  };
}

/**
 * Module High-Level KPIs
 */
export async function getMeasurementModuleKpis() {
  const client = await pool.connect();
  try {
    const memCountRes = await client.query(`SELECT COUNT(DISTINCT member_id) AS total_tracked_members FROM member_body_measurements;`);
    const totalLogsRes = await client.query(`SELECT COUNT(*) AS total_measurement_records FROM member_body_measurements;`);
    const photosRes = await client.query(`SELECT COUNT(*) AS total_photos_with_consent FROM member_transformation_photos WHERE consent_given = true;`);

    const avgStatsRes = await client.query(`
      SELECT 
        ROUND(AVG(weight_kg)::NUMERIC, 1) AS avg_gym_weight,
        ROUND(AVG(bmi)::NUMERIC, 1) AS avg_gym_bmi,
        ROUND(AVG(body_fat_pct)::NUMERIC, 1) AS avg_gym_body_fat,
        ROUND(AVG(muscle_mass_kg)::NUMERIC, 1) AS avg_gym_muscle_mass
      FROM member_body_measurements
      WHERE logged_at >= NOW() - INTERVAL '30 days';
    `);

    return {
      totalTrackedMembers: parseInt(memCountRes.rows[0].total_tracked_members, 10),
      totalMeasurementRecords: parseInt(totalLogsRes.rows[0].total_measurement_records, 10),
      totalPhotosWithConsent: parseInt(photosRes.rows[0].total_photos_with_consent, 10),
      averages: avgStatsRes.rows[0]
    };
  } finally {
    client.release();
  }
}


/**
 * Full measurement history for one member, newest first, with total count.
 * Used by the Member Portal (own id) and Trainer Hub (assigned client — checked by caller).
 */
export async function listMemberMeasurements(memberId, { limit, offset }) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT id, logged_at, weight_kg, height_cm, bmi, body_fat_pct, muscle_mass_kg,
              chest_cm, waist_cm, hips_cm, arms_cm, thighs_cm, calves_cm, shoulders_cm, neck_cm,
              notes, measured_by
         FROM member_body_measurements
        WHERE member_id = $1
        ORDER BY logged_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [memberId, limit, offset]
    ),
    pool.query('SELECT COUNT(*)::int AS total FROM member_body_measurements WHERE member_id = $1', [memberId]),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}
