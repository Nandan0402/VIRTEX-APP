/** Virtex Member Portal — member-online-classes.html: Online Classes.
 *  Uses: GET  /api/v1/member/online-classes            (live + recorded classes, attendance, video lessons)
 *        POST /api/v1/member/online-classes/:id/register
 *        POST /api/v1/member/online-classes/:id/cancel
 *  Classes, meeting links and videos are added by gym staff in the Admin online-class module.
 *  This page never creates a link: the server only sends a meeting link to registered members
 *  shortly before the class, and only https links entered by staff.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'online-classes', title: 'Online Classes', subtitle: 'Live classes, recorded workouts and video lessons' });

const TABS = [['live', '🔴 Live classes'], ['recorded', '🎬 Recorded classes'], ['lessons', '📚 Video lessons'], ['attendance', '🗂️ Attendance history']];
const REG = {
  open: ['Registration open', 'open'], full: ['Full', 'full'], closed: ['Registration closed', 'closed'],
  registered: ['You are registered', 'mine'], cancelled: ['Cancelled by the gym', 'cancelled'],
  in_progress: ['In progress', 'closed'], finished: ['Finished', 'closed'],
};
const OUTCOME = { attended: ['Attended', 'ok'], not_attended: ['Not attended', 'no'], not_recorded: ['Attendance not recorded yet', 'na'], class_cancelled: ['Class cancelled', 'no'], upcoming: ['Upcoming', 'na'] };
const when = (d) => new Date(d).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const time = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const ext = (url, label, cls = 'btn btn-green') => `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const instructor = (i) => (i ? `👤 ${esc(i.name)}${i.specialty ? ` · ${esc(i.specialty)}` : ''}` : '👤 Instructor not assigned');

if (shell) {
  const { content } = shell;
  let data = null; let tab = 'live'; let busy = false; let flash = null;
  try { const t = new URLSearchParams(location.search).get('tab'); if (TABS.some(([k]) => k === t)) tab = t; } catch { /* ignore */ }

  function liveCard(c) {
    const [label, cls] = REG[c.registration] || [c.registration, 'closed'];
    let linkArea = '';
    if (c.joinUrl) linkArea = ext(c.joinUrl, c.liveNow ? 'Join live class now' : 'Join class');
    else if (c.registration === 'registered') {
      linkArea = c.linkProvided
        ? `<small class="oc-note">Join link appears here from ${esc(time(c.joinOpensAt))}.</small>`
        : '<small class="oc-note">The gym has not added a meeting link yet.</small>';
    }
    const slots = c.capacity === null ? '' : `<small>${c.slotsLeft} of ${c.capacity} places left</small>`;
    return `<article class="cl-card cl-${cls}${c.registration === 'cancelled' ? ' is-cancelled' : ''}">
      <div class="cl-time"><b>${esc(time(c.startsAt))}</b><span>${esc(time(c.endsAt))}</span><small>${esc(new Date(c.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</small></div>
      <div class="cl-main">
        <div class="cl-top"><span class="cl-group">${esc(c.category || 'Live class')}</span>${c.liveNow ? '<span class="cl-reg oc-live">● Live now</span>' : ''}<span class="cl-reg cl-reg-${cls}">${esc(label)}</span></div>
        <h3>${esc(c.title)}</h3>
        <p class="cl-meta">${instructor(c.instructor)}${c.durationMins ? ` · ${c.durationMins} min` : ''}${c.difficulty ? ` · ${esc(c.difficulty)}` : ''}</p>
        ${c.description ? `<p class="cl-desc">${esc(c.description)}</p>` : ''}
        ${['finished', 'cancelled'].includes(c.registration) ? '' : `<div class="cl-slots">${slots}</div>`}
      </div>
      <div class="cl-act">
        ${c.canRegister ? `<button type="button" class="btn btn-green" data-reg="${c.id}">Register</button>` : ''}
        ${linkArea}
        ${c.canCancel ? `<button type="button" class="btn btn-outline" data-cancel="${c.id}">Cancel booking</button>` : ''}
      </div></article>`;
  }

  function recordedCard(c) {
    return `<article class="oc-vod">
      <div class="oc-vod-top"><span class="cl-group">🎬 ${esc(c.category || 'Recorded')}</span>${c.durationMins ? `<small>${c.durationMins} min</small>` : ''}</div>
      <h3>${esc(c.title)}</h3>
      <p class="cl-meta">${instructor(c.instructor)}${c.difficulty ? ` · ${esc(c.difficulty)}` : ''}</p>
      ${c.description ? `<p class="cl-desc">${esc(c.description)}</p>` : ''}
      <div class="oc-vod-act">${c.watchUrl ? ext(c.watchUrl, 'Watch recording') : '<small class="oc-note">Video not available yet — the gym has not added a link.</small>'}</div>
    </article>`;
  }

  function liveTab() {
    const upcoming = data.live.filter((c) => c.registration !== 'finished');
    if (!upcoming.length) return `<p class="pg-muted">No live online classes are scheduled in the next ${data.days} days. New classes appear here when the gym schedules them.</p>`;
    const mine = upcoming.filter((c) => c.registration === 'registered');
    return `${mine.length ? `<h3 class="cl-day">Your registered classes</h3><div class="cl-list">${mine.map(liveCard).join('')}</div>` : ''}
      <h3 class="cl-day">Schedule — next ${data.days} days</h3><div class="cl-list">${upcoming.map(liveCard).join('')}</div>
      <p class="pg-foot">Meeting links are added by the gym. Registered members see the join button from 15 minutes before the class starts.</p>`;
  }
  function recordedTab() {
    if (!data.recorded.length) return '<p class="pg-muted">No recorded classes have been published yet.</p>';
    return `<div class="oc-grid">${data.recorded.map(recordedCard).join('')}</div>`;
  }
  function lessonsTab() {
    if (!data.courses.length) return '<p class="pg-muted">Video lessons appear here for courses you are enrolled in. You are not enrolled in a course with lessons yet.</p>';
    return data.courses.map((c) => `<section class="oc-course"><h3>${esc(c.title)}</h3>
      <p class="cl-meta">${c.instructor ? `👤 ${esc(c.instructor)} · ` : ''}${c.level ? `${esc(c.level)} · ` : ''}${c.lessons.length} lesson${c.lessons.length === 1 ? '' : 's'}</p>
      <ol class="oc-lessons">${c.lessons.map((l) => `<li><span class="oc-l-num">${esc(l.order ?? '')}</span><div><b>${esc(l.title)}</b>${l.durationMins ? `<small>${l.durationMins} min</small>` : ''}</div>
        ${l.videoUrl ? ext(l.videoUrl, 'Watch', 'btn btn-outline') : '<small class="oc-note">No video yet</small>'}</li>`).join('')}</ol></section>`).join('');
  }
  function attendanceTab() {
    if (!data.attendance.length) return '<p class="pg-muted">No class attendance yet. Classes you register for appear here after they take place. Attendance is recorded by the gym.</p>';
    const typeLabel = { live: '🎥 Live online', recorded: '🎬 Recorded', in_person: '🏃 In gym' };
    return `<div class="pg-scroll"><table class="admin-table pg-tbl oc-tbl"><thead><tr><th>Class</th><th>When</th><th>Type</th><th>Instructor</th><th>Attendance</th></tr></thead><tbody>
      ${data.attendance.map((a) => { const [l, c] = OUTCOME[a.outcome] || [a.outcome, 'na']; return `<tr><td>${esc(a.title)}</td><td>${esc(dDate(a.startsAt))}</td><td>${esc(typeLabel[a.type] || a.type)}</td><td>${esc(a.instructor || '—')}</td><td><span class="oc-out oc-out-${c}">${esc(l)}</span></td></tr>`; }).join('')}
      </tbody></table></div><p class="pg-foot">Attendance is recorded by gym staff. “Not recorded yet” means staff have not marked it — it is not counted as missed.</p>`;
  }

  function render() {
    const count = { live: data.live.filter((c) => c.registration !== 'finished').length, recorded: data.recorded.length, lessons: data.courses.reduce((n, c) => n + c.lessons.length, 0), attendance: data.attendance.length };
    const body = { live: liveTab, recorded: recordedTab, lessons: lessonsTab, attendance: attendanceTab }[tab]();
    content.innerHTML = `<div class="pg-wrap">
      ${flash ? `<div class="${flash.error ? 'cl-flash err' : 'mm-flash'}" role="status">${esc(flash.text)}</div>` : ''}
      <section class="pg-card"><div class="ac-chips" role="tablist" aria-label="Online classes">
        ${TABS.map(([k, l]) => `<button type="button" role="tab" class="ac-chip${tab === k ? ' on' : ''}" aria-selected="${tab === k}" data-tab="${k}">${l} (${count[k]})</button>`).join('')}
      </div>${body}</section></div>`;
    content.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; flash = null; render(); content.querySelector(`[data-tab="${tab}"]`)?.focus(); }));
    content.querySelectorAll('[data-reg]').forEach((b) => b.addEventListener('click', () => act(b, 'register')));
    content.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => act(b, 'cancel')));
  }

  async function act(btn, kind) {
    if (busy) return;
    const id = btn.dataset.reg || btn.dataset.cancel;
    const c = data.live.find((x) => String(x.id) === String(id));
    if (kind === 'cancel' && !confirm(`Cancel your booking for "${c?.title || 'this class'}"?`)) return;
    busy = true; btn.disabled = true; btn.textContent = kind === 'register' ? 'Registering…' : 'Cancelling…';
    try {
      await api.post(`/online-classes/${encodeURIComponent(id)}/${kind}`, {});
      flash = { text: kind === 'register' ? `You're registered for ${c?.title || 'the class'}.` : `Booking for ${c?.title || 'the class'} cancelled.` };
    } catch (e) {
      flash = { text: e instanceof ApiError ? e.message : 'Something went wrong — please try again.', error: true };
    } finally { busy = false; await load(); }
  }

  async function load() {
    try { data = (await api.get('/online-classes')).data; render(); }
    catch (e) { content.innerHTML = notice('Could not load online classes', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true }); }
  }

  content.innerHTML = '<div class="mp-loading">Loading online classes…</div>';
  await load();
  // Join buttons appear at the right time without a manual refresh (only while a registered class is near).
  setInterval(() => { if (!busy && document.visibilityState === 'visible' && data?.live.some((c) => c.registration === 'registered' && !c.joinUrl && c.linkProvided && new Date(c.joinOpensAt) <= new Date())) load(); }, 60000);
}
