/** Virtex Member Portal — member-profile.html: My Account (the signed-in member's own profile).
 *  Read:  GET   /api/v1/member/profile
 *  Write: PATCH /api/v1/member/profile        (email, phone, emergency contact, language only)
 *         PUT   /api/v1/member/profile/photo  (PNG/JPEG/WebP ≤ 2 MB, or remove)
 *  Name, date of birth, membership, fees, status and roles are managed by the gym and are read-only here.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'profile', title: 'My Account', subtitle: 'Your personal details and contact information' });

const LANGS = { 'en-IN': 'English', 'kn-IN': 'ಕನ್ನಡ — Kannada', 'hi-IN': 'हिन्दी — Hindi' };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,18}$/;
const MAX_PHOTO = 2 * 1024 * 1024;
const dash = (v) => (v === null || v === undefined || v === '' ? '<span class="pf-none">Not recorded</span>' : esc(v));
const fmtDate = (v) => (v ? esc(new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })) : '<span class="pf-none">Not recorded</span>');
/** Only render photo URLs the app itself produces (no javascript:, no remote URLs). */
const safePhoto = (u) => (typeof u === 'string' && (/^\/uploads\/avatars\/[\w.-]+$/.test(u) || /^data:image\/(png|jpeg|webp);base64,/.test(u)) ? u : null);
const initials = (n) => String(n || 'M').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

function toast(message, error = false) {
  let el = document.getElementById('pf-toast');
  if (!el) { el = document.createElement('div'); el.id = 'pf-toast'; el.className = 'toast-banner mp-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.classList.toggle('error', error);
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function avatarHtml(url, name) {
  const src = safePhoto(url);
  return src ? `<img class="pf-photo" src="${esc(src)}" alt="Profile photo of ${esc(name)}">`
    : `<div class="pf-photo pf-photo-initials" aria-label="No profile photo">${esc(initials(name))}</div>`;
}

function render(content, d) {
  const m = d.member;
  const ms = d.membership;
  const start = ms?.start_date
    ? `${fmtDate(ms.start_date)}<div class="pf-hint">Current membership period${ms.plan_name ? ` · ${esc(ms.plan_name)}` : ''}</div>`
    : `${fmtDate(m.created_at)}<div class="pf-hint">Date you joined (no membership period on record)</div>`;
  const goal = d.fitnessGoal
    ? `${esc(d.fitnessGoal)}<div class="pf-hint">Set by ${d.fitnessGoalSource === 'performance_profile' ? 'your trainer in your performance profile' : 'your trainer assignment'}</div>`
    : '<span class="pf-none">Not set yet</span><div class="pf-hint">Your trainer records this with you</div>';
  const trainer = d.trainer
    ? `${esc(d.trainer.name)}${d.trainer.specialty ? ` <span class="pf-muted">· ${esc(d.trainer.specialty)}</span>` : ''}<div class="pf-hint">Assigned since ${fmtDate(d.trainer.since)}${d.trainer.status === 'paused' ? ' · paused' : ''}</div>`
    : '<span class="pf-none">No trainer assigned</span>';

  content.innerHTML = `
    <section class="card pf-hero">
      <div class="pf-photo-wrap" id="pf-photo-box">${avatarHtml(d.account?.avatarUrl, m.full_name)}</div>
      <div class="pf-hero-main">
        <h2 class="pf-name">${esc(m.full_name)}</h2>
        <div class="pf-sub"><span class="pf-code">${esc(m.member_code || `#${m.id}`)}</span>
          <span class="pf-pill pf-pill-${esc(String(m.status || '').toLowerCase())}">${esc(m.status || 'unknown')}</span>
          ${m.plan_name ? `<span class="pf-muted">${esc(m.plan_name)}</span>` : ''}</div>
        <div class="pf-photo-actions">
          <label class="btn btn-outline pf-file-btn">📷 Change photo
            <input type="file" id="pf-file" accept="image/png,image/jpeg,image/webp" hidden></label>
          ${safePhoto(d.account?.avatarUrl) ? '<button type="button" class="btn btn-outline" id="pf-photo-remove">Remove photo</button>' : ''}
          <span class="pf-hint">PNG, JPEG or WebP · up to 2 MB</span>
        </div>
      </div>
    </section>

    <div class="pf-cols">
      <section class="card pf-section" aria-labelledby="pf-personal-h">
        <div class="pf-section-head"><h2 id="pf-personal-h">Personal details</h2><span class="pf-lock" title="Managed by the gym">🔒 Managed by the gym</span></div>
        <dl class="pf-kv">
          <dt>Member ID</dt><dd class="pf-mono">${esc(m.member_code || `#${m.id}`)}</dd>
          <dt>Full name</dt><dd>${esc(m.full_name)}</dd>
          <dt>Date of birth</dt><dd>${fmtDate(m.date_of_birth)}</dd>
          <dt>Membership start</dt><dd>${start}</dd>
          <dt>Fitness goal</dt><dd>${goal}</dd>
          <dt>Assigned trainer</dt><dd>${trainer}</dd>
          <dt>Login username</dt><dd class="pf-mono">${dash(d.account?.username)}</dd>
        </dl>
        <p class="pf-note">To correct your name or date of birth, please ask the front desk — these are verified against your ID.</p>
      </section>

      <section class="card pf-section" aria-labelledby="pf-contact-h">
        <div class="pf-section-head"><h2 id="pf-contact-h">Contact &amp; emergency details</h2><span class="pf-editable">✎ You can edit</span></div>
        <form id="pf-form" novalidate>
          <div class="mp-form-grid">
            <div class="form-group"><label for="pf-email">Email *</label>
              <input id="pf-email" name="email" type="email" maxlength="120" autocomplete="email" value="${esc(m.email || '')}" aria-describedby="pf-email-err">
              <div class="pf-err" id="pf-email-err"></div></div>
            <div class="form-group"><label for="pf-phone">Phone *</label>
              <input id="pf-phone" name="phone" type="tel" maxlength="20" autocomplete="tel" value="${esc(m.phone || '')}" aria-describedby="pf-phone-err">
              <div class="pf-err" id="pf-phone-err"></div></div>
            <div class="form-group"><label for="pf-ec-name">Emergency contact name</label>
              <input id="pf-ec-name" name="emergencyContactName" maxlength="100" value="${esc(m.emergency_contact_name || '')}" aria-describedby="pf-ec-name-err">
              <div class="pf-err" id="pf-ec-name-err"></div></div>
            <div class="form-group"><label for="pf-ec-phone">Emergency contact phone</label>
              <input id="pf-ec-phone" name="emergencyContactPhone" type="tel" maxlength="20" value="${esc(m.emergency_contact_phone || '')}" aria-describedby="pf-ec-phone-err">
              <div class="pf-err" id="pf-ec-phone-err"></div></div>
            <div class="form-group"><label for="pf-lang">FitBot / kiosk language</label>
              <select id="pf-lang" name="preferredLanguage">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${m.preferred_language === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
          </div>
          <p class="pf-note">Your email and phone are also your sign-in details. Your emergency contact is visible only to you, the gym team and your assigned trainer.</p>
          <div class="mp-form-actions">
            <button type="reset" class="btn btn-outline" id="pf-reset" disabled>Cancel changes</button>
            <button type="submit" class="btn btn-green" id="pf-save" disabled>Save changes</button>
          </div>
        </form>
      </section>
    </div>

    <section class="card pf-section" aria-labelledby="pf-ms-h">
      <div class="pf-section-head"><h2 id="pf-ms-h">Membership</h2><span class="pf-lock">🔒 Managed by the gym</span></div>
      <dl class="pf-kv pf-kv-inline">
        <dt>Status</dt><dd><span class="pf-pill pf-pill-${esc(String(m.status || '').toLowerCase())}">${esc(m.status || 'unknown')}</span></dd>
        <dt>Plan</dt><dd>${dash(m.plan_name || ms?.plan_name)}</dd>
        <dt>Payment</dt><dd>${dash(m.payment_status)}${Number(m.fee_due) > 0 ? ` · ₹${esc(Number(m.fee_due).toLocaleString())} due${m.fee_due_date ? ` by ${fmtDate(m.fee_due_date)}` : ''}` : ''}</dd>
        <dt>Valid until</dt><dd>${ms?.end_date ? fmtDate(ms.end_date) : '<span class="pf-none">Not recorded</span>'}</dd>
      </dl>
      <a class="btn btn-outline" href="member-membership.html">View membership</a>
    </section>`;
}

// ------------------------------------------------------------------ form behaviour
function wireForm(content, d, reload) {
  const form = content.querySelector('#pf-form');
  const save = content.querySelector('#pf-save');
  const reset = content.querySelector('#pf-reset');
  const original = {
    email: d.member.email || '', phone: d.member.phone || '', emergencyContactName: d.member.emergency_contact_name || '',
    emergencyContactPhone: d.member.emergency_contact_phone || '', preferredLanguage: d.member.preferred_language || 'en-IN',
  };
  const current = () => Object.fromEntries([...form.elements].filter((el) => el.name).map((el) => [el.name, el.value.trim()]));
  const changed = () => { const c = current(); return Object.fromEntries(Object.entries(c).filter(([k, v]) => v !== original[k])); };
  const setErr = (id, msg) => { const el = content.querySelector(`#${id}`); const input = content.querySelector(`#${id.replace('-err', '')}`); el.textContent = msg || ''; input.setAttribute('aria-invalid', msg ? 'true' : 'false'); };
  const validate = (c) => {
    let ok = true;
    const rules = [
      ['pf-email-err', !EMAIL_RE.test(c.email) && 'Enter a valid email address.'],
      ['pf-phone-err', !PHONE_RE.test(c.phone) && 'Enter a valid phone number (7–20 digits).'],
      ['pf-ec-name-err', c.emergencyContactName.length > 100 && 'Maximum 100 characters.'],
      ['pf-ec-phone-err', c.emergencyContactPhone && !PHONE_RE.test(c.emergencyContactPhone) && 'Enter a valid phone number.'],
    ];
    rules.forEach(([id, msg]) => { setErr(id, msg || ''); if (msg) ok = false; });
    return ok;
  };
  const sync = () => { const dirty = Object.keys(changed()).length > 0; save.disabled = !dirty; reset.disabled = !dirty; };
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  form.addEventListener('reset', () => setTimeout(() => { ['pf-email-err', 'pf-phone-err', 'pf-ec-name-err', 'pf-ec-phone-err'].forEach((id) => setErr(id, '')); sync(); }, 0));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = changed();
    if (!Object.keys(body).length) return;
    if (!validate(current())) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
    save.disabled = true; reset.disabled = true;
    save.textContent = 'Saving…';
    try {
      await api.patch('/profile', body);
      toast('Your details were saved.');
      await reload();
    } catch (err) {
      if (err.status === 409) setErr(/phone/i.test(err.message) ? 'pf-phone-err' : 'pf-email-err', err.message);
      toast(err.message || 'Could not save your details.', true);
      save.textContent = 'Save changes';
      sync();
    }
  });
}

function wirePhoto(content, reload) {
  const file = content.querySelector('#pf-file');
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { toast('Choose a PNG, JPEG or WebP image.', true); return; }
    if (f.size > MAX_PHOTO) { toast('The photo must be 2 MB or smaller.', true); return; }
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    const box = content.querySelector('#pf-photo-box');
    const before = box.innerHTML;
    box.innerHTML = `<img class="pf-photo pf-photo-pending" src="${esc(dataUrl)}" alt="New photo preview">`;
    try {
      await api.put('/profile/photo', { image: dataUrl });
      toast('Your photo was updated.');
      await reload();
    } catch (err) {
      box.innerHTML = before;
      toast(err.message || 'Could not upload the photo.', true);
    }
  });
  content.querySelector('#pf-photo-remove')?.addEventListener('click', async () => {
    if (!window.confirm('Remove your profile photo?')) return;
    try { await api.put('/profile/photo', { remove: true }); toast('Your photo was removed.'); await reload(); }
    catch (err) { toast(err.message || 'Could not remove the photo.', true); }
  });
}

if (shell) {
  const { content } = shell;
  const load = async () => {
    const d = (await api.get('/profile')).data;
    render(content, d);
    wireForm(content, d, load);
    wirePhoto(content, load);
    // keep the topbar name/initials in step with the record
    const nameEl = document.getElementById('mp-user-name');
    if (nameEl) nameEl.textContent = d.member.full_name;
  };
  content.innerHTML = '<div class="mp-muted mp-loading">Loading your profile…</div>';
  try {
    await load();
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) {
      content.innerHTML = notice(err.status === 403 ? 'Access denied' : 'Could not load your profile', err.message || 'Unexpected error.', { error: true });
    }
  }
}
