import { Router } from 'express';
import * as c from '../controllers/trainerHub.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';
import { trainerScope, requireHubTables } from '../middlewares/trainerScope.js';
import * as pwReq from '../controllers/passwordRequest.controller.js';
import * as trainerAnn from '../controllers/trainerAnnouncements.controller.js';
import * as feeStatus from '../controllers/feeStatus.controller.js';
import * as trainingTimes from '../controllers/trainingTimes.controller.js';

/**
 * Trainer Hub API — mounted at /trainer  →  /api/trainer/*  and  /api/v1/trainer/*
 *
 * Security (server-side on EVERY route; hiding UI buttons is not relied on):
 *  1. authenticateToken          valid, non-revoked JWT
 *  2. requireRole(...)           trainer (or owner/manager in supervisory mode)
 *  3. trainerScope               pins req.trainerId to the caller's own trainer profile;
 *                                owners/managers must pick one with ?trainerId=
 *  4. service layer              member-assignment checks (active client for writes,
 *                                past/active client for reads) and ownership checks
 *  5. requireHubTables(...)      503 until the needed trainer_hub migration is applied
 */
const router = Router();

router.use(authenticateToken, requireRole('trainer', 'owner', 'manager'));

const PT = requireHubTables('pt_sessions', 'pt_package_purchases', 'pt_session_balance_ledger');

// ---- Trainer
router.get('/health', c.getHealth);                                   // read-only DB + migration status
router.get('/me', trainerScope, c.getMe);
router.get('/welfare', trainerScope, feeStatus.trainerWelfare);
router.get('/general-members', trainerScope, trainingTimes.trainerGeneralMembers);   // own general-training members + times   // own 20% gym-welfare share countdown (migration 031)
// Login details + admin-authorised password change requests (no self-service password change for trainers)
router.get('/account', trainerScope, pwReq.getMyAccount);
router.post('/account/password-request', trainerScope, pwReq.requestPasswordChange);
router.get('/dashboard', trainerScope, c.getDashboard);
router.get('/clients', trainerScope, c.listClients);
router.get('/clients/:memberId', trainerScope, c.getClientDetail);
router.get('/schedule', trainerScope, c.getSchedule);
router.get('/classes', trainerScope, c.listMyClasses);                  // classes I teach (Admin-scheduled), read-only
router.post('/schedule/availability', trainerScope, c.addAvailability);
router.get('/attendance', trainerScope, c.getAttendance);
router.get('/commissions', trainerScope, c.listCommissions);

// ---- Assignments
router.get('/assignments', trainerScope, c.listAssignments);
router.get('/assignments/:assignmentId', trainerScope, c.getAssignment);

// ---- Workouts
router.get('/exercises', trainerScope, c.listExercises);                 // shared library, read-only
router.get('/workouts', trainerScope, c.listWorkouts);
router.post('/workouts', trainerScope, c.createWorkout);
router.put('/workouts/:workoutId', trainerScope, c.updateWorkout);
router.post('/workouts/:workoutId/assign', trainerScope, c.assignWorkout);

// ---- Diet
router.get('/diet-plans', trainerScope, c.listDietPlans);
router.post('/diet-plans', trainerScope, c.createDietPlan);
router.put('/diet-plans/:planId', trainerScope, c.updateDietPlan);
router.post('/diet-plans/:planId/assign', trainerScope, c.assignDietPlan);

// ---- PT sessions (migration trainer_hub/002)
router.get('/pt-sessions', trainerScope, PT, c.listSessions);
router.post('/pt-sessions', trainerScope, PT, c.createSession);
router.patch('/pt-sessions/:sessionId/complete', trainerScope, PT, c.completeSession);

// ---- Client performance
router.get('/clients/:memberId/progress', trainerScope, c.getClientProgress);
router.get('/clients/:memberId/workout-logs', trainerScope, c.getClientWorkoutLogs);
router.get('/clients/:memberId/diet-logs', trainerScope, c.getClientDietLogs);
router.get('/clients/:memberId/recovery', trainerScope, c.getClientRecovery);
router.get('/clients/:memberId/measurements', trainerScope, c.getClientMeasurements); // assigned clients only
// Muscle recovery per client + per-muscle exercise assignment (shows on the member's Recovery page)
router.get('/clients/:memberId/muscle-recovery', trainerScope, c.getClientMuscleRecovery);
router.get('/muscle-plan/options', trainerScope, c.getMusclePlanOptions);
router.post('/clients/:memberId/muscle-plan', trainerScope, c.assignClientMuscleExercise);     // active clients only
router.delete('/clients/:memberId/muscle-plan/:planExerciseId', trainerScope, c.removeClientMuscleExercise);
router.put('/clients/:memberId/muscle-plan/:planExerciseId/check', trainerScope, c.checkClientMuscleExercise);   // trainer-only ✓ Complete / ✗ Not done (today)
router.post('/clients/:memberId/feedback', trainerScope, c.addFeedback);   // coaching feedback

// ---- Messages (migration 008) & notifications (migration 009, caller's own inbox)
router.get('/messages/threads', trainerScope, requireHubTables('message_threads', 'messages'), c.listThreads);
router.post('/messages/threads', trainerScope, requireHubTables('message_threads', 'messages'), c.startThread);              // own clients only
router.get('/messages/gym', trainerScope, requireHubTables('message_threads', 'messages'), c.gymInfo);                   // my gym-team chat (if any)
router.post('/messages/gym', trainerScope, requireHubTables('message_threads', 'messages'), c.startGymThread);            // start / reopen it
router.get('/messages/threads/:threadId', trainerScope, requireHubTables('message_threads', 'messages'), c.openThread);
router.post('/messages/threads/:threadId', trainerScope, requireHubTables('message_threads', 'messages'), c.sendThreadMessage);
// Gym announcements & polls for trainers (vote: the signed-in trainer only)
router.get('/announcements', trainerScope, trainerAnn.list);
router.post('/announcements/:id/vote', trainerScope, trainerAnn.castVote);
router.delete('/announcements/:id/vote', trainerScope, trainerAnn.withdrawVote);
router.get('/notifications', requireHubTables('notifications'), c.listNotifications);
router.patch('/notifications/:notificationId/read', requireHubTables('notifications'), c.markNotificationRead);

export default router;
