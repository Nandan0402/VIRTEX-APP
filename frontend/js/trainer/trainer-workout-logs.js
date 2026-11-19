/** Virtex Trainer Hub — trainer-workout-logs.html page logic. */
import { api } from './trainer-api.js';
import { initShell, esc, dash, fmtDateTime, emptyState, renderPager, clientPage } from './trainer-navigation.js';

const shell = await initShell({ page: 'workout-logs', title: 'Workout Logs', subtitle: 'Sessions your clients have logged' });

if (shell) {
  let page = 1;
  let lastKey = null;
  const render = async (body, memberId, range) => {
    { const key = `${memberId}|${range.from || ''}|${range.to || ''}`; if (key !== lastKey) { page = 1; lastKey = key; } }
    const res = await api.get(`/clients/${encodeURIComponent(memberId)}/workout-logs`, { ...range, page, limit: 15 });
    if (!res.data.length) { body.innerHTML = emptyState('No workout sessions logged', 'Sessions appear here when the client logs a workout.'); return; }
    body.innerHTML = `<div class="tp-list">${res.data.map((l) => `<div class="card tp-log-card">
      <div class="tp-log-head">
        <div><div class="tp-row-title">${dash(l.program_name)} · ${dash(l.day_name)}</div>
        <div class="tp-row-sub">${fmtDateTime(l.completed_at)} · ${dash(l.duration_minutes, ' min')} · RPE ${dash(l.rpe_rating)} · volume ${dash(l.total_volume_kg, ' kg')} · logged by ${dash(l.logged_by)}</div></div></div>
      ${l.sets.length ? `<div class="table-responsive tp-mt-sm"><table class="admin-table"><thead><tr><th>Exercise</th><th>Set</th><th>Reps</th><th>Weight</th><th></th></tr></thead><tbody>
        ${l.sets.map((s) => `<tr><td>${esc(s.exercise)}</td><td>${dash(s.set)}</td><td>${dash(s.reps)}</td><td>${dash(s.weightKg, ' kg')}</td><td>${s.isPr ? '<span class="badge badge-yellow">PR</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      ${l.notes ? `<div class="tp-muted tp-pre tp-mt-sm">${esc(l.notes)}</div>` : ''}</div>`).join('')}</div>
      <div class="tp-pager" id="pg"></div>`;
    renderPager(body.querySelector('#pg'), res.pagination, (p) => { page = p; ctl.rerun(); });
  };
  const ctl = await clientPage(shell.content, { page: 'workout-logs', dates: true, render: (b, m, r) => render(b, m, r) });
}
