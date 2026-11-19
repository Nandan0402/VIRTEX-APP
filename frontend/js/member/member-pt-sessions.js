/** Virtex Member Portal — member-pt-sessions.html: My PT Sessions.
 *  Uses: GET  /api/v1/member/pt-sessions?limit=100            (own sessions only)
 *        POST /api/v1/member/pt-sessions/:id/respond          { response: 'confirm'|'decline', reason? }
 *        POST /api/v1/member/pt-sessions/:id/rating           { rating: 1-5, feedback? }  (completed, once)
 *  Sessions are booked by the member's trainer in the Trainer Hub. The member answers the booking here;
 *  the trainer sees the answer on trainer-pt-sessions.html. Package balance is only changed by the trainer
 *  closing a session — never by this page. Nothing is deleted: a decline keeps the row as "cancelled".
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';

const shell = await initShell({ page: 'pt-sessions', title: 'My PT Sessions', subtitle: 'Your personal training sessions' });

const dLong = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const tShort = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const STATUS = {
  booked: ['Awaiting your reply', 'pt-wait'], confirmed: ['Confirmed', 'pt-ok'], completed: ['Completed', 'pt-done'],
  cancelled: ['Cancelled', 'pt-off'], no_show: ['Missed', 'pt-off'],
};

if (shell) {
  const { content } = shell;
  let rows = []; let busy = false; let flash = null;

  function card(s) {
    const [label, cls] = STATUS[s.status] || [s.status, ''];
    const upcoming = new Date(s.scheduled_start) > new Date();
    const canAnswer = upcoming && (s.status === 'booked' || s.status === 'confirmed');
    const canRate = s.status === 'completed' && !s.member_rating;
    let extra = '';
    if (s.status === 'cancelled' && s.cancellation_reason) extra = `<p class="pg-muted">${esc(s.cancellation_reason)}</p>`;
    if (s.member_rating) extra = `<p class="pg-muted">Your rating: ${'★'.repeat(s.member_rating)}${'☆'.repeat(5 - s.member_rating)}${s.member_feedback ? ` — “${esc(s.member_feedback)}”` : ''}</p>`;
    return `<article class="pt-card" data-id="${esc(s.public_id)}">
      <div class="pt-when"><b>${esc(dLong(s.scheduled_start))}</b><span>${esc(tShort(s.scheduled_start))} – ${esc(tShort(s.scheduled_end))}</span></div>
      <div class="pt-main"><div class="pt-top"><span class="pt-badge ${cls}">${esc(label)}</span>${s.location ? `<span class="pg-muted">📍 ${esc(s.location)}</span>` : ''}</div>
        <p class="pt-trainer">with ${esc(s.trainer_name || 'your trainer')}${s.sessions_remaining !== null && s.sessions_remaining !== undefined ? ` · <span class="pg-muted">${esc(String(s.sessions_remaining))} session${s.sessions_remaining === 1 ? '' : 's'} left on package</span>` : ''}</p>
        ${extra}
        ${canAnswer ? `<div class="pt-actions">
          ${s.status === 'booked' ? '<button type="button" class="btn btn-green" data-act="confirm">Confirm</button>' : ''}
          <button type="button" class="btn btn-outline" data-act="decline-open">${s.status === 'booked' ? 'Decline' : 'Can’t make it'}</button></div>
          <form class="pt-form" data-form="decline" hidden><label class="mm-field"><span>Reason for your trainer (optional)</span><input name="reason" maxlength="200" autocomplete="off"></label>
            <div class="pt-actions"><button type="submit" class="btn btn-outline">Decline session</button><button type="button" class="btn btn-outline" data-act="close">Keep it</button></div></form>` : ''}
        ${canRate ? `<form class="pt-form" data-form="rate"><fieldset class="pt-stars"><legend>Rate this session</legend>
          ${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rating" value="${n}" required><span>${n}</span></label>`).join('')}</fieldset>
          <label class="mm-field"><span>Comment for your trainer (optional)</span><input name="feedback" maxlength="1000" autocomplete="off"></label>
          <div class="pt-actions"><button type="submit" class="btn btn-green">Send rating</button></div></form>` : ''}
      </div></article>`;
  }

  function render() {
    const now = new Date();
    const upcoming = rows.filter((s) => new Date(s.scheduled_start) > now && (s.status === 'booked' || s.status === 'confirmed'));
    const past = rows.filter((s) => !upcoming.includes(s)).reverse();
    const waiting = upcoming.filter((s) => s.status === 'booked').length;
    content.innerHTML = `<div class="pg-wrap">
      ${flash ? `<div class="${flash.err ? 'cl-flash err' : 'mm-flash'}" role="status">${esc(flash.text)}</div>` : ''}
      <section class="pg-card"><div class="cl-head"><h2 class="pg-h">Upcoming</h2>${waiting ? `<span class="pt-badge pt-wait">${waiting} awaiting your reply</span>` : ''}</div>
        <p class="pg-muted">Your trainer books sessions in the Trainer Hub. Confirm the ones you can attend, or decline so they can rebook — your package balance only changes when the trainer closes a session.</p>
        ${upcoming.length ? `<div class="pt-list">${upcoming.map(card).join('')}</div>` : emptyState('No upcoming sessions', 'When your trainer books a PT session it appears here for you to confirm.')}</section>
      <section class="pg-card"><h2 class="pg-h">History</h2>
        ${past.length ? `<div class="pt-list">${past.map(card).join('')}</div>` : '<p class="pg-muted">No past sessions yet.</p>'}</section></div>`;
    wire();
  }

  function wire() {
    content.querySelectorAll('.pt-card').forEach((el) => {
      const id = el.dataset.id;
      el.querySelector('[data-act=confirm]')?.addEventListener('click', (e) => send(e.currentTarget, `/pt-sessions/${encodeURIComponent(id)}/respond`, { response: 'confirm' }, 'Session confirmed — your trainer has been told.'));
      const dec = el.querySelector('[data-form=decline]');
      el.querySelector('[data-act=decline-open]')?.addEventListener('click', () => { dec.hidden = false; dec.reason.focus(); });
      el.querySelector('[data-act=close]')?.addEventListener('click', () => { dec.hidden = true; });
      dec?.addEventListener('submit', (e) => {
        e.preventDefault();
        const reason = dec.reason.value.trim();
        send(dec.querySelector('[type=submit]'), `/pt-sessions/${encodeURIComponent(id)}/respond`, { response: 'decline', ...(reason ? { reason } : {}) }, 'Session declined — your trainer has been told.');
      });
      const rate = el.querySelector('[data-form=rate]');
      rate?.addEventListener('submit', (e) => {
        e.preventDefault();
        const rating = Number(rate.querySelector('input[name=rating]:checked')?.value);
        if (!rating) return;
        const feedback = rate.feedback.value.trim();
        send(rate.querySelector('[type=submit]'), `/pt-sessions/${encodeURIComponent(id)}/rating`, { rating, ...(feedback ? { feedback } : {}) }, 'Thanks — your rating was sent to your trainer.');
      });
    });
  }

  async function send(btn, path, body, okText) {
    if (busy) return; busy = true; btn.disabled = true;
    try { await api.post(path, body); flash = { text: okText }; }
    catch (e) { flash = { text: e instanceof ApiError ? e.message : 'Could not send — please try again.', err: true }; }
    finally { busy = false; }
    await load();
  }

  async function load() {
    try { rows = (await api.get('/pt-sessions', { limit: 100 })).data || []; render(); }
    catch (e) {
      if (e instanceof ApiError && e.migrationsPending) {
        content.innerHTML = notice('PT sessions are not switched on yet', 'The gym needs to apply a database update before PT bookings appear here. Ask your trainer about your sessions in the meantime.');
        return;
      }
      content.innerHTML = notice('Could not load your PT sessions', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true });
    }
  }

  content.innerHTML = '<div class="mp-loading">Loading your sessions…</div>';
  await load();
}
