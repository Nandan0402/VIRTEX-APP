/**
 * progressReport.service.js — one member's fitness progress report, calculated ONLY from
 * recorded data (workout logs, strength logs, body measurements, cardio benchmarks, check-ins).
 *
 * Rules:
 *  - No stored or invented percentages. Every number is derived from rows, and every derived
 *    figure carries the data it came from (counts, first/latest values, dates).
 *  - When there is not enough data for a figure it is returned as
 *    { notEnoughData: true, reason } — never as 0 or a default.
 *  - No composite "fitness score": indicators are reported separately.
 *
 * Callers are responsible for authorisation (member = own id; trainer = assigned client;
 * admin = owner/manager). This module never decides who may see a member.
 */
import * as repo from '../repositories/progressReport.repository.js';
import { getPresentHubTables } from '../repositories/trainerHub.repository.js';

const DAY = 86400000;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const pct = (from, to) => (from ? r1(((to - from) / from) * 100) : null);
const ymd = (d) => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const ned = (reason, extra = {}) => ({ notEnoughData: true, reason, ...extra });
const sumOrNull = (rows, key) => {
  const vals = rows.map((r) => num(r[key])).filter((v) => v !== null);
  return vals.length ? r1(vals.reduce((a, b) => a + b, 0)) : null;
};

// ---------------------------------------------------------------- strength

function strengthByExercise(points) {
  const map = new Map();
  for (const p of points) {
    const name = String(p.exercise_name || '').trim();
    const e1rm = num(p.e1rm);
    if (!name || e1rm === null) continue;
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, { exercise: name, points: [] });
    map.get(key).points.push({ date: p.logged_at, e1rm, weightKg: num(p.weight_kg), reps: num(p.reps), source: p.source });
  }
  return [...map.values()];
}

/** Personal-best events: a point whose estimated 1RM beats every earlier point for that exercise. */
function pbEvents(groups) {
  const events = [];
  for (const g of groups) {
    let best = null;
    for (const p of g.points) {
      if (best !== null && p.e1rm > best) events.push({ exercise: g.exercise, date: p.date });
      if (best === null || p.e1rm > best) best = p.e1rm;
    }
  }
  return events;
}

function strengthProgression(groups) {
  const exercises = groups.map((g) => {
    const pts = g.points;
    const days = new Set(pts.map((p) => ymd(p.date)));
    const first = pts[0];
    const latest = pts[pts.length - 1];
    const best = pts.reduce((a, b) => (b.e1rm > a.e1rm ? b : a), pts[0]);
    const base = {
      exercise: g.exercise,
      dataPoints: pts.length,
      firstDate: first.date,
      latestDate: latest.date,
      bestE1rmKg: best.e1rm,
      bestDate: best.date,
      series: pts.slice(-24).map((p) => ({ date: p.date, e1rmKg: p.e1rm, weightKg: p.weightKg, reps: p.reps })),
    };
    if (days.size < 2) return { ...base, ...ned('Needs entries on at least 2 different days.') };
    return {
      ...base,
      firstE1rmKg: first.e1rm,
      latestE1rmKg: latest.e1rm,
      changeKg: r1(latest.e1rm - first.e1rm),
      changePct: pct(first.e1rm, latest.e1rm),
    };
  });
  exercises.sort((a, b) => b.dataPoints - a.dataPoints || String(a.exercise).localeCompare(b.exercise));
  return exercises;
}

function personalBests(groups) {
  return groups.map((g) => {
    // Heaviest weight lifted; date = the FIRST time that weight was reached.
    const withW = g.points.filter((p) => p.weightKg !== null);
    if (!withW.length) return null;
    const maxW = Math.max(...withW.map((p) => p.weightKg));
    const hit = withW.find((p) => p.weightKg === maxW);
    const bestE = g.points.reduce((a, b) => (b.e1rm > a.e1rm ? b : a), g.points[0]);
    return {
      exercise: g.exercise,
      heaviestKg: maxW,
      repsAtHeaviest: hit.reps,
      achievedAt: hit.date,
      bestE1rmKg: bestE.e1rm,
      bestE1rmAt: bestE.date,
      source: hit.source,
    };
  }).filter(Boolean).sort((a, b) => new Date(b.achievedAt) - new Date(a.achievedAt));
}

// ---------------------------------------------------------------- weight & cardio

function weightHistory(rows) {
  const series = rows.map((r) => ({ date: r.logged_at, weightKg: num(r.weight_kg), bodyFatPct: num(r.body_fat_pct), muscleMassKg: num(r.muscle_mass_kg), bmi: num(r.bmi) }))
    .filter((p) => p.weightKg !== null);
  if (!series.length) return { series: [], ...ned('No body-weight measurements recorded yet.') };
  const first = series[0];
  const latest = series[series.length - 1];
  const out = { series: series.slice(-60), measurements: series.length, first, latest };
  if (series.length < 2) return { ...out, ...ned('Needs at least 2 weight measurements.') };
  out.changeKg = r1(latest.weightKg - first.weightKg);
  out.changePct = pct(first.weightKg, latest.weightKg);
  // Change over ~30 days: latest vs the most recent measurement taken 30+ days before it.
  const cutoff = new Date(latest.date).getTime() - 30 * DAY;
  const ref = [...series].reverse().find((p) => new Date(p.date).getTime() <= cutoff);
  out.change30d = ref ? { fromDate: ref.date, changeKg: r1(latest.weightKg - ref.weightKg) } : ned('No measurement from 30+ days before the latest one.');
  return out;
}

function cardioBenchmarks(rows) {
  if (rows === null) return { available: false, ...ned('Cardio benchmarks are not set up at this gym yet.'), tests: [] };
  const map = new Map();
  for (const r of rows) {
    const v = num(r.result_value);
    if (v === null) continue;
    const key = `${r.test_name}|${r.result_unit || ''}`.toLowerCase();
    if (!map.has(key)) map.set(key, { test: r.test_name, type: r.test_type, unit: r.result_unit || null, points: [] });
    map.get(key).points.push({ date: r.recorded_at, value: v, avgHeartRate: num(r.avg_heart_rate) });
  }
  const tests = [...map.values()].map((t) => {
    const first = t.points[0];
    const latest = t.points[t.points.length - 1];
    const base = { test: t.test, type: t.type, unit: t.unit, results: t.points.length, latest, series: t.points.slice(-24) };
    if (t.points.length < 2) return { ...base, ...ned('Needs at least 2 results for this test.') };
    // Direction is reported, not judged: for timed tests lower is better, for distance higher is.
    return { ...base, first, change: r1(latest.value - first.value), changePct: pct(first.value, latest.value) };
  });
  if (!tests.length) return { available: true, ...ned('No cardio benchmark results recorded yet.'), tests: [] };
  return { available: true, tests };
}

// ---------------------------------------------------------------- workouts

function weekCompletion(programme, weekStart, sessions) {
  if (!programme || !programme.program_days) return null;
  const weekEnd = addDays(weekStart, 6);
  if (ymd(weekEnd) < ymd(programme.start_date)) return null; // programme not assigned yet
  if (programme.end_date && ymd(weekStart) > ymd(programme.end_date)) return null;
  const done = sessions.filter((s) => s.program_id === programme.program_id).length;
  return { planned: programme.program_days, completed: done, pct: Math.round((done / programme.program_days) * 100) };
}

function workoutCompletion(programme, weekly) {
  if (!programme) return ned('No active workout programme is assigned to you.');
  if (!programme.program_days) return ned('Your programme has no workout days set up yet.', { programName: programme.program_name });
  const thisWeek = weekly[0]?.programmeCompletion || null;
  const past = weekly.slice(1, 5).map((w) => w.programmeCompletion).filter(Boolean);
  const out = {
    programName: programme.program_name,
    plannedPerWeek: programme.program_days,
    basis: `Your programme has ${programme.program_days} workout day${programme.program_days === 1 ? '' : 's'}; each is planned once per week.`,
    assignedSince: programme.start_date,
    thisWeek,
  };
  if (!past.length) return { ...out, ...ned('Needs at least one full week on this programme.') };
  const planned = past.reduce((a, w) => a + w.planned, 0);
  const done = past.reduce((a, w) => a + w.completed, 0);
  return { ...out, lastWeeks: past.length, plannedLastWeeks: planned, completedLastWeeks: done, pctLastWeeks: Math.round((done / planned) * 100) };
}

function periodReport(start, end, { sessions, checkIns, weights, pbs }) {
  const inRange = (d) => { const t = new Date(d).getTime(); return t >= start.getTime() && t < end.getTime(); };
  const s = sessions.filter((x) => inRange(x.completed_at));
  const w = weights.filter((x) => inRange(x.date));
  return {
    start: ymd(start),
    end: ymd(addDays(end, -1)),
    sessions: s.length,
    minutes: s.length ? sumOrNull(s, 'duration_minutes') : 0,
    volumeKg: s.length ? sumOrNull(s, 'total_volume_kg') : 0,
    checkIns: checkIns.filter((x) => inRange(x.check_in_time)).length,
    newPersonalBests: pbs.filter((x) => inRange(x.date)).length,
    // null = no weigh-in that period (missing), not 0 kg
    avgWeightKg: w.length ? r1(w.reduce((a, b) => a + b.weightKg, 0) / w.length) : null,
    weighIns: w.length,
    _sessions: s,
  };
}

// ---------------------------------------------------------------- overall

function overall({ strength, weekly, sessions, weight, cardio, today }) {
  const indicators = [];

  const measured = strength.filter((e) => !e.notEnoughData);
  if (!measured.length) indicators.push({ key: 'strength', label: 'Strength', ...ned('Log the same exercise on at least 2 days.') });
  else {
    const up = measured.filter((e) => e.changeKg > 0).length;
    const down = measured.filter((e) => e.changeKg < 0).length;
    indicators.push({ key: 'strength', label: 'Strength', exercisesMeasured: measured.length, improved: up, declined: down, unchanged: measured.length - up - down,
      trend: up > down ? 'improving' : down > up ? 'declining' : 'steady' });
  }

  if (!sessions.length) indicators.push({ key: 'consistency', label: 'Workout consistency', ...ned('No workouts logged yet.') });
  else {
    const t = new Date(today).getTime();
    const last28 = sessions.filter((s) => t - new Date(s.completed_at).getTime() < 28 * DAY).length;
    const prev28 = sessions.filter((s) => { const a = t - new Date(s.completed_at).getTime(); return a >= 28 * DAY && a < 56 * DAY; }).length;
    const first = new Date(sessions[0].completed_at).getTime();
    const hasPrev = t - first >= 28 * DAY;
    indicators.push({ key: 'consistency', label: 'Workout consistency', last28Days: last28, previous28Days: hasPrev ? prev28 : null,
      trend: !hasPrev ? null : last28 > prev28 ? 'improving' : last28 < prev28 ? 'declining' : 'steady',
      ...(hasPrev ? {} : { note: 'Trend needs 4+ weeks of workout history.' }) });
  }

  if (weight.notEnoughData) indicators.push({ key: 'weight', label: 'Body weight', ...ned(weight.reason) });
  else indicators.push({ key: 'weight', label: 'Body weight', changeKg: weight.changeKg, since: weight.first.date, trend: null, note: 'Whether this is progress depends on your goal.' });

  const ct = (cardio.tests || []).filter((x) => !x.notEnoughData);
  if (!ct.length) indicators.push({ key: 'cardio', label: 'Cardio', ...ned(cardio.reason || 'Needs at least 2 results for one test.') });
  else indicators.push({ key: 'cardio', label: 'Cardio', testsMeasured: ct.length, trend: null, note: 'See each test: for timed tests lower is better.' });

  const judged = indicators.filter((i) => i.trend === 'improving' || i.trend === 'declining' || i.trend === 'steady');
  return {
    indicators,
    measuredIndicators: indicators.filter((i) => !i.notEnoughData).length,
    improving: judged.filter((i) => i.trend === 'improving').length,
    ...(indicators.every((i) => i.notEnoughData) ? ned('Not enough recorded data yet to show progress.') : {}),
  };
}

// ---------------------------------------------------------------- entry point

export async function buildProgressReport(memberId) {
  const present = await getPresentHubTables();
  const [sessions, strengthPts, weights, cardioRows, checkIns, programme, goals, anchors] = await Promise.all([
    repo.getSessions(memberId),
    repo.getStrengthPoints(memberId),
    repo.getWeightHistory(memberId),
    present.has('member_cardio_benchmarks') ? repo.getCardio(memberId) : null,
    repo.getCheckIns(memberId),
    repo.getActiveProgramme(memberId),
    repo.getGoals(memberId),
    repo.getPeriodAnchors(),
  ]);

  const groups = strengthByExercise(strengthPts);
  const strength = strengthProgression(groups);
  const pbs = pbEvents(groups);
  const weight = weightHistory(weights);
  const cardio = cardioBenchmarks(cardioRows);
  const wSeries = weight.series || [];
  const ctx = { sessions, checkIns, weights: wSeries, pbs };

  const thisWeek = new Date(anchors.this_week);
  const weekly = [];
  for (let i = 0; i < 8; i++) {
    const start = addDays(thisWeek, -7 * i);
    const rep = periodReport(start, addDays(start, 7), ctx);
    rep.isCurrent = i === 0;
    rep.programmeCompletion = weekCompletion(programme, start, rep._sessions);
    delete rep._sessions;
    weekly.push(rep);
  }
  const thisMonth = new Date(anchors.this_month);
  const monthly = [];
  for (let i = 0; i < 6; i++) {
    const start = addMonths(thisMonth, -i);
    const rep = periodReport(start, addMonths(start, 1), ctx);
    rep.isCurrent = i === 0;
    delete rep._sessions;
    monthly.push(rep);
  }

  const goal = {
    fitnessGoal: goals.profile?.fitness_goal || null,
    // 'insufficient_data' is the column DEFAULT, not something a trainer recorded.
    progressStatus: goals.profile?.progress_status && goals.profile.progress_status !== 'insufficient_data'
      ? goals.profile.progress_status : null,
    trainerNotes: goals.profile?.trainer_notes || null,
    updatedAt: goals.profile?.last_updated_at || null,
    ptGoal: goals.pt?.training_goal || null,
    ptTrainer: goals.pt?.training_goal ? goals.pt.trainer_name : null,
    programmeGoal: programme?.program_goal || null,
    programName: programme?.program_name || null,
  };
  const hasGoal = goal.fitnessGoal || goal.ptGoal || goal.programmeGoal;

  const hasAnyLog = sessions.length || strengthPts.length || weights.length || (cardioRows && cardioRows.length);
  return {
    generatedAt: new Date().toISOString(),
    hasData: !!hasAnyLog,
    overall: overall({ strength, weekly, sessions, weight, cardio, today: anchors.today }),
    workoutCompletion: workoutCompletion(programme, weekly),
    strength: strength.length ? { exercises: strength } : { exercises: [], ...ned('No strength data logged yet.') },
    cardio,
    weight,
    goal: hasGoal ? goal : { ...goal, ...ned('No fitness goal has been recorded for you yet.') },
    // Who can review this report in Trainer Hub (assigned trainer only).
    trainerReview: goals.pt ? { assigned: true, trainerName: goals.pt.trainer_name, status: goals.pt.status } : { assigned: false },
    personalBests: personalBests(groups),
    weeklyReports: weekly,
    monthlyReports: monthly,
    dataCoverage: {
      workoutSessions: sessions.length,
      strengthEntries: strengthPts.length,
      weighIns: weights.length,
      cardioResults: cardioRows ? cardioRows.length : null,
      checkIns: checkIns.length,
    },
  };
}
