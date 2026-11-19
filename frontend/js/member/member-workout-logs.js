/** Virtex Member Portal — member-workout-logs.html: record completed exercises + history + trainer feedback.
 *  Read:  GET  /api/v1/member/workout-logs           (own logs, with completion status)
 *         GET  /api/v1/member/workouts               (assigned programmes for "from my programme")
 *         GET  /api/v1/member/exercises              (catalogue for free sessions)
 *         GET  /api/v1/member/feedback?type=workout  (trainer feedback on workouts)
 *  Write: POST /api/v1/member/workout-logs           (server rejects duplicates with 409)
 *  Saved logs are permanent history — there is no edit or delete for members.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';

const shell = await initShell({ page: 'workout-logs', title: 'Workout Log', subtitle: 'Record your sessions and see your history' });

const fmtDate = (v, o = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => (v ? esc(new Date(v).toLocaleDateString(undefined, o)) : '—');
const fmtTime = (v) => (v ? esc(new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })) : '');
const localNow = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const STATUS = { completed: ['Completed', 'ok'], partial: ['Partially completed', 'warn'], logged: ['Free session', 'dim'] };

function toast(message, error = false) {
  let el = document.getElementById('wl-toast');
  if (!el) { el = document.createElement('div'); el.id = 'wl-toast'; el.className = 'toast-banner mp-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.classList.toggle('error', error); el.textContent = message; el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

if (shell) {
  const { content } = shell;
  let programs = []; let catalogue = []; let page = 1; let submitting = false;

  const exOptions = (selected, list) => `<option value="">Select exercise…</option>${list.map((e) => `<option value="${e.id}" ${String(e.id) === String(selected) ? 'selected' : ''}>${esc(e.name)}${e.muscle_group ? ` — ${esc(e.muscle_group)}` : ''}</option>`).join('')}`;
  const setRow = (n, hintReps = '', hintKg = '') => `<div class="wl-set"><span>Set ${n}</span>
    <input type="number" class="wl-reps" min="1" max="500" inputmode="numeric" aria-label="Reps, set ${n}" placeholder="reps${hintReps ? ` (${esc(hintReps)})` : ''}">
    <input type="number" class="wl-kg" min="0" max="1000" step="0.5" inputmode="decimal" aria-label="Weight kg, set ${n}" placeholder="kg${hintKg !== '' && hintKg !== null && hintKg !== undefined ? ` (${esc(hintKg)})` : ''}">
    <button type="button" class="wl-icon" data-rm-set aria-label="Remove set ${n}">✕</button></div>`;
  const exBlock = (e = {}, list = catalogue) => `<fieldset class="wl-ex" data-prescribed="${e.sets || 0}">
    <legend class="sr-only">Exercise</legend>
    <div class="wl-ex-head"><select class="wl-ex-select" aria-label="Exercise" ${e.locked ? 'disabled' : ''}>${exOptions(e.exercise_id, list)}</select>
      ${e.sets ? `<span class="wl-target">target ${esc(e.sets)} × ${esc(e.reps || '?')}${e.target_weight_kg !== null && e.target_weight_kg !== undefined ? ` @ ${esc(Number(e.target_weight_kg))} kg` : ''}</span>` : ''}
      <button type="button" class="wl-icon" data-rm-ex aria-label="Remove exercise">🗑</button></div>
    <div class="wl-sets">${Array.from({ length: Math.max(1, Math.min(Number(e.sets) || 1, 10)) }, (_, i) => setRow(i + 1, e.reps, e.target_weight_kg === null || e.target_weight_kg === undefined ? '' : Number(e.target_weight_kg))).join('')}</div>
    <button type="button" class="btn btn-outline wl-add-set">+ Add set</button></fieldset>`;

  function formHtml() {
    const dayOpts = programs.flatMap((p) => p.days.map((d) => `<option value="${p.id}:${d.id}" ${p.today?.dayId === d.id ? 'selected' : ''}>${esc(p.name)} — ${esc(d.day_name || `Day ${d.day_number}`)}${p.today?.dayId === d.id ? ' (up next)' : ''}</option>`)).join('');
    return `<section class="card wl-section" aria-labelledby="wl-rec-h"><div class="wl-head"><h2 id="wl-rec-h">Record a workout</h2></div>
      <form id="wl-form" novalidate>
        <div class="mp-form-grid">
          <div class="form-group"><label for="wl-date">Workout date *</label><input id="wl-date" type="datetime-local" name="completedAt" value="${localNow()}" max="${localNow()}"></div>
          <div class="form-group"><label for="wl-source">Session</label><select id="wl-source">${programs.length ? `<optgroup label="From my programme">${dayOpts}</optgroup>` : ''}<option value="free" ${programs.length ? '' : 'selected'}>Free session (choose exercises)</option></select></div>
          <div class="form-group"><label for="wl-duration">Duration (minutes) *</label><input id="wl-duration" type="number" name="durationMinutes" min="1" max="600"></div>
          <div class="form-group"><label for="wl-rpe">Effort (RPE 1–10) *</label><select id="wl-rpe" name="rpeRating"><option value="">Select…</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">${n}${n === 1 ? ' — very easy' : n === 10 ? ' — maximal' : ''}</option>`).join('')}</select></div>
        </div>
        <div id="wl-exercises"></div>
        <button type="button" class="btn btn-outline" id="wl-add-ex">+ Add exercise</button>
        <div class="wl-status-preview" id="wl-preview" aria-live="polite"></div>
        <div class="form-group"><label for="wl-notes">Notes for your trainer</label><textarea id="wl-notes" name="notes" rows="2" maxlength="1000" placeholder="How did it feel? Any pain or PRs?"></textarea></div>
        <div class="wl-err" role="alert"></div>
        <div class="mp-form-actions"><button type="reset" class="btn btn-outline">Clear</button><button type="submit" class="btn btn-green" id="wl-save">Save workout</button></div>
        <p class="wl-sub">Saved workouts become part of your permanent history and are shared with your trainer. Logs cannot be edited — ask your trainer or the front desk if something needs correcting.</p>
      </form></section>`;
  }

  function fillExercises() {
    const src = content.querySelector('#wl-source').value; const box = content.querySelector('#wl-exercises');
    if (src === 'free') { box.innerHTML = exBlock(); }
    else {
      const [pid, did] = src.split(':').map(Number);
      const day = programs.find((p) => p.id === pid)?.days.find((d) => d.id === did);
      box.innerHTML = (day?.exercises || []).map((e) => exBlock({ ...e, locked: false }, catalogue.length ? catalogue : (day.exercises || []).map((x) => ({ id: x.exercise_id, name: x.exercise_name, muscle_group: x.muscle_group })))).join('') || emptyState('No exercises on this day');
    }
    preview();
  }

  function collect() {
    return [...content.querySelectorAll('.wl-ex')].flatMap((b) => {
      const exerciseId = Number(b.querySelector('.wl-ex-select').value);
      return [...b.querySelectorAll('.wl-set')].map((r, i) => ({ exerciseId, setNumber: i + 1, reps: r.querySelector('.wl-reps').value, kg: r.querySelector('.wl-kg').value }))
        .filter((s) => s.reps !== '');
    });
  }

  /** Live completion status — same rule the server uses: logged sets vs prescribed sets for the day. */
  function preview() {
    const el = content.querySelector('#wl-preview'); if (!el) return;
    const src = content.querySelector('#wl-source').value;
    const done = collect().length;
    if (src === 'free') { el.innerHTML = `<span class="bl-pill bl-pill-dim">Free session</span> ${done} set${done === 1 ? '' : 's'} entered`; return; }
    const prescribed = [...content.querySelectorAll('.wl-ex')].reduce((n, b) => n + Number(b.dataset.prescribed || 0), 0);
    const [label, tone] = done >= prescribed && prescribed > 0 ? STATUS.completed : STATUS.partial;
    el.innerHTML = `<span class="bl-pill bl-pill-${tone}">${label}</span> ${done} of ${prescribed} prescribed sets entered`;
  }

  function wireForm() {
    const form = content.querySelector('#wl-form');
    content.querySelector('#wl-source').addEventListener('change', fillExercises);
    content.querySelector('#wl-add-ex').addEventListener('click', () => { content.querySelector('#wl-exercises').insertAdjacentHTML('beforeend', exBlock()); preview(); });
    form.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t.closest('.wl-add-set')) { const sets = t.closest('.wl-ex').querySelector('.wl-sets'); if (sets.children.length < 20) sets.insertAdjacentHTML('beforeend', setRow(sets.children.length + 1)); }
      if (t.closest('[data-rm-set]')) { const sets = t.closest('.wl-sets'); if (sets.children.length > 1) { t.closest('.wl-set').remove(); [...sets.children].forEach((r, i) => { r.querySelector('span').textContent = `Set ${i + 1}`; }); } }
      if (t.closest('[data-rm-ex]')) { t.closest('.wl-ex').remove(); }
      preview();
    });
    form.addEventListener('input', preview);
    form.addEventListener('reset', () => setTimeout(() => { content.querySelector('#wl-date').value = localNow(); fillExercises(); form.querySelector('.wl-err').textContent = ''; }, 0));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (submitting) return;                                   // double-click guard (server also rejects duplicates)
      const err = form.querySelector('.wl-err'); err.textContent = '';
      const src = content.querySelector('#wl-source').value;
      const [programId, dayId] = src === 'free' ? [null, null] : src.split(':').map(Number);
      const duration = Number(form.durationMinutes.value); const rpe = Number(form.rpeRating.value);
      const when = form.completedAt.value ? new Date(form.completedAt.value) : null;
      const sets = collect();
      const problems = [];
      if (!when || Number.isNaN(when.getTime())) problems.push('Choose the workout date.');
      else if (when.getTime() > Date.now() + 60000) problems.push('The workout date cannot be in the future.');
      if (!(duration >= 1 && duration <= 600)) problems.push('Enter the duration (1–600 minutes).');
      if (!(rpe >= 1 && rpe <= 10)) problems.push('Choose how hard it felt (RPE 1–10).');
      if (!sets.length) problems.push('Enter reps for at least one completed set.');
      if (sets.some((s) => !s.exerciseId)) problems.push('Choose the exercise for every set you entered.');
      if (sets.some((s) => !(Number(s.reps) >= 1 && Number(s.reps) <= 500))) problems.push('Reps must be 1–500.');
      if (sets.some((s) => s.kg === '' || !(Number(s.kg) >= 0 && Number(s.kg) <= 1000))) problems.push('Enter the weight used for every set (0 for bodyweight).');
      if (problems.length) { err.textContent = problems.join(' '); return; }
      submitting = true;
      const btn = form.querySelector('#wl-save'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await api.post('/workout-logs', { programId, dayId, durationMinutes: duration, rpeRating: rpe, completedAt: when.toISOString(),
          notes: form.notes.value.trim() || undefined, sets: sets.map((s) => ({ exerciseId: s.exerciseId, setNumber: s.setNumber, reps: Number(s.reps), weightKg: Number(s.kg) })) });
        toast('Workout saved — your trainer can now review it.');
        form.reset(); page = 1; await loadHistory();
      } catch (e) {
        if (e.status === 409) { toast('This workout was already recorded — it was not saved twice.', true); form.reset(); await loadHistory(); }
        else err.textContent = e.message || 'Could not save your workout.';
      } finally { submitting = false; btn.disabled = false; btn.textContent = 'Save workout'; }
    });
  }

  function logCard(l) {
    const [label, tone] = STATUS[l.completion?.status] || STATUS.logged;
    const byEx = new Map();
    (l.sets || []).forEach((s) => { byEx.set(s.exercise, [...(byEx.get(s.exercise) || []), s]); });
    return `<article class="wl-log">
      <header class="wl-log-head"><div><div class="wl-log-date">${fmtDate(l.completed_at)} <span class="wl-sub">${fmtTime(l.completed_at)}</span></div>
        <div class="wl-log-title">${l.program_name ? `${esc(l.program_name)}${l.day_name ? ` · ${esc(l.day_name)}` : ''}` : 'Free session'}</div></div>
        <div class="wl-log-status"><span class="bl-pill bl-pill-${tone}">${label}</span>${l.completion?.prescribedSets ? `<small>${l.completion.loggedSets}/${l.completion.prescribedSets} sets</small>` : ''}</div></header>
      <div class="wl-stats"><span>⏱ ${esc(l.duration_minutes)} min</span><span>💪 RPE ${esc(l.rpe_rating ?? '—')}</span>${Number(l.total_volume_kg) ? `<span>🏋️ ${esc(Number(l.total_volume_kg).toLocaleString())} kg volume</span>` : ''}<span class="wl-sub">logged by ${esc(l.logged_by || '—')}</span></div>
      ${byEx.size ? `<div class="table-responsive"><table class="admin-table wl-table"><thead><tr><th>Exercise</th><th>Completed sets</th><th>Reps × weight</th></tr></thead><tbody>
        ${[...byEx.entries()].map(([name, sets]) => `<tr><td class="wl-ex-name">${esc(name)}</td><td>${sets.length}</td>
          <td>${sets.map((s) => `<span class="wl-rep">${esc(s.reps)} × ${esc(Number(s.weightKg))} kg${s.isPr ? ' <b class="wl-pr">PR</b>' : ''}</span>`).join('')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${l.notes ? `<p class="wl-notes"><b>Your notes:</b> ${esc(l.notes)}</p>` : ''}
    </article>`;
  }

  async function loadHistory() {
    const box = content.querySelector('#wl-history');
    const from = content.querySelector('#wl-from').value; const to = content.querySelector('#wl-to').value;
    box.innerHTML = '<div class="mp-muted mp-loading">Loading history…</div>';
    try {
      const res = await api.get('/workout-logs', { page, limit: 10, from, to });
      box.innerHTML = res.data.length ? res.data.map(logCard).join('') + `<div class="bl-pager" id="wl-pager"></div>`
        : emptyState(from || to ? 'No workouts in this date range' : 'No workouts recorded yet', 'Your saved workouts appear here.');
      const pg = content.querySelector('#wl-pager');
      if (pg && res.pagination.totalPages > 1) {
        pg.innerHTML = `<span>${res.pagination.total} workouts · page ${page} of ${res.pagination.totalPages}</span>
          <button class="btn btn-outline" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Newer</button><button class="btn btn-outline" data-p="${page + 1}" ${page >= res.pagination.totalPages ? 'disabled' : ''}>Older ›</button>`;
        pg.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { page = Number(b.dataset.p); loadHistory(); }));
      } else if (pg) pg.innerHTML = `<span>${res.pagination.total} workout${res.pagination.total === 1 ? '' : 's'}</span>`;
    } catch (e) { if (!(e instanceof ApiError && e.status === 401)) box.innerHTML = notice('Could not load your history', e.message, { error: true }); }
  }

  async function loadFeedback() {
    const box = content.querySelector('#wl-feedback');
    try {
      const res = await api.get('/feedback', { type: 'workout', limit: 5 });
      box.innerHTML = res.data.length ? `<ul class="wl-fb">${res.data.map((f) => `<li><div class="wl-sub">${fmtDate(f.created_at, { day: 'numeric', month: 'short', year: 'numeric' })}${f.trainer_name ? ` · ${esc(f.trainer_name)}` : ''}</div><p>${esc(f.comment_text)}</p></li>`).join('')}</ul>`
        : emptyState('No workout feedback yet', 'When your trainer reviews your workouts, their feedback appears here.');
    } catch (e) { box.innerHTML = notice('Could not load feedback', e.message, { error: true }); }
  }

  content.innerHTML = '<div class="mp-muted mp-loading">Loading…</div>';
  try {
    const [w, ex] = await Promise.all([api.get('/workouts').then((r) => r.data), api.get('/exercises', { limit: 100 }).then((r) => r.data).catch(() => [])]);
    programs = w.activePrograms; catalogue = ex;
    content.innerHTML = `${formHtml()}
      <div class="wl-cols">
        <section class="card wl-section" aria-labelledby="wl-hist-h"><div class="wl-head"><h2 id="wl-hist-h">My workout history</h2>
          <div class="wl-filters"><label>From <input type="date" id="wl-from" class="select-filter"></label><label>To <input type="date" id="wl-to" class="select-filter"></label></div></div>
          <div id="wl-history"></div></section>
        <section class="card wl-section" aria-labelledby="wl-fb-h"><div class="wl-head"><h2 id="wl-fb-h">Trainer feedback</h2></div><div id="wl-feedback"></div></section>
      </div>`;
    fillExercises(); wireForm();
    content.querySelector('#wl-from').addEventListener('change', () => { page = 1; loadHistory(); });
    content.querySelector('#wl-to').addEventListener('change', () => { page = 1; loadHistory(); });
    await Promise.all([loadHistory(), loadFeedback()]);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) content.innerHTML = notice('Could not load your workout log', err.message || 'Unexpected error.', { error: true });
  }
}
