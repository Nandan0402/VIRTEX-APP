import crypto from 'crypto';
import { query, withTransaction } from '../config/database.js';

/**
 * memberPortal.repository.js — queries for /api/member/*.
 * Every function takes the caller's own memberId (from memberScope) and filters on it.
 * Paginated log reads reuse trainerHub.repository (they are keyed by member id).
 */

export async function getProfile(memberId) {
  const res = await query(
    `SELECT id, member_code, full_name, phone, email, status, plan_name, preferred_language,
            date_of_birth, emergency_contact_name, emergency_contact_phone,
            fee_amount, fee_paid, fee_due, fee_due_date, payment_status, created_at
       FROM members WHERE id = $1`,
    [memberId]
  );
  return res.rows[0] || null;
}

/** Current trainer (active/paused assignment) with public trainer details. */
export async function getAssignedTrainer(memberId) {
  const res = await query(
    `SELECT a.id AS assignment_id, a.status AS assignment_status, a.start_date, a.end_date,
            a.sessions_per_week, a.preferred_slot, a.training_goal,
            a.monthly_fee, a.fee_paid, a.fee_due, a.payment_status,
            t.id AS trainer_id, t.full_name AS trainer_name, t.specialty, t.bio,
            t.certifications, t.status AS floor_status, t.email AS trainer_email,
            t.trainer_code, t.created_at AS trainer_since, a.created_at AS assigned_at,
            u.avatar_url AS trainer_avatar_url
       FROM personal_trainer_assignments a
       JOIN trainers t ON t.id = a.trainer_id
       LEFT JOIN users u ON u.id = t.user_id
      WHERE a.member_id = $1 AND a.status IN ('active', 'paused')
      ORDER BY (a.status = 'active') DESC, a.start_date DESC`,
    [memberId]
  );
  return res.rows;
}

// Exercises a trainer assigns from the muscle-recovery view live in a hidden "Coach muscle plan" programme
// (description TRAINER_MUSCLE_PLAN:<member>:<trainer>). They are for the TRAINER only and never shown to the member.
const NOT_COACH_PLAN = `COALESCE(p.description, '') NOT LIKE 'TRAINER_MUSCLE_PLAN:%'`;

export async function listWorkoutAssignments(memberId) {
  const res = await query(
    `SELECT w.id, w.status, w.start_date, w.end_date, w.trainer_notes, w.program_id,
            p.name AS program_name, p.goal, p.split_type, p.difficulty_level,
            t.full_name AS assigned_by
       FROM member_workout_assignments w
       JOIN workout_programs p ON p.id = w.program_id
       LEFT JOIN trainers t ON t.id = w.assigned_by_trainer_id
      WHERE w.member_id = $1 AND ${NOT_COACH_PLAN}
      ORDER BY (w.status = 'active') DESC, w.start_date DESC
      LIMIT 50`,
    [memberId]
  );
  return res.rows;
}

export async function listDietAssignments(memberId) {
  const res = await query(
    `SELECT d.id, d.status, d.start_date, d.end_date, d.notes, d.plan_id,
            p.name AS plan_name, p.goal, p.target_calories, p.target_protein_g,
            p.target_carbs_g, p.target_fats_g, p.target_water_ml,
            t.full_name AS assigned_by
       FROM member_diet_assignments d
       JOIN diet_plans p ON p.id = d.plan_id
       LEFT JOIN trainers t ON t.id = d.assigned_by_trainer_id
      WHERE d.member_id = $1
      ORDER BY (d.status = 'active') DESC, d.start_date DESC
      LIMIT 50`,
    [memberId]
  );
  return res.rows;
}

/** Member may log against a programme only if it is actively assigned to them. */
export async function hasActiveProgram(memberId, programId) {
  const res = await query(
    `SELECT EXISTS (SELECT 1 FROM member_workout_assignments w JOIN workout_programs p ON p.id = w.program_id
                     WHERE w.member_id = $1 AND w.program_id = $2 AND w.status = 'active' AND ${NOT_COACH_PLAN}) AS ok`,
    [memberId, programId]
  );
  return res.rows[0].ok;
}

export async function dayBelongsToProgram(dayId, programId) {
  const res = await query(
    `SELECT EXISTS (SELECT 1 FROM workout_program_days WHERE id = $1 AND program_id = $2) AS ok`,
    [dayId, programId]
  );
  return res.rows[0].ok;
}

export async function listFeedback(memberId, { limit, offset, type = null }) {
  const [rows, count] = await Promise.all([
    query(
      `SELECT c.id, c.comment_type, c.comment_text, c.created_at, c.trainer_id, t.full_name AS trainer_name
         FROM member_trainer_comments c
         LEFT JOIN trainers t ON t.id = c.trainer_id
        WHERE c.member_id = $1 AND ($4::text IS NULL OR c.comment_type = $4)
        ORDER BY c.created_at DESC
        LIMIT $2 OFFSET $3`,
      [memberId, limit, offset, type]
    ),
    query(`SELECT COUNT(*)::int AS total FROM member_trainer_comments WHERE member_id = $1 AND ($2::text IS NULL OR comment_type = $2)`, [memberId, type]),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

/** Own PT schedule (migration trainer_hub/002). */
export async function listPtSessions(memberId, { from = null, to = null, limit, offset }) {
  const where = `s.member_id = $1
        AND ($2::timestamptz IS NULL OR s.scheduled_start >= $2)
        AND ($3::timestamptz IS NULL OR s.scheduled_start <  $3)`;
  const params = [memberId, from, to];
  const [rows, count] = await Promise.all([
    query(
      `SELECT s.public_id, s.status, s.scheduled_start, s.scheduled_end, s.location, s.completed_at,
              s.cancelled_at, s.cancellation_reason, s.member_rating, s.member_feedback,
              t.full_name AS trainer_name, pp.sessions_remaining
         FROM pt_sessions s
         LEFT JOIN trainers t ON t.id = s.trainer_id
         LEFT JOIN pt_package_purchases pp ON pp.id = s.purchase_id
        WHERE ${where}
        ORDER BY s.scheduled_start ASC
        LIMIT $4 OFFSET $5`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM pt_sessions s WHERE ${where}`, params),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

// ===========================================================================
// Member dashboard (read-only). Every query is filtered on the caller's memberId.
// ===========================================================================

/** Latest membership period (memberships) with its plan name. */
export async function getCurrentMembership(memberId) {
  const res = await query(
    `SELECT ms.id, ms.status, ms.start_date, ms.end_date, ms.payment_status, ms.auto_renew,
            mp.name AS plan_name, mp.duration_months,
            (ms.end_date - CURRENT_DATE)::int AS days_remaining
       FROM memberships ms
       LEFT JOIN membership_plans mp ON mp.id = ms.plan_id
      WHERE ms.member_id = $1
      ORDER BY (ms.status = 'active') DESC, ms.end_date DESC NULLS LAST, ms.id DESC
      LIMIT 1`,
    [memberId]
  );
  return res.rows[0] || null;
}

/** Workout sessions logged: last 7 / 30 days and the most recent one. */
export async function getWorkoutActivity(memberId) {
  const res = await query(
    `SELECT COUNT(*) FILTER (WHERE completed_at >= NOW() - INTERVAL '7 days')::int  AS sessions_7d,
            COUNT(*) FILTER (WHERE completed_at >= NOW() - INTERVAL '30 days')::int AS sessions_30d,
            MAX(completed_at) AS last_completed_at
       FROM workout_session_logs WHERE member_id = $1`,
    [memberId]
  );
  return res.rows[0];
}

/** Day of :programId most recently logged by the member (null if none). */
export async function getLastLoggedDay(memberId, programId) {
  const res = await query(
    `SELECT l.day_id, d.day_number, d.day_name, l.completed_at
       FROM workout_session_logs l
       LEFT JOIN workout_program_days d ON d.id = l.day_id
      WHERE l.member_id = $1 AND l.program_id = $2 AND l.day_id IS NOT NULL
      ORDER BY l.completed_at DESC
      LIMIT 1`,
    [memberId, programId]
  );
  return res.rows[0] || null;
}

/** Today's nutrition log totals (null if nothing logged today). */
export async function getTodayNutrition(memberId) {
  const res = await query(
    `SELECT id, log_date, total_calories, total_protein_g, total_carbs_g, total_fats_g,
            water_intake_ml, adherence_score
       FROM member_nutrition_daily_logs
      WHERE member_id = $1 AND log_date = CURRENT_DATE
      LIMIT 1`,
    [memberId]
  );
  return res.rows[0] || null;
}

/** Gym check-ins (check_ins): last 30 days, this month, last visit, recent list. */
export async function getAttendance(memberId) {
  const [summary, recent] = await Promise.all([
    query(
      `SELECT COUNT(DISTINCT check_in_time::date) FILTER (WHERE check_in_time >= NOW() - INTERVAL '30 days')::int AS days_30d,
              COUNT(DISTINCT check_in_time::date) FILTER (WHERE date_trunc('month', check_in_time) = date_trunc('month', NOW()))::int AS days_this_month,
              MAX(check_in_time) AS last_check_in
         FROM check_ins WHERE member_id = $1`,
      [memberId]
    ),
    query(
      `SELECT check_in_time, check_in_method FROM check_ins
        WHERE member_id = $1 ORDER BY check_in_time DESC LIMIT 5`,
      [memberId]
    ),
  ]);
  return { ...summary.rows[0], recent: recent.rows };
}

/** Upcoming online classes (gym-wide schedule) with this member's registration flag. */
export async function getUpcomingClasses(memberId, limit = 5) {
  const res = await query(
    `SELECT c.id, c.title, c.category, c.class_type, c.scheduled_at, c.duration_mins, c.difficulty, c.status,
            t.full_name AS instructor_name,
            EXISTS (SELECT 1 FROM class_registrations r
                     WHERE r.class_id = c.id AND r.member_id = $1
                       AND COALESCE(r.status, '') NOT IN ('cancelled')) AS registered
       FROM online_classes c
       LEFT JOIN trainers t ON t.id = c.instructor_trainer_id
      WHERE c.scheduled_at >= NOW()
        AND COALESCE(c.status, '') NOT IN ('cancelled', 'completed', 'ended')
      ORDER BY c.scheduled_at ASC
      LIMIT $2`,
    [memberId, limit]
  );
  return res.rows;
}

/** Body-weight series for the progress chart (oldest -> newest, last 12 entries). */
export async function getWeightSeries(memberId, limit = 12) {
  const res = await query(
    `SELECT logged_at, weight_kg FROM (
        SELECT logged_at, weight_kg FROM member_body_measurements
         WHERE member_id = $1 AND weight_kg IS NOT NULL
         ORDER BY logged_at DESC LIMIT $2) s
      ORDER BY logged_at ASC`,
    [memberId, limit]
  );
  return res.rows;
}

/** Recent activity across the member's own logs and check-ins (newest first). */
export async function getRecentActivity(memberId, limit = 8) {
  const res = await query(
    `SELECT * FROM (
        SELECT 'workout' AS kind, l.completed_at AS at,
               COALESCE(p.name, 'Workout') || COALESCE(' · ' || d.day_name, '') AS title,
               l.duration_minutes::text || ' min' AS detail
          FROM workout_session_logs l
          LEFT JOIN workout_programs p ON p.id = l.program_id
          LEFT JOIN workout_program_days d ON d.id = l.day_id
         WHERE l.member_id = $1
        UNION ALL
        SELECT 'nutrition', n.log_date::timestamptz, 'Nutrition log',
               COALESCE(n.total_calories::text || ' kcal', '') FROM member_nutrition_daily_logs n WHERE n.member_id = $1
        UNION ALL
        SELECT 'recovery', r.log_date::timestamptz, 'Recovery check-in',
               COALESCE('readiness ' || r.readiness_score::text, '') FROM member_recovery_logs r WHERE r.member_id = $1
        UNION ALL
        SELECT 'measurement', m.logged_at, 'Body measurement',
               COALESCE(m.weight_kg::text || ' kg', '') FROM member_body_measurements m WHERE m.member_id = $1
        UNION ALL
        SELECT 'check_in', c.check_in_time, 'Gym check-in', COALESCE(c.check_in_method, '') FROM check_ins c WHERE c.member_id = $1
      ) a
      WHERE a.at IS NOT NULL
      ORDER BY a.at DESC
      LIMIT $2`,
    [memberId, limit]
  );
  return res.rows;
}

/** Unread notifications for the signed-in user (migration trainer_hub/009). */
export async function countUnreadNotifications(userId) {
  const res = await query(
    `SELECT COUNT(*)::int AS unread FROM notifications
      WHERE recipient_user_id = $1 AND read_at IS NULL AND archived_at IS NULL`,
    [userId]
  );
  return res.rows[0].unread;
}

// ===========================================================================
// Member profile (own record only)
// ===========================================================================

/** The member's linked login account (photo + username). */
export async function getLinkedAccount(memberId) {
  const res = await query(
    `SELECT id, username, avatar_url FROM users WHERE member_id = $1 ORDER BY id LIMIT 1`,
    [memberId]
  );
  return res.rows[0] || null;
}

/** Fitness goal recorded by the trainer/admin (performance profile). */
export async function getFitnessGoal(memberId) {
  const res = await query(
    `SELECT fitness_goal, last_updated_at FROM member_performance_profiles WHERE member_id = $1`,
    [memberId]
  );
  return res.rows[0] || null;
}

/** Is :email / :phone already used by ANOTHER member or ANOTHER login account? */
export async function findContactConflicts(memberId, userId, { email, phone }) {
  const res = await query(
    `SELECT
       ($1::text IS NOT NULL AND (
          EXISTS (SELECT 1 FROM members WHERE LOWER(email) = LOWER($1) AND id <> $3)
       OR EXISTS (SELECT 1 FROM users   WHERE LOWER(email) = LOWER($1) AND id <> $4))) AS email_taken,
       ($2::text IS NOT NULL AND (
          EXISTS (SELECT 1 FROM members WHERE phone = $2 AND id <> $3)
       OR EXISTS (SELECT 1 FROM users   WHERE phone = $2 AND id <> $4))) AS phone_taken`,
    [email ?? null, phone ?? null, memberId, userId]
  );
  return res.rows[0];
}

/**
 * Update the member's permitted personal fields on members AND keep the linked login
 * (users.email / users.phone) in sync, in one transaction. Only whitelisted columns.
 */
const MEMBER_EDITABLE = {
  email: 'email', phone: 'phone',
  emergencyContactName: 'emergency_contact_name', emergencyContactPhone: 'emergency_contact_phone',
  preferredLanguage: 'preferred_language',
};
export async function updateOwnProfile(memberId, userId, data) {
  return withTransaction(async (client) => {
    const keys = Object.keys(MEMBER_EDITABLE).filter((k) => data[k] !== undefined);
    const sets = keys.map((k, i) => `${MEMBER_EDITABLE[k]} = $${i + 2}`);
    const res = await client.query(
      `UPDATE members SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, member_code, full_name, email, phone, date_of_birth, emergency_contact_name,
                  emergency_contact_phone, preferred_language, updated_at`,
      [memberId, ...keys.map((k) => data[k])]
    );
    if (data.email !== undefined || data.phone !== undefined) {
      await client.query(
        `UPDATE users SET email = COALESCE($1, email), phone = COALESCE($2, phone), updated_at = CURRENT_TIMESTAMP
          WHERE id = $3 AND member_id = $4`,
        [data.email ?? null, data.phone ?? null, userId, memberId]
      );
    }
    return res.rows[0];
  });
}

/** Set the photo on the member's own login account. */
export async function setOwnAvatar(memberId, userId, avatarUrl) {
  const res = await query(
    `UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND member_id = $3
      RETURNING avatar_url`,
    [avatarUrl, userId, memberId]
  );
  return res.rows[0] || null;
}

// ===========================================================================
// Membership & finance (own records only; read-only)
// Sources: memberships + membership_plans (Membership Plans Catalog) and
// financial_transactions (Tax Invoices & Billing), refund_requests.
// ===========================================================================

/** All membership periods for the member, newest first, with catalog plan details. */
export async function listMemberships(memberId) {
  const res = await query(
    `SELECT ms.id, ms.status, ms.start_date, ms.end_date, ms.price_paid, ms.payment_status, ms.auto_renew, ms.created_at,
            (ms.end_date - CURRENT_DATE)::int AS days_remaining,
            mp.id AS plan_id, mp.plan_code, mp.name AS plan_name, mp.duration_months, mp.price_inr, mp.perks, mp.is_active AS plan_active
       FROM memberships ms
       LEFT JOIN membership_plans mp ON mp.id = ms.plan_id
      WHERE ms.member_id = $1
      ORDER BY (ms.status = 'active') DESC, ms.end_date DESC NULLS LAST, ms.id DESC
      LIMIT 50`,
    [memberId]
  );
  return res.rows;
}

/** The catalog plan the member record points to (members.plan_id), if any. */
export async function getMemberCatalogPlan(memberId) {
  const res = await query(
    `SELECT mp.id, mp.plan_code, mp.name, mp.duration_months, mp.price_inr, mp.perks, mp.is_active
       FROM members m JOIN membership_plans mp ON mp.id = m.plan_id
      WHERE m.id = $1`,
    [memberId]
  );
  return res.rows[0] || null;
}

const TX_COLUMNS = `ft.id, ft.transaction_type, ft.amount, ft.tax_amount, ft.discount_amount, ft.net_amount,
            ft.payment_method, ft.payment_status, ft.invoice_number, ft.receipt_number, ft.transaction_date`;

/** Payment history from the billing ledger (own rows only) + refund state per transaction. */
export async function listTransactions(memberId, { limit, offset, invoicesOnly = false }) {
  const where = `ft.member_id = $1${invoicesOnly ? ' AND ft.invoice_number IS NOT NULL' : ''}`;
  const [rows, count] = await Promise.all([
    query(
      `SELECT ${TX_COLUMNS},
              (SELECT json_build_object('status', r.status, 'amount', r.amount, 'requestedAt', r.requested_at, 'processedAt', r.processed_at)
                 FROM refund_requests r WHERE r.transaction_id = ft.id AND r.member_id = $1
                 ORDER BY r.requested_at DESC LIMIT 1) AS refund
         FROM financial_transactions ft
        WHERE ${where}
        ORDER BY ft.transaction_date DESC NULLS LAST, ft.id DESC
        LIMIT $2 OFFSET $3`,
      [memberId, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM financial_transactions ft WHERE ${where}`, [memberId]),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

/** Totals over the member's own ledger rows. */
export async function getPaymentTotals(memberId) {
  const res = await query(
    `SELECT COUNT(*)::int AS transactions,
            COALESCE(SUM(net_amount) FILTER (WHERE payment_status IN ('completed', 'paid', 'success')), 0)::numeric(12,2) AS total_paid,
            MAX(transaction_date) FILTER (WHERE payment_status IN ('completed', 'paid', 'success')) AS last_payment_at
       FROM financial_transactions WHERE member_id = $1`,
    [memberId]
  );
  return res.rows[0];
}

/** One invoice — only if it belongs to the member. */
export async function getOwnInvoice(memberId, transactionId) {
  const res = await query(
    `SELECT ${TX_COLUMNS}, ft.notes,
            m.full_name AS member_name, m.member_code, m.email AS member_email, m.phone AS member_phone, m.plan_name
       FROM financial_transactions ft
       JOIN members m ON m.id = ft.member_id
      WHERE ft.id = $1 AND ft.member_id = $2`,
    [transactionId, memberId]
  );
  return res.rows[0] || null;
}

/** Gym details printed on invoices (existing gym profile/settings). */
export async function getGymInvoiceHeader() {
  const res = await query(
    `SELECT gym_name, tagline, address, phone, email FROM (
        SELECT gym_name, tagline, address, phone, email, 1 AS pri FROM gym_settings
        UNION ALL
        SELECT gym_name, tagline, address, phone, email, 2 FROM gym_profile) g
      WHERE gym_name IS NOT NULL ORDER BY pri LIMIT 1`
  );
  return res.rows[0] || null;
}

/** Member's PT package purchases (migration trainer_hub/002), newest first. */
export async function listPtPackages(memberId) {
  const res = await query(
    `SELECT pp.public_id, pp.status, pp.sessions_total, pp.sessions_used, pp.sessions_remaining,
            pp.valid_from, pp.valid_until, pp.payment_status, pp.price_paid_inr,
            pk.name AS package_name, pk.session_duration_mins, t.full_name AS trainer_name
       FROM pt_package_purchases pp
       LEFT JOIN pt_packages pk ON pk.id = pp.package_id
       LEFT JOIN trainers t ON t.id = pp.trainer_id
      WHERE pp.member_id = $1
      ORDER BY (pp.status = 'active') DESC, pp.valid_until DESC NULLS LAST
      LIMIT 10`,
    [memberId]
  );
  return res.rows;
}

/**
 * Completion per programme day from the member's own workout_session_logs:
 * total completions, completions this ISO week (Mon–Sun) and the last completion time.
 */
export async function getDayCompletion(memberId, programIds) {
  if (!programIds.length) return [];
  const res = await query(
    `SELECT program_id, day_id,
            COUNT(*)::int AS completions,
            COUNT(*) FILTER (WHERE completed_at >= date_trunc('week', NOW()))::int AS this_week,
            MAX(completed_at) AS last_completed_at
       FROM workout_session_logs
      WHERE member_id = $1 AND program_id = ANY($2::int[]) AND day_id IS NOT NULL
      GROUP BY program_id, day_id`,
    [memberId, programIds]
  );
  return res.rows;
}

/** Sessions logged this ISO week across all programmes. */
export async function countSessionsThisWeek(memberId) {
  const res = await query(
    `SELECT COUNT(*)::int AS n FROM workout_session_logs
      WHERE member_id = $1 AND completed_at >= date_trunc('week', NOW())`,
    [memberId]
  );
  return res.rows[0].n;
}

/**
 * One training day of a programme — ONLY when that programme is actively assigned to the member.
 * Returns null otherwise (caller answers 404 so other members' programmes are not revealed).
 */
export async function getAssignedWorkoutDay(memberId, programId, dayId) {
  const assignment = await query(
    `SELECT w.id AS assignment_id, w.start_date, w.trainer_notes, w.program_id,
            p.name AS program_name, p.goal, p.split_type, p.difficulty_level, p.description,
            t.full_name AS assigned_by
       FROM member_workout_assignments w
       JOIN workout_programs p ON p.id = w.program_id
       LEFT JOIN trainers t ON t.id = w.assigned_by_trainer_id
      WHERE w.member_id = $1 AND w.program_id = $2 AND w.status = 'active' AND ${NOT_COACH_PLAN}
      ORDER BY w.start_date DESC LIMIT 1`,
    [memberId, programId]
  );
  if (!assignment.rows.length) return null;
  const [day, days, exercises] = await Promise.all([
    query(`SELECT id, day_number, day_name, focus FROM workout_program_days WHERE id = $1 AND program_id = $2`, [dayId, programId]),
    query(`SELECT id, day_number, day_name, focus FROM workout_program_days WHERE program_id = $1 ORDER BY day_number`, [programId]),
    query(
      `SELECT wpe.id, wpe.exercise_id, e.name AS exercise_name, e.muscle_group, e.target_muscles, e.equipment, e.difficulty,
              e.instructions, e.video_url, wpe.sets, wpe.reps, wpe.target_weight_kg, wpe.rest_seconds, wpe.notes, wpe.order_index
         FROM workout_program_exercises wpe
         JOIN exercises e ON e.id = wpe.exercise_id
        WHERE wpe.day_id = $1
        ORDER BY wpe.order_index ASC NULLS LAST, wpe.id ASC`,
      [dayId]
    ),
  ]);
  if (!day.rows.length) return null;
  return { assignment: assignment.rows[0], day: day.rows[0], days: days.rows, exercises: exercises.rows };
}

/** Prescribed set totals for the programme days of the given logs (for completion status). */
export async function getPrescribedSets(memberId, logIds) {
  if (!logIds.length) return [];
  const res = await query(
    `SELECT l.id AS log_id, l.day_id, COALESCE(SUM(wpe.sets), 0)::int AS prescribed_sets
       FROM workout_session_logs l
       LEFT JOIN workout_program_exercises wpe ON wpe.day_id = l.day_id
      WHERE l.member_id = $1 AND l.id = ANY($2::int[])
      GROUP BY l.id, l.day_id`,
    [memberId, logIds]
  );
  return res.rows;
}

/**
 * Duplicate-submission guard. Serialises this member's log submissions with a transaction-level
 * advisory lock, then reports whether an equivalent log already exists (same programme/day,
 * same duration, completed within 2 minutes). `run` executes only when it is not a duplicate,
 * while the lock is still held, so two concurrent identical requests cannot both insert.
 */
export async function withWorkoutLogGuard(memberId, { programId, dayId, durationMinutes, completedAt }, run) {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [7301, memberId]);
    const dup = await client.query(
      `SELECT id FROM workout_session_logs
        WHERE member_id = $1
          AND program_id IS NOT DISTINCT FROM $2 AND day_id IS NOT DISTINCT FROM $3
          AND duration_minutes = $4
          AND completed_at BETWEEN COALESCE($5::timestamptz, NOW()) - INTERVAL '2 minutes'
                               AND COALESCE($5::timestamptz, NOW()) + INTERVAL '2 minutes'
        LIMIT 1`,
      [memberId, programId, dayId, durationMinutes, completedAt]
    );
    if (dup.rows.length) return { duplicateOf: dup.rows[0].id };
    return { log: await run() };
  });
}

// ===========================================================================
// Exercise library (shared Admin catalogue, read-only for members)
// ===========================================================================

/**
 * Member-facing categories → fixed SQL conditions on the existing columns (whitelisted; never
 * built from user input). Biceps/Triceps are stored as "Arms" and told apart by target muscles.
 */
export const EXERCISE_CATEGORIES = {
  chest: { label: 'Chest', sql: `muscle_group ILIKE 'chest'` },
  back: { label: 'Back', sql: `muscle_group ILIKE 'back'` },
  shoulders: { label: 'Shoulders', sql: `muscle_group ILIKE 'shoulders'` },
  biceps: { label: 'Biceps', sql: `(muscle_group ILIKE 'biceps' OR (muscle_group ILIKE 'arms' AND (target_muscles ILIKE '%bicep%' OR name ILIKE '%bicep%' OR name ILIKE '%curl%')))` },
  triceps: { label: 'Triceps', sql: `(muscle_group ILIKE 'triceps' OR (muscle_group ILIKE 'arms' AND (target_muscles ILIKE '%tricep%' OR name ILIKE '%tricep%')))` },
  legs: { label: 'Legs', sql: `muscle_group IN ('Legs', 'Glutes', 'Quadriceps', 'Hamstrings', 'Calves')` },
  abs: { label: 'Abs', sql: `muscle_group IN ('Abs', 'Core', 'Abdominals')` },
  full_body: { label: 'Full Body', sql: `muscle_group ILIKE 'full body'` },
};

let archivedColumn = null;   // cached: does exercises.archived_at exist yet (Trainer Hub migration 003)?
async function exercisesArchivable() {
  if (archivedColumn === null) {
    const r = await query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exercises' AND column_name = 'archived_at') AS x`);
    archivedColumn = r.rows[0].x;
  }
  return archivedColumn;
}

export async function listLibraryExercises({ category = null, search = null, difficulty = null, limit, offset }) {
  const conds = [];
  if (await exercisesArchivable()) conds.push('archived_at IS NULL');
  if (category) conds.push(EXERCISE_CATEGORIES[category].sql);
  const params = [search ? `%${search}%` : null, difficulty];
  conds.push(`($1::text IS NULL OR name ILIKE $1 OR target_muscles ILIKE $1 OR equipment ILIKE $1 OR muscle_group ILIKE $1)`);
  conds.push(`($2::text IS NULL OR difficulty ILIKE $2)`);
  const where = conds.join(' AND ');
  const counts = Object.entries(EXERCISE_CATEGORIES)
    .map(([key, c]) => `COUNT(*) FILTER (WHERE ${c.sql})::int AS "${key}"`).join(', ');
  const base = (await exercisesArchivable()) ? 'archived_at IS NULL' : 'TRUE';
  const [rows, total, perCategory] = await Promise.all([
    query(
      `SELECT id, name, muscle_group, target_muscles, equipment, difficulty, instructions, video_url
         FROM exercises WHERE ${where}
        ORDER BY muscle_group, name LIMIT $3 OFFSET $4`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM exercises WHERE ${where}`, params),
    query(`SELECT COUNT(*)::int AS all, ${counts} FROM exercises WHERE ${base}`),
  ]);
  return { rows: rows.rows, total: total.rows[0].total, categoryCounts: perCategory.rows[0] };
}

// ===========================================================================
// Diet plan detail (read-only)
// ===========================================================================

/** Full plan: targets, meals (time, instructions) and items with quantities from food_items. */
export async function getDietPlanDetail(planId) {
  const [plan, meals, items] = await Promise.all([
    query(
      `SELECT dp.id, dp.name, dp.goal, dp.description, dp.target_calories, dp.target_protein_g, dp.target_carbs_g,
              dp.target_fats_g, dp.target_water_ml, dp.created_at, dp.updated_at, t.full_name AS trainer_name
         FROM diet_plans dp LEFT JOIN trainers t ON t.id = dp.trainer_id
        WHERE dp.id = $1`,
      [planId]
    ),
    query(`SELECT id, meal_type, scheduled_time, notes FROM diet_plan_meals WHERE plan_id = $1 ORDER BY scheduled_time ASC NULLS LAST, id ASC`, [planId]),
    query(
      `SELECT i.id, i.meal_id, i.servings, i.custom_portion, i.calories, i.protein_g, i.carbs_g, i.fats_g,
              f.name AS food_name, f.category, f.serving_size, f.is_vegan, f.is_vegetarian, f.is_gluten_free
         FROM diet_plan_meal_items i
         JOIN diet_plan_meals m ON m.id = i.meal_id
         JOIN food_items f ON f.id = i.food_item_id
        WHERE m.plan_id = $1
        ORDER BY i.id ASC`,
      [planId]
    ),
  ]);
  if (!plan.rows.length) return null;
  return { ...plan.rows[0], meals: meals.rows.map((m) => ({ ...m, items: items.rows.filter((i) => i.meal_id === m.id) })) };
}

/** One of the member's own diet assignments (any status) — null when it is not theirs. */
export async function getOwnDietAssignment(memberId, assignmentId) {
  const res = await query(
    `SELECT d.id, d.status, d.start_date, d.end_date, d.notes, d.plan_id, d.created_at, t.full_name AS assigned_by
       FROM member_diet_assignments d
       LEFT JOIN trainers t ON t.id = d.assigned_by_trainer_id
      WHERE d.id = $1 AND d.member_id = $2`,
    [assignmentId, memberId]
  );
  return res.rows[0] || null;
}

// ===========================================================================
// Food diary (member's own daily nutrition log)
// ===========================================================================

export async function getFoodsByIds(ids) {
  if (!ids.length) return [];
  const res = await query(`SELECT id, name, serving_size, calories, protein_g, carbs_g, fats_g FROM food_items WHERE id = ANY($1::int[])`, [ids]);
  return res.rows;
}

/** Editable window check done by the database clock: today back to 7 days ago, never the future. */
export async function diaryDateWindow(date) {
  const res = await query(
    `SELECT $1::date > CURRENT_DATE AS future, $1::date < CURRENT_DATE - 7 AS too_old, CURRENT_DATE::text AS today`,
    [date]
  );
  return res.rows[0];
}

/** One day of the member's diary (null when nothing logged that day). */
export async function getDiaryDay(memberId, date) {
  const log = await query(
    `SELECT id, log_date::text AS log_date, total_calories, total_protein_g, total_carbs_g, total_fats_g, water_intake_ml,
            adherence_score, notes, logged_by, created_at
       FROM member_nutrition_daily_logs WHERE member_id = $1 AND log_date = $2::date`,
    [memberId, date]
  );
  if (!log.rows.length) return null;
  const entries = await query(
    `SELECT id, meal_type, food_item_id, food_name, portion_size, calories, protein_g, carbs_g, fats_g, logged_at
       FROM member_nutrition_meal_entries WHERE daily_log_id = $1 ORDER BY id`,
    [log.rows[0].id]
  );
  return { ...log.rows[0], entries: entries.rows };
}

/**
 * Save the whole day (upsert daily log + replace that day's entries) in one transaction.
 * Member-specific so no defaults are invented: adherence is stored only when computed.
 */
export async function saveDiaryDay(memberId, date, { entries, waterMl, notes, adherence }) {
  return withTransaction(async (client) => {
    const t = entries.reduce((a, e) => ({ kcal: a.kcal + e.calories, p: a.p + e.protein_g, c: a.c + e.carbs_g, f: a.f + e.fats_g }), { kcal: 0, p: 0, c: 0, f: 0 });
    const r2 = (x) => Math.round(x * 100) / 100;
    const log = await client.query(
      `INSERT INTO member_nutrition_daily_logs (member_id, log_date, total_calories, total_protein_g, total_carbs_g, total_fats_g, water_intake_ml, adherence_score, notes, logged_by)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, 'Member')
       ON CONFLICT (member_id, log_date) DO UPDATE SET
         total_calories = EXCLUDED.total_calories, total_protein_g = EXCLUDED.total_protein_g, total_carbs_g = EXCLUDED.total_carbs_g,
         total_fats_g = EXCLUDED.total_fats_g, water_intake_ml = EXCLUDED.water_intake_ml, adherence_score = EXCLUDED.adherence_score,
         notes = EXCLUDED.notes, logged_by = 'Member'
       RETURNING id`,
      [memberId, date, r2(t.kcal), r2(t.p), r2(t.c), r2(t.f), waterMl, adherence, notes]
    );
    const id = log.rows[0].id;
    await client.query('DELETE FROM member_nutrition_meal_entries WHERE daily_log_id = $1', [id]);
    for (const e of entries) {
      await client.query(
        `INSERT INTO member_nutrition_meal_entries (daily_log_id, meal_type, food_item_id, food_name, portion_size, calories, protein_g, carbs_g, fats_g)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, e.meal_type, e.food_item_id, e.food_name, e.portion_size, e.calories, e.protein_g, e.carbs_g, e.fats_g]
      );
    }
    return id;
  });
}

// ---------------------------------------------------------------- recovery self-report (migration 022)

let recoveryColsCache = { at: 0, ready: false };
/** True once migration 022 (fatigue_level + self_assessment, nullable readiness) is applied. */
export async function recoverySelfReportReady() {
  if (Date.now() - recoveryColsCache.at < 60000) return recoveryColsCache.ready;
  const res = await query(
    `SELECT COUNT(*) FILTER (WHERE column_name IN ('fatigue_level', 'self_assessment'))::int AS added,
            COUNT(*) FILTER (WHERE column_name = 'readiness_score' AND is_nullable = 'YES')::int AS nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'member_recovery_logs'`
  );
  const r = res.rows[0];
  recoveryColsCache = { at: Date.now(), ready: r.added === 2 && r.nullable === 1 };
  return recoveryColsCache.ready;
}

/**
 * Save the member's own recovery check-in for one day. Stores ONLY what the member entered:
 * readiness_score / fatigue_index / readiness_status / recommended_action are left empty
 * (no formula-generated assessment). Re-saving the same day replaces that day's own check-in;
 * a day already recorded by staff is never overwritten (409).
 */
export async function saveRecoveryCheckin(memberId, logDate, d, soreness) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT id, logged_by FROM member_recovery_logs WHERE member_id = $1 AND log_date = $2 FOR UPDATE',
      [memberId, logDate]
    );
    if (existing.rows[0] && existing.rows[0].logged_by !== 'Member') {
      const err = new Error('A staff member already recorded recovery for this day. Ask your trainer to update it.');
      err.status = 409;
      throw err;
    }
    const res = await client.query(
      `INSERT INTO member_recovery_logs (
          member_id, log_date, sleep_hours, sleep_quality, fatigue_level, overall_soreness_rating,
          energy_level, stress_level, hydration_liters, is_rest_day, rest_day_activity, self_assessment,
          user_notes, readiness_score, fatigue_index, readiness_status, recommended_action, logged_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL, NULL, NULL, NULL, 'Member')
       ON CONFLICT (member_id, log_date) DO UPDATE SET
          sleep_hours = EXCLUDED.sleep_hours, sleep_quality = EXCLUDED.sleep_quality,
          fatigue_level = EXCLUDED.fatigue_level, overall_soreness_rating = EXCLUDED.overall_soreness_rating,
          energy_level = EXCLUDED.energy_level, stress_level = EXCLUDED.stress_level,
          hydration_liters = EXCLUDED.hydration_liters, is_rest_day = EXCLUDED.is_rest_day,
          rest_day_activity = EXCLUDED.rest_day_activity, self_assessment = EXCLUDED.self_assessment,
          user_notes = EXCLUDED.user_notes,
          readiness_score = NULL, fatigue_index = NULL, readiness_status = NULL, recommended_action = NULL,
          logged_by = 'Member'
       RETURNING *`,
      [memberId, logDate, d.sleepHours, d.sleepQuality, d.fatigueLevel, d.overallSoreness,
        d.energyLevel, d.stressLevel, d.hydrationLiters, d.isRestDay, d.restDayActivity, d.selfAssessment, d.notes]
    );
    const log = res.rows[0];
    await client.query('DELETE FROM member_muscle_soreness_details WHERE recovery_log_id = $1', [log.id]);
    for (const s of soreness) {
      await client.query(
        'INSERT INTO member_muscle_soreness_details (recovery_log_id, muscle_group, soreness_level, notes) VALUES ($1, $2, $3, $4)',
        [log.id, s.muscleGroup, s.level, s.notes]
      );
    }
    return { ...log, soreness };
  });
}

// ---------------------------------------------------------------- in-gym classes (Admin Class & Shift Calendar)
// Classes are rows in online_classes with class_type = 'in_person', created by the admin calendar.
// status: 'scheduled' = registration open · 'registration_closed' · 'cancelled' · 'completed'.
// Booked places = registrations with status 'registered' or 'attended' (cancelled ones free the place).

const CLASS_SELECT = `
  SELECT oc.id, oc.title, oc.category, oc.scheduled_at, oc.duration_mins, oc.max_participants,
         oc.status, oc.description, oc.difficulty, t.full_name AS trainer_name,
         (SELECT COUNT(*) FROM class_registrations r
           WHERE r.class_id = oc.id AND r.status IN ('registered', 'attended'))::int AS booked,
         my.status AS my_status, my.registered_at AS my_registered_at
    FROM online_classes oc
    LEFT JOIN trainers t ON t.id = oc.instructor_trainer_id
    LEFT JOIN class_registrations my ON my.class_id = oc.id AND my.member_id = $1`;

export async function listGymClasses(memberId, { from, to }) {
  const res = await query(
    `${CLASS_SELECT}
      WHERE oc.class_type = 'in_person' AND oc.scheduled_at >= $2 AND oc.scheduled_at < $3
      ORDER BY oc.scheduled_at ASC, oc.id ASC`,
    [memberId, from, to]
  );
  return res.rows;
}

/** My upcoming bookings (any date ahead). */
export async function listMyClassBookings(memberId) {
  const res = await query(
    `${CLASS_SELECT}
      WHERE oc.class_type = 'in_person' AND my.status = 'registered' AND oc.scheduled_at >= NOW()
      ORDER BY oc.scheduled_at ASC`,
    [memberId]
  );
  return res.rows;
}

/**
 * Book a place. The class row is locked (FOR UPDATE) so two members cannot take the last place
 * at the same time; the UNIQUE (class_id, member_id) constraint prevents duplicate bookings.
 */
export async function registerForGymClass(memberId, classId, types = ['in_person']) {
  return withTransaction(async (client) => {
    const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
    const c = (await client.query(
      `SELECT id, title, status, scheduled_at, max_participants, class_type
         FROM online_classes WHERE id = $1 FOR UPDATE`,
      [classId]
    )).rows[0];
    if (!c || !types.includes(c.class_type)) fail(404, 'Class not found.');
    if (c.status === 'cancelled') fail(409, 'This class has been cancelled.');
    if (c.status !== 'scheduled') fail(409, 'Registration is closed for this class.');
    if (new Date(c.scheduled_at) <= new Date()) fail(409, 'This class has already started.');
    const mine = (await client.query(
      'SELECT id, status FROM class_registrations WHERE class_id = $1 AND member_id = $2',
      [classId, memberId]
    )).rows[0];
    if (mine && ['registered', 'attended'].includes(mine.status)) fail(409, 'You are already registered for this class.');
    const booked = (await client.query(
      `SELECT COUNT(*)::int AS n FROM class_registrations WHERE class_id = $1 AND status IN ('registered', 'attended')`,
      [classId]
    )).rows[0].n;
    if (c.max_participants !== null && booked >= c.max_participants) fail(409, 'This class is full.');
    const row = (await client.query(
      `INSERT INTO class_registrations (class_id, member_id, registered_at, attended, status)
       VALUES ($1, $2, NOW(), false, 'registered')
       ON CONFLICT (class_id, member_id) DO UPDATE
         SET status = 'registered', registered_at = NOW(), attended = false, attended_at = NULL
       WHERE class_registrations.status NOT IN ('registered', 'attended')
       RETURNING id, class_id, status, registered_at`,
      [classId, memberId]
    )).rows[0];
    if (!row) fail(409, 'You are already registered for this class.');
    return { ...row, title: c.title, scheduled_at: c.scheduled_at };
  });
}

/** Cancel my booking (only before the class starts). Frees the place. */
export async function cancelGymClass(memberId, classId, types = ['in_person']) {
  const res = await query(
    `UPDATE class_registrations r SET status = 'cancelled'
       FROM online_classes oc
      WHERE r.class_id = oc.id AND r.class_id = $1 AND r.member_id = $2
        AND r.status = 'registered' AND oc.class_type = ANY($3::text[]) AND oc.scheduled_at > NOW()
      RETURNING r.id, r.class_id, r.status, oc.title`,
    [classId, memberId, types]
  );
  return res.rows[0] || null;
}

// ---------------------------------------------------------------- online classes (Admin online class module)
// class_type 'live' (meeting link in stream_url) and 'vod_recorded' (video link in stream_url).
// Links are returned raw here; the service decides what a member may see.

export async function listOnlineClasses(memberId, { from, to }) {
  const res = await query(
    `SELECT oc.id, oc.title, oc.category, oc.class_type, oc.description, oc.scheduled_at, oc.duration_mins,
            oc.stream_url, oc.max_participants, oc.difficulty, oc.status,
            t.full_name AS instructor_name, t.specialty AS instructor_specialty,
            (SELECT COUNT(*) FROM class_registrations r WHERE r.class_id = oc.id AND r.status IN ('registered', 'attended'))::int AS booked,
            my.status AS my_status, my.attended AS my_attended
       FROM online_classes oc
       LEFT JOIN trainers t ON t.id = oc.instructor_trainer_id
       LEFT JOIN class_registrations my ON my.class_id = oc.id AND my.member_id = $1
      WHERE (oc.class_type = 'live' AND oc.scheduled_at + make_interval(mins => COALESCE(oc.duration_mins, 0)) >= $2 AND oc.scheduled_at < $3)
         OR (oc.class_type = 'vod_recorded' AND oc.status <> 'cancelled')
      ORDER BY oc.class_type, oc.scheduled_at ASC, oc.id ASC`,
    [memberId, from, to]
  );
  return res.rows;
}

/** Attendance history across all class types (attendance is recorded by staff). */
export async function listClassAttendance(memberId) {
  const res = await query(
    `SELECT r.id, r.status, r.attended, r.attended_at, r.registered_at, r.watch_time_mins,
            oc.id AS class_id, oc.title, oc.class_type, oc.category, oc.scheduled_at, oc.duration_mins, oc.status AS class_status,
            t.full_name AS instructor_name
       FROM class_registrations r
       JOIN online_classes oc ON oc.id = r.class_id
       LEFT JOIN trainers t ON t.id = oc.instructor_trainer_id
      WHERE r.member_id = $1 AND r.status <> 'cancelled'
        AND (r.attended IS TRUE OR r.status IN ('attended', 'no_show')
             OR oc.scheduled_at + make_interval(mins => COALESCE(oc.duration_mins, 0)) < NOW())
      ORDER BY oc.scheduled_at DESC
      LIMIT 100`,
    [memberId]
  );
  return res.rows;
}

/** Video lessons of courses the member is enrolled in. */
export async function listMyVideoLessons(memberId) {
  const res = await query(
    `SELECT l.id, l.title, l.lesson_order, l.duration_mins, l.video_url,
            c.id AS course_id, c.title AS course_title, c.level, e.status AS enrolment_status,
            t.full_name AS instructor_name
       FROM course_enrolments e
       JOIN courses c ON c.id = e.course_id
       JOIN course_lessons l ON l.course_id = c.id
       LEFT JOIN trainers t ON t.id = c.instructor_trainer_id
      WHERE e.member_id = $1 AND e.status IS DISTINCT FROM 'withdrawn' AND c.status <> 'draft'
      ORDER BY c.title, l.lesson_order, l.id`,
    [memberId]
  );
  return res.rows;
}

// ---------------------------------------------------------------- courses (Admin Classes & Learning module)
// Visibility: catalogue = courses.status 'published'. Lesson content, videos and assessments are only
// returned to members enrolled in the course (and never for draft courses).
// Progress: lessons are completed IN ORDER (lesson_order, id); course_enrolments.lessons_completed = how many
// of the first lessons are done, so the existing columns record exactly which lessons are complete.

export async function listCourseCatalogue(memberId) {
  const res = await query(
    `SELECT c.id, c.title, c.category, c.description, c.level, c.estimated_hours, c.status,
            t.full_name AS instructor_name, t.specialty AS instructor_specialty,
            (SELECT COUNT(*) FROM course_lessons l WHERE l.course_id = c.id)::int AS lessons_count,
            (SELECT COALESCE(SUM(l.duration_mins), 0) FROM course_lessons l WHERE l.course_id = c.id)::int AS total_mins,
            EXISTS (SELECT 1 FROM course_quizzes q WHERE q.course_id = c.id) AS has_assessment,
            e.id AS enrolment_id, e.status AS enrolment_status, e.enrolled_at, e.lessons_completed, e.progress_pct,
            e.quiz_score_pct, e.quiz_passed, e.completed_at,
            cc.certificate_code, cc.issued_at AS certificate_issued_at
       FROM courses c
       LEFT JOIN trainers t ON t.id = c.instructor_trainer_id
       LEFT JOIN course_enrolments e ON e.course_id = c.id AND e.member_id = $1
       LEFT JOIN course_certificates cc ON cc.course_id = c.id AND cc.member_id = $1
      WHERE c.status = 'published' OR (e.id IS NOT NULL AND c.status <> 'draft')
      ORDER BY c.title`,
    [memberId]
  );
  return res.rows;
}

export async function getCourseForMember(memberId, courseId) {
  const course = (await query(
    `SELECT c.id, c.title, c.category, c.description, c.level, c.estimated_hours, c.status,
            t.full_name AS instructor_name, t.specialty AS instructor_specialty,
            e.id AS enrolment_id, e.status AS enrolment_status, e.enrolled_at, e.lessons_completed, e.progress_pct,
            e.quiz_score_pct, e.quiz_passed, e.completed_at,
            cc.certificate_code, cc.issued_at AS certificate_issued_at, cc.issued_by AS certificate_issued_by, cc.grade_score
       FROM courses c
       LEFT JOIN trainers t ON t.id = c.instructor_trainer_id
       LEFT JOIN course_enrolments e ON e.course_id = c.id AND e.member_id = $1
       LEFT JOIN course_certificates cc ON cc.course_id = c.id AND cc.member_id = $1
      WHERE c.id = $2`,
    [memberId, courseId]
  )).rows[0];
  if (!course) return null;
  const [lessons, quiz] = await Promise.all([
    query('SELECT id, title, lesson_order, duration_mins, video_url, content_notes FROM course_lessons WHERE course_id = $1 ORDER BY lesson_order, id', [courseId]),
    query('SELECT id, title, pass_percentage, quiz_data FROM course_quizzes WHERE course_id = $1 ORDER BY id LIMIT 1', [courseId]),
  ]);
  return { course, lessons: lessons.rows, quiz: quiz.rows[0] || null };
}

export async function getMemberStatus(memberId) {
  const r = await query('SELECT status FROM members WHERE id = $1', [memberId]);
  return r.rows[0]?.status || null;
}

/** Self-enrol in a published course (re-activates a withdrawn enrolment, keeps existing progress). */
export async function enrolInCourse(memberId, courseId) {
  return withTransaction(async (client) => {
    const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
    const c = (await client.query('SELECT id, status FROM courses WHERE id = $1', [courseId])).rows[0];
    if (!c || c.status !== 'published') fail(404, 'Course not found.');
    const total = (await client.query('SELECT COUNT(*)::int AS n FROM course_lessons WHERE course_id = $1', [courseId])).rows[0].n;
    const ins = (await client.query(
      `INSERT INTO course_enrolments (course_id, member_id, enrolled_at, progress_pct, lessons_completed, total_lessons, status)
       VALUES ($1, $2, NOW(), 0, 0, $3, 'in_progress')
       ON CONFLICT (course_id, member_id) DO UPDATE SET status = 'in_progress', total_lessons = EXCLUDED.total_lessons
         WHERE course_enrolments.status = 'withdrawn'
       RETURNING *`,
      [courseId, memberId, total]
    )).rows[0];
    if (!ins) fail(409, 'You are already enrolled in this course.');
    return ins;
  });
}

/** Lock my enrolment for an update; returns { e, lessons, quiz, fail } or throws. */
async function lockEnrolment(client, memberId, courseId) {
  const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
  const e = (await client.query(
    `SELECT e.*, c.status AS course_status FROM course_enrolments e JOIN courses c ON c.id = e.course_id
      WHERE e.course_id = $1 AND e.member_id = $2 FOR UPDATE OF e`,
    [courseId, memberId]
  )).rows[0];
  if (!e || e.status === 'withdrawn' || e.course_status === 'draft') fail(403, 'Enrol in this course first.');
  const lessons = (await client.query('SELECT id FROM course_lessons WHERE course_id = $1 ORDER BY lesson_order, id', [courseId])).rows;
  const quiz = (await client.query('SELECT id, pass_percentage, quiz_data FROM course_quizzes WHERE course_id = $1 ORDER BY id LIMIT 1', [courseId])).rows[0] || null;
  return { e, lessons, quiz, fail };
}

async function writeProgress(client, e, { lessonsDone, total, quizScore, quizPassed, hasQuiz }) {
  const pct = total ? Math.min(100, Math.round((lessonsDone / total) * 100)) : 0;
  const complete = total > 0 && lessonsDone >= total && (!hasQuiz || quizPassed);
  return (await client.query(
    `UPDATE course_enrolments
        SET lessons_completed = $1, total_lessons = $2, progress_pct = $3, quiz_score_pct = $4, quiz_passed = $5,
            status = $6::varchar, completed_at = CASE WHEN $6::varchar = 'completed' THEN COALESCE(completed_at, NOW()) ELSE NULL END
      WHERE id = $7 RETURNING *`,
    [lessonsDone, total, pct, quizScore, quizPassed, complete ? 'completed' : 'in_progress', e.id]
  )).rows[0];
}

/** Mark a lesson complete. Only the next lesson in order can be completed; re-completing is a no-op. */
export async function completeCourseLesson(memberId, courseId, lessonId) {
  return withTransaction(async (client) => {
    const { e, lessons, quiz, fail } = await lockEnrolment(client, memberId, courseId);
    const idx = lessons.findIndex((l) => l.id === lessonId);
    if (idx < 0) fail(404, 'Lesson not found in this course.');
    const done = Math.min(Number(e.lessons_completed) || 0, lessons.length);
    if (idx < done) return { enrolment: e, alreadyComplete: true };
    if (idx > done) fail(409, 'Complete the earlier lessons first.');
    const row = await writeProgress(client, e, { lessonsDone: done + 1, total: lessons.length, quizScore: e.quiz_score_pct, quizPassed: !!e.quiz_passed, hasQuiz: !!quiz });
    return { enrolment: row, alreadyComplete: false };
  });
}

/** Grade an assessment attempt on the server. Keeps the best score; a pass is never undone. */
export async function submitCourseAssessment(memberId, courseId, answers) {
  return withTransaction(async (client) => {
    const { e, lessons, quiz, fail } = await lockEnrolment(client, memberId, courseId);
    if (!quiz) fail(404, 'This course has no assessment.');
    const questions = Array.isArray(quiz.quiz_data) ? quiz.quiz_data : [];
    if (!questions.length) fail(409, 'The assessment has no questions yet.');
    if ((Number(e.lessons_completed) || 0) < lessons.length) fail(409, 'Complete all lessons before taking the assessment.');
    if (!Array.isArray(answers) || answers.length !== questions.length) fail(400, `Answer all ${questions.length} questions.`);
    const correct = questions.reduce((n, q, i) => n + (Number.isInteger(answers[i]) && answers[i] === Number(q.correctIndex) ? 1 : 0), 0);
    const score = Math.round((correct / questions.length) * 100);
    const passMark = Number(quiz.pass_percentage) || 80;
    const passed = score >= passMark;
    const best = Math.max(score, Number(e.quiz_score_pct) || 0);
    const row = await writeProgress(client, e, { lessonsDone: lessons.length, total: lessons.length, quizScore: best, quizPassed: !!e.quiz_passed || passed, hasQuiz: true });
    return { enrolment: row, score, passed, passMark, correct, total: questions.length };
  });
}

// ---------------------------------------------------------------- events & competitions (Admin Events & Competitions)
// Admin creates events, records scores (which re-ranks the leaderboard) and issues certificates.
// Members can only register / withdraw themselves and read results.

export async function listEventsForMember(memberId) {
  const res = await query(
    `SELECT c.id, c.title, c.type, c.description, c.start_date, c.end_date, c.registration_deadline, c.status,
            c.metric_type, c.prize_pool, c.rules, t.full_name AS organizer_name,
            (SELECT COUNT(*) FROM competition_participants p WHERE p.competition_id = c.id AND p.status <> 'withdrawn')::int AS entrants,
            (SELECT COUNT(*) FROM competition_participants p WHERE p.competition_id = c.id AND p.score IS NOT NULL AND p.status <> 'withdrawn')::int AS scored,
            me.id AS my_entry_id, me.status AS my_status, me.division AS my_division, me.score AS my_score, me.score_unit AS my_score_unit,
            me.rank_position AS my_rank, me.is_winner AS my_is_winner, me.registration_date AS my_registered_at,
            vt.full_name AS my_verified_by, me.verified_by_trainer_id AS my_verified_id,
            cc.certificate_code, cc.award_title, cc.issued_at AS certificate_issued_at
       FROM fitness_competitions c
       LEFT JOIN trainers t ON t.id = c.organizer_trainer_id
       LEFT JOIN competition_participants me ON me.competition_id = c.id AND me.member_id = $1
       LEFT JOIN trainers vt ON vt.id = me.verified_by_trainer_id
       LEFT JOIN competition_certificates cc ON cc.competition_id = c.id AND cc.member_id = $1
      WHERE c.status <> 'cancelled' OR me.id IS NOT NULL
      ORDER BY c.start_date DESC, c.id DESC`,
    [memberId]
  );
  return res.rows;
}

export async function getEventStatus(competitionId) {
  const r = await query('SELECT id, status FROM fitness_competitions WHERE id = $1', [competitionId]);
  return r.rows[0] || null;
}

/** Scored entries only (scores are recorded by staff). Names are masked by the service. */
export async function getEventLeaderboard(competitionId) {
  const res = await query(
    `SELECT p.member_id, m.full_name, p.division, p.score, p.score_unit, p.rank_position, p.is_winner,
            p.verified_by_trainer_id, t.full_name AS verified_by
       FROM competition_participants p
       JOIN members m ON m.id = p.member_id
       LEFT JOIN trainers t ON t.id = p.verified_by_trainer_id
      WHERE p.competition_id = $1 AND p.score IS NOT NULL AND p.status <> 'withdrawn'
      ORDER BY p.rank_position ASC NULLS LAST, p.score DESC`,
    [competitionId]
  );
  return res.rows;
}

/** Last day registration is open: the deadline, or the day before the start date when no deadline is set. */
const REG_OPEN_SQL = `c.status = 'upcoming' AND CURRENT_DATE <= COALESCE(c.registration_deadline, c.start_date - 1)`;

export async function registerForEvent(memberId, competitionId, { division, scoreUnit }) {
  return withTransaction(async (client) => {
    const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
    const c = (await client.query(
      `SELECT c.id, c.status, (${REG_OPEN_SQL}) AS open FROM fitness_competitions c WHERE c.id = $1 FOR UPDATE`,
      [competitionId]
    )).rows[0];
    if (!c || c.status === 'cancelled') fail(404, 'Event not found.');
    if (!c.open) fail(409, 'Registration for this event is closed.');
    const row = (await client.query(
      `INSERT INTO competition_participants (competition_id, member_id, division, status, score_unit)
       VALUES ($1, $2, $3, 'registered', $4)
       ON CONFLICT (competition_id, member_id) DO UPDATE SET status = 'registered', division = EXCLUDED.division, registration_date = NOW()
         WHERE competition_participants.status = 'withdrawn'
       RETURNING id, status, division`,
      [competitionId, memberId, division, scoreUnit]
    )).rows[0];
    if (!row) fail(409, 'You are already registered for this event.');
    return row;
  });
}

/** Withdraw my own entry while registration is still open and before any score is recorded. */
export async function withdrawFromEvent(memberId, competitionId) {
  const res = await query(
    `UPDATE competition_participants p SET status = 'withdrawn'
       FROM fitness_competitions c
      WHERE p.competition_id = c.id AND p.competition_id = $1 AND p.member_id = $2
        AND p.status = 'registered' AND p.score IS NULL AND ${REG_OPEN_SQL}
      RETURNING p.id`,
    [competitionId, memberId]
  );
  return res.rows[0] || null;
}

// ---------------------------------------------------------------- books & library (Admin Books & Library)
// secure_file_path is NEVER selected for members. Access is decided in the service (memberBookAccess).

const BOOK_COLS = `b.id, b.title, b.slug, b.author, b.category, b.description, b.file_format, b.file_size_mb, b.page_count,
       b.is_paid, b.price_amount, b.currency, b.access_tier, b.status, b.updated_at`;

/** Books the member could possibly see (never staff_only, never drafts), with my purchase/progress. */
export async function listBooksForMember(memberId) {
  const res = await query(
    `SELECT ${BOOK_COLS},
            pu.id AS purchase_id, pu.purchased_at, pu.invoice_code,
            rp.current_page, rp.total_pages AS progress_total_pages, rp.progress_pct, rp.completed, rp.last_read_at
       FROM library_books b
       LEFT JOIN LATERAL (SELECT id, purchased_at, invoice_code FROM book_purchases p
                           WHERE p.book_id = b.id AND p.member_id = $1 ORDER BY purchased_at DESC LIMIT 1) pu ON TRUE
       LEFT JOIN book_reading_progress rp ON rp.book_id = b.id AND rp.member_id = $1
      WHERE b.access_tier <> 'staff_only' AND b.status <> 'draft'
      ORDER BY b.title`,
    [memberId]
  );
  return res.rows;
}

export async function getBookForMember(memberId, bookId) {
  const res = await query(
    `SELECT ${BOOK_COLS},
            pu.id AS purchase_id, pu.purchased_at, pu.invoice_code,
            rp.current_page, rp.total_pages AS progress_total_pages, rp.progress_pct, rp.completed, rp.last_read_at, rp.notes AS progress_notes
       FROM library_books b
       LEFT JOIN LATERAL (SELECT id, purchased_at, invoice_code FROM book_purchases p
                           WHERE p.book_id = b.id AND p.member_id = $1 ORDER BY purchased_at DESC LIMIT 1) pu ON TRUE
       LEFT JOIN book_reading_progress rp ON rp.book_id = b.id AND rp.member_id = $1
      WHERE b.id = $2`,
    [memberId, bookId]
  );
  return res.rows[0] || null;
}

/** For streaming only: the slug/format used to locate the file inside the private vault. */
export async function getBookFileInfo(bookId) {
  const res = await query('SELECT id, slug, file_format FROM library_books WHERE id = $1', [bookId]);
  return res.rows[0] || null;
}

export async function listMyBookPurchases(memberId) {
  const res = await query(
    `SELECT p.id, p.invoice_code, p.amount_paid, p.currency, p.payment_method, p.purchased_at,
            b.id AS book_id, b.title, b.author, b.category
       FROM book_purchases p JOIN library_books b ON b.id = p.book_id
      WHERE p.member_id = $1
      ORDER BY p.purchased_at DESC`,
    [memberId]
  );
  return res.rows;
}

/** VIP = an active, current membership on a plan whose badge (set by admin) says VIP. */
export async function isVipMember(memberId) {
  const res = await query(
    `SELECT EXISTS (
       SELECT 1 FROM memberships ms JOIN membership_plans mp ON mp.id = ms.plan_id
        WHERE ms.member_id = $1 AND ms.status = 'active'
          AND (ms.end_date IS NULL OR ms.end_date >= CURRENT_DATE)
          AND mp.badge_label ILIKE '%vip%') AS vip`,
    [memberId]
  );
  return res.rows[0].vip;
}

export async function saveBookProgress(memberId, bookId, { currentPage, totalPages, notes }) {
  const pct = Math.min(100, Math.round((currentPage / totalPages) * 100));
  const res = await query(
    `INSERT INTO book_reading_progress (book_id, member_id, current_page, total_pages, progress_pct, completed, last_read_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     ON CONFLICT (book_id, member_id) DO UPDATE SET
       current_page = EXCLUDED.current_page, total_pages = EXCLUDED.total_pages, progress_pct = EXCLUDED.progress_pct,
       completed = EXCLUDED.completed, last_read_at = NOW(), notes = COALESCE(EXCLUDED.notes, book_reading_progress.notes)
     RETURNING current_page, total_pages, progress_pct, completed, last_read_at, notes`,
    [bookId, memberId, currentPage, totalPages, pct, currentPage >= totalPages, notes]
  );
  return res.rows[0];
}

export async function countBookOpen(bookId) {
  await query('UPDATE library_books SET downloads_count = downloads_count + 1 WHERE id = $1', [bookId]);
}

// ---------------------------------------------------------------- notifications (reminders from real records) & announcements

/** Everything below is read-only and scoped to ONE member id. */
export async function getReminderSources(memberId, { withPt }) {
  const [workouts, diets, feedback, classesSoon, classesCancelled, fees, tx, pt] = await Promise.all([
    query(`SELECT wa.id, wa.created_at, wa.updated_at, wa.start_date, p.name, t.full_name AS trainer_name
             FROM member_workout_assignments wa JOIN workout_programs p ON p.id = wa.program_id LEFT JOIN trainers t ON t.id = wa.assigned_by_trainer_id
            WHERE wa.member_id = $1 AND wa.status = 'active' AND wa.created_at >= NOW() - INTERVAL '30 days' AND ${NOT_COACH_PLAN}`, [memberId]),
    query(`SELECT da.id, da.created_at, da.updated_at, da.start_date, dp.name, t.full_name AS trainer_name
             FROM member_diet_assignments da JOIN diet_plans dp ON dp.id = da.plan_id LEFT JOIN trainers t ON t.id = da.assigned_by_trainer_id
            WHERE da.member_id = $1 AND da.status = 'active' AND GREATEST(da.created_at, da.updated_at, dp.updated_at) >= NOW() - INTERVAL '30 days'`, [memberId]),
    query(`SELECT c.id, c.comment_type, c.comment_text, c.created_at, t.full_name AS trainer_name
             FROM member_trainer_comments c LEFT JOIN trainers t ON t.id = c.trainer_id
            WHERE c.member_id = $1 AND c.created_at >= NOW() - INTERVAL '30 days' ORDER BY c.created_at DESC LIMIT 20`, [memberId]),
    query(`SELECT oc.id, oc.title, oc.class_type, oc.scheduled_at FROM class_registrations r JOIN online_classes oc ON oc.id = r.class_id
            WHERE r.member_id = $1 AND r.status = 'registered' AND oc.status <> 'cancelled'
              AND oc.scheduled_at > NOW() AND oc.scheduled_at <= NOW() + INTERVAL '48 hours' ORDER BY oc.scheduled_at`, [memberId]),
    query(`SELECT oc.id, oc.title, oc.class_type, oc.scheduled_at FROM class_registrations r JOIN online_classes oc ON oc.id = r.class_id
            WHERE r.member_id = $1 AND r.status = 'registered' AND oc.status = 'cancelled' AND oc.scheduled_at >= NOW() - INTERVAL '1 day'
            ORDER BY oc.scheduled_at`, [memberId]),
    query(`SELECT fee_due, fee_due_date, payment_status FROM members WHERE id = $1`, [memberId]),
    query(`SELECT id, transaction_type, net_amount, payment_status, invoice_number, transaction_date FROM financial_transactions
            WHERE member_id = $1 AND transaction_date >= NOW() - INTERVAL '30 days' ORDER BY transaction_date DESC LIMIT 10`, [memberId]),
    withPt ? query(`SELECT s.public_id, s.scheduled_start, s.status, s.location, t.full_name AS trainer_name FROM pt_sessions s LEFT JOIN trainers t ON t.id = s.trainer_id
                     WHERE s.member_id = $1 AND s.status IN ('booked', 'confirmed') AND s.scheduled_start > NOW() AND s.scheduled_start <= NOW() + INTERVAL '48 hours'
                     ORDER BY s.scheduled_start`, [memberId]) : null,
  ]);
  return {
    workouts: workouts.rows, diets: diets.rows, feedback: feedback.rows, classesSoon: classesSoon.rows, classesCancelled: classesCancelled.rows,
    fees: fees.rows[0] || null, transactions: tx.rows, pt: pt ? pt.rows : null,
  };
}

/** Active announcements for today, in the member's language or for everyone. */
export async function listAnnouncementsForMember(memberId) {
  const res = await query(
    `SELECT a.id, a.title, a.message, a.priority, a.start_date, a.end_date, a.created_at,
            COALESCE(to_jsonb(a) ->> 'category', 'general') AS sport_category
       FROM announcements a
      WHERE a.is_active IS TRUE AND CURRENT_DATE BETWEEN a.start_date AND a.end_date
        AND COALESCE(to_jsonb(a) ->> 'audience', 'all') IN ('all', 'members')
        AND (a.target_language = 'all' OR a.target_language = (SELECT preferred_language FROM members WHERE id = $1))
      ORDER BY (a.priority = 'urgent') DESC, a.start_date DESC, a.id DESC`,
    [memberId]
  );
  return res.rows;
}

export async function listUpcomingGymEvents() {
  const res = await query(
    `SELECT id, title, type, start_date, end_date, status, registration_deadline FROM fitness_competitions
      WHERE status IN ('upcoming', 'in_progress') AND end_date >= CURRENT_DATE AND start_date <= CURRENT_DATE + 60
      ORDER BY start_date LIMIT 10`
  );
  return res.rows;
}

/** In-gym and live classes cancelled by the gym in the next 14 days (public timetable changes). */
export async function listCancelledUpcomingClasses() {
  const res = await query(
    `SELECT id, title, class_type, scheduled_at FROM online_classes
      WHERE status = 'cancelled' AND class_type IN ('in_person', 'live')
        AND scheduled_at >= NOW() AND scheduled_at <= NOW() + INTERVAL '14 days'
      ORDER BY scheduled_at LIMIT 20`
  );
  return res.rows;
}

// ---------------------------------------------------------------- feedback & complaints (Admin Retention → Feedback & Complaints)
// Feedback / suggestions → member_feedbacks; complaints / enquiries → member_complaints tickets.
// Every read is WHERE member_id = $1 — a member never sees another member's submissions.

export async function listMyFeedbacks(memberId) {
  const res = await query(
    `SELECT id, nps_score, category, sentiment, feedback_text, status, admin_response, created_at
       FROM member_feedbacks WHERE member_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`,
    [memberId]
  );
  return res.rows;
}

export async function listMyComplaints(memberId) {
  const res = await query(
    `SELECT id, ticket_number, category, priority, subject, description, resolution_notes, status, resolved_at, created_at, updated_at
       FROM member_complaints WHERE member_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`,
    [memberId]
  );
  return res.rows;
}

export async function countMySubmissionsToday(memberId) {
  const res = await query(
    `SELECT (SELECT COUNT(*) FROM member_feedbacks WHERE member_id = $1 AND created_at >= CURRENT_DATE)
          + (SELECT COUNT(*) FROM member_complaints WHERE member_id = $1 AND created_at >= CURRENT_DATE) AS n`,
    [memberId]
  );
  return Number(res.rows[0].n);
}

/** Trainers the member has actually trained with (PT assignments, any status) or booked a class with. */
export async function listMyFeedbackTrainers(memberId) {
  const res = await query(
    `SELECT DISTINCT t.id, t.full_name FROM trainers t
      WHERE t.id IN (SELECT trainer_id FROM personal_trainer_assignments WHERE member_id = $1)
         OR t.id IN (SELECT oc.instructor_trainer_id FROM class_registrations r JOIN online_classes oc ON oc.id = r.class_id
                      WHERE r.member_id = $1 AND r.status <> 'cancelled')
      ORDER BY t.full_name`,
    [memberId]
  );
  return res.rows;
}

/** Classes the member booked in the last 90 days that have started (so there is something to review). */
export async function listMyFeedbackClasses(memberId) {
  const res = await query(
    `SELECT oc.id, oc.title, oc.scheduled_at, oc.class_type, t.full_name AS trainer_name
       FROM class_registrations r JOIN online_classes oc ON oc.id = r.class_id LEFT JOIN trainers t ON t.id = oc.instructor_trainer_id
      WHERE r.member_id = $1 AND r.status <> 'cancelled' AND oc.scheduled_at <= NOW() AND oc.scheduled_at >= NOW() - INTERVAL '90 days'
      ORDER BY oc.scheduled_at DESC LIMIT 30`,
    [memberId]
  );
  return res.rows;
}

export async function insertMemberFeedback({ memberId, score, category, sentiment, text }) {
  const res = await query(
    `INSERT INTO member_feedbacks (member_id, nps_score, category, sentiment, feedback_text, status)
     VALUES ($1, $2, $3, $4, $5, 'new') RETURNING id, created_at`,
    [memberId, score, category, sentiment, text]
  );
  return res.rows[0];
}

/** Ticket numbers keep the admin format (CMP-YYYY-…) but use 6 random hex chars; retried on the rare clash. */
export async function insertMemberComplaint({ memberId, category, priority, subject, description }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ticket = `CMP-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    try {
      const res = await query(
        `INSERT INTO member_complaints (ticket_number, member_id, category, priority, subject, description, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'open') RETURNING id, ticket_number, created_at`,
        [ticket, memberId, category, priority, subject, description]
      );
      return res.rows[0];
    } catch (e) {
      if (e.code !== '23505') throw e; // unique ticket clash → try another number
    }
  }
  const e = new Error('Could not create a ticket number — please try again.'); e.status = 503; throw e;
}

// ---------------------------------------------------------------- attendance (check_ins: Admin check-in + FitBot kiosk)
// Read-only for members — this module never inserts check-ins (duplicates are also blocked by
// trg_check_in_duplicate_guard). All periods use the database clock/time zone.

export async function listMyCheckIns(memberId, { limit, offset, from = null, to = null }) {
  const where = `c.member_id = $1 AND ($2::date IS NULL OR c.check_in_time >= $2::date) AND ($3::date IS NULL OR c.check_in_time < ($3::date + 1))`;
  const [rows, count] = await Promise.all([
    query(
      `SELECT c.id, c.check_in_time, c.check_in_method, d.device_name, d.location_zone
         FROM check_ins c LEFT JOIN robot_devices d ON d.id = c.device_id
        WHERE ${where} ORDER BY c.check_in_time DESC, c.id DESC LIMIT $4 OFFSET $5`,
      [memberId, from, to, limit, offset]
    ),
    query(`SELECT COUNT(*)::int AS total FROM check_ins c WHERE ${where}`, [memberId, from, to]),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

export async function getAttendanceStats(memberId) {
  const [sum, weekly, monthly, dow, hours] = await Promise.all([
    query(
      `SELECT COUNT(DISTINCT check_in_time::date)::int AS total_days,
              MIN(check_in_time) AS first_visit, MAX(check_in_time) AS last_visit,
              COUNT(DISTINCT check_in_time::date) FILTER (WHERE check_in_time >= date_trunc('week', NOW()))::int AS this_week,
              COUNT(DISTINCT check_in_time::date) FILTER (WHERE check_in_time >= date_trunc('week', NOW()) - INTERVAL '7 days' AND check_in_time < date_trunc('week', NOW()))::int AS last_week,
              COUNT(DISTINCT check_in_time::date) FILTER (WHERE check_in_time >= date_trunc('month', NOW()))::int AS this_month,
              COUNT(DISTINCT check_in_time::date) FILTER (WHERE check_in_time >= date_trunc('month', NOW()) - INTERVAL '1 month' AND check_in_time < date_trunc('month', NOW()))::int AS last_month,
              COUNT(DISTINCT check_in_time::date) FILTER (WHERE check_in_time >= NOW() - INTERVAL '30 days')::int AS last_30_days
         FROM check_ins WHERE member_id = $1`,
      [memberId]
    ),
    query(
      `SELECT w::date AS week_start, COUNT(DISTINCT c.check_in_time::date)::int AS days
         FROM generate_series(date_trunc('week', NOW()) - INTERVAL '11 weeks', date_trunc('week', NOW()), INTERVAL '1 week') w
         LEFT JOIN check_ins c ON c.member_id = $1 AND c.check_in_time >= w AND c.check_in_time < w + INTERVAL '1 week'
        GROUP BY w ORDER BY w`,
      [memberId]
    ),
    query(
      `SELECT m::date AS month_start, COUNT(DISTINCT c.check_in_time::date)::int AS days,
              EXTRACT(DAY FROM (m + INTERVAL '1 month' - INTERVAL '1 day'))::int AS days_in_month
         FROM generate_series(date_trunc('month', NOW()) - INTERVAL '11 months', date_trunc('month', NOW()), INTERVAL '1 month') m
         LEFT JOIN check_ins c ON c.member_id = $1 AND c.check_in_time >= m AND c.check_in_time < m + INTERVAL '1 month'
        GROUP BY m ORDER BY m`,
      [memberId]
    ),
    query(
      `SELECT EXTRACT(ISODOW FROM check_in_time)::int AS dow, COUNT(*)::int AS n
         FROM check_ins WHERE member_id = $1 AND check_in_time >= NOW() - INTERVAL '90 days' GROUP BY 1`,
      [memberId]
    ),
    query(
      `SELECT EXTRACT(HOUR FROM check_in_time)::int AS hour, COUNT(*)::int AS n
         FROM check_ins WHERE member_id = $1 AND check_in_time >= NOW() - INTERVAL '90 days' GROUP BY 1`,
      [memberId]
    ),
  ]);
  return { summary: sum.rows[0], weekly: weekly.rows, monthly: monthly.rows, dow: dow.rows, hours: hours.rows };
}

// ---------------------------------------------------------------- gym facilities (Admin gym settings + Staff Operations + Inventory)
// Member-safe columns only: no costs, serial numbers, suppliers, technician names or staff ids.

export async function getGymProfileForMembers() {
  const res = await query(
    `SELECT gym_name, tagline, address, phone, email, operating_hours FROM (
        SELECT gym_name, tagline, address, phone, email, operating_hours, 1 AS pri FROM gym_settings WHERE id = 1
        UNION ALL
        SELECT gym_name, tagline, address, phone, email, operating_hours, 2 FROM gym_profile) g
      ORDER BY pri LIMIT 1`
  );
  return res.rows[0] || null;
}

export async function listActiveBranches() {
  const res = await query(`SELECT id, name, address, city, operating_hours FROM gym_branches WHERE is_active IS TRUE ORDER BY id`);
  return res.rows;
}

export async function listFacilitiesForMembers() {
  const res = await query(
    `SELECT f.id, f.zone_name, f.facility_type, f.capacity, f.floor_number, f.status, f.notes, f.branch_id, b.name AS branch_name,
            EXISTS (SELECT 1 FROM facility_maintenance_logs m WHERE m.facility_id = f.id AND m.status = 'in_progress') AS maintenance_in_progress,
            EXISTS (SELECT 1 FROM facility_maintenance_logs m WHERE m.facility_id = f.id AND m.status = 'scheduled' AND m.scheduled_date = CURRENT_DATE) AS maintenance_today
       FROM gym_facilities f LEFT JOIN gym_branches b ON b.id = f.branch_id
      WHERE b.id IS NULL OR b.is_active IS TRUE
      ORDER BY b.id NULLS LAST, f.floor_number, f.zone_name`
  );
  return res.rows;
}

/** Ongoing / upcoming maintenance, plus work completed in the last 14 days. */
export async function listMaintenanceForMembers() {
  const res = await query(
    `SELECT m.id, m.maintenance_type, m.scheduled_date, m.completed_date, m.status, m.notes,
            f.zone_name, f.floor_number, b.name AS branch_name
       FROM facility_maintenance_logs m
       JOIN gym_facilities f ON f.id = m.facility_id LEFT JOIN gym_branches b ON b.id = COALESCE(m.branch_id, f.branch_id)
      WHERE m.status = 'in_progress'
         OR (m.status = 'scheduled' AND m.scheduled_date >= CURRENT_DATE - 1)
         OR (m.status = 'completed' AND m.completed_date >= CURRENT_DATE - 14)
      ORDER BY CASE m.status WHEN 'in_progress' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, m.scheduled_date
      LIMIT 50`
  );
  return res.rows;
}

/** Equipment counts by category & zone and condition — no asset details. */
export async function summariseEquipment() {
  const res = await query(
    `SELECT COALESCE(NULLIF(category, ''), 'Other') AS category, COALESCE(NULLIF(floor_zone, ''), 'Gym floor') AS zone,
            COUNT(*) FILTER (WHERE condition_status IN ('operational', 'good'))::int AS available,
            COUNT(*) FILTER (WHERE condition_status IN ('maintenance_needed', 'out_of_service'))::int AS unavailable,
            COUNT(*) FILTER (WHERE condition_status IS NULL OR condition_status NOT IN ('operational', 'good', 'maintenance_needed', 'out_of_service'))::int AS unknown,
            array_agg(DISTINCT name ORDER BY name) FILTER (WHERE condition_status IN ('operational', 'good')) AS available_names,
            array_agg(DISTINCT name ORDER BY name) FILTER (WHERE condition_status IN ('maintenance_needed', 'out_of_service')) AS unavailable_names
       FROM gym_equipment GROUP BY 1, 2 ORDER BY 1, 2`
  );
  return res.rows;
}

export async function listFacilityAnnouncements(memberId) {
  const res = await query(
    `SELECT id, title, message, start_date, end_date FROM announcements
      WHERE is_active IS TRUE AND priority = 'maintenance' AND CURRENT_DATE BETWEEN start_date AND end_date
        AND (target_language = 'all' OR target_language = (SELECT preferred_language FROM members WHERE id = $1))
      ORDER BY start_date DESC`,
    [memberId]
  );
  return res.rows;
}

// ---------------------------------------------------------------- member preferences (migration 023)

let prefsCache = { at: 0, ok: false };
/** True once migration 023 (member_preferences) is applied. */
export async function preferencesAvailable() {
  if (Date.now() - prefsCache.at < 60000) return prefsCache.ok;
  const r = await query(`SELECT to_regclass('public.member_preferences') IS NOT NULL AS ok`);
  prefsCache = { at: Date.now(), ok: r.rows[0].ok };
  return prefsCache.ok;
}

export async function getMemberPreferences(memberId) {
  const r = await query('SELECT * FROM member_preferences WHERE member_id = $1', [memberId]);
  return r.rows[0] || null;
}

export async function saveMemberPreferences(memberId, p) {
  const r = await query(
    `INSERT INTO member_preferences (member_id, notify_workout, notify_diet, notify_pt, notify_classes, notify_membership,
                                     notify_payments, notify_feedback, notify_messages, leaderboard_visibility, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (member_id) DO UPDATE SET
       notify_workout = EXCLUDED.notify_workout, notify_diet = EXCLUDED.notify_diet, notify_pt = EXCLUDED.notify_pt,
       notify_classes = EXCLUDED.notify_classes, notify_membership = EXCLUDED.notify_membership,
       notify_payments = EXCLUDED.notify_payments, notify_feedback = EXCLUDED.notify_feedback,
       notify_messages = EXCLUDED.notify_messages, leaderboard_visibility = EXCLUDED.leaderboard_visibility, updated_at = NOW()
     RETURNING *`,
    [memberId, p.notify_workout, p.notify_diet, p.notify_pt, p.notify_classes, p.notify_membership,
      p.notify_payments, p.notify_feedback, p.notify_messages, p.leaderboard_visibility]
  );
  return r.rows[0];
}

/** Members (of a given list) who chose to appear anonymously on leaderboards. */
export async function anonymousLeaderboardMembers(memberIds) {
  if (!memberIds.length) return new Set();
  const r = await query(`SELECT member_id FROM member_preferences WHERE leaderboard_visibility = 'anonymous' AND member_id = ANY($1::int[])`, [memberIds]);
  return new Set(r.rows.map((x) => x.member_id));
}

export async function getAccountSummary(memberId) {
  const r = await query(
    `SELECT u.username, u.email, u.last_login_at, u.is_active, m.preferred_language
       FROM members m LEFT JOIN users u ON u.member_id = m.id AND u.role = 'member'
      WHERE m.id = $1 ORDER BY u.id LIMIT 1`,
    [memberId]
  );
  return r.rows[0] || null;
}

// ===========================================================================
// PT booking responses (member → trainer). Only the member's OWN sessions; rows are
// updated in place (never deleted) so the booking history is preserved.
// ===========================================================================

/** Confirm a trainer-booked session, or decline a booked/confirmed one before it starts. */
export async function respondToPtSession(memberId, publicId, { response, reason }) {
  const res = response === 'confirm'
    ? await query(
      `UPDATE pt_sessions SET status = 'confirmed'
        WHERE public_id = $1 AND member_id = $2 AND status = 'booked' AND scheduled_start > NOW()
        RETURNING public_id, status, scheduled_start, trainer_id`,
      [publicId, memberId])
    : await query(
      `UPDATE pt_sessions SET status = 'cancelled', cancelled_at = NOW(),
              cancellation_reason = LEFT('Declined by member' || COALESCE(': ' || $3, ''), 255)
        WHERE public_id = $1 AND member_id = $2 AND status IN ('booked', 'confirmed')
          AND scheduled_start > NOW() AND balance_deducted = FALSE
        RETURNING public_id, status, scheduled_start, trainer_id, cancellation_reason`,
      [publicId, memberId, reason]);
  return res.rows[0] || null;
}

/** One rating per completed session; an existing rating is never overwritten. */
export async function ratePtSession(memberId, publicId, { rating, feedback }) {
  const res = await query(
    `UPDATE pt_sessions SET member_rating = $3, member_feedback = $4
      WHERE public_id = $1 AND member_id = $2 AND status = 'completed' AND member_rating IS NULL
      RETURNING public_id, status, member_rating, member_feedback, trainer_id`,
    [publicId, memberId, rating, feedback]);
  return res.rows[0] || null;
}

/** Current state of one of the member's own sessions (used to explain a refused response). */
export async function getOwnPtSessionState(memberId, publicId) {
  const res = await query(
    `SELECT status, scheduled_start, member_rating, (scheduled_start <= NOW()) AS started
       FROM pt_sessions WHERE public_id = $1 AND member_id = $2`,
    [publicId, memberId]);
  return res.rows[0] || null;
}

/**
 * Muscle work from this member's completed workouts in the last `days` days (read-only).
 * Uses the logged sets (workout_session_items → exercises); a session logged without sets but for a
 * programme day falls back to that day's planned exercises. One row per session × exercise.
 */
export async function getRecentMuscleWork(memberId, days = 7) {
  const res = await query(
    `WITH s AS (
       SELECT id, completed_at, rpe_rating, day_id FROM workout_session_logs
        WHERE member_id = $1 AND completed_at >= NOW() - make_interval(days => $2::int) AND completed_at <= NOW()
     )
     SELECT s.id AS session_id, s.completed_at, s.rpe_rating, e.name AS exercise, e.muscle_group, e.target_muscles,
            COUNT(i.id)::int AS sets
       FROM s
       JOIN workout_session_items i ON i.session_log_id = s.id
       JOIN exercises e ON e.id = i.exercise_id
      GROUP BY s.id, s.completed_at, s.rpe_rating, e.name, e.muscle_group, e.target_muscles
     UNION ALL
     SELECT s.id, s.completed_at, s.rpe_rating, e.name, e.muscle_group, e.target_muscles, COALESCE(pe.sets, 0)::int
       FROM s
       JOIN workout_program_exercises pe ON pe.day_id = s.day_id
       JOIN exercises e ON e.id = pe.exercise_id
      WHERE NOT EXISTS (SELECT 1 FROM workout_session_items x WHERE x.session_log_id = s.id)
      ORDER BY 2 DESC`,
    [memberId, days]
  );
  return res.rows;
}

/** Muscle groups the member reported as sore on their latest check-in from today or yesterday (read-only). */
export async function getRecentSoreness(memberId) {
  const res = await query(
    `SELECT r.log_date, s.muscle_group, s.soreness_level
       FROM member_recovery_logs r
       JOIN member_muscle_soreness_details s ON s.recovery_log_id = r.id
      WHERE r.member_id = $1 AND r.log_date >= CURRENT_DATE - 1
      ORDER BY r.log_date DESC, s.id`,
    [memberId]
  );
  return res.rows;
}

/** Exercises in the member's ACTIVE assigned programmes, with the planned sets / reps (read-only). */
export async function getAssignedExercises(memberId) {
  const res = await query(
    `SELECT p.id AS program_id, p.name AS program_name, (p.description = 'MEMBER_SELF_PLAN:' || a.member_id) AS is_own,
            (p.description LIKE 'TRAINER_MUSCLE_PLAN:' || a.member_id || ':%') AS is_coach_plan, p.trainer_id, d.id AS day_id, d.day_number, d.day_name,
            pe.id AS plan_id, pe.exercise_id, e.name AS exercise, e.muscle_group, e.target_muscles,
            pe.sets, pe.reps, pe.target_weight_kg, pe.rest_seconds, pe.order_index
       FROM member_workout_assignments a
       JOIN workout_programs p ON p.id = a.program_id
       JOIN workout_program_days d ON d.program_id = p.id
       JOIN workout_program_exercises pe ON pe.day_id = d.id
       JOIN exercises e ON e.id = pe.exercise_id
      WHERE a.member_id = $1 AND a.status = 'active'
        AND (a.start_date IS NULL OR a.start_date <= CURRENT_DATE) AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      ORDER BY p.id, d.day_number, pe.order_index, pe.id`,
    [memberId]
  );
  return res.rows;
}

/** Sets the member logged TODAY per exercise, with the reps of each set (read-only). */
export async function getTodayLoggedSets(memberId) {
  const res = await query(
    `SELECT i.exercise_id, COUNT(*)::int AS sets, COALESCE(json_agg(i.reps_completed ORDER BY i.set_number), '[]') AS reps,
            MAX(i.weight_kg) AS top_weight_kg
       FROM workout_session_logs s
       JOIN workout_session_items i ON i.session_log_id = s.id
      WHERE s.member_id = $1 AND s.completed_at >= CURRENT_DATE AND s.completed_at < CURRENT_DATE + 1
      GROUP BY i.exercise_id`,
    [memberId]
  );
  return res.rows;
}

// ---------------------------------------------------------------- member's own plan ("My own plan")
// Stored in the existing workout tables: one non-template workout_programs row per member (description holds a
// marker), one day, its exercises, and an active member_workout_assignments row (no trainer). Trainers see it in
// the client's workouts like any other programme.
export const SELF_PLAN_MARK = (memberId) => `MEMBER_SELF_PLAN:${memberId}`;

export const TRAINER_PLAN_MARK = (memberId, trainerId) => `TRAINER_MUSCLE_PLAN:${memberId}:${trainerId}`;

async function planIdsByMark(mark, client) {
  const ex = client || { query };
  const r = await ex.query(
    `SELECT p.id AS program_id, (SELECT id FROM workout_program_days WHERE program_id = p.id ORDER BY day_number, id LIMIT 1) AS day_id
       FROM workout_programs p WHERE p.description = $1 AND p.is_template = FALSE ORDER BY p.id LIMIT 1`,
    [mark]
  );
  return r.rows[0] || null;
}
export const getSelfPlanIds = (memberId, client) => planIdsByMark(SELF_PLAN_MARK(memberId), client);

/** Library exercises whose muscle group / target muscles match the given text patterns (read-only). */
export async function findExercisesForMuscle(patterns, groups) {
  const r = await query(
    `SELECT id, name, muscle_group, target_muscles, equipment, difficulty FROM exercises
      WHERE LOWER(COALESCE(target_muscles, '') || ' ' || name) ~ $1 OR LOWER(muscle_group) = ANY($2)
      ORDER BY name LIMIT 100`,
    [patterns, groups]
  );
  return r.rows;
}

/** Add (or update) an exercise in the member's own plan. Creates the plan, its day and assignment on first use. */
/**
 * Add (or update) an exercise in a per-member plan programme identified by spec.mark. Creates the programme,
 * its day and the member's active assignment on first use.
 *   spec: { mark, name, trainerId|null, dayName, focus, note, addedBy }
 */
export async function upsertPlanExercise(memberId, spec, { exerciseId, newExercise, sets, reps, weightKg }) {
  return withTransaction(async (c) => {
    let ids = await planIdsByMark(spec.mark, c);
    if (!ids) {
      const p = (await c.query(
        `INSERT INTO workout_programs (name, trainer_id, difficulty_level, goal, split_type, description, is_template)
         VALUES ($1, $2, 'Beginner', 'General Fitness', 'Custom', $3, FALSE) RETURNING id`, [spec.name, spec.trainerId, spec.mark])).rows[0].id;
      const d = (await c.query(`INSERT INTO workout_program_days (program_id, day_number, day_name, focus) VALUES ($1, 1, $2, $3) RETURNING id`, [p, spec.dayName, spec.focus])).rows[0].id;
      await c.query(`INSERT INTO member_workout_assignments (member_id, program_id, assigned_by_trainer_id, start_date, status, trainer_notes) VALUES ($1, $2, $3, CURRENT_DATE, 'active', $4)`, [memberId, p, spec.trainerId, spec.note]);
      ids = { program_id: p, day_id: d };
    }
    let exId = exerciseId;
    if (!exId && newExercise) {
      const found = await c.query('SELECT id FROM exercises WHERE LOWER(name) = LOWER($1) LIMIT 1', [newExercise.name]);
      exId = found.rows[0]?.id || (await c.query(
        `INSERT INTO exercises (name, muscle_group, equipment, difficulty, instructions, target_muscles)
         VALUES ($1, $2, 'Other', 'Beginner', $4, $3) RETURNING id`,
        [newExercise.name, newExercise.muscleGroup, newExercise.targetMuscles, spec.addedBy])).rows[0].id;
    }
    const existing = await c.query('SELECT id FROM workout_program_exercises WHERE day_id = $1 AND exercise_id = $2 LIMIT 1', [ids.day_id, exId]);
    let row;
    if (existing.rowCount) {
      row = (await c.query(`UPDATE workout_program_exercises SET sets = $1, reps = $2, target_weight_kg = $3 WHERE id = $4 RETURNING id`, [sets, reps, weightKg, existing.rows[0].id])).rows[0];
    } else {
      const next = (await c.query('SELECT COALESCE(MAX(order_index), 0) + 1 AS n FROM workout_program_exercises WHERE day_id = $1', [ids.day_id])).rows[0].n;
      row = (await c.query(
        `INSERT INTO workout_program_exercises (day_id, exercise_id, sets, reps, target_weight_kg, rest_seconds, order_index, notes)
         VALUES ($1, $2, $3, $4, $5, 90, $6, $7) RETURNING id`, [ids.day_id, exId, sets, reps, weightKg, next, spec.itemNote])).rows[0];
    }
    await c.query(`UPDATE member_workout_assignments SET status = 'active', end_date = NULL, updated_at = NOW() WHERE member_id = $1 AND program_id = $2`, [memberId, ids.program_id]);
    return { planExerciseId: row.id, exerciseId: exId, programId: ids.program_id, dayId: ids.day_id, updated: existing.rowCount > 0 };
  });
}

export const upsertSelfPlanExercise = (memberId, input) => upsertPlanExercise(memberId, {
  mark: SELF_PLAN_MARK(memberId), name: 'My own plan', trainerId: null, dayName: 'My exercises', focus: 'Member chosen',
  note: 'Added by the member from the Recovery page', addedBy: 'Added by a member from the Recovery page.', itemNote: 'Added by member',
}, input);
export const upsertTrainerPlanExercise = (trainerId, memberId, input) => upsertPlanExercise(memberId, {
  mark: TRAINER_PLAN_MARK(memberId, trainerId), name: 'Coach muscle plan', trainerId, dayName: 'Coach assigned', focus: 'Assigned per muscle',
  note: 'Assigned by the trainer from the muscle recovery view', addedBy: 'Added by a trainer from the muscle recovery view.', itemNote: 'Assigned by trainer',
}, input);

/** Remove one exercise from THIS trainer's muscle plan for this member only. */
export async function removeTrainerPlanExercise(trainerId, memberId, planExerciseId) {
  const ids = await planIdsByMark(TRAINER_PLAN_MARK(memberId, trainerId));
  if (!ids) return 0;
  const r = await query('DELETE FROM workout_program_exercises WHERE id = $1 AND day_id = $2', [planExerciseId, ids.day_id]);
  return r.rowCount;
}

/** Remove one exercise from the member's OWN plan only (logged history is not touched). */
export async function removeSelfPlanExercise(memberId, planExerciseId) {
  const ids = await getSelfPlanIds(memberId);
  if (!ids) return 0;
  const r = await query('DELETE FROM workout_program_exercises WHERE id = $1 AND day_id = $2', [planExerciseId, ids.day_id]);
  return r.rowCount;
}


// ---------------------------------------------------------------- trainer "Complete / Not done" marks (migration 032)
// Trainer-only marks on exercises the trainer assigned from the muscle-recovery view. Members never read this table.

/** Today's marks for one member: Map(planExerciseId → true | false). Empty when migration 032 is not applied. */
export async function getTrainerChecksToday(memberId) {
  const ok = (await query(`SELECT to_regclass('public.trainer_exercise_checks') IS NOT NULL AS ok`)).rows[0].ok;
  if (!ok) return null;
  const r = await query('SELECT plan_exercise_id, completed FROM trainer_exercise_checks WHERE member_id = $1 AND check_date = CURRENT_DATE', [memberId]);
  return new Map(r.rows.map((x) => [x.plan_exercise_id, x.completed]));
}

/** Set (true / false) or clear (null) today's mark — only on THIS trainer's coach plan for this member. Returns false if not theirs. */
export async function setTrainerCheckToday(trainerId, memberId, planExerciseId, completed, userId) {
  const ids = await planIdsByMark(TRAINER_PLAN_MARK(memberId, trainerId));
  if (!ids) return false;
  const own = await query('SELECT 1 FROM workout_program_exercises WHERE id = $1 AND day_id = $2', [planExerciseId, ids.day_id]);
  if (!own.rowCount) return false;
  if (completed === null) {
    await query('DELETE FROM trainer_exercise_checks WHERE plan_exercise_id = $1 AND check_date = CURRENT_DATE', [planExerciseId]);
  } else {
    await query(
      `INSERT INTO trainer_exercise_checks (plan_exercise_id, member_id, trainer_id, check_date, completed, marked_by)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, $5)
       ON CONFLICT (plan_exercise_id, check_date) DO UPDATE SET completed = EXCLUDED.completed, trainer_id = EXCLUDED.trainer_id,
         marked_by = EXCLUDED.marked_by, updated_at = NOW()`,
      [planExerciseId, memberId, trainerId, completed, userId || null]);
  }
  return true;
}

/** Coach-plan exercises the trainer marked ✓ Complete in the last 7 days: Map(planExerciseId → latest time marked). */
export async function getTrainerCompletedRecent(memberId, days = 7) {
  const ok = (await query(`SELECT to_regclass('public.trainer_exercise_checks') IS NOT NULL AS ok`)).rows[0].ok;
  if (!ok) return new Map();
  const r = await query(
    `SELECT plan_exercise_id, MAX(updated_at) AS at FROM trainer_exercise_checks
      WHERE member_id = $1 AND completed = TRUE AND check_date >= CURRENT_DATE - ($2::int - 1)
      GROUP BY plan_exercise_id`, [memberId, days]);
  return new Map(r.rows.map((x) => [x.plan_exercise_id, new Date(x.at).getTime()]));
}
