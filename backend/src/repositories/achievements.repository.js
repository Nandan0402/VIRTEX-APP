/**
 * achievements.repository.js — read-only queries behind member-achievements.html.
 * Every query is scoped to ONE member id and parameterised. Nothing here writes or awards.
 */
import { query } from '../config/database.js';

/** The Nth workout session for each milestone N the member has actually reached. */
export async function getWorkoutMilestones(memberId, thresholds) {
  const res = await query(
    `SELECT n, completed_at, logged_by, total FROM (
        SELECT ROW_NUMBER() OVER (ORDER BY completed_at, id) AS n, completed_at, logged_by,
               COUNT(*) OVER () AS total
          FROM workout_session_logs WHERE member_id = $1
     ) s
     WHERE n = ANY($2::int[]) OR n = total
     ORDER BY n`,
    [memberId, thresholds]
  );
  return res.rows;
}

/** Workout sessions by who logged them (for the source label). */
export async function getWorkoutLoggers(memberId) {
  const res = await query(
    `SELECT COALESCE(logged_by, 'Unknown') AS logged_by, COUNT(*)::int AS n
       FROM workout_session_logs WHERE member_id = $1 GROUP BY 1`,
    [memberId]
  );
  return res.rows;
}

/** The Nth gym check-in for each milestone reached (recorded by the check-in system). */
export async function getCheckInMilestones(memberId, thresholds) {
  const res = await query(
    `SELECT n, check_in_time, check_in_method, total FROM (
        SELECT ROW_NUMBER() OVER (ORDER BY check_in_time, id) AS n, check_in_time, check_in_method,
               COUNT(*) OVER () AS total
          FROM check_ins WHERE member_id = $1
     ) c
     WHERE n = ANY($2::int[]) OR n = total
     ORDER BY n`,
    [memberId, thresholds]
  );
  return res.rows;
}

/** Strength records in time order: best set per exercise per session + staff strength logs. */
export async function getStrengthRecords(memberId) {
  const res = await query(
    `SELECT exercise_name, weight_kg, reps, logged_at, source, logged_by FROM (
        SELECT DISTINCT ON (i.session_log_id, i.exercise_id)
               e.name AS exercise_name, i.weight_kg, i.reps_completed AS reps, l.completed_at AS logged_at,
               'workout' AS source, l.logged_by
          FROM workout_session_items i
          JOIN workout_session_logs l ON l.id = i.session_log_id
          JOIN exercises e ON e.id = i.exercise_id
         WHERE l.member_id = $1 AND i.weight_kg > 0
         ORDER BY i.session_log_id, i.exercise_id, i.weight_kg DESC, i.reps_completed DESC NULLS LAST
      ) w
     UNION ALL
     SELECT exercise_name, weight_kg, reps, logged_at, 'strength_log' AS source, 'Staff' AS logged_by
       FROM member_strength_logs WHERE member_id = $1 AND weight_kg > 0
     ORDER BY logged_at ASC`,
    [memberId]
  );
  return res.rows;
}

/** Competition / challenge participation with any certificate issued for it. */
export async function getCompetitionEntries(memberId) {
  const res = await query(
    `SELECT p.id, p.status, p.division, p.score, p.score_unit, p.rank_position, p.is_winner,
            p.verified_by_trainer_id, vt.full_name AS verified_by, p.registration_date,
            c.id AS competition_id, c.title, c.type, c.metric_type, c.start_date, c.end_date, c.status AS competition_status,
            cc.certificate_code, cc.award_title, cc.rank_awarded, cc.issued_at, cc.issued_by
       FROM competition_participants p
       JOIN fitness_competitions c ON c.id = p.competition_id
       LEFT JOIN trainers vt ON vt.id = p.verified_by_trainer_id
       LEFT JOIN competition_certificates cc ON cc.competition_id = p.competition_id AND cc.member_id = p.member_id
      WHERE p.member_id = $1
      ORDER BY COALESCE(c.end_date, c.start_date) DESC NULLS LAST, p.id DESC`,
    [memberId]
  );
  return res.rows;
}

/** Course enrolments with any certificate issued. */
export async function getCourses(memberId) {
  const res = await query(
    `SELECT e.id, e.status, e.progress_pct, e.lessons_completed, e.total_lessons, e.quiz_passed, e.completed_at,
            c.id AS course_id, c.title, c.category, c.level,
            cc.certificate_code, cc.issued_at, cc.issued_by, cc.grade_score, cc.certificate_url
       FROM course_enrolments e
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN course_certificates cc ON cc.course_id = e.course_id AND cc.member_id = e.member_id
      WHERE e.member_id = $1
      ORDER BY COALESCE(cc.issued_at, e.completed_at, e.enrolled_at) DESC`,
    [memberId]
  );
  return res.rows;
}

/** Transformation records: consented photos by phase + measurement tracking span. */
export async function getTransformation(memberId) {
  const [photos, meas] = await Promise.all([
    query(
      `SELECT phase, MIN(logged_at) AS first_at, COUNT(*)::int AS n
         FROM member_transformation_photos
        WHERE member_id = $1 AND consent_given IS TRUE
        GROUP BY phase ORDER BY MIN(logged_at)`,
      [memberId]
    ),
    query(
      `SELECT logged_at, measured_by FROM member_body_measurements WHERE member_id = $1 ORDER BY logged_at ASC LIMIT 2000`,
      [memberId]
    ),
  ]);
  return { photoPhases: photos.rows, measurements: meas.rows };
}

export async function getMemberName(memberId) {
  const res = await query('SELECT full_name, member_code FROM members WHERE id = $1', [memberId]);
  return res.rows[0] || null;
}
