/** Virtex Member Portal — member-classes.html: Classes.
 *  Uses: GET  /api/v1/member/classes?from=YYYY-MM-DD&days=14  (classes from the Admin Class & Shift Calendar)
 *        POST /api/v1/member/classes/:id/register              (server checks capacity, duplicates, open registration)
 *        POST /api/v1/member/classes/:id/cancel
 *  The admin controls the schedule; this page only reads it and books places.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'classes', title: 'Classes', subtitle: 'Yoga, group fitness and training sessions at the gym' });

const GROUPS = { yoga: ['🧘', 'Yoga'], group: ['💃', 'Group fitness'], training: ['🏋️', 'Training sessions'] };
const REG = {
  open: ['Registration open', 'open'],
  full: ['Full', 'full'],
  closed: ['Registration closed', 'closed'],
  registered: ['You are registered', 'mine'],
  cancelled: ['Cancelled by the gym', 'cancelled'],
  in_progress: ['In progress', 'closed'],
  finished: ['Finished', 'closed'],
};
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, k) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + k); return ymd(d); };
const time = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayHead = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

if (shell) {
  const { content } = shell;
  const today = ymd();
  let from = today; let filter = 'all'; let data = null; let busy = false; let flash = null;

  function card(c, { compact = false } = {}) {
    const [icon, groupLabel] = GROUPS[c.group] || ['📅', 'Class'];
    const [regLabel, regCls] = REG[c.registration] || [c.registration, 'closed'];
    const slots = c.capacity === null ? 'Open capacity'
      : c.registration === 'cancelled' ? `${c.capacity} places`
        : `${c.slotsLeft} of ${c.capacity} place${c.capacity === 1 ? '' : 's'} left`;
    const pct = c.capacity ? Math.min(100, Math.round((c.booked / c.capacity) * 100)) : 0;
    const lines = String(c.description || '').split('\n').filter(Boolean);
    return `<article class="cl-card cl-${regCls}${c.registration === 'cancelled' ? ' is-cancelled' : ''}">
      <div class="cl-time"><b>${esc(time(c.startsAt))}</b><span>${esc(time(c.endsAt))}</span>${compact ? `<small>${esc(new Date(c.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</small>` : ''}</div>
      <div class="cl-main">
        <div class="cl-top"><span class="cl-group">${icon} ${esc(groupLabel)}</span><span class="cl-reg cl-reg-${regCls}">${esc(regLabel)}</span></div>
        <h3>${esc(c.title)}</h3>
        <p class="cl-meta">${c.trainerName ? `👤 ${esc(c.trainerName)}` : '👤 Trainer not assigned'}${c.durationMins ? ` · ${c.durationMins} min` : ''}${c.difficulty && c.difficulty !== 'All Levels' ? ` · ${esc(c.difficulty)}` : ''}</p>
        ${lines.length && !compact ? `<p class="cl-desc">${lines.map(esc).join('<br>')}</p>` : ''}
        ${['finished', 'in_progress'].includes(c.registration) ? '' : c.capacity !== null && c.registration !== 'cancelled' ? `<div class="cl-slots"><div class="cl-bar" role="img" aria-label="${c.booked} of ${c.capacity} places booked"><span style="width:${pct}%"></span></div><small>${esc(slots)}</small></div>` : `<small class="cl-meta">${esc(slots)}</small>`}
      </div>
      <div class="cl-act">
        ${c.canRegister ? `<button type="button" class="btn btn-green" data-reg="${c.id}">Register</button>` : ''}
        ${c.canCancel ? `<button type="button" class="btn btn-outline" data-cancel="${c.id}">Cancel booking</button>` : ''}
      </div></article>`;
  }

  function render() {
    const list = data.classes.filter((c) => filter === 'all' || c.group === filter);
    const byDay = new Map();
    for (let i = 0; i < data.days; i++) byDay.set(addDays(from, i), []);
    list.forEach((c) => { const k = ymd(new Date(c.startsAt)); if (byDay.has(k)) byDay.get(k).push(c); });
    const counts = (g) => data.classes.filter((c) => g === 'all' || c.group === g).length;
    content.innerHTML = `<div class="pg-wrap">
      ${flash ? `<div class="${flash.error ? 'cl-flash err' : 'mm-flash'}" role="status">${esc(flash.text)}</div>` : ''}
      <section class="pg-card"><h2 class="pg-h">My bookings</h2>
        ${data.myBookings.length ? `<div class="cl-list">${data.myBookings.map((c) => card(c, { compact: true })).join('')}</div>`
          : '<p class="pg-muted">You have no upcoming class bookings.</p>'}</section>
      <section class="pg-card">
        <div class="cl-head"><h2 class="pg-h">Class timetable</h2>
          <div class="cl-nav"><button type="button" class="btn btn-outline" id="cl-prev"${from <= today ? ' disabled' : ''}>‹ Earlier</button>
            <span>${esc(dayHead(from))} – ${esc(dayHead(addDays(from, data.days - 1)))}</span>
            <button type="button" class="btn btn-outline" id="cl-next">Later ›</button></div></div>
        <div class="ac-chips cl-chips" role="group" aria-label="Filter classes">
          ${[['all', '📅', 'All classes'], ...Object.entries(GROUPS).map(([k, [i, l]]) => [k, i, l])].map(([k, i, l]) => `<button type="button" class="ac-chip${filter === k ? ' on' : ''}" data-f="${k}" aria-pressed="${filter === k}">${i} ${esc(l)} (${counts(k)})</button>`).join('')}
        </div>
        ${!data.classes.length ? '<p class="pg-muted">No classes are scheduled for these dates yet. The gym publishes classes from its class calendar — check back later.</p>' : ''}
        ${[...byDay.entries()].filter(([, cs]) => cs.length).map(([d, cs]) => `<h3 class="cl-day">${esc(d === today ? `Today · ${dayHead(d)}` : dayHead(d))}</h3><div class="cl-list">${cs.map((c) => card(c)).join('')}</div>`).join('')}
        ${data.classes.length && !list.length ? '<p class="pg-muted">No classes of this type in these dates.</p>' : ''}
        <p class="pg-foot">Places are limited and booked first come, first served. You can cancel a booking until the class starts.</p>
      </section></div>`;
    content.querySelector('#cl-prev')?.addEventListener('click', () => { from = addDays(from, -7) < today ? today : addDays(from, -7); load(); });
    content.querySelector('#cl-next')?.addEventListener('click', () => { from = addDays(from, 7); load(); });
    content.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; flash = null; render(); content.querySelector(`[data-f="${filter}"]`)?.focus(); }));
    content.querySelectorAll('[data-reg]').forEach((b) => b.addEventListener('click', () => act(b, 'register')));
    content.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => act(b, 'cancel')));
  }

  async function act(btn, kind) {
    if (busy) return;
    const id = btn.dataset.reg || btn.dataset.cancel;
    const c = [...data.classes, ...data.myBookings].find((x) => String(x.id) === String(id));
    if (kind === 'cancel' && !confirm(`Cancel your booking for "${c?.title || 'this class'}"? Your place will be released.`)) return;
    busy = true; btn.disabled = true; btn.textContent = kind === 'register' ? 'Registering…' : 'Cancelling…';
    try {
      await api.post(`/classes/${encodeURIComponent(id)}/${kind}`, {});
      flash = { text: kind === 'register' ? `You're registered for ${c?.title || 'the class'}.` : `Booking for ${c?.title || 'the class'} cancelled.` };
    } catch (e) {
      flash = { text: e instanceof ApiError ? e.message : 'Something went wrong — please try again.', error: true };
    } finally {
      busy = false;
      await load(); // always refresh: places may have changed
    }
  }

  async function load() {
    try {
      data = (await api.get('/classes', { from, days: 14 })).data;
      render();
    } catch (e) {
      content.innerHTML = notice('Could not load classes', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true });
    }
  }

  content.innerHTML = '<div class="mp-loading">Loading classes…</div>';
  await load();
}
