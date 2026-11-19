import { Router } from 'express';
import * as workoutController from '../controllers/workout.controller.js';
import { requireRole } from '../middlewares/auth.js';

const router = Router();

// Exercise Library
router.get('/exercises', requireRole('owner', 'manager', 'trainer'), workoutController.getExercises);
router.get('/exercises/:id', requireRole('owner', 'manager', 'trainer'), workoutController.getExerciseById);
router.post('/exercises', requireRole('owner', 'manager', 'trainer'), workoutController.createExercise);

// Workout Programs & Builder
router.get('/programs', requireRole('owner', 'manager', 'trainer'), workoutController.getWorkoutPrograms);
router.get('/programs/:id', requireRole('owner', 'manager', 'trainer'), workoutController.getWorkoutProgramById);
router.post('/programs', requireRole('owner', 'manager', 'trainer'), workoutController.createWorkoutProgram);

// Member Assignments
router.get('/assignments', requireRole('owner', 'manager', 'trainer'), workoutController.getMemberAssignments);
router.post('/assignments', requireRole('owner', 'manager', 'trainer'), workoutController.assignProgramToMember);
router.patch('/assignments/:id/status', requireRole('owner', 'manager', 'trainer'), workoutController.updateAssignmentStatus);

// Workout Session Logging & History
router.get('/sessions', requireRole('owner', 'manager', 'trainer'), workoutController.getWorkoutSessionLogs);
router.get('/sessions/:id', requireRole('owner', 'manager', 'trainer'), workoutController.getWorkoutSessionDetail);
router.post('/sessions', requireRole('owner', 'manager', 'trainer'), workoutController.logWorkoutSession);

// Member Strength Progression & Personal Bests
router.get('/progress/:memberId', requireRole('owner', 'manager', 'trainer'), workoutController.getMemberWorkoutProgress);

// Workout Analytics
router.get('/analytics', requireRole('owner', 'manager', 'trainer'), workoutController.getWorkoutAnalytics);

export default router;

