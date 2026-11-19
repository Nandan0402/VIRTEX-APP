/**
 * Virtex Trainer Hub — trainer-settings.html
 *   Login & password : real login details from GET /api/v1/trainer/account. Trainer passwords are set by the
 *                      gym admin (authorisation stays with the admin); the trainer sends a change request
 *                      (POST /api/v1/trainer/account/password-request) and the admin sets the new password.
 *                      The current password is never shown: only an encrypted hash is stored.
 *   Portal preferences: start page, stored in this browser.
 */
import { api } from './trainer-api.js';
import { initShell, toast, esc, dash, fmtDate, fmtDateTime, renderError } from './trainer-navigation.js';
import { PREFS_KEY, getStoredRole, isSupervisor } from './trainer-auth.js';
import { isSoundOn, setSoundOn, playNotificationSound } from '../components/notifySound.js';

const shell = await initShell({ page: 'settings', title: 'Settings', subtitle: 'Login, password and portal preferences', requireProfile: false });

const REASONS = [
  ['forgot', 'I forgot / lost my password'],
  ['security', 'Someone else may know it'],
  ['shared', 'I signed in on a shared device'],
  ['periodic', 'Routine password change'],
  ['other', 'Other reason'],
];
const reasonLabel = (k) => (REASONS.find(([v]) => v === k) || [k, k || '—'])[1];
const STATUS = { pending: ['badge-warning', 'Waiting for admin'], completed: ['badge-green', 'Password set by admin'], dismissed: ['badge-dim', 'Closed by admin'] };

if (shell) {
  const { content } = shell;
  const supervisor = isSupervisor(getStoredRole());
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { prefs = {}; }

  content.innerHTML = `<div class="tp-grid-2">
    <div class="card" id="acct-card"><h3 class="tp-card-title">Login &amp; password</h3><div id="acct"><div class="tp-muted">Loading your login details…</div></div></div>
    <div class="card"><h3 class="tp-card-title">Portal preferences</h3>
      <div class="tp-muted tp-mb">Stored in this browser only.</div>
      <div class="form-group"><label for="start">Start page after sign-in</label><select id="start">
        <option value="trainer-dashboard.html">Dashboard</option><option value="trainer-clients.html">My Clients</option>
        <option value="trainer-schedule.html">Schedule</option><option value="trainer-pt-sessions.html">PT Sessions</option></select></div>
      <div class="form-group"><label class="ts-sound"><input type="checkbox" id="sound-on"> Play a sound for new notifications</label>
        <button type="button" class="btn btn-outline btn-sm" id="sound-test">🔔 Test sound</button></div>
      <button class="btn btn-green" id="save">Save preferences</button></div></div>`;
  const soundBox = content.querySelector('#sound-on');
  soundBox.checked = isSoundOn();
  soundBox.addEventListener('change', () => { setSoundOn(soundBox.checked); toast(soundBox.checked ? 'Notification sound on.' : 'Notification sound off.'); });
  content.querySelector('#sound-test').addEventListener('click', () => playNotificationSound('message', { force: true }));

  const start = content.querySelector('#start');
  if (prefs.startPage) start.value = prefs.startPage;
  content.querySelector('#save').addEventListener('click', () => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, startPage: start.value })); toast('Preferences saved.'); }
    catch { toast('Could not save preferences in this browser.', { error: true }); }
  });

  const box = content.querySelector('#acct');

  const row = (label, value) => `<div class="ts-row"><span class="ts-label">${esc(label)}</span><span class="ts-value">${value}</span></div>`;

  function render(d) {
    const a = d.account; const p = d.password;
    const pending = p.pendingRequest;
    box.innerHTML = `
      <div class="ts-list">
        ${row('Name', dash(a.fullName))}
        ${row('Trainer code', a.trainerCode ? `<span class="font-mono">${esc(a.trainerCode)}</span>` : '—')}
        ${row('Username', a.username ? `<span class="font-mono">${esc(a.username)}</span>` : '—')}
        ${row('Login email', dash(a.email))}
        ${row('Phone', dash(a.phone))}
        ${row('Role', `<span class="badge badge-cyan">${esc(a.role || 'trainer')}</span>`)}
        ${row('Account status', a.active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-danger">Deactivated</span>')}
        ${row('Last sign-in', a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : '—')}
        ${row('Account created', fmtDate(a.createdAt))}
      </div>
      <div class="ts-pass">
        <div class="ts-row"><span class="ts-label">Password</span>
          <span class="ts-value"><span class="font-mono ts-dots" aria-label="hidden">••••••••••</span>
          <span class="badge badge-dim">Set by gym admin</span></span></div>
        ${row('Last set by admin', p.lastSetAt ? fmtDateTime(p.lastSetAt) : 'Not recorded yet')}
        <p class="tp-muted ts-note">Your password is stored encrypted, so nobody can view it — not you, not the admin.
          Only the gym admin can set a new one. Ask for a change below; the admin will give you the new password.</p>
      </div>
      <div id="ts-request">
        ${pending
          ? `<div class="ts-pending" role="status"><span class="badge badge-warning">Waiting for admin</span>
               <div>Requested ${esc(fmtDateTime(pending.requestedAt))} · ${esc(reasonLabel(pending.reason))}</div>
               <div class="tp-muted">You can keep using your current password until the admin gives you the new one.</div></div>`
          : supervisor
            ? '<div class="tp-muted">Supervisor view: set this coach\'s password from Admin → Personal Trainers → Edit.</div>'
            : `<form id="ts-form" class="ts-form">
                 <div class="form-group"><label for="ts-reason">Why do you need a new password?</label>
                   <select id="ts-reason" name="reason" required><option value="" selected disabled>Choose a reason…</option>
                   ${REASONS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
                 <button class="btn btn-green" type="submit">Request password change</button>
               </form>`}
      </div>
      ${p.history.length ? `<div class="ts-history"><div class="ts-label ts-mt">Recent requests</div>
        ${p.history.map((h) => { const [cls, txt] = STATUS[h.status] || ['badge-dim', h.status];
          return `<div class="ts-hrow"><span>${esc(fmtDateTime(h.requestedAt))} · ${esc(reasonLabel(h.reason))}</span>
            <span class="badge ${cls}">${esc(txt)}</span>${h.adminNote ? `<div class="tp-muted ts-hnote">Admin: ${esc(h.adminNote)}</div>` : ''}</div>`; }).join('')}</div>` : ''}`;

    const form = box.querySelector('#ts-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = form.reason.value;
      if (!reason) { toast('Choose a reason first.', { error: true }); return; }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const res = await api.post('/account/password-request', { reason });
        toast(res.message || 'Request sent to the admin.');
        await load();
      } catch (err) {
        toast(err.message, { error: true });
        if (err.status === 409) await load();
        btn.disabled = false; btn.textContent = 'Request password change';
      }
    });
  }

  async function load() {
    try { render((await api.get('/account')).data); }
    catch (err) { renderError(box, err, 'Login details'); }
  }
  await load();
}
