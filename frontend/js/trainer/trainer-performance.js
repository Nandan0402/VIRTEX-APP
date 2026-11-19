/** Virtex Trainer Hub — trainer-performance.html: strength and fitness analytics. */
import { api } from './trainer-api.js';
import { initShell, esc, dash, fmtDate, emptyState, notAvailable, clientPage, statTile, num } from './trainer-navigation.js';

const shell = await initShell({ page: 'performance', title: 'Performance', subtitle: 'Progress, strength and benchmarks for your clients' });

const card = (title, inner) => `<div class="card"><h3 class="tp-card-title">${esc(title)}</h3>${inner}</div>`;
/** Percentage tile with a progress meter. */
const pct = (label, v) => {
  const n = v === null || v === undefined ? null : Math.max(0, Math.min(100, Number(v)));
  return `<div class="tp-stat"><div class="tp-stat-label">${esc(label)}</div><div class="tp-stat-value">${n === null ? '—' : `${n.toFixed(0)}%`}</div>
    <div class="tp-meter" role="meter" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n ?? 0}"><span style="width:${n ?? 0}%"></span></div></div>`;
};

/** Per-exercise strength trend from member_strength_logs (newest first from the API). */
function strengthAnalytics(logs) {
  const byEx = new Map();
  logs.forEach((l) => byEx.set(l.exercise_name, [...(byEx.get(l.exercise_name) || []), l]));
  return [...byEx.entries()].map(([name, rows]) => {
    const orm = (r) => Number(r.estimated_one_rep_max ?? r.weight_kg) || 0;
    const latest = rows[0];
    const first = rows[rows.length - 1];
    const best = rows.reduce((a, r) => (orm(r) > orm(a) ? r : a), rows[0]);
    const change = rows.length > 1 && orm(first) > 0 ? ((orm(latest) - orm(first)) / orm(first)) * 100 : null;
    return { name, entries: rows.length, latest, best, change, orm };
  }).sort((a, b) => b.entries - a.entries);
}

if (shell) {
  await clientPage(shell.content, {
    page: 'performance',
    render: async (body, memberId) => {
      const d = (await api.get(`/clients/${encodeURIComponent(memberId)}/progress`)).data;
      const p = d.performanceProfile;
      const profile = p ? `<div class="tp-grid">${pct('Overall progress', p.overall_progress_pct)}${pct('Workout completion', p.workout_completion_pct)}
          ${pct('Attendance', p.attendance_pct)}${pct('Diet adherence', p.diet_adherence_pct)}</div>
          <dl class="tp-kv tp-mt"><dt>Goal</dt><dd>${dash(p.fitness_goal)}</dd><dt>Progress status</dt><dd>${dash(p.progress_status)}</dd>
          <dt>Recovery</dt><dd>${dash(p.recovery_status)}</dd><dt>Updated</dt><dd>${fmtDate(p.last_updated_at)}</dd></dl>`
        : emptyState('No performance profile yet');

      const pbs = d.personalBests?.length ? `<div class="table-responsive"><table class="admin-table"><thead><tr><th>Exercise</th><th>Best</th><th>Date</th></tr></thead><tbody>
          ${d.personalBests.map((b) => `<tr><td>${esc(b.exercise_name)}</td><td>${dash(b.max_weight_kg, ' kg')}</td><td>${fmtDate(b.date_achieved)}</td></tr>`).join('')}
          </tbody></table></div>` : emptyState('No personal bests recorded');

      const trend = strengthAnalytics(d.strengthLogs);
      const strength = trend.length ? `<div class="table-responsive"><table class="admin-table tp-strength"><thead><tr><th>Exercise</th><th>Entries</th><th>Latest est. 1RM</th><th>Best est. 1RM</th><th>Change</th></tr></thead><tbody>
          ${trend.map((t) => `<tr><td class="tp-strong">${esc(t.name)}</td><td>${t.entries}</td>
            <td>${num(t.orm(t.latest), 1, ' kg')}<div class="tp-muted">${dash(t.latest.weight_kg, ' kg')} × ${dash(t.latest.reps)} · ${fmtDate(t.latest.logged_at)}</div></td>
            <td>${num(t.orm(t.best), 1, ' kg')}<div class="tp-muted">${fmtDate(t.best.logged_at)}</div></td>
            <td>${t.change === null ? '<span class="tp-muted">needs 2+ entries</span>' : `<span class="tp-trend ${t.change >= 0 ? 'up' : 'down'}">${t.change >= 0 ? '▲' : '▼'} ${Math.abs(t.change).toFixed(1)}%</span>`}</td></tr>`).join('')}
          </tbody></table></div><div class="tp-muted tp-mt">Based on the client's last ${d.strengthLogs.length} strength log${d.strengthLogs.length === 1 ? '' : 's'}. Change compares the oldest and newest entry per exercise.</div>`
        : emptyState('No strength logs', 'Strength entries appear here when the client logs lifts.');
      const bm = d.bodyMeasurements;
      const bodyDelta = bm.length > 1 && bm[0].weight_kg !== null && bm[bm.length - 1].weight_kg !== null
        ? Number(bm[0].weight_kg) - Number(bm[bm.length - 1].weight_kg) : null;

      const cardio = d.cardioBenchmarks === null ? notAvailable('Cardio benchmarks')
        : d.cardioBenchmarks.length ? `<div class="table-responsive"><table class="admin-table"><thead><tr><th>Date</th><th>Test</th><th>Result</th><th>Avg HR</th></tr></thead><tbody>
          ${d.cardioBenchmarks.map((c) => `<tr><td>${fmtDate(c.recorded_at)}</td><td>${esc(c.test_name || c.test_type)}</td><td>${dash(c.result_value)} ${esc(c.result_unit || '')}</td><td>${dash(c.avg_heart_rate)}</td></tr>`).join('')}
          </tbody></table></div>` : emptyState('No cardio benchmarks');

      const history = d.progressHistory === null ? notAvailable('Progress history')
        : d.progressHistory.length ? `<div class="table-responsive"><table class="admin-table"><thead><tr><th>Week</th><th>Overall</th><th>Workouts</th><th>Attendance</th><th>Diet</th><th>Weight</th></tr></thead><tbody>
          ${d.progressHistory.map((h) => `<tr><td>${fmtDate(h.snapshot_date)}</td><td>${dash(h.overall_progress_pct, '%')}</td><td>${dash(h.workout_completion_pct, '%')}</td><td>${dash(h.attendance_pct, '%')}</td><td>${dash(h.diet_adherence_pct, '%')}</td><td>${dash(h.weight_kg, ' kg')}</td></tr>`).join('')}
          </tbody></table></div>` : emptyState('No progress snapshots yet');

      const summary = `<div class="tp-grid">
        ${statTile('Exercises tracked', String(trend.length), `${d.strengthLogs.length} strength entries`)}
        ${statTile('Personal bests', String(d.personalBests?.length || 0), 'From workout and strength logs')}
        ${statTile('Body weight', bm.length ? num(bm[0].weight_kg, 1, ' kg') : '—', bodyDelta === null ? 'Needs 2+ measurements' : `${bodyDelta >= 0 ? '+' : ''}${bodyDelta.toFixed(1)} kg since ${fmtDate(bm[bm.length - 1].logged_at)}`)}
        ${statTile('Recovery status', esc(p?.recovery_status || '—'), p?.last_updated_at ? `Profile updated ${fmtDate(p.last_updated_at)}` : 'No performance profile yet')}
      </div>`;
      body.innerHTML = `${summary}${card('Performance profile', profile)}
        ${card('Strength analytics', strength)}
        ${card('Personal bests', pbs)}
        <div class="tp-grid-2">${card('Cardio benchmarks', cardio)}${card('Progress history', history)}</div>`;
      body.classList.add('tp-stack');
    },
  });
}
