/**
 * achievements.service.js — a member's achievements, derived ONLY from existing records.
 *
 * Nothing is stored or awarded here: each achievement is the result of a fixed, published rule
 * applied to real rows, and carries the record it came from and how that record was verified.
 *  - Certificates: only those issued by staff (course_certificates / competition_certificates).
 *  - Competition & challenge results: only when the entry is completed AND verified by a trainer,
 *    or a certificate was issued. Otherwise they are listed as "pending", not awarded.
 *  - Course completion: awarded only with an issued certificate.
 *  - Workout / attendance milestones: the date of the Nth recorded session / check-in.
 *  - Personal bests: only a lift that beat an EARLIER record for the same exercise.
 *  - Transformation: consented progress photos (by phase) and measurement-tracking spans.
 */
import * as repo from '../repositories/achievements.repository.js';

export const WORKOUT_MILESTONES = [1, 10, 25, 50, 100, 250, 500, 1000];
export const ATTENDANCE_MILESTONES = [1, 10, 25, 50, 100, 250, 500, 1000];
const TRACKING_SPANS = [[30, '1 month'], [90, '3 months'], [180, '6 months'], [365, '1 year']];
const DAY = 86400000;

const V = {
  staff_issued: 'Issued by staff',
  trainer_verified: 'Verified by trainer',
  system: 'Gym check-in system',
  staff_logged: 'Recorded by staff',
  self_logged: 'Recorded by you',
};
const verification = (level) => ({ level, label: V[level] });
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** Only http(s) or same-site paths may be linked (never javascript:, data:, etc.). */
const safeUrl = (u) => (typeof u === 'string' && (/^https:\/\//i.test(u) || /^\/(?!\/)/.test(u)) ? u : null);

function countMilestones(rows, { category, noun, dateKey, thresholds, verify }) {
  const total = rows.length ? Number(rows[0].total) : 0;
  const earned = rows.filter((r) => thresholds.includes(Number(r.n))).map((r) => ({
    id: `${category}-${r.n}`,
    category,
    title: Number(r.n) === 1 ? `First ${noun}` : `${Number(r.n).toLocaleString('en-US')} ${noun}s`,
    detail: `Your ${Number(r.n).toLocaleString('en-US')}${ordinal(Number(r.n))} recorded ${noun}.`,
    earnedAt: r[dateKey],
    verification: verify(r),
  }));
  const next = thresholds.find((t) => t > total) || null;
  return { earned, total, next };
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }

function personalBests(records) {
  const byEx = new Map();
  for (const r of records) {
    const w = num(r.weight_kg);
    if (w === null || !r.exercise_name) continue;
    const key = r.exercise_name.trim().toLowerCase();
    if (!byEx.has(key)) byEx.set(key, { name: r.exercise_name.trim(), best: null, events: [] });
    const ex = byEx.get(key);
    if (ex.best !== null && w > ex.best.w) ex.events.push({ w, prev: ex.best.w, reps: num(r.reps), at: r.logged_at, r });
    if (ex.best === null || w > ex.best.w) ex.best = { w, at: r.logged_at };
  }
  const out = [];
  for (const ex of byEx.values()) {
    if (!ex.events.length) continue; // a single record is not yet a "personal best" improvement
    const e = ex.events[ex.events.length - 1]; // current best (most recent improvement)
    out.push({
      id: `pb-${ex.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      category: 'personal_best',
      title: `${ex.name}: ${e.w} kg`,
      detail: `New personal best${e.reps ? ` (${e.w} kg × ${e.reps})` : ''}, up from ${e.prev} kg. ${ex.events.length} improvement${ex.events.length === 1 ? '' : 's'} recorded.`,
      earnedAt: e.at,
      verification: verification(e.r.source === 'strength_log' ? 'staff_logged' : e.r.logged_by === 'Member' ? 'self_logged' : 'staff_logged'),
    });
  }
  return out;
}

export async function buildAchievements(memberId) {
  const [workouts, loggers, checkIns, strength, comps, courses, trans, member] = await Promise.all([
    repo.getWorkoutMilestones(memberId, WORKOUT_MILESTONES),
    repo.getWorkoutLoggers(memberId),
    repo.getCheckInMilestones(memberId, ATTENDANCE_MILESTONES),
    repo.getStrengthRecords(memberId),
    repo.getCompetitionEntries(memberId),
    repo.getCourses(memberId),
    repo.getTransformation(memberId),
    repo.getMemberName(memberId),
  ]);

  const achievements = [];
  const pending = [];
  const certificates = [];

  // Workout & attendance milestones
  const wm = countMilestones(workouts, {
    category: 'workout', noun: 'workout', dateKey: 'completed_at', thresholds: WORKOUT_MILESTONES,
    verify: (r) => verification(r.logged_by === 'Member' ? 'self_logged' : 'staff_logged'),
  });
  const am = countMilestones(checkIns, {
    category: 'attendance', noun: 'gym visit', dateKey: 'check_in_time', thresholds: ATTENDANCE_MILESTONES,
    verify: () => verification('system'),
  });
  achievements.push(...wm.earned, ...am.earned, ...personalBests(strength));

  // Competitions, challenges, transformation contests
  for (const c of comps) {
    const type = String(c.type || '');
    const category = /challenge/i.test(type) ? 'challenge' : /transformation/i.test(type) ? 'transformation' : 'competition';
    const verified = c.verified_by_trainer_id !== null && c.verified_by_trainer_id !== undefined;
    const hasCert = !!c.certificate_code;
    if (hasCert) {
      certificates.push({
        id: `comp-cert-${c.certificate_code}`, kind: 'competition', code: c.certificate_code,
        title: c.title, award: c.award_title || null, rank: num(c.rank_awarded),
        issuedAt: c.issued_at, issuedBy: c.issued_by || null, url: null,
      });
    }
    if (c.status === 'completed' && (verified || hasCert)) {
      const rank = num(c.rank_awarded) ?? num(c.rank_position);
      const parts = [];
      if (c.is_winner) parts.push('Winner');
      if (rank) parts.push(`Rank #${rank}`);
      if (num(c.score) !== null) parts.push(`Score ${num(c.score)}${c.score_unit ? ` ${c.score_unit}` : ''}`);
      if (c.division) parts.push(c.division);
      achievements.push({
        id: `comp-${c.id}`,
        category,
        title: `${category === 'challenge' ? 'Completed' : 'Competed in'}: ${c.title}`,
        detail: parts.length ? parts.join(' · ') : 'Result recorded.',
        earnedAt: c.issued_at || c.end_date || c.registration_date,
        verification: verification(verified ? 'trainer_verified' : 'staff_issued'),
        verifiedBy: verified ? c.verified_by || null : c.issued_by || null,
        certificateCode: c.certificate_code || null,
      });
    } else if (c.status === 'completed') {
      pending.push({ id: `comp-${c.id}`, category, title: c.title, reason: 'Result recorded — awaiting trainer verification.' });
    } else if (c.status === 'registered' || c.status === 'checked_in') {
      pending.push({ id: `comp-${c.id}`, category, title: c.title, reason: c.competition_status === 'cancelled' ? 'Event cancelled.' : 'Entered — no result yet.' });
    }
  }

  // Courses
  for (const e of courses) {
    if (e.certificate_code) {
      certificates.push({
        id: `course-cert-${e.certificate_code}`, kind: 'course', code: e.certificate_code, title: e.title,
        award: 'Course completion', grade: e.grade_score || null, issuedAt: e.issued_at, issuedBy: e.issued_by || null,
        url: safeUrl(e.certificate_url),
      });
      achievements.push({
        id: `course-${e.course_id}`, category: 'course', title: `Course completed: ${e.title}`,
        detail: [e.level, e.grade_score ? `Grade ${e.grade_score}` : null].filter(Boolean).join(' · ') || 'Certificate issued.',
        earnedAt: e.issued_at, verification: verification('staff_issued'), certificateCode: e.certificate_code,
      });
    } else if (e.status === 'completed' || e.completed_at) {
      pending.push({ id: `course-${e.course_id}`, category: 'course', title: e.title, reason: 'Course completed — certificate not issued yet.' });
    }
  }

  // Transformation: consented photos (by phase) + measurement tracking spans
  trans.photoPhases.forEach((p, i) => {
    achievements.push({
      id: `photo-${String(p.phase || 'phase').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      category: 'transformation',
      title: i === 0 ? 'Transformation journey started' : `${p.phase || 'Progress'} photos recorded`,
      detail: `${p.n} progress photo${p.n === 1 ? '' : 's'} (${p.phase || 'unlabelled phase'}) recorded with your consent.`,
      earnedAt: p.first_at, verification: verification('staff_logged'),
    });
  });
  const ms = trans.measurements;
  if (ms.length >= 2) {
    const first = new Date(ms[0].logged_at).getTime();
    for (const [days, label] of TRACKING_SPANS) {
      const hit = ms.find((m) => new Date(m.logged_at).getTime() - first >= days * DAY);
      if (!hit) break;
      achievements.push({
        id: `tracking-${days}`, category: 'transformation', title: `Tracked measurements for ${label}`,
        detail: `Body measurements recorded from ${new Date(first).toISOString().slice(0, 10)} onward.`,
        earnedAt: hit.logged_at, verification: verification(hit.measured_by === 'Member' ? 'self_logged' : 'staff_logged'),
      });
    }
  }

  achievements.sort((a, b) => new Date(b.earnedAt) - new Date(a.earnedAt));
  certificates.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  const selfLogged = loggers.find((l) => l.logged_by === 'Member')?.n || 0;
  const allLogged = loggers.reduce((s, l) => s + l.n, 0);

  return {
    member: member ? { name: member.full_name, code: member.member_code } : null,
    summary: { earned: achievements.length, certificates: certificates.length, pending: pending.length },
    achievements,
    certificates,
    pending,
    progress: [
      { category: 'workout', label: 'Workouts', current: wm.total, next: wm.next, note: allLogged ? `${selfLogged} of ${allLogged} logged by you` : null },
      { category: 'attendance', label: 'Gym visits', current: am.total, next: am.next, note: null },
    ],
    rules: {
      workoutMilestones: WORKOUT_MILESTONES,
      attendanceMilestones: ATTENDANCE_MILESTONES,
      personalBest: 'A lift heavier than every earlier record for the same exercise.',
      competitions: 'Completed and verified by a trainer, or a certificate was issued.',
      courses: 'A course certificate was issued by staff.',
    },
  };
}
