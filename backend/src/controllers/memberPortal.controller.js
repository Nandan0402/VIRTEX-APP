import * as svc from '../services/memberPortal.service.js';

/**
 * memberPortal.controller.js — thin HTTP layer for /api/member/*.
 * req.memberId comes ONLY from middlewares/memberScope.js.
 */

const ctx = (req) => ({
  memberId: req.memberId,
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

export const getMe = wrap(async (req, res) => ok(res, await svc.getMe(req.memberId)));
export const getTrainer = wrap(async (req, res) => ok(res, await svc.getTrainer(req.memberId)));
export const getWorkouts = wrap(async (req, res) => ok(res, await svc.getWorkouts(req.memberId)));
export const getDietPlans = wrap(async (req, res) => ok(res, await svc.getDietPlans(req.memberId)));
export const listFeedback = wrap(async (req, res) => okPage(res, await svc.listFeedback(req.memberId, req.query)));

export const listWorkoutLogs = wrap(async (req, res) => okPage(res, await svc.listWorkoutLogs(req.memberId, req.query)));
export const submitWorkoutLog = wrap(async (req, res) => ok(res, await svc.submitWorkoutLog(ctx(req), req.body), 201));

export const listNutritionLogs = wrap(async (req, res) => okPage(res, await svc.listNutritionLogs(req.memberId, req.query)));
export const submitNutritionLog = wrap(async (req, res) => ok(res, await svc.submitNutritionLog(ctx(req), req.body), 201));
export const getNutritionProgress = wrap(async (req, res) => ok(res, await svc.getNutritionProgress(req.memberId, req.query)));

export const listGymClasses = wrap(async (req, res) => ok(res, await svc.listGymClasses(req.memberId, req.query)));
export const registerForGymClass = wrap(async (req, res) => ok(res, await svc.registerForGymClass(ctx(req), req.params.classId), 201));
export const cancelGymClass = wrap(async (req, res) => ok(res, await svc.cancelGymClass(ctx(req), req.params.classId)));
export const listOnlineClasses = wrap(async (req, res) => ok(res, await svc.listOnlineClasses(req.memberId, req.query)));
export const registerForOnlineClass = wrap(async (req, res) => ok(res, await svc.registerForOnlineClass(ctx(req), req.params.classId), 201));
export const cancelOnlineClass = wrap(async (req, res) => ok(res, await svc.cancelOnlineClass(ctx(req), req.params.classId)));
export const listCourses = wrap(async (req, res) => ok(res, await svc.listCourses(req.memberId)));
export const getCourse = wrap(async (req, res) => ok(res, await svc.getCourse(req.memberId, req.params.courseId)));
export const enrolInCourse = wrap(async (req, res) => ok(res, await svc.enrolInCourse(ctx(req), req.params.courseId), 201));
export const completeCourseLesson = wrap(async (req, res) => ok(res, await svc.completeCourseLesson(ctx(req), req.params.courseId, req.params.lessonId)));
export const submitCourseAssessment = wrap(async (req, res) => ok(res, await svc.submitCourseAssessment(ctx(req), req.params.courseId, req.body)));
export const listEvents = wrap(async (req, res) => ok(res, await svc.listEvents(req.memberId)));
export const getEventLeaderboard = wrap(async (req, res) => ok(res, await svc.getEventLeaderboard(req.memberId, req.params.eventId)));
export const registerForEvent = wrap(async (req, res) => ok(res, await svc.registerForEvent(ctx(req), req.params.eventId, req.body), 201));
export const withdrawFromEvent = wrap(async (req, res) => ok(res, await svc.withdrawFromEvent(ctx(req), req.params.eventId)));
export const listBooks = wrap(async (req, res) => ok(res, await svc.listBooks(req.memberId)));
export const getBook = wrap(async (req, res) => ok(res, await svc.getBook(req.memberId, req.params.bookId)));
export const saveBookProgress = wrap(async (req, res) => ok(res, await svc.saveBookProgress(ctx(req), req.params.bookId, req.body)));
/** Streams a protected book file to an authorised member (private, never cached, no public URL). */
export const openBookFile = wrap(async (req, res) => {
  const f = await svc.openBookFile(req.memberId, req.params.bookId);
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Disposition', `inline; filename="${f.fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(f.file, { dotfiles: 'deny' });
});
export const getMessagesInbox = wrap(async (req, res) => ok(res, await svc.getMessagesInbox(ctx(req))));
export const openMessageThread = wrap(async (req, res) => ok(res, await svc.openMessageThread(ctx(req), req.params.threadId)));
export const sendThreadMessage = wrap(async (req, res) => ok(res, await svc.sendThreadMessage(ctx(req), req.params.threadId, req.body), 201));
export const startMessageThread = wrap(async (req, res) => ok(res, await svc.startMessageThread(ctx(req), req.body), 201));
export const getMemberNotifications = wrap(async (req, res) => ok(res, await svc.getMemberNotifications(ctx(req))));
export const markNotificationRead = wrap(async (req, res) => ok(res, await svc.markNotificationRead(ctx(req), req.params.notificationId)));
export const markAllNotificationsRead = wrap(async (req, res) => ok(res, await svc.markAllNotificationsRead(ctx(req))));
export const getMemberAnnouncements = wrap(async (req, res) => ok(res, await svc.getMemberAnnouncements(req.memberId)));
export const voteOnAnnouncement = wrap(async (req, res) => ok(res, await svc.voteOnAnnouncement(req.memberId, req.params.id, req.body || {})));
export const withdrawVote = wrap(async (req, res) => ok(res, await svc.voteOnAnnouncement(req.memberId, req.params.id, { optionIds: [] })));
export const getFeedbackCentre = wrap(async (req, res) => ok(res, await svc.getFeedbackCentre(req.memberId)));
export const submitFeedback = wrap(async (req, res) => ok(res, await svc.submitFeedback(ctx(req), req.body), 201));
export const getAttendanceHistory = wrap(async (req, res) => ok(res, await svc.getAttendanceHistory(req.memberId, req.query)));
export const getFacilities = wrap(async (req, res) => ok(res, await svc.getFacilities(req.memberId)));
export const getSettings = wrap(async (req, res) => ok(res, await svc.getSettings(ctx(req))));
export const updatePreferences = wrap(async (req, res) => ok(res, await svc.updatePreferences(ctx(req), req.body)));
export const getAchievements = wrap(async (req, res) => ok(res, await svc.getAchievements(req.memberId)));
export const listMeasurements = wrap(async (req, res) => okPage(res, await svc.listMeasurements(req.memberId, req.query)));
export const submitMeasurement = wrap(async (req, res) => ok(res, await svc.submitMeasurement(ctx(req), req.body), 201));
export const listRecovery = wrap(async (req, res) => okPage(res, await svc.listRecovery(req.memberId, req.query)));
export const getMuscleRecovery = wrap(async (req, res) => ok(res, await svc.getMuscleRecovery(req.memberId)));
export const getSelfPlanOptions = wrap(async (req, res) => ok(res, await svc.getSelfPlanOptions(req.query)));
export const addSelfPlanExercise = wrap(async (req, res) => ok(res, await svc.addSelfPlanExercise(ctx(req), req.body), 201));
export const removeSelfPlanExercise = wrap(async (req, res) => ok(res, await svc.removeSelfPlanExercise(ctx(req), req.params.planExerciseId)));
export const submitRecovery = wrap(async (req, res) => ok(res, await svc.submitRecovery(ctx(req), req.body), 201));

export const getProgress = wrap(async (req, res) => ok(res, await svc.getProgress(req.memberId)));
export const listPtSessions = wrap(async (req, res) => okPage(res, await svc.listPtSessions(req.memberId, req.query)));
export const respondToPtSession = wrap(async (req, res) => ok(res, await svc.respondToPtSession(ctx(req), req.params.sessionId, req.body)));
export const ratePtSession = wrap(async (req, res) => ok(res, await svc.ratePtSession(ctx(req), req.params.sessionId, req.body)));

export const getDashboard = wrap(async (req, res) => ok(res, await svc.getDashboard(req.memberId, req.user?.id)));

export const getProfile = wrap(async (req, res) => ok(res, await svc.getProfile(req.memberId)));
export const updateProfile = wrap(async (req, res) => ok(res, await svc.updateProfile(ctx(req), req.body)));
export const updatePhoto = wrap(async (req, res) => ok(res, await svc.updatePhoto(ctx(req), req.body)));

export const getMembership = wrap(async (req, res) => ok(res, await svc.getMembership(req.memberId)));
export const listPayments = wrap(async (req, res) => okPage(res, await svc.listPayments(req.memberId, req.query)));
export const listInvoices = wrap(async (req, res) => okPage(res, await svc.listInvoices(req.memberId, req.query)));
export const getInvoice = wrap(async (req, res) => ok(res, await svc.getInvoice(req.memberId, req.params.invoiceId)));

export const getWorkoutDay = wrap(async (req, res) => ok(res, await svc.getWorkoutDay(req.memberId, req.params.programId, req.params.dayId)));

export const listExerciseCatalogue = wrap(async (req, res) => okPage(res, await svc.listExerciseCatalogue(req.query)));
export const listFoodCatalogue = wrap(async (req, res) => okPage(res, await svc.listFoodCatalogue(req.query)));

export const getDietAssignment = wrap(async (req, res) => ok(res, await svc.getDietAssignment(req.memberId, req.params.assignmentId)));

export const getFoodDiary = wrap(async (req, res) => ok(res, await svc.getFoodDiary(req.memberId, req.query)));
export const saveFoodDiary = wrap(async (req, res) => ok(res, await svc.saveFoodDiary(ctx(req), req.params.date, req.body)));
