-- Migration 012: Online Classes, VOD Workout Streaming, and Academy Courses LMS
-- Provides live livestream sessions, recorded VOD workout classes, group fitness,
-- trainer scheduling, course curriculum, video lesson management, quizzes,
-- digital completion certificates, and learning analytics.

CREATE TABLE IF NOT EXISTS online_classes (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL, -- 'Live Online', 'Recorded Workout', 'Yoga', 'Group Fitness'
  class_type VARCHAR(20) NOT NULL DEFAULT 'live', -- 'live', 'vod_recorded'
  instructor_trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
  description TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_mins INTEGER NOT NULL DEFAULT 45,
  stream_url TEXT,
  thumbnail_url TEXT,
  max_participants INTEGER DEFAULT 50,
  difficulty VARCHAR(20) DEFAULT 'All Levels', -- 'Beginner', 'Intermediate', 'Advanced', 'All Levels'
  status VARCHAR(20) DEFAULT 'scheduled', -- 'scheduled', 'live_now', 'completed', 'archived'
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_online_classes_category ON online_classes(category);
CREATE INDEX IF NOT EXISTS idx_online_classes_status ON online_classes(status);
CREATE INDEX IF NOT EXISTS idx_online_classes_scheduled_at ON online_classes(scheduled_at);

CREATE TABLE IF NOT EXISTS class_registrations (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  attended BOOLEAN DEFAULT false,
  attended_at TIMESTAMPTZ,
  watch_time_mins INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'registered', -- 'registered', 'attended', 'cancelled', 'no_show'
  UNIQUE(class_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_class_registrations_class ON class_registrations(class_id);
CREATE INDEX IF NOT EXISTS idx_class_registrations_member ON class_registrations(member_id);

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE,
  instructor_trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
  category VARCHAR(50) NOT NULL, -- 'Strength Science', 'Yoga & Mindfulness', 'Functional Mobility', 'Nutrition Mastery'
  description TEXT,
  level VARCHAR(20) DEFAULT 'Beginner', -- 'Beginner', 'Intermediate', 'Advanced'
  estimated_hours NUMERIC(4,1) DEFAULT 4.0,
  thumbnail_url TEXT,
  status VARCHAR(20) DEFAULT 'published', -- 'draft', 'published', 'archived'
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);

CREATE TABLE IF NOT EXISTS course_lessons (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  lesson_order INTEGER NOT NULL DEFAULT 1,
  duration_mins INTEGER NOT NULL DEFAULT 15,
  video_url TEXT NOT NULL,
  content_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_course_lessons_course ON course_lessons(course_id, lesson_order);

CREATE TABLE IF NOT EXISTS course_quizzes (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  pass_percentage INTEGER NOT NULL DEFAULT 80,
  quiz_data JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS course_enrolments (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  progress_pct INTEGER DEFAULT 0,
  lessons_completed INTEGER DEFAULT 0,
  total_lessons INTEGER DEFAULT 0,
  quiz_score_pct INTEGER,
  quiz_passed BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'in_progress', -- 'in_progress', 'completed'
  completed_at TIMESTAMPTZ,
  UNIQUE(course_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_course_enrolments_member ON course_enrolments(member_id);

CREATE TABLE IF NOT EXISTS course_certificates (
  id SERIAL PRIMARY KEY,
  certificate_code VARCHAR(100) UNIQUE NOT NULL,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  issued_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  issued_by VARCHAR(100) DEFAULT 'Virtex Academy of Exercise Science',
  grade_score VARCHAR(50),
  certificate_url TEXT,
  UNIQUE(course_id, member_id)
);

ALTER TABLE course_certificates ALTER COLUMN grade_score TYPE VARCHAR(50);

-- Seed Data using existing Trainers (Arjun Reddy, Meera Rao, Karan Verma) and Members (Rahul Sharma, Priya Patel, David Miller)
DO $$
DECLARE
  v_trainer_arjun INTEGER;
  v_trainer_meera INTEGER;
  v_trainer_karan INTEGER;
  v_member_rahul INTEGER;
  v_member_priya INTEGER;
  v_member_david INTEGER;
  v_class_yoga INTEGER;
  v_class_hiit INTEGER;
  v_class_lifting INTEGER;
  v_class_mobility INTEGER;
  v_course_barbell INTEGER;
  v_course_mobility INTEGER;
BEGIN
  -- Lookup trainers
  SELECT id INTO v_trainer_arjun FROM trainers WHERE full_name ILIKE '%Arjun%' LIMIT 1;
  SELECT id INTO v_trainer_meera FROM trainers WHERE full_name ILIKE '%Meera%' LIMIT 1;
  SELECT id INTO v_trainer_karan FROM trainers WHERE full_name ILIKE '%Karan%' LIMIT 1;

  -- Fallbacks if not found
  IF v_trainer_arjun IS NULL THEN SELECT id INTO v_trainer_arjun FROM trainers LIMIT 1; END IF;
  IF v_trainer_meera IS NULL THEN SELECT id INTO v_trainer_meera FROM trainers LIMIT 1; END IF;
  IF v_trainer_karan IS NULL THEN SELECT id INTO v_trainer_karan FROM trainers LIMIT 1; END IF;

  -- Lookup members
  SELECT id INTO v_member_rahul FROM members WHERE full_name ILIKE '%Rahul%' LIMIT 1;
  SELECT id INTO v_member_priya FROM members WHERE full_name ILIKE '%Priya%' LIMIT 1;
  SELECT id INTO v_member_david FROM members WHERE full_name ILIKE '%David%' LIMIT 1;

  IF v_member_rahul IS NULL THEN SELECT id INTO v_member_rahul FROM members LIMIT 1; END IF;
  IF v_member_priya IS NULL THEN SELECT id INTO v_member_priya FROM members LIMIT 1; END IF;
  IF v_member_david IS NULL THEN SELECT id INTO v_member_david FROM members LIMIT 1; END IF;

  -- 1. Seed Online Classes
  INSERT INTO online_classes (title, category, class_type, instructor_trainer_id, description, scheduled_at, duration_mins, stream_url, thumbnail_url, max_participants, difficulty, status)
  VALUES 
  (
    'Sunrise Vinyasa & Pranic Flow',
    'Yoga',
    'live',
    v_trainer_meera,
    'Dynamic morning yoga flow centering on hip opening, spine elongation, and breath synchronization.',
    NOW() + INTERVAL '1 day',
    60,
    'https://meet.google.com/virtex-yoga-live',
    'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=700',
    40,
    'All Levels',
    'scheduled'
  )
  RETURNING id INTO v_class_yoga;

  INSERT INTO online_classes (title, category, class_type, instructor_trainer_id, description, scheduled_at, duration_mins, stream_url, thumbnail_url, max_participants, difficulty, status)
  VALUES 
  (
    'HIIT Metabolic Furnace: 45-Min Peak Burn',
    'Group Fitness',
    'vod_recorded',
    v_trainer_karan,
    'High intensity functional intervals targeting aerobic threshold and anaerobic capacity with kettlebells and bodyweight.',
    NOW() - INTERVAL '3 days',
    45,
    'https://storage.googleapis.com/virtex-vod/hiit-burn-ep01.mp4',
    'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=700',
    60,
    'Advanced',
    'completed'
  )
  RETURNING id INTO v_class_hiit;

  INSERT INTO online_classes (title, category, class_type, instructor_trainer_id, description, scheduled_at, duration_mins, stream_url, thumbnail_url, max_participants, difficulty, status)
  VALUES 
  (
    'Olympic Snatch & Clean Masterclass Live',
    'Live Online',
    'live',
    v_trainer_arjun,
    'Live bar path analysis, triple extension mechanics, and overhead stability workshop with interactive Q&A.',
    NOW() + INTERVAL '2 days',
    75,
    'https://meet.google.com/virtex-oly-stream',
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=700',
    30,
    'Intermediate',
    'scheduled'
  )
  RETURNING id INTO v_class_lifting;

  INSERT INTO online_classes (title, category, class_type, instructor_trainer_id, description, scheduled_at, duration_mins, stream_url, thumbnail_url, max_participants, difficulty, status)
  VALUES 
  (
    'Spinal Decompression & Shoulder Active Recovery',
    'Recorded Workout',
    'vod_recorded',
    v_trainer_meera,
    'Targeted foam rolling, band distraction, and active rest sequences designed to combat posterior chain stiffness.',
    NOW() - INTERVAL '7 days',
    35,
    'https://storage.googleapis.com/virtex-vod/mobility-spine-ep02.mp4',
    'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=700',
    100,
    'All Levels',
    'completed'
  )
  RETURNING id INTO v_class_mobility;

  -- 2. Seed Class Registrations & Attendance
  IF v_member_rahul IS NOT NULL AND v_class_yoga IS NOT NULL THEN
    INSERT INTO class_registrations (class_id, member_id, registered_at, attended, status)
    VALUES (v_class_yoga, v_member_rahul, NOW() - INTERVAL '2 days', false, 'registered')
    ON CONFLICT (class_id, member_id) DO NOTHING;
  END IF;

  IF v_member_priya IS NOT NULL AND v_class_yoga IS NOT NULL THEN
    INSERT INTO class_registrations (class_id, member_id, registered_at, attended, status)
    VALUES (v_class_yoga, v_member_priya, NOW() - INTERVAL '1 day', false, 'registered')
    ON CONFLICT (class_id, member_id) DO NOTHING;
  END IF;

  IF v_member_david IS NOT NULL AND v_class_hiit IS NOT NULL THEN
    INSERT INTO class_registrations (class_id, member_id, registered_at, attended, attended_at, watch_time_mins, status)
    VALUES (v_class_hiit, v_member_david, NOW() - INTERVAL '3 days', true, NOW() - INTERVAL '3 days', 45, 'attended')
    ON CONFLICT (class_id, member_id) DO NOTHING;
  END IF;

  IF v_member_rahul IS NOT NULL AND v_class_hiit IS NOT NULL THEN
    INSERT INTO class_registrations (class_id, member_id, registered_at, attended, attended_at, watch_time_mins, status)
    VALUES (v_class_hiit, v_member_rahul, NOW() - INTERVAL '3 days', true, NOW() - INTERVAL '3 days', 42, 'attended')
    ON CONFLICT (class_id, member_id) DO NOTHING;
  END IF;

  -- 3. Seed Courses
  INSERT INTO courses (title, slug, instructor_trainer_id, category, description, level, estimated_hours, thumbnail_url, status)
  VALUES 
  (
    'Barbell Biomechanics & Maximal Strength',
    'barbell-biomechanics-strength',
    v_trainer_arjun,
    'Strength Science',
    'Comprehensive collegiate-level course breaking down the physics, force curves, and bar trajectory of the big three lifts.',
    'Intermediate',
    6.0,
    'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=700',
    'published'
  )
  RETURNING id INTO v_course_barbell;

  INSERT INTO courses (title, slug, instructor_trainer_id, category, description, level, estimated_hours, thumbnail_url, status)
  VALUES 
  (
    'Holistic Posture Correction & Movement Therapy',
    'posture-movement-therapy',
    v_trainer_meera,
    'Functional Mobility',
    'A progressive rehabilitation curriculum designed to reverse anterior pelvic tilt, upper crossed syndrome, and joint impingement.',
    'Beginner',
    4.5,
    'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=700',
    'published'
  )
  RETURNING id INTO v_course_mobility;

  -- 4. Seed Course Lessons
  INSERT INTO course_lessons (course_id, title, lesson_order, duration_mins, video_url, content_notes)
  VALUES 
  (v_course_barbell, '1. Physics of Moment Arms & Bar Path', 1, 22, 'https://storage.googleapis.com/virtex-academy/bb01.mp4', 'Levers, center of mass, and equilibrium under load.'),
  (v_course_barbell, '2. Squat Kinematics: High-Bar vs Low-Bar', 2, 28, 'https://storage.googleapis.com/virtex-academy/bb02.mp4', 'Hip hinge mechanics and knee flexion angles.'),
  (v_course_barbell, '3. Bench Press Arch & Scapular Retraction', 3, 20, 'https://storage.googleapis.com/virtex-academy/bb03.mp4', 'Glenohumeral joint safety and leg drive integration.'),
  (v_course_barbell, '4. Conventional vs Sumo Deadlift Mechanics', 4, 30, 'https://storage.googleapis.com/virtex-academy/bb04.mp4', 'Torque vectors, lat engagement, and wedge setup.');

  INSERT INTO course_lessons (course_id, title, lesson_order, duration_mins, video_url, content_notes)
  VALUES 
  (v_course_mobility, '1. Functional Anatomy of Postural Distortions', 1, 18, 'https://storage.googleapis.com/virtex-academy/mob01.mp4', 'Tonic vs phasic muscle dominance in sedentary lifestyles.'),
  (v_course_mobility, '2. Thoracic Spine Extension & Rib Flare Control', 2, 25, 'https://storage.googleapis.com/virtex-academy/mob02.mp4', 'Diaphragmatic breathing drills and foam roller mobilizations.'),
  (v_course_mobility, '3. Glute Activation & Pelvic Symmetry Restoration', 3, 24, 'https://storage.googleapis.com/virtex-academy/mob03.mp4', 'Psoas lengthening and end-range gluteus medius recruitment.');

  -- 5. Seed Quizzes
  INSERT INTO course_quizzes (course_id, title, pass_percentage, quiz_data)
  VALUES 
  (
    v_course_barbell,
    'Barbell Biomechanics Comprehensive Certification Exam',
    80,
    '[
      {
        "question": "What is the primary mechanical effect of shortening the horizontal distance between the barbell and the hip joint in the deadlift?",
        "options": ["Decreases the moment arm and required hip extensor torque", "Increases spinal shear stress", "Reduces hamstring activation completely", "Shifts load entirely to the cervical spine"],
        "correctIndex": 0
      },
      {
        "question": "During the low-bar back squat, which cue best prevents knee cave (valgus collapse)?",
        "options": ["Keep knees glued together", "Drive knees outward in line with the toes and spread the floor", "Shift body weight onto the toes", "Look straight up at the ceiling"],
        "correctIndex": 1
      },
      {
        "question": "Why is scapular retraction and depression essential in the heavy barbell bench press?",
        "options": ["It increases bar travel distance", "It provides a stable base of support and opens the subacromial space", "It disengages the pectoralis major entirely", "It rounds the upper back for leverage"],
        "correctIndex": 1
      }
    ]'::jsonb
  );

  INSERT INTO course_quizzes (course_id, title, pass_percentage, quiz_data)
  VALUES 
  (
    v_course_mobility,
    'Posture & Mobility Assessment Knowledge Check',
    75,
    '[
      {
        "question": "Which muscle group is typically overactive and tight in Upper Crossed Syndrome?",
        "options": ["Upper trapezius and levator scapulae", "Deep neck flexors", "Lower trapezius", "Serratus anterior"],
        "correctIndex": 0
      },
      {
        "question": "What is the recommended breathing protocol during thoracic mobility stretches?",
        "options": ["Rapid shallow chest breathing", "Full diaphragmatic exhalation into the ribcage expansion", "Holding breath throughout the movement", "Hyperventilation"],
        "correctIndex": 1
      }
    ]'::jsonb
  );

  -- 6. Seed Course Enrolments
  IF v_member_rahul IS NOT NULL AND v_course_barbell IS NOT NULL THEN
    INSERT INTO course_enrolments (course_id, member_id, enrolled_at, progress_pct, lessons_completed, total_lessons, quiz_score_pct, quiz_passed, status, completed_at)
    VALUES (v_course_barbell, v_member_rahul, NOW() - INTERVAL '14 days', 100, 4, 4, 100, true, 'completed', NOW() - INTERVAL '1 day')
    ON CONFLICT (course_id, member_id) DO NOTHING;
  END IF;

  IF v_member_priya IS NOT NULL AND v_course_barbell IS NOT NULL THEN
    INSERT INTO course_enrolments (course_id, member_id, enrolled_at, progress_pct, lessons_completed, total_lessons, quiz_score_pct, quiz_passed, status)
    VALUES (v_course_barbell, v_member_priya, NOW() - INTERVAL '8 days', 75, 3, 4, 85, true, 'in_progress')
    ON CONFLICT (course_id, member_id) DO NOTHING;
  END IF;

  IF v_member_david IS NOT NULL AND v_course_mobility IS NOT NULL THEN
    INSERT INTO course_enrolments (course_id, member_id, enrolled_at, progress_pct, lessons_completed, total_lessons, status)
    VALUES (v_course_mobility, v_member_david, NOW() - INTERVAL '5 days', 33, 1, 3, 'in_progress')
    ON CONFLICT (course_id, member_id) DO NOTHING;
  END IF;

  -- 7. Seed Course Digital Certificate for Rahul Sharma
  IF v_member_rahul IS NOT NULL AND v_course_barbell IS NOT NULL THEN
    INSERT INTO course_certificates (certificate_code, course_id, member_id, issued_at, issued_by, grade_score)
    VALUES (
      'PC-ACAD-2026-BB-001',
      v_course_barbell,
      v_member_rahul,
      NOW() - INTERVAL '1 day',
      'Virtex Academy of Biomechanical Science',
      '100% (High Distinction)'
    )
    ON CONFLICT (course_id, member_id) DO NOTHING;
  END IF;

END $$;
