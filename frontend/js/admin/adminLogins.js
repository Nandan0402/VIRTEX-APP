/**
 * adminLogins.js — Admin → Logins & Access (admin-logins.html).
 * Every member + trainer login: add, freeze/unfreeze, set password, reset Google (2nd sign-in step), delete.
 * API: /api/v1/admin/logins (owner / manager only). All actions are audited on the server.
 */
import { adminApi } from './adminApi.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let rows = []; let filter = 'all'; let q = '';

async function call(path = '', opts = {}) {
  const res = await fetch(`/api/v1/admin/logins${path}`, { ...opts, headers: adminApi.getHeaders(true) });
  if (res.status === 401) { adminApi.redirectToLogin(); throw new Error('Please sign in again.'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}
function toast(msg, error = false) {
  const n = document.createElement('div'); n.setAttribute('role', 'status');
  n.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:10001;padding:.7rem 1rem;border-radius:10px;font-weight:700;font-size:.88rem;background:${error ? '#7f1d1d' : '#064e3b'};color:#fff;border:1px solid ${error ? '#ef4444' : '#10b981'}`;
  n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 4000);
}
const genPassword = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; let s = ''; const a = crypto.getRandomValues(new Uint32Array(12)); for (const x of a) s += c[x % c.length]; return `${s}!7`; };

/** Centred popup. fields: [{name,label,type,value,placeholder}] → resolves {..values} or null. */
function dialog({ title, message, fields = [], okText = 'OK', danger = false, onSubmit }) {
  return new Promise((resolve) => {
    const back = document.createElement('div'); back.className = 'lg-back';
    back.innerHTML = `<form class="lg-box" role="dialog" aria-modal="true" aria-labelledby="lg-dt" novalidate>
      <h3 id="lg-dt">${esc(title)}</h3>${message ? `<p>${message}</p>` : ''}
      ${fields.map((f) => `<label>${esc(f.label)}<span class="lg-row"><input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">${f.gen ? '<button type="button" class="lg-btn" data-gen>Generate</button>' : ''}</span></label>`).join('')}
      <p class="lg-err" role="alert"></p>
      <div class="lg-acts"><button type="button" class="lg-btn" data-x>Cancel</button><button type="submit" class="lg-btn ${danger ? 'danger' : 'add'}">${esc(okText)}</button></div></form>`;
    const form = back.querySelector('form');
    const done = (v) => { document.removeEventListener('keydown', key); back.remove(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(null); };
    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.closest('[data-x]')) done(null);
      if (e.target.closest('[data-gen]')) { const i = e.target.closest('.lg-row').querySelector('input'); i.value = genPassword(); i.type = 'text'; }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const vals = Object.fromEntries(fields.map((f) => [f.name, form[f.name].value.trim()]));
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try { await onSubmit(vals); done(vals); }
      catch (err) { form.querySelector('.lg-err').textContent = err.message; btn.disabled = false; }
    });
    document.addEventListener('keydown', key); document.body.appendChild(back);
    (form.querySelector('input') || form.querySelector('button[type=submit]')).focus();
  });
}

function render() {
  const s = q.toLowerCase();
  const list = rows.filter((r) => (filter === 'all' || (filter === 'member' && r.kind === 'member') || (filter === 'trainer' && r.kind === 'trainer')
      || (filter === 'frozen' && r.user_id && r.is_active === false) || (filter === 'none' && !r.user_id))
    && (!s || `${r.name} ${r.code || ''} ${r.email || ''} ${r.record_email || ''}`.toLowerCase().includes(s)));
  if (!list.length) { $('lg-body').innerHTML = '<tr><td colspan="6" class="lg-muted">Nobody matches.</td></tr>'; return; }
  $('lg-body').innerHTML = list.map((r) => {
    const who = `<b>${esc(r.name)}</b><span class="lg-tag ${r.kind}">${r.kind}</span><div class="lg-muted">${esc(r.code || '')}</div>`;
    if (!r.user_id) {
      return `<tr><td>${who}</td><td class="lg-muted">${esc(r.record_email || '—')}</td><td>—</td><td><span class="lg-pill none">No login</span></td><td>—</td>
        <td class="lg-act"><button type="button" class="lg-btn add" data-add="${r.kind}:${r.ref_id}">+ Add login</button></td></tr>`;
    }
    const active = r.is_active !== false;
    return `<tr><td>${who}</td><td>${esc(r.email || r.username)}</td>
      <td>${r.google_linked ? '<span class="lg-pill g">✓ Gmail linked</span>' : '<span class="lg-pill gwait">Links at next sign-in</span>'}</td>
      <td>${active ? '<span class="lg-pill ok">Active</span>' : '<span class="lg-pill frozen">❄️ Frozen</span>'}</td>
      <td class="lg-muted">${r.last_login_at ? esc(new Date(r.last_login_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : 'Never'}</td>
      <td class="lg-act">
        <button type="button" class="lg-btn" data-act="${active ? 'freeze' : 'unfreeze'}" data-id="${r.user_id}" data-name="${esc(r.name)}">${active ? '❄️ Freeze' : '🔓 Unfreeze'}</button>
        <button type="button" class="lg-btn" data-act="password" data-id="${r.user_id}" data-name="${esc(r.name)}">🔑 Password</button>
        ${r.google_linked ? `<button type="button" class="lg-btn" data-act="google" data-id="${r.user_id}" data-name="${esc(r.name)}">↺ Reset Google</button>` : ''}
        <button type="button" class="lg-btn danger" data-act="delete" data-id="${r.user_id}" data-name="${esc(r.name)}">🗑 Delete</button>
      </td></tr>`;
  }).join('');
}

async function load() {
  try { rows = (await call()).data; render(); }
  catch (err) { $('lg-body').innerHTML = `<tr><td colspan="6" class="lg-muted">${esc(err.message)}</td></tr>`; }
}

$('lg-body').addEventListener('click', async (e) => {
  const add = e.target.closest('[data-add]');
  if (add) {
    const [kind, refId] = add.dataset.add.split(':'); const r = rows.find((x) => x.kind === kind && String(x.ref_id) === refId);
    const v = await dialog({
      title: `➕ Add login — ${r.name}`, message: 'First sign-in: this email + password. Then they link their Gmail, which they use as the 2nd step every time.',
      fields: [{ name: 'email', label: 'Sign-in email', type: 'email', value: r.record_email || '', placeholder: 'name@example.com' }, { name: 'password', label: 'Password (min 8)', type: 'text', value: genPassword(), gen: true }],
      okText: 'Create login', onSubmit: async (x) => { const j = await call('', { method: 'POST', body: JSON.stringify({ kind, refId: Number(refId), email: x.email, password: x.password }) }); toast(`✅ ${j.message}`); },
    });
    if (v) { await load(); toast(`Give ${r.name}: ${v.email} / ${v.password}`); }
    return;
  }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const { act, id, name } = b.dataset;
  const go = async (path, opts, msg) => { const j = await call(path, opts); toast(`✅ ${j.message || msg}`); await load(); };
  try {
    if (act === 'freeze' || act === 'unfreeze') {
      const freeze = act === 'freeze';
      await dialog({ title: freeze ? `❄️ Freeze ${name}'s login?` : `🔓 Unfreeze ${name}'s login?`,
        message: freeze ? 'They are signed out everywhere at once and cannot sign in — with password or Google — until you unfreeze.' : 'They can sign in again (password + Gmail).',
        okText: freeze ? 'Freeze login' : 'Unfreeze', danger: freeze, onSubmit: () => go(`/${id}`, { method: 'PATCH', body: JSON.stringify({ active: !freeze }) }) });
    } else if (act === 'password') {
      const v = await dialog({ title: `🔑 New password — ${name}`, message: 'They still confirm with their linked Gmail after the password.',
        fields: [{ name: 'password', label: 'New password (min 8)', type: 'text', value: genPassword(), gen: true }], okText: 'Save password',
        onSubmit: (x) => go(`/${id}/password`, { method: 'POST', body: JSON.stringify({ password: x.password }) }) });
      if (v) toast(`Give ${name} the new password: ${v.password}`);
    } else if (act === 'google') {
      await dialog({ title: `↺ Reset Google for ${name}?`, message: 'Unlinks their Gmail. At the next sign-in (email + password) they link a Gmail again — use this if they lost access to their Google account.',
        okText: 'Reset Google', onSubmit: () => go(`/${id}/reset-google`, { method: 'POST', body: '{}' }) });
    } else if (act === 'delete') {
      await dialog({ title: `🗑 Delete ${name}'s login?`, message: 'They lose all access immediately (password and Google). Their member/trainer record and history stay, and you can add a new login later.',
        okText: 'Delete login', danger: true, onSubmit: () => go(`/${id}`, { method: 'DELETE' }) });
    }
  } catch (err) { toast(err.message, true); }
});

document.querySelector('.lg-filters').addEventListener('click', (e) => {
  const c = e.target.closest('[data-f]'); if (!c) return;
  filter = c.dataset.f;
  document.querySelectorAll('.lg-chip').forEach((x) => { const on = x === c; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
  render();
});
$('lg-search').addEventListener('input', (e) => { q = e.target.value.trim(); render(); });
load();
