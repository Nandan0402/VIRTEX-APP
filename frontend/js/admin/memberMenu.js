/**
 * memberMenu.js — Admin → Member Menu (admin-member-menu.html).
 * Switch Member Portal features on/off separately for personal-training members and general members.
 * GET/PUT /api/v1/admin/member-menu (migration 035). Members see the change the next time they open a page.
 */
import { adminApi } from './adminApi.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let data = null; let draft = null;

async function call(opts = {}) {
  const res = await fetch('/api/v1/admin/member-menu', { ...opts, headers: adminApi.getHeaders(true) });
  if (res.status === 401) { adminApi.redirectToLogin(); throw new Error('Please sign in again.'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}
function toast(msg, error = false) {
  const n = document.createElement('div'); n.setAttribute('role', 'status');
  n.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:9999;padding:.7rem 1rem;border-radius:10px;font-weight:700;font-size:.88rem;background:${error ? '#7f1d1d' : '#064e3b'};color:#fff;border:1px solid ${error ? '#ef4444' : '#10b981'}`;
  n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 3500);
}
const same = () => JSON.stringify(draft) === JSON.stringify({ personal: data.personal, general: data.general });

function render() {
  const sw = (g, key, on, label) => `<label class="mmn-sw" title="${on ? 'On' : 'Off'}"><input type="checkbox" data-g="${g}" data-k="${esc(key)}" ${on ? 'checked' : ''} aria-label="${esc(label)} for ${g === 'personal' ? 'personal-training' : 'general'} members"><span></span></label>`;
  const locked = (icon, label) => `<tr class="locked"><td><span class="mmn-ico">${icon}</span>${esc(label)} <span class="mmn-muted">· always on</span></td>
      <td class="mmn-col"><label class="mmn-sw"><input type="checkbox" checked disabled aria-label="${esc(label)} always on"><span></span></label></td>
      <td class="mmn-col"><label class="mmn-sw"><input type="checkbox" checked disabled aria-label="${esc(label)} always on"><span></span></label></td></tr>`;
  $('mmn-body').innerHTML = locked('🏠', 'Dashboard')
    + data.items.map((i) => `<tr><td><span class="mmn-ico" aria-hidden="true">${i.icon}</span>${esc(i.label)}</td>
        <td class="mmn-col">${sw('personal', i.key, draft.personal[i.key], i.label)}</td>
        <td class="mmn-col">${sw('general', i.key, draft.general[i.key], i.label)}</td></tr>`).join('')
    + locked('👤', 'My Account (profile & settings)');
  $('mmn-n-personal').textContent = `${data.counts?.personal ?? 0} member${data.counts?.personal === 1 ? '' : 's'}`;
  $('mmn-n-general').textContent = `${data.counts?.general ?? 0} member${data.counts?.general === 1 ? '' : 's'}`;
  $('mmn-save').disabled = same();
  $('mmn-note').textContent = data.available ? 'A member counts as “personal-training” while they have an active or paused personal trainer.' : 'Saving needs database migration 035.';
}

$('mmn-body').addEventListener('change', (e) => {
  const c = e.target.closest('input[data-g]'); if (!c) return;
  draft[c.dataset.g][c.dataset.k] = c.checked;
  $('mmn-save').disabled = same();
});
$('mmn-reset').addEventListener('click', () => {
  draft = { personal: { ...data.defaults.personal }, general: { ...data.defaults.general } };
  render(); toast('Defaults loaded — press Save changes to apply.');
});
$('mmn-save').addEventListener('click', async () => {
  const b = $('mmn-save'); b.disabled = true;
  try {
    const r = await call({ method: 'PUT', body: JSON.stringify(draft) });
    data.personal = r.data.personal; data.general = r.data.general;
    draft = { personal: { ...data.personal }, general: { ...data.general } };
    render(); toast(`✅ ${r.message}`);
  } catch (err) { toast(err.message, true); b.disabled = false; }
});

(async () => {
  try {
    data = (await call()).data;
    draft = { personal: { ...data.personal }, general: { ...data.general } };
    render();
  } catch (err) { $('mmn-body').innerHTML = `<tr><td colspan="3" class="mmn-muted">${esc(err.message)}</td></tr>`; }
})();
