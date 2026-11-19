import { Router } from 'express';
import * as c from '../controllers/memberPortal.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';
import { memberScope } from '../middlewares/memberScope.js';
import * as feeStatus from '../controllers/feeStatus.controller.js';
import * as memberGoal from '../controllers/memberGoal.controller.js';
import * as trainingTimes from '../controllers/trainingTimes.controller.js';
import * as memberMenu from '../controllers/memberMenu.controller.js';
import { requireHubTables } from '../middlewares/trainerScope.js';

/**
 * Member API — mounted at /member  →  /api/member/*  and  /api/v1/member/*
 *
 * Every route: valid JWT + role 'member' + memberScope (req.memberId = caller's own
 * member profile). No route accepts a member id from the client, so a member can never
 * read or write another member's records. Members cannot create/edit workout
 * programmes or diet plans — they can only read what is assigned and submit their logs.
 */
const router = Router();

router.use(authenticateToken, requireRole('member'), memberScope);
router.get('/menu', memberMenu.memberMenu);                                 // which features the admin switched on for me
router.get('/punch', memberMenu.memberPunchStatus);                         // Punch In / Out (check_ins, migration 035)
router.post('/punch-in', memberMenu.memberPunchIn);
router.post('/punch-out', memberMenu.memberPunchOut);
router.get('/training-times', trainingTimes.memberTimes);                    // own PT + general training times and requests
router.post('/time-shift-requests', trainingTimes.memberRequest);            // ask the admin to change a time
router.post('/time-shift-requests/:id/cancel', trainingTimes.memberCancel);
router.get('/goal', memberGoal.getGoal);                                   // own training goal: bulking / cutting / maintain
router.put('/goal', memberGoal.setGoal);
router.get('/fee-status', feeStatus.memberFeeStatus);                      // own fee countdown + gender + plan week (migration 031)

router.get('/me', c.getMe);
router.get('/dashboard', c.getDashboard);

// Own profile: read + permitted personal fields only (members row and linked login kept in sync)
router.get('/profile', c.getProfile);
router.patch('/profile', c.updateProfile);
router.put('/profile/photo', c.updatePhoto);

// Own membership + billing (read-only; Membership Plans Catalog + Tax Invoices & Billing records)
router.get('/membership', c.getMembership);
router.get('/payments', c.listPayments);
router.get('/invoices', c.listInvoices);
router.get('/invoices/:invoiceId', c.getInvoice);          // read-only summary of the caller's own records
router.get('/trainer', c.getTrainer);
router.get('/workouts', c.getWorkouts);
router.get('/workouts/:programId/days/:dayId', c.getWorkoutDay);   // 404 unless assigned to the caller
router.get('/diet-plans', c.getDietPlans);
router.get('/diet-plans/:assignmentId', c.getDietAssignment);   // own current or past plan; 404 otherwise
router.get('/feedback', c.listFeedback);

router.get('/exercises', c.listExerciseCatalogue);              // read-only catalogue for logging
router.get('/foods', c.listFoodCatalogue);                      // read-only food database catalogue for food diary logging
router.get('/workout-logs', c.listWorkoutLogs);
router.post('/workout-logs', c.submitWorkoutLog);

router.get('/food-diary', c.getFoodDiary);                     // one day (?date=YYYY-MM-DD)
router.put('/food-diary/:date', c.saveFoodDiary);              // save whole day (today … 7 days back)
router.get('/nutrition-logs', c.listNutritionLogs);
router.post('/nutrition-logs', c.submitNutritionLog);
router.get('/nutrition-progress', c.getNutritionProgress);

router.get('/measurements', c.listMeasurements);                       // own full history (insert-only)
router.post('/measurements', c.submitMeasurement);
router.get('/recovery', c.listRecovery);
// Muscle recovery + per-muscle exercise plan are TRAINER-ONLY (Trainer Hub → Client Profile). Members cannot
// read or change them: these member routes are closed (the Member Recovery page was removed).
const trainerOnly = (req, res) => res.status(403).json({ success: false, code: 'TRAINER_ONLY', error: 'Muscle recovery is visible to trainers only.' });
router.get('/muscle-recovery', trainerOnly);
router.get('/my-plan/options', trainerOnly);
router.post('/my-plan', trainerOnly);
router.delete('/my-plan/:planExerciseId', trainerOnly);
router.post('/recovery', c.submitRecovery);

router.get('/progress', c.getProgress);
router.get('/achievements', c.getAchievements);                       // derived from own records, read-only
router.get('/classes', c.listGymClasses);                                 // admin calendar classes (in-person)
router.post('/classes/:classId/register', c.registerForGymClass);         // capacity + duplicate checked, row-locked
router.post('/classes/:classId/cancel', c.cancelGymClass);                // own booking, before start
router.get('/online-classes', c.listOnlineClasses);                       // live + recorded + attendance + video lessons
router.post('/online-classes/:classId/register', c.registerForOnlineClass);
router.post('/online-classes/:classId/cancel', c.cancelOnlineClass);
router.get('/courses', c.listCourses);                                    // published catalogue + my enrolments
router.get('/courses/:courseId', c.getCourse);                            // lessons/videos/assessment only when enrolled
router.post('/courses/:courseId/enrol', c.enrolInCourse);
router.post('/courses/:courseId/lessons/:lessonId/complete', c.completeCourseLesson);   // in order
router.post('/courses/:courseId/assessment', c.submitCourseAssessment);                  // graded on the server
router.get('/events', c.listEvents);                                      // Admin Events & Competitions
router.get('/events/:eventId/leaderboard', c.getEventLeaderboard);        // scored entries, names masked
router.post('/events/:eventId/register', c.registerForEvent);             // before deadline only
router.post('/events/:eventId/withdraw', c.withdrawFromEvent);
router.get('/books', c.listBooks);                                        // only books I may see + my purchases
router.get('/books/:bookId', c.getBook);
router.get('/books/:bookId/file', c.openBookFile);                        // authenticated stream from private vault
router.put('/books/:bookId/progress', c.saveBookProgress);
router.get('/messages', c.getMessagesInbox);                              // my threads with assigned trainers
router.post('/messages', c.startMessageThread);                           // start with an ASSIGNED trainer only
router.get('/messages/:threadId', c.openMessageThread);                   // own thread only; marks trainer msgs read
router.post('/messages/:threadId', c.sendThreadMessage);
router.get('/notifications', c.getMemberNotifications);                   // own inbox + reminders from own records
router.post('/notifications/read-all', c.markAllNotificationsRead);
router.post('/notifications/:notificationId/read', c.markNotificationRead);
router.get('/announcements', c.getMemberAnnouncements);
router.post('/announcements/:id/vote', c.voteOnAnnouncement);                   // vote / change vote on a poll I can see
router.delete('/announcements/:id/vote', c.withdrawVote);                       // take my vote back
router.get('/feedback-centre', c.getFeedbackCentre);                      // my submissions + choices (own only)
router.post('/feedback-centre', c.submitFeedback);                        // → member_feedbacks / member_complaints
router.get('/attendance', c.getAttendanceHistory);                         // own check-ins only (read-only)
router.get('/facilities', c.getFacilities);                                 // Admin-managed hours, zones, equipment, maintenance (read-only)
router.get('/settings', c.getSettings);                                     // account summary + preferences (own)
router.put('/settings/preferences', c.updatePreferences);                  // notifications + leaderboard name (migration 023)
router.get('/pt-sessions', requireHubTables('pt_sessions', 'pt_package_purchases'), c.listPtSessions);
router.post('/pt-sessions/:sessionId/respond', requireHubTables('pt_sessions'), c.respondToPtSession);
router.post('/pt-sessions/:sessionId/rating', requireHubTables('pt_sessions'), c.ratePtSession);

export default router;
