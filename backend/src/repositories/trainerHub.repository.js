import { query, withTransaction, checkDatabaseConnection } from '../config/database.js';

/**
 * trainerHub.repository.js
 * Trainer-scoped PostgreSQL queries for the Trainer Hub (/api/trainer/*).
 *
 * Rules:
 *  - Every query takes an explicit trainerId (resolved by trainerScope middleware)
 *    and filters on it — no cross-trainer reads or writes.
 *  - All values are bound as $n parameters. The only SQL built dynamically is the
 *    SET list of updates, assembled from fixed column whitelists (never user keys).
 *  - Uses the single shared pool via query() / withTransaction().
 */

// Tables created by database/migrations/trainer_hub/* (may not be applied yet)
export const TRAINER_HUB_TABLES = [
  'pt_assignment_history',
  'pt_packages',
  'pt_package_purchases',
  'pt_sessions',
  'pt_session_balance_ledger',
  'member_cardio_benchmarks',
  'member_progress_snapshots',
  'message_threads',
  'messages',
  'notifications',
];

let tableCache = { at: 0, present: new Set() };
const TABLE_CACHE_MS = 60 * 1000;

/** Which Trainer Hub migration tables exist (read-only catalog lookup, cached 60s). */
export async function getPresentHubTables(force = false) {
  if (!force && Date.now() - tableCache.at < TABLE_CACHE_MS) return tableCache.present;
  const res = await query(
    `SELECT t AS table_name
       FROM unnest($1::text[]) AS t
      WHERE to_regclass('public.' || t) IS NOT NULL`,
    [TRAINER_HUB_TABLES],
    { silent: true }
  );
  tableCache = { at: Date.now(), present: new Set(res.rows.map((r) => r.table_name)) };
  return tableCache.present;
}

export async function getHealth() {
  const db = await checkDatabaseConnection();
  let present = new Set();
  if (db.ok) present = await getPresentHubTables(true);
  return {
    database: db.ok ? 'connected' : 'unavailable',
    latencyMs: db.latencyMs,
    pool: db.pool,
    migrations: {
      applied: TRAINER_HUB_TABLES.every((t) => present.has(t)),
      tables: Object.fromEntries(TRAINER_HUB_TABLES.map((t) => [t, present.has(t)])),
    },
  };
}

/** Build "col = $n" pairs from a fixed whitelist; values stay parameterised. */
function buildSet(data, allowed, params) {
  const sets = [];
  for (const col of allowed) {
    if (data[col] !== undefined) {
      params.push(data[col]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  return sets;
}

// ===========================================================================
// Identity, profile, dashboard
// ===========================================================================

export async function findTrainerIdForUser(userId) {
  const res = await query(
    `SELECT id FROM trainers WHERE user_id = $1
     UNION
     SELECT trainer_id FROM users WHERE id = $1 AND trainer_id IS NOT NULL
     LIMIT 1`,
    [userId]
  );
  return res.rows[0]?.id ?? null;
}

export async function getTrainerProfile(trainerId) {
  const res = await query(
    `SELECT id, trainer_code, user_id, full_name, specialty, phone, email, bio, certifications,
            status, date_of_birth, created_at, updated_at
       FROM trainers
      WHERE id = $1`,
    [trainerId]
  );
  return res.rows[0] || null;
}

export async function getDashboardSummary(trainerId) {
  const res = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM personal_trainer_assignments WHERE trainer_id = $1 AND status = 'active') AS active_clients,
       (SELECT COUNT(*)::int FROM personal_trainer_assignments WHERE trainer_id = $1 AND status = 'paused') AS paused_clients,
       (SELECT COALESCE(SUM(fee_due), 0)::numeric(12,2)
          FROM personal_trainer_assignments WHERE trainer_id = $1 AND status = 'active') AS client_fees_due,
       (SELECT COUNT(*)::int FROM member_workout_assignments w
          WHERE w.status = 'active'
            AND w.member_id IN (SELECT member_id FROM personal_trainer_assignments
                                 WHERE trainer_id = $1 AND status = 'active')) AS active_workout_assignments,
       (SELECT COUNT(*)::int FROM member_diet_assignments d
          WHERE d.status = 'active'
            AND d.member_id IN (SELECT member_id FROM personal_trainer_assignments
                                 WHERE trainer_id = $1 AND status = 'active')) AS active_diet_assignments,
       (SELECT COUNT(*)::int FROM workout_programs WHERE trainer_id = $1) AS my_workout_programs,
       (SELECT COUNT(*)::int FROM diet_plans WHERE trainer_id = $1) AS my_diet_plans`,
    [trainerId]
  );
  return res.rows[0];
}

export async function getRecoveryAlerts(trainerId, limit = 5) {
  const res = await query(
    `SELECT r.member_id, m.full_name AS member_name, r.log_date, r.readiness_score, r.readiness_status,
            r.recommended_action
       FROM member_recovery_logs r
       JOIN members m ON m.id = r.member_id
      WHERE r.log_date >= CURRENT_DATE - 6
        AND r.readiness_status IN ('Needs Recovery', 'Moderate')
        AND r.member_id IN (SELECT member_id FROM personal_trainer_assignments
                             WHERE trainer_id = $1 AND status = 'active')
      ORDER BY r.readiness_score ASC, r.log_date DESC
      LIMIT $2`,
    [trainerId, limit]
  );
  return res.rows;
}

export async function getTodaySessions(trainerId) {
  const res = await query(
    `SELECT s.public_id, s.status, s.scheduled_start, s.scheduled_end, s.location,
            m.id AS member_id, m.full_name AS member_name
       FROM pt_sessions s
       JOIN members m ON m.id = s.member_id
      WHERE s.trainer_id = $1
        AND s.scheduled_start >= date_trunc('day', now())
        AND s.scheduled_start <  date_trunc('day', now()) + interval '1 day'
      ORDER BY s.scheduled_start`,
    [trainerId]
  );
  return res.rows;
}

// ===========================================================================
// Clients & membership checks
// ===========================================================================

export async function listClients(trainerId, { status = null, search = null, limit, offset }) {
  const params = [trainerId, status, search ? `%${search}%` : null];
  const where = `a.trainer_id = $1
        AND ($2::text IS NULL OR a.status = $2)
        AND ($3::text IS NULL OR m.full_name ILIKE $3 OR m.member_code ILIKE $3)`;
  const [rows, count] = await Promise.all([
    query(
      `SELECT a.id AS assignment_id, a.status AS assignment_status, a.start_date, a.end_date,
              a.sessions_per_week, a.preferred_slot, a.training_goal, a.payment_status,
              m.id AS member_id, m.member_code, m.full_name, m.phone, m.email,
              m.status AS member_status, m.plan_name, m.preferred_language
         FROM personal_trainer_assignments a
         JOIN members m ON m.id = a.member_id
        WHERE ${where}
        ORDER BY (a.status = 'active') DESC, m.full_name ASC
        LIMIT $4 OFFSET $5`,
      [...params, limit, offset]
    ),
    query(
      `SELECT COUNT(*)::int AS total FROM personal_trainer_assignments a JOIN members m ON m.id = a.member_id WHERE ${where}`,
      params
    ),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

/**
 * Current client (active or paused assignment) — read access to member records.
 * Ended / cancelled / reassigned assignments do NOT grant access, so reassignment
 * takes effect on the very next request. The historical rows themselves are kept.
 */
export async function isClientOfTrainer(trainerId, memberId) {
  const res = await query(
    `SELECT EXISTS (SELECT 1 FROM personal_trainer_assignments
                     WHERE trainer_id = $1 AND member_id = $2 AND status IN ('active', 'paused')) AS ok`,
    [trainerId, memberId]
  );
  return res.rows[0].ok;
}

/** Coaching feedback (existing member_trainer_comments table). */
export async function addTrainerComment(trainerId, memberId, { commentType, commentText }) {
  const res = await query(
    `INSERT INTO member_trainer_comments (member_id, trainer_id, comment_type, comment_text)
     VALUES ($1, $2, $3, $4)
     RETURNING id, member_id, comment_type, comment_text, created_at`,
    [memberId, trainerId, commentType, commentText]
  );
  return res.rows[0];
}

/** Exercise library (shared, read-only for trainers). */
export async function listExercises({ muscleGroup = null, search = null, limit, offset }) {
  const where = `($1::text IS NULL OR muscle_group ILIKE $1)
        AND ($2::text IS NULL OR name ILIKE $2 OR target_muscles ILIKE $2 OR equipment ILIKE $2)`;
  const params = [muscleGroup, search ? `%${search}%` : null];
  const [rows, count] = await Promise.all([
    query(
      `SELECT id, name, muscle_group, equipment, difficulty, instructions, target_muscles, video_url
         FROM exercises WHERE ${where}
        ORDER BY muscle_group, name LIMIT $3 OFFSET $4`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM exercises WHERE ${where}`, params),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

/** Currently ACTIVE client — required for any write on the member's behalf. */
export async function isActiveClientOfTrainer(trainerId, memberId, client) {
  const exec = client || { query };
  const res = await exec.query(
    `SELECT EXISTS (SELECT 1 FROM personal_trainer_assignments
                     WHERE trainer_id = $1 AND member_id = $2 AND status = 'active') AS ok`,
    [trainerId, memberId]
  );
  return res.rows[0].ok;
}

export async function getClientDetail(trainerId, memberId) {
  const [member, assignments, workouts, diets, recovery, measurements, profile, comments] = await Promise.all([
    query(
      `SELECT id, member_code, full_name, phone, email, status, plan_name, preferred_language,
              date_of_birth, emergency_contact_name, emergency_contact_phone, notes
         FROM members WHERE id = $1`,
      [memberId]
    ),
    query(
      `SELECT id, status, start_date, end_date, sessions_per_week, preferred_slot, training_goal,
              monthly_fee, fee_paid, fee_due, payment_status, notes
         FROM personal_trainer_assignments
        WHERE trainer_id = $1 AND member_id = $2
        ORDER BY start_date DESC`,
      [trainerId, memberId]
    ),
    query(
      `SELECT w.id, w.status, w.start_date, w.end_date, w.trainer_notes,
              p.id AS program_id, p.name AS program_name, p.goal, p.split_type
         FROM member_workout_assignments w JOIN workout_programs p ON p.id = w.program_id
        WHERE w.member_id = $1 ORDER BY w.start_date DESC LIMIT 5`,
      [memberId]
    ),
    query(
      `SELECT d.id, d.status, d.start_date, d.end_date, d.notes,
              p.id AS plan_id, p.name AS plan_name, p.goal, p.target_calories
         FROM member_diet_assignments d JOIN diet_plans p ON p.id = d.plan_id
        WHERE d.member_id = $1 ORDER BY d.start_date DESC LIMIT 5`,
      [memberId]
    ),
    query(
      `SELECT id, log_date, sleep_hours, readiness_score, readiness_status, is_rest_day
         FROM member_recovery_logs WHERE member_id = $1 ORDER BY log_date DESC LIMIT 3`,
      [memberId]
    ),
    query(
      `SELECT id, weight_kg, body_fat_pct, muscle_mass_kg, logged_at
         FROM member_body_measurements WHERE member_id = $1 ORDER BY logged_at DESC LIMIT 1`,
      [memberId]
    ),
    query(
      `SELECT fitness_goal, overall_progress_pct, workout_completion_pct, attendance_pct,
              diet_adherence_pct, recovery_status, progress_status, trainer_notes, last_updated_at
         FROM member_performance_profiles WHERE member_id = $1`,
      [memberId]
    ),
    query(
      `SELECT id, comment_type, comment_text, created_at
         FROM member_trainer_comments
        WHERE member_id = $1 AND trainer_id = $2 ORDER BY created_at DESC LIMIT 5`,
      [memberId, trainerId]
    ),
  ]);

  return {
    member: member.rows[0] || null,
    assignments: assignments.rows,
    workoutAssignments: workouts.rows,
    dietAssignments: diets.rows,
    latestRecovery: recovery.rows,
    latestMeasurement: measurements.rows[0] || null,
    performanceProfile: profile.rows[0] || null,
    trainerComments: comments.rows,
  };
}

// ===========================================================================
// PT assignments
// ===========================================================================

export async function listAssignments(trainerId, { status = null, limit, offset }) {
  const [rows, count] = await Promise.all([
    query(
      `SELECT a.id, a.status, a.start_date, a.end_date, a.sessions_per_week, a.preferred_slot,
              a.training_goal, a.monthly_fee, a.fee_paid, a.fee_due, a.payment_status, a.created_at,
              m.id AS member_id, m.member_code, m.full_name AS member_name
         FROM personal_trainer_assignments a
         JOIN members m ON m.id = a.member_id
        WHERE a.trainer_id = $1 AND ($2::text IS NULL OR a.status = $2)
        ORDER BY a.start_date DESC, a.id DESC
        LIMIT $3 OFFSET $4`,
      [trainerId, status, limit, offset]
    ),
    query(
      `SELECT COUNT(*)::int AS total FROM personal_trainer_assignments
        WHERE trainer_id = $1 AND ($2::text IS NULL OR status = $2)`,
      [trainerId, status]
    ),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

export async function getAssignment(trainerId, assignmentId, { withHistory, withPurchases }) {
  const res = await query(
    `SELECT a.*, m.member_code, m.full_name AS member_name, m.phone AS member_phone, m.email AS member_email
       FROM personal_trainer_assignments a
       JOIN members m ON m.id = a.member_id
      WHERE a.id = $1 AND a.trainer_id = $2`,
    [assignmentId, trainerId]
  );
  const assignment = res.rows[0];
  if (!assignment) return null;

  const [history, purchases] = await Promise.all([
    withHistory
      ? query(
          `SELECT change_type, old_status, new_status, old_trainer_id, new_trainer_id, changed_by_user_id, created_at
             FROM pt_assignment_history WHERE assignment_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [assignmentId]
        )
      : null,
    withPurchases
      ? query(
          `SELECT public_id, sessions_total, sessions_used, sessions_remaining, valid_from, valid_until, status
             FROM pt_package_purchases WHERE assignment_id = $1 ORDER BY created_at DESC`,
          [assignmentId]
        )
      : null,
  ]);
  return {
    ...assignment,
    history: history ? history.rows : null,
    packagePurchases: purchases ? purchases.rows : null,
  };
}

// ===========================================================================
// Schedule, availability, attendance, earnings
// ===========================================================================

export async function getSchedule(trainerId) {
  const [weekly, availability, staffShifts] = await Promise.all([
    query(
      `SELECT id, day_of_week, shift_start, shift_end, is_available, notes
         FROM trainer_schedules WHERE trainer_id = $1 ORDER BY day_of_week, shift_start`,
      [trainerId]
    ),
    query(
      `SELECT id, specific_date, start_time, end_time, is_available, reason, created_at
         FROM trainer_availability
        WHERE trainer_id = $1 AND specific_date >= CURRENT_DATE
        ORDER BY specific_date, start_time`,
      [trainerId]
    ),
    // Date-specific shifts rostered by Admin in Staff Operations (staff_shifts via trainers.user_id)
    query(
      `SELECT s.id, s.shift_date, s.shift_type, s.start_time, s.end_time, s.status, s.notes,
              b.name AS branch_name
         FROM staff_shifts s
         LEFT JOIN gym_branches b ON b.id = s.branch_id
        WHERE s.user_id = (SELECT user_id FROM trainers WHERE id = $1)
          AND s.shift_date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 60
        ORDER BY s.shift_date, s.start_time`,
      [trainerId]
    ),
  ]);
  return { weekly: weekly.rows, upcomingAvailability: availability.rows, staffShifts: staffShifts.rows };
}

/** True when staff_shifts row :shiftId belongs to :userId. */
export async function isOwnStaffShift(shiftId, userId) {
  const id = Number.parseInt(shiftId, 10);
  if (!Number.isInteger(id) || id <= 0) return false;
  const res = await query('SELECT EXISTS (SELECT 1 FROM staff_shifts WHERE id = $1 AND user_id = $2) AS ok', [id, userId]);
  return res.rows[0].ok;
}

/**
 * Admin view of Trainer Hub activity over the last :days days, one row per trainer:
 * attendance (routine_punches), client workout activity, assignments, feedback,
 * diet monitoring and member progress. Completed PT sessions are added when the
 * PT session migration is present (null otherwise).
 */
export async function getTrainerActivitySummary(days, { withPtSessions }) {
  const res = await query(
    `WITH clients AS (
       SELECT trainer_id, member_id FROM personal_trainer_assignments WHERE status = 'active'
     )
     SELECT t.id, t.trainer_code, t.full_name, t.status, t.specialty, (t.user_id IS NOT NULL) AS has_login,
            (SELECT COUNT(*) FROM personal_trainer_assignments a WHERE a.trainer_id = t.id AND a.status = 'active')::int AS active_clients,
            (SELECT COUNT(*) FROM personal_trainer_assignments a WHERE a.trainer_id = t.id AND a.status = 'paused')::int AS paused_clients,
            (SELECT COUNT(DISTINCT r.punch_date) FROM routine_punches r
              WHERE r.user_id = t.user_id AND r.punch_date >= CURRENT_DATE - $1::int)::int AS attendance_days,
            (SELECT COALESCE(SUM(r.total_work_seconds), 0) FROM routine_punches r
              WHERE r.user_id = t.user_id AND r.punch_date >= CURRENT_DATE - $1::int)::bigint AS work_seconds,
            (SELECT COUNT(*) FROM workout_session_logs l
              WHERE l.member_id IN (SELECT c.member_id FROM clients c WHERE c.trainer_id = t.id)
                AND l.completed_at >= NOW() - make_interval(days => $1::int))::int AS client_workout_sessions,
            (SELECT COUNT(*) FROM member_workout_assignments w
              WHERE w.assigned_by_trainer_id = t.id AND w.created_at >= NOW() - make_interval(days => $1::int))::int AS workouts_assigned,
            (SELECT COUNT(*) FROM member_diet_assignments d
              WHERE d.assigned_by_trainer_id = t.id AND d.created_at >= NOW() - make_interval(days => $1::int))::int AS diet_plans_assigned,
            (SELECT COUNT(*) FROM member_trainer_comments mc
              WHERE mc.trainer_id = t.id AND mc.created_at >= NOW() - make_interval(days => $1::int))::int AS feedback_given,
            (SELECT COUNT(*) FROM member_nutrition_daily_logs n
              WHERE n.member_id IN (SELECT c.member_id FROM clients c WHERE c.trainer_id = t.id)
                AND n.log_date >= CURRENT_DATE - $1::int)::int AS client_nutrition_logs,
            (SELECT ROUND(AVG(n.adherence_score)::numeric, 1) FROM member_nutrition_daily_logs n
              WHERE n.member_id IN (SELECT c.member_id FROM clients c WHERE c.trainer_id = t.id)
                AND n.log_date >= CURRENT_DATE - $1::int) AS avg_diet_adherence,
            (SELECT ROUND(AVG(p.overall_progress_pct)::numeric, 1) FROM member_performance_profiles p
              WHERE p.member_id IN (SELECT c.member_id FROM clients c WHERE c.trainer_id = t.id)) AS avg_client_progress
       FROM trainers t
      ORDER BY t.full_name`,
    [days]
  );
  const rows = res.rows.map((r) => ({ ...r, completed_pt_sessions: null }));
  if (withPtSessions && rows.length) {
    const pt = await query(
      `SELECT trainer_id, COUNT(*)::int AS completed
         FROM pt_sessions
        WHERE status = 'completed' AND completed_at >= NOW() - make_interval(days => $1::int)
        GROUP BY trainer_id`,
      [days]
    );
    const byTrainer = new Map(pt.rows.map((x) => [x.trainer_id, x.completed]));
    rows.forEach((r) => { r.completed_pt_sessions = byTrainer.get(r.id) || 0; });
  }
  return rows;
}

export async function addAvailability(trainerId, { specificDate, startTime, endTime, isAvailable, reason }) {
  const res = await query(
    `INSERT INTO trainer_availability (trainer_id, specific_date, start_time, end_time, is_available, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, specific_date, start_time, end_time, is_available, reason, created_at`,
    [trainerId, specificDate, startTime, endTime, isAvailable, reason || null]
  );
  return res.rows[0];
}

/** Trainer's punch-in history via the existing routine tracker (trainers.user_id -> routine_punches.user_id). */
export async function getAttendance(trainerId, { from = null, to = null, limit, offset }) {
  const where = `r.user_id = (SELECT user_id FROM trainers WHERE id = $1)
        AND ($2::date IS NULL OR r.punch_date >= $2)
        AND ($3::date IS NULL OR r.punch_date <= $3)`;
  const params = [trainerId, from, to];
  const [rows, count, totals] = await Promise.all([
    query(
      `SELECT r.id, r.punch_date, r.punch_in, r.punch_out, r.status,
              r.total_break_seconds, r.total_work_seconds, r.routine_notes
         FROM routine_punches r
        WHERE ${where}
        ORDER BY r.punch_date DESC, r.punch_in DESC
        LIMIT $4 OFFSET $5`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM routine_punches r WHERE ${where}`, params),
    query(
      `SELECT COUNT(DISTINCT r.punch_date)::int AS days_present,
              COALESCE(SUM(r.total_work_seconds), 0)::bigint AS total_work_seconds
         FROM routine_punches r WHERE ${where}`,
      params
    ),
  ]);
  return { rows: rows.rows, total: count.rows[0].total, totals: totals.rows[0] };
}

export async function listCommissions(trainerId) {
  const res = await query(
    `SELECT id, assignment_id, period_month, gross_revenue, commission_rate_pct,
            commission_amount, payout_status, paid_at, notes, created_at
       FROM trainer_commissions WHERE trainer_id = $1
      ORDER BY period_month DESC, id DESC`,
    [trainerId]
  );
  return res.rows;
}

// ===========================================================================
// Workout programmes (own + shared templates)
// ===========================================================================

export async function listWorkoutPrograms(trainerId, { includeTemplates, search, limit, offset }) {
  const where = `(wp.trainer_id = $1 OR ($2::boolean AND wp.trainer_id IS NULL AND wp.is_template))
        AND ($3::text IS NULL OR wp.name ILIKE $3 OR wp.goal ILIKE $3)`;
  const params = [trainerId, includeTemplates, search ? `%${search}%` : null];
  const [rows, count] = await Promise.all([
    query(
      `SELECT wp.id, wp.name, wp.trainer_id, (wp.trainer_id = $1) AS is_mine, wp.difficulty_level,
              wp.goal, wp.split_type, wp.description, wp.is_template, wp.created_at, wp.updated_at,
              (SELECT COUNT(*)::int FROM workout_program_days d WHERE d.program_id = wp.id) AS day_count,
              (SELECT COUNT(*)::int FROM workout_program_days d
                 JOIN workout_program_exercises e ON e.day_id = d.id WHERE d.program_id = wp.id) AS exercise_count
         FROM workout_programs wp
        WHERE ${where}
        ORDER BY (wp.trainer_id = $1) DESC NULLS LAST, wp.updated_at DESC NULLS LAST, wp.id DESC
        LIMIT $4 OFFSET $5`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM workout_programs wp WHERE ${where}`, params),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

export async function getProgramAccess(programId) {
  const res = await query(`SELECT id, trainer_id, is_template FROM workout_programs WHERE id = $1`, [programId]);
  return res.rows[0] || null;
}

const PROGRAM_UPDATABLE = ['name', 'difficulty_level', 'goal', 'split_type', 'description', 'is_template'];

export async function updateWorkoutProgram(trainerId, programId, data) {
  const params = [];
  const sets = buildSet(data, PROGRAM_UPDATABLE, params);
  if (sets.length === 0) return null;
  params.push(programId, trainerId);
  const res = await query(
    `UPDATE workout_programs
        SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${params.length - 1} AND trainer_id = $${params.length}
      RETURNING id, name, trainer_id, difficulty_level, goal, split_type, description, is_template, updated_at`,
    params
  );
  return res.rows[0] || null;
}

// ===========================================================================
// Diet plans (own + shared templates)
// ===========================================================================

export async function listDietPlans(trainerId, { includeTemplates, search, limit, offset }) {
  const where = `(dp.trainer_id = $1 OR ($2::boolean AND dp.trainer_id IS NULL AND dp.is_template))
        AND ($3::text IS NULL OR dp.name ILIKE $3 OR dp.goal ILIKE $3)`;
  const params = [trainerId, includeTemplates, search ? `%${search}%` : null];
  const [rows, count] = await Promise.all([
    query(
      `SELECT dp.id, dp.name, dp.trainer_id, (dp.trainer_id = $1) AS is_mine, dp.goal,
              dp.target_calories, dp.target_protein_g, dp.target_carbs_g, dp.target_fats_g,
              dp.target_water_ml, dp.description, dp.is_template, dp.created_at, dp.updated_at,
              (SELECT COUNT(*)::int FROM diet_plan_meals ml WHERE ml.plan_id = dp.id) AS meal_count
         FROM diet_plans dp
        WHERE ${where}
        ORDER BY (dp.trainer_id = $1) DESC NULLS LAST, dp.updated_at DESC NULLS LAST, dp.id DESC
        LIMIT $4 OFFSET $5`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM diet_plans dp WHERE ${where}`, params),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

export async function getDietPlanAccess(planId) {
  const res = await query(`SELECT id, trainer_id, is_template FROM diet_plans WHERE id = $1`, [planId]);
  return res.rows[0] || null;
}

const DIET_UPDATABLE = [
  'name', 'goal', 'target_calories', 'target_protein_g', 'target_carbs_g',
  'target_fats_g', 'target_water_ml', 'description', 'is_template',
];

export async function updateDietPlan(trainerId, planId, data, meals = null) {
  return withTransaction(async (client) => {
    let row = null;
    const params = [];
    const sets = buildSet(data, DIET_UPDATABLE, params);
    if (sets.length > 0) {
      params.push(planId, trainerId);
      const res = await client.query(
        `UPDATE diet_plans
            SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${params.length - 1} AND trainer_id = $${params.length}
          RETURNING id, name, trainer_id, goal, target_calories, target_protein_g, target_carbs_g,
                    target_fats_g, target_water_ml, description, is_template, updated_at`,
        params
      );
      row = res.rows[0] || null;
    } else {
      const res = await client.query(
        `UPDATE diet_plans
            SET updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND trainer_id = $2
          RETURNING id, name, trainer_id, goal, target_calories, target_protein_g, target_carbs_g,
                    target_fats_g, target_water_ml, description, is_template, updated_at`,
        [planId, trainerId]
      );
      row = res.rows[0] || null;
    }
    if (!row) return null;

    if (Array.isArray(meals)) {
      await client.query('DELETE FROM diet_plan_meals WHERE plan_id = $1', [planId]);
      for (const m of meals) {
        const mRes = await client.query(
          `INSERT INTO diet_plan_meals (plan_id, meal_type, scheduled_time, notes)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [planId, m.meal_type || 'Meal', m.scheduled_time || '08:00:00', m.notes || '']
        );
        const mealId = mRes.rows[0].id;
        if (m.items && Array.isArray(m.items)) {
          for (const item of m.items) {
            await client.query(
              `INSERT INTO diet_plan_meal_items (meal_id, food_item_id, servings, custom_portion, calories, protein_g, carbs_g, fats_g)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                mealId,
                item.food_item_id,
                item.servings || 1.0,
                item.custom_portion || '100g',
                item.calories || 0,
                item.protein_g || 0,
                item.carbs_g || 0,
                item.fats_g || 0
              ]
            );
          }
        }
      }
    }
    return row;
  });
}

// ===========================================================================
// Client performance & logs (paginated)
// ===========================================================================

export async function getClientWorkoutLogs(memberId, { from = null, to = null, limit, offset }) {
  const where = `l.member_id = $1
        AND ($2::timestamptz IS NULL OR l.completed_at >= $2)
        AND ($3::timestamptz IS NULL OR l.completed_at <  $3)`;
  const params = [memberId, from, to];
  const [rows, count] = await Promise.all([
    query(
      `SELECT l.id, l.completed_at, l.duration_minutes, l.total_volume_kg, l.rpe_rating, l.notes, l.logged_by,
              p.name AS program_name, d.day_name,
              COALESCE(json_agg(json_build_object(
                  'exercise', e.name, 'set', i.set_number, 'reps', i.reps_completed,
                  'weightKg', i.weight_kg, 'isPr', i.is_pr) ORDER BY i.id)
                FILTER (WHERE i.id IS NOT NULL), '[]') AS sets
         FROM workout_session_logs l
         LEFT JOIN workout_programs p ON p.id = l.program_id
         LEFT JOIN workout_program_days d ON d.id = l.day_id
         LEFT JOIN workout_session_items i ON i.session_log_id = l.id
         LEFT JOIN exercises e ON e.id = i.exercise_id
        WHERE ${where}
        GROUP BY l.id, p.name, d.day_name
        ORDER BY l.completed_at DESC
        LIMIT $4 OFFSET $5`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM workout_session_logs l WHERE ${where}`, params),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

export async function getClientDietLogs(memberId, { from = null, to = null, limit, offset }) {
  const where = `n.member_id = $1
        AND ($2::date IS NULL OR n.log_date >= $2)
        AND ($3::date IS NULL OR n.log_date <= $3)`;
  const params = [memberId, from, to];
  const [rows, count] = await Promise.all([
    query(
      `SELECT n.id, n.log_date, n.total_calories, n.total_protein_g, n.total_carbs_g, n.total_fats_g,
              n.water_intake_ml, n.adherence_score, n.notes, n.logged_by,
              COALESCE(json_agg(json_build_object(
                  'mealType', e.meal_type, 'food', e.food_name, 'portion', e.portion_size,
                  'calories', e.calories, 'protein_g', e.protein_g, 'carbs_g', e.carbs_g, 'fats_g', e.fats_g) ORDER BY e.id)
                FILTER (WHERE e.id IS NOT NULL), '[]') AS meals
         FROM member_nutrition_daily_logs n
         LEFT JOIN member_nutrition_meal_entries e ON e.daily_log_id = n.id
        WHERE ${where}
        GROUP BY n.id
        ORDER BY n.log_date DESC
        LIMIT $4 OFFSET $5`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM member_nutrition_daily_logs n WHERE ${where}`, params),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

export async function getClientRecoveryLogs(memberId, { from = null, to = null, limit, offset }) {
  const where = `r.member_id = $1
        AND ($2::date IS NULL OR r.log_date >= $2)
        AND ($3::date IS NULL OR r.log_date <= $3)`;
  const params = [memberId, from, to];
  const [rows, count] = await Promise.all([
    query(
      `SELECT r.id, r.log_date, r.sleep_hours, r.sleep_quality, r.energy_level, r.stress_level,
              r.hydration_liters, r.overall_soreness_rating, r.is_rest_day, r.rest_day_activity,
              r.readiness_score, r.fatigue_index, r.readiness_status, r.recommended_action, r.user_notes,
              r.logged_by,
              (to_jsonb(r) ->> 'fatigue_level')::int AS fatigue_level,   -- member-reported (migration 022)
              to_jsonb(r) ->> 'self_assessment' AS self_assessment,       -- member's own assessment (022)
              COALESCE(json_agg(json_build_object(
                  'muscleGroup', s.muscle_group, 'level', s.soreness_level, 'notes', s.notes) ORDER BY s.id)
                FILTER (WHERE s.id IS NOT NULL), '[]') AS soreness
         FROM member_recovery_logs r
         LEFT JOIN member_muscle_soreness_details s ON s.recovery_log_id = r.id
        WHERE ${where}
        GROUP BY r.id
        ORDER BY r.log_date DESC
        LIMIT $4 OFFSET $5`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM member_recovery_logs r WHERE ${where}`, params),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

export async function getClientProgress(memberId, { withCardio, withSnapshots }) {
  const [profile, strength, measurements, cardio, snapshots] = await Promise.all([
    query(
      `SELECT fitness_goal, overall_progress_pct, workout_completion_pct, attendance_pct,
              diet_adherence_pct, recovery_status, progress_status, trainer_notes, last_updated_at
         FROM member_performance_profiles WHERE member_id = $1`,
      [memberId]
    ),
    query(
      `SELECT exercise_name, weight_kg, reps, estimated_one_rep_max, logged_at
         FROM member_strength_logs WHERE member_id = $1 ORDER BY logged_at DESC LIMIT 30`,
      [memberId]
    ),
    query(
      `SELECT weight_kg, body_fat_pct, muscle_mass_kg, bmi, chest_cm, waist_cm, hips_cm, arms_cm,
              thighs_cm, logged_at
         FROM member_body_measurements WHERE member_id = $1 ORDER BY logged_at DESC LIMIT 30`,
      [memberId]
    ),
    withCardio
      ? query(
          `SELECT test_type, test_name, result_value, result_unit, distance_m, duration_seconds,
                  avg_heart_rate, recorded_at
             FROM member_cardio_benchmarks WHERE member_id = $1 ORDER BY recorded_at DESC LIMIT 30`,
          [memberId]
        )
      : null,
    withSnapshots
      ? query(
          `SELECT snapshot_date, overall_progress_pct, workout_completion_pct, attendance_pct,
                  diet_adherence_pct, weight_kg, body_fat_pct, progress_status
             FROM member_progress_snapshots WHERE member_id = $1 ORDER BY snapshot_date DESC LIMIT 52`,
          [memberId]
        )
      : null,
  ]);
  return {
    performanceProfile: profile.rows[0] || null,
    strengthLogs: strength.rows,
    bodyMeasurements: measurements.rows,
    cardioBenchmarks: cardio ? cardio.rows : null,
    progressHistory: snapshots ? snapshots.rows : null,
  };
}

// ===========================================================================
// PT sessions (migration 002)
// ===========================================================================

export async function listSessions(trainerId, { from = null, to = null, status = null, memberId = null, limit, offset }) {
  const where = `s.trainer_id = $1
        AND ($2::timestamptz IS NULL OR s.scheduled_start >= $2)
        AND ($3::timestamptz IS NULL OR s.scheduled_start <  $3)
        AND ($4::text IS NULL OR s.status = $4)
        AND ($5::int IS NULL OR s.member_id = $5)`;
  const params = [trainerId, from, to, status, memberId];
  const [rows, count] = await Promise.all([
    query(
      `SELECT s.public_id, s.status, s.scheduled_start, s.scheduled_end, s.location,
              s.completed_at, s.cancelled_at, s.cancellation_reason, s.balance_deducted, s.trainer_notes, s.member_rating, s.member_feedback,
              m.id AS member_id, m.member_code, m.full_name AS member_name,
              pp.public_id AS purchase_public_id, pp.sessions_remaining
         FROM pt_sessions s
         JOIN members m ON m.id = s.member_id
         LEFT JOIN pt_package_purchases pp ON pp.id = s.purchase_id
        WHERE ${where}
        ORDER BY s.scheduled_start ASC
        LIMIT $6 OFFSET $7`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM pt_sessions s WHERE ${where}`, params),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

/**
 * Book a PT session in one transaction:
 *  - member must be an ACTIVE client of this trainer,
 *  - optional package purchase is locked (FOR UPDATE) and must belong to the member,
 *    be active, unexpired, have sessions remaining, and not be tied to another trainer.
 * Returns { session } or { error: <code> }.
 */
export async function createSession(trainerId, data, userId) {
  return withTransaction(async (client) => {
    if (!(await isActiveClientOfTrainer(trainerId, data.memberId, client))) return { error: 'NOT_ACTIVE_CLIENT' };

    const asg = await client.query(
      `SELECT id FROM personal_trainer_assignments
        WHERE trainer_id = $1 AND member_id = $2 AND status = 'active'
        ORDER BY start_date DESC LIMIT 1`,
      [trainerId, data.memberId]
    );
    const assignmentId = asg.rows[0]?.id || null;

    let purchaseId = null;
    if (data.purchasePublicId) {
      const p = await client.query(
        `SELECT id, member_id, trainer_id, status, valid_until, sessions_remaining
           FROM pt_package_purchases WHERE public_id = $1 FOR UPDATE`,
        [data.purchasePublicId]
      );
      const pur = p.rows[0];
      if (!pur || pur.member_id !== data.memberId) return { error: 'PURCHASE_NOT_FOUND' };
      if (pur.trainer_id !== null && pur.trainer_id !== trainerId) return { error: 'PURCHASE_OTHER_TRAINER' };
      if (pur.status !== 'active') return { error: 'PURCHASE_NOT_ACTIVE' };
      if (new Date(pur.valid_until) < new Date(data.scheduledStart.slice(0, 10))) return { error: 'PURCHASE_EXPIRED' };
      if (pur.sessions_remaining <= 0) return { error: 'NO_SESSIONS_REMAINING' };
      purchaseId = pur.id;
    }

    const res = await client.query(
      `INSERT INTO pt_sessions (member_id, trainer_id, assignment_id, purchase_id, scheduled_start,
                                scheduled_end, location, status, booked_by_user_id, trainer_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'booked', $8, $9)
       RETURNING public_id, status, scheduled_start, scheduled_end, location, created_at`,
      [data.memberId, trainerId, assignmentId, purchaseId, data.scheduledStart, data.scheduledEnd,
       data.location || null, userId || null, data.notes || null]
    );
    return { session: res.rows[0] };
  });
}

/** Complete / no-show with transaction-safe balance deduction (fn_pt_complete_session). */
export async function completeSession(trainerId, sessionPublicId, { outcome, userId, chargeNoShow, trainerNotes }) {
  return withTransaction(async (client) => {
    const own = await client.query(
      `SELECT id, member_id FROM pt_sessions WHERE public_id = $1 AND trainer_id = $2 FOR UPDATE`,
      [sessionPublicId, trainerId]
    );
    if (own.rowCount === 0) return null;

    const res = await client.query(
      `SELECT public_id, status, completed_at, balance_deducted
         FROM fn_pt_complete_session($1, $2, $3, $4)`,
      [own.rows[0].id, outcome, userId, chargeNoShow]
    );
    if (trainerNotes) {
      await client.query(`UPDATE pt_sessions SET trainer_notes = $1 WHERE id = $2`, [trainerNotes, own.rows[0].id]);
    }
    return { ...res.rows[0], member_id: own.rows[0].member_id };
  });
}

// ===========================================================================
// Messaging & notifications (migrations 008 / 009)
// ===========================================================================

export async function listThreads(trainerId) {
  const res = await query(
    `SELECT t.public_id, t.status, t.last_message_at, t.created_at,
            m.id AS member_id, m.member_code, m.full_name AS member_name,
            (SELECT COUNT(*)::int FROM messages x
              WHERE x.thread_id = t.id AND x.read_at IS NULL AND x.deleted_at IS NULL
                AND x.sender_role <> 'trainer') AS unread_count
       FROM message_threads t
       JOIN members m ON m.id = t.member_id
      WHERE t.trainer_id = $1
      ORDER BY t.last_message_at DESC NULLS LAST`,
    [trainerId]
  );
  return res.rows;
}

export async function listNotifications(userId, { unreadOnly = false } = {}) {
  const res = await query(
    `SELECT public_id, type, title, body, link_url, entity_type, entity_id, read_at, created_at
       FROM notifications
      WHERE recipient_user_id = $1 AND archived_at IS NULL
        AND ($2::boolean IS FALSE OR read_at IS NULL)
      ORDER BY created_at DESC
      LIMIT 100`,
    [userId, unreadOnly]
  );
  return res.rows;
}

export async function markNotificationRead(userId, notificationPublicId) {
  const res = await query(
    `UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE public_id = $1 AND recipient_user_id = $2
      RETURNING public_id, read_at`,
    [notificationPublicId, userId]
  );
  return res.rows[0] || null;
}

/** Classes this trainer instructs (Admin class calendar + online classes): read-only for trainers. */
export async function listInstructorClasses(trainerId, { from, to }) {
  const res = await query(
    `SELECT oc.id, oc.title, oc.category, oc.class_type, oc.scheduled_at, oc.duration_mins, oc.max_participants, oc.status,
            (oc.stream_url IS NOT NULL AND oc.stream_url <> '') AS has_link,
            COUNT(r.id) FILTER (WHERE r.status IN ('registered', 'attended'))::int AS booked,
            COUNT(r.id) FILTER (WHERE r.attended IS TRUE OR r.status = 'attended')::int AS attended
       FROM online_classes oc
       LEFT JOIN class_registrations r ON r.class_id = oc.id
      WHERE oc.instructor_trainer_id = $1
        AND (oc.class_type = 'vod_recorded' OR (oc.scheduled_at >= $2 AND oc.scheduled_at < $3))
      GROUP BY oc.id
      ORDER BY oc.scheduled_at ASC`,
    [trainerId, from, to]
  );
  return res.rows;
}

/** Trainers currently assigned to a member (active or paused — the same rule as isClientOfTrainer). */
export async function getAssignedTrainerIds(memberId) {
  const res = await query(
    `SELECT DISTINCT ON (a.trainer_id) a.trainer_id, t.full_name AS trainer_name, t.specialty
       FROM personal_trainer_assignments a JOIN trainers t ON t.id = a.trainer_id
      WHERE a.member_id = $1 AND a.status IN ('active', 'paused')
      ORDER BY a.trainer_id, (a.status = 'active') DESC`,
    [memberId]
  );
  return res.rows;
}
