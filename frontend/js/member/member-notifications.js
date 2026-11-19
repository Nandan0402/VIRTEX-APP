/** Virtex Member Portal — member-notifications.html.
 *  Uses: GET  /api/v1/member/notifications                  (my inbox + reminders built from my own records)
 *        POST /api/v1/member/notifications/:id/read
 *        POST /api/v1/member/notifications/read-all
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'notifications', title: 'Notifications', subtitle: 'Messages, reminders and account updates' });

const TYPES = {
  workout: ['🏋️', 'New workout'], diet: ['🥗', 'Diet plan'], pt_reminder: ['🤝', 'PT session'], class_reminder: ['📅', 'Classes'],
  membership: ['🪪', 'Membership'], payment: ['💳', 'Payments'], feedback: ['💬', 'Trainer feedback'],
  announcement: ['📢', 'Announcements & polls'],
};
const INBOX_ICON = { new_message: '✉️', feedback: '💬', workout_assigned: '🏋️', diet_assigned: '🥗', session_reminder: '🤝', session_booked: '🤝', session_cancelled: '🤝', package_expiring: '🪪', system: '🔔' };
const when = (d) => {
  const x = new Date(d); const diff = (Date.now() - x.getTime()) / 60000;
  if (diff >= 0 && diff < 60) return `${Math.max(1, Math.round(diff))} min ago`;
  if (diff >= 0 && diff < 1440) return `${Math.round(diff / 60)} h ago`;
  return x.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const safeLink = (l) => (typeof l === 'string' && /^member-[a-z0-9-]+\.html(\?[\w=&%.-]*)?$/i.test(l) ? l : null);

if (shell) {
  const { content } = shell;
  let data = null; let filter = 'all';

  function inboxHtml() {
    const ib = data.inbox;
    if (!ib.available) return '<section class="pg-card"><h2 class="pg-h">Inbox</h2><p class="pg-muted">Message alerts will appear here once the gym switches on in-app notifications.</p></section>';
    return `<section class="pg-card"><div class="cl-head"><h2 class="pg-h">Inbox ${ib.unread ? `<span class="ms-badge">${ib.unread} unread</span>` : ''}</h2>
        ${ib.unread ? '<button type="button" class="btn btn-outline nt-all" id="nt-all">Mark all as read</button>' : ''}</div>
      ${ib.items.length ? `<ul class="nt-list">${ib.items.map((n) => `<li class="nt-item${n.readAt ? '' : ' unread'}">
          <span class="nt-ic" aria-hidden="true">${INBOX_ICON[n.type] || '🔔'}</span>
          <div class="nt-main"><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}<small>${esc(when(n.createdAt))}${n.readAt ? ' · read' : ''}</small></div>
          <div class="nt-act">${safeLink(n.link) ? `<a class="btn btn-outline" href="${esc(safeLink(n.link))}" data-read="${esc(n.id)}">Open</a>` : ''}
            ${n.readAt ? '' : `<button type="button" class="btn btn-outline" data-mark="${esc(n.id)}">Mark read</button>`}</div></li>`).join('')}</ul>`
        : '<p class="pg-muted">No notifications yet.</p>'}</section>`;
  }

  function updatesHtml() {
    const u = data.updates;
    const present = [...new Set(u.map((x) => x.type))];
    const list = u.filter((x) => filter === 'all' || x.type === filter);
    return `<section class="pg-card"><h2 class="pg-h">Reminders &amp; updates</h2>
      <p class="pg-muted">From your own records — workouts, diet plans, bookings, membership and payments.${data.ptAvailable ? '' : ' PT session reminders start once PT sessions are switched on.'}</p>
      ${present.length > 1 ? `<div class="ac-chips" role="group" aria-label="Filter">${['all', ...Object.keys(TYPES).filter((k) => present.includes(k))].map((k) => `<button type="button" class="ac-chip${filter === k ? ' on' : ''}" data-f="${k}" aria-pressed="${filter === k}">${k === 'all' ? 'All' : `${TYPES[k][0]} ${TYPES[k][1]}`}</button>`).join('')}</div>` : ''}
      ${list.length ? `<ul class="nt-list">${list.map((x) => `<li class="nt-item${x.urgent ? ' urgent' : ''}"><span class="nt-ic" aria-hidden="true">${TYPES[x.type]?.[0] || '🔔'}</span>
          <div class="nt-main"><b>${esc(x.title)}</b>${x.body ? `<p>${esc(x.body)}</p>` : ''}<small>${esc(TYPES[x.type]?.[1] || '')} · ${esc(when(x.at))}</small></div>
          <div class="nt-act">${safeLink(x.link) ? `<a class="btn btn-outline" href="${esc(safeLink(x.link))}">View</a>` : ''}</div></li>`).join('')}</ul>`
        : '<p class="pg-muted">Nothing new. Reminders appear here for upcoming bookings, plan changes, membership and payments.</p>'}</section>`;
  }

  function render() {
    content.innerHTML = `<div class="pg-wrap">${inboxHtml()}${updatesHtml()}</div>`;
    content.querySelector('#nt-all')?.addEventListener('click', async (e) => { e.target.disabled = true; try { await api.post('/notifications/read-all', {}); } catch { /* ignore */ } await load(); });
    content.querySelectorAll('[data-mark]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; try { await api.post(`/notifications/${encodeURIComponent(b.dataset.mark)}/read`, {}); } catch { /* ignore */ } await load(); }));
    content.querySelectorAll('a[data-read]').forEach((a) => a.addEventListener('click', () => { api.post(`/notifications/${encodeURIComponent(a.dataset.read)}/read`, {}).catch(() => {}); }));
    content.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));
  }

  async function load() {
    try { data = (await api.get('/notifications')).data; render(); }
    catch (e) { content.innerHTML = notice('Could not load notifications', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true }); }
  }
  content.innerHTML = '<div class="mp-loading">Loading notifications…</div>';
  await load();
}
