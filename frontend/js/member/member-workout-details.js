/** Virtex Member Portal — member-workout-details.html?program=<id>&day=<id>
 *  Read:  GET  /api/v1/member/workouts/:programId/days/:dayId   (404 unless the programme is assigned to this member)
 *  Write: POST /api/v1/member/workout-logs                       (completed session → trainer's Workout Logs)
 *  Start Workout runs a guided session (timer, set tick-off, rest countdown). The in-progress session is
 *  kept in this browser only (localStorage) so a refresh does not lose it; nothing is sent until "Save".
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';

const params = new URLSearchParams(location.search);
const programId = Number(params.get('program'));
const dayId = Number(params.get('day'));
const shell = await initShell({ page: 'workouts', title: 'Workout details', subtitle: 'Your assigned training session' });

const NONE = '<span class="wd-none">—</span>';
const restText = (s) => (s ? (s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60}s` : ''}` : `${s}s`) : null);
const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const KEY = `virtex_workout_session_${programId}_${dayId}`;
const loadSession = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const saveSession = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: session lives in memory only */ } };
const clearSession = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

/** YouTube → privacy-enhanced embed id; other https links open in a new tab; anything else is ignored. */
function media(url) {
  if (typeof url !== 'string') return null;
  const yt = url.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[?&#].*)?$/);
  if (yt) return { kind: 'youtube', id: yt[1], href: `https://www.youtube.com/watch?v=${yt[1]}` };
  if (/^https:\/\/[^\s"'<>]+$/.test(url)) return { kind: 'link', href: url };
  return null;
}

function toast(message, error = false) {
  let el = document.getElementById('wd-toast');
  if (!el) { el = document.createElement('div'); el.id = 'wd-toast'; el.className = 'toast-banner mp-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.classList.toggle('error', error); el.textContent = message; el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 4500);
}

function exerciseCard(e, i, session) {
  const m = media(e.video_url);
  const targets = String(e.target_muscles || '').split(/\s*,\s*/).filter(Boolean);
  const setCount = Math.max(1, Math.min(Number(e.sets) || 1, 10));
  const rows = session ? Array.from({ length: setCount }, (_, s) => {
    const st = session.sets[`${e.exercise_id}:${s + 1}`] || {};
    return `<div class="wd-set${st.done ? ' is-done' : ''}" data-key="${e.exercise_id}:${s + 1}" data-rest="${Number(e.rest_seconds) || 0}">
      <span class="wd-set-n">Set ${s + 1}</span>
      <input type="number" class="wd-reps" min="1" max="500" inputmode="numeric" aria-label="Reps for set ${s + 1}" placeholder="reps${e.reps ? ` (${esc(e.reps)})` : ''}" value="${st.reps ?? ''}">
      <input type="number" class="wd-weight" min="0" max="1000" step="0.5" inputmode="decimal" aria-label="Weight kg for set ${s + 1}" placeholder="kg${e.target_weight_kg !== null && e.target_weight_kg !== undefined ? ` (${esc(Number(e.target_weight_kg))})` : ''}" value="${st.weight ?? ''}">
      <button type="button" class="wd-done-btn" aria-pressed="${!!st.done}">${st.done ? '✓ Done' : 'Mark done'}</button>
    </div>`;
  }).join('') : '';
  return `<article class="card wd-ex" id="ex-${e.exercise_id}">
    <div class="wd-media">${m?.kind === 'youtube'
      ? `<button type="button" class="wd-play" data-yt="${esc(m.id)}" aria-label="Play demo video for ${esc(e.exercise_name)}"><span aria-hidden="true">▶</span><small>Play demo video</small></button>`
      : m?.kind === 'link' ? `<a class="wd-play" href="${esc(m.href)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▶</span><small>Open demo video</small></a>`
        : '<div class="wd-play wd-noplay"><span aria-hidden="true">🏋️</span><small>No demo video</small></div>'}</div>
    <div class="wd-body">
      <div class="wd-ex-head"><span class="wd-idx">${i + 1}</span><div><h2>${esc(e.exercise_name)}</h2>
        <div class="wd-chips">${e.muscle_group ? `<span class="wd-chip wd-chip-main">${esc(e.muscle_group)}</span>` : ''}${targets.map((t) => `<span class="wd-chip">${esc(t)}</span>`).join('')}${e.equipment ? `<span class="wd-chip">${esc(e.equipment)}</span>` : ''}</div></div></div>
      <dl class="wd-targets">
        <div><dt>Sets</dt><dd>${e.sets ?? NONE}</dd></div><div><dt>Reps</dt><dd>${e.reps ? esc(e.reps) : NONE}</dd></div>
        <div><dt>Target weight</dt><dd>${e.target_weight_kg !== null && e.target_weight_kg !== undefined ? `${esc(Number(e.target_weight_kg))} kg` : NONE}</dd></div>
        <div><dt>Rest</dt><dd>${restText(e.rest_seconds) ? esc(restText(e.rest_seconds)) : NONE}</dd></div></dl>
      ${e.notes ? `<div class="wd-note"><b>Trainer note:</b> ${esc(e.notes)}</div>` : ''}
      ${e.instructions ? `<details class="wd-how"${session ? '' : ' open'}><summary>Instructions</summary><p>${esc(e.instructions)}</p></details>` : '<p class="wd-none">No instructions provided.</p>'}
      ${session ? `<div class="wd-sets" aria-label="Your sets">${rows}</div>` : ''}
    </div></article>`;
}

if (shell) {
  const { content, actions } = shell;
  let data = null;
  let session = loadSession();
  let tick = null; let restTimer = null; let restLeft = 0;

  const elapsed = () => (session ? Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)) : 0);

  function bar() {
    if (!session) return '';
    return `<div class="wd-bar" role="region" aria-label="Workout in progress">
      <div><span class="wd-bar-label">Workout time</span><b id="wd-clock">${clock(elapsed())}</b></div>
      <div id="wd-rest" class="wd-rest" hidden><span class="wd-bar-label">Rest</span><b id="wd-rest-clock">00:00</b><button type="button" class="btn btn-outline" id="wd-rest-skip">Skip</button></div>
      <div class="wd-bar-progress"><span class="wd-bar-label">Sets done</span><b id="wd-done-count">0</b></div>
      <div class="wd-bar-actions"><button type="button" class="btn btn-outline" id="wd-discard">Discard</button><button type="button" class="btn btn-green" id="wd-finish">Finish workout</button></div>
    </div>`;
  }

  function render() {
    const p = data.program; const d = data.day;
    const c = data.completion;
    const status = c.thisWeek > 0 ? `<span class="wd-status wd-status-done">✓ Completed this week${c.thisWeek > 1 ? ` (${c.thisWeek}×)` : ''}</span>`
      : data.isNext ? '<span class="wd-status wd-status-next">Up next in your programme</span>'
        : c.lastCompletedAt ? `<span class="wd-status">Last completed ${esc(new Date(c.lastCompletedAt).toLocaleDateString())}</span>` : '<span class="wd-status">Not completed yet</span>';
    document.querySelector('.mp-page-heading h1').textContent = `${d.day_name || `Day ${d.day_number}`}${d.focus ? ` · ${d.focus}` : ''}`;
    document.querySelector('.mp-page-heading p').textContent = `${p.name} — assigned by ${p.assignedBy || 'your trainer'}`;
    actions.innerHTML = session ? '' : (d.exercises.length ? '<button type="button" class="btn btn-green wd-start" id="wd-start">▶ Start workout</button>' : '');
    content.innerHTML = `
      ${bar()}
      <section class="card wd-summary">
        <div class="wd-summary-row">${status}<span class="wd-lock">🔒 Set by your trainer</span></div>
        <nav class="wd-days" aria-label="Training days">${data.days.map((x) => `<a class="wd-day${x.id === d.id ? ' is-current' : ''}" href="member-workout-details.html?program=${p.id}&day=${x.id}"${x.id === d.id ? ' aria-current="page"' : ''}>${esc(x.day_name || `Day ${x.day_number}`)}${x.completedThisWeek ? ' ✓' : ''}</a>`).join('')}</nav>
        ${p.trainerNotes ? `<div class="wd-trainer-note"><b>Trainer notes:</b> ${esc(p.trainerNotes)}</div>` : ''}
      </section>
      ${d.exercises.length ? d.exercises.map((e, i) => exerciseCard(e, i, session)).join('') : emptyState('No exercises on this day yet', 'Your trainer is still setting this day up.')}
      <div id="wd-finish-slot"></div>
      <p class="wd-back"><a href="member-workouts.html">← Back to My Workouts</a></p>`;
    wire();
  }

  function updateCount() {
    const n = session ? Object.values(session.sets).filter((s) => s.done).length : 0;
    const el = document.getElementById('wd-done-count'); if (el) el.textContent = String(n);
  }

  function startRest(seconds) {
    clearInterval(restTimer);
    const box = document.getElementById('wd-rest'); if (!box || !seconds) return;
    restLeft = seconds; box.hidden = false;
    const paint = () => { document.getElementById('wd-rest-clock').textContent = clock(restLeft); box.classList.toggle('is-over', restLeft <= 0); };
    paint();
    restTimer = setInterval(() => { restLeft -= 1; paint(); if (restLeft <= 0) { clearInterval(restTimer); toast('Rest finished — next set!'); setTimeout(() => { box.hidden = true; }, 3000); } }, 1000);
  }

  function wire() {
    content.querySelectorAll('.wd-play[data-yt]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.yt;
      if (!/^[\w-]{11}$/.test(id)) return;
      const f = document.createElement('iframe');
      f.className = 'wd-video'; f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      f.title = 'Exercise demo video'; f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.allowFullscreen = true; f.loading = 'lazy';
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      b.replaceWith(f);
    }));
    document.getElementById('wd-start')?.addEventListener('click', () => {
      session = { startedAt: Date.now(), sets: {} }; saveSession(session); render(); startClock();
      document.querySelector('.wd-set .wd-reps')?.focus();
    });
    if (!session) return;
    content.querySelectorAll('.wd-set').forEach((row) => {
      const key = row.dataset.key;
      const sync = () => { session.sets[key] = { ...(session.sets[key] || {}), reps: row.querySelector('.wd-reps').value, weight: row.querySelector('.wd-weight').value }; saveSession(session); };
      row.querySelector('.wd-reps').addEventListener('input', sync);
      row.querySelector('.wd-weight').addEventListener('input', sync);
      row.querySelector('.wd-done-btn').addEventListener('click', (ev) => {
        sync();
        const st = session.sets[key];
        if (!st.done && !(Number(st.reps) >= 1)) { toast('Enter the reps you did before marking the set done.', true); row.querySelector('.wd-reps').focus(); return; }
        if (!st.done && st.weight === '') { toast('Enter the weight (0 for bodyweight) before marking the set done.', true); row.querySelector('.wd-weight').focus(); return; }
        st.done = !st.done; saveSession(session);
        row.classList.toggle('is-done', st.done);
        ev.currentTarget.setAttribute('aria-pressed', String(st.done)); ev.currentTarget.textContent = st.done ? '✓ Done' : 'Mark done';
        updateCount();
        if (st.done) startRest(Number(row.dataset.rest));
      });
    });
    document.getElementById('wd-rest-skip')?.addEventListener('click', () => { clearInterval(restTimer); document.getElementById('wd-rest').hidden = true; });
    document.getElementById('wd-discard')?.addEventListener('click', () => {
      if (!window.confirm('Discard this workout? Nothing will be saved.')) return;
      clearSession(); session = null; clearInterval(tick); clearInterval(restTimer); render();
    });
    document.getElementById('wd-finish')?.addEventListener('click', finishForm);
    updateCount();
  }

  function startClock() {
    clearInterval(tick);
    tick = setInterval(() => { const el = document.getElementById('wd-clock'); if (el) el.textContent = clock(elapsed()); }, 1000);
  }

  function finishForm() {
    const done = Object.entries(session.sets).filter(([, s]) => s.done);
    const slot = document.getElementById('wd-finish-slot');
    const minutes = Math.max(1, Math.round(elapsed() / 60));
    slot.innerHTML = `<section class="card wd-finish" aria-labelledby="wd-finish-h"><h2 id="wd-finish-h">Finish workout</h2>
      <p class="wd-sub">${done.length} set${done.length === 1 ? '' : 's'} marked done. Only those sets are saved, and your trainer will see this log.</p>
      <form id="wd-finish-form" novalidate><div class="mp-form-grid">
        <div class="form-group"><label for="wd-duration">Duration (minutes) *</label><input id="wd-duration" name="durationMinutes" type="number" min="1" max="600" value="${minutes}"><small class="wd-sub">Measured by the workout timer — adjust if needed.</small></div>
        <div class="form-group"><label for="wd-rpe">Effort (RPE 1–10) *</label><select id="wd-rpe" name="rpeRating"><option value="">Select…</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">${n}${n === 1 ? ' — very easy' : n === 10 ? ' — maximal' : ''}</option>`).join('')}</select></div></div>
        <div class="form-group"><label for="wd-notes">Notes for your trainer</label><textarea id="wd-notes" name="notes" maxlength="1000" rows="2"></textarea></div>
        <div class="wd-err" role="alert"></div>
        <div class="mp-form-actions"><button type="button" class="btn btn-outline" id="wd-keep">Keep training</button><button type="submit" class="btn btn-green">Save workout log</button></div>
      </form></section>`;
    slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('wd-keep').addEventListener('click', () => { slot.innerHTML = ''; });
    document.getElementById('wd-finish-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target; const err = f.querySelector('.wd-err');
      const duration = Number(f.durationMinutes.value); const rpe = Number(f.rpeRating.value);
      const sets = done.map(([k, s]) => { const [exerciseId, setNumber] = k.split(':').map(Number); return { exerciseId, setNumber, reps: Number(s.reps), weightKg: Number(s.weight) }; });
      const problems = [];
      if (!sets.length) problems.push('Mark at least one set as done.');
      if (!(duration >= 1 && duration <= 600)) problems.push('Enter the duration (1–600 minutes).');
      if (!(rpe >= 1 && rpe <= 10)) problems.push('Choose how hard it felt (RPE 1–10).');
      if (problems.length) { err.textContent = problems.join(' '); return; }
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await api.post('/workout-logs', { programId, dayId, durationMinutes: duration, rpeRating: rpe, completedAt: new Date().toISOString(), notes: f.notes.value.trim() || undefined, sets });
        clearSession(); session = null; clearInterval(tick); clearInterval(restTimer);
        toast('Workout saved — your trainer can now see it. Great job!');
        await load();
      } catch (e) { err.textContent = e.message || 'Could not save your workout.'; btn.disabled = false; btn.textContent = 'Save workout log'; }
    });
  }

  async function load() {
    data = (await api.get(`/workouts/${programId}/days/${dayId}`)).data;
    render();
    if (session) startClock();
  }

  if (!(programId > 0 && dayId > 0)) {
    content.innerHTML = `${notice('No workout selected', 'Open a training day from My Workouts.', { error: true })}<p class="wd-back"><a href="member-workouts.html">← Back to My Workouts</a></p>`;
  } else {
    content.innerHTML = '<div class="mp-muted mp-loading">Loading workout…</div>';
    try { await load(); } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        content.innerHTML = `${notice(err.status === 404 ? 'Workout not available' : 'Could not load this workout', err.status === 404 ? 'This workout is not assigned to your account. Open one of your own workouts from My Workouts.' : err.message, { error: true })}
          <p class="wd-back"><a href="member-workouts.html">← Back to My Workouts</a></p>`;
      }
    }
  }
}
