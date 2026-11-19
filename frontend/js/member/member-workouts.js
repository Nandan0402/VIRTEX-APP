/** Virtex Member Portal — member-workouts.html: programmes assigned by the member's trainer.
 *  Read:  GET  /api/v1/member/workouts      (active programmes → days → exercises, per-day completion, today's workout)
 *  Write: POST /api/v1/member/workout-logs  (record a completed session → visible in the trainer's Workout Logs)
 *  Programmes are read-only here: members can log sessions but never edit the trainer's programme.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';

const shell = await initShell({ page: 'workouts', title: 'Workouts', subtitle: 'How to train each muscle for bulking or cutting — and the programmes from your trainer' });

const NONE = '<span class="wk-none">—</span>';
const fmtDate = (v, o = { day: 'numeric', month: 'short' }) => (v ? esc(new Date(v).toLocaleDateString(undefined, o)) : NONE);
const dayLabel = (d) => esc(d.day_name || `Day ${d.day_number}`);
const rest = (s) => (s ? (s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}` : `${s}s`) : NONE);

function toast(message, error = false) {
  let el = document.getElementById('wk-toast');
  if (!el) { el = document.createElement('div'); el.id = 'wk-toast'; el.className = 'toast-banner mp-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.classList.toggle('error', error); el.textContent = message; el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 4500);
}

function dayStatus(d, isToday) {
  const c = d.completion;
  if (c.thisWeek > 0) return { cls: 'done', text: c.thisWeek > 1 ? `Done ${c.thisWeek}× this week` : 'Done this week' };
  if (isToday) return { cls: 'next', text: 'Up next' };
  if (c.lastCompletedAt) return { cls: 'past', text: `Last done ${new Date(c.lastCompletedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` };
  return { cls: 'todo', text: 'Not done yet' };
}

function dayDetail(p, d) {
  const ex = d.exercises || [];
  const groups = [...new Set(ex.map((e) => e.muscle_group).filter(Boolean))];
  return `<div class="wk-day" data-day="${d.id}">
    <div class="wk-day-head"><div><h3>${dayLabel(d)}${d.focus ? ` <span class="wk-focus">· ${esc(d.focus)}</span>` : ''}</h3>
      <div class="wk-groups">${groups.length ? groups.map((g) => `<span class="wk-chip">${esc(g)}</span>`).join('') : '<span class="wk-none">No muscle groups listed</span>'}</div></div>
      ${ex.length ? `<div class="wk-day-actions"><a class="btn btn-green" href="member-workout-details.html?program=${p.id}&day=${d.id}">▶ Start workout</a>
        <button class="btn btn-outline" data-log="${p.id}:${d.id}">✓ Quick log</button></div>` : ''}</div>
    ${ex.length ? `<div class="table-responsive"><table class="admin-table wk-table"><thead><tr><th>#</th><th>Exercise</th><th>Muscle group</th><th>Sets</th><th>Reps</th><th>Weight</th><th>Rest</th></tr></thead><tbody>
      ${ex.map((e, i) => `<tr><td class="wk-num">${i + 1}</td>
        <td><div class="wk-ex-name">${esc(e.exercise_name)}</div>${e.equipment ? `<div class="wk-sub">${esc(e.equipment)}</div>` : ''}
          ${e.notes ? `<div class="wk-note">📝 ${esc(e.notes)}</div>` : ''}
          ${e.instructions ? `<details class="wk-how"><summary>How to do it</summary><p>${esc(e.instructions)}</p></details>` : ''}</td>
        <td>${e.muscle_group ? esc(e.muscle_group) : NONE}</td><td class="wk-num">${e.sets ?? NONE}</td><td class="wk-num">${e.reps ? esc(e.reps) : NONE}</td>
        <td class="wk-num">${e.target_weight_kg !== null && e.target_weight_kg !== undefined ? `${esc(Number(e.target_weight_kg))} kg` : NONE}</td><td class="wk-num">${rest(e.rest_seconds)}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('No exercises on this day yet', 'Your trainer is still setting this day up.')}
    <div class="wk-log-slot" id="wk-log-${p.id}-${d.id}"></div>
  </div>`;
}

function programCard(p, assignment) {
  const days = (p.days || []).slice().sort((a, b) => a.day_number - b.day_number);
  const todayId = p.today?.dayId;
  const why = p.today ? (p.today.basis === 'start' ? 'First session — nothing logged yet'
    : `Next after ${esc(p.today.after?.day_name || 'your last session')} (${fmtDate(p.today.after?.completed_at)})`) : '';
  return `<section class="card wk-program" data-program="${p.id}">
    <div class="wk-prog-head"><div><h2>${esc(p.name)}</h2>
      <div class="wk-meta">${[p.goal, p.split_type, p.difficulty_level].filter(Boolean).map((x) => `<span class="wk-chip">${esc(x)}</span>`).join('')}
        <span class="wk-sub">by ${esc(assignment?.assigned_by || p.trainer_name || 'your trainer')} · since ${fmtDate(assignment?.start_date, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div></div>
      <span class="wk-lock" title="Only your trainer can change this programme">🔒 Set by your trainer</span></div>
    ${p.description ? `<p class="wk-desc">${esc(p.description)}</p>` : ''}
    ${assignment?.trainer_notes ? `<div class="wk-trainer-note"><b>Trainer notes:</b> ${esc(assignment.trainer_notes)}</div>` : ''}
    ${days.length ? `<h3 class="wk-subhead">Weekly plan <span class="wk-sub">${days.length} training day${days.length === 1 ? '' : 's'} in rotation${why ? ` · ${why}` : ''}</span></h3>
      <div class="wk-plan" role="tablist" aria-label="Training days">${days.map((d) => {
        const st = dayStatus(d, d.id === todayId);
        return `<button class="wk-plan-day wk-${st.cls}${d.id === todayId ? ' is-selected' : ''}" role="tab" aria-selected="${d.id === todayId}" data-pick="${p.id}:${d.id}">
          ${d.id === todayId ? '<span class="wk-today">TODAY</span>' : ''}<b>${dayLabel(d)}</b><small>${esc(d.focus || '')}</small><em>${esc(st.text)}</em></button>`;
      }).join('')}</div>
      <div class="wk-day-slot" id="wk-day-${p.id}">${dayDetail(p, days.find((d) => d.id === todayId) || days[0])}</div>`
      : emptyState('This programme has no training days yet', 'Your trainer is still building it.')}
  </section>`;
}

/** Completion form: member enters what they actually did; target values are hints only. */
function logForm(p, d) {
  const now = new Date(); now.setSeconds(0, 0);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const ex = d.exercises || [];
  return `<form class="wk-log" novalidate>
    <h4>Record completion — ${dayLabel(d)}</h4>
    <p class="wk-sub">Enter what you actually did. Only sets with reps filled in are saved — give the weight for each one (0 for bodyweight). Your trainer sees this log.</p>
    <div class="mp-form-grid">
      <div class="form-group"><label>Completed at *</label><input type="datetime-local" name="completedAt" value="${local}" max="${local}" required></div>
      <div class="form-group"><label>Duration (minutes) *</label><input type="number" name="durationMinutes" min="1" max="600" required></div>
      <div class="form-group"><label>Effort (RPE 1–10) *</label><select name="rpeRating" required><option value="">Select…</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">${n}${n === 1 ? ' — very easy' : n === 10 ? ' — maximal' : ''}</option>`).join('')}</select></div>
    </div>
    ${ex.map((e) => `<fieldset class="wk-sets"><legend>${esc(e.exercise_name)} <span class="wk-sub">target ${esc(e.sets ?? '?')} × ${esc(e.reps || '?')}${e.target_weight_kg ? ` @ ${esc(Number(e.target_weight_kg))} kg` : ''}</span></legend>
      ${Array.from({ length: Math.max(1, Math.min(Number(e.sets) || 1, 10)) }, (_, i) => `<div class="wk-set-row" data-ex="${e.exercise_id}" data-set="${i + 1}">
        <span>Set ${i + 1}</span>
        <label class="sr-only" for="r-${d.id}-${e.exercise_id}-${i}">Reps</label><input id="r-${d.id}-${e.exercise_id}-${i}" type="number" class="wk-reps" min="1" max="500" placeholder="reps${e.reps ? ` (${esc(e.reps)})` : ''}">
        <label class="sr-only" for="w-${d.id}-${e.exercise_id}-${i}">Weight kg</label><input id="w-${d.id}-${e.exercise_id}-${i}" type="number" class="wk-weight" min="0" max="1000" step="0.5" placeholder="kg${e.target_weight_kg ? ` (${esc(Number(e.target_weight_kg))})` : ''}">
      </div>`).join('')}</fieldset>`).join('')}
    <div class="form-group"><label>Notes for your trainer</label><textarea name="notes" maxlength="1000" rows="2"></textarea></div>
    <div class="wk-err" role="alert"></div>
    <div class="mp-form-actions"><button type="button" class="btn btn-outline" data-cancel>Cancel</button><button type="submit" class="btn btn-green">Save workout log</button></div>
  </form>`;
}

if (shell) {
  const { content } = shell;
  // Same read-only Workout Guide the gym admin sees, shown above the member's own programmes.
  const guide = document.createElement('section');
  guide.className = 'mg-guide'; guide.setAttribute('aria-label', 'Workout guide');
  content.before(guide);
  window.VirtexWorkoutGuide?.mount(guide, { note: "📘 General workout guide from your gym. Your personal trainer's programmes (if you have any) are below." });
  const planHead = document.createElement('h2');
  planHead.className = 'mg-plan-head'; planHead.textContent = "🧑‍🏫 Your trainer's programmes";
  content.before(planHead);
  let data = null;

  const findDay = (pid, did) => { const p = data.activePrograms.find((x) => x.id === pid); return { p, d: p?.days.find((x) => x.id === did) }; };

  function wire() {
    content.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const [pid, did] = b.dataset.pick.split(':').map(Number);
      const { p, d } = findDay(pid, did);
      content.querySelector(`#wk-day-${pid}`).innerHTML = dayDetail(p, d);
      content.querySelectorAll(`[data-program="${pid}"] .wk-plan-day`).forEach((x) => { const on = x === b; x.classList.toggle('is-selected', on); x.setAttribute('aria-selected', String(on)); });
      wireLogButtons();
    }));
    wireLogButtons();
  }

  function wireLogButtons() {
    content.querySelectorAll('[data-log]').forEach((b) => {
      if (b.dataset.wired) return; b.dataset.wired = '1';
      b.addEventListener('click', () => {
        const [pid, did] = b.dataset.log.split(':').map(Number);
        const { p, d } = findDay(pid, did);
        const slot = content.querySelector(`#wk-log-${pid}-${did}`);
        slot.innerHTML = logForm(p, d);
        b.disabled = true;
        const form = slot.querySelector('form');
        form.querySelector('[name="durationMinutes"]').focus();
        form.querySelector('[data-cancel]').addEventListener('click', () => { slot.innerHTML = ''; b.disabled = false; });
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const err = form.querySelector('.wk-err'); err.textContent = '';
          const duration = Number(form.durationMinutes.value); const rpe = Number(form.rpeRating.value);
          const sets = [...form.querySelectorAll('.wk-set-row')].map((r) => ({
            exerciseId: Number(r.dataset.ex), setNumber: Number(r.dataset.set),
            reps: r.querySelector('.wk-reps').value === '' ? null : Number(r.querySelector('.wk-reps').value),
            weightKg: r.querySelector('.wk-weight').value === '' ? undefined : Number(r.querySelector('.wk-weight').value),
          })).filter((s) => s.reps !== null);
          const problems = [];
          if (!(duration >= 1 && duration <= 600)) problems.push('Enter the workout duration (1–600 minutes).');
          if (!(rpe >= 1 && rpe <= 10)) problems.push('Choose how hard it felt (RPE 1–10).');
          if (!sets.length) problems.push('Fill in the reps for at least one set you completed.');
          if (sets.some((s) => !(s.reps >= 1 && s.reps <= 500))) problems.push('Reps must be between 1 and 500.');
          if (sets.some((s) => s.weightKg === undefined || !(s.weightKg >= 0 && s.weightKg <= 1000))) problems.push('Enter the weight for every set you log (0 for bodyweight).');
          if (problems.length) { err.textContent = problems.join(' '); return; }
          const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';
          try {
            await api.post('/workout-logs', {
              programId: pid, dayId: did, durationMinutes: duration, rpeRating: rpe,
              completedAt: new Date(form.completedAt.value).toISOString(), notes: form.notes.value.trim() || undefined,
              sets: sets.map(({ exerciseId, setNumber, reps, weightKg }) => ({ exerciseId, setNumber, reps, weightKg })),
            });
            toast('Workout logged — your trainer can now see it.');
            await load();
          } catch (e) {
            err.textContent = e.message || 'Could not save your workout.';
            btn.disabled = false; btn.textContent = 'Save workout log';
          }
        });
      });
    });
  }

  async function load() {
    data = (await api.get('/workouts')).data;
    const w = data.week;
    const today = data.activePrograms.map((p) => p.days.find((d) => d.id === p.today?.dayId)).find(Boolean);
    const past = data.assignments.filter((a) => a.status !== 'active');
    content.innerHTML = `
      <div class="wk-tiles">
        <div class="wk-tile"><span>This week</span><b>${w.sessionsLogged}${w.targetPerWeek ? ` / ${esc(w.targetPerWeek)}` : ''}</b><small>${w.targetPerWeek ? 'sessions logged vs your PT target' : 'sessions logged since Monday'}</small></div>
        <div class="wk-tile"><span>Today's workout</span><b>${today ? dayLabel(today) : '—'}</b><small>${today?.focus ? esc(today.focus) : today ? '' : 'No active programme'}</small></div>
        <div class="wk-tile"><span>Active programmes</span><b>${data.activePrograms.length}</b><small><a href="member-workout-logs.html">View my workout log</a></small></div>
      </div>
      ${data.activePrograms.length ? data.activePrograms.map((p) => programCard(p, data.assignments.find((a) => a.program_id === p.id && a.status === 'active'))).join('')
        : `<section class="card wk-empty">${emptyState('No workout programme assigned yet', 'Your trainer assigns your programme. Once they do, your training days and exercises appear here.')}
           <div class="wk-empty-links"><a class="btn btn-outline" href="member-trainer.html">My trainer</a></div></section>`}
      ${past.length ? `<details class="card wk-past"><summary>Previous programmes (${past.length})</summary><ul>${past.map((a) => `<li><b>${esc(a.program_name)}</b> · ${esc(a.status)} · ${fmtDate(a.start_date, { day: 'numeric', month: 'short', year: 'numeric' })}${a.end_date ? ` – ${fmtDate(a.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</li>`).join('')}</ul></details>` : ''}`;
    wire();
  }

  content.innerHTML = '<div class="mp-muted mp-loading">Loading your workouts…</div>';
  try { await load(); } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) content.innerHTML = notice('Could not load your workouts', err.message || 'Unexpected error.', { error: true });
  }
}
