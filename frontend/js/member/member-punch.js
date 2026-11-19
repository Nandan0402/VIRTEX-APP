/** Virtex Member Portal — Punch In / Punch Out in the top bar (shown when the admin switched Attendance on).
 *  GET /api/v1/member/punch, POST /api/v1/member/punch-in, POST /api/v1/member/punch-out (check_ins, migration 035).
 *  A punch-in starts a gym visit; punch-out closes it. Visits show on the Attendance page and to the admin/trainer.
 */
import { api, ApiError } from './member-api.js';

const t = (v) => new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export async function mountPunch(el) {
  if (!el) return;
  let s;
  try { s = (await api.get('/punch')).data; } catch { return; }
  if (!s.available || s.allowed === false) { el.innerHTML = ''; return; }
  const render = () => {
    el.innerHTML = s.open
      ? `<span class="mp-punch-state on" title="Punched in at ${t(s.checkInTime)}">● In since ${t(s.checkInTime)}</span>
         <button type="button" class="mp-punch-btn out" data-punch="out">⏹ Punch Out</button>`
      : `<button type="button" class="mp-punch-btn in" data-punch="in">▶ Punch In</button>`;
  };
  render();
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-punch]'); if (!b) return;
    b.disabled = true;
    try {
      const r = await api.post(b.dataset.punch === 'in' ? '/punch-in' : '/punch-out', {});
      s = { ...s, ...r.data }; render(); flash(r.message);
      window.dispatchEvent(new Event('member:punch-changed'));
    } catch (err) { b.disabled = false; flash(err instanceof ApiError ? err.message : 'Could not save. Try again.', true); }
  });
  function flash(msg, error = false) {
    const n = document.createElement('div'); n.setAttribute('role', 'status');
    n.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:9999;padding:.7rem 1rem;border-radius:10px;font-weight:700;font-size:.88rem;background:${error ? '#7f1d1d' : '#064e3b'};color:#fff;border:1px solid ${error ? '#ef4444' : '#10b981'}`;
    n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 3500);
  }
}
