/** Virtex Member Portal — member-progress.html: My Progress.
 *  Uses: GET /api/v1/member/progress → data.report (calculated server-side from the member's own
 *  workout logs, strength logs, body measurements, cardio benchmarks and check-ins).
 *  Nothing on this page is estimated in the browser: figures the server marks `notEnoughData`
 *  are shown as "Not Enough Data", never as 0 or a default percentage.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';
import { lineChart, barChart, wireCharts, NED } from './member-charts.js';

const shell = await initShell({ page: 'progress', title: 'My Progress', subtitle: 'Your progress, strength and body composition' });

// ------------------------------------------------------------------ formatting
const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const f1 = (v) => (n(v) === null ? '—' : (Math.round(n(v) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const signed = (v, unit = '') => (n(v) === null ? '—' : `${n(v) > 0 ? '+' : n(v) < 0 ? '−' : '±'}${f1(Math.abs(n(v)))}${unit}`);
const toDate = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d));
const dShort = (d) => (d ? toDate(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');
const dLong = (d) => (d ? toDate(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const month = (d) => toDate(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const trendChip = (t) => (t === 'improving' ? '<span class="pg-chip up">▲ Improving</span>'
  : t === 'declining' ? '<span class="pg-chip down">▼ Declining</span>'
    : t === 'steady' ? '<span class="pg-chip">● Steady</span>' : '');
const card = (title, body, extra = '') => `<section class="mp-card pg-card ${extra}"><h2 class="pg-h">${title}</h2>${body}</section>`;

// ------------------------------------------------------------------ sections
function overallSection(o) {
  if (o.notEnoughData) {
    return card('Overall fitness progress', `${NED(o.reason)}
      <p class="pg-muted">Progress appears here once you log workouts, strength sets or body measurements.
      <a href="member-workout-logs.html">Log a workout</a> · <a href="member-measurements.html">Add a measurement</a></p>`);
  }
  const body = (i) => {
    if (i.notEnoughData) return NED(i.reason);
    if (i.key === 'strength') return `<b>${i.improved} of ${i.exercisesMeasured}</b><span>exercises stronger than when you started</span>`;
    if (i.key === 'consistency') return `<b>${i.last28Days} workouts</b><span>last 28 days${i.previous28Days !== null ? ` · ${i.previous28Days} in the 28 days before` : ''}</span>${i.note ? `<small>${esc(i.note)}</small>` : ''}`;
    if (i.key === 'weight') return `<b>${signed(i.changeKg, ' kg')}</b><span>since ${esc(dLong(i.since))}</span><small>${esc(i.note)}</small>`;
    if (i.key === 'cardio') return `<b>${i.testsMeasured} test${i.testsMeasured === 1 ? '' : 's'}</b><span>with repeat results</span><small>${esc(i.note)}</small>`;
    return '';
  };
  return card('Overall fitness progress', `
    <p class="pg-muted">Each area is measured separately from your own records — Virtex does not merge them into a single score.
      ${o.measuredIndicators} of ${o.indicators.length} areas have enough data.</p>
    <div class="pg-ind-grid">
      ${o.indicators.map((i) => `<div class="pg-ind${i.notEnoughData ? ' is-ned' : ''}"><div class="pg-ind-top"><span>${esc(i.label)}</span>${trendChip(i.trend)}</div><div class="pg-ind-body">${body(i)}</div></div>`).join('')}
    </div>`);
}

function goalSection(g) {
  if (g.notEnoughData) return card('Fitness goal', `${NED(g.reason)}<p class="pg-muted">Ask your trainer to record your goal, or set one when you book a PT plan.</p>`);
  const rows = [
    g.fitnessGoal && ['Fitness goal', g.fitnessGoal, `Recorded by staff${g.updatedAt ? ` · updated ${dLong(g.updatedAt)}` : ''}`],
    g.ptGoal && ['Personal training goal', g.ptGoal, g.ptTrainer ? `With ${g.ptTrainer}` : ''],
    g.programmeGoal && ['Programme goal', g.programmeGoal, g.programName || ''],
  ].filter(Boolean);
  return card('Fitness goal', `<dl class="pg-goals">${rows.map(([k, v, s]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${s ? `<small>${esc(s)}</small>` : ''}</dd></div>`).join('')}</dl>
    ${g.progressStatus ? `<p class="pg-muted">Status noted by your trainer: <b>${esc(String(g.progressStatus).replace(/_/g, ' '))}</b></p>` : ''}
    ${g.trainerNotes ? `<blockquote class="pg-note">${esc(g.trainerNotes)}</blockquote>` : ''}`);
}

function completionSection(c, weekly) {
  if (c.notEnoughData && !c.plannedPerWeek) {
    return card('Workout completion', `${NED(c.reason)}<p class="pg-muted">Completion is measured against an assigned programme. <a href="member-workouts.html">My workouts</a></p>`);
  }
  const tw = c.thisWeek;
  const head = `<div class="pg-stats">
      <div><span>This week so far</span><b>${tw ? `${tw.completed} / ${tw.planned}` : '—'}</b><small>sessions</small></div>
      <div><span>Last ${c.lastWeeks || 4} full weeks</span>${c.notEnoughData ? `<b class="pg-ned-inline">Not Enough Data</b><small>${esc(c.reason)}</small>`
        : `<b>${c.pctLastWeeks}%</b><small>${c.completedLastWeeks} of ${c.plannedLastWeeks} planned sessions</small>`}</div>
    </div>
    <p class="pg-muted">${esc(c.programName)} — ${esc(c.basis)}</p>`;
  const items = weekly.slice().reverse().map((w) => ({
    label: dShort(w.start), v: w.programmeCompletion ? w.programmeCompletion.completed : w.sessions,
    planned: w.programmeCompletion ? w.programmeCompletion.planned : null, current: w.isCurrent,
    title: `Week of ${dLong(w.start)}: ${w.sessions} session(s)${w.programmeCompletion ? ` · ${w.programmeCompletion.completed}/${w.programmeCompletion.planned} programme` : ''}`,
  }));
  return card('Workout completion', head + barChart(items, { label: 'Programme sessions per week, last 8 weeks', unit: 'Programme sessions completed' }));
}

function strengthSection(s, selected) {
  if (s.notEnoughData) return card('Strength progression', `${NED(s.reason)}<p class="pg-muted">Log weights in your workouts to track strength. <a href="member-workout-logs.html">Workout log</a></p>`);
  const ex = s.exercises.find((e) => e.exercise === selected) || s.exercises[0];
  return card('Strength progression', `
    <p class="pg-muted">Estimated one-rep max (1RM) from your best set each session: the weight you lifted × (1 + reps ÷ 30).</p>
    <label class="pg-select">Exercise
      <select id="pg-ex">${s.exercises.map((e) => `<option${e.exercise === ex.exercise ? ' selected' : ''}>${esc(e.exercise)}</option>`).join('')}</select></label>
    <div class="pg-stats">
      <div><span>First recorded</span><b>${ex.notEnoughData ? '—' : `${f1(ex.firstE1rmKg)} kg`}</b><small>${esc(dLong(ex.firstDate))}</small></div>
      <div><span>Latest</span><b>${ex.notEnoughData ? '—' : `${f1(ex.latestE1rmKg)} kg`}</b><small>${esc(dLong(ex.latestDate))}</small></div>
      <div><span>Change</span>${ex.notEnoughData ? '<b class="pg-ned-inline">Not Enough Data</b>' : `<b class="${ex.changeKg > 0 ? 'pos' : ex.changeKg < 0 ? 'neg' : ''}">${signed(ex.changeKg, ' kg')}</b><small>${signed(ex.changePct, '%')}</small>`}</div>
    </div>
    ${ex.notEnoughData ? NED(ex.reason) : lineChart(ex.series.map((p) => ({ t: p.date, v: p.e1rmKg })), { unit: 'kg', label: `${ex.exercise} estimated 1RM`, id: 'strength' })}
    <div class="pg-scroll"><table class="admin-table pg-tbl"><thead><tr><th>Exercise</th><th>Entries</th><th>First → latest (est. 1RM)</th><th>Change</th></tr></thead><tbody>
      ${s.exercises.map((e) => `<tr><td>${esc(e.exercise)}</td><td>${e.dataPoints}</td>
        <td>${e.notEnoughData ? '<span class="pg-ned-badge sm">Not Enough Data</span>' : `${f1(e.firstE1rmKg)} → ${f1(e.latestE1rmKg)} kg`}</td>
        <td>${e.notEnoughData ? '—' : `<span class="${e.changeKg > 0 ? 'pos' : e.changeKg < 0 ? 'neg' : ''}">${signed(e.changeKg, ' kg')} (${signed(e.changePct, '%')})</span>`}</td></tr>`).join('')}
    </tbody></table></div>`);
}

function cardioSection(c) {
  if (c.notEnoughData) return card('Cardio benchmarks', `${NED(c.reason)}${c.available ? '<p class="pg-muted">Your trainer records benchmark tests such as timed runs or rows.</p>' : ''}`);
  return card('Cardio benchmarks', `<p class="pg-muted">Results recorded by your trainer. For timed tests a lower number is better; for distance, higher is better.</p>
    <div class="pg-scroll"><table class="admin-table pg-tbl"><thead><tr><th>Test</th><th>Results</th><th>Latest</th><th>Change since first</th></tr></thead><tbody>
    ${c.tests.map((t) => `<tr><td>${esc(t.test)}${t.type ? `<small class="pg-sub">${esc(t.type)}</small>` : ''}</td><td>${t.results}</td>
      <td>${f1(t.latest.value)} ${esc(t.unit || '')}<small class="pg-sub">${esc(dLong(t.latest.date))}</small></td>
      <td>${t.notEnoughData ? '<span class="pg-ned-badge sm">Not Enough Data</span>' : `${signed(t.change, ` ${t.unit || ''}`)} (${signed(t.changePct, '%')})`}</td></tr>`).join('')}
    </tbody></table></div>`);
}

function weightSection(w) {
  if (!w.series || !w.series.length) return card('Weight history', `${NED(w.reason)}<p class="pg-muted"><a href="member-measurements.html">Add a measurement</a></p>`);
  const stats = `<div class="pg-stats">
    <div><span>Latest</span><b>${f1(w.latest.weightKg)} kg</b><small>${esc(dLong(w.latest.date))}</small></div>
    <div><span>Since first weigh-in</span>${w.notEnoughData ? '<b class="pg-ned-inline">Not Enough Data</b>' : `<b>${signed(w.changeKg, ' kg')}</b><small>from ${f1(w.first.weightKg)} kg on ${esc(dLong(w.first.date))}</small>`}</div>
    <div><span>Last ~30 days</span>${!w.change30d || w.change30d.notEnoughData ? `<b class="pg-ned-inline">Not Enough Data</b><small>${esc(w.change30d?.reason || '')}</small>` : `<b>${signed(w.change30d.changeKg, ' kg')}</b><small>since ${esc(dLong(w.change30d.fromDate))}</small>`}</div>
  </div>`;
  return card('Weight history', stats + (w.notEnoughData ? NED(w.reason) : lineChart(w.series.map((p) => ({ t: p.date, v: p.weightKg })), { unit: 'kg', label: 'Body weight', id: 'weight' })));
}

function pbSection(list) {
  if (!list.length) return card('Personal bests', NED('No weighted sets logged yet.'));
  return card('Personal bests', `<p class="pg-muted">Heaviest weight you have recorded for each exercise, dated the first time you lifted it.</p>
    <div class="pg-scroll"><table class="admin-table pg-tbl"><thead><tr><th>Exercise</th><th>Heaviest</th><th>Achieved</th><th>Best est. 1RM</th></tr></thead><tbody>
    ${list.map((p) => `<tr><td>${esc(p.exercise)}</td><td><b>${f1(p.heaviestKg)} kg</b>${n(p.repsAtHeaviest) !== null ? ` × ${p.repsAtHeaviest}` : ''}</td>
      <td>${esc(dLong(p.achievedAt))}</td><td>${f1(p.bestE1rmKg)} kg</td></tr>`).join('')}
    </tbody></table></div>`);
}

function reportTable(rows, { kind }) {
  const any = rows.some((r) => r.sessions || r.checkIns || r.weighIns || r.newPersonalBests);
  if (!any) return NED(`Nothing recorded in these ${kind === 'week' ? 'weeks' : 'months'} yet.`);
  const cell = (v, unit = '') => (n(v) === null ? '<span class="pg-missing" title="Not recorded">—</span>' : `${f1(v)}${unit}`);
  return `<div class="pg-scroll"><table class="admin-table pg-tbl pg-report"><thead><tr>
      <th>${kind === 'week' ? 'Week of' : 'Month'}</th><th>Workouts</th>${kind === 'week' ? '<th>Programme</th>' : ''}<th>Minutes</th><th>Volume (kg)</th><th>Gym visits</th><th>New PBs</th><th>Avg weight</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="${r.isCurrent ? 'is-current' : ''}">
      <td>${esc(kind === 'week' ? dLong(r.start) : month(r.start))}${r.isCurrent ? ' <small class="pg-sub">so far</small>' : ''}</td>
      <td>${r.sessions}</td>
      ${kind === 'week' ? `<td>${r.programmeCompletion ? `${r.programmeCompletion.completed} / ${r.programmeCompletion.planned}` : '<span class="pg-missing" title="No programme assigned this week">—</span>'}</td>` : ''}
      <td>${cell(r.minutes)}</td><td>${cell(r.volumeKg)}</td><td>${r.checkIns}</td><td>${r.newPersonalBests}</td>
      <td>${r.avgWeightKg === null ? '<span class="pg-missing" title="No weigh-in">—</span>' : `${f1(r.avgWeightKg)} kg`}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// ------------------------------------------------------------------ page
if (shell) {
  const { content } = shell;
  let report = null;
  let selectedEx = null;

  const render = () => {
    const r = report;
    content.innerHTML = `<div class="pg-wrap">
      ${!r.hasData ? notice('No progress data yet', 'Log a workout or add a body measurement and your progress will start appearing here. Every section below will fill in from your own records.') : ''}
      ${overallSection(r.overall)}
      <div class="pg-two">${goalSection(r.goal)}${completionSection(r.workoutCompletion, r.weeklyReports)}</div>
      ${strengthSection(r.strength, selectedEx)}
      <div class="pg-two">${weightSection(r.weight)}${cardioSection(r.cardio)}</div>
      ${pbSection(r.personalBests)}
      ${card('Weekly reports', `<p class="pg-muted">Last 8 weeks (Monday to Sunday). “—” means nothing was recorded, which is different from 0.</p>${reportTable(r.weeklyReports, { kind: 'week' })}`)}
      ${card('Monthly reports', reportTable(r.monthlyReports, { kind: 'month' }))}
      <p class="pg-foot">Based on ${r.dataCoverage.workoutSessions} logged workouts, ${r.dataCoverage.strengthEntries} strength entries, ${r.dataCoverage.weighIns} weigh-ins${r.dataCoverage.cardioResults === null ? '' : `, ${r.dataCoverage.cardioResults} cardio results`} and ${r.dataCoverage.checkIns} gym visits in the last year.
        ${r.trainerReview?.assigned
    ? `Your trainer${r.trainerReview.trainerName ? `, ${esc(r.trainerReview.trainerName)},` : ''} can review this same report in Trainer Hub.`
    : 'You have no assigned personal trainer, so no trainer is reviewing this report.'}</p>
    </div>`;
    wireCharts(content);
    content.querySelector('#pg-ex')?.addEventListener('change', (e) => { selectedEx = e.target.value; render(); content.querySelector('#pg-ex')?.focus(); });
  };

  content.innerHTML = '<div class="mp-loading">Loading your progress…</div>';
  try {
    const res = await api.get('/progress');
    report = res.data?.report || null;
    if (!report) throw new ApiError(500, 'The progress report is not available.');
    render();
  } catch (err) {
    content.innerHTML = notice('Could not load your progress', err instanceof ApiError ? err.message : 'Network error — please try again.', { error: true });
  }
}
