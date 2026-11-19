/**
 * progressReport.repository.js — read-only queries behind the member progress report.
 *
 * Every query is scoped to ONE member id and parameterised. Nothing here writes.
 * Shared by the Member Portal (own record), Trainer Hub (assigned clients only — checked
 * by the caller) and the Admin performance centre (owner / manager only — checked by the router).
 */
import { query } from '../config/database.js';

const DAYS = 400; // look-back window: 12 monthly reports + margin

/** Completed workout sessions with per-session totals. */
export async function getSessions(memberId) {
  const res = await query(
    `SELECT l.id, l.program_id, l.completed_at, l.duration_minutes, l.total_volume_kg,
            (date_trunc('week', l.completed_at))::date AS week_start,
            (date_trunc('month', l.completed_at))::date AS month_start
       FROM workout_session_logs l
      WHERE l.member_id = $1 AND l.completed_at >= NOW() - ($2 || ' days')::interval
      ORDER BY l.completed_at ASC`,
    [memberId, String(DAYS)]
  );
  return res.rows;
}

/**
 * Strength data points: best set per exercise per session (from logged workouts) and
 * every member_strength_logs row. Estimated 1RM uses the stored value when present,
 * otherwise the Epley formula on the recorded weight × reps.
 */
export async function getStrengthPoints(memberId) {
  const res = await query(
    `SELECT exercise_name, weight_kg, reps, e1rm, logged_at, source FROM (
        SELECT DISTINCT ON (i.session_log_id, i.exercise_id)
               e.name AS exercise_name, i.weight_kg, i.reps_completed AS reps,
               ROUND(i.weight_kg * (1 + COALESCE(i.reps_completed, 1) / 30.0), 1) AS e1rm,
               l.completed_at AS logged_at, 'workout' AS source
          FROM workout_session_items i
          JOIN workout_session_logs l ON l.id = i.session_log_id
          JOIN exercises e ON e.id = i.exercise_id
         WHERE l.member_id = $1 AND i.weight_kg IS NOT NULL AND i.weight_kg > 0
         ORDER BY i.session_log_id, i.exercise_id,
                  i.weight_kg * (1 + COALESCE(i.reps_completed, 1) / 30.0) DESC
      ) w
     UNION ALL
     SELECT exercise_name, weight_kg, reps,
            COALESCE(estimated_one_rep_max, ROUND(weight_kg * (1 + COALESCE(reps, 1) / 30.0), 1)) AS e1rm,
            logged_at, 'strength_log' AS source
       FROM member_strength_logs
      WHERE member_id = $1 AND weight_kg IS NOT NULL AND weight_kg > 0
     ORDER BY logged_at ASC`,
    [memberId]
  );
  return res.rows;
}

/** Body weight / composition history (oldest first). */
export async function getWeightHistory(memberId) {
  const res = await query(
    `SELECT logged_at, weight_kg, body_fat_pct, muscle_mass_kg, bmi, measured_by
       FROM member_body_measurements
      WHERE member_id = $1 AND weight_kg IS NOT NULL
      ORDER BY logged_at ASC`,
    [memberId]
  );
  return res.rows;
}

/** Cardio benchmarks — only called when the Trainer Hub table exists. */
export async function getCardio(memberId) {
  const res = await query(
    `SELECT test_type, test_name, result_value, result_unit, distance_m, duration_seconds,
            avg_heart_rate, recorded_at
       FROM member_cardio_benchmarks
      WHERE member_id = $1
      ORDER BY recorded_at ASC`,
    [memberId]
  );
  return res.rows;
}

/** Gym check-ins in the look-back window. */
export async function getCheckIns(memberId) {
  const res = await query(
    `SELECT check_in_time,
            (date_trunc('week', check_in_time))::date AS week_start,
            (date_trunc('month', check_in_time))::date AS month_start
       FROM check_ins
      WHERE member_id = $1 AND check_in_time >= NOW() - ($2 || ' days')::interval`,
    [memberId, String(DAYS)]
  );
  return res.rows;
}

/** Active workout programme assignment (latest) with its number of programme days. */
export async function getActiveProgramme(memberId) {
  const res = await query(
    `SELECT a.id AS assignment_id, a.program_id, a.start_date, a.end_date, a.status,
            p.name AS program_name, p.goal AS program_goal, p.split_type,
            (SELECT COUNT(*)::int FROM workout_program_days d WHERE d.program_id = p.id) AS program_days
       FROM member_workout_assignments a
       JOIN workout_programs p ON p.id = a.program_id
      WHERE a.member_id = $1 AND a.status = 'active'
        AND COALESCE(p.description, '') NOT LIKE 'TRAINER_MUSCLE_PLAN:%'   -- trainer-only coach muscle plan is never the member's programme
      ORDER BY a.start_date DESC, a.id DESC
      LIMIT 1`,
    [memberId]
  );
  return res.rows[0] || null;
}

/** Goal text recorded by staff: performance profile + PT assignment goal. */
export async function getGoals(memberId) {
  const [profile, pt] = await Promise.all([
    query(
      `SELECT fitness_goal, progress_status, trainer_notes, last_updated_at
         FROM member_performance_profiles WHERE member_id = $1`,
      [memberId]
    ),
    // Same rule Trainer Hub uses for access (active or paused assignment).
    query(
      `SELECT a.training_goal, a.status, t.full_name AS trainer_name
         FROM personal_trainer_assignments a JOIN trainers t ON t.id = a.trainer_id
        WHERE a.member_id = $1 AND a.status IN ('active', 'paused')
        ORDER BY (a.status = 'active') DESC, a.start_date DESC LIMIT 1`,
      [memberId]
    ),
  ]);
  return { profile: profile.rows[0] || null, pt: pt.rows[0] || null };
}

/** Current calendar week / month starts as the database sees them (same clock as the data). */
export async function getPeriodAnchors() {
  const res = await query(
    `SELECT (date_trunc('week', NOW()))::date AS this_week, (date_trunc('month', NOW()))::date AS this_month,
            CURRENT_DATE AS today`
  );
  return res.rows[0];
}
