/** Virtex Trainer Hub — trainer-schedule.html: calendar and availability. */
import { api, ApiError } from './trainer-api.js';
import { initShell, esc, dash, fmtDate, fmtTime, emptyState, notice, renderError, openModal, formData, toast } from './trainer-navigation.js';

const shell = await initShell({ page: 'schedule', title: 'Schedule', subtitle: 'Weekly shifts, availability changes and booked sessions' });
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKS = 4;

/** Local YYYY-MM-DD (no UTC shift). */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Classes I teach — scheduled by Admin (class calendar + online classes). Read-only here. */
const CLASS_TYPE = { in_person: '🏃 In gym', live: '🎥 Live online', recorded: '🎬 Recorded' };
const CLASS_STATUS = { scheduled: 'Registration open', registration_closed: 'Registration closed', live_now: 'Live now', completed: 'Completed', cancelled: 'Cancelled' };
function classesTable(rows) {
  if (!rows.length) return '';
  return `<div class="card"><h3 class="tp-card-title">Classes you teach (scheduled by Admin)</h3><div class="table-responsive"><table class="admin-table">
    <thead><tr><th>When</th><th>Class</th><th>Type</th><th>Booked</th><th>Attended</th><th>Link</th><th>Status</th></tr></thead><tbody>
    ${rows.map((c) => `<tr><td class="tp-strong">${c.type === 'recorded' ? '—' : `${fmtDate(c.startsAt)} ${esc(new Date(c.startsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}`}</td>
      <td>${esc(c.title)}<div class="tp-muted">${dash(c.category)}${c.durationMins ? ` · ${c.durationMins} min` : ''}</div></td><td>${esc(CLASS_TYPE[c.type] || c.type)}</td>
      <td>${c.type === 'recorded' ? '—' : `${c.booked}${c.capacity ? ` / ${c.capacity}` : ''}`}</td><td>${c.type === 'recorded' ? '—' : c.attended}</td>
      <td>${c.type === 'in_person' ? '—' : c.linkProvided ? 'Added' : '<span class="tp-muted">Not added yet</span>'}</td><td>${esc(CLASS_STATUS[c.status] || c.status)}</td></tr>`).join('')}
    </tbody></table></div><p class="tp-muted tp-mt">Class times, places and links are managed by Admin. Ask an administrator to change them.</p></div>`;
}

/** Date-specific shifts rostered by Admin (Staff Operations → staff_shifts). */
function rosterTable(rows) {
  const upcoming = rows.filter((r) => ymd(new Date(r.shift_date)) >= ymd(new Date()));
  if (!upcoming.length) return '';
  return `<div class="card"><h3 class="tp-card-title">Rostered shifts (from Admin)</h3><div class="table-responsive"><table class="admin-table">
    <thead><tr><th>Date</th><th>Time</th><th>Shift</th><th>Branch</th><th>Status</th></tr></thead><tbody>
    ${upcoming.map((r) => `<tr><td class="tp-strong">${fmtDate(r.shift_date)}</td><td>${fmtTime(r.start_time)}–${fmtTime(r.end_time)}</td>
      <td>${dash(r.shift_type)}</td><td>${dash(r.branch_name)}</td><td>${dash(r.status)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

if (shell) {
  const { content, actions } = shell;
  actions.insertAdjacentHTML('beforeend', '<button class="btn btn-green" id="add">+ Availability change</button>');
  let weekOffset = 0;

  async function loadSessions(from, to) {
    try {
      const res = await api.get('/pt-sessions', { from: from.toISOString(), to: to.toISOString(), limit: 100 });
      return { rows: res.data, available: true };
    } catch (err) {
      if (err instanceof ApiError && err.migrationsPending) return { rows: [], available: false };
      throw err;
    }
  }

  function calendar(start, schedule, sessions, classes = []) {
    const today = ymd(new Date());
    const byDate = new Map();
    schedule.upcomingAvailability.forEach((a) => {
      const k = ymd(new Date(a.specific_date));
      byDate.set(k, [...(byDate.get(k) || []), a]);
    });
    const rosterByDate = new Map();
    (schedule.staffShifts || []).forEach((r) => {
      const k = ymd(new Date(r.shift_date));
      rosterByDate.set(k, [...(rosterByDate.get(k) || []), r]);
    });
    const sessByDate = new Map();
    sessions.rows.forEach((s) => {
      const k = ymd(new Date(s.scheduled_start));
      sessByDate.set(k, [...(sessByDate.get(k) || []), s]);
    });
    const classByDate = new Map();
    classes.filter((c) => c.type !== 'recorded' && c.status !== 'cancelled').forEach((c) => {
      const k = ymd(new Date(c.startsAt));
      classByDate.set(k, [...(classByDate.get(k) || []), c]);
    });
    const cells = [];
    for (let i = 0; i < WEEKS * 7; i += 1) {
      const d = addDays(start, i);
      const key = ymd(d);
      const shifts = schedule.weekly.filter((w) => Number(w.day_of_week) === d.getDay());
      const changes = byDate.get(key) || [];
      const sess = sessByDate.get(key) || [];
      const roster = rosterByDate.get(key) || [];
      const past = key < today;
      cells.push(`<div class="tp-cal-day${key === today ? ' is-today' : ''}${past ? ' is-past' : ''}" ${past ? '' : `data-date="${key}" role="button" tabindex="0" aria-label="Add availability change for ${esc(d.toDateString())}"`}>
        <div class="tp-cal-num">${d.getDate()}${d.getDate() === 1 || i === 0 ? ` <span>${esc(d.toLocaleDateString(undefined, { month: 'short' }))}</span>` : ''}</div>
        ${shifts.map((s) => `<div class="tp-cal-ev ${s.is_available ? 'ev-shift' : 'ev-off'}">${fmtTime(s.shift_start)}–${fmtTime(s.shift_end)}</div>`).join('')}
        ${roster.map((r) => `<div class="tp-cal-ev ev-roster" title="${esc([r.shift_type, r.branch_name, r.status].filter(Boolean).join(' · '))}">◆ ${fmtTime(r.start_time)}–${fmtTime(r.end_time)}</div>`).join('')}
        ${changes.map((a) => `<div class="tp-cal-ev ${a.is_available ? 'ev-extra' : 'ev-block'}" title="${esc(a.reason || '')}">${a.is_available ? '+' : '✕'} ${fmtTime(a.start_time)}–${fmtTime(a.end_time)}</div>`).join('')}
        ${sess.length ? `<div class="tp-cal-ev ev-session">🤝 ${sess.length} session${sess.length === 1 ? '' : 's'}</div>` : ''}
        ${(classByDate.get(key) || []).map((c) => `<div class="tp-cal-ev ev-session" title="${esc(c.title)}">${c.type === 'live' ? '🎥' : '🏃'} ${esc(new Date(c.startsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))} ${esc(c.title)}</div>`).join('')}
      </div>`);
    }
    const end = addDays(start, WEEKS * 7 - 1);
    return `<div class="card">
      <div class="card-header tp-card-head"><h3 class="tp-card-title">${esc(start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))} – ${esc(end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</h3>
        <div class="tp-cal-nav"><button class="btn btn-outline" data-w="-1" ${weekOffset <= 0 ? 'disabled' : ''} aria-label="Previous weeks">‹</button>
          <button class="btn btn-outline" data-w="0">Today</button><button class="btn btn-outline" data-w="1" aria-label="Next weeks">›</button></div></div>
      <div class="tp-cal" role="grid">
        ${DAYS.map((d) => `<div class="tp-cal-head" role="columnheader">${d.slice(0, 3)}</div>`).join('')}
        ${cells.join('')}
      </div>
      <div class="tp-cal-legend"><span class="ev-shift">Weekly shift</span><span class="ev-roster">Rostered shift (Admin)</span><span class="ev-extra">Extra availability</span><span class="ev-block">Unavailable</span><span class="ev-session">PT sessions / classes</span></div>
      ${sessions.available ? '' : '<div class="tp-muted tp-mt">PT sessions appear on the calendar after the Trainer Hub database update.</div>'}
    </div>`;
  }

  async function load() {
    content.innerHTML = '<div class="tp-muted tp-loading">Loading schedule…</div>';
    try {
      const now = new Date();
      const start = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -now.getDay() + weekOffset * 7);
      const [schedule, sessions, classes] = await Promise.all([
        api.get('/schedule').then((r) => r.data),
        loadSessions(start, addDays(start, WEEKS * 7)),
        api.get('/classes', { from: ymd(start), days: WEEKS * 7 }).then((r) => r.data).catch(() => []),
      ]);
      const weekly = schedule.weekly.length ? `<div class="table-responsive"><table class="admin-table"><thead><tr><th>Day</th><th>Shift</th><th>Status</th><th>Notes</th></tr></thead><tbody>
        ${schedule.weekly.map((w) => `<tr><td class="tp-strong">${esc(DAYS[w.day_of_week] ?? w.day_of_week)}</td><td>${fmtTime(w.shift_start)}–${fmtTime(w.shift_end)}</td>
          <td>${w.is_available ? '<span class="badge badge-green">available</span>' : '<span class="badge badge-danger">off</span>'}</td><td>${dash(w.notes)}</td></tr>`).join('')}
        </tbody></table></div>` : emptyState('No weekly shifts set', 'Your weekly shift pattern is set by an administrator.');
      const avail = schedule.upcomingAvailability.length ? `<div class="table-responsive"><table class="admin-table"><thead><tr><th>Date</th><th>Time</th><th>Type</th><th>Reason</th></tr></thead><tbody>
        ${schedule.upcomingAvailability.map((a) => `<tr><td class="tp-strong">${fmtDate(a.specific_date)}</td><td>${fmtTime(a.start_time)}–${fmtTime(a.end_time)}</td>
          <td>${a.is_available ? '<span class="badge badge-green">extra availability</span>' : '<span class="badge badge-danger">unavailable</span>'}</td><td>${dash(a.reason)}</td></tr>`).join('')}
        </tbody></table></div>` : emptyState('No upcoming changes', 'Click a day on the calendar to block time or add extra availability.');
      content.innerHTML = `${!schedule.weekly.length && !schedule.upcomingAvailability.length
        ? notice('No schedule yet', 'You have no weekly shifts or availability changes. Weekly shifts are set by an administrator; you can add date-specific changes here.') : ''}
        ${calendar(start, schedule, sessions, classes)}
        ${classesTable(classes)}
        ${rosterTable(schedule.staffShifts || [])}
        <div class="tp-grid-2"><div class="card"><h3 class="tp-card-title">Weekly shifts</h3>${weekly}</div>
        <div class="card"><h3 class="tp-card-title">Upcoming availability changes</h3>${avail}</div></div>`;
      content.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
        const w = Number(b.dataset.w);
        weekOffset = w === 0 ? 0 : Math.max(0, weekOffset + w * WEEKS);
        load();
      }));
      content.querySelectorAll('.tp-cal-day[data-date]').forEach((c) => {
        c.addEventListener('click', () => addChange(c.dataset.date));
        c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addChange(c.dataset.date); } });
      });
    } catch (err) { renderError(content, err, 'Schedule'); }
  }

  function addChange(date = '') {
    const today = ymd(new Date());
    const { el, close } = openModal('Add availability change', `<form id="f">
      <div class="tp-form-grid"><div class="form-group"><label>Date *</label><input type="date" name="specificDate" min="${today}" value="${esc(date)}" required></div>
      <div class="form-group"><label>Start *</label><input type="time" name="startTime" required></div>
      <div class="form-group"><label>End *</label><input type="time" name="endTime" required></div>
      <div class="form-group"><label>Type</label><select name="isAvailable"><option value="false">Unavailable (leave / blocked)</option><option value="true">Extra availability</option></select></div></div>
      <div class="form-group"><label>Reason</label><input name="reason" maxlength="150"></div>
      <div class="tp-form-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-green" type="submit">Save</button></div></form>`);
    el.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      body.isAvailable = body.isAvailable === 'true';
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try { await api.post('/schedule/availability', body); toast('Availability saved.'); close(); load(); }
      catch (err) { toast(err.message, { error: true }); btn.disabled = false; }
    });
  }

  actions.querySelector('#add').addEventListener('click', () => addChange());
  load();
}
