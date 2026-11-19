/**
 * Virtex Trainer Portal — navigation, page shell and shared UI helpers.
 *
 * Every trainer-<page>.js starts with:
 *   const shell = await initShell({ page: 'clients', title: 'My Clients', subtitle: '…' });
 *   if (shell) { shell.content.innerHTML = …; }
 * initShell renders the sidebar + topbar, runs the session/role guard and loads
 * the caller's trainer profile. It returns null when the page must not continue.
 */
import { api, ApiError } from './trainer-api.js';
import { trackUnread, pollWhileVisible } from '../components/notifySound.js';
import { getToken, getStoredProfile, getStoredRole, isSupervisor, redirectToLogin, supervisedTrainerId, signOut } from './trainer-auth.js';

/**
 * Flat, simple menu (no section headings). Pages that belong together share ONE sidebar link and are
 * switched with tabs at the top of the page (like the Member Portal and Admin Console).
 * Messages is the shared inbox with the admin (gym team) and your member clients.
 */
export const MENU = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', href: 'trainer-dashboard.html' },

  { id: 'clients-menu', label: 'My Clients', icon: '👥', gap: true, tabs: [
    { id: 'clients', label: 'Personal Training', href: 'trainer-clients.html' },
    { id: 'general-members', label: 'General Training', href: 'trainer-general.html' },
    { id: 'client-profile', label: 'Client Profile', href: 'trainer-client-profile.html' },
  ] },
  { id: 'workouts-menu', label: 'Workouts', icon: '🏋️', tabs: [
    { id: 'workouts', label: 'Programmes', href: 'trainer-workouts.html' },
    { id: 'workout-logs', label: 'Workout Logs', href: 'trainer-workout-logs.html' },
  ] },
  { id: 'diet-menu', label: 'Diet', icon: '🥗', tabs: [
    { id: 'diet-plans', label: 'Diet Plans', href: 'trainer-diet-plans.html' },
    { id: 'diet-guide', label: 'Diet Guide', href: 'trainer-diet-guide.html' },
  ] },
  { id: 'sessions-menu', label: 'Sessions', icon: '🗓️', tabs: [
    { id: 'schedule', label: 'Schedule', href: 'trainer-schedule.html' },
    { id: 'pt-sessions', label: 'PT Sessions', href: 'trainer-pt-sessions.html' },
  ] },
  { id: 'progress-menu', label: 'Progress', icon: '📈', tabs: [
    { id: 'performance', label: 'Performance', href: 'trainer-performance.html' },
    { id: 'measurements', label: 'Measurements', href: 'trainer-measurements.html' },
  ] },

  { id: 'messages', label: 'Messages', hint: 'Admin & members', icon: '💬', href: 'trainer-messages.html', gap: true },
  { id: 'notifications', label: 'Notifications', icon: '🔔', href: 'trainer-notifications.html' },
  { id: 'attendance', label: 'Attendance', icon: '⏱️', href: 'trainer-attendance.html' },

  { id: 'account-menu', label: 'My Account', icon: '👤', gap: true, tabs: [
    { id: 'profile', label: 'My Profile', href: 'trainer-profile.html' },
    { id: 'settings', label: 'Settings', href: 'trainer-settings.html' },
  ] },
];

/** Older grouped shape, derived from MENU (kept for compatibility). */
export const NAV = MENU.map((m) => ({ group: m.label, items: m.tabs ? m.tabs.map((t) => ({ ...t, icon: m.icon })) : [m] }));

// ------------------------------------------------------------------ formatting & UI helpers

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));
export const dash = (v, suffix = '') => (v === null || v === undefined || v === '' ? '—' : `${esc(v)}${suffix}`);

export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const fmtTime = (v) => (v ? esc(String(v).slice(0, 5)) : '—');
export function fmtDuration(seconds) {
  const s = Number(seconds) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
export const fmtMoney = (v) => (v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

const STATUS_BADGE = {
  active: 'badge-green', completed: 'badge-cyan', paused: 'badge-warning', cancelled: 'badge-dim',
  scheduled: 'badge-purple', booked: 'badge-warning', confirmed: 'badge-green', no_show: 'badge-danger', paid: 'badge-green', pending: 'badge-warning',
  'Needs Recovery': 'badge-danger', Moderate: 'badge-warning', Ready: 'badge-green', Optimal: 'badge-green',
};
export const badge = (status) => (status ? `<span class="badge ${STATUS_BADGE[status] || 'badge-dim'}">${esc(String(status).replace(/_/g, ' '))}</span>` : '—');

export function emptyState(title, text = '') {
  return `<div class="empty-state tp-empty">
    <div class="tp-empty-title">${esc(title)}</div>
    ${text ? `<div class="tp-muted">${esc(text)}</div>` : ''}
  </div>`;
}

export function notice(title, text, { error = false } = {}) {
  return `<div class="tp-notice${error ? ' tp-error' : ''}"><span>${error ? '⚠️' : 'ℹ️'}</span>
    <div><strong>${esc(title)}</strong><div class="tp-notice-text">${esc(text)}</div></div></div>`;
}

/** Standard "feature needs DB migration" state (PT sessions, messages, notifications). */
export function notAvailable(feature) {
  return notice(`${feature} — available after database update`,
    'This feature needs the Trainer Hub database migrations, which have not been applied yet. Ask an administrator to run them. No data is shown until then.');
}

/** Render an ApiError (or any error) into a container as a notice. */
export function renderError(el, err, feature = 'This section') {
  if (err instanceof ApiError && err.migrationsPending) { el.innerHTML = notAvailable(feature); return; }
  el.innerHTML = notice(err?.status === 403 ? 'Access denied' : 'Could not load data', err?.message || 'Unexpected error.', { error: true });
}

export function toast(message, { error = false } = {}) {
  let el = document.getElementById('tp-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tp-toast';
    el.className = 'toast-banner tp-toast';
    document.body.appendChild(el);
  }
  el.classList.toggle('error', error);
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 3800);
}

/** Pagination control; calls onPage(newPage). */
export function renderPager(el, pagination, onPage) {
  if (!pagination || pagination.totalPages <= 1) {
    el.innerHTML = pagination ? `<span>${pagination.total} record${pagination.total === 1 ? '' : 's'}</span>` : '';
    return;
  }
  const { page, totalPages, total } = pagination;
  el.innerHTML = `<span>${total} records · page ${page} of ${totalPages}</span>
    <button class="btn btn-outline" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
    <button class="btn btn-outline" data-p="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next ›</button>`;
  el.querySelectorAll('button[data-p]').forEach((b) => b.addEventListener('click', () => onPage(Number(b.dataset.p))));
}

/** Simple modal using admin.css .modal-backdrop/.modal-card. Returns { el, close }. */
export function openModal(title, bodyHtml, { wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop active';
  wrap.innerHTML = `<div class="modal-card tp-modal${wide ? ' tp-modal-wide' : ''}">
    <div class="tp-modal-head">
      <h3 class="tp-modal-title">${esc(title)}</h3>
      <button class="btn btn-outline" data-close aria-label="Close">✕</button>
    </div>
    <div class="tp-modal-body">${bodyHtml}</div></div>`;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', onKey); wrap.remove(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(wrap);
  return { el: wrap, close };
}

/** Read a <form> into a plain object; empty strings are dropped. Numbers via data-num. */
export function formData(form) {
  const out = {};
  form.querySelectorAll('[name]').forEach((f) => {
    if (f.type === 'checkbox') { out[f.name] = f.checked; return; }
    const v = f.value.trim();
    if (v === '') return;
    out[f.name] = f.dataset.num !== undefined ? Number(v) : v;
  });
  return out;
}

export const qp = (name) => new URLSearchParams(location.search).get(name);

/** Mean of a numeric field across rows, ignoring null/blank values; null when there is no data. */
export function avg(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined && v !== '').map(Number).filter(Number.isFinite);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Stat tile (label, value, optional sub-line). `value` is trusted HTML; pass escaped text. */
export const statTile = (label, value, sub = '') => `<div class="tp-stat"><div class="tp-stat-label">${esc(label)}</div>
  <div class="tp-stat-value">${value ?? '—'}</div>${sub ? `<div class="tp-stat-sub">${esc(sub)}</div>` : ''}</div>`;

/** Number formatter for stat tiles: null → '—'. */
export const num = (v, digits = 0, suffix = '') => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(digits)}${suffix}`);

/** Link to another portal page, keeping supervisory ?trainerId= when present. */
export function pageHref(href, params = {}) {
  const p = new URLSearchParams(params);
  const tid = supervisedTrainerId();
  if (tid) p.set('trainerId', tid);
  const s = p.toString();
  return s ? `${href}?${s}` : href;
}

/** Client <select> populated from /clients (status filter optional). */
export async function clientSelect(selectEl, { status = null, selected = null, placeholder = 'Select a client…' } = {}) {
  const res = await api.get('/clients', { status, limit: 100 });
  const rows = res.data || [];
  const seen = new Set();
  // Only current (active/paused) assignments can open member records — the server
  // returns 404 for completed/cancelled ones (access ends with the assignment).
  const opts = rows
    .filter((r) => ['active', 'paused'].includes(r.assignment_status))
    .filter((r) => (seen.has(r.member_id) ? false : seen.add(r.member_id)));
  selectEl.innerHTML = `<option value="">${esc(placeholder)}</option>` + opts.map((r) =>
    `<option value="${r.member_id}" ${String(selected) === String(r.member_id) ? 'selected' : ''}>${esc(r.full_name)} (${esc(r.member_code || `#${r.member_id}`)}) · ${esc(r.assignment_status)}</option>`).join('');
  return opts;
}

// ------------------------------------------------------------------ client picker

/**
 * "Pick one of my clients, optionally a date range, then render" scaffold used by the
 * monitoring pages (workout logs, diet, recovery, performance, measurements).
 * The server re-checks the trainer↔client assignment on every request.
 */
export async function clientPage(content, { page, dates = false, render }) {
  content.innerHTML = `
    <div class="tp-toolbar">
      <select class="select-filter tp-client-select" id="cp-client"></select>
      ${dates ? `<label class="tp-muted">From <input type="date" class="select-filter" id="cp-from"></label>
      <label class="tp-muted">To <input type="date" class="select-filter" id="cp-to"></label>` : ''}
    </div>
    <div id="cp-body"></div>`;
  const sel = content.querySelector('#cp-client');
  const body = content.querySelector('#cp-body');
  const from = content.querySelector('#cp-from');
  const to = content.querySelector('#cp-to');

  async function run() {
    const memberId = sel.value;
    if (!memberId) { body.innerHTML = emptyState('Select a client', 'Choose one of your clients to see their records.'); return; }
    history.replaceState(null, '', pageHref(`trainer-${page}.html`, { memberId }));
    body.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
    try {
      await render(body, memberId, { from: from?.value || undefined, to: to?.value || undefined });
    } catch (err) { renderError(body, err); }
  }

  try {
    await clientSelect(sel, { selected: qp('memberId') });
  } catch (err) { renderError(body, err, 'Clients'); return; }
  sel.addEventListener('change', run);
  from?.addEventListener('change', run);
  to?.addEventListener('change', run);
  run();
  return { rerun: run };
}

// ------------------------------------------------------------------ dialogs

/** Confirmation dialog. Resolves true/false. */
export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const { el, close } = openModal(title, `<p class="tp-dialog-text">${esc(message)}</p>
      <div class="tp-form-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button>
      <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-green'}" data-ok>${esc(confirmText)}</button></div>`);
    el.querySelector('[data-ok]').addEventListener('click', () => { finish(true); close(); });
    new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); finish(false); } }).observe(document.body, { childList: true });
  });
}

/** Single-line text prompt. Resolves the text ('' allowed) or null when cancelled. */
export function promptDialog({ title, label, placeholder = '', confirmText = 'OK', maxLength = 150 }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const { el, close } = openModal(title, `<form id="tp-prompt"><div class="form-group"><label>${esc(label)}</label>
      <input name="value" maxlength="${maxLength}" placeholder="${esc(placeholder)}" autofocus></div>
      <div class="tp-form-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button>
      <button class="btn btn-green" type="submit">${esc(confirmText)}</button></div></form>`);
    el.querySelector('#tp-prompt').addEventListener('submit', (e) => { e.preventDefault(); finish(e.target.value.value.trim()); close(); });
    new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); finish(null); } }).observe(document.body, { childList: true });
  });
}

// ------------------------------------------------------------------ layout: navigation model

const PAGE_LOOKUP = new Map(MENU.flatMap((m) => (m.tabs ? m.tabs.map((t) => [t.id, { group: m.label, item: t, parent: m }]) : [[m.id, { group: null, item: m, parent: null }]])));

/** Breadcrumb trail: Trainer Hub › <Group> › <Page>. */
export function breadcrumbs(page, title) {
  const hit = PAGE_LOOKUP.get(page);
  const crumbs = [{ label: 'Trainer Hub', href: page === 'dashboard' ? null : pageHref('trainer-dashboard.html') }];
  if (hit?.group && hit.group !== title) crumbs.push({ label: hit.group, href: null });
  crumbs.push({ label: title || hit?.item.label || '', href: null, current: true });
  return `<nav class="tp-breadcrumbs" aria-label="Breadcrumb"><ol>${crumbs.map((c) => `<li>${c.href
    ? `<a href="${c.href}">${esc(c.label)}</a>` : `<span${c.current ? ' aria-current="page"' : ''}>${esc(c.label)}</span>`}</li>`).join('')}</ol></nav>`;
}

// ------------------------------------------------------------------ layout: markup

const LOGO = '<img class="tp-brand-logo" src="/assets/brand/virtex-icon-128.png" alt="" aria-hidden="true" decoding="async">';
const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

const LOGOUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

function sidebarHtml(page) {
  const groups = MENU.map((m) => {
    const on = m.id === page || !!m.tabs?.some((t) => t.id === page);
    const cls = [on ? 'active' : '', m.gap ? 'tp-nav-gap' : ''].filter(Boolean).join(' ');
    return `<a href="${pageHref(m.href || m.tabs[0].href)}"${cls ? ` class="${cls}"` : ''}${on ? ' aria-current="page"' : ''}><span class="tp-ico" aria-hidden="true">${m.icon}</span><span class="tp-nav-label">${esc(m.label)}${m.hint ? `<small>${esc(m.hint)}</small>` : ''}</span></a>`;
  }).join('');
  return `<aside class="tp-sidebar" id="tp-sidebar" aria-label="Trainer Hub navigation">
      <div class="tp-brand">${LOGO}<div><h2>Virtex</h2><span>TRAINER HUB</span></div>
        <button class="tp-sidebar-close" id="tp-sidebar-close" aria-label="Close menu">✕</button></div>
      <nav class="tp-nav">${groups}</nav>
      <div class="tp-sidebar-foot">
        <a class="tp-foot-user" href="${pageHref('trainer-profile.html')}" title="My Profile">
          <span class="tp-avatar tp-foot-avatar" id="tp-foot-avatar">–</span>
          <span class="tp-foot-meta"><span class="tp-foot-name" id="tp-foot-name">Loading…</span><span class="tp-foot-role" id="tp-foot-role"></span></span>
        </a>
        <button type="button" class="tp-foot-logout" id="tp-foot-logout" title="Sign out" aria-label="Sign out">${LOGOUT}</button>
      </div>
    </aside>
    <div class="tp-backdrop" id="tp-backdrop" hidden></div>`;
}

function topbarHtml() {
  return `<header class="tp-topbar">
      <button class="tp-menu-btn" id="tp-menu-btn" aria-label="Open menu" aria-controls="tp-sidebar" aria-expanded="false">☰</button>
      <div class="tp-topbar-brand">${LOGO}<span>Trainer Hub</span></div>
      <div class="tp-topbar-right">
        <div class="topbar-routine-group tp-punch" id="tp-punch" hidden>
          <a href="${pageHref('trainer-attendance.html')}" class="topbar-routine-badge status-out" id="tp-punch-badge" title="Open attendance">
            <span class="topbar-status-dot"></span><span id="tp-punch-text">…</span></a>
          <div class="topbar-punch-btns">
            <button type="button" class="topbar-icon-btn btn-topbar-punch-in" id="tp-punch-in" title="Punch In (start shift)" disabled><span aria-hidden="true">🟢</span><span class="tp-punch-label">In</span></button>
            <button type="button" class="topbar-icon-btn btn-topbar-break" id="tp-punch-break" title="Start or end a break" disabled><span aria-hidden="true" id="tp-break-ico">☕</span><span class="tp-punch-label" id="tp-break-text">Break</span></button>
            <button type="button" class="topbar-icon-btn btn-topbar-punch-out" id="tp-punch-out" title="Punch Out (end shift)" disabled><span aria-hidden="true">⏹️</span><span class="tp-punch-label">Out</span></button>
          </div>
        </div>
        <a href="${pageHref('trainer-notifications.html')}" class="topbar-nav-icon-link tp-bell" id="tp-bell" aria-label="Notifications" title="Notifications">${BELL}
          <span class="topbar-counter-badge topbar-counter-red" id="tp-bell-count" hidden></span></a>
        <div class="tp-profile" id="tp-profile">
          <button class="tp-profile-btn" id="tp-profile-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="tp-profile-menu">
            <span class="tp-avatar" id="tp-avatar">–</span>
            <span class="tp-profile-meta"><span class="tp-user-name" id="tp-user-name">Loading…</span><span class="tp-user-role" id="tp-user-role"></span></span>
            <span class="tp-caret" aria-hidden="true">▾</span>
          </button>
          <div class="tp-profile-menu" id="tp-profile-menu" role="menu" hidden>
            <a role="menuitem" href="${pageHref('trainer-profile.html')}">👤 My Profile</a>
            <a role="menuitem" href="${pageHref('trainer-settings.html')}">⚙️ Settings</a>
            <a role="menuitem" href="${pageHref('trainer-attendance.html')}">⏱️ Attendance</a>
            <a role="menuitem" href="${pageHref('trainer-notifications.html')}">🔔 Notifications</a>
            <hr>
            <button role="menuitem" type="button" class="tp-menu-danger" id="tp-logout">Sign out</button>
          </div>
        </div>
      </div>
    </header>`;
}

/** Tabs for pages that share one sidebar link (e.g. Workouts → Programmes / Exercise Library / Workout Logs). */
function tabsHtml(page) {
  const hit = PAGE_LOOKUP.get(page);
  if (!hit?.parent?.tabs) return '';
  return `<nav class="tp-tabs" aria-label="${esc(hit.parent.label)} pages">${hit.parent.tabs.map((t) => `<a class="tp-tab${t.id === page ? ' active' : ''}" href="${pageHref(t.href)}"${t.id === page ? ' aria-current="page"' : ''}>${esc(t.label)}</a>`).join('')}</nav>`;
}

function pageHeaderHtml(page, title, subtitle) {
  return `<section class="tp-page-header">
      ${breadcrumbs(page, title)}
      <div class="tp-page-header-row">
        <div class="tp-page-heading"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <div class="tp-page-actions" id="tp-actions"></div>
      </div>
      ${tabsHtml(page)}
    </section>`;
}

function renderShell({ page, title, subtitle }) {
  document.body.classList.add('tp-body', `tp-page-${page}`);
  document.body.innerHTML = `<a class="tp-skip" href="#tp-content">Skip to content</a>
    <div class="tp-shell">${sidebarHtml(page)}
      <div class="tp-main">${topbarHtml()}${pageHeaderHtml(page, title, subtitle)}
        <main class="tp-content" id="tp-content" tabindex="-1" aria-busy="true"><div class="tp-muted tp-loading">Loading…</div></main>
      </div>
    </div>`;
  document.title = `${title} · Virtex Trainer Hub`;
}

// ------------------------------------------------------------------ layout: behaviour

function initMobileNav() {
  const sidebar = document.getElementById('tp-sidebar');
  const backdrop = document.getElementById('tp-backdrop');
  const btn = document.getElementById('tp-menu-btn');
  const setOpen = (open) => {
    sidebar.classList.toggle('open', open);
    backdrop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('tp-nav-open', open);
  };
  btn.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click', () => setOpen(false));
  document.getElementById('tp-sidebar-close').addEventListener('click', () => setOpen(false));
  sidebar.querySelectorAll('.tp-nav a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
}

function initProfileMenu() {
  const btn = document.getElementById('tp-profile-btn');
  const menu = document.getElementById('tp-profile-menu');
  const setOpen = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('#tp-profile')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); } });
  document.getElementById('tp-logout').addEventListener('click', signOut);
  document.getElementById('tp-foot-logout')?.addEventListener('click', (e) => { e.currentTarget.disabled = true; signOut(); });
}

/** Unread notification count in the topbar bell. Refreshes on 'tp:notifications-changed'. */
async function refreshNotificationIndicator() {
  const bell = document.getElementById('tp-bell');
  const count = document.getElementById('tp-bell-count');
  if (!bell) return;
  try {
    const rows = (await api.get('/notifications', { unread: 'true' })).data || [];
    count.hidden = rows.length === 0;
    count.textContent = rows.length > 99 ? '99+' : String(rows.length);
    bell.title = rows.length ? `${rows.length} unread notification${rows.length === 1 ? '' : 's'}` : 'No unread notifications';
    bell.setAttribute('aria-label', bell.title);
    if (trackUnread('trainer', rows.length)) { bell.classList.remove('tp-bell-ring'); void bell.offsetWidth; bell.classList.add('tp-bell-ring'); }
  } catch (err) {
    count.hidden = true;
    bell.title = err instanceof ApiError && err.migrationsPending ? 'Notifications — available after database update' : 'Notifications';
    bell.classList.toggle('tp-bell-off', err instanceof ApiError && err.migrationsPending);
  }
}

const fmtClock = (s) => {
  const v = Math.max(0, Math.floor(s));
  return [Math.floor(v / 3600), Math.floor((v % 3600) / 60), v % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

/** Punch In / Break / Punch Out for the signed-in user via the existing /api/v1/routine/* endpoints. */
function initPunchControls() {
  const group = document.getElementById('tp-punch');
  const badge = document.getElementById('tp-punch-badge');
  const text = document.getElementById('tp-punch-text');
  const inBtn = document.getElementById('tp-punch-in');
  const brBtn = document.getElementById('tp-punch-break');
  const outBtn = document.getElementById('tp-punch-out');
  let status = null;
  let timer = null;

  const paint = (data) => {
    status = data?.status || 'punched_out';
    clearInterval(timer);
    const working = status === 'punched_in';
    const onBreak = status === 'on_break';
    badge.className = `topbar-routine-badge ${working ? 'status-in' : onBreak ? 'status-break' : 'status-out'}`;
    inBtn.disabled = working || onBreak;
    brBtn.disabled = !(working || onBreak);
    outBtn.disabled = !(working || onBreak);
    document.getElementById('tp-break-ico').textContent = onBreak ? '▶️' : '☕';
    document.getElementById('tp-break-text').textContent = onBreak ? 'Resume' : 'Break';
    if (working || onBreak) {
      let secs = Number(onBreak ? data.current_break_seconds : data.elapsed_work_seconds) || 0;
      const label = onBreak ? 'BREAK' : 'IN';
      text.textContent = `${label} ${fmtClock(secs)}`;
      timer = setInterval(() => { secs += 1; text.textContent = `${label} ${fmtClock(secs)}`; }, 1000);
    } else {
      text.textContent = 'PUNCHED OUT';
    }
  };

  const sync = async () => {
    try {
      const res = await api.routine.current();
      paint(res.data);
      group.hidden = false;
    } catch {
      group.hidden = true;     // routine tracker unavailable for this session: hide controls
    }
  };

  const act = async (fn) => {
    [inBtn, brBtn, outBtn].forEach((b) => { b.disabled = true; });
    try {
      const res = await fn();
      if (res) {
        toast(res.message || 'Shift updated.');
        window.dispatchEvent(new CustomEvent('routine:status-changed', { detail: res }));
      }
    } catch (err) { toast(err.message, { error: true }); }
    await sync();
  };

  inBtn.addEventListener('click', () => act(() => api.routine.punchIn('Shift punch from Trainer Hub')));
  brBtn.addEventListener('click', () => act(async () => {
    if (status === 'on_break') {
      return (await confirmDialog({ title: 'Resume shift', message: 'End your break and resume your shift?', confirmText: 'Resume shift' }))
        ? api.routine.endBreak() : null;
    }
    const reason = await promptDialog({ title: 'Start a break', label: 'Reason (optional)', placeholder: 'e.g. Lunch', confirmText: 'Start break' });
    return reason === null ? null : api.routine.startBreak(reason || 'Routine Break');
  }));
  outBtn.addEventListener('click', () => act(async () => (
    (await confirmDialog({ title: 'Punch out', message: 'Finish your shift for today and punch out?', confirmText: 'Yes, punch out', danger: true }))
      ? api.routine.punchOut('Shift completed from Trainer Hub') : null)));

  sync();
}

// ------------------------------------------------------------------ layout: entry point

/**
 * Builds the shared Trainer Hub layout (sidebar, topbar, breadcrumbs, page header,
 * notification indicator, profile menu, punch controls, mobile navigation), then runs
 * the session/role guard and loads the caller's trainer profile.
 * Returns { content, actions, trainer, role } or null when the page cannot continue.
 * `requireProfile:false` lets account pages render even without a linked trainer profile.
 */
export async function initShell({ page, title, subtitle = '', requireProfile = true }) {
  if (!getToken()) { redirectToLogin(); return null; }
  // All portals share one browser session. A member (or other non-trainer) session must not open the Trainer Hub:
  // go to trainer sign-in instead of drawing the hub with someone else's account.
  const earlyRole = getStoredRole();
  if (earlyRole && earlyRole !== 'trainer' && !isSupervisor(earlyRole)) { redirectToLogin({ wrongRole: earlyRole }); return null; }
  renderShell({ page, title, subtitle });
  initMobileNav();
  initProfileMenu();

  const content = document.getElementById('tp-content');
  const actions = document.getElementById('tp-actions');
  const stored = getStoredProfile() || {};
  const role = getStoredRole();

  const setUser = (name, roleLabel) => {
    document.getElementById('tp-user-name').textContent = name || 'Trainer';
    document.getElementById('tp-user-role').textContent = roleLabel || '';
    document.getElementById('tp-avatar').textContent = (name || 'T').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    // Sidebar footer mirrors the topbar profile
    const fn = document.getElementById('tp-foot-name');
    if (fn) {
      fn.textContent = name || 'Trainer';
      fn.parentElement.parentElement.title = `${name || 'Trainer'} · My Profile`;
      document.getElementById('tp-foot-role').textContent = roleLabel || '';
      document.getElementById('tp-foot-avatar').textContent = document.getElementById('tp-avatar').textContent;
    }
  };
  setUser(stored.fullName || stored.full_name || stored.username, role);

  if (isSupervisor(role)) {
    const tid = supervisedTrainerId();
    actions.insertAdjacentHTML('afterbegin', `<span class="tp-supervisor">Supervisory view${tid ? ` · trainer #${esc(tid)}` : ''}</span>`);
    if (!tid && requireProfile) {
      content.innerHTML = notice('Choose a trainer', 'As an owner/manager, open this portal with ?trainerId=<id> in the URL to view a trainer\'s hub (for example trainer-dashboard.html?trainerId=1).');
      initPunchControls();
      return null;
    }
  }

  initPunchControls();
  refreshNotificationIndicator();
  window.addEventListener('tp:notifications-changed', refreshNotificationIndicator);
  pollWhileVisible(refreshNotificationIndicator, 45000); // new notifications → bell count + chime

  let trainer = null;
  try {
    trainer = (await api.get('/me')).data;
    setUser(trainer.full_name, `${trainer.trainer_code || 'trainer'} · ${trainer.status || ''}`);
  } catch (err) {
    if (err.status === 401) return null;
    if (requireProfile) {
      content.innerHTML = notice(
        err.status === 404 ? 'Trainer profile not found' : err.status === 403 ? 'Trainer profile not linked' : 'Could not verify your trainer profile',
        err.message, { error: true });
      return null;
    }
  }
  content.removeAttribute('aria-busy');
  return { content, actions, trainer, role };
}
