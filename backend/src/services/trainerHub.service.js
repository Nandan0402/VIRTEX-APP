import * as repo from '../repositories/trainerHub.repository.js';
import * as workoutRepo from '../repositories/workout.repository.js';
import * as measurementRepo from '../repositories/measurement.repository.js';
import { buildProgressReport } from './progressReport.service.js';
import * as dietRepo from '../repositories/diet.repository.js';
import * as userRepository from '../repositories/user.repository.js';

/**
 * trainerHub.service.js
 * Validation, ownership/assignment checks, pagination and audit logging for /api/trainer/*.
 * Every function receives the trainerId resolved by trainerScope (never from the request body).
 */

const ASSIGNMENT_STATUSES = ['active', 'paused', 'completed', 'cancelled'];
const SESSION_STATUSES = ['booked', 'confirmed', 'completed', 'cancelled', 'no_show'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------- helpers

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function positiveInt(value, name) {
  const s = String(value ?? '').trim();
  const n = Number.parseInt(s, 10);
  if (!/^\d+$/.test(s) || n <= 0) throw httpError(400, `${name} must be a positive integer.`);
  return n;
}

function optionalEnum(value, allowed, name) {
  if (value === undefined || value === null || value === '') return null;
  if (!allowed.includes(value)) throw httpError(400, `${name} must be one of: ${allowed.join(', ')}.`);
  return value;
}

function optionalDate(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (!DATE_RE.test(String(value)) || Number.isNaN(new Date(value).getTime())) {
    throw httpError(400, `${name} must be YYYY-MM-DD.`);
  }
  return String(value);
}

function optionalTimestamp(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, `${name} must be a valid ISO date/time.`);
  return d.toISOString();
}

function optionalText(value, name, max) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw httpError(400, `${name} must be text.`);
  const t = value.trim();
  if (t.length > max) throw httpError(400, `${name} must be ${max} characters or fewer.`);
  return t;
}

function optionalNumber(value, name, { min = 0, max = 100000, int = false } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    throw httpError(400, `${name} must be ${int ? 'an integer' : 'a number'} between ${min} and ${max}.`);
  }
  return n;
}

function optionalBool(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw httpError(400, `${name} must be true or false.`);
  return value;
}

/** Parse ?page & ?limit (defaults 1 / 20, max 100). */
export function paging(q = {}) {
  const page = q.page === undefined ? 1 : positiveInt(q.page, 'page');
  const limit = q.limit === undefined ? 20 : positiveInt(q.limit, 'limit');
  if (limit > MAX_LIMIT) throw httpError(400, `limit must be ${MAX_LIMIT} or fewer.`);
  return { page, limit, offset: (page - 1) * limit };
}

function paginated({ rows, total }, { page, limit }) {
  return { data: rows, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

/** Audit important operations into auth_audit_logs (read by the Security console). Never throws. */
async function audit(ctx, eventType, details) {
  try {
    await userRepository.recordAuthAudit({
      userId: ctx.user?.id ?? null,
      username: ctx.user?.username || 'unknown',
      eventType,
      role: ctx.user?.role || null,
      ipAddress: ctx.ip || null,
      userAgent: ctx.userAgent || null,
      details: { trainerId: ctx.trainerId, ...details },
    });
  } catch (e) {
    console.warn('[TrainerHub] audit log failed:', e.message);
  }
}

async function requireClient(trainerId, memberIdParam) {
  const memberId = positiveInt(memberIdParam, 'memberId');
  if (!(await repo.isClientOfTrainer(trainerId, memberId))) {
    throw httpError(404, 'Client not found in your roster.'); // same answer for "other trainer's member"
  }
  return memberId;
}

async function requireActiveClient(trainerId, memberIdParam) {
  const memberId = positiveInt(memberIdParam, 'memberId');
  if (!(await repo.isActiveClientOfTrainer(trainerId, memberId))) {
    throw httpError(403, 'You can only do this for members actively assigned to you.');
  }
  return memberId;
}

// ---------------------------------------------------------------- trainer

export const getHealth = () => repo.getHealth();

export async function getMe(trainerId) {
  const profile = await repo.getTrainerProfile(trainerId);
  if (!profile) throw httpError(404, 'Trainer profile not found.');
  return profile;
}

export async function getDashboard(trainerId) {
  const profile = await getMe(trainerId);
  const present = await repo.getPresentHubTables();
  const [summary, recoveryAlerts, schedule, todaySessions] = await Promise.all([
    repo.getDashboardSummary(trainerId),
    repo.getRecoveryAlerts(trainerId),
    repo.getSchedule(trainerId),
    present.has('pt_sessions') ? repo.getTodaySessions(trainerId) : null,
  ]);
  return {
    trainer: { id: profile.id, fullName: profile.full_name, status: profile.status, specialty: profile.specialty },
    summary,
    todaySessions,                       // null until PT session migration is applied
    recoveryAlerts,
    upcomingAvailability: schedule.upcomingAvailability.slice(0, 5),
  };
}

export async function listClients(trainerId, q) {
  const p = paging(q);
  const status = optionalEnum(q.status, ASSIGNMENT_STATUSES, 'status');
  const search = optionalText(q.search, 'search', 80) || null;
  return paginated(await repo.listClients(trainerId, { status, search, ...p }), p);
}

export async function getClientDetail(trainerId, memberIdParam) {
  const memberId = await requireClient(trainerId, memberIdParam);
  return repo.getClientDetail(trainerId, memberId);
}

export const getSchedule = (trainerId) => repo.getSchedule(trainerId);

/** Classes I teach — scheduled by Admin (class calendar / online classes). ?from=YYYY-MM-DD&days=N */
export async function listMyClasses(trainerId, q = {}) {
  const fromDay = optionalDate(q.from, 'from');
  const days = q.days === undefined ? 28 : positiveInt(q.days, 'days');
  if (days > 90) throw httpError(400, 'days must be 90 or fewer.');
  const from = fromDay ? new Date(`${fromDay}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
  const to = new Date(from.getTime() + days * 86400000);
  const rows = await repo.listInstructorClasses(trainerId, { from: from.toISOString(), to: to.toISOString() });
  return rows.map((r) => ({
    id: r.id, title: r.title, category: r.category,
    type: r.class_type === 'vod_recorded' ? 'recorded' : r.class_type === 'in_person' ? 'in_person' : 'live',
    startsAt: r.scheduled_at, durationMins: r.duration_mins, capacity: r.max_participants, status: r.status,
    booked: r.booked, attended: r.attended, linkProvided: r.has_link,
  }));
}

export async function addAvailability(ctx, body = {}) {
  const specificDate = optionalDate(body.specificDate, 'specificDate');
  if (!specificDate) throw httpError(400, 'specificDate is required (YYYY-MM-DD).');
  const { startTime, endTime } = body;
  if (!TIME_RE.test(String(startTime || '')) || !TIME_RE.test(String(endTime || ''))) {
    throw httpError(400, 'startTime and endTime must be HH:MM (24-hour).');
  }
  if (String(endTime) <= String(startTime)) throw httpError(400, 'endTime must be after startTime.');
  const isAvailable = body.isAvailable === undefined ? true : optionalBool(body.isAvailable, 'isAvailable');
  const reason = optionalText(body.reason, 'reason', 150);
  const row = await repo.addAvailability(ctx.trainerId, { specificDate, startTime, endTime, isAvailable, reason });
  await audit(ctx, 'TRAINER_AVAILABILITY_ADDED', { availabilityId: row.id, specificDate, isAvailable });
  return row;
}

export async function getAttendance(trainerId, q) {
  const p = paging(q);
  const from = optionalDate(q.from, 'from');
  const to = optionalDate(q.to, 'to');
  const result = await repo.getAttendance(trainerId, { from, to, ...p });
  return { ...paginated(result, p), totals: result.totals };
}

export const listCommissions = (trainerId) => repo.listCommissions(trainerId);

// ---------------------------------------------------------------- assignments

export async function listAssignments(trainerId, q) {
  const p = paging(q);
  const status = optionalEnum(q.status, ASSIGNMENT_STATUSES, 'status');
  return paginated(await repo.listAssignments(trainerId, { status, ...p }), p);
}

export async function getAssignment(trainerId, assignmentIdParam) {
  const assignmentId = positiveInt(assignmentIdParam, 'assignmentId');
  const present = await repo.getPresentHubTables();
  const row = await repo.getAssignment(trainerId, assignmentId, {
    withHistory: present.has('pt_assignment_history'),
    withPurchases: present.has('pt_package_purchases'),
  });
  if (!row) throw httpError(404, 'Assignment not found.');
  return row;
}

// ---------------------------------------------------------------- workouts

function parseWorkoutBody(body, { partial }) {
  const out = {
    name: optionalText(body.name, 'name', 150),
    difficulty_level: optionalText(body.difficultyLevel, 'difficultyLevel', 30),
    goal: optionalText(body.goal, 'goal', 50),
    split_type: optionalText(body.splitType, 'splitType', 50),
    description: optionalText(body.description, 'description', 2000),
    is_template: optionalBool(body.isTemplate, 'isTemplate'),
  };
  if (!partial && !out.name) throw httpError(400, 'name is required.');
  if (out.name !== undefined && out.name.length === 0) throw httpError(400, 'name cannot be empty.');
  return out;
}

function parseWorkoutDays(days) {
  if (days === undefined) return [];
  if (!Array.isArray(days) || days.length > 14) throw httpError(400, 'days must be an array of up to 14 days.');
  return days.map((d, i) => {
    const exercises = d.exercises === undefined ? [] : d.exercises;
    if (!Array.isArray(exercises) || exercises.length > 30) {
      throw httpError(400, `days[${i}].exercises must be an array of up to 30 exercises.`);
    }
    return {
      day_number: optionalNumber(d.dayNumber, `days[${i}].dayNumber`, { min: 1, max: 14, int: true }) ?? i + 1,
      day_name: optionalText(d.dayName, `days[${i}].dayName`, 100) || `Day ${i + 1}`,
      focus: optionalText(d.focus, `days[${i}].focus`, 100) || '',
      exercises: exercises.map((e, j) => ({
        exercise_id: positiveInt(e.exerciseId, `days[${i}].exercises[${j}].exerciseId`),
        sets: optionalNumber(e.sets, 'sets', { min: 1, max: 20, int: true }) ?? 3,
        reps: optionalText(e.reps, 'reps', 30) || '8-12',
        target_weight_kg: optionalNumber(e.targetWeightKg, 'targetWeightKg', { min: 0, max: 1000 }) ?? null,
        rest_seconds: optionalNumber(e.restSeconds, 'restSeconds', { min: 0, max: 900, int: true }) ?? 90,
        notes: optionalText(e.notes, 'notes', 500) || '',
      })),
    };
  });
}

export async function listWorkouts(trainerId, q) {
  const p = paging(q);
  const includeTemplates = q.includeTemplates !== 'false';
  const search = optionalText(q.search, 'search', 80) || null;
  return paginated(await repo.listWorkoutPrograms(trainerId, { includeTemplates, search, ...p }), p);
}

export async function createWorkout(ctx, body = {}) {
  const data = parseWorkoutBody(body, { partial: false });
  const days = parseWorkoutDays(body.days);
  // Reuses the existing transactional creator; trainer_id always = caller's trainer
  const program = await workoutRepo.createWorkoutProgram(
    { ...data, trainer_id: ctx.trainerId, is_template: data.is_template ?? false },
    days
  );
  await audit(ctx, 'TRAINER_WORKOUT_CREATED', { programId: program.id, name: program.name, days: days.length });
  return workoutRepo.getWorkoutProgramById(program.id);
}

export async function updateWorkout(ctx, workoutIdParam, body = {}) {
  const programId = positiveInt(workoutIdParam, 'workoutId');
  const access = await repo.getProgramAccess(programId);
  if (!access) throw httpError(404, 'Workout programme not found.');
  if (access.trainer_id !== ctx.trainerId) throw httpError(403, 'You can only edit workout programmes you created.');
  const data = parseWorkoutBody(body, { partial: true });
  if (Object.values(data).every((v) => v === undefined)) throw httpError(400, 'No updatable fields supplied.');
  const updated = await repo.updateWorkoutProgram(ctx.trainerId, programId, data);
  await audit(ctx, 'TRAINER_WORKOUT_UPDATED', { programId, fields: Object.keys(data).filter((k) => data[k] !== undefined) });
  return updated;
}

export async function assignWorkout(ctx, workoutIdParam, body = {}) {
  const programId = positiveInt(workoutIdParam, 'workoutId');
  const access = await repo.getProgramAccess(programId);
  if (!access) throw httpError(404, 'Workout programme not found.');
  const usable = access.trainer_id === ctx.trainerId || (access.trainer_id === null && access.is_template);
  if (!usable) throw httpError(403, 'You can only assign your own programmes or shared templates.');
  const memberId = await requireActiveClient(ctx.trainerId, body.memberId);
  const startDate = optionalDate(body.startDate, 'startDate');
  const notes = optionalText(body.notes, 'notes', 1000);
  const row = await workoutRepo.assignProgramToMember({
    member_id: memberId, program_id: programId, assigned_by_trainer_id: ctx.trainerId, start_date: startDate, notes,
  });
  await audit(ctx, 'TRAINER_WORKOUT_ASSIGNED', { programId, memberId, assignmentId: row.id });
  return row;
}

// ---------------------------------------------------------------- diet plans

function parseDietBody(body, { partial }) {
  const out = {
    name: optionalText(body.name, 'name', 150),
    goal: optionalText(body.goal, 'goal', 50),
    target_calories: optionalNumber(body.targetCalories, 'targetCalories', { min: 500, max: 10000, int: true }),
    target_protein_g: optionalNumber(body.targetProteinG, 'targetProteinG', { min: 0, max: 1000, int: true }),
    target_carbs_g: optionalNumber(body.targetCarbsG, 'targetCarbsG', { min: 0, max: 2000, int: true }),
    target_fats_g: optionalNumber(body.targetFatsG, 'targetFatsG', { min: 0, max: 1000, int: true }),
    target_water_ml: optionalNumber(body.targetWaterMl, 'targetWaterMl', { min: 0, max: 10000, int: true }),
    description: optionalText(body.description, 'description', 2000),
    is_template: optionalBool(body.isTemplate, 'isTemplate'),
  };
  if (!partial && !out.name) throw httpError(400, 'name is required.');
  if (out.name !== undefined && out.name.length === 0) throw httpError(400, 'name cannot be empty.');
  return out;
}

function parseMeals(meals) {
  if (meals === undefined) return [];
  if (!Array.isArray(meals) || meals.length > 12) throw httpError(400, 'meals must be an array of up to 12 meals.');
  return meals.map((m, i) => {
    const items = m.items === undefined ? [] : m.items;
    if (!Array.isArray(items) || items.length > 30) throw httpError(400, `meals[${i}].items must be an array of up to 30 items.`);
    const scheduledTime = m.scheduledTime === undefined ? '08:00' : m.scheduledTime;
    if (!TIME_RE.test(String(scheduledTime))) throw httpError(400, `meals[${i}].scheduledTime must be HH:MM.`);
    return {
      meal_type: optionalText(m.mealType, `meals[${i}].mealType`, 30) || 'Meal',
      scheduled_time: scheduledTime,
      notes: optionalText(m.notes, 'notes', 500) || '',
      items: items.map((it, j) => ({
        food_item_id: positiveInt(it.foodItemId, `meals[${i}].items[${j}].foodItemId`),
        servings: optionalNumber(it.servings, 'servings', { min: 0.1, max: 20 }) ?? 1,
        custom_portion: optionalText(it.customPortion, 'customPortion', 50) || null,
        calories: optionalNumber(it.calories, 'calories', { min: 0, max: 5000 }) ?? 0,
        protein_g: optionalNumber(it.proteinG, 'proteinG', { min: 0, max: 500 }) ?? 0,
        carbs_g: optionalNumber(it.carbsG, 'carbsG', { min: 0, max: 1000 }) ?? 0,
        fats_g: optionalNumber(it.fatsG, 'fatsG', { min: 0, max: 500 }) ?? 0,
      })),
    };
  });
}

export async function listDietPlans(trainerId, q) {
  const p = paging(q);
  const includeTemplates = q.includeTemplates !== 'false';
  const search = optionalText(q.search, 'search', 80) || null;
  return paginated(await repo.listDietPlans(trainerId, { includeTemplates, search, ...p }), p);
}

export async function createDietPlan(ctx, body = {}) {
  const data = parseDietBody(body, { partial: false });
  const meals = parseMeals(body.meals);
  const plan = await dietRepo.createDietPlan(
    { ...data, trainer_id: ctx.trainerId, is_template: data.is_template ?? false },
    meals
  );
  await audit(ctx, 'TRAINER_DIET_PLAN_CREATED', { planId: plan.id, name: plan.name, meals: meals.length });
  return dietRepo.getDietPlanById(plan.id);
}

export async function updateDietPlan(ctx, planIdParam, body = {}) {
  const planId = positiveInt(planIdParam, 'planId');
  const access = await repo.getDietPlanAccess(planId);
  if (!access) throw httpError(404, 'Diet plan not found.');
  if (access.trainer_id !== ctx.trainerId) throw httpError(403, 'You can only edit diet plans you created.');
  const data = parseDietBody(body, { partial: true });
  const meals = body.meals !== undefined ? parseMeals(body.meals) : null;
  if (Object.values(data).every((v) => v === undefined) && meals === null) throw httpError(400, 'No updatable fields supplied.');
  const updated = await repo.updateDietPlan(ctx.trainerId, planId, data, meals);
  await audit(ctx, 'TRAINER_DIET_PLAN_UPDATED', { planId, fields: Object.keys(data).filter((k) => data[k] !== undefined), meals: meals ? meals.length : undefined });
  return updated;
}

export async function assignDietPlan(ctx, planIdParam, body = {}) {
  const planId = positiveInt(planIdParam, 'planId');
  const access = await repo.getDietPlanAccess(planId);
  if (!access) throw httpError(404, 'Diet plan not found.');
  const usable = access.trainer_id === ctx.trainerId || (access.trainer_id === null && access.is_template);
  if (!usable) throw httpError(403, 'You can only assign your own diet plans or shared templates.');
  const memberId = await requireActiveClient(ctx.trainerId, body.memberId);
  const startDate = optionalDate(body.startDate, 'startDate');
  const notes = optionalText(body.notes, 'notes', 1000);
  const row = await dietRepo.assignDietPlanToMember({
    member_id: memberId, plan_id: planId, assigned_by_trainer_id: ctx.trainerId, start_date: startDate, notes,
  });
  await audit(ctx, 'TRAINER_DIET_PLAN_ASSIGNED', { planId, memberId, assignmentId: row.id });
  return row;
}

// ---------------------------------------------------------------- coaching feedback & exercise library

const COMMENT_TYPES = ['general', 'workout', 'diet', 'recovery', 'progress', 'motivation'];

export async function addFeedback(ctx, memberIdParam, body = {}) {
  const memberId = await requireActiveClient(ctx.trainerId, memberIdParam);
  const commentType = optionalEnum(body.commentType ?? 'general', COMMENT_TYPES, 'commentType');
  const commentText = optionalText(body.commentText, 'commentText', 2000);
  if (!commentText) throw httpError(400, 'commentText is required.');
  const row = await repo.addTrainerComment(ctx.trainerId, memberId, { commentType, commentText });
  await audit(ctx, 'TRAINER_FEEDBACK_ADDED', { memberId, commentId: row.id, commentType });
  return row;
}

export async function listExercises(q) {
  const p = paging(q);
  const muscleGroup = optionalText(q.muscleGroup, 'muscleGroup', 50) || null;
  const search = optionalText(q.search, 'search', 80) || null;
  return paginated(await repo.listExercises({ muscleGroup, search, ...p }), p);
}

// ---------------------------------------------------------------- client performance

function dateRange(q) {
  const from = optionalDate(q.from, 'from');
  const to = optionalDate(q.to, 'to');
  if (from && to && to < from) throw httpError(400, 'to must be on or after from.');
  return { from, to };
}

export async function getClientProgress(trainerId, memberIdParam) {
  const memberId = await requireClient(trainerId, memberIdParam);
  const present = await repo.getPresentHubTables();
  const [progress, personalBests, report] = await Promise.all([
    repo.getClientProgress(memberId, {
      withCardio: present.has('member_cardio_benchmarks'),
      withSnapshots: present.has('member_progress_snapshots'),
    }),
    workoutRepo.getPersonalBests(memberId),
    buildProgressReport(memberId), // same figures the member sees on member-progress.html
  ]);
  return { memberId, ...progress, personalBests, report };
}

export async function getClientWorkoutLogs(trainerId, memberIdParam, q) {
  const memberId = await requireClient(trainerId, memberIdParam);
  const p = paging(q);
  const { from, to } = dateRange(q);
  // end date inclusive: compare completed_at < (to + 1 day)
  const toExclusive = to ? new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000).toISOString() : null;
  return paginated(await repo.getClientWorkoutLogs(memberId, { from, to: toExclusive, ...p }), p);
}

export async function getClientDietLogs(trainerId, memberIdParam, q) {
  const memberId = await requireClient(trainerId, memberIdParam);
  const p = paging(q);
  return paginated(await repo.getClientDietLogs(memberId, { ...dateRange(q), ...p }), p);
}

export async function getClientMeasurements(trainerId, memberIdParam, q) {
  const memberId = await requireClient(trainerId, memberIdParam);
  const p = paging(q);
  return paginated(await measurementRepo.listMemberMeasurements(memberId, p), p);
}

export async function getClientRecovery(trainerId, memberIdParam, q) {
  const memberId = await requireClient(trainerId, memberIdParam);
  const p = paging(q);
  return paginated(await repo.getClientRecoveryLogs(memberId, { ...dateRange(q), ...p }), p);
}

// ---------------------------------------------------------------- PT sessions

export async function listSessions(trainerId, q) {
  const p = paging(q);
  const from = optionalTimestamp(q.from, 'from');
  const to = optionalTimestamp(q.to, 'to');
  const status = optionalEnum(q.status, SESSION_STATUSES, 'status');
  const memberId = q.memberId === undefined ? null : positiveInt(q.memberId, 'memberId');
  return paginated(await repo.listSessions(trainerId, { from, to, status, memberId, ...p }), p);
}

const BOOKING_ERRORS = {
  NOT_ACTIVE_CLIENT: [403, 'You can only book sessions for members actively assigned to you.'],
  PURCHASE_NOT_FOUND: [404, 'PT package purchase not found for this member.'],
  PURCHASE_OTHER_TRAINER: [403, 'That PT package belongs to another trainer.'],
  PURCHASE_NOT_ACTIVE: [409, 'That PT package is not active.'],
  PURCHASE_EXPIRED: [409, 'That PT package expires before the session date.'],
  NO_SESSIONS_REMAINING: [409, 'No sessions remaining on that PT package.'],
};

export async function createSession(ctx, body = {}) {
  const memberId = positiveInt(body.memberId, 'memberId');
  const scheduledStart = optionalTimestamp(body.scheduledStart, 'scheduledStart');
  if (!scheduledStart) throw httpError(400, 'scheduledStart is required (ISO date/time).');
  let scheduledEnd = optionalTimestamp(body.scheduledEnd, 'scheduledEnd');
  if (!scheduledEnd) {
    const mins = optionalNumber(body.durationMins, 'durationMins', { min: 15, max: 240, int: true }) ?? 60;
    scheduledEnd = new Date(new Date(scheduledStart).getTime() + mins * 60000).toISOString();
  }
  if (scheduledEnd <= scheduledStart) throw httpError(400, 'scheduledEnd must be after scheduledStart.');
  if (new Date(scheduledStart).getTime() < Date.now() - 5 * 60000) throw httpError(400, 'Sessions cannot be booked in the past.');
  const purchasePublicId = body.purchaseId === undefined || body.purchaseId === null ? null : String(body.purchaseId);
  if (purchasePublicId && !UUID_RE.test(purchasePublicId)) throw httpError(400, 'purchaseId must be a UUID.');
  const location = optionalText(body.location, 'location', 120);
  const notes = optionalText(body.notes, 'notes', 1000);

  const result = await repo.createSession(
    ctx.trainerId,
    { memberId, scheduledStart, scheduledEnd, purchasePublicId, location, notes },
    ctx.user?.id
  );
  if (result.error) {
    const [status, msg] = BOOKING_ERRORS[result.error];
    throw httpError(status, msg);
  }
  await audit(ctx, 'TRAINER_PT_SESSION_BOOKED', { sessionId: result.session.public_id, memberId, scheduledStart });
  return result.session;
}

export async function completeSession(ctx, sessionIdParam, body = {}) {
  const sessionId = String(sessionIdParam || '');
  if (!UUID_RE.test(sessionId)) throw httpError(400, 'Invalid session id.');
  const outcome = optionalEnum(body.outcome ?? 'completed', ['completed', 'no_show'], 'outcome');
  const chargeNoShow = body.chargeNoShow === undefined ? true : optionalBool(body.chargeNoShow, 'chargeNoShow');
  const trainerNotes = optionalText(body.trainerNotes, 'trainerNotes', 2000);

  let result;
  try {
    result = await repo.completeSession(ctx.trainerId, sessionId, {
      outcome, userId: ctx.user?.id ?? null, chargeNoShow, trainerNotes,
    });
  } catch (err) {
    const msg = String(err.message || '');
    if (msg.startsWith('PT_SESSION_ALREADY_CLOSED')) throw httpError(409, 'This session is already closed.');
    if (msg.startsWith('PT_NO_SESSIONS_REMAINING')) throw httpError(409, 'The member has no sessions remaining on this package.');
    if (msg.startsWith('PT_PACKAGE_EXPIRED')) throw httpError(409, "The member's PT package has expired.");
    if (msg.startsWith('PT_PACKAGE_NOT_ACTIVE')) throw httpError(409, "The member's PT package is not active.");
    throw err;
  }
  if (!result) throw httpError(404, 'Session not found in your schedule.');
  await audit(ctx, 'TRAINER_PT_SESSION_CLOSED', {
    sessionId, memberId: result.member_id, outcome, balanceDeducted: result.balance_deducted,
  });
  const { member_id: _m, ...publicResult } = result;
  return publicResult;
}

// ---------------------------------------------------------------- admin oversight

/** Owner/manager summary of every trainer's Trainer Hub activity (default 30 days, max 365). */
export async function getAdminActivity(q = {}) {
  const days = q.days === undefined ? 30 : optionalNumber(q.days, 'days', { min: 1, max: 365, int: true });
  const present = await repo.getPresentHubTables();
  const trainers = await repo.getTrainerActivitySummary(days, { withPtSessions: present.has('pt_sessions') });
  return { days, ptSessionsAvailable: present.has('pt_sessions'), trainers };
}

// ---------------------------------------------------------------- messages / notifications

export const listThreads = (trainerId) => repo.listThreads(trainerId);

export async function listNotifications(userId, q) {
  return repo.listNotifications(userId, { unreadOnly: q.unread === 'true' });
}

export async function markNotificationRead(userId, idParam) {
  if (!UUID_RE.test(String(idParam || ''))) throw httpError(400, 'Invalid notification id.');
  const row = await repo.markNotificationRead(userId, idParam);
  if (!row) throw httpError(404, 'Notification not found.');
  return row;
}

// Shared validation helpers (reused by memberPortal.service.js)
export {
  httpError, positiveInt, optionalEnum, optionalDate, optionalTimestamp,
  optionalText, optionalNumber, optionalBool, paginated, audit,
};

// ---------------------------------------------------------------- client muscle recovery + per-muscle assign
// Same view as the member's Recovery page. Read: any of the trainer's clients (current or past);
// assign/remove: active clients only, and only this trainer's own "Coach muscle plan" rows.
const memberSvc = () => import('./memberPortal.service.js');
const memberRepo = () => import('../repositories/memberPortal.repository.js');

export async function getClientMuscleRecovery(trainerId, memberIdParam) {
  const memberId = await requireClient(trainerId, memberIdParam);
  const data = await (await memberSvc()).getMuscleRecovery(memberId);
  // Trainer's own ✓ Complete / ✗ Not done marks for today (migration 032) on their coach-plan exercises.
  const checks = await (await memberRepo()).getTrainerChecksToday(memberId).catch(() => null);
  data.checksAvailable = checks !== null;
  // A ✓ Complete in the last 7 days counts as training that muscle at the time it was marked: the muscle drops to
  // "recovering" and climbs back to 100% after its recovery time (about 72 h big muscles, 48 h smaller ones).
  const completed = await (await memberRepo()).getTrainerCompletedRecent(memberId, 7).catch(() => new Map());
  const now = Date.now();
  for (const m of data.muscles || []) {
    let at = 0; const names = [];
    for (const p of m.plan || []) {
      const t = p.coachPlan ? completed.get(p.planId) : undefined;
      if (t) { names.push(p.exercise); if (t > at) at = t; }
    }
    const last = m.lastTrainedAt ? Date.parse(m.lastTrainedAt) : 0;
    if (!at || at <= last) continue;
    const hours = Number(m.recoveryHours) || 48;
    const elapsedH = Math.max(0, (now - at) / 3600000);
    let percent = Math.min(100, Math.round((elapsedH / hours) * 100));
    if (m.soreness !== null && m.soreness >= 7) percent = Math.min(percent, 90);
    Object.assign(m, {
      lastTrainedAt: new Date(at).toISOString(), readyAt: new Date(at + hours * 3600000).toISOString(), recoveryHours: hours,
      percent, status: percent >= 100 ? 'recovered' : 'recovering', exercises: [...new Set([...names, ...(m.exercises || [])])].slice(0, 4),
      trainerCompleted: true,
    });
  }
  for (const m of data.muscles || []) {
    for (const p of m.plan || []) {
      if (!p.coachPlan) continue;
      p.trainerCheck = checks && checks.has(p.planId) ? checks.get(p.planId) : null;
      if (p.trainerCheck === true) p.status = 'done';
    }
    m.planDoneToday = (m.plan || []).length > 0 && m.plan.every((p) => p.status === 'done');
  }
  return data;
}
/** PUT { completed: true | false | null } — the trainer's own mark for today (null clears it). */
export async function checkClientMuscleExercise(ctx, memberIdParam, idParam, body = {}) {
  const memberId = await requireActiveClient(ctx.trainerId, memberIdParam);
  const id = positiveInt(idParam, 'planExerciseId');
  const completed = body.completed;
  if (!(completed === true || completed === false || completed === null)) throw httpError(400, 'Send completed: true, false or null.');
  const repo = await memberRepo();
  if ((await repo.getTrainerChecksToday(memberId)) === null) throw httpError(503, 'Complete / Not done needs database migration 032.');
  const ok = await repo.setTrainerCheckToday(ctx.trainerId, memberId, id, completed, ctx.user?.id);
  if (!ok) throw httpError(404, 'That exercise is not in your plan for this client.');
  await audit(ctx, 'TRAINER_MUSCLE_EXERCISE_CHECKED', { memberId, planExerciseId: id, completed });
  return { planExerciseId: id, completed };
}
export async function getMusclePlanOptions(q = {}) {
  return (await memberSvc()).getSelfPlanOptions(q);
}
export async function assignClientMuscleExercise(ctx, memberIdParam, body = {}) {
  const memberId = await requireActiveClient(ctx.trainerId, memberIdParam);
  const svc = await memberSvc();
  const { muscle, input } = await svc.parsePlanExerciseInput(body);
  const out = await (await memberRepo()).upsertTrainerPlanExercise(ctx.trainerId, memberId, input);
  await audit(ctx, 'TRAINER_MUSCLE_EXERCISE_ASSIGNED', { memberId, muscle, sets: input.sets, reps: input.reps, planExerciseId: out.planExerciseId });
  return { ...out, muscle };
}
export async function removeClientMuscleExercise(ctx, memberIdParam, idParam) {
  const memberId = await requireActiveClient(ctx.trainerId, memberIdParam);
  const id = positiveInt(idParam, 'planExerciseId');
  const n = await (await memberRepo()).removeTrainerPlanExercise(ctx.trainerId, memberId, id);
  if (!n) throw httpError(404, 'That exercise is not in your plan for this client.');
  await audit(ctx, 'TRAINER_MUSCLE_EXERCISE_REMOVED', { memberId, planExerciseId: id });
  return { removed: true };
}
