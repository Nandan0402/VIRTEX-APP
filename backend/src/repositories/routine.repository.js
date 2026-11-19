import { query } from '../config/database.js';

/**
 * Get the current routine session status for today for a given user or active session
 */
export async function getCurrentRoutineStatus(userId = null) {
  // Find open or latest punch for today
  let userClause = '';
  let params = [];
  if (userId) {
    userClause = 'AND (user_id = $1 OR user_id IS NULL)';
    params.push(userId);
  }

  const sql = `
    SELECT 
      p.id,
      p.user_id,
      p.user_name,
      p.user_role,
      p.punch_date,
      p.punch_in,
      p.punch_out,
      p.status,
      COALESCE(p.total_break_seconds, 0) AS total_break_seconds,
      COALESCE(p.total_work_seconds, 0) AS total_work_seconds,
      p.routine_notes,
      p.created_at,
      p.updated_at
    FROM routine_punches p
    WHERE p.punch_date = CURRENT_DATE ${userClause}
    ORDER BY p.id DESC
    LIMIT 1;
  `;

  const res = await query(sql, params);
  const punch = res.rows[0] || null;

  if (!punch) {
    return {
      status: 'punched_out',
      punch: null,
      activeBreak: null,
      elapsedWorkSeconds: 0,
      elapsedBreakSeconds: 0,
      totalBreakSeconds: 0,
      todaySummary: await getTodaySummary(userId),
    };
  }

  // Get breaks for this punch
  const breaksRes = await query(
    `SELECT * FROM routine_punch_breaks WHERE punch_id = $1 ORDER BY id ASC`,
    [punch.id]
  );
  const breaks = breaksRes.rows;
  const activeBreak = breaks.find((b) => !b.break_end) || null;

  // Calculate live elapsed seconds
  let elapsedWorkSeconds = parseInt(punch.total_work_seconds, 10) || 0;
  let elapsedBreakSeconds = 0;
  let totalBreakSeconds = parseInt(punch.total_break_seconds, 10) || 0;

  const now = new Date();

  if (punch.status === 'punched_in') {
    const punchInTime = new Date(punch.punch_in);
    const totalElapsedSec = Math.floor((now.getTime() - punchInTime.getTime()) / 1000);
    elapsedWorkSeconds = Math.max(0, totalElapsedSec - totalBreakSeconds);
  } else if (punch.status === 'on_break' && activeBreak) {
    const breakStartTime = new Date(activeBreak.break_start);
    elapsedBreakSeconds = Math.max(0, Math.floor((now.getTime() - breakStartTime.getTime()) / 1000));
    const punchInTime = new Date(punch.punch_in);
    const timeBeforeBreak = Math.floor((breakStartTime.getTime() - punchInTime.getTime()) / 1000);
    elapsedWorkSeconds = Math.max(0, timeBeforeBreak - totalBreakSeconds);
    totalBreakSeconds += elapsedBreakSeconds;
  }

  return {
    status: punch.status,
    punch: {
      ...punch,
      breaks,
    },
    activeBreak,
    elapsedWorkSeconds,
    elapsedBreakSeconds,
    totalBreakSeconds,
    todaySummary: await getTodaySummary(userId),
  };
}

/**
 * Punch In
 */
export async function punchIn({ userId = null, userName = 'Admin / Owner', userRole = 'owner', notes = '' } = {}) {
  // Check if there is already an active (unclosed) punch today
  const existing = await getCurrentRoutineStatus(userId);
  if (existing.punch && existing.status !== 'punched_out') {
    return existing;
  }

  const sql = `
    INSERT INTO routine_punches (
      user_id, user_name, user_role, punch_date, punch_in, status, routine_notes
    ) VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_TIMESTAMP, 'punched_in', $4)
    RETURNING *;
  `;

  const res = await query(sql, [userId, userName, userRole, notes]);
  return await getCurrentRoutineStatus(userId);
}

/**
 * Start Break
 */
export async function startBreak(userId = null, reason = 'Routine Break') {
  const current = await getCurrentRoutineStatus(userId);
  if (!current.punch || current.status !== 'punched_in') {
    throw new Error('Cannot start break: Active punched in session not found.');
  }

  // Insert break record
  await query(
    `INSERT INTO routine_punch_breaks (punch_id, break_start, break_reason) VALUES ($1, CURRENT_TIMESTAMP, $2)`,
    [current.punch.id, reason]
  );

  // Update status to on_break
  await query(
    `UPDATE routine_punches SET status = 'on_break', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [current.punch.id]
  );

  return await getCurrentRoutineStatus(userId);
}

/**
 * End Break
 */
export async function endBreak(userId = null) {
  const current = await getCurrentRoutineStatus(userId);
  if (!current.punch || current.status !== 'on_break') {
    throw new Error('Cannot end break: You are not currently on a break.');
  }

  const punchId = current.punch.id;

  // Find active open break
  const activeBreakRes = await query(
    `SELECT * FROM routine_punch_breaks WHERE punch_id = $1 AND break_end IS NULL ORDER BY id DESC LIMIT 1`,
    [punchId]
  );

  if (activeBreakRes.rows[0]) {
    const breakId = activeBreakRes.rows[0].id;
    const breakStart = new Date(activeBreakRes.rows[0].break_start);
    const now = new Date();
    const durationSeconds = Math.max(0, Math.floor((now.getTime() - breakStart.getTime()) / 1000));

    await query(
      `UPDATE routine_punch_breaks SET break_end = CURRENT_TIMESTAMP, duration_seconds = $1 WHERE id = $2`,
      [durationSeconds, breakId]
    );

    await query(
      `UPDATE routine_punches 
       SET status = 'punched_in', 
           total_break_seconds = total_break_seconds + $1,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [durationSeconds, punchId]
    );
  } else {
    await query(`UPDATE routine_punches SET status = 'punched_in', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [punchId]);
  }

  return await getCurrentRoutineStatus(userId);
}

/**
 * Punch Out
 */
export async function punchOut(userId = null, notes = '') {
  const current = await getCurrentRoutineStatus(userId);
  if (!current.punch || current.status === 'punched_out') {
    throw new Error('Cannot punch out: No active punch session found.');
  }

  const punchId = current.punch.id;

  // If on break, close open break first
  if (current.status === 'on_break') {
    await endBreak(userId);
  }

  const now = new Date();
  const punchRow = (await query(`SELECT * FROM routine_punches WHERE id = $1`, [punchId])).rows[0];
  const punchInTime = new Date(punchRow.punch_in);
  const totalDuration = Math.max(0, Math.floor((now.getTime() - punchInTime.getTime()) / 1000));
  const totalBreakSec = parseInt(punchRow.total_break_seconds, 10) || 0;
  const netWorkSec = Math.max(0, totalDuration - totalBreakSec);

  const updatedNotes = notes
    ? (punchRow.routine_notes ? `${punchRow.routine_notes} | Punch Out: ${notes}` : notes)
    : punchRow.routine_notes;

  await query(
    `UPDATE routine_punches 
     SET punch_out = CURRENT_TIMESTAMP, 
         status = 'punched_out', 
         total_work_seconds = $1, 
         routine_notes = $2, 
         updated_at = CURRENT_TIMESTAMP 
     WHERE id = $3`,
    [netWorkSec, updatedNotes, punchId]
  );

  return await getCurrentRoutineStatus(userId);
}

/**
 * Get routine history logs
 */
export async function getRoutineHistory({ date = null, userId = null, limit = 50, offset = 0 } = {}) {
  let conditions = [];
  let params = [];
  let idx = 1;

  if (date) {
    conditions.push(`p.punch_date = $${idx++}`);
    params.push(date);
  }

  if (userId) {
    conditions.push(`p.user_id = $${idx++}`);
    params.push(userId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT 
      p.id,
      p.user_id,
      p.user_name,
      p.user_role,
      p.punch_date,
      p.punch_in,
      p.punch_out,
      p.status,
      p.total_break_seconds,
      p.total_work_seconds,
      p.routine_notes,
      p.created_at,
      p.updated_at,
      COALESCE(
        json_agg(
          json_build_object(
            'id', b.id,
            'break_start', b.break_start,
            'break_end', b.break_end,
            'duration_seconds', b.duration_seconds,
            'break_reason', b.break_reason
          ) ORDER BY b.id ASC
        ) FILTER (WHERE b.id IS NOT NULL),
        '[]'
      ) AS breaks
    FROM routine_punches p
    LEFT JOIN routine_punch_breaks b ON b.punch_id = p.id
    ${whereClause}
    GROUP BY p.id
    ORDER BY p.punch_date DESC, p.id DESC
    LIMIT $${idx++} OFFSET $${idx++};
  `;

  params.push(limit, offset);
  const res = await query(sql, params);
  return res.rows;
}

/**
 * Summary for today and weekly stats
 */
export async function getTodaySummary(userId = null) {
  const sql = `
    SELECT 
      COALESCE(SUM(total_work_seconds), 0) AS today_work_seconds,
      COALESCE(SUM(total_break_seconds), 0) AS today_break_seconds,
      COUNT(*) AS total_punches_today
    FROM routine_punches
    WHERE punch_date = CURRENT_DATE;
  `;
  const res = await query(sql);
  const row = res.rows[0];

  const weekSql = `
    SELECT COALESCE(SUM(total_work_seconds), 0) AS week_work_seconds
    FROM routine_punches
    WHERE punch_date >= CURRENT_DATE - INTERVAL '6 days';
  `;
  const weekRes = await query(weekSql);

  return {
    todayWorkSeconds: parseInt(row.today_work_seconds, 10),
    todayBreakSeconds: parseInt(row.today_break_seconds, 10),
    totalPunchesToday: parseInt(row.total_punches_today, 10),
    weekWorkSeconds: parseInt(weekRes.rows[0].week_work_seconds, 10),
  };
}

