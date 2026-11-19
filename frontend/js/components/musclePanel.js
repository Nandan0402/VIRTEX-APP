/**
 * Virtex — Muscle recovery panel (shared by Member Portal → Recovery and Trainer Hub → Client profile).
 * Body map (front/back) + one tile per muscle: recovery %, assigned exercises with today's progress
 * (green ✓ when all sets are logged, +extra reps), and an "Assign" button.
 *
 * createMusclePanel({
 *   audience: 'member' | 'trainer',
 *   load:    async () => muscleRecoveryData,          // GET …/muscle-recovery
 *   options: async (muscle) => { exercises: [...] },   // exercises that train this muscle
 *   assign:  async (body) => apiResult,                // { muscle, exerciseId|exerciseName, sets, reps, weightKg }
 *   remove:  async (planExerciseId) => apiResult,
 *   canRemove: (planItem) => boolean,
 *   clientName?: string,                               // trainer audience: shown in texts
 *   readOnly?: boolean,                                // hide Assign (e.g. past client)
 * }) → { mount(el), refresh(flash) }
 */
import { anatomySvg, viewFor, ensureAnatomyDefs } from '../member/member-anatomy.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));
const f1 = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : (Math.round(Number(v) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, k) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + k); return ymd(d); };

export function createMusclePanel(cfg) {
  // cfg.images === false → simple layout: no body map and no body figures, just muscles, % and exercises.
  const images = cfg.images !== false;
  const trainer = cfg.audience === 'trainer';
  const who = trainer ? (cfg.clientName || 'this client') : 'you';
  let data = null; let root = null; let timer = null;

  // ---------------------------------------------------------------- recovery maths (display only; server decides the data)
  function livePercent(m) {
    if (!m.lastTrainedAt) return 100;
    const pct = Math.min(100, Math.round(((Date.now() - new Date(m.lastTrainedAt).getTime()) / 3600000 / m.recoveryHours) * 100));
    return m.soreness !== null && m.soreness >= 7 ? Math.min(pct, 90) : pct;
  }
  const tone = (pct, m) => (!m.lastTrainedAt ? 'fresh' : pct >= 100 ? 'ok' : pct >= 50 ? 'mid' : 'low');
  function whenText(m, pct) {
    if (!m.lastTrainedAt) return 'Not trained in the last 7 days';
    const at = new Date(m.lastTrainedAt); const today = ymd();
    const day = ymd(at) === today ? 'Trained today' : ymd(at) === addDays(today, -1) ? 'Trained yesterday' : `Trained ${at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
    if (pct >= 100) return `${day} · recovered`;
    const left = Math.max(1, Math.round((new Date(m.readyAt).getTime() - Date.now()) / 3600000));
    return `${day} · ready in ~${left} h${m.soreness !== null && m.soreness >= 7 ? ` (${trainer ? 'reported' : 'you reported'} soreness)` : ''}`;
  }

  // ---------------------------------------------------------------- markup
  function tag(p) {
    if (p.own) return `<i class="mr-own">${trainer ? 'Member plan' : 'My plan'}</i>`;
    if (p.coachPlan) return '<i class="mr-own mr-coach">Coach</i>';
    return '';
  }
  function planList(m) {
    const assignBtn = cfg.readOnly ? '' : `<button type="button" class="mr-assign" data-assign="${esc(m.name)}">+ Assign</button>`;
    if (!m.plan || !m.plan.length) return `<div class="mr-plan mr-plan-empty"><span>No exercise assigned for this muscle.</span>${assignBtn}</div>`;
    const rows = m.plan.map((p) => {
      const icon = p.trainerCheck === false ? '✗' : p.status === 'done' ? '✓' : p.status === 'partial' ? '◐' : '○';
      const target = `${p.sets} × ${esc(p.reps || '—')}${p.targetWeightKg ? ` · ${f1(p.targetWeightKg)} kg` : ''}`;
      // Trainer's own coach-plan exercises: ✓ Complete / ✗ Not done buttons for today (trainer-only, migration 032).
      const canCheck = trainer && p.coachPlan && typeof cfg.check === 'function' && !cfg.readOnly && data?.checksAvailable !== false;
      const prog = canCheck
        ? `<span class="mr-check" role="group" aria-label="Today: ${esc(p.exercise)}">
            <button type="button" class="mr-chk yes" data-check="${esc(p.planId)}" data-val="true" data-name="${esc(p.exercise)}" aria-pressed="${p.trainerCheck === true}">✓ Complete</button>
            <button type="button" class="mr-chk no" data-check="${esc(p.planId)}" data-val="false" data-name="${esc(p.exercise)}" aria-pressed="${p.trainerCheck === false}">✗ Not done</button></span>`
        : p.status === 'todo'
          ? (trainer ? '<span class="mr-sets mr-sets-todo">Not done</span>' : `<a class="mr-go" href="${esc(p.link)}">Start</a>`)
          : `<span class="mr-sets">${p.loggedSets}/${p.sets} sets</span>`;
      const rm = cfg.canRemove(p) ? `<button type="button" class="mr-rm" data-remove="${esc(p.planId)}" data-name="${esc(p.exercise)}" aria-label="Remove ${esc(p.exercise)}" title="Remove">×</button>` : '';
      return `<li class="mr-ex mr-ex-${p.trainerCheck === false ? 'missed' : p.status}"><span class="mr-ico" aria-hidden="true">${icon}</span>
        <span class="mr-ex-main"><b>${esc(p.exercise)} ${tag(p)}</b><small>${target}${!p.own && !p.coachPlan && p.day ? ` · ${esc(p.day)}` : ''}</small>
          ${p.extraReps > 0 ? `<small class="mr-extra">+${p.extraReps} extra rep${p.extraReps === 1 ? '' : 's'}</small>` : ''}</span>
        ${prog}${rm}<span class="sr-only">${p.status === 'done' ? 'Done' : p.status === 'partial' ? 'In progress' : 'Not done yet'}</span></li>`;
    }).join('');
    return `<div class="mr-plan">${m.planDoneToday ? '<div class="mr-done-badge">✓ Workout done today</div>' : ''}<ul>${rows}</ul>
      <div class="mr-plan-foot">${assignBtn}</div></div>`;
  }
  function bodyMap() {
    const toneOfMuscle = (name) => { const m = data.muscles.find((x) => x.name === name); return m ? tone(livePercent(m), m) : null; };
    return `<div class="mr-map" data-mr-map aria-label="Body recovery map">
      <div class="mr-map-fig">${anatomySvg('front', toneOfMuscle, { cls: 'mr-big' })}</div>
      <div class="mr-map-fig">${anatomySvg('back', toneOfMuscle, { cls: 'mr-big' })}</div></div>`;
  }
  function html() {
    if (!data) return '<p class="mr-sub">Muscle recovery is not available right now.</p>';
    const trained = data.muscles.filter((m) => m.lastTrainedAt).length;
    return `<div class="mr-head"><h2 class="mr-title">Muscle recovery${trainer ? ` · ${esc(who)}` : ''}</h2>
        <div class="mr-legend" aria-hidden="true"><span class="mr-k low"></span>Recovering <span class="mr-k mid"></span>Almost <span class="mr-k ok"></span>Recovered</div></div>
      ${images ? '' : `<p class="mr-sub">${trained ? 'Recovery from completed workouts in the last 7 days.' : 'No workouts logged in the last 7 days.'}${trainer ? ' 🔒 Trainers only — the member does not see this.' : ''}</p>`}
      ${!images ? '' : `<p class="mr-sub">${trained ? `Based on ${trainer ? `${esc(who)}'s` : 'your'} completed workouts in the last 7 days.` : `No workouts logged in the last 7 days.`}
        Big muscles (chest, back, legs) need about 72 h, smaller ones about 48 h; hard sessions (effort 8+) add 12 h. A general guide, not medical advice.
        ${trainer ? ' 🔒 Visible to trainers only — the member does not see this panel. Assigned exercises turn green when the member logs them.' : ''}</p>`}
      ${images ? bodyMap() : ''}
      <div class="mr-grid">${data.muscles.map((m) => {
        const pct = livePercent(m); const t = tone(pct, m);
        return `<div class="mr-tile mr-${t}" data-mr="${esc(m.name)}" title="${esc(m.exercises.length ? `Exercises: ${m.exercises.join(', ')}` : m.name)}">
          ${images ? anatomySvg(viewFor(m.name), (x) => (x === m.name ? t : null), { label: true, cls: 'mr-fig' }) : ''}
          <div class="mr-info">
            <div class="mr-top"><span class="mr-name">${esc(m.name)}</span><span class="mr-pct">${pct}%</span></div>
            <div class="mr-bar" role="progressbar" aria-label="${esc(m.name)} recovery" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
            <div class="mr-when">${esc(whenText(m, pct))}</div></div>
          ${planList(m)}</div>`;
      }).join('')}</div>`;
  }

  // ---------------------------------------------------------------- behaviour
  function tick() {
    if (!data || !root) return;
    for (const m of data.muscles) {
      const el = root.querySelector(`.mr-tile[data-mr="${CSS.escape(m.name)}"]`); if (!el) continue;
      const pct = livePercent(m); const tn = tone(pct, m);
      el.className = `mr-tile mr-${tn}`;
      el.querySelectorAll('.mr-m').forEach((p) => p.setAttribute('class', `mr-m mr-t-${p.dataset.m === m.name ? tn : 'none'}`));
      root.querySelectorAll(`[data-mr-map] [data-m="${CSS.escape(m.name)}"]`).forEach((p) => p.setAttribute('class', `mr-m mr-t-${tn}`));
      el.querySelector('.mr-pct').textContent = `${pct}%`;
      el.querySelector('.mr-bar span').style.width = `${pct}%`;
      el.querySelector('.mr-bar').setAttribute('aria-valuenow', String(pct));
      el.querySelector('.mr-when').textContent = whenText(m, pct);
    }
  }
  function wireMap() {
    const map = root.querySelector('[data-mr-map]'); if (!map) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) {
      map.addEventListener('pointermove', (e) => {
        const r = map.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
        map.querySelectorAll('.mr-map-fig').forEach((f) => { f.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 10}deg)`; });
      });
      map.addEventListener('pointerleave', () => map.querySelectorAll('.mr-map-fig').forEach((f) => { f.style.transform = ''; }));
    }
    map.addEventListener('click', (e) => {
      const name = e.target.closest?.('[data-m]')?.dataset.m; if (!name) return;
      const t = root.querySelector(`.mr-tile[data-mr="${CSS.escape(name)}"]`); if (!t) return;
      t.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
      t.classList.remove('mr-flash'); void t.offsetWidth; t.classList.add('mr-flash');
    });
  }
  function toast(text, error = false) {
    let el = document.getElementById('mr-toast');
    if (!el) { el = document.createElement('div'); el.id = 'mr-toast'; el.className = 'mr-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = text; el.classList.toggle('mr-toast-err', error); el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3500);
  }
  async function refresh(flash) {
    try { data = await cfg.load(); } catch { /* keep previous data */ }
    if (root) { root.innerHTML = html(); wireMap(); }
    if (flash) toast(flash);
  }
  async function openAssign(muscle) {
    const back = document.createElement('div');
    back.className = 'mr-modal-back';
    back.innerHTML = `<form class="mr-modal" role="dialog" aria-modal="true" aria-labelledby="mr-as-t" novalidate>
        <h2 id="mr-as-t">Assign ${esc(muscle)} exercise${trainer ? ` · ${esc(who)}` : ''}</h2>
        <p class="mr-modal-sub">${trainer
          ? `For your coaching of ${esc(who)} (trainers only). It turns green when they log all the sets.`
          : 'Adds it to <b>My own plan</b>. Log it on your workout page and it turns green here.'}</p>
        <label class="mr-f"><span>Exercise</span><select name="exercise"><option value="">Loading exercises…</option></select></label>
        <label class="mr-f" id="mr-as-custom" hidden><span>Exercise name</span><input name="exerciseName" maxlength="80" autocomplete="off"></label>
        <div class="mr-f-row">
          <label class="mr-f"><span>Sets</span><input name="sets" type="number" min="1" max="10" step="1" value="3" inputmode="numeric"></label>
          <label class="mr-f"><span>Reps</span><input name="reps" maxlength="7" value="10" placeholder="10 or 8-12"></label>
          <label class="mr-f"><span>Weight (kg) <i>optional</i></span><input name="weightKg" type="number" min="0" max="500" step="0.5" inputmode="decimal"></label>
        </div>
        <p class="mr-f-hint">Reps can be one number (10) or a range (8-12). Doing more than the top of the range shows as extra reps.</p>
        <p class="mr-f-err" role="alert"></p>
        <div class="mr-modal-actions"><button type="button" class="btn btn-outline" data-cancel>Cancel</button><button type="submit" class="btn btn-green">${trainer ? 'Assign to client' : 'Assign to my plan'}</button></div>
      </form>`;
    document.body.appendChild(back);
    const f = back.querySelector('form'); const err = back.querySelector('.mr-f-err');
    const close = () => { document.removeEventListener('keydown', onKey, true); back.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.querySelector('[data-cancel]').addEventListener('click', close);
    const sel = f.exercise; const custom = back.querySelector('#mr-as-custom');
    try {
      const opts = await cfg.options(muscle);
      sel.innerHTML = `${opts.exercises.length ? '<option value="" disabled selected>Choose an exercise…</option>' : ''}${opts.exercises.map((x) => `<option value="${x.id}">${esc(x.name)}${x.equipment ? ` · ${esc(x.equipment)}` : ''}</option>`).join('')}<option value="__new">${opts.exercises.length ? 'Other: type a name…' : 'Type an exercise name…'}</option>`;
      if (!opts.exercises.length) { sel.value = '__new'; custom.hidden = false; }
    } catch { sel.innerHTML = '<option value="__new">Type an exercise name…</option>'; custom.hidden = false; }
    sel.addEventListener('change', () => { custom.hidden = sel.value !== '__new'; if (!custom.hidden) f.exerciseName.focus(); });
    (custom.hidden ? sel : f.exerciseName).focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      const body = { muscle, sets: Number(f.sets.value), reps: f.reps.value.trim() };
      if (sel.value && sel.value !== '__new') body.exerciseId = Number(sel.value); else body.exerciseName = f.exerciseName.value.trim();
      if (f.weightKg.value !== '') body.weightKg = Number(f.weightKg.value);
      if (!body.exerciseId && !body.exerciseName) { err.textContent = 'Choose an exercise or type a name.'; return; }
      if (!(body.sets >= 1 && body.sets <= 10)) { err.textContent = 'Sets must be 1–10.'; return; }
      if (!/^\d{1,3}(\s*-\s*\d{1,3})?$/.test(body.reps)) { err.textContent = 'Reps must be a number like 10 or a range like 8-12.'; return; }
      const btn = f.querySelector('[type=submit]'); const label = btn.textContent; btn.disabled = true; btn.textContent = 'Assigning…';
      try {
        const res = await cfg.assign(body);
        close();
        await refresh(res?.data?.updated ? 'Exercise updated.' : `Assigned to ${trainer ? who : 'your'} ${muscle} plan.`);
        root.querySelector(`.mr-tile[data-mr="${CSS.escape(muscle)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (ex) { err.textContent = ex.message || 'Could not assign. Please try again.'; btn.disabled = false; btn.textContent = label; }
    });
  }

  return {
    async mount(el) {
      root = el; root.classList.add('mr-panel'); root.classList.toggle('mr-simple', !images);
      if (images) ensureAnatomyDefs();
      root.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-assign]'); if (a) { openAssign(a.dataset.assign); return; }
        const ck = e.target.closest('[data-check]');
        if (ck) {
          // Clicking the button that is already on clears today's mark.
          const val = ck.getAttribute('aria-pressed') === 'true' ? null : ck.dataset.val === 'true';
          root.querySelectorAll(`[data-check="${ck.dataset.check}"]`).forEach((b) => { b.disabled = true; });
          try {
            await cfg.check(ck.dataset.check, val);
            await refresh(val === null ? `${ck.dataset.name}: mark cleared.` : `${ck.dataset.name}: ${val ? 'Complete ✓' : 'Not done ✗'}`);
          } catch (ex) { root.querySelectorAll(`[data-check="${ck.dataset.check}"]`).forEach((b) => { b.disabled = false; }); toast(ex.message || 'Could not save.', true); }
          return;
        }
        const rm = e.target.closest('[data-remove]');
        if (rm) {
          rm.disabled = true;
          try { await cfg.remove(rm.dataset.remove); await refresh(`${rm.dataset.name} removed.`); }
          catch (ex) { rm.disabled = false; toast(ex.message || 'Could not remove.', true); }
        }
      });
      await refresh();
      clearInterval(timer); timer = setInterval(tick, 60000);
    },
    refresh,
  };
}
