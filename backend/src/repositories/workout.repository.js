import { pool } from '../config/database.js';

/**
 * Exercise Library Queries
 */
export async function getExercises({ muscle_group, equipment, difficulty, search } = {}) {
  let query = `
    SELECT id, name, muscle_group, equipment, difficulty, instructions, target_muscles, video_url, created_at
    FROM exercises
    WHERE 1=1
  `;
  const params = [];

  if (muscle_group && muscle_group !== 'All') {
    params.push(muscle_group);
    query += ` AND muscle_group = $${params.length}`;
  }
  if (equipment && equipment !== 'All') {
    params.push(equipment);
    query += ` AND equipment = $${params.length}`;
  }
  if (difficulty && difficulty !== 'All') {
    params.push(difficulty);
    query += ` AND difficulty = $${params.length}`;
  }
  if (search && search.trim() !== '') {
    params.push(`%${search.trim()}%`);
    query += ` AND (name ILIKE $${params.length} OR instructions ILIKE $${params.length} OR target_muscles ILIKE $${params.length})`;
  }

  query += ` ORDER BY muscle_group ASC, name ASC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getExerciseById(id) {
  const query = `SELECT * FROM exercises WHERE id = $1`;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

export async function createExercise(exerciseData) {
  const { name, muscle_group, equipment, difficulty, instructions, target_muscles, video_url } = exerciseData;
  const query = `
    INSERT INTO exercises (name, muscle_group, equipment, difficulty, instructions, target_muscles, video_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    name,
    muscle_group,
    equipment,
    difficulty || 'Intermediate',
    instructions,
    target_muscles || '',
    video_url || ''
  ]);
  return rows[0];
}

/**
 * Workout Programs Queries
 */
export async function getWorkoutPrograms({ trainer_id, goal, split_type, search } = {}) {
  let query = `
    SELECT 
      wp.id,
      wp.name,
      wp.trainer_id,
      t.full_name AS trainer_name,
      wp.difficulty_level,
      wp.goal,
      wp.split_type,
      wp.description,
      wp.is_template,
      wp.created_at,
      COUNT(DISTINCT wpd.id) AS days_count,
      COUNT(DISTINCT wpe.id) AS exercises_count,
      COUNT(DISTINCT mwa.id) FILTER (WHERE mwa.status = 'active') AS active_assignments_count
    FROM workout_programs wp
    LEFT JOIN trainers t ON wp.trainer_id = t.id
    LEFT JOIN workout_program_days wpd ON wp.id = wpd.program_id
    LEFT JOIN workout_program_exercises wpe ON wpd.id = wpe.day_id
    LEFT JOIN member_workout_assignments mwa ON wp.id = mwa.program_id
    WHERE 1=1
  `;
  const params = [];

  if (trainer_id && trainer_id !== 'All') {
    params.push(parseInt(trainer_id, 10));
    query += ` AND wp.trainer_id = $${params.length}`;
  }
  if (goal && goal !== 'All') {
    params.push(goal);
    query += ` AND wp.goal = $${params.length}`;
  }
  if (split_type && split_type !== 'All') {
    params.push(split_type);
    query += ` AND wp.split_type = $${params.length}`;
  }
  if (search && search.trim() !== '') {
    params.push(`%${search.trim()}%`);
    query += ` AND (wp.name ILIKE $${params.length} OR wp.description ILIKE $${params.length})`;
  }

  query += ` GROUP BY wp.id, t.full_name ORDER BY wp.created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getWorkoutProgramById(id) {
  const pQuery = `
    SELECT 
      wp.id,
      wp.name,
      wp.trainer_id,
      t.full_name AS trainer_name,
      t.specialty AS trainer_specialty,
      wp.difficulty_level,
      wp.goal,
      wp.split_type,
      wp.description,
      wp.is_template,
      wp.created_at
    FROM workout_programs wp
    LEFT JOIN trainers t ON wp.trainer_id = t.id
    WHERE wp.id = $1
  `;
  const pRes = await pool.query(pQuery, [id]);
  if (pRes.rows.length === 0) return null;
  const program = pRes.rows[0];

  const daysQuery = `
    SELECT 
      wpd.id,
      wpd.day_number,
      wpd.day_name,
      wpd.focus
    FROM workout_program_days wpd
    WHERE wpd.program_id = $1
    ORDER BY wpd.day_number ASC
  `;
  const daysRes = await pool.query(daysQuery, [id]);
  const days = daysRes.rows;

  for (const day of days) {
    const exQuery = `
      SELECT 
        wpe.id,
        wpe.exercise_id,
        e.name AS exercise_name,
        e.muscle_group,
        e.equipment,
        e.instructions,
        wpe.sets,
        wpe.reps,
        wpe.target_weight_kg,
        wpe.rest_seconds,
        wpe.order_index,
        wpe.notes
      FROM workout_program_exercises wpe
      JOIN exercises e ON wpe.exercise_id = e.id
      WHERE wpe.day_id = $1
      ORDER BY wpe.order_index ASC, wpe.id ASC
    `;
    const exRes = await pool.query(exQuery, [day.id]);
    day.exercises = exRes.rows;
  }

  program.days = days;
  return program;
}

export async function createWorkoutProgram(programData, days = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pQuery = `
      INSERT INTO workout_programs (name, trainer_id, difficulty_level, goal, split_type, description, is_template)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const pValues = [
      programData.name,
      programData.trainer_id || null,
      programData.difficulty_level || 'Intermediate',
      programData.goal || 'Hypertrophy',
      programData.split_type || 'Push/Pull/Legs',
      programData.description || '',
      programData.is_template !== undefined ? programData.is_template : true
    ];
    const pRes = await client.query(pQuery, pValues);
    const newProgram = pRes.rows[0];

    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const dQuery = `
        INSERT INTO workout_program_days (program_id, day_number, day_name, focus)
        VALUES ($1, $2, $3, $4)
        RETURNING id;
      `;
      const dRes = await client.query(dQuery, [
        newProgram.id,
        d.day_number || (i + 1),
        d.day_name || `Day ${i + 1}`,
        d.focus || ''
      ]);
      const dayId = dRes.rows[0].id;

      if (d.exercises && Array.isArray(d.exercises)) {
        for (let j = 0; j < d.exercises.length; j++) {
          const e = d.exercises[j];
          const eQuery = `
            INSERT INTO workout_program_exercises (day_id, exercise_id, sets, reps, target_weight_kg, rest_seconds, order_index, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
          `;
          await client.query(eQuery, [
            dayId,
            e.exercise_id,
            e.sets || 3,
            e.reps || '8-12',
            e.target_weight_kg || null,
            e.rest_seconds || 90,
            j + 1,
            e.notes || ''
          ]);
        }
      }
    }

    await client.query('COMMIT');
    return newProgram;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Member Workout Assignments
 */
export async function getMemberAssignments({ member_id, trainer_id, status } = {}) {
  let query = `
    SELECT 
      mwa.id,
      mwa.member_id,
      m.full_name AS member_name,
      m.member_code,
      mwa.program_id,
      wp.name AS program_name,
      wp.split_type,
      wp.goal,
      mwa.assigned_by_trainer_id,
      t.full_name AS trainer_name,
      mwa.start_date,
      mwa.end_date,
      mwa.status,
      mwa.trainer_notes,
      mwa.created_at,
      COUNT(wsl.id) AS total_logged_sessions,
      MAX(wsl.completed_at) AS last_session_date
    FROM member_workout_assignments mwa
    JOIN members m ON mwa.member_id = m.id
    JOIN workout_programs wp ON mwa.program_id = wp.id
    LEFT JOIN trainers t ON mwa.assigned_by_trainer_id = t.id
    LEFT JOIN workout_session_logs wsl ON mwa.member_id = wsl.member_id AND mwa.program_id = wsl.program_id
    WHERE 1=1
  `;
  const params = [];

  if (member_id) {
    params.push(parseInt(member_id, 10));
    query += ` AND mwa.member_id = $${params.length}`;
  }
  if (trainer_id && trainer_id !== 'All') {
    params.push(parseInt(trainer_id, 10));
    query += ` AND mwa.assigned_by_trainer_id = $${params.length}`;
  }
  if (status && status !== 'All') {
    params.push(status);
    query += ` AND mwa.status = $${params.length}`;
  }

  query += ` GROUP BY mwa.id, m.full_name, m.member_code, wp.name, wp.split_type, wp.goal, t.full_name ORDER BY mwa.created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function assignProgramToMember({ member_id, program_id, assigned_by_trainer_id, start_date, notes }) {
  const query = `
    INSERT INTO member_workout_assignments (member_id, program_id, assigned_by_trainer_id, start_date, status, trainer_notes)
    VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), 'active', $5)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    member_id,
    program_id,
    assigned_by_trainer_id || null,
    start_date || null,
    notes || ''
  ]);
  return rows[0];
}

export async function updateAssignmentStatus(assignment_id, status) {
  const query = `
    UPDATE member_workout_assignments
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [status, assignment_id]);
  return rows[0];
}

/**
 * Workout Session History & Logging
 */
export async function getWorkoutSessionLogs({ member_id, program_id, limit = 20 } = {}) {
  let query = `
    SELECT 
      wsl.id,
      wsl.member_id,
      m.full_name AS member_name,
      m.member_code,
      wsl.program_id,
      wp.name AS program_name,
      wsl.day_id,
      wpd.day_name,
      wsl.completed_at,
      wsl.duration_minutes,
      wsl.total_volume_kg,
      wsl.rpe_rating,
      wsl.notes,
      wsl.logged_by,
      COUNT(wsi.id) AS sets_logged_count
    FROM workout_session_logs wsl
    JOIN members m ON wsl.member_id = m.id
    LEFT JOIN workout_programs wp ON wsl.program_id = wp.id
    LEFT JOIN workout_program_days wpd ON wsl.day_id = wpd.id
    LEFT JOIN workout_session_items wsi ON wsl.id = wsi.session_log_id
    WHERE 1=1
  `;
  const params = [];

  if (member_id) {
    params.push(parseInt(member_id, 10));
    query += ` AND wsl.member_id = $${params.length}`;
  }
  if (program_id) {
    params.push(parseInt(program_id, 10));
    query += ` AND wsl.program_id = $${params.length}`;
  }

  query += ` GROUP BY wsl.id, m.full_name, m.member_code, wp.name, wpd.day_name ORDER BY wsl.completed_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getWorkoutSessionDetail(sessionId) {
  const sQuery = `
    SELECT 
      wsl.*,
      m.full_name AS member_name,
      m.member_code,
      wp.name AS program_name,
      wpd.day_name
    FROM workout_session_logs wsl
    JOIN members m ON wsl.member_id = m.id
    LEFT JOIN workout_programs wp ON wsl.program_id = wp.id
    LEFT JOIN workout_program_days wpd ON wsl.day_id = wpd.id
    WHERE wsl.id = $1
  `;
  const sRes = await pool.query(sQuery, [sessionId]);
  if (sRes.rows.length === 0) return null;
  const session = sRes.rows[0];

  const itemsQuery = `
    SELECT 
      wsi.id,
      wsi.exercise_id,
      e.name AS exercise_name,
      e.muscle_group,
      wsi.set_number,
      wsi.reps_completed,
      wsi.weight_kg,
      wsi.is_pr
    FROM workout_session_items wsi
    JOIN exercises e ON wsi.exercise_id = e.id
    WHERE wsi.session_log_id = $1
    ORDER BY wsi.exercise_id, wsi.set_number
  `;
  const itemsRes = await pool.query(itemsQuery, [sessionId]);
  session.items = itemsRes.rows;
  return session;
}

export async function logWorkoutSession(sessionData, items = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let totalVolume = 0;
    items.forEach(it => {
      totalVolume += (Number(it.weight_kg) || 0) * (Number(it.reps_completed) || 0);
    });

    const sQuery = `
      INSERT INTO workout_session_logs (member_id, program_id, day_id, completed_at, duration_minutes, total_volume_kg, rpe_rating, notes, logged_by)
      VALUES ($1, $2, $3, COALESCE($4, NOW()), $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const sRes = await client.query(sQuery, [
      sessionData.member_id,
      sessionData.program_id || null,
      sessionData.day_id || null,
      sessionData.completed_at || null,
      sessionData.duration_minutes || 60,
      totalVolume,
      sessionData.rpe_rating || 8,
      sessionData.notes || '',
      sessionData.logged_by || 'Admin'
    ]);
    const session = sRes.rows[0];

    for (const it of items) {
      // Check if this weight is a personal record (PR)
      const prCheckQuery = `
        SELECT MAX(wsi.weight_kg) AS prev_max
        FROM workout_session_items wsi
        JOIN workout_session_logs wsl ON wsi.session_log_id = wsl.id
        WHERE wsl.member_id = $1 AND wsi.exercise_id = $2;
      `;
      const prCheck = await client.query(prCheckQuery, [sessionData.member_id, it.exercise_id]);
      const prevMax = prCheck.rows[0]?.prev_max ? Number(prCheck.rows[0].prev_max) : 0;
      const isPr = Number(it.weight_kg) > prevMax && prevMax > 0;

      await client.query(`
        INSERT INTO workout_session_items (session_log_id, exercise_id, set_number, reps_completed, weight_kg, is_pr)
        VALUES ($1, $2, $3, $4, $5, $6);
      `, [
        session.id,
        it.exercise_id,
        it.set_number || 1,
        it.reps_completed || 10,
        it.weight_kg || 0,
        isPr
      ]);
    }

    await client.query('COMMIT');
    return session;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Strength Progression & Personal Best Records
 */
export async function getPersonalBests(member_id) {
  const query = `
    WITH session_prs AS (
      SELECT 
        wsi.exercise_id,
        e.name AS exercise_name,
        e.muscle_group,
        MAX(wsi.weight_kg) AS max_weight_kg,
        MAX(wsl.completed_at) AS date_achieved
      FROM workout_session_items wsi
      JOIN workout_session_logs wsl ON wsi.session_log_id = wsl.id
      JOIN exercises e ON wsi.exercise_id = e.id
      WHERE wsl.member_id = $1
      GROUP BY wsi.exercise_id, e.name, e.muscle_group
    ),
    strength_log_prs AS (
      SELECT 
        0 AS exercise_id,
        exercise_name,
        'Strength' AS muscle_group,
        MAX(weight_kg) AS max_weight_kg,
        MAX(logged_at) AS date_achieved
      FROM member_strength_logs
      WHERE member_id = $1
      GROUP BY exercise_name
    )
    SELECT * FROM session_prs
    UNION ALL
    SELECT * FROM strength_log_prs
    ORDER BY max_weight_kg DESC;
  `;
  const { rows } = await pool.query(query, [member_id]);
  return rows;
}

export async function getStrengthProgression(member_id, exercise_name) {
  let query = `
    SELECT 
      id,
      exercise_name,
      weight_kg,
      reps,
      estimated_one_rep_max,
      logged_at
    FROM member_strength_logs
    WHERE member_id = $1
  `;
  const params = [member_id];

  if (exercise_name) {
    params.push(exercise_name);
    query += ` AND exercise_name ILIKE $2`;
  }

  query += ` ORDER BY logged_at ASC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

/**
 * Workout Analytics & Metrics
 */
export async function getWorkoutAnalytics() {
  const client = await pool.connect();
  try {
    const exCountRes = await client.query(`SELECT COUNT(*) AS total_exercises FROM exercises;`);
    const prgCountRes = await client.query(`SELECT COUNT(*) AS total_programs FROM workout_programs;`);
    const assignRes = await client.query(`
      SELECT 
        COUNT(*) AS total_assignments,
        COUNT(*) FILTER (WHERE status = 'active') AS active_assignments,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_assignments
      FROM member_workout_assignments;
    `);
    const logsRes = await client.query(`
      SELECT 
        COUNT(*) AS total_sessions,
        COUNT(*) FILTER (WHERE completed_at >= NOW() - INTERVAL '7 days') AS sessions_last_7_days,
        COALESCE(SUM(total_volume_kg), 0) AS total_volume_kg,
        COALESCE(AVG(duration_minutes), 0) AS avg_duration_mins
      FROM workout_session_logs;
    `);

    const splitDistRes = await client.query(`
      SELECT split_type, COUNT(*) AS count
      FROM workout_programs
      GROUP BY split_type
      ORDER BY count DESC;
    `);

    const muscleDistRes = await client.query(`
      SELECT muscle_group, COUNT(*) AS count
      FROM exercises
      GROUP BY muscle_group
      ORDER BY count DESC;
    `);

    const topPrsRes = await client.query(`
      SELECT 
        e.name AS exercise_name,
        m.full_name AS member_name,
        MAX(wsi.weight_kg) AS top_weight_kg
      FROM workout_session_items wsi
      JOIN workout_session_logs wsl ON wsi.session_log_id = wsl.id
      JOIN members m ON wsl.member_id = m.id
      JOIN exercises e ON wsi.exercise_id = e.id
      GROUP BY e.name, m.full_name
      ORDER BY top_weight_kg DESC
      LIMIT 5;
    `);

    return {
      kpis: {
        totalExercises: parseInt(exCountRes.rows[0].total_exercises, 10),
        totalPrograms: parseInt(prgCountRes.rows[0].total_programs, 10),
        activeAssignments: parseInt(assignRes.rows[0].active_assignments, 10),
        totalAssignments: parseInt(assignRes.rows[0].total_assignments, 10),
        sessionsThisWeek: parseInt(logsRes.rows[0].sessions_last_7_days, 10),
        totalVolumeKg: parseFloat(logsRes.rows[0].total_volume_kg),
        avgDurationMins: Math.round(parseFloat(logsRes.rows[0].avg_duration_mins))
      },
      splitDistribution: splitDistRes.rows,
      muscleDistribution: muscleDistRes.rows,
      topPrs: topPrsRes.rows
    };
  } finally {
    client.release();
  }
}
