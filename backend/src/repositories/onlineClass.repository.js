/**
 * Virtex Admin - Online Classes and Courses Repository
 * PostgreSQL queries for live streaming classes, recorded VOD workouts, yoga,
 * group fitness, registrations, attendance, course curricula, lessons, quizzes,
 * digital certificates, and learning analytics.
 */

import { pool } from '../config/database.js';

// ----------------------------------------------------
// 1. ONLINE CLASSES & LIVESTREAM SESSIONS
// ----------------------------------------------------

export async function getOnlineClasses({ category, class_type, status, search } = {}) {
  let query = `
    SELECT 
      oc.id,
      oc.title,
      oc.category,
      oc.class_type,
      oc.instructor_trainer_id,
      t.full_name AS instructor_name,
      t.specialty AS instructor_specialty,
      oc.description,
      oc.scheduled_at,
      oc.duration_mins,
      oc.stream_url,
      oc.thumbnail_url,
      oc.max_participants,
      oc.difficulty,
      oc.status,
      oc.created_at,
      COUNT(DISTINCT cr.id) AS participants_count,
      COUNT(DISTINCT cr.id) FILTER (WHERE cr.attended = true) AS attended_count,
      COUNT(DISTINCT cr.id) FILTER (WHERE cr.status IN ('registered', 'attended')) AS active_registrations
    FROM online_classes oc
    LEFT JOIN trainers t ON oc.instructor_trainer_id = t.id
    LEFT JOIN class_registrations cr ON oc.id = cr.class_id
    WHERE 1=1
  `;
  const params = [];

  if (category && category !== 'All') {
    params.push(category);
    query += ` AND oc.category = $${params.length}`;
  }
  if (class_type && class_type !== 'All') {
    params.push(class_type);
    query += ` AND oc.class_type = $${params.length}`;
  }
  if (status && status !== 'All') {
    params.push(status);
    query += ` AND oc.status = $${params.length}`;
  }
  if (search && search.trim() !== '') {
    params.push(`%${search.trim()}%`);
    query += ` AND (oc.title ILIKE $${params.length} OR oc.description ILIKE $${params.length})`;
  }

  query += ` GROUP BY oc.id, t.full_name, t.specialty ORDER BY oc.scheduled_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getOnlineClassById(id) {
  const query = `
    SELECT 
      oc.*,
      t.full_name AS instructor_name,
      t.specialty AS instructor_specialty
    FROM online_classes oc
    LEFT JOIN trainers t ON oc.instructor_trainer_id = t.id
    WHERE oc.id = $1
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

export async function createOnlineClass(data) {
  const query = `
    INSERT INTO online_classes (
      title, category, class_type, instructor_trainer_id, description,
      scheduled_at, duration_mins, stream_url, thumbnail_url,
      max_participants, difficulty, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;
  const params = [
    data.title,
    data.category || 'Live Online',
    data.class_type || 'live',
    data.instructor_trainer_id || null,
    data.description || '',
    data.scheduled_at || new Date().toISOString(),
    parseInt(data.duration_mins, 10) || 45,
    data.stream_url || '',
    data.thumbnail_url || 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=700',
    parseInt(data.max_participants, 10) || 50,
    data.difficulty || 'All Levels',
    data.status || 'scheduled'
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

export async function updateClassStatus(id, status) {
  const query = `
    UPDATE online_classes
    SET status = $1
    WHERE id = $2
    RETURNING *
  `;
  const { rows } = await pool.query(query, [status, id]);
  return rows[0] || null;
}

// ----------------------------------------------------
// 2. REGISTRATION & ATTENDANCE LOGGING
// ----------------------------------------------------

export async function getClassRegistrations({ class_id, member_id } = {}) {
  let query = `
    SELECT 
      cr.id,
      cr.class_id,
      oc.title AS class_title,
      oc.category AS class_category,
      oc.class_type,
      oc.scheduled_at,
      cr.member_id,
      m.full_name AS member_name,
      m.member_code,
      cr.registered_at,
      cr.attended,
      cr.attended_at,
      cr.watch_time_mins,
      cr.status
    FROM class_registrations cr
    JOIN online_classes oc ON cr.class_id = oc.id
    JOIN members m ON cr.member_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (class_id) {
    params.push(class_id);
    query += ` AND cr.class_id = $${params.length}`;
  }
  if (member_id) {
    params.push(member_id);
    query += ` AND cr.member_id = $${params.length}`;
  }

  query += ` ORDER BY cr.registered_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function registerMemberForClass({ class_id, member_id }) {
  const query = `
    INSERT INTO class_registrations (class_id, member_id, registered_at, attended, status)
    VALUES ($1, $2, NOW(), false, 'registered')
    ON CONFLICT (class_id, member_id) DO UPDATE SET
      status = 'registered',
      registered_at = NOW()
    RETURNING *
  `;
  const { rows } = await pool.query(query, [class_id, member_id]);
  return rows[0];
}

export async function recordAttendance(registrationId, { attended, watch_time_mins, status }) {
  const isAttended = attended === true || attended === 'true';
  const query = `
    UPDATE class_registrations
    SET 
      attended = $1,
      attended_at = CASE WHEN $1 = true THEN NOW() ELSE NULL END,
      watch_time_mins = COALESCE($2, watch_time_mins),
      status = COALESCE($3, CASE WHEN $1 = true THEN 'attended' ELSE 'no_show' END)
    WHERE id = $4
    RETURNING *
  `;
  const { rows } = await pool.query(query, [isAttended, watch_time_mins || 0, status || null, registrationId]);
  return rows[0] || null;
}

// ----------------------------------------------------
// 3. COURSES, CURRICULUM & LESSONS
// ----------------------------------------------------

export async function getCourses({ category, level, search } = {}) {
  let query = `
    SELECT 
      c.id,
      c.title,
      c.slug,
      c.instructor_trainer_id,
      t.full_name AS instructor_name,
      t.specialty AS instructor_specialty,
      c.category,
      c.description,
      c.level,
      c.estimated_hours,
      c.thumbnail_url,
      c.status,
      c.created_at,
      COUNT(DISTINCT cl.id) AS lessons_count,
      COUNT(DISTINCT ce.id) AS enrolments_count,
      COUNT(DISTINCT ce.id) FILTER (WHERE ce.status = 'completed') AS completions_count,
      COUNT(DISTINCT cq.id) AS quizzes_count
    FROM courses c
    LEFT JOIN trainers t ON c.instructor_trainer_id = t.id
    LEFT JOIN course_lessons cl ON c.id = cl.course_id
    LEFT JOIN course_enrolments ce ON c.id = ce.course_id
    LEFT JOIN course_quizzes cq ON c.id = cq.course_id
    WHERE 1=1
  `;
  const params = [];

  if (category && category !== 'All') {
    params.push(category);
    query += ` AND c.category = $${params.length}`;
  }
  if (level && level !== 'All') {
    params.push(level);
    query += ` AND c.level = $${params.length}`;
  }
  if (search && search.trim() !== '') {
    params.push(`%${search.trim()}%`);
    query += ` AND (c.title ILIKE $${params.length} OR c.description ILIKE $${params.length})`;
  }

  query += ` GROUP BY c.id, t.full_name, t.specialty ORDER BY c.created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getCourseById(id) {
  const courseQuery = `
    SELECT 
      c.*,
      t.full_name AS instructor_name,
      t.specialty AS instructor_specialty
    FROM courses c
    LEFT JOIN trainers t ON c.instructor_trainer_id = t.id
    WHERE c.id = $1
  `;
  const { rows: courses } = await pool.query(courseQuery, [id]);
  if (!courses[0]) return null;

  const lessons = await getCourseLessons(id);
  const quiz = await getCourseQuiz(id);

  return {
    ...courses[0],
    lessons,
    quiz
  };
}

export async function createCourse(data) {
  const slug = (data.title || 'course')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') + '-' + Date.now().toString().slice(-4);

  const query = `
    INSERT INTO courses (
      title, slug, instructor_trainer_id, category, description,
      level, estimated_hours, thumbnail_url, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `;
  const params = [
    data.title,
    slug,
    data.instructor_trainer_id || null,
    data.category || 'General Fitness',
    data.description || '',
    data.level || 'Beginner',
    parseFloat(data.estimated_hours) || 4.0,
    data.thumbnail_url || 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=700',
    data.status || 'published'
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

export async function getCourseLessons(courseId) {
  const query = `
    SELECT *
    FROM course_lessons
    WHERE course_id = $1
    ORDER BY lesson_order ASC
  `;
  const { rows } = await pool.query(query, [courseId]);
  return rows;
}

export async function addCourseLesson(courseId, data) {
  // Determine next order
  const orderRes = await pool.query(
    'SELECT COALESCE(MAX(lesson_order), 0) + 1 AS next_order FROM course_lessons WHERE course_id = $1',
    [courseId]
  );
  const lessonOrder = data.lesson_order || orderRes.rows[0].next_order;

  const query = `
    INSERT INTO course_lessons (course_id, title, lesson_order, duration_mins, video_url, content_notes)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const params = [
    courseId,
    data.title,
    lessonOrder,
    parseInt(data.duration_mins, 10) || 15,
    data.video_url || '',
    data.content_notes || ''
  ];
  const { rows } = await pool.query(query, params);

  // Update total lessons count in existing enrolments for this course
  await pool.query(`
    UPDATE course_enrolments
    SET total_lessons = (SELECT COUNT(*) FROM course_lessons WHERE course_id = $1)
    WHERE course_id = $1
  `, [courseId]);

  return rows[0];
}

// ----------------------------------------------------
// 4. COURSE QUIZZES & ASSESSMENTS
// ----------------------------------------------------

export async function getCourseQuiz(courseId) {
  const query = `
    SELECT *
    FROM course_quizzes
    WHERE course_id = $1
    ORDER BY id DESC
    LIMIT 1
  `;
  const { rows } = await pool.query(query, [courseId]);
  return rows[0] || null;
}

export async function saveCourseQuiz(courseId, data) {
  const existing = await getCourseQuiz(courseId);
  if (existing) {
    const query = `
      UPDATE course_quizzes
      SET 
        title = $1,
        pass_percentage = $2,
        quiz_data = $3
      WHERE id = $4
      RETURNING *
    `;
    const { rows } = await pool.query(query, [
      data.title || 'Course Knowledge Assessment',
      parseInt(data.pass_percentage, 10) || 80,
      JSON.stringify(data.quiz_data || []),
      existing.id
    ]);
    return rows[0];
  } else {
    const query = `
      INSERT INTO course_quizzes (course_id, title, pass_percentage, quiz_data)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const { rows } = await pool.query(query, [
      courseId,
      data.title || 'Course Knowledge Assessment',
      parseInt(data.pass_percentage, 10) || 80,
      JSON.stringify(data.quiz_data || [])
    ]);
    return rows[0];
  }
}

// ----------------------------------------------------
// 5. ENROLMENTS & COMPLETION TRACKING
// ----------------------------------------------------

export async function getCourseEnrolments({ course_id, member_id } = {}) {
  let query = `
    SELECT 
      ce.id,
      ce.course_id,
      c.title AS course_title,
      c.category AS course_category,
      c.level AS course_level,
      ce.member_id,
      m.full_name AS member_name,
      m.member_code,
      ce.enrolled_at,
      ce.progress_pct,
      ce.lessons_completed,
      ce.total_lessons,
      ce.quiz_score_pct,
      ce.quiz_passed,
      ce.status,
      ce.completed_at,
      cc.certificate_code,
      cc.issued_at AS certificate_issued_at
    FROM course_enrolments ce
    JOIN courses c ON ce.course_id = c.id
    JOIN members m ON ce.member_id = m.id
    LEFT JOIN course_certificates cc ON ce.course_id = cc.course_id AND ce.member_id = cc.member_id
    WHERE 1=1
  `;
  const params = [];

  if (course_id) {
    params.push(course_id);
    query += ` AND ce.course_id = $${params.length}`;
  }
  if (member_id) {
    params.push(member_id);
    query += ` AND ce.member_id = $${params.length}`;
  }

  query += ` ORDER BY ce.enrolled_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function enrolMemberInCourse({ course_id, member_id }) {
  // Count total lessons
  const lessonCountRes = await pool.query(
    'SELECT COUNT(*) FROM course_lessons WHERE course_id = $1',
    [course_id]
  );
  const totalLessons = parseInt(lessonCountRes.rows[0].count, 10) || 0;

  const query = `
    INSERT INTO course_enrolments (course_id, member_id, enrolled_at, progress_pct, lessons_completed, total_lessons, status)
    VALUES ($1, $2, NOW(), 0, 0, $3, 'in_progress')
    ON CONFLICT (course_id, member_id) DO UPDATE SET
      status = 'in_progress'
    RETURNING *
  `;
  const { rows } = await pool.query(query, [course_id, member_id, totalLessons]);
  return rows[0];
}

export async function updateEnrolmentProgress(enrolmentId, data) {
  const currentRes = await pool.query('SELECT * FROM course_enrolments WHERE id = $1', [enrolmentId]);
  if (!currentRes.rows[0]) return null;
  const current = currentRes.rows[0];

  const totalLessons = current.total_lessons || 1;
  const lessonsCompleted = data.lessons_completed !== undefined ? parseInt(data.lessons_completed, 10) : current.lessons_completed;
  const progressPct = data.progress_pct !== undefined ? parseInt(data.progress_pct, 10) : Math.min(100, Math.round((lessonsCompleted / totalLessons) * 100));

  const quizScorePct = data.quiz_score_pct !== undefined ? parseInt(data.quiz_score_pct, 10) : current.quiz_score_pct;
  const quizPassed = data.quiz_passed !== undefined ? (data.quiz_passed === true || data.quiz_passed === 'true') : current.quiz_passed;

  const isCompleted = progressPct >= 100 && (quizPassed || quizScorePct >= 75);
  const status = isCompleted ? 'completed' : 'in_progress';
  const completedAt = isCompleted ? (current.completed_at || new Date().toISOString()) : null;

  const query = `
    UPDATE course_enrolments
    SET 
      progress_pct = $1,
      lessons_completed = $2,
      quiz_score_pct = $3,
      quiz_passed = $4,
      status = $5,
      completed_at = $6
    WHERE id = $7
    RETURNING *
  `;
  const { rows } = await pool.query(query, [
    progressPct,
    lessonsCompleted,
    quizScorePct,
    quizPassed,
    status,
    completedAt,
    enrolmentId
  ]);
  return rows[0];
}

// ----------------------------------------------------
// 6. DIGITAL CERTIFICATES
// ----------------------------------------------------

export async function getCourseCertificates() {
  const query = `
    SELECT 
      cc.id,
      cc.certificate_code,
      cc.course_id,
      c.title AS course_title,
      c.category AS course_category,
      cc.member_id,
      m.full_name AS member_name,
      m.member_code,
      cc.issued_at,
      cc.issued_by,
      cc.grade_score,
      cc.certificate_url
    FROM course_certificates cc
    JOIN courses c ON cc.course_id = c.id
    JOIN members m ON cc.member_id = m.id
    ORDER BY cc.issued_at DESC
  `;
  const { rows } = await pool.query(query);
  return rows;
}

export async function issueCourseCertificate(data) {
  const code = data.certificate_code || `PC-ACAD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const query = `
    INSERT INTO course_certificates (certificate_code, course_id, member_id, issued_at, issued_by, grade_score)
    VALUES ($1, $2, $3, NOW(), $4, $5)
    ON CONFLICT (course_id, member_id) DO UPDATE SET
      certificate_code = EXCLUDED.certificate_code,
      issued_at = NOW(),
      grade_score = EXCLUDED.grade_score
    RETURNING *
  `;
  const params = [
    code,
    data.course_id,
    data.member_id,
    data.issued_by || 'Virtex Academy of Exercise Science',
    data.grade_score || '100% (Distinction)'
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

// ----------------------------------------------------
// 7. LEARNING ANALYTICS & KPIS
// ----------------------------------------------------

export async function getLearningAnalytics() {
  const statsQuery = `
    SELECT 
      (SELECT COUNT(*) FROM online_classes) AS total_classes,
      (SELECT COUNT(*) FROM online_classes WHERE status = 'scheduled' OR status = 'live_now') AS active_classes,
      (SELECT COUNT(*) FROM class_registrations) AS total_class_registrations,
      (SELECT COALESCE(SUM(watch_time_mins), 0) FROM class_registrations) AS total_watch_mins,
      (SELECT COUNT(*) FROM courses) AS total_courses,
      (SELECT COUNT(*) FROM course_lessons) AS total_lessons,
      (SELECT COUNT(*) FROM course_enrolments) AS total_enrolments,
      (SELECT COUNT(*) FROM course_enrolments WHERE status = 'completed') AS completed_enrolments,
      (SELECT COUNT(*) FROM course_certificates) AS total_certificates
  `;
  const { rows } = await pool.query(statsQuery);
  const row = rows[0] || {};

  const totalClasses = parseInt(row.total_classes, 10) || 0;
  const activeClasses = parseInt(row.active_classes, 10) || 0;
  const totalRegistrations = parseInt(row.total_class_registrations, 10) || 0;
  const totalWatchHours = Number(((parseInt(row.total_watch_mins, 10) || 0) / 60.0).toFixed(1));
  const totalCourses = parseInt(row.total_courses, 10) || 0;
  const totalLessons = parseInt(row.total_lessons, 10) || 0;
  const totalEnrolments = parseInt(row.total_enrolments, 10) || 0;
  const completedEnrolments = parseInt(row.completed_enrolments, 10) || 0;
  const totalCertificates = parseInt(row.total_certificates, 10) || 0;

  const completionRate = totalEnrolments > 0 ? Math.round((completedEnrolments / totalEnrolments) * 100) : 0;

  return {
    totalClasses,
    activeClasses,
    totalRegistrations,
    totalWatchHours,
    totalCourses,
    totalLessons,
    totalEnrolments,
    completedEnrolments,
    completionRate,
    totalCertificates
  };
}

