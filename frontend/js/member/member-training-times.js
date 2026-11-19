/** Virtex Member Portal — "My training times" card (shown on member-trainer.html).
 *  GET  /api/v1/member/training-times              own personal + general training times and requests
 *  POST /api/v1/member/time-shift-requests         { kind, startTime, endTime, reason? } → goes to the admin
 *  POST /api/v1/member/time-shift-requests/:id/cancel
 *  Personal trainer and general trainer/time are set by the admin; the member can only ASK to change a time.
 */
import { api, ApiError } from './member-api.js';
import { esc } from './member-navigation.js';

const to12 = (t) => { if (!t) return '—'; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const range = (a, b) => (a && b ? `${to12(a)} – ${to12(b)}` : '');
const STATUS = { pending: ['⏳ Waiting for the admin', 'pending'], approved: ['✅ Approved', 'approved'], rejected: ['✗ Not approved', 'rejected'], cancelled: ['Cancelled', 'cancelled'] };

export function mountTrainingTimes(el) {
  let data = null; let open = null; let busy = false; let flash = '';

  function slotCard(kind, s) {
    const pending = data.requests.find((r) => r.kind === kind && r.status === 'pending');
    const title = kind === 'personal' ? '🤝 Personal training' : '🏋️ General training';
    if (!s) {
      return `<div class="tt-slot empty"><h3>${title}</h3><p class="mp-muted">${kind === 'personal' ? 'No personal trainer yet — the admin assigns one.' : 'No general-training time yet — the admin sets your general trainer and time.'}</p></div>`;
    }
    const time = s.startTime ? range(s.startTime, s.endTime) : (s.slot || 'Time not set');
    return `<div class="tt-slot"><h3>${title}</h3>
      <div class="tt-big">⏰ ${esc(time)}</div>
      <div class="mp-muted">with ${esc(s.trainerName || 'your trainer')}${s.sessionsPerWeek ? ` · ${esc(s.sessionsPerWeek)}× / week` : ''}</div>
      ${pending
        ? `<div class="tt-pending">⏳ You asked for <b>${esc(range(pending.requested_start, pending.requested_end))}</b> — waiting for the admin.
            <button type="button" class="btn btn-outline btn-sm" data-cancel="${esc(pending.id)}">Cancel request</button></div>`
        : open === kind
          ? `<form class="tt-req-form" data-kind="${kind}">
              <label class="tt-pair">New time <input type="time" name="start" required value="${esc(s.startTime || '')}"> – <input type="time" name="end" required value="${esc(s.endTime || '')}"></label>
              <label>Reason <span class="mp-muted">(optional)</span><input name="reason" maxlength="300" placeholder="e.g. office timing changed"></label>
              <div class="tt-btns"><button type="submit" class="btn btn-green" ${busy ? 'disabled' : ''}>Send to admin</button><button type="button" class="btn btn-outline" data-close="1">Cancel</button></div>
              <p class="mm-err" role="alert"></p></form>`
          : `<button type="button" class="btn btn-outline" data-open="${kind}">🔁 Request time change</button>`}
    </div>`;
  }

  function render() {
    if (!data.available) { el.innerHTML = ''; return; }
    const history = data.requests.filter((r) => r.status !== 'pending').slice(0, 5);
    el.innerHTML = `<section class="card tt-card" aria-labelledby="tt-h">
      <div class="tt-headrow"><h2 id="tt-h">⏰ My training times</h2><span class="mp-muted">Set by the admin. Ask here if you need a different time.</span></div>
      ${flash ? `<div class="tt-flash" role="status">${esc(flash)}</div>` : ''}
      <div class="tt-slots">${slotCard('personal', data.personal[0] || null)}${slotCard('general', data.general)}</div>
      ${history.length ? `<details class="tt-hist"><summary>Past requests (${history.length})</summary><ul>${history.map((r) => `<li>
          <span class="tt-st ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span>
          ${r.kind === 'personal' ? 'Personal' : 'General'}: ${esc(range(r.requested_start, r.requested_end))}
          ${r.status === 'approved' && r.approved_start ? ` → set to <b>${esc(range(r.approved_start, r.approved_end))}</b>` : ''}
          ${r.admin_note ? `<span class="mp-muted"> — “${esc(r.admin_note)}”</span>` : ''}</li>`).join('')}</ul></details>` : ''}
    </section>`;
  }

  async function load(msg = '') {
    try { data = (await api.get('/training-times')).data; flash = msg; render(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 401)) el.innerHTML = ''; }
  }

  el.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]'); if (o) { open = o.dataset.open; flash = ''; render(); el.querySelector('.tt-req-form input')?.focus(); return; }
    if (e.target.closest('[data-close]')) { open = null; render(); return; }
    const c = e.target.closest('[data-cancel]');
    if (c) {
      if (!confirm('Cancel your time-change request?')) return;
      c.disabled = true;
      try { await api.post(`/time-shift-requests/${encodeURIComponent(c.dataset.cancel)}/cancel`, {}); await load('Request cancelled.'); }
      catch (ex) { c.disabled = false; alert(ex.message); }
    }
  });
  el.addEventListener('submit', async (e) => {
    const f = e.target.closest('.tt-req-form'); if (!f) return;
    e.preventDefault();
    const err = f.querySelector('.mm-err');
    const start = f.start.value; const end = f.end.value;
    if (!start || !end || end <= start) { err.textContent = 'Choose a start and an end time (end after start).'; return; }
    busy = true; f.querySelector('button[type=submit]').disabled = true;
    try {
      await api.post('/time-shift-requests', { kind: f.dataset.kind, startTime: start, endTime: end, reason: f.reason.value });
      open = null; busy = false; await load('✅ Request sent. The admin will approve or reply — you will get a notification.');
    } catch (ex) { busy = false; err.textContent = ex.message || 'Could not send.'; f.querySelector('button[type=submit]').disabled = false; }
  });

  load();
}
