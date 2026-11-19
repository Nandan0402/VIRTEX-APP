import * as svc from '../services/trainerHub.service.js';
import * as messaging from '../services/messaging.service.js';

/**
 * trainerHub.controller.js — thin HTTP layer for /api/trainer/*.
 * req.trainerId comes ONLY from middlewares/trainerScope.js (never from body/params).
 * Responses: { success: true, data } or { success: true, data, pagination }.
 * Errors flow to the shared errorHandler: { success: false, error }.
 */

const ctx = (req) => ({
  trainerId: req.trainerId,
  user: req.user,
  ip: req.ip,
  userAgent: req.headers['user-agent'] || null,
});

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const okPage = (res, result) => res.json({ success: true, ...result });

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

// Trainer
export const getHealth = wrap(async (req, res) => {
  const h = await svc.getHealth();
  res.status(h.database === 'connected' ? 200 : 503).json({ success: h.database === 'connected', data: h });
});
export const getMe = wrap(async (req, res) => ok(res, await svc.getMe(req.trainerId)));
export const getDashboard = wrap(async (req, res) => ok(res, await svc.getDashboard(req.trainerId)));
export const listClients = wrap(async (req, res) => okPage(res, await svc.listClients(req.trainerId, req.query)));
export const getClientDetail = wrap(async (req, res) => ok(res, await svc.getClientDetail(req.trainerId, req.params.memberId)));
export const listMyClasses = wrap(async (req, res) => ok(res, await svc.listMyClasses(req.trainerId, req.query)));
export const getSchedule = wrap(async (req, res) => ok(res, await svc.getSchedule(req.trainerId)));
export const addAvailability = wrap(async (req, res) => ok(res, await svc.addAvailability(ctx(req), req.body), 201));
export const getAttendance = wrap(async (req, res) => okPage(res, await svc.getAttendance(req.trainerId, req.query)));
export const listCommissions = wrap(async (req, res) => ok(res, await svc.listCommissions(req.trainerId)));

// Assignments
export const listAssignments = wrap(async (req, res) => okPage(res, await svc.listAssignments(req.trainerId, req.query)));
export const getAssignment = wrap(async (req, res) => ok(res, await svc.getAssignment(req.trainerId, req.params.assignmentId)));

// Workouts
export const listWorkouts = wrap(async (req, res) => okPage(res, await svc.listWorkouts(req.trainerId, req.query)));
export const createWorkout = wrap(async (req, res) => ok(res, await svc.createWorkout(ctx(req), req.body), 201));
export const updateWorkout = wrap(async (req, res) => ok(res, await svc.updateWorkout(ctx(req), req.params.workoutId, req.body)));
export const assignWorkout = wrap(async (req, res) => ok(res, await svc.assignWorkout(ctx(req), req.params.workoutId, req.body), 201));

// Diet plans
export const listDietPlans = wrap(async (req, res) => okPage(res, await svc.listDietPlans(req.trainerId, req.query)));
export const createDietPlan = wrap(async (req, res) => ok(res, await svc.createDietPlan(ctx(req), req.body), 201));
export const updateDietPlan = wrap(async (req, res) => ok(res, await svc.updateDietPlan(ctx(req), req.params.planId, req.body)));
export const assignDietPlan = wrap(async (req, res) => ok(res, await svc.assignDietPlan(ctx(req), req.params.planId, req.body), 201));

// Coaching feedback & exercise library
export const addFeedback = wrap(async (req, res) => ok(res, await svc.addFeedback(ctx(req), req.params.memberId, req.body), 201));
export const listExercises = wrap(async (req, res) => okPage(res, await svc.listExercises(req.query)));

// Client performance
export const getClientProgress = wrap(async (req, res) => ok(res, await svc.getClientProgress(req.trainerId, req.params.memberId)));
export const getClientWorkoutLogs = wrap(async (req, res) =>
  okPage(res, await svc.getClientWorkoutLogs(req.trainerId, req.params.memberId, req.query)));
export const getClientDietLogs = wrap(async (req, res) =>
  okPage(res, await svc.getClientDietLogs(req.trainerId, req.params.memberId, req.query)));
export const getClientMeasurements = wrap(async (req, res) =>
  okPage(res, await svc.getClientMeasurements(req.trainerId, req.params.memberId, req.query)));
export const getClientRecovery = wrap(async (req, res) =>
  okPage(res, await svc.getClientRecovery(req.trainerId, req.params.memberId, req.query)));
export const getClientMuscleRecovery = wrap(async (req, res) =>
  ok(res, await svc.getClientMuscleRecovery(req.trainerId, req.params.memberId)));
export const getMusclePlanOptions = wrap(async (req, res) => ok(res, await svc.getMusclePlanOptions(req.query)));
export const checkClientMuscleExercise = wrap(async (req, res) =>
  ok(res, await svc.checkClientMuscleExercise(ctx(req), req.params.memberId, req.params.planExerciseId, req.body)));
export const assignClientMuscleExercise = wrap(async (req, res) =>
  ok(res, await svc.assignClientMuscleExercise(ctx(req), req.params.memberId, req.body), 201));
export const removeClientMuscleExercise = wrap(async (req, res) =>
  ok(res, await svc.removeClientMuscleExercise(ctx(req), req.params.memberId, req.params.planExerciseId)));

// PT sessions
export const listSessions = wrap(async (req, res) => okPage(res, await svc.listSessions(req.trainerId, req.query)));
export const createSession = wrap(async (req, res) => ok(res, await svc.createSession(ctx(req), req.body), 201));
export const completeSession = wrap(async (req, res) => ok(res, await svc.completeSession(ctx(req), req.params.sessionId, req.body)));

// Messages & notifications
export const listThreads = wrap(async (req, res) => ok(res, await svc.listThreads(req.trainerId)));
export const listNotifications = wrap(async (req, res) => ok(res, await svc.listNotifications(req.user.id, req.query)));
export const markNotificationRead = wrap(async (req, res) =>
  ok(res, await svc.markNotificationRead(req.user.id, req.params.notificationId)));

// Admin oversight (owner/manager; mounted under /api/admin/trainer-hub)
export const getAdminActivity = wrap(async (req, res) => ok(res, await svc.getAdminActivity(req.query)));

// ---- Conversations with clients (shared messaging service; same threads the member sees)
export const openThread = wrap(async (req, res) => ok(res, await messaging.trainerOpenThread(req.trainerId, req.params.threadId)));
export const sendThreadMessage = wrap(async (req, res) => ok(res, await messaging.trainerSend(ctx(req), req.params.threadId, req.body?.body), 201));
export const startThread = wrap(async (req, res) => ok(res, await messaging.trainerStartThread(ctx(req), req.body?.memberId), 201));
// Trainer ↔ gym team (owner/managers), migration 026
export const gymInfo = wrap(async (req, res) => ok(res, await messaging.trainerGymInfo(req.trainerId)));
export const startGymThread = wrap(async (req, res) => ok(res, await messaging.trainerStartGymThread(ctx(req), req.body?.body), 201));
