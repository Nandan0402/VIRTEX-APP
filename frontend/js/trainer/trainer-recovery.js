/** Virtex Trainer Hub — trainer-recovery.html: recovery assessments. */
import { api } from './trainer-api.js';
import { initShell, esc, dash, fmtDate, badge, emptyState, renderPager, clientPage, avg, statTile, num, pageHref } from './trainer-navigation.js';

// Member's own answers (migration 022). Shown as reported — not a diagnosis, not calculated.
const SELF = { fully_recovered: 'Fully recovered', mostly_recovered: 'Mostly recovered', partly_recovered: 'Partly recovered', not_recovered: 'Not recovered' };

const shell = await initShell({ page: 'recovery', title: 'Recovery', subtitle: 'Sleep, readiness and soreness check-ins from your clients' });

if (shell) {
  let page = 1;
  let lastKey = null;
  const ctl = await clientPage(shell.content, {
    page: 'recovery', dates: true,
    render: async (body, memberId, range) => {
      { const key = `${memberId}|${range.from || ""}|${range.to || ""}`; if (key !== lastKey) { page = 1; lastKey = key; } }
      const res = await api.get(`/clients/${encodeURIComponent(memberId)}/recovery`, { ...range, page, limit: 15 });
      if (!res.data.length) { body.innerHTML = emptyState('No recovery check-ins', 'Check-ins appear here when the client logs their recovery.'); return; }
      const latest = res.data[0];
      const needs = res.data.filter((r) => r.readiness_status === 'Needs Recovery').length;
      body.innerHTML = `<div class="tp-grid">
          ${statTile('Latest readiness', `${num(latest.readiness_score)} ${badge(latest.readiness_status)}`, fmtDate(latest.log_date).replace(/<[^>]*>/g, ''))}
          ${statTile('Avg readiness', num(avg(res.data, 'readiness_score')), `${res.data.length} check-in${res.data.length === 1 ? '' : 's'} shown`)}
          ${statTile('Avg sleep', num(avg(res.data, 'sleep_hours'), 1, ' h'), `quality ${num(avg(res.data, 'sleep_quality'), 1)}/10`)}
          ${statTile('Needs recovery', String(needs), 'Check-ins flagged on this page')}
        </div>
        <div class="card"><div class="table-responsive"><table class="admin-table"><thead><tr>
        <th>Date</th><th>Readiness</th><th>Sleep</th><th>Energy / Stress</th><th>Hydration</th><th>Soreness</th><th>Recommendation</th></tr></thead><tbody>
        ${res.data.map((r) => `<tr><td>${fmtDate(r.log_date)}${r.is_rest_day ? `<div class="tp-muted">rest day${r.rest_day_activity ? `: ${esc(r.rest_day_activity)}` : ''}</div>` : ''}</td>
          <td>${r.readiness_score == null && (r.self_assessment || r.fatigue_level != null)
            ? `<div>Self-assessed: <b>${esc(SELF[r.self_assessment] || '—')}</b></div><div class="tp-muted">reported fatigue ${dash(r.fatigue_level)}/10</div>`
            : `${dash(r.readiness_score)} ${badge(r.readiness_status)}<div class="tp-muted">fatigue ${dash(r.fatigue_index)}</div>`}</td>
          <td>${dash(r.sleep_hours, ' h')}<div class="tp-muted">quality ${dash(r.sleep_quality)}/10</div></td>
          <td>${dash(r.energy_level)}/10 · ${dash(r.stress_level)}/10</td><td>${dash(r.hydration_liters, ' L')}</td>
          <td>overall ${dash(r.overall_soreness_rating)}/10${r.soreness.map((s) => `<div class="tp-muted">${esc(s.muscleGroup)}: ${dash(s.level)}</div>`).join('')}</td>
          <td>${dash(r.recommended_action)}${r.user_notes ? `<div class="tp-muted tp-note">${esc(r.user_notes)}</div>` : ''}</td></tr>`).join('')}
        </tbody></table></div><div class="tp-pager" id="pg"></div>
        <p class="tp-muted" style="margin-top:0.6rem;"><a href="${pageHref('trainer-client-profile.html', { memberId })}">Give recovery coaching feedback →</a> (choose type “recovery”; the member sees it on their Recovery page)</p></div>`;
      renderPager(body.querySelector('#pg'), res.pagination, (p) => { page = p; ctl.rerun(); });
    },
  });
}
