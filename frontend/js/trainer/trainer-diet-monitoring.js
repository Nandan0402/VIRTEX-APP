/** Virtex Trainer Hub — trainer-diet-monitoring.html: member nutrition monitoring. */
import { api } from './trainer-api.js';
import { initShell, esc, dash, fmtDate, emptyState, renderPager, clientPage, avg, statTile, num } from './trainer-navigation.js';

const shell = await initShell({ page: 'diet-monitoring', title: 'Diet Monitoring', subtitle: 'Daily nutrition logs from your clients' });

if (shell) {
  let page = 1;
  let lastKey = null;
  const ctl = await clientPage(shell.content, {
    page: 'diet-monitoring', dates: true,
    render: async (body, memberId, range) => {
      { const key = `${memberId}|${range.from || ""}|${range.to || ""}`; if (key !== lastKey) { page = 1; lastKey = key; } }
      const [res, detail] = await Promise.all([
        api.get(`/clients/${encodeURIComponent(memberId)}/diet-logs`, { ...range, page, limit: 15 }),
        api.get(`/clients/${encodeURIComponent(memberId)}`).then((r) => r.data),
      ]);
      const plan = detail.dietAssignments.find((d) => d.status === 'active');
      const planLine = plan
        ? `<div class="tp-diet-plan">Active plan: <b>${esc(plan.plan_name)}</b> · target ${dash(plan.target_calories, ' kcal')}/day</div>`
        : '<div class="tp-diet-plan tp-muted">No active diet plan assigned to this client.</div>';
      if (!res.data.length) { body.innerHTML = planLine + emptyState('No nutrition logs', 'Daily logs appear here when the client records their meals.'); return; }
      const avgKcal = avg(res.data, 'total_calories');
      const target = plan?.target_calories ? Number(plan.target_calories) : null;
      const vsTarget = avgKcal !== null && target ? `${avgKcal >= target ? '+' : ''}${Math.round(avgKcal - target)} kcal vs target` : 'No calorie target';
      body.innerHTML = `${planLine}
        <div class="tp-grid">${statTile('Days logged', String(res.pagination.total), 'In the selected range')}
          ${statTile('Avg calories', num(avgKcal, 0, ' kcal'), vsTarget)}
          ${statTile('Avg adherence', num(avg(res.data, 'adherence_score'), 0, '%'), 'Records on this page')}
          ${statTile('Avg water', num(avg(res.data, 'water_intake_ml'), 0, ' ml'), 'Records on this page')}</div>
        <div class="card"><div class="table-responsive"><table class="admin-table"><thead><tr>
        <th>Date</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fats</th><th>Water</th><th>Adherence</th><th>Meals</th></tr></thead><tbody>
        ${res.data.map((n) => `<tr><td>${fmtDate(n.log_date)}</td><td>${dash(n.total_calories, ' kcal')}</td><td>${dash(n.total_protein_g, 'g')}</td>
          <td>${dash(n.total_carbs_g, 'g')}</td><td>${dash(n.total_fats_g, 'g')}</td><td>${dash(n.water_intake_ml, ' ml')}</td>
          <td>${dash(n.adherence_score, '%')}</td>
          <td>${n.meals.length ? n.meals.map((m) => `<div class="tp-muted">${esc(m.mealType)}: ${esc(m.food)} ${m.portion ? `(${esc(m.portion)})` : ''} · ${dash(m.calories)} kcal</div>`).join('') : '—'}
            ${n.notes ? `<div class="tp-muted tp-note">${esc(n.notes)}</div>` : ''}</td></tr>`).join('')}
        </tbody></table></div><div class="tp-pager" id="pg"></div></div>`;
      renderPager(body.querySelector('#pg'), res.pagination, (p) => { page = p; ctl.rerun(); });
    },
  });
}
