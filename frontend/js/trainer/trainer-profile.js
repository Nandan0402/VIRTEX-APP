/** Virtex Trainer Hub — trainer-profile.html page logic. */
import { api } from './trainer-api.js';
import { initShell, esc, dash, fmtDate, badge, notice, renderError, formData, toast } from './trainer-navigation.js';

const shell = await initShell({ page: 'profile', title: 'My Profile', subtitle: 'Your trainer profile and account details', requireProfile: false });

if (shell) {
  const { content, trainer } = shell;
  content.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
  try {
    const me = (await api.auth.me()).data;
    const t = trainer;
    const certs = Array.isArray(t?.certifications) ? t.certifications.join(', ') : t?.certifications;
    content.innerHTML = `<div class="tp-grid-2">
      <div class="card"><h3 class="tp-card-title">Trainer profile</h3>
        ${t ? `<dl class="tp-kv"><dt>Name</dt><dd>${esc(t.full_name)}</dd><dt>Trainer code</dt><dd>${dash(t.trainer_code)}</dd>
          <dt>Status</dt><dd>${badge(t.status)}</dd><dt>Specialty</dt><dd>${dash(t.specialty)}</dd><dt>Certifications</dt><dd>${dash(certs)}</dd>
          <dt>Phone</dt><dd>${dash(t.phone)}</dd><dt>Email</dt><dd>${dash(t.email)}</dd><dt>Bio</dt><dd class="tp-pre">${dash(t.bio)}</dd>
          <dt>Joined</dt><dd>${fmtDate(t.created_at)}</dd></dl>
          <div class="tp-muted tp-mt">Specialty, certifications and status are managed by an administrator.</div>`
          : notice('No trainer profile linked', 'Ask an administrator to link your account to a trainer profile.', { error: true })}
      </div>
      <div class="card"><h3 class="tp-card-title">Account details</h3>
        <form id="f"><div class="form-group"><label>Username</label><input value="${esc(me.username || '')}" disabled></div>
          <div class="form-group"><label>Full name</label><input name="fullName" maxlength="120" value="${esc(me.fullName || me.full_name || '')}"></div>
          <div class="form-group"><label>Email</label><input name="email" type="email" maxlength="150" value="${esc(me.email || '')}"></div>
          <div class="form-group"><label>Phone</label><input name="phone" maxlength="30" value="${esc(me.phone || '')}"></div>
          <button class="btn btn-green" type="submit">Save account details</button></form></div></div>`;
    content.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await api.auth.updateProfile(formData(e.target));
        toast('Account details saved.');
      } catch (err) { toast(err.message, { error: true }); }
      btn.disabled = false;
    });
  } catch (err) { renderError(content, err, 'Profile'); }
}
