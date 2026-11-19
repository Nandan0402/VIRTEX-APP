/** Virtex Trainer Hub — trainer-measurements.html page logic. */
import { api } from './trainer-api.js';
import { initShell, dash, fmtDate, emptyState, clientPage } from './trainer-navigation.js';

const shell = await initShell({ page: 'measurements', title: 'Measurements', subtitle: 'Body composition history (members record their own measurements)' });

if (shell) {
  await clientPage(shell.content, {
    page: 'measurements',
    render: async (body, memberId) => {
      const rows = (await api.get(`/clients/${encodeURIComponent(memberId)}/progress`)).data.bodyMeasurements || [];
      if (!rows.length) { body.innerHTML = emptyState('No measurements recorded', 'Measurements appear here when the client records them.'); return; }
      const first = rows[rows.length - 1];
      const last = rows[0];
      const delta = (k, unit) => {
        if (last[k] === null || first[k] === null || last[k] === undefined || rows.length < 2) return '';
        const v = Number(last[k]) - Number(first[k]);
        return `<div class="tp-stat-sub">${v >= 0 ? '+' : ''}${v.toFixed(1)}${unit} since ${fmtDate(first.logged_at)}</div>`;
      };
      const stat = (label, k, unit) => `<div class="tp-stat"><div class="tp-stat-label">${label}</div><div class="tp-stat-value">${dash(last[k], unit)}</div>${delta(k, unit)}</div>`;
      body.innerHTML = `<div class="tp-grid">${stat('Weight', 'weight_kg', ' kg')}${stat('Body fat', 'body_fat_pct', '%')}${stat('Muscle mass', 'muscle_mass_kg', ' kg')}${stat('BMI', 'bmi', '')}</div>
        <div class="card tp-mt-lg"><div class="table-responsive"><table class="admin-table"><thead><tr><th>Date</th><th>Weight</th><th>Body fat</th><th>Muscle</th><th>BMI</th><th>Chest</th><th>Waist</th><th>Hips</th><th>Arms</th><th>Thighs</th></tr></thead><tbody>
        ${rows.map((m) => `<tr><td>${fmtDate(m.logged_at)}</td><td>${dash(m.weight_kg, ' kg')}</td><td>${dash(m.body_fat_pct, '%')}</td><td>${dash(m.muscle_mass_kg, ' kg')}</td><td>${dash(m.bmi)}</td>
          <td>${dash(m.chest_cm, ' cm')}</td><td>${dash(m.waist_cm, ' cm')}</td><td>${dash(m.hips_cm, ' cm')}</td><td>${dash(m.arms_cm, ' cm')}</td><td>${dash(m.thighs_cm, ' cm')}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    },
  });
}
