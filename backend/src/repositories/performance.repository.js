/**
 * performance.repository.js - Data Access Layer for Client Performance Center
 * Connects to PostgreSQL (gym_robot_db) querying actual member records,
 * body measurements, strength progression, and trainer evaluations.
 */

import { query } from '../config/database.js';

export const performanceRepository = {
  /**
   * Fetch all members formatted as Performance Cards with actual progression metrics
   */
  async getPerformanceCards({ search = '', trainerId = null, goal = '', status = '' } = {}) {
    let sql = `
      SELECT 
        m.id AS member_id,
        m.member_code,
        m.full_name,
        m.phone,
        m.email,
        m.plan_name,
        m.status AS membership_status,
        m.date_of_birth,
        m.created_at AS member_joined_at,
        p.id AS profile_id,
        COALESCE(p.fitness_goal, 'General Fitness') AS fitness_goal,
        p.overall_progress_pct,
        p.workout_completion_pct,
        p.attendance_pct,
        p.diet_adherence_pct,
        p.recovery_status,
        COALESCE(p.progress_status, 'insufficient_data') AS progress_status,
        p.trainer_notes,
        p.consent_photos,
        p.last_updated_at,
        t.id AS trainer_id,
        t.trainer_code,
        t.full_name AS trainer_name,
        t.specialty AS trainer_specialty,
        (
          SELECT json_build_object(
            'initial_weight', (SELECT weight_kg FROM member_body_measurements WHERE member_id = m.id ORDER BY logged_at ASC LIMIT 1),
            'latest_weight', (SELECT weight_kg FROM member_body_measurements WHERE member_id = m.id ORDER BY logged_at DESC LIMIT 1),
            'initial_body_fat', (SELECT body_fat_pct FROM member_body_measurements WHERE member_id = m.id ORDER BY logged_at ASC LIMIT 1),
            'latest_body_fat', (SELECT body_fat_pct FROM member_body_measurements WHERE member_id = m.id ORDER BY logged_at DESC LIMIT 1),
            'total_measurements_logged', (SELECT COUNT(*) FROM member_body_measurements WHERE member_id = m.id)
          )
        ) AS body_stats_summary,
        (
          SELECT json_build_object(
            'total_strength_logs', (SELECT COUNT(*) FROM member_strength_logs WHERE member_id = m.id),
            'top_exercise', (SELECT exercise_name FROM member_strength_logs WHERE member_id = m.id ORDER BY estimated_one_rep_max DESC LIMIT 1),
            'top_1rm_kg', (SELECT estimated_one_rep_max FROM member_strength_logs WHERE member_id = m.id ORDER BY estimated_one_rep_max DESC LIMIT 1)
          )
        ) AS strength_summary,
        (
          SELECT COUNT(*) FROM check_ins WHERE member_id = m.id
        ) AS total_checkins_count
      FROM members m
      LEFT JOIN member_performance_profiles p ON m.id = p.member_id
      LEFT JOIN trainers t ON p.assigned_trainer_id = t.id OR t.id = (
        SELECT trainer_id FROM personal_trainer_assignments WHERE member_id = m.id AND status = 'active' LIMIT 1
      )
      WHERE 1=1
    `;

    const params = [];
    let idx = 1;

    if (search) {
      sql += ` AND (m.full_name ILIKE $${idx} OR m.member_code ILIKE $${idx} OR m.phone ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    if (trainerId) {
      sql += ` AND (t.id = $${idx})`;
      params.push(trainerId);
      idx++;
    }

    if (goal) {
      sql += ` AND (p.fitness_goal ILIKE $${idx})`;
      params.push(`%${goal}%`);
      idx++;
    }

    if (status) {
      sql += ` AND (p.progress_status = $${idx})`;
      params.push(status);
      idx++;
    }

    sql += ` ORDER BY 
      CASE p.progress_status 
        WHEN 'on_track' THEN 1 
        WHEN 'improving' THEN 2 
        WHEN 'needs_attention' THEN 3 
        ELSE 4 
      END, m.id ASC;`;

    const res = await query(sql, params);
    return res.rows;
  },

  /**
   * Fetch detailed member performance records (for modal analytics & charts)
   */
  async getMemberPerformanceDetails(memberId) {
    // 1. Member Base Profile & Performance Header
    const profSql = `
      SELECT 
        m.id AS member_id,
        m.member_code,
        m.full_name,
        m.phone,
        m.email,
        m.plan_name,
        m.status AS membership_status,
        m.date_of_birth,
        m.created_at AS member_joined_at,
        p.id AS profile_id,
        COALESCE(p.fitness_goal, 'General Fitness') AS fitness_goal,
        p.overall_progress_pct,
        p.workout_completion_pct,
        p.attendance_pct,
        p.diet_adherence_pct,
        p.recovery_status,
        COALESCE(p.progress_status, 'insufficient_data') AS progress_status,
        p.trainer_notes,
        p.consent_photos,
        p.last_updated_at,
        t.id AS trainer_id,
        t.trainer_code,
        t.full_name AS trainer_name,
        t.specialty AS trainer_specialty
      FROM members m
      LEFT JOIN member_performance_profiles p ON m.id = p.member_id
      LEFT JOIN trainers t ON p.assigned_trainer_id = t.id OR t.id = (
        SELECT trainer_id FROM personal_trainer_assignments WHERE member_id = m.id AND status = 'active' LIMIT 1
      )
      WHERE m.id = $1;
    `;
    const profRes = await query(profSql, [memberId]);
    if (profRes.rows.length === 0) return null;
    const profile = profRes.rows[0];

    // 2. Strength Logs Timeline
    const strengthSql = `
      SELECT id, exercise_name, weight_kg, reps, estimated_one_rep_max, logged_at
      FROM member_strength_logs
      WHERE member_id = $1
      ORDER BY logged_at ASC;
    `;
    const strengthRes = await query(strengthSql, [memberId]);

    // 3. Body Measurements Timeline
    const bodySql = `
      SELECT id, weight_kg, body_fat_pct, muscle_mass_kg, chest_cm, waist_cm, arms_cm, thighs_cm, notes, logged_at
      FROM member_body_measurements
      WHERE member_id = $1
      ORDER BY logged_at ASC;
    `;
    const bodyRes = await query(bodySql, [memberId]);

    // 4. Transformation Photos Timeline (Only with consent)
    const photoSql = `
      SELECT id, photo_url, photo_type, consent_given, caption, logged_at
      FROM member_transformation_photos
      WHERE member_id = $1 AND consent_given = true
      ORDER BY logged_at ASC;
    `;
    const photoRes = await query(photoSql, [memberId]);

    // 5. Trainer Review Comments
    const commentSql = `
      SELECT c.id, c.comment_type, c.comment_text, c.created_at, t.full_name AS trainer_name, t.specialty
      FROM member_trainer_comments c
      LEFT JOIN trainers t ON c.trainer_id = t.id
      WHERE c.member_id = $1
      ORDER BY c.created_at DESC;
    `;
    const commentRes = await query(commentSql, [memberId]);

    // 6. Recent Check-ins
    const checkinSql = `
      SELECT id, check_in_time, check_in_method
      FROM check_ins
      WHERE member_id = $1
      ORDER BY check_in_time DESC
      LIMIT 10;
    `;
    const checkinRes = await query(checkinSql, [memberId]);

    return {
      profile,
      strengthLogs: strengthRes.rows,
      bodyMeasurements: bodyRes.rows,
      transformationPhotos: photoRes.rows,
      trainerComments: commentRes.rows,
      recentCheckins: checkinRes.rows,
    };
  },

  /**
   * Log new strength measurement
   */
  async addStrengthLog({ memberId, exerciseName, weightKg, reps }) {
    // Epley formula: 1RM = Weight * (1 + Reps / 30)
    const e1rm = reps === 1 ? weightKg : parseFloat((weightKg * (1 + reps / 30)).toFixed(2));
    const sql = `
      INSERT INTO member_strength_logs (member_id, exercise_name, weight_kg, reps, estimated_one_rep_max, logged_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *;
    `;
    const res = await query(sql, [memberId, exerciseName, weightKg, reps, e1rm]);
    
    // Update profile last_updated_at
    await query('UPDATE member_performance_profiles SET last_updated_at = NOW() WHERE member_id = $1;', [memberId]);
    return res.rows[0];
  },

  /**
   * Log new body measurements
   */
  async addBodyMeasurement({ memberId, weightKg, bodyFatPct, muscleMassKg, chestCm, waistCm, armsCm, thighsCm, notes }) {
    const sql = `
      INSERT INTO member_body_measurements (
        member_id, weight_kg, body_fat_pct, muscle_mass_kg, chest_cm, waist_cm, arms_cm, thighs_cm, notes, logged_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *;
    `;
    const res = await query(sql, [memberId, weightKg, bodyFatPct, muscleMassKg, chestCm, waistCm, armsCm, thighsCm, notes]);
    await query('UPDATE member_performance_profiles SET last_updated_at = NOW() WHERE member_id = $1;', [memberId]);
    return res.rows[0];
  },

  /**
   * Add coaching feedback comment
   */
  async addTrainerComment({ memberId, trainerId, commentType, commentText }) {
    const sql = `
      INSERT INTO member_trainer_comments (member_id, trainer_id, comment_type, comment_text, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING *;
    `;
    const res = await query(sql, [memberId, trainerId, commentType, commentText]);
    return res.rows[0];
  },
};

