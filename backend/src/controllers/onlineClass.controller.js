/**
 * Virtex Admin - Online Classes and Courses Controller
 * REST handlers for live classes, recorded workout VODs, registrations,
 * attendance, course curriculum, lessons, assessments, certificates, and learning analytics.
 */

import * as ocRepo from '../repositories/onlineClass.repository.js';

// ----------------------------------------------------
// 1. ONLINE CLASSES & LIVESTREAM SESSIONS
// ----------------------------------------------------

export async function getOnlineClasses(req, res) {
  try {
    const { category, class_type, status, search } = req.query;
    const classes = await ocRepo.getOnlineClasses({ category, class_type, status, search });
    res.json({ success: true, data: classes });
  } catch (err) {
    console.error('Error fetching online classes:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve online classes' });
  }
}

export async function getOnlineClassById(req, res) {
  try {
    const { id } = req.params;
    const cls = await ocRepo.getOnlineClassById(id);
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Online class not found' });
    }
    res.json({ success: true, data: cls });
  } catch (err) {
    console.error('Error fetching online class by id:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve online class' });
  }
}

export async function createOnlineClass(req, res) {
  try {
    const { title, category, class_type, scheduled_at } = req.body;
    if (!title || !category || !scheduled_at) {
      return res.status(400).json({ success: false, message: 'Title, category, and scheduled date/time are required' });
    }

    const newClass = await ocRepo.createOnlineClass(req.body);
    res.status(201).json({ success: true, data: newClass, message: 'Online class scheduled successfully' });
  } catch (err) {
    console.error('Error creating online class:', err);
    res.status(500).json({ success: false, message: 'Failed to create online class' });
  }
}

export async function updateClassStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const updated = await ocRepo.updateClassStatus(id, status);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    res.json({ success: true, data: updated, message: `Class status updated to ${status}` });
  } catch (err) {
    console.error('Error updating class status:', err);
    res.status(500).json({ success: false, message: 'Failed to update class status' });
  }
}

// ----------------------------------------------------
// 2. REGISTRATIONS & ATTENDANCE
// ----------------------------------------------------

export async function getClassRegistrations(req, res) {
  try {
    const { class_id, member_id } = req.query;
    const registrations = await ocRepo.getClassRegistrations({ class_id, member_id });
    res.json({ success: true, data: registrations });
  } catch (err) {
    console.error('Error fetching class registrations:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve registrations' });
  }
}

export async function registerMemberForClass(req, res) {
  try {
    const { class_id, member_id } = req.body;
    if (!class_id || !member_id) {
      return res.status(400).json({ success: false, message: 'Class ID and Member ID are required' });
    }

    const reg = await ocRepo.registerMemberForClass({ class_id, member_id });
    res.status(201).json({ success: true, data: reg, message: 'Member enrolled in online class successfully' });
  } catch (err) {
    console.error('Error enrolling in class:', err);
    res.status(500).json({ success: false, message: 'Failed to register member for class' });
  }
}

export async function recordAttendance(req, res) {
  try {
    const { registrationId } = req.params;
    const { attended, watch_time_mins, status } = req.body;

    const updated = await ocRepo.recordAttendance(registrationId, { attended, watch_time_mins, status });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Registration record not found' });
    }
    res.json({ success: true, data: updated, message: 'Attendance record updated' });
  } catch (err) {
    console.error('Error recording attendance:', err);
    res.status(500).json({ success: false, message: 'Failed to record attendance' });
  }
}

// ----------------------------------------------------
// 3. COURSES & LESSON MANAGEMENT
// ----------------------------------------------------

export async function getCourses(req, res) {
  try {
    const { category, level, search } = req.query;
    const courses = await ocRepo.getCourses({ category, level, search });
    res.json({ success: true, data: courses });
  } catch (err) {
    console.error('Error fetching courses:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve courses' });
  }
}

export async function getCourseById(req, res) {
  try {
    const { id } = req.params;
    const course = await ocRepo.getCourseById(id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }
    res.json({ success: true, data: course });
  } catch (err) {
    console.error('Error fetching course by id:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve course details' });
  }
}

export async function createCourse(req, res) {
  try {
    const { title, category } = req.body;
    if (!title || !category) {
      return res.status(400).json({ success: false, message: 'Course title and category are required' });
    }

    const newCourse = await ocRepo.createCourse(req.body);
    res.status(201).json({ success: true, data: newCourse, message: 'Course created successfully' });
  } catch (err) {
    console.error('Error creating course:', err);
    res.status(500).json({ success: false, message: 'Failed to create course' });
  }
}

export async function getCourseLessons(req, res) {
  try {
    const { courseId } = req.params;
    const lessons = await ocRepo.getCourseLessons(courseId);
    res.json({ success: true, data: lessons });
  } catch (err) {
    console.error('Error fetching course lessons:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve course lessons' });
  }
}

export async function addCourseLesson(req, res) {
  try {
    const { courseId } = req.params;
    const { title, video_url } = req.body;
    if (!title || !video_url) {
      return res.status(400).json({ success: false, message: 'Lesson title and video URL are required' });
    }

    const lesson = await ocRepo.addCourseLesson(courseId, req.body);
    res.status(201).json({ success: true, data: lesson, message: 'Video lesson added to curriculum' });
  } catch (err) {
    console.error('Error adding lesson:', err);
    res.status(500).json({ success: false, message: 'Failed to add lesson' });
  }
}

// ----------------------------------------------------
// 4. QUIZZES & ASSESSMENTS
// ----------------------------------------------------

export async function getCourseQuiz(req, res) {
  try {
    const { courseId } = req.params;
    const quiz = await ocRepo.getCourseQuiz(courseId);
    res.json({ success: true, data: quiz });
  } catch (err) {
    console.error('Error fetching quiz:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve course quiz' });
  }
}

export async function saveCourseQuiz(req, res) {
  try {
    const { courseId } = req.params;
    const { title, pass_percentage, quiz_data } = req.body;
    if (!quiz_data || !Array.isArray(quiz_data)) {
      return res.status(400).json({ success: false, message: 'Quiz questions data array is required' });
    }

    const saved = await ocRepo.saveCourseQuiz(courseId, { title, pass_percentage, quiz_data });
    res.json({ success: true, data: saved, message: 'Course assessment quiz saved' });
  } catch (err) {
    console.error('Error saving quiz:', err);
    res.status(500).json({ success: false, message: 'Failed to save quiz' });
  }
}

// ----------------------------------------------------
// 5. ENROLMENTS & COMPLETION TRACKING
// ----------------------------------------------------

export async function getCourseEnrolments(req, res) {
  try {
    const { course_id, member_id } = req.query;
    const enrolments = await ocRepo.getCourseEnrolments({ course_id, member_id });
    res.json({ success: true, data: enrolments });
  } catch (err) {
    console.error('Error fetching course enrolments:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve course enrolments' });
  }
}

export async function enrolMemberInCourse(req, res) {
  try {
    const { course_id, member_id } = req.body;
    if (!course_id || !member_id) {
      return res.status(400).json({ success: false, message: 'Course ID and Member ID are required' });
    }

    const enrolment = await ocRepo.enrolMemberInCourse({ course_id, member_id });
    res.status(201).json({ success: true, data: enrolment, message: 'Member enrolled in course successfully' });
  } catch (err) {
    console.error('Error enrolling student:', err);
    res.status(500).json({ success: false, message: 'Failed to enrol member in course' });
  }
}

export async function updateEnrolmentProgress(req, res) {
  try {
    const { enrolmentId } = req.params;
    const updated = await ocRepo.updateEnrolmentProgress(enrolmentId, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Enrolment record not found' });
    }
    res.json({ success: true, data: updated, message: 'Course progress updated' });
  } catch (err) {
    console.error('Error updating enrolment progress:', err);
    res.status(500).json({ success: false, message: 'Failed to update progress' });
  }
}

// ----------------------------------------------------
// 6. CERTIFICATES & ANALYTICS
// ----------------------------------------------------

export async function getCourseCertificates(req, res) {
  try {
    const certs = await ocRepo.getCourseCertificates();
    res.json({ success: true, data: certs });
  } catch (err) {
    console.error('Error fetching course certificates:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve certificates' });
  }
}

export async function issueCourseCertificate(req, res) {
  try {
    const { course_id, member_id, grade_score, issued_by } = req.body;
    if (!course_id || !member_id) {
      return res.status(400).json({ success: false, message: 'Course ID and Member ID are required' });
    }

    const cert = await ocRepo.issueCourseCertificate({ course_id, member_id, grade_score, issued_by });
    res.status(201).json({ success: true, data: cert, message: 'Course certificate issued successfully' });
  } catch (err) {
    console.error('Error issuing course certificate:', err);
    res.status(500).json({ success: false, message: 'Failed to issue certificate' });
  }
}

export async function getLearningAnalytics(req, res) {
  try {
    const analytics = await ocRepo.getLearningAnalytics();
    res.json({ success: true, data: analytics });
  } catch (err) {
    console.error('Error fetching learning analytics:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve analytics' });
  }
}

