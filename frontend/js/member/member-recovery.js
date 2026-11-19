/** Virtex Member Portal — member-recovery.html: Recovery & Wellness.
 *  Uses: GET  /api/v1/member/recovery            (own check-ins; `selfReportReady` says if saving is available)
 *        POST /api/v1/member/recovery            (save one day: today … 7 days back)
 *        GET  /api/v1/member/feedback?type=recovery (trainer coaching feedback)
 *        GET  /api/v1/member/muscle-recovery     (estimated recovery % per muscle from own logged workouts)
 *  Check-ins show what the member recorded. The page never shows the old system-generated readiness score
 *  and never gives a diagnosis; the muscle panel is a time-based guide, labelled as such.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';
import { lineChart, wireCharts, NED } from './member-charts.js';
import { createMusclePanel } from '../components/musclePanel.js';

const shell = await initShell({ page: 'recovery', title: 'Recovery & Wellness', subtitle: 'Daily sleep, energy and soreness check-ins' });

const SELF = [
  ['fully_recovered', 'Fully recovered', 'Ready to train as normal'],
  ['mostly_recovered', 'Mostly recovered', 'A little tired or sore'],
  ['partly_recovered', 'Partly recovered', 'Noticeably tired or sore'],
  ['not_recovered', 'Not recovered', 'Need more rest'],
];
const SELF_LABEL = Object.fromEntries(SELF.map(([k, l]) => [k, l]));
const MUSCLES = ['Neck', 'Shoulders', 'Chest', 'Upper back', 'Lower back', 'Biceps', 'Triceps', 'Forearms', 'Abs', 'Glutes', 'Hip flexors', 'Quads', 'Hamstrings', 'Calves', 'Other'];
const REST_ACTIVITIES = ['Complete rest', 'Walking', 'Stretching / mobility', 'Yoga', 'Light cardio', 'Swimming', 'Massage / foam rolling', 'Other'];

const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const f1 = (v) => (n(v) === null ? '—' : (Math.round(n(v) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// log_date arrives either as 'YYYY-MM-DD' or as a timestamp of local midnight serialised in UTC
// (e.g. '2026-11-09T18:30:00.000Z' for 10 Nov in IST) — read timestamps in local time.
const dayOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ymd(new Date(v)));
const addDays = (s, k) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + k); return ymd(d); };
const dLong = (s) => new Date(`${dayOf(s)}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const avgOf = (rows, key) => { const v = rows.map((r) => n(r[key])).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

if (shell) {
  const { content } = shell;
  let rows = []; let ready = false; let feedback = null; let editDate = ymd(); let saving = false;
  const today = ymd(); const oldest = addDays(today, -7);

  async function load() {
    const [rec, fb] = await Promise.all([
      api.get('/recovery', { from: addDays(today, -89), limit: 100 }),
      api.get('/feedback', { type: 'recovery', limit: 5 }).catch(() => null),
    ]);
    rows = rec.data || []; ready = rec.selfReportReady === true; feedback = fb ? fb.data || [] : null;
  }

  // ------------------------------------------------------------------ muscle recovery panel (shared module)
  // Member view: own recovery, assigned exercises (coach + own), and "Assign" to add to "My own plan".
  const musclePanel = createMusclePanel({
    audience: 'member',
    load: async () => (await api.get('/muscle-recovery')).data,
    options: async (muscle) => (await api.get('/my-plan/options', { muscle })).data,
    assign: (body) => api.post('/my-plan', body),
    remove: (id) => api.del(`/my-plan/${encodeURIComponent(id)}`),
    canRemove: (p) => p.own === true,
  });
  const muscleSection = () => '<section class="pg-card" id="mr-panel-mount" aria-label="Muscle recovery"></section>';

  const rowFor = (date) => rows.find((r) => dayOf(r.log_date) === date) || null;

  // ------------------------------------------------------------------ form
  function scale(name, label, min, max, value, lo, hi, required = true) {
    return `<fieldset class="rc-scale"><legend>${esc(label)} ${required ? '<i class="mm-req">required</i>' : '<i>optional</i>'}</legend>
      <div class="rc-scale-row">${Array.from({ length: max - min + 1 }, (_, i) => min + i).map((v) => `<label><input type="radio" name="${name}" value="${v}"${n(value) === v ? ' checked' : ''}><span>${v}</span></label>`).join('')}</div>
      <div class="rc-scale-ends"><span>${esc(lo)}</span><span>${esc(hi)}</span></div></fieldset>`;
  }

  function form() {
    const ex = rowFor(editDate);
    const lockedByStaff = ex && ex.logged_by && ex.logged_by !== 'Member';
    const v = ex && !lockedByStaff ? ex : {};
    const sore = new Map((v.soreness || []).map((s) => [s.muscleGroup, s.level]));
    if (!ready) {
      return `<section class="pg-card"><h2 class="pg-h">Today's check-in</h2>
        ${notice('Check-ins are not available yet', 'Saving recovery check-ins needs a database update that the gym has not applied yet. Nothing you see below has been calculated for you; your past entries are shown as recorded.')}</section>`;
    }
    return `<section class="pg-card"><h2 class="pg-h">${ex && !lockedByStaff ? 'Update check-in' : 'Recovery check-in'}</h2>
      <form id="rc-form" novalidate>
        <div class="rc-top">
          <label class="mm-field"><span>Date <i class="mm-req">required</i></span>
            <input type="date" name="logDate" value="${editDate}" min="${oldest}" max="${today}"></label>
          <label class="mm-field"><span>Sleep duration (hours) <i class="mm-req">required</i></span>
            <input type="number" name="sleepHours" min="0" max="24" step="0.25" inputmode="decimal" value="${v.sleep_hours != null ? esc(f1(v.sleep_hours)) : ''}" placeholder="e.g. 7.5"></label>
        </div>
        ${lockedByStaff ? notice('Recorded by staff', 'A staff member already recorded recovery for this day, so it cannot be changed here. Choose another date or ask your trainer.') : ''}
        ${scale('sleepQuality', 'Sleep quality', 1, 10, v.sleep_quality, '1 = very poor', '10 = excellent')}
        ${scale('fatigueLevel', 'Fatigue', 1, 10, v.fatigue_level, '1 = fresh', '10 = exhausted')}
        ${scale('overallSoreness', 'Overall muscle soreness', 0, 10, v.overall_soreness_rating, '0 = none', '10 = severe')}
        <fieldset class="rc-muscles"><legend>Sore muscle groups <i>optional — tap each one that is sore and rate it 1–10</i></legend>
          <div class="rc-chips">${MUSCLES.map((m) => `<label class="rc-chip${sore.has(m) ? ' on' : ''}"><input type="checkbox" name="mg" value="${esc(m)}"${sore.has(m) ? ' checked' : ''}>
            <span>${esc(m)}</span><select aria-label="${esc(m)} soreness 1 to 10" data-mg="${esc(m)}"${sore.has(m) ? '' : ' hidden'}>
            ${Array.from({ length: 10 }, (_, i) => i + 1).map((k) => `<option${sore.get(m) === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>`).join('')}</div></fieldset>
        <div class="rc-top">
          <label class="rc-check"><input type="checkbox" name="isRestDay"${v.is_rest_day ? ' checked' : ''}> This was a rest day</label>
          <label class="mm-field" id="rc-activity"${v.is_rest_day ? '' : ' hidden'}><span>Rest-day activity <i>optional</i></span>
            <select name="restDayActivity"><option value="">—</option>${REST_ACTIVITIES.map((a) => `<option${v.rest_day_activity === a ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
        </div>
        <fieldset class="rc-self"><legend>How recovered do you feel? <i class="mm-req">required</i></legend>
          ${SELF.map(([k, l, d]) => `<label class="rc-opt"><input type="radio" name="selfAssessment" value="${k}"${v.self_assessment === k ? ' checked' : ''}><span><b>${esc(l)}</b><small>${esc(d)}</small></span></label>`).join('')}</fieldset>
        <details class="rc-more"${v.energy_level != null || v.stress_level != null || v.hydration_liters != null ? ' open' : ''}><summary>More (optional): energy, stress, water</summary>
          ${scale('energyLevel', 'Energy', 1, 10, v.energy_level, '1 = very low', '10 = very high', false)}
          ${scale('stressLevel', 'Stress', 1, 10, v.stress_level, '1 = calm', '10 = very stressed', false)}
          <label class="mm-field rc-water"><span>Water drunk yesterday (litres) <i>optional</i></span><input type="number" name="hydrationLiters" min="0" max="15" step="0.25" value="${v.hydration_liters != null ? esc(f1(v.hydration_liters)) : ''}"></label>
        </details>
        <label class="mm-field mm-notes"><span>General wellness notes <i>optional</i></span><textarea name="notes" rows="2" maxlength="1000" placeholder="Anything you want your trainer to know">${esc(v.user_notes || '')}</textarea></label>
        <p class="rc-disclaimer">This is your own record of how you feel — not a medical assessment. If you have pain, an injury or symptoms that worry you, please speak to a doctor or physiotherapist.</p>
        <p class="mm-err" id="rc-err" role="alert"></p>
        <div class="mm-actions"><span class="pg-muted">You can update a check-in for up to 7 days.</span>
          <button type="submit" class="btn btn-green" id="rc-save"${lockedByStaff ? ' disabled' : ''}>${ex && !lockedByStaff ? 'Update check-in' : 'Save check-in'}</button></div>
      </form></section>`;
  }

  // ------------------------------------------------------------------ trends
  function trends() {
    const mine = rows; // all check-ins in the last 90 days, as recorded
    const window = (days) => mine.filter((r) => dayOf(r.log_date) > addDays(today, -days));
    const block = (days) => {
      const w = window(days);
      if (!w.length) return `<div class="mm-tile"><span>Last ${days} days</span><b class="mm-none">No check-ins</b><small>0 of ${days} days recorded</small></div>`;
      return `<div class="mm-tile rc-period"><span>Last ${days} days</span><small>${w.length} of ${days} days recorded</small>
        <dl><dt>Sleep</dt><dd>${f1(avgOf(w, 'sleep_hours'))} h avg</dd><dt>Sleep quality</dt><dd>${f1(avgOf(w, 'sleep_quality'))}/10</dd>
        <dt>Fatigue</dt><dd>${avgOf(w, 'fatigue_level') === null ? '—' : `${f1(avgOf(w, 'fatigue_level'))}/10`}</dd><dt>Soreness</dt><dd>${f1(avgOf(w, 'overall_soreness_rating'))}/10</dd>
        <dt>Rest days</dt><dd>${w.filter((r) => r.is_rest_day).length}</dd></dl></div>`;
    };
    const counts = new Map();
    window(30).forEach((r) => (r.soreness || []).forEach((s) => counts.set(s.muscleGroup, (counts.get(s.muscleGroup) || 0) + 1)));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const asc = mine.slice().reverse();
    const chart = (key, label, unit) => {
      const pts = asc.filter((r) => n(r[key]) !== null).map((r) => ({ t: dayOf(r.log_date), v: r[key] }));
      return `<div><h3 class="mm-sub">${esc(label)}</h3>${pts.length < 2 ? NED('Needs at least 2 check-ins with this value.') : lineChart(pts, { unit, label, id: `rc-${key}` })}</div>`;
    };
    return `<section class="pg-card"><h2 class="pg-h">Recovery trends</h2>
      <p class="pg-muted">Averages of what you recorded. Days without a check-in are left out — they are not counted as zero.</p>
      <div class="rc-periods">${block(7)}${block(30)}</div>
      ${top.length ? `<p class="pg-muted">Most often sore (last 30 days): ${top.map(([m, c]) => `<b>${esc(m)}</b> ×${c}`).join(' · ')}</p>` : ''}
      <div class="rc-charts">${chart('sleep_hours', 'Sleep duration', 'h')}${chart('fatigue_level', 'Fatigue (1–10)', '/10')}${chart('overall_soreness_rating', 'Overall soreness (0–10)', '/10')}${chart('sleep_quality', 'Sleep quality (1–10)', '/10')}</div>
    </section>`;
  }

  function feedbackSection() {
    if (feedback === null) return '';
    return `<section class="pg-card"><h2 class="pg-h">Coaching feedback from your trainer</h2>
      ${feedback.length ? `<ul class="rc-fb">${feedback.map((c) => `<li><p>${esc(c.comment_text)}</p><small>${esc(c.trainer_name || 'Your trainer')} · ${esc(new Date(c.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</small></li>`).join('')}</ul>`
        : '<p class="pg-muted">No recovery feedback yet. Your assigned trainer can review your check-ins and reply here.</p>'}</section>`;
  }

  function history() {
    if (!rows.length) return `<section class="pg-card"><h2 class="pg-h">History</h2>${NED('No recovery check-ins recorded yet.')}</section>`;
    return `<section class="pg-card"><h2 class="pg-h">History <small class="mm-count">${rows.length} check-in${rows.length === 1 ? '' : 's'} · last 90 days</small></h2>
      <div class="pg-scroll"><table class="admin-table pg-tbl rc-tbl"><thead><tr><th>Date</th><th>Sleep</th><th>Fatigue</th><th>Soreness</th><th>Rest day</th><th>How you felt</th><th>Notes</th><th></th></tr></thead><tbody>
      ${rows.map((r) => {
        const d = dayOf(r.log_date); const mineRow = (r.logged_by || 'Member') === 'Member';
        return `<tr><td>${esc(dLong(d))}${mineRow ? '' : '<small class="pg-sub">recorded by staff</small>'}</td>
          <td>${f1(r.sleep_hours)} h<small class="pg-sub">quality ${f1(r.sleep_quality)}/10</small></td>
          <td>${r.fatigue_level == null ? '<span class="pg-missing" title="Not recorded">—</span>' : `${r.fatigue_level}/10`}</td>
          <td>${f1(r.overall_soreness_rating)}/10${(r.soreness || []).length ? `<small class="pg-sub">${r.soreness.map((s) => `${esc(s.muscleGroup)} ${s.level}`).join(', ')}</small>` : ''}</td>
          <td>${r.is_rest_day ? `Yes${r.rest_day_activity ? `<small class="pg-sub">${esc(r.rest_day_activity)}</small>` : ''}` : 'No'}</td>
          <td>${r.self_assessment ? esc(SELF_LABEL[r.self_assessment]) : '<span class="pg-missing" title="Not recorded">—</span>'}</td>
          <td class="rc-notes">${r.user_notes ? esc(r.user_notes) : ''}</td>
          <td>${ready && mineRow && d >= oldest ? `<button type="button" class="btn btn-outline rc-edit" data-date="${d}">Edit</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div></section>`;
  }

  function render(flash = '') {
    content.innerHTML = `<div class="pg-wrap">${flash ? `<div class="mm-flash" role="status">${esc(flash)}</div>` : ''}
      ${muscleSection()}${form()}${feedbackSection()}${trends()}${history()}</div>`;
    const mount = content.querySelector('#mr-panel-mount'); if (mount) musclePanel.mount(mount);
    wireCharts(content);
    const f = content.querySelector('#rc-form');
    if (f) {
      f.addEventListener('submit', submit);
      f.logDate.addEventListener('change', () => { if (f.logDate.value && f.logDate.value >= oldest && f.logDate.value <= today) { editDate = f.logDate.value; render(); } });
      f.isRestDay.addEventListener('change', () => { content.querySelector('#rc-activity').hidden = !f.isRestDay.checked; if (!f.isRestDay.checked) f.restDayActivity.value = ''; });
      f.querySelectorAll('input[name=mg]').forEach((cb) => cb.addEventListener('change', () => {
        cb.closest('.rc-chip').classList.toggle('on', cb.checked);
        f.querySelector(`select[data-mg="${CSS.escape(cb.value)}"]`).hidden = !cb.checked;
      }));
    }
    content.querySelectorAll('.rc-edit').forEach((b) => b.addEventListener('click', () => { editDate = b.dataset.date; render(); content.querySelector('#rc-form')?.scrollIntoView({ behavior: 'smooth' }); }));
  }

  async function submit(ev) {
    ev.preventDefault();
    if (saving) return;
    const f = ev.target; const err = content.querySelector('#rc-err');
    const radio = (name) => f.querySelector(`input[name=${name}]:checked`)?.value;
    const problems = []; const body = {};
    const date = f.logDate.value;
    if (!date || date > today || date < oldest) problems.push('Choose a date from the last 7 days.'); else body.logDate = date;
    const sleep = f.sleepHours.value.trim();
    if (sleep === '' || !(Number(sleep) >= 0 && Number(sleep) <= 24)) problems.push('Enter sleep duration (0–24 hours).'); else body.sleepHours = Number(sleep);
    for (const [k, label] of [['sleepQuality', 'sleep quality'], ['fatigueLevel', 'fatigue'], ['overallSoreness', 'overall soreness']]) {
      const v = radio(k); if (v === undefined) problems.push(`Rate your ${label}.`); else body[k] = Number(v);
    }
    const self = radio('selfAssessment'); if (!self) problems.push('Choose how recovered you feel.'); else body.selfAssessment = self;
    body.soreness = [...f.querySelectorAll('input[name=mg]:checked')].map((cb) => ({ muscleGroup: cb.value, level: Number(f.querySelector(`select[data-mg="${CSS.escape(cb.value)}"]`).value) }));
    if (body.overallSoreness === 0 && body.soreness.length) problems.push('Overall soreness is 0, but sore muscle groups are ticked.');
    body.isRestDay = f.isRestDay.checked;
    if (body.isRestDay && f.restDayActivity.value) body.restDayActivity = f.restDayActivity.value;
    for (const k of ['energyLevel', 'stressLevel']) { const v = radio(k); if (v !== undefined) body[k] = Number(v); }
    const water = f.hydrationLiters.value.trim();
    if (water !== '') { if (!(Number(water) >= 0 && Number(water) <= 15)) problems.push('Water must be 0–15 litres.'); else body.hydrationLiters = Number(water); }
    const notes = f.notes.value.trim(); if (notes) body.notes = notes;
    if (problems.length) { err.textContent = problems.join(' '); return; }
    err.textContent = ''; saving = true;
    const btn = content.querySelector('#rc-save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api.post('/recovery', body);
      await load();
      editDate = date;
      render(`Check-in for ${dLong(date)} saved.`);
    } catch (e) {
      err.textContent = e instanceof ApiError ? e.message : 'Could not save — check your connection and try again.';
      btn.disabled = false; btn.textContent = 'Save check-in';
    } finally { saving = false; }
  }

  content.innerHTML = '<div class="mp-loading">Loading your recovery check-ins…</div>';
  try { await load(); render(); } catch (e) {
    content.innerHTML = notice('Could not load your recovery check-ins', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true });
  }
}
