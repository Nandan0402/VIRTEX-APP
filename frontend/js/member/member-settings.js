/** Virtex Member Portal — member-settings.html: Settings.
 *  Uses: GET   /api/v1/member/settings               (account summary + saved preferences)
 *        PUT   /api/v1/member/settings/preferences   (notifications + leaderboard name — migration 023)
 *        PATCH /api/v1/member/profile                (language — existing, permitted field)
 *        PUT   /api/v1/auth/profile                  (password change — EXISTING authentication: current + new)
 *  Membership, account status and role are shown read-only: they are managed by the gym.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';
import { isSoundOn, setSoundOn, playNotificationSound } from '../components/notifySound.js';

// Notification sound switch (per browser). The settings page is re-rendered, so bind via delegation.
document.addEventListener('change', (e) => { if (e.target?.id === 'st-sound') setSoundOn(e.target.checked); });
document.addEventListener('click', (e) => { if (e.target?.closest?.('#st-sound-test')) playNotificationSound('message', { force: true }); });
new MutationObserver(() => { const b = document.getElementById('st-sound'); if (b && !b.dataset.init) { b.dataset.init = '1'; b.checked = isSoundOn(); } })
  .observe(document.documentElement, { childList: true, subtree: true });

const shell = await initShell({ page: 'settings', title: 'Settings', subtitle: 'Language, notifications, password and privacy' });

const LANG_LABEL = { 'en-IN': 'English', 'kn-IN': 'ಕನ್ನಡ — Kannada', 'hi-IN': 'हिन्दी — Hindi' };
const NOTIFY = [
  ['workout', 'New workout programmes'], ['diet', 'Diet plan updates'], ['pt', 'PT session reminders'], ['classes', 'Class reminders & cancellations'],
  ['membership', 'Membership expiry'], ['payments', 'Payments due & received'], ['feedback', 'Trainer feedback'], ['messages', 'New message alerts'],
];
const when = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not recorded');

if (shell) {
  const { content } = shell;
  let data = null; let busy = false;

  function toast(text, error = false) {
    let el = document.getElementById('st-toast');
    if (!el) { el = document.createElement('div'); el.id = 'st-toast'; el.className = 'toast-banner mp-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.classList.toggle('error', error); el.textContent = text; el.style.display = 'block';
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  function render() {
    const p = data.preferences; const a = data.account;
    const off = !p.available;
    content.innerHTML = `<div class="pg-wrap">
      <section class="pg-card" aria-labelledby="st-lang-h"><h2 class="pg-h" id="st-lang-h">🌐 Language</h2>
        <form id="st-lang" class="st-row"><label class="mm-field"><span>Preferred language</span>
          <select name="language">${data.languages.map((l) => `<option value="${l}"${data.language === l ? ' selected' : ''}>${esc(LANG_LABEL[l] || l)}</option>`).join('')}</select></label>
          <button type="submit" class="btn btn-green" disabled>Save language</button></form>
        <p class="pg-muted">Used by the FitBot reception kiosk and as the default for gym notices.</p></section>

      <section class="pg-card" aria-labelledby="st-notif-h"><h2 class="pg-h" id="st-notif-h">🔔 Notifications</h2>
        ${off ? '<p class="st-pending">Notification choices can be saved once the gym applies a small database update. Until then you see every notification.</p>' : ''}
        <form id="st-notif"><ul class="st-toggles">${NOTIFY.map(([k, l]) => `<li><label class="st-switch"><input type="checkbox" name="${k}"${p.notifications[k] ? ' checked' : ''}${off ? ' disabled' : ''}><span class="st-slider" aria-hidden="true"></span><span>${esc(l)}</span></label></li>`).join('')}</ul>
          <div class="st-actions"><span class="pg-muted">Turning a type off hides it on your Notifications page. Important account notices from staff are always shown.</span>
          <button type="submit" class="btn btn-green" disabled>Save notifications</button></div></form>
        <div class="st-actions" style="margin-top: 14px;">
          <label class="st-switch"><input type="checkbox" id="st-sound"><span class="st-slider" aria-hidden="true"></span><span>Play a sound for new notifications <small class="pg-muted">(this browser)</small></span></label>
          <button type="button" class="btn btn-outline" id="st-sound-test">🔔 Test sound</button></div></section>

      <section class="pg-card" aria-labelledby="st-pw-h"><h2 class="pg-h" id="st-pw-h">🔑 Password</h2>
        <form id="st-pw" novalidate autocomplete="on">
          <input type="text" name="username" value="${esc(a.username || '')}" autocomplete="username" hidden>
          <div class="st-grid">
            <label class="mm-field"><span>Current password</span><input type="password" name="currentPassword" autocomplete="current-password" required></label>
            <label class="mm-field"><span>New password</span><input type="password" name="newPassword" autocomplete="new-password" minlength="8" required aria-describedby="st-pw-hint"></label>
            <label class="mm-field"><span>Confirm new password</span><input type="password" name="confirm" autocomplete="new-password" required></label>
          </div>
          <p class="pg-muted" id="st-pw-hint">At least 8 characters, including a letter and a number. You'll stay signed in on this device.</p>
          <p class="mm-err" id="st-pw-err" role="alert"></p>
          <div class="st-actions"><a class="pg-muted" href="member-forgot-password.html">Forgot your current password?</a><button type="submit" class="btn btn-green">Change password</button></div>
        </form></section>

      <section class="pg-card" aria-labelledby="st-prof-h"><h2 class="pg-h" id="st-prof-h">👤 Profile preferences</h2>
        <fieldset class="st-radios"${off ? ' disabled' : ''}><legend>On event leaderboards, show me as</legend>
          <label><input type="radio" name="lb" value="name"${p.leaderboardVisibility === 'name' ? ' checked' : ''}> My first name and initial</label>
          <label><input type="radio" name="lb" value="anonymous"${p.leaderboardVisibility === 'anonymous' ? ' checked' : ''}> “Member” (anonymous)</label></fieldset>
        ${off ? '<p class="st-pending">Available after the same database update.</p>' : '<button type="button" class="btn btn-green" id="st-lb-save" disabled>Save preference</button>'}
        <p class="pg-muted">Contact details, emergency contact and photo are edited on <a href="member-profile.html">My Account</a>.</p></section>

      <section class="pg-card" aria-labelledby="st-acc-h"><div class="cl-head"><h2 class="pg-h" id="st-acc-h">🔒 Account</h2><span class="st-lock">Managed by the gym</span></div>
        <dl class="st-kv"><dt>Username</dt><dd>${esc(a.username || '—')}</dd><dt>Account type</dt><dd>Member</dd><dt>Last sign-in</dt><dd>${esc(when(a.lastLoginAt))}</dd></dl>
        <p class="pg-muted">Your membership, account status and access level are set by the gym and can't be changed here. <a href="member-membership.html">View membership</a></p></section></div>`;
    wire();
  }

  function wire() {
    const lang = content.querySelector('#st-lang');
    lang.addEventListener('change', () => { lang.querySelector('button').disabled = lang.language.value === data.language; });
    lang.addEventListener('submit', (e) => { e.preventDefault(); act(lang.querySelector('button'), async () => { await api.patch('/profile', { preferredLanguage: lang.language.value }); }, 'Language saved.'); });

    const nf = content.querySelector('#st-notif');
    nf.addEventListener('change', () => { nf.querySelector('button').disabled = !data.preferences.available || NOTIFY.every(([k]) => nf[k].checked === data.preferences.notifications[k]); });
    nf.addEventListener('submit', (e) => {
      e.preventDefault();
      const notifications = Object.fromEntries(NOTIFY.map(([k]) => [k, nf[k].checked]));
      act(nf.querySelector('button'), () => api.put('/settings/preferences', { notifications }), 'Notification preferences saved.');
    });

    const lbSave = content.querySelector('#st-lb-save');
    content.querySelectorAll('input[name=lb]').forEach((r) => r.addEventListener('change', () => { if (lbSave) lbSave.disabled = r.value === data.preferences.leaderboardVisibility; }));
    lbSave?.addEventListener('click', () => {
      const v = content.querySelector('input[name=lb]:checked')?.value;
      act(lbSave, () => api.put('/settings/preferences', { leaderboardVisibility: v }), 'Leaderboard preference saved.');
    });

    const pw = content.querySelector('#st-pw');
    pw.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = content.querySelector('#st-pw-err');
      const cur = pw.currentPassword.value; const nw = pw.newPassword.value; const cf = pw.confirm.value;
      const problems = [];
      if (!cur) problems.push('Enter your current password.');
      if (nw.length < 8 || !/[A-Za-z]/.test(nw) || !/\d/.test(nw)) problems.push('New password needs at least 8 characters with a letter and a number.');
      else if (nw === cur) problems.push('Choose a password different from your current one.');
      if (nw !== cf) problems.push('The new passwords do not match.');
      if (problems.length) { err.textContent = problems.join(' '); return; }
      err.textContent = '';
      const btn = pw.querySelector('button[type=submit]');
      if (busy) return; busy = true; btn.disabled = true; btn.textContent = 'Changing…';
      try {
        await api.auth.updateProfile({ currentPassword: cur, newPassword: nw });
        pw.reset(); toast('Your password was changed.');
      } catch (ex) {
        err.textContent = ex instanceof ApiError ? ex.message : 'Could not change the password — please try again.';
      } finally { busy = false; btn.disabled = false; btn.textContent = 'Change password'; }
    });
  }

  async function act(btn, fn, okText) {
    if (busy) return; busy = true; btn.disabled = true;
    try { await fn(); data = (await api.get('/settings')).data; render(); toast(okText); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save — please try again.', true); btn.disabled = false; }
    finally { busy = false; }
  }

  content.innerHTML = '<div class="mp-loading">Loading settings…</div>';
  try { data = (await api.get('/settings')).data; render(); }
  catch (e) { content.innerHTML = notice('Could not load settings', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true }); }
}
