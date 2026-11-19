/**
 * Virtex Member Portal — shared layout (sidebar, topbar, breadcrumbs, page header,
 * profile menu, mobile navigation), session guard and small UI helpers.
 *
 * Every member-<page>.js starts with:
 *   const shell = await initShell({ page: 'workouts', title: 'My Workouts', subtitle: '…' });
 *   if (shell) { shell.content.innerHTML = …; }
 * initShell returns null when the page must not continue (not signed in, wrong role,
 * or the account is not linked to a member profile).
 */
import { api } from './member-api.js';
import { trackUnread, pollWhileVisible } from '../components/notifySound.js';
import { getToken, getStoredProfile, getStoredRole, redirectToLogin, signOut } from './member-auth.js';
import { MENU, findPage, renderSidebar, renderTabs, initSidebar, menuKeyFor, isHidden } from './member-sidebar.js';
import { mountPunch } from './member-punch.js';

/** Re-exported for pages that need the menu definition. */
export { MENU };


// ------------------------------------------------------------------ helpers

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));

export function notice(title, text, { error = false } = {}) {
  return `<div class="mp-notice${error ? ' mp-error' : ''}"><span aria-hidden="true">${error ? '⚠️' : 'ℹ️'}</span>
    <div><strong>${esc(title)}</strong><div class="mp-notice-text">${esc(text)}</div></div></div>`;
}

export function emptyState(title, text = '') {
  return `<div class="mp-empty"><div class="mp-empty-title">${esc(title)}</div>${text ? `<div class="mp-muted">${esc(text)}</div>` : ''}</div>`;
}

/** Placeholder used while a page's feature is still to be built (no data is invented). */
export function comingSoon(what) {
  return notice('Coming next', `${what} will appear here once this page is connected. Nothing is shown until then.`);
}

// ------------------------------------------------------------------ layout

const LOGO = '<svg class="mp-brand-logo" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="1.25" y="1.25" width="29.5" height="29.5" rx="9" fill="#13161f" stroke="#00e676" stroke-width="1.6"/><path d="M7.2 6.8h4.6L16 17.2V22h-2.1z" fill="#00e676"/><path d="M16 17.2l4.2-10.4h4.6L18.1 22H16z" fill="#22d3ee"/><path d="M6.2 25.6h5.4l1.3-2.3 1.7 4 1.4-1.7h9.8" stroke="#00e676" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function breadcrumbs(page, title) {
  const { parent } = findPage(page);
  const crumbs = [{ label: 'Member Portal', href: page === 'dashboard' ? null : 'member-dashboard.html' }];
  if (parent && parent.label !== title) crumbs.push({ label: parent.label });
  crumbs.push({ label: title, current: true });
  return `<nav class="mp-breadcrumbs" aria-label="Breadcrumb"><ol>${crumbs.map((c) => `<li>${c.href
    ? `<a href="${c.href}">${esc(c.label)}</a>` : `<span${c.current ? ' aria-current="page"' : ''}>${esc(c.label)}</span>`}</li>`).join('')}</ol></nav>`;
}

function renderShell({ page, title, subtitle, visible = null }) {
  document.body.classList.add('mp-body', `mp-page-${page}`);
  document.body.innerHTML = `<a class="mp-skip" href="#mp-content">Skip to content</a>
  <div class="mp-shell">
    ${renderSidebar(page, visible)}
    <div class="mp-main">
      <header class="mp-topbar">
        <button class="mp-menu-btn" id="mp-menu-btn" aria-label="Open menu" aria-controls="mp-sidebar" aria-expanded="false">☰</button>
        <div class="mp-topbar-brand">${LOGO}<span>Member Portal</span></div>
        <div class="mp-punch" id="mp-punch"></div>
        <div class="mp-profile" id="mp-profile">
          <button class="mp-profile-btn" id="mp-profile-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="mp-profile-menu">
            <span class="mp-avatar" id="mp-avatar">–</span>
            <span class="mp-profile-meta"><span class="mp-user-name" id="mp-user-name">Loading…</span><span class="mp-user-role" id="mp-user-role">member</span></span>
            <span class="mp-caret" aria-hidden="true">▾</span>
          </button>
          <div class="mp-profile-menu" id="mp-profile-menu" role="menu" hidden>
            <a role="menuitem" href="member-profile.html">👤 My Account</a>
            <a role="menuitem" href="member-settings.html">⚙️ Settings</a>
            <hr><button role="menuitem" type="button" class="mp-menu-danger" id="mp-logout">Sign out</button>
          </div>
        </div>
      </header>
      <section class="mp-page-header">${breadcrumbs(page, title)}
        <div class="mp-page-header-row"><div class="mp-page-heading"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <div class="mp-page-actions" id="mp-actions"></div></div>
        ${renderTabs(page)}
      </section>
      <main class="mp-content" id="mp-content" tabindex="-1" aria-busy="true"><div class="mp-muted mp-loading">Loading…</div></main>
    </div>
  </div>`;
  document.title = `${title} · Virtex Member Portal`;
}


function initProfileMenu() {
  const btn = document.getElementById('mp-profile-btn');
  const menu = document.getElementById('mp-profile-menu');
  const setOpen = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('#mp-profile')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); } });
  document.getElementById('mp-logout').addEventListener('click', signOut);
}

/**
 * Builds the layout, checks the session and confirms the account is linked to a member
 * profile via GET /api/v1/member/me. Returns { content, actions, member } or null.
 */
export async function initShell({ page, title, subtitle = '' }) {
  if (!getToken()) { redirectToLogin(); return null; }
  // All portals share one browser session. A trainer/admin session must not open the Member Portal:
  // go to member sign-in instead of drawing the portal with someone else's account.
  const earlyRole = getStoredRole();
  if (earlyRole && earlyRole !== 'member') {
    location.replace(`/member-auth.html?${new URLSearchParams({ next: location.pathname, wrongRole: earlyRole })}`);
    return null;
  }
  // Which features the admin switched on for this member (Admin → Member Menu; personal vs general members).
  let visible = null;
  try { const m = (await api.get('/menu')).data; visible = m.visible; window.__memberMenu = m; } catch { /* older server: show everything */ }
  if (isHidden(visible, menuKeyFor(page))) { location.replace('member-dashboard.html'); return null; }
  renderShell({ page, title, subtitle, visible });
  initSidebar({ menuButton: document.getElementById('mp-menu-btn'), onLogout: signOut });
  initProfileMenu();
  const content = document.getElementById('mp-content');
  const actions = document.getElementById('mp-actions');
  const stored = getStoredProfile() || {};
  const setUser = (name) => {
    document.getElementById('mp-user-name').textContent = name || 'Member';
    document.getElementById('mp-avatar').textContent = (name || 'M').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    // Sidebar footer: member name + logout icon
    const sn = document.getElementById('ms-user-name'); if (sn) sn.textContent = name || 'Member';
    const sa = document.getElementById('ms-user-av'); if (sa) sa.textContent = document.getElementById('mp-avatar').textContent;
  };
  setUser(stored.fullName || stored.full_name || stored.username);

  let member = null;
  try {
    member = (await api.get('/me')).data;
    setUser(member.full_name || member.fullName || stored.fullName);
  } catch (err) {
    if (err.status === 401) return null;
    content.innerHTML = notice(err.status === 403 ? 'Member profile not linked' : 'Could not load your profile', err.message, { error: true });
    return null;
  }
  content.removeAttribute('aria-busy');
  if (!isHidden(visible, 'attendance')) mountPunch(document.getElementById('mp-punch'));
  watchMemberNotifications();
  return { content, actions, member };
}

/** Chime when a new unread notification arrives (checked on load, then every 60 s while the tab is visible). */
let notifWatching = false;
function watchMemberNotifications() {
  if (notifWatching) return;
  notifWatching = true;
  const check = async () => {
    try {
      const d = (await api.get('/notifications')).data || {};
      if (d.inbox && d.inbox.available !== false) trackUnread('member', d.inbox.unread || 0);
    } catch { /* offline or not available: stay quiet */ }
  };
  check();
  pollWhileVisible(check, 60000);
}
