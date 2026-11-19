/**
 * Virtex Admin - Online Classes and Courses Router
 * Secure REST routes for live streaming, VOD workouts, curriculum management,
 * quizzes, digital certificates, and learning analytics.
 */

import { Router } from 'express';
import * as ocController from '../controllers/onlineClass.controller.js';
import { requireRole } from '../middlewares/auth.js';

const router = Router();

// Analytics Summary
router.get('/analytics/summary', requireRole('owner', 'manager', 'trainer'), ocController.getLearningAnalytics);

// Online Classes & Livestreams
router.get('/', requireRole('owner', 'manager', 'trainer'), ocController.getOnlineClasses);
router.post('/', requireRole('owner', 'manager', 'trainer'), ocController.createOnlineClass);
router.get('/:id', requireRole('owner', 'manager', 'trainer'), ocController.getOnlineClassById);
router.patch('/:id/status', requireRole('owner', 'manager', 'trainer'), ocController.updateClassStatus);

// Class Registrations & Attendance
router.get('/registrations/all', requireRole('owner', 'manager', 'trainer'), ocController.getClassRegistrations);
router.post('/registrations', requireRole('owner', 'manager', 'trainer'), ocController.registerMemberForClass);
router.patch('/registrations/:registrationId/attendance', requireRole('owner', 'manager', 'trainer'), ocController.recordAttendance);

// Masterclass Courses & Curriculum
router.get('/courses/all', requireRole('owner', 'manager', 'trainer'), ocController.getCourses);
router.post('/courses', requireRole('owner', 'manager', 'trainer'), ocController.createCourse);
router.get('/courses/:id', requireRole('owner', 'manager', 'trainer'), ocController.getCourseById);
router.get('/courses/:courseId/lessons', requireRole('owner', 'manager', 'trainer'), ocController.getCourseLessons);
router.post('/courses/:courseId/lessons', requireRole('owner', 'manager', 'trainer'), ocController.addCourseLesson);

// Course Assessments & Quizzes
router.get('/courses/:courseId/quiz', requireRole('owner', 'manager', 'trainer'), ocController.getCourseQuiz);
router.post('/courses/:courseId/quiz', requireRole('owner', 'manager', 'trainer'), ocController.saveCourseQuiz);

// Enrolments & Completion Progress
router.get('/enrolments/all', requireRole('owner', 'manager', 'trainer'), ocController.getCourseEnrolments);
router.post('/enrolments', requireRole('owner', 'manager', 'trainer'), ocController.enrolMemberInCourse);
router.patch('/enrolments/:enrolmentId/progress', requireRole('owner', 'manager', 'trainer'), ocController.updateEnrolmentProgress);

// Academy Certificates
router.get('/certificates/all', requireRole('owner', 'manager', 'trainer'), ocController.getCourseCertificates);
router.post('/certificates', requireRole('owner', 'manager', 'trainer'), ocController.issueCourseCertificate);

export default router;

