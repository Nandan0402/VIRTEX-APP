import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as repo from '../repositories/memberPortal.repository.js';
import * as hubRepo from '../repositories/trainerHub.repository.js';
import * as workoutRepo from '../repositories/workout.repository.js';
import * as dietRepo from '../repositories/diet.repository.js';
import * as measurementRepo from '../repositories/measurement.repository.js';
import * as recoveryRepo from '../repositories/recovery.repository.js';
import { buildProgressReport } from './progressReport.service.js';
import { buildAchievements } from './achievements.service.js';
import * as messaging from './messaging.service.js';
import * as messagingRepo from '../repositories/messaging.repository.js';
import * as pollRepo from '../repositories/poll.repository.js';
import { retentionRepository } from '../repositories/retention.repository.js';
import {
  paging, httpError, positiveInt, optionalDate, optionalTimestamp, optionalText,
  optionalNumber, optionalBool, optionalEnum, paginated, audit,
} from './trainerHub.service.js';

/**
 * memberPortal.service.js — /api/member/*
 * Every function receives the caller's own memberId (memberScope); member ids in the
 * request are never trusted. Members can READ programmes/plans assigned to them but
 * there is no endpoint to create or edit them (trainer-created originals are protected).
 */

const memberCtx = (ctx) => ({ ...ctx, trainerId: undefined });

// ---------------------------------------------------------------- profile & assignments

export async function getMe(memberId) {
  const profile = await repo.getProfile(memberId);
  if (!profile) throw httpError(404, 'Member profile not found.');
  return profile;
}

export async function getTrainer(memberId) {
  const present = await hubRepo.getPresentHubTables();
  const ptReady = present.has('pt_sessions') && present.has('pt_package_purchases');
  const [rows, packages, sessions] = await Promise.all([
    repo.getAssignedTrainer(memberId),
    present.has('pt_package_purchases') && present.has('pt_packages') ? repo.listPtPackages(memberId) : null,
    ptReady ? repo.listPtSessions(memberId, { from: new Date().toISOString(), to: null, limit: 5, offset: 0 }) : null,
  ]);
  const current = rows[0] || null;
  // Coaching feedback from the CURRENT trainer only (history stays on the Progress pages)
  const feedback = current
    ? (await repo.listFeedback(memberId, { limit: 20, offset: 0 })).rows.filter((f) => f.trainer_id === current.trainer_id).slice(0, 3)
    : [];
  return {
    current,
    all: rows,
    packages,                                   // null until PT migration is applied
    upcomingSessions: sessions === null ? null : sessions.rows,
    feedback,
  };
}

export async function getWorkouts(memberId) {
  const assignments = await repo.listWorkoutAssignments(memberId);
  const activeProgramIds = [...new Set(assignments.filter((a) => a.status === 'active').map((a) => a.program_id))];
  const [programs, completion, sessionsThisWeek, trainers] = await Promise.all([
    Promise.all(activeProgramIds.map((id) => workoutRepo.getWorkoutProgramById(id))),
    repo.getDayCompletion(memberId, activeProgramIds),
    repo.countSessionsThisWeek(memberId),
    repo.getAssignedTrainer(memberId),
  ]);
  const activePrograms = await Promise.all(programs.filter(Boolean).map(async (p) => {
    const lastLogged = await repo.getLastLoggedDay(memberId, p.id);
    const next = nextProgrammeDay(p, lastLogged);
    const days = (p.days || []).map((d) => {
      const c = completion.find((x) => x.program_id === p.id && x.day_id === d.id);
      return { ...d, completion: { total: c?.completions ?? 0, thisWeek: c?.this_week ?? 0, lastCompletedAt: c?.last_completed_at ?? null } };
    });
    return { ...p, days, today: next ? { dayId: next.day.id, basis: next.basis, after: next.lastLogged || null } : null };
  }));
  return {
    assignments,
    activePrograms,
    week: { sessionsLogged: sessionsThisWeek, targetPerWeek: trainers[0]?.sessions_per_week ?? null },
  };
}

export async function getDietPlans(memberId) {
  const assignments = await repo.listDietAssignments(memberId);
  const activePlanIds = [...new Set(assignments.filter((a) => a.status === 'active').map((a) => a.plan_id))];
  const plans = await Promise.all(activePlanIds.map((id) => dietRepo.getDietPlanById(id)));
  // "Latest authorised plan": the most recently started ACTIVE assignment, with full meal detail.
  const active = assignments.filter((a) => a.status === 'active')
    .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)) || b.id - a.id);
  const current = active[0] ? { assignment: active[0], plan: await repo.getDietPlanDetail(active[0].plan_id) } : null;
  return {
    assignments,
    activePlans: plans.filter(Boolean),
    current,
    otherActive: active.slice(1),
    history: assignments.filter((a) => a.status !== 'active'),     // kept permanently; never deleted
  };
}

/** A specific assignment of the member's (current or historical) with its plan detail. 404 if not theirs. */
export async function getDietAssignment(memberId, idParam) {
  const id = positiveInt(idParam, 'assignmentId');
  const assignment = await repo.getOwnDietAssignment(memberId, id);
  if (!assignment) throw httpError(404, 'Diet plan not found on your account.');
  return { assignment, plan: await repo.getDietPlanDetail(assignment.plan_id) };
}

const FEEDBACK_TYPES = ['general', 'workout', 'diet', 'recovery', 'progress', 'motivation'];
export async function listFeedback(memberId, q) {
  const p = paging(q);
  const type = q.type === undefined ? null : optionalEnum(q.type, FEEDBACK_TYPES, 'type');
  return paginated(await repo.listFeedback(memberId, { ...p, type }), p);
}

// ---------------------------------------------------------------- workout logs

export async function listWorkoutLogs(memberId, q) {
  const p = paging(q);
  const from = optionalDate(q.from, 'from');
  const to = optionalDate(q.to, 'to');
  const toExclusive = to ? new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000).toISOString() : null;
  const page = await hubRepo.getClientWorkoutLogs(memberId, { from, to: toExclusive, ...p });
  // Completion status from real data: logged sets vs the sets prescribed for that programme day.
  const prescribed = await repo.getPrescribedSets(memberId, page.rows.map((r) => r.id));
  page.rows = page.rows.map((r) => {
    const pr = prescribed.find((x) => x.log_id === r.id);
    const logged = Array.isArray(r.sets) ? r.sets.length : 0;
    let completion = { status: 'logged', loggedSets: logged, prescribedSets: null };          // session outside a programme day
    if (pr?.day_id && pr.prescribed_sets > 0) {
      completion = { status: logged >= pr.prescribed_sets ? 'completed' : 'partial', loggedSets: logged, prescribedSets: pr.prescribed_sets };
    }
    return { ...r, completion };
  });
  return paginated(page, p);
}

/** Read-only exercise catalogue for logging free sessions (no member data). */
export async function listExerciseCatalogue(q) {
  const p = paging({ ...q, limit: q.limit ?? 100 });
  const search = optionalText(q.search, 'search', 80) || null;
  const category = q.category === undefined || q.category === '' ? null
    : optionalEnum(q.category, Object.keys(repo.EXERCISE_CATEGORIES), 'category');
  const difficulty = q.difficulty === undefined || q.difficulty === '' ? null
    : optionalEnum(q.difficulty, ['Beginner', 'Intermediate', 'Advanced'], 'difficulty');
  const page = await repo.listLibraryExercises({ category, search, difficulty, ...p });
  return {
    ...paginated(page, p),
    categories: Object.entries(repo.EXERCISE_CATEGORIES).map(([key, c]) => ({ key, label: c.label, count: page.categoryCounts[key] })),
    totalExercises: page.categoryCounts.all,
  };
}

export async function listFoodCatalogue(q = {}) {
  const p = paging({ ...q, limit: q.limit ?? 100 });
  const category = optionalText(q.category, 'category', 50) || null;
  const search = optionalText(q.search, 'search', 100) || null;
  const items = await dietRepo.getFoodItems({ category, search });
  const slice = items.slice(p.offset, p.offset + p.limit);
  return paginated({ rows: slice, total: items.length }, p);
}

export async function submitWorkoutLog(ctx, body = {}) {
  const memberId = ctx.memberId;
  const programId = body.programId === undefined || body.programId === null ? null : positiveInt(body.programId, 'programId');
  const dayId = body.dayId === undefined || body.dayId === null ? null : positiveInt(body.dayId, 'dayId');
  if (programId && !(await repo.hasActiveProgram(memberId, programId))) {
    throw httpError(403, 'You can only log workouts for programmes currently assigned to you.');
  }
  if (dayId && (!programId || !(await repo.dayBelongsToProgram(dayId, programId)))) {
    throw httpError(400, 'dayId must belong to the given programme.');
  }
  const durationMinutes = optionalNumber(body.durationMinutes, 'durationMinutes', { min: 1, max: 600, int: true });
  if (durationMinutes === undefined) throw httpError(400, 'durationMinutes is required.');
  const rpeRating = optionalNumber(body.rpeRating, 'rpeRating', { min: 1, max: 10, int: true });
  if (rpeRating === undefined) throw httpError(400, 'rpeRating (1-10) is required.');
  const completedAt = optionalTimestamp(body.completedAt, 'completedAt');
  if (completedAt && new Date(completedAt).getTime() > Date.now() + 5 * 60000) {
    throw httpError(400, 'completedAt cannot be in the future.');
  }
  const notes = optionalText(body.notes, 'notes', 1000);
  const sets = body.sets === undefined ? [] : body.sets;
  if (!Array.isArray(sets) || sets.length > 200) throw httpError(400, 'sets must be an array of up to 200 sets.');
  const items = sets.map((s, i) => ({
    exercise_id: positiveInt(s.exerciseId, `sets[${i}].exerciseId`),
    set_number: optionalNumber(s.setNumber, `sets[${i}].setNumber`, { min: 1, max: 50, int: true }) ?? i + 1,
    reps_completed: (() => {
      const r = optionalNumber(s.reps, `sets[${i}].reps`, { min: 1, max: 500, int: true });
      if (r === undefined) throw httpError(400, `sets[${i}].reps is required.`);
      return r;
    })(),
    weight_kg: optionalNumber(s.weightKg, `sets[${i}].weightKg`, { min: 0, max: 1000 }) ?? 0,
  }));

  if (!items.length && !programId) throw httpError(400, 'Add at least one completed set.');

  // Duplicate-submission guard (double-click, retried request, two tabs): one log per member at a time,
  // and an equivalent log within 2 minutes is refused instead of being stored twice.
  const guarded = await repo.withWorkoutLogGuard(memberId, { programId, dayId, durationMinutes, completedAt }, () =>
    workoutRepo.logWorkoutSession(
      {
        member_id: memberId, program_id: programId, day_id: dayId, completed_at: completedAt,
        duration_minutes: durationMinutes, rpe_rating: rpeRating, notes, logged_by: 'Member',
      },
      items
    ));
  if (guarded.duplicateOf) throw httpError(409, 'This workout has already been recorded.');
  const log = guarded.log;
  await audit(memberCtx(ctx), 'MEMBER_WORKOUT_LOGGED', { memberId, workoutLogId: log.id, sets: items.length });
  return log;
}

// ---------------------------------------------------------------- nutrition logs

export async function listNutritionLogs(memberId, q) {
  const p = paging(q);
  return paginated(await hubRepo.getClientDietLogs(memberId, {
    from: optionalDate(q.from, 'from'), to: optionalDate(q.to, 'to'), ...p,
  }), p);
}

export async function submitNutritionLog(ctx, body = {}) {
  const memberId = ctx.memberId;
  const logDate = optionalDate(body.logDate, 'logDate');
  if (logDate && logDate > new Date().toISOString().slice(0, 10)) throw httpError(400, 'logDate cannot be in the future.');
  const waterIntakeMl = optionalNumber(body.waterIntakeMl, 'waterIntakeMl', { min: 0, max: 15000, int: true }) ?? 0;
  const adherenceScore = optionalNumber(body.adherenceScore, 'adherenceScore', { min: 1, max: 100, int: true }) ?? 100;
  const notes = optionalText(body.notes, 'notes', 1000);
  const meals = body.meals === undefined ? [] : body.meals;
  if (!Array.isArray(meals) || meals.length > 50) throw httpError(400, 'meals must be an array of up to 50 entries.');
  const entries = meals.map((m, i) => ({
    meal_type: optionalText(m.mealType, `meals[${i}].mealType`, 30) || 'Meal',
    food_item_id: m.foodItemId === undefined || m.foodItemId === null ? null : positiveInt(m.foodItemId, `meals[${i}].foodItemId`),
    food_name: (() => {
      const n = optionalText(m.foodName, `meals[${i}].foodName`, 120);
      if (!n) throw httpError(400, `meals[${i}].foodName is required.`);
      return n;
    })(),
    portion_size: optionalText(m.portionSize, `meals[${i}].portionSize`, 50) || '1 portion',
    calories: optionalNumber(m.calories, 'calories', { min: 0, max: 5000 }) ?? 0,
    protein_g: optionalNumber(m.proteinG, 'proteinG', { min: 0, max: 500 }) ?? 0,
    carbs_g: optionalNumber(m.carbsG, 'carbsG', { min: 0, max: 1000 }) ?? 0,
    fats_g: optionalNumber(m.fatsG, 'fatsG', { min: 0, max: 500 }) ?? 0,
  }));

  const log = await dietRepo.logDailyNutrition(
    { member_id: memberId, log_date: logDate, water_intake_ml: waterIntakeMl, adherence_score: adherenceScore, notes, logged_by: 'Member' },
    entries
  );
  await audit(memberCtx(ctx), 'MEMBER_NUTRITION_LOGGED', { memberId, nutritionLogId: log?.id, entries: entries.length });
  return log;
}

function toDateOnly(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return String(d).slice(0, 10);
}

const numOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export async function getNutritionProgress(memberId, q = {}) {
  const targetDateStr = q.date ? optionalDate(q.date, 'date') : (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();

  const [ty, tm, td] = targetDateStr.split('-').map(Number);
  const targetDate = new Date(ty, tm - 1, td);

  const startDate = new Date(targetDate);
  startDate.setDate(startDate.getDate() - 29);
  const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;

  const [logsRes, dietPlansData, trainers] = await Promise.all([
    hubRepo.getClientDietLogs(memberId, {
      from: startDateStr,
      to: targetDateStr,
      limit: 100,
      offset: 0,
    }),
    getDietPlans(memberId),
    repo.getAssignedTrainer(memberId),
  ]);

  const logsByDate = new Map();
  // Only diaries the member submitted themselves (food diary / member log) count as "logged".
  // A day with no member-submitted row is MISSING data, never zero intake.
  for (const row of logsRes.rows) {
    if (row.logged_by !== 'Member') continue;
    const dStr = toDateOnly(row.log_date);
    if (dStr) logsByDate.set(dStr, row);
  }

  // 1. Daily intake for selected target date
  const todayRow = logsByDate.get(targetDateStr) || null;
  const isTodayLogged = !!todayRow;
  const isZeroCalories = isTodayLogged && (Number(todayRow.total_calories) === 0);

  const dailyIntake = {
    date: targetDateStr,
    isLogged: isTodayLogged,
    isMissing: !isTodayLogged,
    isZeroIntake: isZeroCalories,
    calories: isTodayLogged ? Number(todayRow.total_calories) : null,
    proteinG: isTodayLogged ? Number(todayRow.total_protein_g) : null,
    carbsG: isTodayLogged ? Number(todayRow.total_carbs_g) : null,
    fatsG: isTodayLogged ? Number(todayRow.total_fats_g) : null,
    waterMl: isTodayLogged ? numOrNull(todayRow.water_intake_ml) : null,
    adherenceScore: isTodayLogged ? numOrNull(todayRow.adherence_score) : null,
    notes: isTodayLogged ? todayRow.notes : null,
    meals: isTodayLogged ? (todayRow.meals || []) : [],
  };

  // 2. Meal completion for target date
  const mealCategories = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  const mealCompletion = mealCategories.map((type) => {
    const matching = (dailyIntake.meals || []).filter(
      (m) => (m.mealType || '').trim().toLowerCase() === type.toLowerCase()
    );
    const isCompleted = matching.length > 0;
    return {
      mealType: type,
      isCompleted,
      itemCount: matching.length,
      items: matching,
      calories: isCompleted ? matching.reduce((s, it) => s + (Number(it.calories) || 0), 0) : null,
      proteinG: isCompleted ? Math.round(matching.reduce((s, it) => s + (Number(it.protein_g) || 0), 0) * 10) / 10 : null,
      carbsG: isCompleted ? Math.round(matching.reduce((s, it) => s + (Number(it.carbs_g) || 0), 0) * 10) / 10 : null,
      fatsG: isCompleted ? Math.round(matching.reduce((s, it) => s + (Number(it.fats_g) || 0), 0) * 10) / 10 : null,
    };
  });
  const mealsLoggedCount = mealCompletion.filter((m) => m.isCompleted).length;
  const mealCompletionPercent = Math.round((mealsLoggedCount / mealCategories.length) * 100);

  // 3. Weekly nutrition history (past 7 days ending at targetDateStr)
  const weeklyHistory = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(targetDate);
    d.setDate(d.getDate() - i);
    const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayRow = logsByDate.get(dStr);
    const isLogged = !!dayRow;
    const isZero = isLogged && (Number(dayRow.total_calories) === 0);

    weeklyHistory.push({
      date: dStr,
      dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
      isLogged,
      isMissing: !isLogged,
      isZeroIntake: isZero,
      calories: isLogged ? Number(dayRow.total_calories) : null,
      proteinG: isLogged ? Number(dayRow.total_protein_g) : null,
      carbsG: isLogged ? Number(dayRow.total_carbs_g) : null,
      fatsG: isLogged ? Number(dayRow.total_fats_g) : null,
      waterMl: isLogged ? numOrNull(dayRow.water_intake_ml) : null,
      adherenceScore: isLogged ? numOrNull(dayRow.adherence_score) : null,
      mealsCount: isLogged ? (dayRow.meals ? dayRow.meals.length : 0) : null,
      mealSlotsLogged: isLogged ? new Set((dayRow.meals || []).map((m) => String(m.mealType || '').toLowerCase())).size : null,
      notes: isLogged ? dayRow.notes : null,
    });
  }

  // 4. Monthly nutrition trends (past 30 days)
  const monthlySeries = [];
  let loggedCount = 0;
  let missingCount = 0;
  let sumCal = 0;
  let sumProt = 0;
  let sumCarbs = 0;
  let sumFats = 0;
  let sumWater = 0;
  let sumAdherence = 0;
  let adherenceDays = 0;
  let sumWaterDays = 0;

  for (let i = 29; i >= 0; i--) {
    const d = new Date(targetDate);
    d.setDate(d.getDate() - i);
    const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayRow = logsByDate.get(dStr);
    const isLogged = !!dayRow;
    const isZero = isLogged && (Number(dayRow.total_calories) === 0);

    if (isLogged) {
      loggedCount++;
      sumCal += Number(dayRow.total_calories) || 0;
      sumProt += Number(dayRow.total_protein_g) || 0;
      sumCarbs += Number(dayRow.total_carbs_g) || 0;
      sumFats += Number(dayRow.total_fats_g) || 0;
      if (numOrNull(dayRow.water_intake_ml) !== null) { sumWater += Number(dayRow.water_intake_ml); sumWaterDays++; }
      if (numOrNull(dayRow.adherence_score) !== null) { sumAdherence += Number(dayRow.adherence_score); adherenceDays++; }
    } else {
      missingCount++;
    }

    monthlySeries.push({
      date: dStr,
      dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
      isLogged,
      isMissing: !isLogged,
      isZeroIntake: isZero,
      calories: isLogged ? Number(dayRow.total_calories) : null,
      proteinG: isLogged ? Number(dayRow.total_protein_g) : null,
      carbsG: isLogged ? Number(dayRow.total_carbs_g) : null,
      fatsG: isLogged ? Number(dayRow.total_fats_g) : null,
      waterMl: isLogged ? numOrNull(dayRow.water_intake_ml) : null,
      adherenceScore: isLogged ? numOrNull(dayRow.adherence_score) : null,
    });
  }

  const avgCal = loggedCount > 0 ? Math.round(sumCal / loggedCount) : null;
  const avgProt = loggedCount > 0 ? Math.round((sumProt / loggedCount) * 10) / 10 : null;
  const avgCarbs = loggedCount > 0 ? Math.round((sumCarbs / loggedCount) * 10) / 10 : null;
  const avgFats = loggedCount > 0 ? Math.round((sumFats / loggedCount) * 10) / 10 : null;
  const avgWater = sumWaterDays > 0 ? Math.round(sumWater / sumWaterDays) : null;
  const avgAdh = adherenceDays > 0 ? Math.round(sumAdherence / adherenceDays) : null;

  const totalMacroGrams = (avgProt || 0) + (avgCarbs || 0) + (avgFats || 0);
  const macroSplit = totalMacroGrams > 0 ? {
    proteinPercent: Math.round(((avgProt || 0) / totalMacroGrams) * 100),
    carbsPercent: Math.round(((avgCarbs || 0) / totalMacroGrams) * 100),
    fatsPercent: Math.round(((avgFats || 0) / totalMacroGrams) * 100),
  } : null;

  // 5. Prescribed Targets from Diet Plan
  const currentPlan = dietPlansData.current?.plan || null;
  const currentAssignment = dietPlansData.current?.assignment || null;
  const currentTrainer = trainers[0] || null;

  const targets = currentPlan ? {
    planId: currentPlan.id,
    planName: currentPlan.name,
    goal: currentPlan.goal,
    calories: Number(currentPlan.target_calories) || null,
    proteinG: Number(currentPlan.target_protein_g) || null,
    carbsG: Number(currentPlan.target_carbs_g) || null,
    fatsG: Number(currentPlan.target_fats_g) || null,
    waterMl: Number(currentPlan.target_water_ml) || null,
    description: currentPlan.description || null,
    prescribedMeals: currentPlan.meals || [],
  } : null;

  // 6. Trainer Hub Connection
  const trainerHub = {
    isAssigned: !!currentTrainer,
    trainerId: currentTrainer?.trainer_id || null,
    trainerName: currentTrainer?.trainer_name || null,
    specialty: currentTrainer?.specialty || null,
    trainerEmail: currentTrainer?.trainer_email || null,
    status: currentTrainer?.assignment_status || null,
    // Notes the trainer wrote on the diet assignment (not the plan description).
    trainerNotes: currentAssignment?.notes || null,
    // True only when an active trainer assignment exists: Trainer Hub's diet monitoring
    // (GET /trainer/clients/:memberId/diet-logs, scoped to assigned clients) reads these same rows.
    trainerCanReview: !!currentTrainer,
    isSynced: true,
    planTrainerName: currentPlan?.trainer_name || null,
  };

  return {
    today: dailyIntake,
    targets,
    mealCompletion: {
      completionPercent: mealCompletionPercent,
      mealsLoggedCount,
      totalMeals: mealCategories.length,
      meals: mealCompletion,
    },
    weeklyHistory,
    monthlyTrends: {
      summary: {
        totalDays: 30,
        loggedDaysCount: loggedCount,
        missingDaysCount: missingCount,
        loggingConsistencyPercent: Math.round((loggedCount / 30) * 100),
        avgCalories: avgCal,
        avgProteinG: avgProt,
        avgCarbsG: avgCarbs,
        avgFatsG: avgFats,
        avgWaterMl: avgWater,
        avgAdherenceScore: avgAdh,
      },
      macroSplit,
      dailySeries: monthlySeries,
    },
    trainerHub,
  };
}

// ---------------------------------------------------------------- measurements & recovery

/** YYYY-MM-DD in the server's local calendar. */
const localYmd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Measurement date: optional (defaults to now). Must be a real calendar date, not in the future,
 * and not before 2000-01-01. A past date is stored at 12:00 local time on that day.
 */
function measurementLoggedAt(value) {
  const d = optionalDate(value, 'measuredOn');
  if (d === null) return null;
  const [y, m, day] = d.split('-').map(Number);
  const probe = new Date(y, m - 1, day);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== day) throw httpError(400, 'measuredOn is not a real date.');
  const today = localYmd();
  if (d > today) throw httpError(400, 'measuredOn cannot be in the future.');
  if (d < '2000-01-01') throw httpError(400, 'measuredOn must be 2000-01-01 or later.');
  return d === today ? null : `${d} 12:00:00`;
}

export async function listMeasurements(memberId, q = {}) {
  const p = paging(q);
  return paginated(await measurementRepo.listMemberMeasurements(memberId, p), p);
}

export async function submitMeasurement(ctx, body = {}) {
  // Optional values: blank = not measured. 0 is rejected (it would be read as "not measured").
  const num = (key, label, max) => optionalNumber(body[key], label, { min: 0.1, max });
  const loggedAt = measurementLoggedAt(body.measuredOn);
  const weightKg = optionalNumber(body.weightKg, 'weightKg', { min: 20, max: 400 });
  const heightCm = optionalNumber(body.heightCm, 'heightCm', { min: 100, max: 250 });
  if (weightKg === undefined || heightCm === undefined) throw httpError(400, 'weightKg and heightCm are required.');
  const row = await measurementRepo.recordBodyMeasurement({
    member_id: ctx.memberId,
    weight_kg: weightKg,
    height_cm: heightCm,
    body_fat_pct: num('bodyFatPct', 'bodyFatPct', 70),
    muscle_mass_kg: num('muscleMassKg', 'muscleMassKg', 200),
    chest_cm: num('chestCm', 'chestCm', 250),
    waist_cm: num('waistCm', 'waistCm', 250),
    hips_cm: num('hipsCm', 'hipsCm', 250),
    arms_cm: num('armsCm', 'armsCm', 100),
    thighs_cm: num('thighsCm', 'thighsCm', 150),
    calves_cm: num('calvesCm', 'calvesCm', 100),
    shoulders_cm: num('shouldersCm', 'shouldersCm', 250),
    neck_cm: num('neckCm', 'neckCm', 100),
    notes: optionalText(body.notes, 'notes', 1000),
    measured_by: 'Member',
    logged_at: loggedAt,
  });
  await audit(memberCtx(ctx), 'MEMBER_MEASUREMENT_LOGGED', { memberId: ctx.memberId, measurementId: row.id });
  return row;
}

export async function listRecovery(memberId, q) {
  const p = paging(q);
  const [page, ready] = await Promise.all([
    hubRepo.getClientRecoveryLogs(memberId, { from: optionalDate(q.from, 'from'), to: optionalDate(q.to, 'to'), ...p }),
    repo.recoverySelfReportReady(),
  ]);
  return { ...paginated(page, p), selfReportReady: ready };
}

export const RECOVERY_SELF_ASSESSMENTS = ['fully_recovered', 'mostly_recovered', 'partly_recovered', 'not_recovered'];
export const RECOVERY_MUSCLE_GROUPS = ['Neck', 'Shoulders', 'Chest', 'Upper back', 'Lower back', 'Biceps', 'Triceps', 'Forearms',
  'Abs', 'Glutes', 'Hip flexors', 'Quads', 'Hamstrings', 'Calves', 'Other'];

/**
 * Member recovery check-in. Stores exactly what the member reports — no readiness score,
 * fatigue index or advice is generated, and nothing here is a medical assessment.
 * Date window: today back to 7 days (older days are locked). Requires migration 022.
 */
export async function submitRecovery(ctx, body = {}) {
  if (!(await repo.recoverySelfReportReady())) {
    const err = httpError(503, 'Recovery check-ins are waiting for a database update (migration 022). Nothing was saved.');
    err.code = 'MIGRATION_PENDING';
    throw err;
  }
  const required = (key, min, max, int = true) => {
    const v = optionalNumber(body[key], key, { min, max, int });
    if (v === undefined) throw httpError(400, `${key} is required.`);
    return v;
  };
  const today = localYmd();
  const logDate = optionalDate(body.logDate, 'logDate') || today;
  const [y, m, dd] = logDate.split('-').map(Number);
  const probe = new Date(y, m - 1, dd);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== dd) throw httpError(400, 'logDate is not a real date.');
  if (logDate > today) throw httpError(400, 'logDate cannot be in the future.');
  const oldest = new Date(); oldest.setDate(oldest.getDate() - 7);
  if (logDate < localYmd(oldest)) throw httpError(403, 'Check-ins older than 7 days are locked.');

  const selfAssessment = optionalEnum(body.selfAssessment, RECOVERY_SELF_ASSESSMENTS, 'selfAssessment');
  if (!selfAssessment) throw httpError(400, 'selfAssessment is required.');
  const isRestDay = optionalBool(body.isRestDay, 'isRestDay') ?? false;
  const restDayActivity = optionalText(body.restDayActivity, 'restDayActivity', 100) || null;
  if (restDayActivity && !isRestDay) throw httpError(400, 'restDayActivity is only recorded on a rest day.');

  const soreness = body.soreness === undefined ? [] : body.soreness;
  if (!Array.isArray(soreness) || soreness.length > RECOVERY_MUSCLE_GROUPS.length) throw httpError(400, 'soreness must be a list of muscle groups.');
  const seen = new Set();
  const sorenessRows = soreness.map((x, i) => {
    const muscleGroup = optionalEnum(x?.muscleGroup, RECOVERY_MUSCLE_GROUPS, `soreness[${i}].muscleGroup`);
    if (!muscleGroup) throw httpError(400, `soreness[${i}].muscleGroup is required.`);
    if (seen.has(muscleGroup)) throw httpError(400, `${muscleGroup} is listed twice.`);
    seen.add(muscleGroup);
    const level = optionalNumber(x.level, `soreness[${i}].level`, { min: 1, max: 10, int: true });
    if (level === undefined) throw httpError(400, `soreness[${i}].level is required (1–10).`);
    return { muscleGroup, level, notes: optionalText(x.notes, `soreness[${i}].notes`, 200) || '' };
  });

  const data = {
    sleepHours: required('sleepHours', 0, 24, false),
    sleepQuality: required('sleepQuality', 1, 10),
    fatigueLevel: required('fatigueLevel', 1, 10),
    overallSoreness: required('overallSoreness', 0, 10),
    // Optional extras: blank stays empty (no defaults are filled in).
    energyLevel: optionalNumber(body.energyLevel, 'energyLevel', { min: 1, max: 10, int: true }) ?? null,
    stressLevel: optionalNumber(body.stressLevel, 'stressLevel', { min: 1, max: 10, int: true }) ?? null,
    hydrationLiters: optionalNumber(body.hydrationLiters, 'hydrationLiters', { min: 0, max: 15 }) ?? null,
    isRestDay,
    restDayActivity,
    selfAssessment,
    notes: optionalText(body.notes, 'notes', 1000) || '',
  };
  if (data.overallSoreness === 0 && sorenessRows.length) throw httpError(400, 'Overall soreness is 0 but sore muscle groups were listed.');

  const log = await repo.saveRecoveryCheckin(ctx.memberId, logDate, data, sorenessRows);
  await audit(memberCtx(ctx), 'MEMBER_RECOVERY_LOGGED', { memberId: ctx.memberId, recoveryLogId: log?.id, logDate });
  return log;
}

// ---------------------------------------------------------------- progress & PT schedule

export async function getProgress(memberId) {
  const present = await hubRepo.getPresentHubTables();
  const [progress, personalBests, report] = await Promise.all([
    hubRepo.getClientProgress(memberId, {
      withCardio: present.has('member_cardio_benchmarks'),
      withSnapshots: present.has('member_progress_snapshots'),
    }),
    workoutRepo.getPersonalBests(memberId),
    buildProgressReport(memberId), // calculated from records only (see progressReport.service.js)
  ]);
  return { ...progress, personalBests, report };
}

// ---------------------------------------------------------------- in-gym classes (Admin Class & Shift Calendar)

/** Admin calendar categories → member-facing groups. */
function classGroup(category) {
  const c = String(category || '').toLowerCase();
  if (c.includes('yoga') || c.includes('pilates')) return 'yoga';
  if (['gym', 'training', 'strength', 'pt'].some((k) => c.includes(k))) return 'training';
  return 'group'; // zumba, hiit, bootcamp / event and other group formats
}

function presentClass(r, now = new Date()) {
  const start = new Date(r.scheduled_at);
  const end = new Date(start.getTime() + (Number(r.duration_mins) || 0) * 60000);
  const cap = r.max_participants === null ? null : Number(r.max_participants);
  const booked = Number(r.booked) || 0;
  const slotsLeft = cap === null ? null : Math.max(0, cap - booked);
  const mine = r.my_status === 'registered' || r.my_status === 'attended';
  let registration;
  if (r.status === 'cancelled') registration = 'cancelled';
  else if (start <= now) registration = end <= now ? 'finished' : 'in_progress';
  else if (mine) registration = 'registered';
  else if (r.status !== 'scheduled') registration = 'closed';
  else if (slotsLeft === 0) registration = 'full';
  else registration = 'open';
  return {
    id: r.id, title: r.title, category: r.category, group: classGroup(r.category),
    startsAt: r.scheduled_at, endsAt: end.toISOString(), durationMins: Number(r.duration_mins) || null,
    trainerName: r.trainer_name || null, description: r.description || '', difficulty: r.difficulty || null,
    capacity: cap, booked, slotsLeft,
    registration,                                  // open | full | closed | registered | cancelled | in_progress | finished
    myStatus: r.my_status || null,
    canRegister: registration === 'open',
    canCancel: registration === 'registered',
  };
}

export async function listGymClasses(memberId, q = {}) {
  const today = localYmd();
  const from = optionalDate(q.from, 'from') || today;
  const days = q.days === undefined ? 14 : optionalNumber(q.days, 'days', { min: 1, max: 42, int: true });
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(fromDate); toDate.setDate(toDate.getDate() + days);
  const [rows, mine] = await Promise.all([
    repo.listGymClasses(memberId, { from: fromDate.toISOString(), to: toDate.toISOString() }),
    repo.listMyClassBookings(memberId),
  ]);
  const now = new Date();
  return { from, days, classes: rows.map((r) => presentClass(r, now)), myBookings: mine.map((r) => presentClass(r, now)) };
}

export async function registerForGymClass(ctx, classIdParam) {
  const classId = positiveInt(classIdParam, 'classId');
  const row = await repo.registerForGymClass(ctx.memberId, classId);
  await audit(memberCtx(ctx), 'MEMBER_CLASS_REGISTERED', { memberId: ctx.memberId, classId, registrationId: row.id });
  return row;
}

export async function cancelGymClass(ctx, classIdParam) {
  const classId = positiveInt(classIdParam, 'classId');
  const row = await repo.cancelGymClass(ctx.memberId, classId);
  if (!row) throw httpError(409, 'No upcoming booking to cancel for this class.');
  await audit(memberCtx(ctx), 'MEMBER_CLASS_CANCELLED', { memberId: ctx.memberId, classId, registrationId: row.id });
  return row;
}

// ---------------------------------------------------------------- online classes (live + recorded) & video lessons

/** Only links entered by gym staff, and only https — never javascript:, data:, http, or made-up links. */
const approvedLink = (u) => {
  if (typeof u !== 'string' || !/^https:\/\/[^\s<>"']+$/i.test(u.trim())) return null;
  try { return new URL(u.trim()).protocol === 'https:' ? u.trim() : null; } catch { return null; }
};
const JOIN_EARLY_MINS = 15;

function presentOnlineClass(r, now = new Date()) {
  const start = new Date(r.scheduled_at);
  const end = new Date(start.getTime() + (Number(r.duration_mins) || 0) * 60000);
  const link = approvedLink(r.stream_url);
  const base = {
    id: r.id, title: r.title, category: r.category, description: r.description || '', difficulty: r.difficulty || null,
    instructor: r.instructor_name ? { name: r.instructor_name, specialty: r.instructor_specialty || null } : null,
    durationMins: Number(r.duration_mins) || null,
  };
  if (r.class_type === 'vod_recorded') {
    return { ...base, type: 'recorded', recordedAt: r.scheduled_at, watchUrl: link, linkProvided: !!link };
  }
  const cap = r.max_participants === null ? null : Number(r.max_participants);
  const booked = Number(r.booked) || 0;
  const slotsLeft = cap === null ? null : Math.max(0, cap - booked);
  const mine = r.my_status === 'registered' || r.my_status === 'attended';
  let registration;
  if (r.status === 'cancelled') registration = 'cancelled';
  else if (r.status === 'completed' || end <= now) registration = 'finished';
  else if (r.status === 'live_now' || start <= now) registration = mine ? 'registered' : 'in_progress';
  else if (mine) registration = 'registered';
  else if (r.status !== 'scheduled') registration = 'closed';
  else if (slotsLeft === 0) registration = 'full';
  else registration = 'open';
  const joinOpensAt = new Date(start.getTime() - JOIN_EARLY_MINS * 60000);
  const canJoinNow = mine && !!link && !['cancelled', 'finished'].includes(registration)
    && (r.status === 'live_now' || (now >= joinOpensAt && now < end));
  return {
    ...base, type: 'live', startsAt: r.scheduled_at, endsAt: end.toISOString(), liveNow: r.status === 'live_now',
    capacity: cap, booked, slotsLeft, registration, myStatus: r.my_status || null,
    canRegister: registration === 'open', canCancel: registration === 'registered' && start > now,
    linkProvided: !!link,                                   // whether the gym has added a meeting link
    joinUrl: canJoinNow ? link : null,                      // only for registered members, near start time
    joinOpensAt: joinOpensAt.toISOString(),
  };
}

export async function listOnlineClasses(memberId, q = {}) {
  const days = q.days === undefined ? 28 : optionalNumber(q.days, 'days', { min: 1, max: 60, int: true });
  const now = new Date();
  const to = new Date(now.getTime() + days * 86400000);
  const [rows, attendance, lessons] = await Promise.all([
    repo.listOnlineClasses(memberId, { from: now.toISOString(), to: to.toISOString() }),
    repo.listClassAttendance(memberId),
    repo.listMyVideoLessons(memberId),
  ]);
  const classes = rows.map((r) => presentOnlineClass(r, now));
  const courses = new Map();
  for (const l of lessons) {
    if (!courses.has(l.course_id)) courses.set(l.course_id, { courseId: l.course_id, title: l.course_title, level: l.level || null, instructor: l.instructor_name || null, enrolmentStatus: l.enrolment_status, lessons: [] });
    const url = approvedLink(l.video_url);
    courses.get(l.course_id).lessons.push({ id: l.id, title: l.title, order: l.lesson_order, durationMins: l.duration_mins, videoUrl: url, linkProvided: !!url });
  }
  return {
    days,
    live: classes.filter((c) => c.type === 'live'),
    recorded: classes.filter((c) => c.type === 'recorded'),
    attendance: attendance.map((a) => {
      const ended = new Date(a.scheduled_at).getTime() + (Number(a.duration_mins) || 0) * 60000 < now.getTime();
      const outcome = a.attended === true || a.status === 'attended' ? 'attended'
        : a.status === 'no_show' ? 'not_attended'
          : a.class_status === 'cancelled' ? 'class_cancelled'
            : ended ? 'not_recorded' : 'upcoming';
      return { id: a.id, classId: a.class_id, title: a.title, type: a.class_type === 'vod_recorded' ? 'recorded' : a.class_type === 'in_person' ? 'in_person' : 'live',
        category: a.category, startsAt: a.scheduled_at, instructor: a.instructor_name || null, outcome, attendedAt: a.attended_at || null };
    }),
    courses: [...courses.values()],
  };
}

export async function registerForOnlineClass(ctx, classIdParam) {
  const classId = positiveInt(classIdParam, 'classId');
  const row = await repo.registerForGymClass(ctx.memberId, classId, ['live']);
  await audit(memberCtx(ctx), 'MEMBER_ONLINE_CLASS_REGISTERED', { memberId: ctx.memberId, classId, registrationId: row.id });
  return row;
}

export async function cancelOnlineClass(ctx, classIdParam) {
  const classId = positiveInt(classIdParam, 'classId');
  const row = await repo.cancelGymClass(ctx.memberId, classId, ['live']);
  if (!row) throw httpError(409, 'No upcoming booking to cancel for this class.');
  await audit(memberCtx(ctx), 'MEMBER_ONLINE_CLASS_CANCELLED', { memberId: ctx.memberId, classId, registrationId: row.id });
  return row;
}

// ---------------------------------------------------------------- courses (catalogue, lessons, assessment)

const ACTIVE_ENROLMENT = (e) => e && e.enrolment_status && e.enrolment_status !== 'withdrawn';

function enrolmentView(r, totalLessons) {
  if (!ACTIVE_ENROLMENT(r)) return null;
  const done = Math.min(Number(r.lessons_completed) || 0, totalLessons);
  return {
    status: r.enrolment_status, enrolledAt: r.enrolled_at, completedAt: r.completed_at || null,
    lessonsCompleted: done, totalLessons,
    progressPct: totalLessons ? Math.round((done / totalLessons) * 100) : 0,
    assessmentScorePct: r.quiz_score_pct === null || r.quiz_score_pct === undefined ? null : Number(r.quiz_score_pct),
    assessmentPassed: !!r.quiz_passed,
  };
}
const certView = (r) => (r.certificate_code ? { code: r.certificate_code, issuedAt: r.certificate_issued_at, issuedBy: r.certificate_issued_by || null, grade: r.grade_score || null } : null);

export async function listCourses(memberId) {
  const rows = await repo.listCourseCatalogue(memberId);
  return rows.map((r) => ({
    id: r.id, title: r.title, category: r.category, description: r.description || '', level: r.level || null,
    estimatedHours: r.estimated_hours === null ? null : Number(r.estimated_hours),
    instructor: r.instructor_name ? { name: r.instructor_name, specialty: r.instructor_specialty || null } : null,
    lessonsCount: r.lessons_count, totalMins: r.total_mins, hasAssessment: r.has_assessment,
    available: r.status === 'published',
    enrolment: enrolmentView(r, r.lessons_count),
    certificate: certView(r),
  }));
}

export async function getCourse(memberId, courseIdParam) {
  const courseId = positiveInt(courseIdParam, 'courseId');
  const d = await repo.getCourseForMember(memberId, courseId);
  const enrolled = d && ACTIVE_ENROLMENT(d.course);
  // Not visible: drafts, or unpublished courses the member is not enrolled in → same 404 as "does not exist".
  if (!d || d.course.status === 'draft' || (d.course.status !== 'published' && !enrolled)) throw httpError(404, 'Course not found.');
  const c = d.course;
  const enrolment = enrolmentView(c, d.lessons.length);
  const done = enrolment ? enrolment.lessonsCompleted : 0;
  const lessons = d.lessons.map((l, i) => ({
    id: l.id, order: i + 1, title: l.title, durationMins: l.duration_mins,
    // Content and videos only for enrolled members.
    ...(enrolled ? {
      notes: l.content_notes || '', videoUrl: approvedLink(l.video_url),
      completed: i < done, isNext: i === done, locked: i > done,
    } : {}),
  }));
  let assessment = null;
  if (d.quiz) {
    const qs = Array.isArray(d.quiz.quiz_data) ? d.quiz.quiz_data : [];
    const unlocked = !!enrolled && d.lessons.length > 0 && done >= d.lessons.length && qs.length > 0;
    assessment = {
      title: d.quiz.title, passPct: Number(d.quiz.pass_percentage) || 80, questionCount: qs.length, unlocked,
      // Questions (never the answers) only once every lesson is complete.
      questions: unlocked ? qs.map((q, i) => ({ index: i, question: String(q.question || ''), options: (Array.isArray(q.options) ? q.options : []).map(String) })) : null,
    };
  }
  return {
    id: c.id, title: c.title, category: c.category, description: c.description || '', level: c.level || null,
    estimatedHours: c.estimated_hours === null ? null : Number(c.estimated_hours),
    instructor: c.instructor_name ? { name: c.instructor_name, specialty: c.instructor_specialty || null } : null,
    available: c.status === 'published', enrolled: !!enrolled, enrolment, lessons, assessment, certificate: certView(c),
  };
}

export async function enrolInCourse(ctx, courseIdParam) {
  const courseId = positiveInt(courseIdParam, 'courseId');
  const status = await repo.getMemberStatus(ctx.memberId);
  if (status !== 'active') throw httpError(403, 'An active membership is needed to enrol in courses.');
  const row = await repo.enrolInCourse(ctx.memberId, courseId);
  await audit(memberCtx(ctx), 'MEMBER_COURSE_ENROLLED', { memberId: ctx.memberId, courseId, enrolmentId: row.id });
  return { enrolled: true, courseId };
}

export async function completeCourseLesson(ctx, courseIdParam, lessonIdParam) {
  const courseId = positiveInt(courseIdParam, 'courseId');
  const lessonId = positiveInt(lessonIdParam, 'lessonId');
  const r = await repo.completeCourseLesson(ctx.memberId, courseId, lessonId);
  if (!r.alreadyComplete) await audit(memberCtx(ctx), 'MEMBER_COURSE_LESSON_COMPLETED', { memberId: ctx.memberId, courseId, lessonId });
  return { alreadyComplete: r.alreadyComplete, status: r.enrolment.status, lessonsCompleted: r.enrolment.lessons_completed, progressPct: r.enrolment.progress_pct };
}

export async function submitCourseAssessment(ctx, courseIdParam, body = {}) {
  const courseId = positiveInt(courseIdParam, 'courseId');
  const answers = body.answers;
  if (!Array.isArray(answers) || answers.length > 200 || !answers.every((a) => Number.isInteger(a) && a >= 0 && a < 50)) {
    throw httpError(400, 'answers must be a list of chosen option numbers.');
  }
  const r = await repo.submitCourseAssessment(ctx.memberId, courseId, answers);
  await audit(memberCtx(ctx), 'MEMBER_COURSE_ASSESSMENT_SUBMITTED', { memberId: ctx.memberId, courseId, score: r.score, passed: r.passed });
  // Score and pass/fail only — which answers were right is not revealed.
  return { scorePct: r.score, passed: r.passed, passPct: r.passMark, correct: r.correct, total: r.total, courseStatus: r.enrolment.status };
}

// ---------------------------------------------------------------- events & competitions

const EVENT_GROUPS = [
  ['weightlifting', /weight ?lift/i], ['push_up', /push[- ]?up/i], ['pull_up', /pull[- ]?up/i], ['squat', /squat/i],
  ['transformation', /transformation/i], ['challenge', /challenge/i],
];
const eventGroup = (type) => (EVENT_GROUPS.find(([, rx]) => rx.test(String(type || ''))) || ['event'])[0];
const scoreUnitFor = (metric) => (/kg|weight/i.test(metric || '') ? 'kg' : /rep/i.test(metric || '') ? 'reps' : /sec|time/i.test(metric || '') ? 'seconds' : 'points');
/** Other members appear as "First L." — never full names or member codes. */
const maskName = (n) => { const p = String(n || '').trim().split(/\s+/).filter(Boolean); return p.length ? `${p[0]}${p.length > 1 ? ` ${p[p.length - 1][0].toUpperCase()}.` : ''}` : 'Member'; };
const dayStr = (d) => (d ? localYmd(new Date(d)) : null);

function presentEvent(r, today) {
  const lastRegDay = r.registration_deadline ? dayStr(r.registration_deadline)
    : r.start_date ? localYmd(new Date(new Date(r.start_date).getTime() - 86400000)) : null;
  const regOpen = r.status === 'upcoming' && !!lastRegDay && today <= lastRegDay;
  const entered = r.my_entry_id && r.my_status !== 'withdrawn';
  let registration;
  if (r.status === 'cancelled') registration = 'cancelled';
  else if (entered) registration = 'registered';
  else if (regOpen) registration = 'open';
  else registration = 'closed';
  return {
    id: r.id, title: r.title, type: r.type, group: eventGroup(r.type), description: r.description || '',
    startDate: dayStr(r.start_date), endDate: dayStr(r.end_date), registrationClosesOn: lastRegDay,
    status: r.status, metric: r.metric_type || null, prize: r.prize_pool || null, rules: r.rules || null,
    organizer: r.organizer_name || null, entrants: r.entrants, scoredEntries: r.scored,
    registration, canRegister: registration === 'open', canWithdraw: !!entered && r.my_status === 'registered' && r.my_score === null && regOpen,
    myEntry: r.my_entry_id ? {
      status: r.my_status, division: r.my_division || null, score: r.my_score === null ? null : Number(r.my_score), scoreUnit: r.my_score_unit || null,
      rank: r.my_rank === null ? null : Number(r.my_rank), podium: !!r.my_is_winner && r.my_score !== null,
      verifiedBy: r.my_verified_by || null, verified: r.my_verified_id !== null, registeredAt: r.my_registered_at,
    } : null,
    certificate: r.certificate_code ? { code: r.certificate_code, award: r.award_title || null, issuedAt: r.certificate_issued_at } : null,
  };
}

export async function listEvents(memberId) {
  const rows = await repo.listEventsForMember(memberId);
  const today = localYmd();
  return { today, events: rows.map((r) => presentEvent(r, today)) };
}

export async function getEventLeaderboard(memberId, idParam) {
  const competitionId = positiveInt(idParam, 'eventId');
  const ev = await repo.getEventStatus(competitionId);
  if (!ev) throw httpError(404, 'Event not found.');
  const rows = await repo.getEventLeaderboard(competitionId);
  const anon = (await repo.preferencesAvailable()) ? await repo.anonymousLeaderboardMembers(rows.map((r) => r.member_id)) : new Set();
  return {
    eventId: competitionId,
    entries: rows.map((r) => ({
      rank: r.rank_position === null ? null : Number(r.rank_position), name: r.member_id === memberId ? 'You' : anon.has(r.member_id) ? 'Member' : maskName(r.full_name),
      isMe: r.member_id === memberId, division: r.division || null, score: Number(r.score), scoreUnit: r.score_unit || null,
      podium: !!r.is_winner, verified: r.verified_by_trainer_id !== null, verifiedBy: r.verified_by || null,
    })),
  };
}

export async function registerForEvent(ctx, idParam, body = {}) {
  const competitionId = positiveInt(idParam, 'eventId');
  const status = await repo.getMemberStatus(ctx.memberId);
  if (status !== 'active') throw httpError(403, 'An active membership is needed to register for events.');
  const division = optionalText(body.division, 'division', 50) || 'Open';
  const ev = (await repo.listEventsForMember(ctx.memberId)).find((e) => e.id === competitionId);
  const row = await repo.registerForEvent(ctx.memberId, competitionId, { division, scoreUnit: scoreUnitFor(ev?.metric_type) });
  await audit(memberCtx(ctx), 'MEMBER_EVENT_REGISTERED', { memberId: ctx.memberId, competitionId, participantId: row.id });
  return row;
}

export async function withdrawFromEvent(ctx, idParam) {
  const competitionId = positiveInt(idParam, 'eventId');
  const row = await repo.withdrawFromEvent(ctx.memberId, competitionId);
  if (!row) throw httpError(409, 'You can only withdraw before registration closes and before a result is recorded.');
  await audit(memberCtx(ctx), 'MEMBER_EVENT_WITHDRAWN', { memberId: ctx.memberId, competitionId, participantId: row.id });
  return { withdrawn: true };
}

// ---------------------------------------------------------------- books & library

const BOOK_GROUPS = [['fitness', /fitness|bodybuilding|hypertrophy|training/i], ['anatomy', /anatomy|biomechanic/i], ['nutrition', /nutrition|diet/i], ['science', /physiology|science/i], ['rules', /rule/i]];
const bookGroup = (cat) => (BOOK_GROUPS.find(([, rx]) => rx.test(String(cat || ''))) || ['other'])[0];

/**
 * Who may see / read a book:
 *  staff_only      → never (members)                       draft → never
 *  all_members     → listed; read: active membership (+ purchase if paid)
 *  vip_tier        → listed & read only for VIP members (+ purchase if paid) — or anyone who bought it
 *  purchased_only  → listed (to show it exists); read only after purchase
 *  archived books stay readable for members who could read them, but are not listed for new readers.
 */
function memberBookAccess(b, { active, vip }) {
  if (!b || b.access_tier === 'staff_only' || b.status === 'draft') return { visible: false, canRead: false };
  const purchased = !!b.purchase_id;
  if (purchased) return { visible: true, canRead: true, reason: 'purchased' };
  const paid = !!b.is_paid || b.access_tier === 'purchased_only';
  if (b.status !== 'published') return { visible: false, canRead: false };
  if (b.access_tier === 'vip_tier' && !vip) return { visible: false, canRead: false };
  if (paid) return { visible: true, canRead: false, reason: 'purchase_required' };
  if (!active) return { visible: true, canRead: false, reason: 'membership_inactive' };
  return { visible: true, canRead: true, reason: b.access_tier === 'vip_tier' ? 'vip' : 'included' };
}

function presentBook(b, access, { detail = false } = {}) {
  const total = Number(b.page_count) || null;
  return {
    id: b.id, title: b.title, author: b.author, category: b.category, group: bookGroup(b.category),
    format: b.file_format, sizeMb: b.file_size_mb === null ? null : Number(b.file_size_mb), pages: total,
    ...(detail ? { description: b.description || '' } : { summary: String(b.description || '').slice(0, 220) }),
    price: (b.is_paid || b.access_tier === 'purchased_only') ? { amount: Number(b.price_amount), currency: b.currency } : null,
    vip: b.access_tier === 'vip_tier', archived: b.status !== 'published',
    access: { canRead: access.canRead, reason: access.reason },
    purchase: b.purchase_id ? { purchasedAt: b.purchased_at, invoice: b.invoice_code } : null,
    progress: b.current_page ? {
      currentPage: Number(b.current_page), totalPages: Number(b.progress_total_pages) || total, pct: Number(b.progress_pct) || 0,
      completed: !!b.completed, lastReadAt: b.last_read_at, ...(detail ? { notes: b.progress_notes || '' } : {}),
    } : null,
  };
}

async function bookContext(memberId) {
  const [status, vip] = await Promise.all([repo.getMemberStatus(memberId), repo.isVipMember(memberId)]);
  return { active: status === 'active', vip };
}

export async function listBooks(memberId) {
  const [rows, ctx, purchases] = await Promise.all([repo.listBooksForMember(memberId), bookContext(memberId), repo.listMyBookPurchases(memberId)]);
  const books = rows.map((b) => [b, memberBookAccess(b, ctx)]).filter(([, a]) => a.visible).map(([b, a]) => presentBook(b, a));
  return {
    membershipActive: ctx.active, vip: ctx.vip, books,
    purchases: purchases.map((p) => ({ id: p.id, invoice: p.invoice_code, amount: Number(p.amount_paid), currency: p.currency, method: p.payment_method, purchasedAt: p.purchased_at, book: { id: p.book_id, title: p.title, author: p.author, category: p.category } })),
  };
}

async function readableBook(memberId, idParam) {
  const bookId = positiveInt(idParam, 'bookId');
  const [b, ctx] = await Promise.all([repo.getBookForMember(memberId, bookId), bookContext(memberId)]);
  const access = memberBookAccess(b, ctx);
  // Hidden books answer exactly like missing ones.
  if (!access.visible) throw httpError(404, 'Book not found.');
  return { b, access, bookId };
}

export async function getBook(memberId, idParam) {
  const { b, access } = await readableBook(memberId, idParam);
  return presentBook(b, access, { detail: true });
}

/**
 * Resolve the protected file for an authorised member. The file lives in a private folder that is
 * NOT served statically; it is streamed only through this authenticated endpoint. Nothing is invented
 * when the file has not been uploaded.
 */
export async function openBookFile(memberId, idParam) {
  const { access, bookId } = await readableBook(memberId, idParam);
  if (!access.canRead) throw httpError(403, access.reason === 'purchase_required' ? 'Buy this book at the gym to read it.' : access.reason === 'membership_inactive' ? 'An active membership is needed to read library books.' : 'You do not have access to this book.');
  const info = await repo.getBookFileInfo(bookId);
  const fmt = String(info.file_format || 'PDF').toUpperCase() === 'EPUB' ? 'epub' : 'pdf';
  if (!/^[a-z0-9][a-z0-9-]{0,150}$/i.test(info.slug || '')) throw httpError(404, 'The book file has not been uploaded yet.');
  const vault = path.resolve(process.cwd(), 'backend/storage/library_vault');
  const file = path.resolve(vault, `${info.slug}.${fmt}`);
  if (!file.startsWith(vault + path.sep) || !fs.existsSync(file)) throw httpError(404, 'The book file has not been uploaded yet.');
  await repo.countBookOpen(bookId);
  return { file, fileName: `${info.slug}.${fmt}`, contentType: fmt === 'epub' ? 'application/epub+zip' : 'application/pdf' };
}

export async function saveBookProgress(ctx, idParam, body = {}) {
  const { b, access, bookId } = await readableBook(ctx.memberId, idParam);
  if (!access.canRead) throw httpError(403, 'You can track progress for books you can read.');
  const totalPages = Number(b.page_count) || 1;
  const currentPage = optionalNumber(body.currentPage, 'currentPage', { min: 0, max: totalPages, int: true });
  if (currentPage === undefined) throw httpError(400, 'currentPage is required.');
  const notes = body.notes === undefined ? null : (optionalText(body.notes, 'notes', 1000) || '');
  const row = await repo.saveBookProgress(ctx.memberId, bookId, { currentPage, totalPages, notes });
  await audit(memberCtx(ctx), 'MEMBER_BOOK_PROGRESS_SAVED', { memberId: ctx.memberId, bookId, currentPage });
  return { currentPage: row.current_page, totalPages: row.total_pages, pct: row.progress_pct, completed: row.completed, lastReadAt: row.last_read_at };
}

// ---------------------------------------------------------------- messages, notifications, announcements

export const getMessagesInbox = (ctx) => messaging.memberInbox(ctx);
export const openMessageThread = (ctx, threadId) => messaging.memberOpenThread(ctx, threadId);
export const sendThreadMessage = (ctx, threadId, body = {}) => messaging.memberSend(ctx, threadId, body.body);
/** Start a conversation: { trainerId, body } with an assigned trainer, or { to: 'gym', body } with the gym team. */
export const startMessageThread = (ctx, body = {}) => (body.to === 'gym'
  ? messaging.memberStartGymThread(ctx, body.body)
  : messaging.memberStartThread(ctx, body.trainerId, body.body));

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const PAY_OK = ['completed', 'paid', 'success'];

/**
 * Notifications page = (1) stored in-app notifications addressed to this user (read/unread), and
 * (2) reminders built live from the member's own records — nothing is invented and nothing
 * belonging to another member can appear.
 */
export async function getMemberNotifications(ctx) {
  const present = await hubRepo.getPresentHubTables();
  const [inbox, src, membership] = await Promise.all([
    messaging.listMyNotifications(ctx.user?.id),
    repo.getReminderSources(ctx.memberId, { withPt: present.has('pt_sessions') }),
    repo.getCurrentMembership(ctx.memberId),
  ]);
  const items = [];
  const add = (type, title, body, at, link, urgent = false) => items.push({ type, title, body, at, link, urgent });
  src.workouts.forEach((w) => add('workout', `New workout programme: ${w.name}`, `${w.trainer_name ? `Assigned by ${w.trainer_name}. ` : ''}Starts ${new Date(w.start_date).toDateString()}.`, w.created_at, 'member-workouts.html'));
  src.diets.forEach((d) => add('diet', `Diet plan ${new Date(d.updated_at) - new Date(d.created_at) > 60000 ? 'updated' : 'assigned'}: ${d.name}`, d.trainer_name ? `From ${d.trainer_name}.` : '', d.updated_at > d.created_at ? d.updated_at : d.created_at, 'member-diet-plan.html'));
  (src.pt || []).forEach((s) => add('pt_reminder', 'PT session coming up', `${new Date(s.scheduled_start).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${s.trainer_name ? ` with ${s.trainer_name}` : ''}${s.location ? ` · ${s.location}` : ''}.`, s.scheduled_start, 'member-pt-sessions.html'));
  src.classesSoon.forEach((c) => add('class_reminder', `Class reminder: ${c.title}`, `Starts ${new Date(c.scheduled_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`, c.scheduled_at, c.class_type === 'live' ? 'member-online-classes.html' : 'member-classes.html'));
  src.classesCancelled.forEach((c) => add('class_reminder', `Class cancelled: ${c.title}`, `The gym cancelled this class you booked (${new Date(c.scheduled_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}).`, c.scheduled_at, c.class_type === 'live' ? 'member-online-classes.html' : 'member-classes.html', true));
  if (membership && membership.end_date) {
    const days = Number(membership.days_remaining);
    if (membership.status === 'active' && days >= 0 && days <= 14) add('membership', `Membership expires in ${days} day${days === 1 ? '' : 's'}`, `${membership.plan_name || 'Your plan'} ends on ${new Date(membership.end_date).toDateString()}.`, new Date(), 'member-membership.html', days <= 3);
    else if (days < 0 || membership.status === 'expired') add('membership', 'Membership expired', `${membership.plan_name || 'Your plan'} ended on ${new Date(membership.end_date).toDateString()}.`, membership.end_date, 'member-membership.html', true);
  }
  if (src.fees && Number(src.fees.fee_due) > 0) add('payment', `Payment due: ${money(src.fees.fee_due)}`, src.fees.fee_due_date ? `Due by ${new Date(src.fees.fee_due_date).toDateString()}.` : 'Please pay at reception.', src.fees.fee_due_date || new Date(), 'member-payments.html', !!src.fees.fee_due_date && new Date(src.fees.fee_due_date) < new Date());
  src.transactions.forEach((t) => add('payment', PAY_OK.includes(String(t.payment_status).toLowerCase()) ? `Payment received: ${money(t.net_amount)}` : `Payment ${t.payment_status}: ${money(t.net_amount)}`, `${t.transaction_type || 'Payment'}${t.invoice_number ? ` · invoice ${t.invoice_number}` : ''}.`, t.transaction_date, 'member-payments.html', !PAY_OK.includes(String(t.payment_status).toLowerCase())));
  src.feedback.forEach((f) => add('feedback', `Feedback from ${f.trainer_name || 'your trainer'}`, f.comment_text.slice(0, 200), f.created_at, 'member-trainer.html'));
  // Gym announcements and polls posted in the last 14 days (only ones this member can see)
  try {
    const anns = (await repo.listAnnouncementsForMember(ctx.memberId)).filter((a) => Date.now() - new Date(a.created_at) < 14 * 86400000);
    const polls = anns.length && (await pollRepo.pollsAvailable().catch(() => false)) ? await pollRepo.pollsFor(anns.map((a) => a.id), { memberId: ctx.memberId }) : {};
    const sportIcon = (c) => (c === 'indoor_sport' ? '🏟️ ' : c === 'outdoor_sport' ? '🌳 ' : '');
    anns.forEach((a) => {
      const p = polls[a.id];
      const voted = p && p.options.some((o) => o.mine);
      if (p) add('announcement', `📊 ${voted ? 'Poll' : 'New poll — vote now'}: ${sportIcon(a.sport_category)}${a.title}`, voted ? 'You have voted. See the results on the Announcements page.' : a.message.slice(0, 200), a.created_at, 'member-announcements.html', !voted);
      else add('announcement', `📢 ${sportIcon(a.sport_category)}${a.title}`, a.message.slice(0, 200), a.created_at, 'member-announcements.html', a.priority === 'urgent');
    });
  } catch { /* announcements are optional in this list */ }
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  const { prefs, available: prefsAvailable } = await effectivePreferences(ctx.memberId);
  const updates = items.filter((x) => prefs[UPDATE_PREF[x.type]] !== false);
  const shownInbox = prefs.notify_messages === false && inbox.items
    ? { ...inbox, items: inbox.items.filter((n) => n.type !== 'new_message'), unread: inbox.items.filter((n) => n.type !== 'new_message' && !n.readAt).length } : inbox;
  return { inbox: shownInbox, updates, ptAvailable: present.has('pt_sessions'), hiddenByPreferences: items.length - updates.length, preferencesAvailable: prefsAvailable };
}

export const markNotificationRead = (ctx, id) => messaging.markMyNotificationsRead(ctx.user?.id, id);
export const markAllNotificationsRead = (ctx) => messaging.markMyNotificationsRead(ctx.user?.id, null);

const ANN_CATEGORY = { urgent: 'important', event: 'event', maintenance: 'schedule', normal: 'notice' };
export async function getMemberAnnouncements(memberId) {
  const [anns, events, cancelled, mine] = await Promise.all([
    repo.listAnnouncementsForMember(memberId), repo.listUpcomingGymEvents(), repo.listCancelledUpcomingClasses(),
    repo.getReminderSources(memberId, { withPt: false }).then((s) => s.classesCancelled),
  ]);
  const mineIds = new Set(mine.map((c) => c.id));
  // Poll announcements (migration 028): choices, counts and the member's own vote.
  const polls = (await pollRepo.pollsAvailable().catch(() => false)) ? await pollRepo.pollsFor(anns.map((a) => a.id), { memberId }) : {};
  return {
    announcements: anns.map((a) => ({ id: a.id, title: a.title, message: a.message, category: polls[a.id] ? 'poll' : (ANN_CATEGORY[a.priority] || 'notice'), sport: a.sport_category === 'indoor_sport' || a.sport_category === 'outdoor_sport' ? a.sport_category : null, topic: a.sport_category || 'general', startDate: a.start_date, endDate: a.end_date, postedAt: a.created_at, poll: presentPoll(polls[a.id]) })),
    events: events.map((e) => ({ id: e.id, title: e.title, type: e.type, startDate: e.start_date, endDate: e.end_date, status: e.status })),
    scheduleChanges: cancelled.map((c) => ({ id: c.id, title: c.title, type: c.class_type, scheduledAt: c.scheduled_at, youWereBooked: mineIds.has(c.id) })),
  };
}

const presentPoll = (p) => (p ? {
  multiple: p.multiple, totalVoters: p.totalVoters,
  options: p.options.map((o) => ({ id: o.id, label: o.label, votes: o.votes, mine: o.mine })),
  myOptionIds: p.options.filter((o) => o.mine).map((o) => o.id),
} : null);

/**
 * Vote on a poll announcement the member can currently see (active, for everyone or their language).
 * optionIds: one choice (single-choice poll) or one or more (multiple-choice poll); [] withdraws the vote.
 */
export async function voteOnAnnouncement(memberId, announcementIdRaw, body = {}) {
  const annId = Number(announcementIdRaw);
  if (!Number.isInteger(annId) || annId <= 0) throw httpError(404, 'Announcement not found.');
  if (!(await pollRepo.pollsAvailable())) throw httpError(503, 'Voting is waiting for a database update (migration 028).');
  const visible = (await repo.listAnnouncementsForMember(memberId)).some((a) => a.id === annId);
  if (!visible) throw httpError(404, 'This poll is not open.');
  const poll = (await pollRepo.pollsFor([annId], { memberId }))[annId];
  if (!poll) throw httpError(404, 'This announcement is not a poll.');
  const raw = body.optionIds;
  if (!Array.isArray(raw)) throw httpError(400, 'optionIds must be a list.');
  const ids = [...new Set(raw.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw httpError(400, 'Invalid choice.');
  if (!poll.multiple && ids.length > 1) throw httpError(400, 'You can pick only one choice in this poll.');
  const r = await pollRepo.setVote(annId, { memberId }, ids);
  if (r.invalid) throw httpError(400, 'That choice is not part of this poll.');
  return presentPoll((await pollRepo.pollsFor([annId], { memberId }))[annId]);
}

// ---------------------------------------------------------------- feedback centre

/** Member-facing submission types → existing admin queues (Retention → Feedback & Complaints). */
const FEEDBACK_KINDS = {
  gym: { table: 'feedback', category: 'General', label: 'Gym feedback' },
  trainer: { table: 'feedback', category: 'Trainer Quality', label: 'Trainer feedback' },
  class: { table: 'feedback', category: 'Classes', label: 'Class feedback' },
  suggestion: { table: 'feedback', category: 'Suggestion', label: 'Suggestion' },
  complaint: { table: 'complaint', label: 'Facility complaint' },
  enquiry: { table: 'complaint', category: 'General Enquiry', label: 'General enquiry' },
};
/** Same categories the admin complaint form uses. */
export const COMPLAINT_CATEGORIES = ['Equipment Malfunction', 'Locker Room Cleanliness', 'Billing Issue', 'Trainer Conduct', 'Class Cancellation', 'Other'];
const MEMBER_PRIORITIES = ['low', 'medium', 'high'];
const DAILY_LIMIT = 10;
const sentimentFor = (score) => (score >= 9 ? 'positive' : score <= 6 ? 'negative' : 'neutral'); // same rule as the admin module

async function feedbackSurveys(memberId) {
  // Running "feedback" retention campaigns whose audience includes this member (admin segment rules).
  const campaigns = await retentionRepository.getCampaigns({ type: 'feedback', status: 'running' }).catch(() => []);
  const out = [];
  for (const c of campaigns) {
    const members = await retentionRepository.getSegmentMembers(c.target_segment_code).catch(() => []);
    if (members.some((m) => m.id === memberId)) out.push({ id: c.id, title: c.message_title || c.title, message: c.message_body });
  }
  return out;
}

export async function getFeedbackCentre(memberId) {
  const [feedbacks, complaints, trainers, classes, surveys, today] = await Promise.all([
    repo.listMyFeedbacks(memberId), repo.listMyComplaints(memberId), repo.listMyFeedbackTrainers(memberId),
    repo.listMyFeedbackClasses(memberId), feedbackSurveys(memberId), repo.countMySubmissionsToday(memberId),
  ]);
  return {
    kinds: Object.entries(FEEDBACK_KINDS).map(([k, v]) => ({ key: k, label: v.label, needsRating: v.table === 'feedback' })),
    complaintCategories: COMPLAINT_CATEGORIES,
    trainers: trainers.map((t) => ({ id: t.id, name: t.full_name })),
    classes: classes.map((c) => ({ id: c.id, title: c.title, at: c.scheduled_at, trainer: c.trainer_name || null, type: c.class_type })),
    surveys,
    remainingToday: Math.max(0, DAILY_LIMIT - today),
    submissions: [
      ...feedbacks.map((f) => ({
        kind: 'feedback', id: f.id, category: f.category, rating: f.nps_score, text: f.feedback_text,
        status: f.admin_response ? 'responded' : 'received', response: f.admin_response || null, createdAt: f.created_at,
      })),
      ...complaints.map((c) => ({
        kind: c.category === 'General Enquiry' ? 'enquiry' : 'complaint', id: c.id, ticket: c.ticket_number, category: c.category,
        priority: c.priority, subject: c.subject, text: c.description, status: c.status, response: c.resolution_notes || null,
        resolvedAt: c.resolved_at || null, createdAt: c.created_at,
      })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  };
}

export async function submitFeedback(ctx, body = {}) {
  const kind = FEEDBACK_KINDS[body.type];
  if (!kind) throw httpError(400, `type must be one of: ${Object.keys(FEEDBACK_KINDS).join(', ')}.`);
  if ((await repo.countMySubmissionsToday(ctx.memberId)) >= DAILY_LIMIT) throw httpError(429, `You can send up to ${DAILY_LIMIT} submissions a day. Please try again tomorrow or speak to reception.`);

  if (kind.table === 'feedback') {
    const score = optionalNumber(body.rating, 'rating', { min: 0, max: 10, int: true });
    if (score === undefined) throw httpError(400, 'Please give a rating from 0 to 10.');
    let text = optionalText(body.message, 'message', 2000);
    if (!text || text.trim().length < 5) throw httpError(400, 'Please write at least a few words.');
    text = text.trim();
    let about = '';
    if (body.type === 'trainer') {
      const id = positiveInt(body.trainerId, 'trainerId');
      const t = (await repo.listMyFeedbackTrainers(ctx.memberId)).find((x) => x.id === id);
      if (!t) throw httpError(400, 'Choose a trainer you have trained with.');
      about = `About trainer: ${t.full_name}`;
    } else if (body.type === 'class') {
      const id = positiveInt(body.classId, 'classId');
      const c = (await repo.listMyFeedbackClasses(ctx.memberId)).find((x) => x.id === id);
      if (!c) throw httpError(400, 'Choose a class you attended.');
      about = `About class: ${c.title} (${new Date(c.scheduled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${c.trainer_name ? `, ${c.trainer_name}` : ''})`;
    }
    if (body.surveyId !== undefined && body.surveyId !== null && body.surveyId !== '') {
      const s = (await feedbackSurveys(ctx.memberId)).find((x) => x.id === Number(body.surveyId));
      if (s) about = [about, `Survey: ${s.title}`].filter(Boolean).join(' · ');
    }
    const row = await repo.insertMemberFeedback({ memberId: ctx.memberId, score, category: kind.category, sentiment: sentimentFor(score), text: about ? `[${about}]\n${text}` : text });
    await audit(memberCtx(ctx), 'MEMBER_FEEDBACK_SUBMITTED', { memberId: ctx.memberId, feedbackId: row.id, category: kind.category });
    return { kind: 'feedback', id: row.id, createdAt: row.created_at };
  }

  const subject = (optionalText(body.subject, 'subject', 150) || '').trim();
  const description = (optionalText(body.message, 'message', 2000) || '').trim();
  if (subject.length < 3) throw httpError(400, 'Please add a short subject.');
  if (description.length < 5) throw httpError(400, 'Please describe the issue or question.');
  const category = body.type === 'enquiry' ? kind.category : optionalEnum(body.category, COMPLAINT_CATEGORIES, 'category');
  if (!category) throw httpError(400, 'Choose what the complaint is about.');
  const priority = body.type === 'enquiry' ? 'low' : (optionalEnum(body.priority, MEMBER_PRIORITIES, 'priority') || 'medium');
  const row = await repo.insertMemberComplaint({ memberId: ctx.memberId, category, priority, subject, description });
  await audit(memberCtx(ctx), 'MEMBER_COMPLAINT_SUBMITTED', { memberId: ctx.memberId, complaintId: row.id, ticket: row.ticket_number, category });
  return { kind: body.type, id: row.id, ticket: row.ticket_number, createdAt: row.created_at };
}

// ---------------------------------------------------------------- attendance

const CHECKIN_METHOD = { kiosk_voice: 'FitBot kiosk (voice)', kiosk_manual: 'Kiosk / reception', rfid_card: 'RFID card', mobile_qr: 'Mobile QR' };
const DOW = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * The member's own check-ins (Admin check-in + FitBot kiosk share check_ins). Counts are distinct
 * visit DAYS. Check-out is not recorded anywhere, so it is reported as not tracked — never estimated.
 */
export async function getAttendanceHistory(memberId, q = {}) {
  const p = paging(q);
  const from = optionalDate(q.from, 'from'); const to = optionalDate(q.to, 'to');
  if (from && to && from > to) throw httpError(400, 'from must be on or before to.');
  const [list, stats] = await Promise.all([repo.listMyCheckIns(memberId, { ...p, from, to }), repo.getAttendanceStats(memberId)]);
  const s = stats.summary;
  // Average per week only over weeks since the first visit (max the 12 weeks shown) — not diluted by weeks before joining.
  const first = s.first_visit ? new Date(s.first_visit).getTime() : null;
  const countedWeeks = first === null ? [] : stats.weekly.filter((w) => new Date(w.week_start).getTime() + 7 * 86400000 > first);
  let streak = 0;
  for (let i = stats.weekly.length - 1; i >= 0; i--) {
    const w = stats.weekly[i];
    if (w.days > 0) streak++;
    else if (i === stats.weekly.length - 1) continue; // the current week may simply not have started yet
    else break;
  }
  const dowTop = [...stats.dow].sort((a, b) => b.n - a.n)[0];
  const band = (h) => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
  const bands = stats.hours.reduce((acc, r) => { acc[band(r.hour)] = (acc[band(r.hour)] || 0) + r.n; return acc; }, {});
  const bandTop = Object.entries(bands).sort((a, b) => b[1] - a[1])[0];
  return {
    checkOutTracked: false,
    summary: {
      totalDays: s.total_days, firstVisit: s.first_visit, lastVisit: s.last_visit,
      thisWeek: s.this_week, lastWeek: s.last_week, thisMonth: s.this_month, lastMonth: s.last_month, last30Days: s.last_30_days,
      avgPerWeek: countedWeeks.length ? Math.round((countedWeeks.reduce((n, w) => n + w.days, 0) / countedWeeks.length) * 10) / 10 : null,
      weeksCounted: countedWeeks.length, weekStreak: s.total_days ? streak : 0,
      usualDay: dowTop ? DOW[dowTop.dow] : null, usualTime: bandTop ? bandTop[0] : null,
    },
    weekly: stats.weekly.map((w) => ({ weekStart: localYmd(new Date(w.week_start)), days: w.days })),
    monthly: stats.monthly.map((m) => ({ monthStart: localYmd(new Date(m.month_start)), days: m.days, daysInMonth: m.days_in_month })),
    history: {
      ...paginated({
        rows: list.rows.map((r) => ({
          id: Number(r.id), checkInAt: r.check_in_time, method: r.check_in_method, methodLabel: CHECKIN_METHOD[r.check_in_method] || r.check_in_method,
          device: r.device_name ? `${r.device_name}${r.location_zone ? ` · ${r.location_zone}` : ''}` : null, checkOutAt: null,
        })),
        total: list.total,
      }, p),
      from, to,
    },
  };
}

// ---------------------------------------------------------------- gym facilities

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const isRecovery = (f) => /recovery|wellness|sauna|steam|plunge|spa|ice bath|cryo/i.test(`${f.facility_type} ${f.zone_name} ${f.notes || ''}`);
const isClassSpace = (f) => /studio|group|class|yoga|spin|dance/i.test(`${f.facility_type} ${f.zone_name}`);
const hhmm = (v) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, '0') : null);

/**
 * A facility is reported as available ONLY when Admin marked it 'open' and no maintenance is in progress.
 * Anything else (maintenance, closed, unknown status) is shown as unavailable — never as operational.
 */
function facilityAvailability(f) {
  if (f.status === 'open' && !f.maintenance_in_progress) return { available: true, label: 'Available', note: f.maintenance_today ? 'Maintenance scheduled today' : null };
  if (f.status === 'open' && f.maintenance_in_progress) return { available: false, label: 'Temporarily unavailable — maintenance in progress' };
  if (f.status === 'maintenance') return { available: false, label: 'Under maintenance' };
  if (f.status === 'closed') return { available: false, label: 'Closed' };
  return { available: false, label: 'Status not confirmed' };
}

function normaliseHours(raw) {
  const days = Array.isArray(raw) ? raw : [];
  return WEEK.map((day) => {
    const d = days.find((x) => String(x?.day).toLowerCase() === day.toLowerCase());
    if (!d) return { day, configured: false };
    const open = hhmm(d.open); const close = hhmm(d.close);
    return {
      day, configured: true, closed: d.is_closed === true || !open || !close, open, close,
      classes: (Array.isArray(d.shifts) ? d.shifts : []).filter((s) => hhmm(s?.open) && hhmm(s?.close))
        .map((s) => ({ title: String(s.note || s.class_type || 'Class'), type: s.class_type ? String(s.class_type) : null, start: hhmm(s.open), end: hhmm(s.close) })),
    };
  });
}

export async function getFacilities(memberId) {
  const [profile, branches, facilities, maintenance, equipment, notices] = await Promise.all([
    repo.getGymProfileForMembers(), repo.listActiveBranches(), repo.listFacilitiesForMembers(),
    repo.listMaintenanceForMembers(), repo.summariseEquipment(), repo.listFacilityAnnouncements(memberId),
  ]);
  const hours = normaliseHours(profile?.operating_hours);
  const configured = hours.some((h) => h.configured);
  // "Open now" uses the server's local clock and the Admin hours for today.
  const now = new Date(); const today = hours[(now.getDay() + 6) % 7];
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const openNow = !configured || !today.configured ? null : !today.closed && nowHm >= today.open && nowHm < today.close;
  const presentFacility = (f) => ({
    id: f.id, name: f.zone_name, type: f.facility_type, capacity: f.capacity, floor: f.floor_number || null,
    branch: f.branch_name || null, notes: f.notes || null, status: f.status, ...facilityAvailability(f),
  });
  const all = facilities.map(presentFacility);
  return {
    gym: profile ? { name: profile.gym_name, tagline: profile.tagline || null, address: profile.address || null, phone: profile.phone || null, email: profile.email || null } : null,
    hours: { configured, days: hours, workingDays: hours.filter((h) => h.configured && !h.closed).map((h) => h.day), today: today.day, openNow, closesAt: openNow ? today.close : null },
    branches: branches.map((b) => ({ name: b.name, address: [b.address, b.city].filter(Boolean).join(', ') || null, hours: b.operating_hours || null })),
    facilities: all,
    recoveryZones: all.filter((f) => isRecovery(facilities.find((x) => x.id === f.id))),
    classSpaces: all.filter((f) => isClassSpace(facilities.find((x) => x.id === f.id))),
    equipment: equipment.map((e) => ({ category: e.category, zone: e.zone, available: e.available, unavailable: e.unavailable, unknown: e.unknown, availableNames: e.available_names || [], unavailableNames: e.unavailable_names || [] })),
    maintenance: maintenance.map((m) => ({ id: m.id, title: m.maintenance_type, facility: m.zone_name, floor: m.floor_number || null, branch: m.branch_name || null, status: m.status, scheduledDate: m.scheduled_date, completedDate: m.completed_date, notes: m.notes || null })),
    notices: [
      ...notices.map((n) => ({ kind: 'announcement', title: n.title, message: n.message, until: n.end_date })),
      ...all.filter((f) => !f.available).map((f) => ({ kind: 'facility', title: `${f.name}: ${f.label}`, message: null, until: null })),
    ],
  };
}

// ---------------------------------------------------------------- settings & preferences

const PREF_DEFAULTS = {
  notify_workout: true, notify_diet: true, notify_pt: true, notify_classes: true, notify_membership: true,
  notify_payments: true, notify_feedback: true, notify_messages: true, leaderboard_visibility: 'name',
};
const NOTIFY_KEYS = { workout: 'notify_workout', diet: 'notify_diet', pt: 'notify_pt', classes: 'notify_classes', membership: 'notify_membership', payments: 'notify_payments', feedback: 'notify_feedback', messages: 'notify_messages' };
/** Reminder type (Notifications page) → preference column. */
const UPDATE_PREF = { workout: 'notify_workout', diet: 'notify_diet', pt_reminder: 'notify_pt', class_reminder: 'notify_classes', membership: 'notify_membership', payment: 'notify_payments', feedback: 'notify_feedback' };

async function effectivePreferences(memberId) {
  if (!(await repo.preferencesAvailable())) return { available: false, prefs: { ...PREF_DEFAULTS } };
  const row = await repo.getMemberPreferences(memberId);
  return { available: true, prefs: { ...PREF_DEFAULTS, ...(row || {}) }, saved: !!row, updatedAt: row?.updated_at || null };
}

/** Settings page data. Role, status and membership are shown read-only — they are managed by the gym. */
export async function getSettings(ctx) {
  const [acc, pref] = await Promise.all([repo.getAccountSummary(ctx.memberId), effectivePreferences(ctx.memberId)]);
  return {
    account: { username: acc?.username || null, email: acc?.email || null, lastLoginAt: acc?.last_login_at || null, role: 'member' },
    language: acc?.preferred_language || 'en-IN',
    languages: LANGUAGES,
    preferences: {
      available: pref.available, saved: !!pref.saved, updatedAt: pref.updatedAt || null,
      notifications: Object.fromEntries(Object.entries(NOTIFY_KEYS).map(([k, col]) => [k, pref.prefs[col] !== false])),
      leaderboardVisibility: pref.prefs.leaderboard_visibility,
    },
  };
}

export async function updatePreferences(ctx, body = {}) {
  if (!(await repo.preferencesAvailable())) {
    const e = httpError(503, 'Saving preferences needs a database update (migration 023). Nothing was saved.'); e.code = 'MIGRATION_PENDING'; throw e;
  }
  const allowed = new Set(['notifications', 'leaderboardVisibility']);
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  if (extra.length) throw httpError(400, `Unknown setting(s): ${extra.join(', ')}. Membership, status and role are managed by the gym.`);
  const current = (await effectivePreferences(ctx.memberId)).prefs;
  const next = { ...current };
  if (body.notifications !== undefined) {
    if (typeof body.notifications !== 'object' || body.notifications === null || Array.isArray(body.notifications)) throw httpError(400, 'notifications must be an object of on/off values.');
    for (const [k, v] of Object.entries(body.notifications)) {
      if (!NOTIFY_KEYS[k]) throw httpError(400, `Unknown notification type: ${k}.`);
      if (typeof v !== 'boolean') throw httpError(400, `notifications.${k} must be true or false.`);
      next[NOTIFY_KEYS[k]] = v;
    }
  }
  if (body.leaderboardVisibility !== undefined) next.leaderboard_visibility = optionalEnum(body.leaderboardVisibility, ['name', 'anonymous'], 'leaderboardVisibility');
  await repo.saveMemberPreferences(ctx.memberId, next);
  await audit(memberCtx(ctx), 'MEMBER_PREFERENCES_UPDATED', { memberId: ctx.memberId });
  return getSettings(ctx);
}

// ---------------------------------------------------------------- PT booking responses (member → trainer)

const PT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ptSessionId(param) {
  const id = String(param || '');
  if (!PT_UUID_RE.test(id)) throw httpError(400, 'Invalid session id.');
  return id;
}

/** In-app notice to the trainer (migration 009). A missing table or a failure never blocks the response. */
async function notifyTrainer(trainerId, payload) {
  if (!trainerId) return;
  try {
    const present = await hubRepo.getPresentHubTables();
    if (!present.has('notifications')) return;
    const userId = await messagingRepo.userIdForTrainer(trainerId);
    if (userId) await messagingRepo.createNotification({ recipientUserId: userId, linkUrl: 'trainer-pt-sessions.html', entityType: 'pt_session', ...payload });
  } catch { /* best-effort */ }
}

async function explainPtRefusal(memberId, id, action) {
  const s = await repo.getOwnPtSessionState(memberId, id);
  if (!s) return httpError(404, 'Session not found in your schedule.');
  if (action === 'rate') {
    return httpError(409, s.status !== 'completed' ? 'Only completed sessions can be rated.' : 'You have already rated this session.');
  }
  if (s.started) return httpError(409, 'This session has already started — please contact your trainer.');
  if (action === 'confirm' && s.status === 'confirmed') return httpError(409, 'You have already confirmed this session.');
  return httpError(409, `This session is ${String(s.status).replace('_', '-')} and can no longer be changed.`);
}

/** Member confirms or declines a session their trainer booked. The PT package balance is never touched here. */
export async function respondToPtSession(ctx, idParam, body = {}) {
  const id = ptSessionId(idParam);
  const response = optionalEnum(body.response, ['confirm', 'decline'], 'response');
  if (!response) throw httpError(400, "response is required ('confirm' or 'decline').");
  const reason = optionalText(body.reason, 'reason', 200);
  const row = await repo.respondToPtSession(ctx.memberId, id, { response, reason });
  if (!row) throw await explainPtRefusal(ctx.memberId, id, response);
  const who = (await repo.getProfile(ctx.memberId).catch(() => null))?.full_name || 'Your client';
  const when = new Date(row.scheduled_start).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  await notifyTrainer(row.trainer_id, response === 'confirm'
    ? { type: 'session_booked', title: `${who} confirmed the PT session on ${when}` }
    : { type: 'session_cancelled', title: `${who} declined the PT session on ${when}`, body: reason || null });
  await audit(memberCtx(ctx), response === 'confirm' ? 'MEMBER_PT_SESSION_CONFIRMED' : 'MEMBER_PT_SESSION_DECLINED', { sessionId: id });
  const { trainer_id: _t, ...out } = row;
  return out;
}

/** Member rates a completed session (1–5, optional comment) — once; an existing rating is never overwritten. */
export async function ratePtSession(ctx, idParam, body = {}) {
  const id = ptSessionId(idParam);
  const rating = optionalNumber(body.rating, 'rating', { min: 1, max: 5, int: true });
  if (rating === null || rating === undefined) throw httpError(400, 'rating (1–5) is required.');
  const feedback = optionalText(body.feedback, 'feedback', 1000);
  const row = await repo.ratePtSession(ctx.memberId, id, { rating, feedback });
  if (!row) throw await explainPtRefusal(ctx.memberId, id, 'rate');
  await notifyTrainer(row.trainer_id, { type: 'feedback', title: `A client rated a completed PT session ${rating}/5`, body: feedback || null });
  await audit(memberCtx(ctx), 'MEMBER_PT_SESSION_RATED', { sessionId: id, rating });
  const { trainer_id: _t, ...out } = row;
  return out;
}

/** Achievements derived from the member's own records (nothing is stored or auto-awarded). */
export async function getAchievements(memberId) {
  return buildAchievements(memberId);
}

export async function listPtSessions(memberId, q) {
  const p = paging(q);
  return paginated(await repo.listPtSessions(memberId, {
    from: optionalTimestamp(q.from, 'from'), to: optionalTimestamp(q.to, 'to'), ...p,
  }), p);
}

// ---------------------------------------------------------------- dashboard

/**
 * Next session of the active programme: the day after the most recently logged day
 * (wrapping to Day 1), or Day 1 when nothing has been logged yet. `basis` tells the UI
 * which rule applied so nothing is presented as a fixed schedule it is not.
 */
function nextProgrammeDay(program, lastLogged) {
  const days = (program?.days || []).slice().sort((a, b) => a.day_number - b.day_number);
  if (!days.length) return null;
  if (!lastLogged) return { day: days[0], basis: 'start' };
  const idx = days.findIndex((d) => d.id === lastLogged.day_id);
  return { day: days[(idx + 1) % days.length] || days[0], basis: 'after_last_logged', lastLogged };
}

/** Everything the member dashboard shows, all scoped to the caller's own memberId. */
export async function getDashboard(memberId, userId) {
  const present = await hubRepo.getPresentHubTables();
  const [profile, membership, trainers, workouts, diets, activity, today, attendance, classes,
    weight, recent, feedback, perf, pt, unread] = await Promise.all([
    repo.getProfile(memberId),
    repo.getCurrentMembership(memberId),
    repo.getAssignedTrainer(memberId),
    repo.listWorkoutAssignments(memberId),
    repo.listDietAssignments(memberId),
    repo.getWorkoutActivity(memberId),
    repo.getTodayNutrition(memberId),
    repo.getAttendance(memberId),
    repo.getUpcomingClasses(memberId),
    repo.getWeightSeries(memberId),
    repo.getRecentActivity(memberId),
    repo.listFeedback(memberId, { limit: 3, offset: 0 }),
    hubRepo.getClientProgress(memberId, { withCardio: false, withSnapshots: false }),
    present.has('pt_sessions') && present.has('pt_package_purchases')
      ? repo.listPtSessions(memberId, { from: new Date().toISOString(), to: null, limit: 3, offset: 0 }) : null,
    present.has('notifications') && userId ? repo.countUnreadNotifications(userId) : null,
  ]);
  if (!profile) throw httpError(404, 'Member profile not found.');

  const activeWorkout = workouts.find((w) => w.status === 'active') || null;
  let nextWorkout = null;
  if (activeWorkout) {
    const [program, lastLogged] = await Promise.all([
      workoutRepo.getWorkoutProgramById(activeWorkout.program_id),
      repo.getLastLoggedDay(memberId, activeWorkout.program_id),
    ]);
    nextWorkout = nextProgrammeDay(program, lastLogged);
  }
  const trainer = trainers[0] || null;

  return {
    profile,
    membership,
    trainer,
    workout: {
      active: activeWorkout,
      next: nextWorkout,
      activity,
      targetPerWeek: trainer?.sessions_per_week ?? null,
      completionPct: perf.performanceProfile?.workout_completion_pct ?? null,
    },
    diet: { active: diets.find((d) => d.status === 'active') || null, today },
    ptSessions: pt === null ? null : pt.rows,
    progress: {
      profile: perf.performanceProfile,
      weightSeries: weight,
      latestMeasurement: perf.bodyMeasurements[0] || null,
    },
    attendance,
    classes,
    feedback: feedback.rows,
    recentActivity: recent,
    notifications: unread === null ? null : { unread },
  };
}

// ---------------------------------------------------------------- profile

const LANGUAGES = ['en-IN', 'kn-IN', 'hi-IN'];
const EDITABLE_FIELDS = ['email', 'phone', 'emergencyContactName', 'emergencyContactPhone', 'preferredLanguage'];
/** Admin/trainer-managed fields a member may never change (named so the API can say why). */
const LOCKED_FIELDS = ['fullName', 'full_name', 'memberCode', 'member_code', 'dateOfBirth', 'date_of_birth', 'status', 'planId', 'plan_id',
  'planName', 'plan_name', 'fee', 'feeAmount', 'fee_amount', 'feePaid', 'fee_paid', 'feeDue', 'fee_due', 'feeDueDate', 'fee_due_date',
  'paymentStatus', 'payment_status', 'role', 'roleId', 'role_id', 'permissions', 'isActive', 'is_active', 'notes', 'fitnessGoal',
  'trainerId', 'trainer_id', 'memberId', 'member_id', 'userId', 'username', 'password', 'avatarUrl'];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,18}$/;

export async function getProfile(memberId) {
  const [member, account, membership, trainers, goal] = await Promise.all([
    repo.getProfile(memberId),
    repo.getLinkedAccount(memberId),
    repo.getCurrentMembership(memberId),
    repo.getAssignedTrainer(memberId),
    repo.getFitnessGoal(memberId),
  ]);
  if (!member) throw httpError(404, 'Member profile not found.');
  const t = trainers[0] || null;
  return {
    member,
    account: account ? { username: account.username, avatarUrl: account.avatar_url } : null,
    membership,
    trainer: t ? { name: t.trainer_name, specialty: t.specialty, status: t.assignment_status, since: t.start_date, trainingGoal: t.training_goal } : null,
    fitnessGoal: goal?.fitness_goal || t?.training_goal || null,
    fitnessGoalSource: goal?.fitness_goal ? 'performance_profile' : t?.training_goal ? 'trainer_assignment' : null,
    editable: EDITABLE_FIELDS,
  };
}

export async function updateProfile(ctx, body = {}) {
  const locked = Object.keys(body).filter((k) => LOCKED_FIELDS.includes(k));
  if (locked.length) throw httpError(403, `These details are managed by the gym and cannot be changed here: ${locked.join(', ')}.`);
  const unknown = Object.keys(body).filter((k) => !EDITABLE_FIELDS.includes(k));
  if (unknown.length) throw httpError(400, `Unknown field(s): ${unknown.join(', ')}.`);

  const data = {};
  if (body.email !== undefined) {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 120) throw httpError(400, 'Enter a valid email address.');
    data.email = email;
  }
  if (body.phone !== undefined) {
    const phone = String(body.phone ?? '').trim();
    if (!PHONE_RE.test(phone)) throw httpError(400, 'Enter a valid phone number (7–20 digits).');
    data.phone = phone;
  }
  if (body.emergencyContactName !== undefined) {
    const v = String(body.emergencyContactName ?? '').trim();
    if (v.length > 100) throw httpError(400, 'Emergency contact name is too long (max 100).');
    data.emergencyContactName = v || null;
  }
  if (body.emergencyContactPhone !== undefined) {
    const v = String(body.emergencyContactPhone ?? '').trim();
    if (v && !PHONE_RE.test(v)) throw httpError(400, 'Enter a valid emergency contact phone number.');
    data.emergencyContactPhone = v || null;
  }
  if (body.preferredLanguage !== undefined) {
    if (!LANGUAGES.includes(body.preferredLanguage)) throw httpError(400, `preferredLanguage must be one of ${LANGUAGES.join(', ')}.`);
    data.preferredLanguage = body.preferredLanguage;
  }
  if (!Object.keys(data).length) throw httpError(400, 'No changes supplied.');

  const userId = ctx.user?.id;
  const conflicts = await repo.findContactConflicts(ctx.memberId, userId, data);
  if (conflicts.email_taken) throw httpError(409, 'That email address is already used by another account.');
  if (conflicts.phone_taken) throw httpError(409, 'That phone number is already used by another account.');

  let row;
  try {
    row = await repo.updateOwnProfile(ctx.memberId, userId, data);
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'That email or phone number is already in use.');
    throw err;
  }
  if (!row) throw httpError(404, 'Member profile not found.');
  await audit(memberCtx(ctx), 'MEMBER_PROFILE_UPDATED', { memberId: ctx.memberId, fields: Object.keys(data) });
  return row;
}

// Photo: PNG / JPEG / WebP only (no SVG), max 2 MB, verified by file signature, stored like existing avatars.
const PHOTO_TYPES = {
  png: { sig: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, ext: 'png' },
  jpeg: { sig: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, ext: 'jpg' },
  jpg: { sig: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, ext: 'jpg' },
  webp: { sig: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP', ext: 'webp' },
};
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export async function updatePhoto(ctx, body = {}) {
  const userId = ctx.user?.id;
  // 1. Validate the upload (no side effects)
  let photo = null;
  if (body.remove !== true) {
    const m = /^data:image\/([a-z]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(body.image || ''));
    if (!m || !PHOTO_TYPES[m[1]]) throw httpError(400, 'Upload a PNG, JPEG or WebP image.');
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) throw httpError(400, 'The image is empty.');
    if (buf.length > MAX_PHOTO_BYTES) throw httpError(413, 'The photo must be 2 MB or smaller.');
    if (!PHOTO_TYPES[m[1]].sig(buf)) throw httpError(400, 'The file content is not a valid image of that type.');
    photo = { buf, ext: PHOTO_TYPES[m[1]].ext };
  }
  // 2. Ownership: the signed-in login must be this member's linked account
  const account = await repo.getLinkedAccount(ctx.memberId);
  if (!account || account.id !== userId) throw httpError(404, 'Your login account is not linked to this member profile.');
  // 3. Only now write the file (same folder/URL scheme as existing avatars) and save the URL
  let url = null;
  if (photo) {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/uploads/avatars');
    await fs.promises.mkdir(dir, { recursive: true });
    const name = `member_${userId}_${Date.now()}.${photo.ext}`;
    await fs.promises.writeFile(path.join(dir, name), photo.buf);
    url = `/uploads/avatars/${name}`;
  }
  const row = await repo.setOwnAvatar(ctx.memberId, userId, url);
  if (!row) throw httpError(404, 'Your login account is not linked to this member profile.');
  await audit(memberCtx(ctx), url ? 'MEMBER_PHOTO_UPDATED' : 'MEMBER_PHOTO_REMOVED', { memberId: ctx.memberId });
  return { avatarUrl: row.avatar_url };
}

// ---------------------------------------------------------------- membership & finance (read-only)

const PAID = ['completed', 'paid', 'success'];

export async function getMembership(memberId) {
  const [profile, periods, catalogPlan] = await Promise.all([
    repo.getProfile(memberId), repo.listMemberships(memberId), repo.getMemberCatalogPlan(memberId),
  ]);
  if (!profile) throw httpError(404, 'Member profile not found.');
  const current = periods[0] || null;
  return {
    status: profile.status,
    planName: profile.plan_name || current?.plan_name || catalogPlan?.name || null,
    catalogPlan,
    current,
    history: periods,
    fees: { amount: profile.fee_amount, paid: profile.fee_paid, due: profile.fee_due, dueDate: profile.fee_due_date, paymentStatus: profile.payment_status },
  };
}

export async function listPayments(memberId, q) {
  const p = paging(q);
  const [page, totals] = await Promise.all([repo.listTransactions(memberId, p), repo.getPaymentTotals(memberId)]);
  return { ...paginated(page, p), totals };
}

export async function listInvoices(memberId, q) {
  const p = paging(q);
  return paginated(await repo.listTransactions(memberId, { ...p, invoicesOnly: true }), p);
}

/** Invoice + (only when paid) receipt, built from the stored ledger values — nothing recomputed or invented. */
export async function getInvoice(memberId, idParam) {
  const id = positiveInt(idParam, 'invoiceId');
  const [tx, gym] = await Promise.all([repo.getOwnInvoice(memberId, id), repo.getGymInvoiceHeader()]);
  if (!tx || !tx.invoice_number) throw httpError(404, 'Invoice not found.');
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  const amount = num(tx.amount); const discount = num(tx.discount_amount) || 0; const tax = num(tx.tax_amount) || 0;
  const paid = PAID.includes(String(tx.payment_status || '').toLowerCase());
  return {
    id: tx.id,
    invoiceNumber: tx.invoice_number,
    date: tx.transaction_date,
    type: tx.transaction_type,
    paymentMethod: tx.payment_method,
    paymentStatus: tx.payment_status,
    notes: tx.notes,
    gym,
    billedTo: { name: tx.member_name, code: tx.member_code, email: tx.member_email, phone: tx.member_phone, plan: tx.plan_name },
    lines: [{ description: String(tx.transaction_type || 'Payment').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), amount, discount, taxable: amount === null ? null : amount - discount, tax, total: num(tx.net_amount) }],
    totals: { subtotal: amount, discount, tax, total: num(tx.net_amount) },
    receipt: paid && tx.receipt_number ? { receiptNumber: tx.receipt_number, paidAt: tx.transaction_date, method: tx.payment_method, amount: num(tx.net_amount) } : null,
  };
}

/** A single assigned training day with exercises + this member's completion for it. 404 if not assigned. */
export async function getWorkoutDay(memberId, programIdParam, dayIdParam) {
  const programId = positiveInt(programIdParam, 'programId');
  const dayId = positiveInt(dayIdParam, 'dayId');
  const data = await repo.getAssignedWorkoutDay(memberId, programId, dayId);
  if (!data) throw httpError(404, 'This workout is not assigned to your account.');
  const [completion, lastLogged] = await Promise.all([repo.getDayCompletion(memberId, [programId]), repo.getLastLoggedDay(memberId, programId)]);
  const c = completion.find((x) => x.day_id === dayId);
  const days = data.days.map((d) => ({ ...d, completedThisWeek: (completion.find((x) => x.day_id === d.id)?.this_week ?? 0) > 0 }));
  const next = nextProgrammeDay({ days: data.days }, lastLogged);
  return {
    program: { id: programId, name: data.assignment.program_name, goal: data.assignment.goal, splitType: data.assignment.split_type,
      difficulty: data.assignment.difficulty_level, description: data.assignment.description, assignedBy: data.assignment.assigned_by,
      startDate: data.assignment.start_date, trainerNotes: data.assignment.trainer_notes },
    day: { ...data.day, exercises: data.exercises },
    days,
    isNext: next?.day?.id === dayId,
    completion: { total: c?.completions ?? 0, thisWeek: c?.this_week ?? 0, lastCompletedAt: c?.last_completed_at ?? null },
  };
}

// ---------------------------------------------------------------- food diary

const DIARY_MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round1 = (x) => Math.round(x * 10) / 10;

async function activeCalorieTarget(memberId) {
  const active = (await repo.listDietAssignments(memberId)).filter((a) => a.status === 'active')
    .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  const a = active[0];
  return a ? { planName: a.plan_name, calories: a.target_calories, proteinG: a.target_protein_g, carbsG: a.target_carbs_g, fatsG: a.target_fats_g, waterMl: a.target_water_ml } : null;
}

export async function getFoodDiary(memberId, q) {
  const date = q.date === undefined ? null : String(q.date);
  if (date !== null && !DATE_RE.test(date)) throw httpError(400, 'date must be YYYY-MM-DD.');
  const win = await repo.diaryDateWindow(date || new Date().toISOString().slice(0, 10));
  const day = date || win.today;
  const [log, targets] = await Promise.all([repo.getDiaryDay(memberId, day), activeCalorieTarget(memberId)]);
  const w = await repo.diaryDateWindow(day);
  return { date: day, today: w.today, editable: !w.future && !w.too_old, log, targets };
}

/**
 * Save a whole day. Database foods: nutrition = food_items values × servings (client numbers ignored).
 * Custom foods: the member must enter every value; nothing is defaulted.
 */
export async function saveFoodDiary(ctx, dateParam, body = {}) {
  const date = String(dateParam || '');
  if (!DATE_RE.test(date)) throw httpError(400, 'date must be YYYY-MM-DD.');
  const win = await repo.diaryDateWindow(date);
  if (win.future) throw httpError(400, 'You cannot log food for a future date.');
  if (win.too_old) throw httpError(403, 'Days older than a week are locked to preserve your history. Ask your trainer to correct older records.');

  const waterMl = optionalNumber(body.waterIntakeMl, 'waterIntakeMl', { min: 0, max: 15000, int: true });
  if (waterMl === undefined) throw httpError(400, 'Enter your water intake for the day (0 if none).');
  const notes = optionalText(body.notes, 'notes', 1000) ?? null;
  const raw = body.entries;
  if (!Array.isArray(raw) || raw.length > 60) throw httpError(400, 'entries must be an array of up to 60 foods.');

  const foodIds = [...new Set(raw.filter((e) => e && e.foodItemId !== undefined && e.foodItemId !== null).map((e) => positiveInt(e.foodItemId, 'foodItemId')))];
  const foods = new Map((await repo.getFoodsByIds(foodIds)).map((f) => [f.id, f]));

  const entries = raw.map((e, i) => {
    const mealType = DIARY_MEALS.find((m) => m.toLowerCase() === String(e?.mealType || '').toLowerCase());
    if (!mealType) throw httpError(400, `entries[${i}].mealType must be one of ${DIARY_MEALS.join(', ')}.`);
    if (e.foodItemId !== undefined && e.foodItemId !== null) {
      const f = foods.get(Number(e.foodItemId));
      if (!f) throw httpError(400, `entries[${i}]: food not found in the food database.`);
      const servings = optionalNumber(e.servings, `entries[${i}].servings`, { min: 0.1, max: 20 });
      if (servings === undefined) throw httpError(400, `entries[${i}].servings is required.`);
      return {
        meal_type: mealType, food_item_id: f.id, food_name: f.name,
        portion_size: `${servings} × ${f.serving_size}`.slice(0, 100),
        calories: round1(Number(f.calories) * servings), protein_g: round1(Number(f.protein_g) * servings),
        carbs_g: round1(Number(f.carbs_g) * servings), fats_g: round1(Number(f.fats_g) * servings),
      };
    }
    const name = optionalText(e.foodName, `entries[${i}].foodName`, 120);
    const portion = optionalText(e.portionSize, `entries[${i}].portionSize`, 100);
    if (!name || !portion) throw httpError(400, `entries[${i}]: a custom food needs a name and the amount eaten.`);
    const need = (k, label, max) => {
      const v = optionalNumber(e[k], `entries[${i}].${k}`, { min: 0, max });
      if (v === undefined) throw httpError(400, `entries[${i}]: enter the ${label} for "${name}" (from its label) — values are never guessed.`);
      return v;
    };
    return { meal_type: mealType, food_item_id: null, food_name: name, portion_size: portion,
      calories: need('calories', 'calories', 5000), protein_g: need('proteinG', 'protein', 500), carbs_g: need('carbsG', 'carbohydrates', 1000), fats_g: need('fatsG', 'fat', 500) };
  });

  // Adherence only when the active plan has a calorie target; otherwise left empty (never defaulted).
  const targets = await activeCalorieTarget(ctx.memberId);
  const total = entries.reduce((s, e) => s + e.calories, 0);
  const target = Number(targets?.calories) || 0;
  const adherence = target > 0 && entries.length ? Math.max(0, Math.min(100, Math.round(100 - (Math.abs(total - target) / target) * 100))) : null;

  const logId = await repo.saveDiaryDay(ctx.memberId, date, { entries, waterMl, notes, adherence });
  await audit(memberCtx(ctx), 'MEMBER_FOOD_DIARY_SAVED', { memberId: ctx.memberId, date, entries: entries.length });
  return { id: logId, date, ...(await repo.getDiaryDay(ctx.memberId, date)) };
}

// ---------------------------------------------------------------- muscle recovery (estimate from logged workouts)
/** Muscle groups shown on the Recovery page (same names as the soreness check-in) + standard rest windows. */
const MUSCLE_RECOVERY = [
  ['Chest', 72], ['Shoulders', 48], ['Upper back', 72], ['Lower back', 72], ['Biceps', 48], ['Triceps', 48],
  ['Forearms', 48], ['Abs', 48], ['Glutes', 72], ['Quads', 72], ['Hamstrings', 72], ['Calves', 48],
];
const MUSCLE_KEYWORDS = [
  ['Chest', /chest|pec/], ['Shoulders', /shoulder|delt/], ['Upper back', /upper back|lat\b|lats|rhomboid|trap|rear delt/],
  ['Lower back', /lower back|erector|lumbar/], ['Biceps', /bicep|brachialis/], ['Triceps', /tricep/], ['Forearms', /forearm|grip|wrist/],
  ['Abs', /\babs?\b|abdominal|core|oblique/], ['Glutes', /glute/], ['Quads', /quad/], ['Hamstrings', /hamstring/], ['Calves', /calf|calves|gastro|soleus/],
];
const GROUP_FALLBACK = {
  chest: ['Chest'], shoulders: ['Shoulders'], back: ['Upper back'], arms: ['Biceps', 'Triceps'], core: ['Abs'],
  legs: ['Quads', 'Hamstrings', 'Glutes'], 'full body': ['Chest', 'Upper back', 'Shoulders', 'Quads', 'Hamstrings', 'Glutes', 'Abs'],
};
/** Which page muscles an exercise works: named target muscles first, else its muscle group. */
function musclesForExercise(row) {
  const text = `${row.target_muscles || ''} ${row.exercise || ''}`.toLowerCase();
  const hit = MUSCLE_KEYWORDS.filter(([, re]) => re.test(text)).map(([m]) => m);
  if (hit.length) return hit;
  return GROUP_FALLBACK[String(row.muscle_group || '').trim().toLowerCase()] || [];
}

/**
 * Estimated recovery per muscle: time since the muscle was last trained in a completed workout, against a
 * standard rest window (+12 h for a hard session, RPE ≥ 8). 100 % = recovered. A muscle the member reported
 * as sore (level ≥ 7) today/yesterday is held below 100 %. It is a general guide, not a medical assessment.
 */
/** Upper rep target from text like "8-12", "10", "12 each side" (null when not a number). */
function repTarget(reps) {
  const nums = String(reps || '').match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}
/**
 * Assigned exercises per muscle with today's progress:
 *   done = logged sets ≥ planned sets · partial = some sets · todo = none.
 *   extraReps = reps logged above the upper target in each set (e.g. 14 reps on an 8-12 set = +2).
 */
function buildMusclePlans(assigned, today) {
  const logged = new Map(today.map((r) => [r.exercise_id, r]));
  const byMuscle = new Map();
  for (const a of assigned) {
    const l = logged.get(a.exercise_id);
    const planned = Number(a.sets) || 0;
    const repsDone = (l?.reps || []).map((x) => Number(x) || 0);
    const target = repTarget(a.reps);
    const extraReps = target === null ? 0 : repsDone.reduce((sum, r) => sum + Math.max(0, r - target), 0);
    const loggedSets = l ? l.sets : 0;
    const item = {
      exercise: a.exercise, program: a.program_name, day: a.day_name, dayNumber: a.day_number,
      sets: planned, reps: a.reps, targetWeightKg: a.target_weight_kg === null ? null : Number(a.target_weight_kg), restSeconds: a.rest_seconds,
      loggedSets, loggedReps: repsDone, extraReps, topWeightKg: l?.top_weight_kg === null || l?.top_weight_kg === undefined ? null : Number(l.top_weight_kg),
      status: planned > 0 && loggedSets >= planned ? 'done' : loggedSets > 0 ? 'partial' : 'todo',
      link: `member-workout-details.html?program=${a.program_id}&day=${a.day_id}`,
      own: a.is_own === true, coachPlan: a.is_coach_plan === true, trainerId: a.trainer_id ?? null, planId: a.plan_id,
    };
    for (const m of musclesForExercise(a)) {
      if (!byMuscle.has(m)) byMuscle.set(m, []);
      const list = byMuscle.get(m);
      if (!list.some((x) => x.exercise === item.exercise && x.day === item.day)) list.push(item);
    }
  }
  return byMuscle;
}

export async function getMuscleRecovery(memberId) {
  const [work, sore, assigned, today] = await Promise.all([
    repo.getRecentMuscleWork(memberId, 7), repo.getRecentSoreness(memberId).catch(() => []),
    repo.getAssignedExercises(memberId).catch(() => []), repo.getTodayLoggedSets(memberId).catch(() => []),
  ]);
  const plans = buildMusclePlans(assigned, today);
  const now = Date.now();
  const last = new Map(); // muscle -> { at, rpe, sets, exercises:Set }
  for (const r of work) {
    for (const m of musclesForExercise(r)) {
      const at = new Date(r.completed_at).getTime();
      const cur = last.get(m);
      if (!cur || at > cur.at) last.set(m, { at, rpe: r.rpe_rating, sets: r.sets || 0, exercises: new Set([r.exercise]), sessionId: r.session_id });
      else if (at === cur.at) { cur.sets += r.sets || 0; cur.exercises.add(r.exercise); if ((r.rpe_rating || 0) > (cur.rpe || 0)) cur.rpe = r.rpe_rating; }
    }
  }
  const soreBy = new Map();
  for (const s of sore) { const k = String(s.muscle_group || ''); if (!soreBy.has(k)) soreBy.set(k, Number(s.soreness_level) || 0); }
  const muscles = MUSCLE_RECOVERY.map(([name, baseHours]) => {
    const t = last.get(name);
    const soreness = soreBy.has(name) ? soreBy.get(name) : null;
    const plan = plans.get(name) || [];
    const planInfo = { plan, planDoneToday: plan.length > 0 && plan.every((p) => p.status === 'done') };
    if (!t) return { name, status: 'fresh', percent: 100, lastTrainedAt: null, readyAt: null, recoveryHours: baseHours, sets: 0, exercises: [], soreness, ...planInfo };
    const hours = baseHours + (Number(t.rpe) >= 8 ? 12 : 0);
    const elapsedH = Math.max(0, (now - t.at) / 3600000);
    let percent = Math.min(100, Math.round((elapsedH / hours) * 100));
    if (soreness !== null && soreness >= 7) percent = Math.min(percent, 90);
    return {
      name, status: percent >= 100 ? 'recovered' : 'recovering', percent,
      lastTrainedAt: new Date(t.at).toISOString(), readyAt: new Date(t.at + hours * 3600000).toISOString(),
      recoveryHours: hours, sets: t.sets, exercises: [...t.exercises].filter(Boolean).slice(0, 4), soreness, ...planInfo,
    };
  });
  return { muscles, windowDays: 7, generatedAt: new Date(now).toISOString() };
}

// ---------------------------------------------------------------- member's own plan (Recovery page "Assign")
const MUSCLE_TO_GROUP = { Chest: 'Chest', Shoulders: 'Shoulders', 'Upper back': 'Back', 'Lower back': 'Back', Biceps: 'Arms', Triceps: 'Arms',
  Forearms: 'Arms', Abs: 'Core', Glutes: 'Legs', Quads: 'Legs', Hamstrings: 'Legs', Calves: 'Legs' };
const muscleName = (v) => { const m = MUSCLE_RECOVERY.find(([n]) => n.toLowerCase() === String(v || '').trim().toLowerCase()); if (!m) throw httpError(400, 'Choose one of the listed muscles.'); return m[0]; };

/** Library exercises that train this muscle (for the Assign picker). */
export async function getSelfPlanOptions(q = {}) {
  const muscle = muscleName(q.muscle);
  // JavaScript \b (word boundary) is \y in PostgreSQL regular expressions.
  const re = MUSCLE_KEYWORDS.find(([m]) => m === muscle)[1].source.replaceAll('\\b', '\\y');
  const groups = Object.entries(GROUP_FALLBACK).filter(([, ms]) => ms.includes(muscle)).map(([g]) => g);
  const rows = await repo.findExercisesForMuscle(re, groups);
  return { muscle, exercises: rows.filter((r) => musclesForExercise(r).includes(muscle)).map((r) => ({ id: r.id, name: r.name, equipment: r.equipment, difficulty: r.difficulty })) };
}

/** Validates an Assign request (member or trainer) → { muscle, input } for the repository. */
export async function parsePlanExerciseInput(body = {}) {
  const muscle = muscleName(body.muscle);
  const sets = positiveInt(body.sets, 'sets');
  if (sets > 10) throw httpError(400, 'Sets must be 1–10.');
  const reps = String(body.reps ?? '').trim();
  if (!/^\d{1,3}(\s*-\s*\d{1,3})?$/.test(reps)) throw httpError(400, 'Reps must be a number like 10 or a range like 8-12.');
  const nums = reps.split('-').map((x) => Number(x.trim()));
  if (nums.some((x) => x < 1 || x > 100) || (nums.length === 2 && nums[0] > nums[1])) throw httpError(400, 'Reps must be between 1 and 100 (low-high).');
  let weightKg = null;
  if (body.weightKg !== undefined && body.weightKg !== null && body.weightKg !== '') {
    weightKg = Number(body.weightKg);
    if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > 500) throw httpError(400, 'Weight must be 0–500 kg.');
  }
  let exerciseId = null; let newExercise = null;
  if (body.exerciseId !== undefined && body.exerciseId !== null && body.exerciseId !== '') {
    exerciseId = positiveInt(body.exerciseId, 'exerciseId');
    const opts = await getSelfPlanOptions({ muscle });
    if (!opts.exercises.some((e) => e.id === exerciseId)) throw httpError(400, 'That exercise does not train the selected muscle.');
  } else {
    const name = String(body.exerciseName || '').trim().replace(/\s+/g, ' ');
    if (name.length < 3 || name.length > 80) throw httpError(400, 'Choose an exercise or type a name (3–80 characters).');
    newExercise = { name, muscleGroup: MUSCLE_TO_GROUP[muscle], targetMuscles: muscle };
  }
  return { muscle, input: { exerciseId, newExercise, sets, reps: nums.join('-'), weightKg } };
}

export async function addSelfPlanExercise(ctx, body = {}) {
  const { muscle, input } = await parsePlanExerciseInput(body);
  const out = await repo.upsertSelfPlanExercise(ctx.memberId, input);
  await audit(memberCtx(ctx), 'MEMBER_SELF_PLAN_EXERCISE_SAVED', { memberId: ctx.memberId, muscle, sets: input.sets, reps: input.reps, planExerciseId: out.planExerciseId });
  return { ...out, muscle };
}

export async function removeSelfPlanExercise(ctx, idParam) {
  const id = positiveInt(idParam, 'planExerciseId');
  const n = await repo.removeSelfPlanExercise(ctx.memberId, id);
  if (!n) throw httpError(404, 'That exercise is not in your own plan.');
  await audit(memberCtx(ctx), 'MEMBER_SELF_PLAN_EXERCISE_REMOVED', { memberId: ctx.memberId, planExerciseId: id });
  return { removed: true };
}
