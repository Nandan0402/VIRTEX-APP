/** Virtex Trainer Hub — trainer-client-profile.html page logic. */
import { api } from './trainer-api.js';
import { createMusclePanel } from '../components/musclePanel.js';
import { initShell, esc, dash, fmtDate, fmtDateTime, fmtMoney, badge, emptyState, renderError, clientSelect, qp, pageHref, toast } from './trainer-navigation.js';

const shell = await initShell({ page: 'client-profile', title: 'Client Profile', subtitle: 'Assignment, plans, progress and muscle recovery' });

if (shell) {
  const { content } = shell;
  content.innerHTML = `
    <div class="tp-toolbar"><select class="select-filter tp-client-select" id="client"></select></div>
    <div id="body"></div>`;
  const sel = content.querySelector('#client');
  const body = content.querySelector('#body');

  const card = (title, inner, extra = '') => `<div class="card"><div class="card-header tp-card-head">
    <h3 class="tp-card-title">${esc(title)}</h3>${extra}</div>${inner}</div>`;

  async function load(memberId) {
    if (!memberId) { body.innerHTML = emptyState('Select a client', 'Choose one of your clients to view their profile.'); return; }
    history.replaceState(null, '', pageHref('trainer-client-profile.html', { memberId }));
    body.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
    try {
      const d = (await api.get(`/clients/${encodeURIComponent(memberId)}`)).data;
      const m = d.member || {};
      const current = d.assignments.find((a) => a.status === 'active' || a.status === 'paused');
      const active = d.assignments.some((a) => a.status === 'active');
      const perf = d.performanceProfile;
      const meas = d.latestMeasurement;

      const assignments = d.assignments.length ? `<table class="admin-table"><thead><tr><th>Status</th><th>Period</th><th>Sessions/wk</th><th>Slot</th><th>Goal</th><th>Fee</th></tr></thead><tbody>
        ${d.assignments.map((a) => `<tr><td>${badge(a.status)}</td><td>${fmtDate(a.start_date)} → ${a.end_date ? fmtDate(a.end_date) : 'ongoing'}</td>
          <td>${dash(a.sessions_per_week)}</td><td>${dash(a.preferred_slot)}</td><td>${dash(a.training_goal)}</td>
          <td>${fmtMoney(a.monthly_fee)}<div class="tp-muted">due ${fmtMoney(a.fee_due)} · ${dash(a.payment_status)}</div></td></tr>`).join('')}</tbody></table>` : emptyState('No assignments');

      const wk = d.workoutAssignments.length ? `<div class="tp-list">${d.workoutAssignments.map((w) => `<div class="tp-row"><div class="tp-row-main">
          <div class="tp-row-title">${esc(w.program_name)}</div><div class="tp-row-sub">${dash(w.goal)} · ${dash(w.split_type)} · from ${fmtDate(w.start_date)}</div></div>${badge(w.status)}</div>`).join('')}</div>`
        : emptyState('No workout programme assigned');
      const dt = d.dietAssignments.length ? `<div class="tp-list">${d.dietAssignments.map((p) => `<div class="tp-row"><div class="tp-row-main">
          <div class="tp-row-title">${esc(p.plan_name)}</div><div class="tp-row-sub">${dash(p.goal)} · ${dash(p.target_calories, ' kcal')} · from ${fmtDate(p.start_date)}</div></div>${badge(p.status)}</div>`).join('')}</div>`
        : emptyState('No diet plan assigned');

      body.innerHTML = `
        ${current ? `<p class="tp-mt"><a class="btn btn-outline" href="${pageHref('trainer-messages.html', { memberId })}">✉️ Message ${esc(m.full_name || 'client')}</a></p>` : ''}
        <div class="tp-grid-2">
          ${card('Member', `<dl class="tp-kv"><dt>Name</dt><dd>${esc(m.full_name)}</dd><dt>Code</dt><dd>${dash(m.member_code)}</dd>
            <dt>Status</dt><dd>${badge(m.status)}</dd><dt>Plan</dt><dd>${dash(m.plan_name)}</dd><dt>Phone</dt><dd>${dash(m.phone)}</dd>
            <dt>Email</dt><dd>${dash(m.email)}</dd><dt>Language</dt><dd>${dash(m.preferred_language)}</dd>
            <dt>Emergency contact</dt><dd>${dash(m.emergency_contact_name)} ${m.emergency_contact_phone ? `· ${esc(m.emergency_contact_phone)}` : ''}</dd></dl>`,
            current ? badge(current.status) : '<span class="badge badge-dim">past client</span>')}
          ${card('Performance snapshot', perf ? `<dl class="tp-kv"><dt>Goal</dt><dd>${dash(perf.fitness_goal)}</dd>
            <dt>Overall progress</dt><dd>${dash(perf.overall_progress_pct, '%')}</dd><dt>Workout completion</dt><dd>${dash(perf.workout_completion_pct, '%')}</dd>
            <dt>Attendance</dt><dd>${dash(perf.attendance_pct, '%')}</dd><dt>Diet adherence</dt><dd>${dash(perf.diet_adherence_pct, '%')}</dd>
            <dt>Recovery</dt><dd>${dash(perf.recovery_status)}</dd><dt>Latest weight</dt><dd>${meas ? `${dash(meas.weight_kg, ' kg')} (${fmtDate(meas.logged_at)})` : '—'}</dd></dl>`
            : emptyState('No performance profile yet'),
            `<a class="btn btn-outline" href="${pageHref('trainer-performance.html', { memberId })}">Details</a>`)}
        </div>
        ${card('PT assignments with you', `<div class="table-responsive">${assignments}</div>`)}
        <div class="card mr-card" id="mr-trainer-panel" aria-label="Muscle recovery and assigned exercises"></div>
        <div class="tp-grid-2">
          ${card('Workout programmes', wk, `<a class="btn btn-outline" href="${pageHref('trainer-workout-logs.html', { memberId })}">Logs</a>`)}
          ${card('Diet plans', dt, `<a class="btn btn-outline" href="${pageHref('trainer-diet-plans.html', { memberId })}">Plans</a>`)}
        </div>`;

      // Muscle recovery + per-muscle Assign (trainer-only)
      const myTrainerId = shell.trainer?.id;
      createMusclePanel({
        audience: 'trainer', clientName: m.full_name || 'this client', readOnly: !current, images: false,   // simple: no body images
        load: async () => (await api.get(`/clients/${encodeURIComponent(memberId)}/muscle-recovery`)).data,
        options: async (muscle) => (await api.get('/muscle-plan/options', { muscle })).data,
        assign: (b) => api.post(`/clients/${encodeURIComponent(memberId)}/muscle-plan`, b),
        remove: (id) => api.del(`/clients/${encodeURIComponent(memberId)}/muscle-plan/${encodeURIComponent(id)}`),
        check: (id, completed) => api.put(`/clients/${encodeURIComponent(memberId)}/muscle-plan/${encodeURIComponent(id)}/check`, { completed }),
        canRemove: (p) => !!current && p.coachPlan === true && Number(p.trainerId) === Number(myTrainerId),
      }).mount(body.querySelector('#mr-trainer-panel'));

    } catch (err) { renderError(body, err, 'Client profile'); }
  }

  try {
    await clientSelect(sel, { selected: qp('memberId') });
    sel.addEventListener('change', () => load(sel.value));
    load(sel.value || qp('memberId'));
  } catch (err) { renderError(body, err, 'Clients'); }
}
