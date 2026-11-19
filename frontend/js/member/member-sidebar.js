/**
 * Virtex Member Portal — reusable sidebar navigation (flat, no sub-menus).
 *
 * One short list of links for every member-*.html page. Thin spacing separates related links.
 * Pages that belong together (e.g. Membership / Payments / Invoices) share one sidebar link and
 * are switched with tabs at the top of the page (renderTabs), so nothing expands or collapses.
 *
 *   renderSidebar(pageId)     -> sidebar HTML (the link for the current page is highlighted)
 *   renderTabs(pageId)        -> tab strip HTML for pages that share a link ('' otherwise)
 *   initSidebar({ onLogout }) -> mobile drawer, keyboard, Logout action
 *   findPage(pageId)          -> { item, parent } for breadcrumbs
 *
 * Every href is a real member-*.html file in /frontend. Logout is the red icon next to the member's name
 * at the bottom of the sidebar (an action, not a page).
 */

export const MENU = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠', href: 'member-dashboard.html' },

  { id: 'trainer', label: 'My Trainer', icon: '🎓', href: 'member-trainer.html', gap: true },
  { id: 'workouts-menu', label: 'Workouts', icon: '🏋️', tabs: [
    { id: 'workouts', label: 'Programmes', href: 'member-workouts.html' },
    { id: 'workout-logs', label: 'Workout Log', href: 'member-workout-logs.html' },
  ] },
  { id: 'diet-plans', label: 'Diet', icon: '🥗', href: 'member-diet-plan.html' },
  { id: 'progress-menu', label: 'Progress', icon: '📈', tabs: [
    { id: 'progress', label: 'Overview', href: 'member-progress.html' },
    { id: 'measurements', label: 'Measurements', href: 'member-measurements.html' },
    { id: 'achievements', label: 'Achievements', href: 'member-achievements.html' },
  ] },
  { id: 'pt-sessions', label: 'PT Sessions', icon: '🤝', href: 'member-pt-sessions.html' },
  { id: 'classes', label: 'Classes', icon: '🗓️', href: 'member-classes.html' },

  { id: 'membership-menu', label: 'Membership & Fees', icon: '💳', gap: true, tabs: [
    { id: 'membership', label: 'Membership', href: 'member-membership.html' },
    { id: 'payments', label: 'Payments', href: 'member-payments.html' },
    { id: 'invoices', label: 'Invoices', href: 'member-invoices.html' },
  ] },
  { id: 'attendance', label: 'Attendance', icon: '🚪', href: 'member-attendance.html' },

  { id: 'messages', label: 'Messages', icon: '💬', href: 'member-messages.html', gap: true },
  { id: 'notifications-menu', label: 'Notifications', icon: '🔔', tabs: [
    { id: 'notifications', label: 'Notifications', href: 'member-notifications.html' },
    { id: 'announcements', label: 'Announcements', href: 'member-announcements.html' },
  ] },
  { id: 'events', label: 'Events', icon: '🏆', href: 'member-events.html' },

  { id: 'feedback', label: 'Feedback', icon: '⭐', href: 'member-feedback.html', gap: true },
  { id: 'account-menu', label: 'My Account', icon: '👤', tabs: [
    { id: 'profile', label: 'Profile', href: 'member-profile.html' },
    { id: 'settings', label: 'Settings', href: 'member-settings.html' },
  ] },
];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const norm = (pageId) => (pageId === 'food-diary' ? 'nutrition-logs' : pageId);

/** { item, parent } for a page id (parent set when the page is one tab of a shared link). */
export function findPage(pageId) {
  const id = norm(pageId);
  for (const item of MENU) {
    if (item.id === id) return { item, parent: null };
    const tab = item.tabs?.find((c) => c.id === id);
    if (tab) return { item: tab, parent: item };
  }
  return { item: null, parent: null };
}

const LOGO = '<svg class="ms-logo" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="1.25" y="1.25" width="29.5" height="29.5" rx="9" fill="#13161f" stroke="#00e676" stroke-width="1.6"/><path d="M7.2 6.8h4.6L16 17.2V22h-2.1z" fill="#00e676"/><path d="M16 17.2l4.2-10.4h4.6L18.1 22H16z" fill="#22d3ee"/><path d="M6.2 25.6h5.4l1.3-2.3 1.7 4 1.4-1.7h9.8" stroke="#00e676" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function itemHtml(item, pageId) {
  const gap = item.gap ? ' ms-gap' : '';
  if (item.action === 'logout') {
    return `<li class="ms-item ms-item-logout"><button type="button" class="ms-link" data-action="logout">
      <span class="ms-ico" aria-hidden="true">${item.icon}</span><span class="ms-label">${esc(item.label)}</span></button></li>`;
  }
  const id = norm(pageId);
  const active = item.id === id || !!item.tabs?.some((t) => t.id === id);
  const href = item.href || item.tabs[0].href;
  return `<li class="ms-item${gap}"><a class="ms-link${active ? ' active' : ''}" href="${href}"${active ? ' aria-current="page"' : ''}>
    <span class="ms-ico" aria-hidden="true">${item.icon}</span><span class="ms-label">${esc(item.label)}</span></a></li>`;
}

/** Menu key (top-level MENU id) a page belongs to, or null for pages that are not in the menu. */
export function menuKeyFor(pageId) {
  const { item, parent } = findPage(pageId);
  return parent ? parent.id : item ? item.id : null;
}
/** Menu key a link points to (e.g. 'member-food-diary.html' → 'diet-plans'), or null. */
export function menuKeyForHref(href) {
  const file = String(href || '').split(/[?#]/)[0].replace(/^\//, '');
  for (const m of MENU) {
    if (m.href === file) return m.id;
    if (m.tabs?.some((t) => t.href === file)) return m.id;
  }
  return null;
}
const ALWAYS = new Set(['dashboard', 'account-menu']);
/** True when the admin switched this menu key off for this member (Admin → Member Menu). */
export const isHidden = (visible, key) => !!(visible && key && !ALWAYS.has(key) && visible[key] === false);

/** Sidebar markup for the given page id (+ the mobile backdrop). `visible` = the admin's choices for this member. */
export function renderSidebar(pageId, visible = null) {
  return `<aside class="mp-sidebar ms-sidebar" id="mp-sidebar" aria-label="Member Portal navigation">
      <div class="ms-brand">${LOGO}<div><h2>Virtex</h2><span>MEMBER PORTAL</span></div>
        <button type="button" class="ms-close" id="ms-close" aria-label="Close menu">✕</button></div>
      <nav class="ms-nav" aria-label="Member menu"><ul class="ms-list" role="list">${MENU.filter((i) => i.action || !isHidden(visible, i.id)).map((i) => itemHtml(i, pageId)).join('')}</ul></nav>
      <div class="ms-foot">
        <div class="ms-user">
          <a class="ms-user-link" href="member-profile.html" title="My Account">
            <span class="ms-user-av" id="ms-user-av" aria-hidden="true">–</span>
            <span class="ms-user-meta"><b id="ms-user-name">Loading…</b><small>Member</small></span>
          </a>
          <button type="button" class="ms-logout" data-action="logout" title="Log out" aria-label="Log out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>
      </div>
    </aside>
    <div class="ms-backdrop" id="ms-backdrop" hidden></div>`;
}

/** Tabs for pages that share one sidebar link (e.g. Membership / Payments / Invoices). */
export function renderTabs(pageId) {
  const { parent } = findPage(pageId);
  if (!parent?.tabs) return '';
  const id = norm(pageId);
  return `<nav class="ms-tabs" aria-label="${esc(parent.label)} pages">${parent.tabs.map((t) => `<a class="ms-tab${t.id === id ? ' active' : ''}" href="${t.href}"${t.id === id ? ' aria-current="page"' : ''}>${esc(t.label)}</a>`).join('')}</nav>`;
}

/**
 * Wires the sidebar: mobile drawer (menu button, backdrop, ✕, Escape, link click) and the Logout action.
 * @param {{ menuButton: HTMLElement, onLogout: Function }} opts
 */
export function initSidebar({ menuButton, onLogout }) {
  const sidebar = document.getElementById('mp-sidebar');
  const backdrop = document.getElementById('ms-backdrop');

  const setDrawer = (state) => {
    sidebar.classList.toggle('open', state);
    backdrop.hidden = !state;
    menuButton?.setAttribute('aria-expanded', String(state));
    document.body.classList.toggle('mp-nav-open', state);
    if (state) sidebar.querySelector('.ms-link.active, .ms-link')?.focus({ preventScroll: true });
  };
  menuButton?.addEventListener('click', () => setDrawer(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click', () => setDrawer(false));
  document.getElementById('ms-close').addEventListener('click', () => { setDrawer(false); menuButton?.focus(); });
  sidebar.querySelectorAll('a.ms-link').forEach((a) => a.addEventListener('click', () => setDrawer(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) { setDrawer(false); menuButton?.focus(); }
  });
  window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => { if (e.matches) setDrawer(false); });

  sidebar.querySelector('.ms-link.active')?.scrollIntoView({ block: 'nearest' });
  sidebar.querySelector('[data-action="logout"]')?.addEventListener('click', onLogout);
}
