/** Virtex Member Portal — member-measurements.html: Measurements.
 *  Uses: GET  /api/v1/member/measurements  (own full history, newest first)
 *        POST /api/v1/member/measurements  (adds a NEW record; history is never edited or deleted)
 *  Blank optional fields mean "not measured" and are stored empty, never as 0.
 *  Goal card: GET/PUT /api/v1/member/goal (bulking / cutting / maintain). With a goal set, the weekly rate
 *  between the last two weigh-ins is compared with the usual healthy rate for that goal.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';
import { lineChart, wireCharts, NED } from './member-charts.js';

const shell = await initShell({ page: 'measurements', title: 'Measurements', subtitle: 'Track your body measurements over time' });

const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const f1 = (v) => (n(v) === null ? '—' : (Math.round(n(v) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const signed = (v) => (n(v) === null ? '—' : `${n(v) > 0 ? '+' : n(v) < 0 ? '−' : '±'}${f1(Math.abs(n(v)))}`);
const dLong = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const localYmd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Same limits the server enforces (server is the authority; this only gives early feedback).
const FIELDS = [
  { key: 'weightKg', col: 'weight_kg', label: 'Weight', unit: 'kg', min: 20, max: 400, required: true },
  { key: 'heightCm', col: 'height_cm', label: 'Height', unit: 'cm', min: 100, max: 250, required: true },
  { key: 'bodyFatPct', col: 'body_fat_pct', label: 'Body fat', unit: '%', min: 0.1, max: 70, hint: 'If measured' },
  { key: 'muscleMassKg', col: 'muscle_mass_kg', label: 'Muscle mass', unit: 'kg', min: 0.1, max: 200, hint: 'If measured' },
  { key: 'chestCm', col: 'chest_cm', label: 'Chest', unit: 'cm', min: 0.1, max: 250 },
  { key: 'waistCm', col: 'waist_cm', label: 'Waist', unit: 'cm', min: 0.1, max: 250 },
  { key: 'hipsCm', col: 'hips_cm', label: 'Hips', unit: 'cm', min: 0.1, max: 250 },
  { key: 'armsCm', col: 'arms_cm', label: 'Arms', unit: 'cm', min: 0.1, max: 100 },
  { key: 'thighsCm', col: 'thighs_cm', label: 'Thighs', unit: 'cm', min: 0.1, max: 150 },
];
// Usual weekly body-weight change for each goal (% of body weight per week) and what the waist should do.
const GOALS = {
  bulking: { icon: '💪', label: 'Bulking', lo: 0.25, hi: 0.5, text: 'Build muscle: gain about 0.25–0.5% of your body weight per week.', waist: 'Waist should stay about the same — if it grows fast, slow the gain.' },
  cutting: { icon: '🔥', label: 'Cutting', lo: -1, hi: -0.5, text: 'Lose fat, keep muscle: lose about 0.5–1% of your body weight per week.', waist: 'Waist should go down — that is the best sign it is fat you are losing.' },
  maintain: { icon: '⚖️', label: 'Maintain', lo: -0.25, hi: 0.25, text: 'Keep your weight steady (within about ±0.25% a week) while getting stronger.', waist: 'Waist steady while strength goes up = body recomposition.' },
};

const CHARTABLE = [...FIELDS.filter((f) => f.key !== 'heightCm'), { key: 'bmi', col: 'bmi', label: 'BMI', unit: '' }];

if (shell) {
  const { content } = shell;
  let rows = [];            // newest first, full history
  let metric = 'weight_kg';
  let saving = false;
  let goal = null;          // 'bulking' | 'cutting' | 'maintain' | null (from /member/goal)
  let goalBusy = false;

  /** Weekly % weight change between the two most recent weigh-ins (null when not enough data). */
  function weeklyRate() {
    const w = rows.filter((r) => n(r.weight_kg) !== null && r.logged_at);
    if (w.length < 2) return null;
    const days = Math.round((Date.parse(w[0].logged_at) - Date.parse(w[1].logged_at)) / 86400000); // whole days between weigh-ins
    if (!(days >= 3)) return { tooClose: true };
    const pct = ((n(w[0].weight_kg) - n(w[1].weight_kg)) / n(w[1].weight_kg)) * 100 / (days / 7);
    return { pct, days, from: n(w[1].weight_kg), to: n(w[0].weight_kg) };
  }

  function goalCard() {
    const g = GOALS[goal];
    const pick = Object.entries(GOALS).map(([k, x]) => `<button type="button" class="gc-opt${goal === k ? ' on' : ''}" data-goal="${k}" aria-pressed="${goal === k}" ${goalBusy ? 'disabled' : ''}>
        <span aria-hidden="true">${x.icon}</span><b>${x.label}</b></button>`).join('');
    let check = '';
    if (g) {
      const r = weeklyRate();
      if (!r) check = '<p class="gc-check gc-wait">📏 Add at least two weigh-ins (a week apart) to see if you are on track.</p>';
      else if (r.tooClose) check = '<p class="gc-check gc-wait">📏 Your last two weigh-ins are less than 3 days apart — weigh in again in a few days to see your weekly rate.</p>';
      else {
        const rate = Math.round(r.pct * 100) / 100;
        const v = rate < g.lo ? (goal === 'cutting' ? 'fast' : 'slow') : rate > g.hi ? (goal === 'cutting' ? 'slow' : 'fast') : 'ok';
        const word = { ok: '✅ On track', fast: '⚠️ Too fast', slow: '🐢 Too slow' }[v];
        const tip = {
          ok: 'Keep doing what you are doing.',
          fast: goal === 'bulking' ? 'Gaining this fast adds mostly fat — eat a little less.' : goal === 'cutting' ? 'Losing this fast can cost muscle — eat a little more and keep protein high.' : 'Weight is moving more than expected — check your daily calories.',
          slow: goal === 'bulking' ? 'Add about 150–200 kcal a day and keep training hard.' : goal === 'cutting' ? 'Cut about 150–200 kcal a day or add daily steps.' : 'Weight is moving more than expected — check your daily calories.',
        }[v];
        check = `<div class="gc-check gc-${v}"><b>${word}</b> · ${rate > 0 ? '+' : ''}${rate}% per week
          <span class="gc-detail">(${f1(r.from)} → ${f1(r.to)} kg over ${Math.round(r.days)} days; target ${g.lo > 0 ? '+' : ''}${g.lo}% to ${g.hi > 0 ? '+' : ''}${g.hi}%)</span>
          <p>${esc(tip)}</p></div>`;
      }
    }
    return `<section class="pg-card gc-card" aria-labelledby="gc-h">
      <div class="gc-head"><h2 id="gc-h">${g ? `${g.icon} Your goal: ${g.label}` : '🎯 What is your goal?'}</h2>${g ? '<span class="pg-muted">Your trainer sees this too.</span>' : ''}</div>
      ${g ? '' : '<p class="pg-muted gc-ask">Are you <b>bulking</b> (building muscle) or <b>cutting</b> (losing fat)? Pick one so we can check your measurements against it.</p>'}
      <div class="gc-opts" role="group" aria-label="Choose your goal">${pick}</div>
      ${g ? `<p class="gc-text">${esc(g.text)} ${esc(g.waist)}</p>${check}` : ''}
      <p class="mm-err" id="gc-err" role="alert"></p>
    </section>`;
  }

  async function setGoal(k) {
    if (goalBusy || k === goal) return;
    goalBusy = true; render();
    try { goal = (await api.put('/goal', { goal: k })).data.goal; goalBusy = false; render(`Goal set to ${GOALS[goal].label}.`); }
    catch (e) { goalBusy = false; render(); const er = content.querySelector('#gc-err'); if (er) er.textContent = e instanceof ApiError ? e.message : 'Could not save your goal.'; }
  }

  async function loadAll() {
    const out = [];
    for (let page = 1; page <= 20; page++) {       // up to 2,000 records
      const res = await api.get('/measurements', { page, limit: 100 });
      out.push(...(res.data || []));
      if (page >= (res.pagination?.totalPages || 1)) break;
    }
    return out;
  }

  /** Change in a value between the latest record that has it and the previous record that has it. */
  function latestChange(col) {
    const withV = rows.filter((r) => n(r[col]) !== null);
    if (!withV.length) return { latest: null };
    if (withV.length < 2) return { latest: withV[0], ned: true };
    return { latest: withV[0], prev: withV[1], change: n(withV[0][col]) - n(withV[1][col]) };
  }

  function summary() {
    if (!rows.length) return '';
    const tiles = [FIELDS[0], { col: 'bmi', label: 'BMI', unit: '' }, FIELDS[2], FIELDS[3], FIELDS[5]].map((f) => {
      const c = latestChange(f.col);
      return `<div class="mm-tile"><span>${esc(f.label)}</span>
        ${c.latest ? `<b>${f1(c.latest[f.col])}${f.unit ? ` ${esc(f.unit)}` : ''}</b><small>${esc(dLong(c.latest.logged_at))}</small>
          ${c.ned ? '<small class="pg-ned-badge sm">Not Enough Data</small>' : `<small class="mm-chg">${signed(c.change)}${f.unit ? ` ${esc(f.unit)}` : ''} since ${esc(dLong(c.prev.logged_at))}</small>`}`
          : '<b class="mm-none">Not measured</b><small>No record yet</small>'}</div>`;
    }).join('');
    return `<section class="pg-card"><h2 class="pg-h">Latest measurements</h2><div class="mm-tiles">${tiles}</div></section>`;
  }

  function chart() {
    const m = CHARTABLE.find((f) => f.col === metric) || CHARTABLE[0];
    const pts = rows.filter((r) => n(r[m.col]) !== null).map((r) => ({ t: r.logged_at, v: r[m.col] })).reverse();
    const body = pts.length < 2
      ? NED(pts.length ? `Only one ${m.label.toLowerCase()} value recorded. Add another measurement to see a trend.` : `No ${m.label.toLowerCase()} values recorded yet.`)
      : `<p class="pg-muted">${signed(n(pts[pts.length - 1].v) - n(pts[0].v))}${m.unit ? ` ${esc(m.unit)}` : ''} from ${f1(pts[0].v)} on ${esc(dLong(pts[0].t))} · ${pts.length} records</p>
         ${lineChart(pts, { unit: m.unit || 'BMI', label: m.label, id: 'measure' })}`;
    return `<section class="pg-card"><div class="mm-chart-head"><h2 class="pg-h">Progress chart</h2>
      <label class="pg-select">Show <select id="mm-metric">${CHARTABLE.map((f) => `<option value="${f.col}"${f.col === m.col ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label></div>
      ${body}</section>`;
  }

  function history() {
    if (!rows.length) return `<section class="pg-card"><h2 class="pg-h">History</h2>${NED('No measurements recorded yet. Your first entry will appear here.')}</section>`;
    const cell = (v, u = '') => (n(v) === null ? '<span class="pg-missing" title="Not measured">—</span>' : `${f1(v)}${u}`);
    return `<section class="pg-card"><h2 class="pg-h">History <small class="mm-count">${rows.length} record${rows.length === 1 ? '' : 's'}</small></h2>
      <p class="pg-muted">Every measurement is kept. “—” means it was not measured that day.</p>
      <div class="pg-scroll"><table class="admin-table pg-tbl mm-tbl"><thead><tr><th>Date</th><th>Weight</th><th>Height</th><th>BMI</th><th>Body fat</th><th>Muscle</th>
        <th>Chest</th><th>Waist</th><th>Hips</th><th>Arms</th><th>Thighs</th><th>Recorded by</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(dLong(r.logged_at))}</td><td>${cell(r.weight_kg, ' kg')}</td><td>${cell(r.height_cm, ' cm')}</td><td>${cell(r.bmi)}</td>
        <td>${cell(r.body_fat_pct, '%')}</td><td>${cell(r.muscle_mass_kg, ' kg')}</td><td>${cell(r.chest_cm)}</td><td>${cell(r.waist_cm)}</td>
        <td>${cell(r.hips_cm)}</td><td>${cell(r.arms_cm)}</td><td>${cell(r.thighs_cm)}</td><td>${esc(r.measured_by || '—')}</td></tr>`).join('')}
      </tbody></table></div><p class="pg-foot">Circumferences in cm. Your assigned trainer can review these records in Trainer Hub.</p></section>`;
  }

  function form() {
    const lastHeight = rows.find((r) => n(r.height_cm) !== null)?.height_cm;
    const input = (f) => `<label class="mm-field"><span>${esc(f.label)} <em>(${esc(f.unit)})</em>${f.required ? ' <i class="mm-req">required</i>' : f.hint ? ` <i>${esc(f.hint)}</i>` : ''}</span>
      <input type="number" name="${f.key}" inputmode="decimal" step="0.1" min="${f.min}" max="${f.max}" ${f.required ? 'required' : ''}
        ${f.key === 'heightCm' && lastHeight ? `value="${esc(f1(lastHeight).replace(/,/g, ''))}"` : ''} placeholder="${f.required ? '' : 'Not measured'}"></label>`;
    return `<section class="pg-card"><h2 class="pg-h">Add a measurement</h2>
      <form id="mm-form" novalidate>
        <div class="mm-grid">
          <label class="mm-field"><span>Measurement date <i class="mm-req">required</i></span><input type="date" name="measuredOn" required max="${localYmd()}" min="2000-01-01" value="${localYmd()}"></label>
          ${FIELDS.slice(0, 4).map(input).join('')}
        </div>
        <h3 class="mm-sub">Body measurements <small>(leave blank if not measured)</small></h3>
        <div class="mm-grid">${FIELDS.slice(4).map(input).join('')}</div>
        <label class="mm-field mm-notes"><span>Notes <i>optional</i></span><textarea name="notes" rows="2" maxlength="1000" placeholder="e.g. measured in the morning"></textarea></label>
        <p class="mm-err" id="mm-err" role="alert"></p>
        <div class="mm-actions"><span class="pg-muted">Saved records are kept permanently and can't be edited. Ask your trainer if one needs correcting.</span>
          <button type="submit" class="btn btn-green" id="mm-save">Save measurement</button></div>
      </form></section>`;
  }

  function render(flash = '') {
    content.innerHTML = `<div class="pg-wrap">
      ${flash ? `<div class="mm-flash" role="status">${esc(flash)}</div>` : ''}
      ${goalCard()}${form()}${summary()}${chart()}${history()}</div>`;
    wireCharts(content);
    content.querySelector('#mm-metric')?.addEventListener('change', (e) => { metric = e.target.value; render(); content.querySelector('#mm-metric')?.focus(); });
    content.querySelector('#mm-form').addEventListener('submit', submit);
    content.querySelectorAll('[data-goal]').forEach((b) => b.addEventListener('click', () => setGoal(b.dataset.goal)));
  }

  async function submit(ev) {
    ev.preventDefault();
    if (saving) return;
    const fd = new FormData(ev.target);
    const err = content.querySelector('#mm-err');
    const body = {};
    const problems = [];
    const date = String(fd.get('measuredOn') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push('Choose the measurement date.');
    else if (date > localYmd()) problems.push('The measurement date cannot be in the future.');
    else body.measuredOn = date;
    for (const f of FIELDS) {
      const raw = String(fd.get(f.key) ?? '').trim();
      if (raw === '') { if (f.required) problems.push(`${f.label} is required.`); continue; }
      const v = Number(raw);
      if (!Number.isFinite(v) || v < f.min || v > f.max) problems.push(`${f.label} must be between ${f.min} and ${f.max} ${f.unit}.`);
      else body[f.key] = v;
    }
    const notes = String(fd.get('notes') || '').trim();
    if (notes) body.notes = notes;
    if (problems.length) { err.textContent = problems.join(' '); return; }
    err.textContent = '';
    saving = true;
    const btn = content.querySelector('#mm-save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api.post('/measurements', body);
      rows = await loadAll();
      render(`Measurement for ${dLong(`${date}T12:00:00`)} saved.`);
    } catch (e) {
      err.textContent = e instanceof ApiError ? e.message : 'Could not save — check your connection and try again.';
      btn.disabled = false; btn.textContent = 'Save measurement';
    } finally { saving = false; }
  }

  content.innerHTML = '<div class="mp-loading">Loading your measurements…</div>';
  try {
    [rows, goal] = await Promise.all([loadAll(), api.get('/goal').then((r) => r.data.goal).catch(() => null)]);
    render();
  } catch (e) {
    content.innerHTML = notice('Could not load your measurements', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true });
  }
}
