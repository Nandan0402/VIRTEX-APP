/** Virtex Trainer Hub — trainer-pt-sessions.html page logic. */
import { api, ApiError } from './trainer-api.js';
import { initShell, esc, dash, fmtDateTime, badge, emptyState, notAvailable, renderError, renderPager, openModal, formData, clientSelect, toast } from './trainer-navigation.js';

const shell = await initShell({ page: 'pt-sessions', title: 'PT Sessions', subtitle: 'Book, run and close personal training sessions' });

if (shell) {
  const { content, actions } = shell;
  content.innerHTML = `
    <div class="tp-toolbar"><select class="select-filter" id="status"><option value="">All statuses</option>
      <option value="booked">Awaiting member</option><option value="confirmed">Confirmed by member</option><option value="completed">Completed</option><option value="no_show">No-show</option><option value="cancelled">Cancelled</option></select></div>
    <div class="card"><div class="table-responsive" id="list"></div><div class="tp-pager" id="pager"></div></div>`;
  const list = content.querySelector('#list');
  const pager = content.querySelector('#pager');
  let page = 1;
  let rows = [];
  let available = false;

  /** What the member said about the session (confirmation, decline reason, rating) — from pt_sessions only. */
  function memberResponse(s) {
    if (s.status === 'confirmed') return '<div class="tp-muted">Member confirmed</div>';
    if (s.status === 'cancelled' && s.cancellation_reason) return `<div class="tp-muted">${esc(s.cancellation_reason)}</div>`;
    if (s.member_rating) return `<div class="tp-muted">Member rated ${esc(String(s.member_rating))}/5${s.member_feedback ? ` · “${esc(s.member_feedback)}”` : ''}</div>`;
    return '';
  }

  async function load() {
    list.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
    try {
      const res = await api.get('/pt-sessions', { page, limit: 20, status: content.querySelector('#status').value });
      if (!available) {
        available = true;
        actions.insertAdjacentHTML('beforeend', '<button class="btn btn-green" id="book">+ Book session</button>');
        actions.querySelector('#book').addEventListener('click', book);
      }
      rows = res.data;
      if (!rows.length) { list.innerHTML = emptyState('No PT sessions', 'Book a session for one of your active clients.'); pager.innerHTML = ''; return; }
      list.innerHTML = `<table class="admin-table"><thead><tr><th>When</th><th>Client</th><th>Location</th><th>Package</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((s, i) => `<tr><td>${fmtDateTime(s.scheduled_start)}<div class="tp-muted">to ${fmtDateTime(s.scheduled_end)}</div></td>
          <td class="tp-strong">${esc(s.member_name)}<div class="tp-muted">${dash(s.member_code)}</div></td><td>${dash(s.location)}</td>
          <td>${s.purchase_public_id ? `${dash(s.sessions_remaining)} left` : '—'}</td><td>${badge(s.status)}${memberResponse(s)}</td>
          <td>${s.status === 'booked' || s.status === 'confirmed' ?`<button class="btn btn-outline" data-close-i="${i}">Close</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      list.querySelectorAll('[data-close-i]').forEach((b) => b.addEventListener('click', () => complete(rows[Number(b.dataset.closeI)])));
      renderPager(pager, res.pagination, (p) => { page = p; load(); });
    } catch (err) {
      pager.innerHTML = '';
      if (err instanceof ApiError && err.migrationsPending) {
        content.innerHTML = notAvailable('PT Sessions');
        return;
      }
      renderError(list, err, 'PT Sessions');
    }
  }

  async function book() {
    const { el, close } = openModal('Book PT session', `<form id="f">
      <div class="form-group"><label>Active client *</label><select name="memberId" id="m" required></select></div>
      <div class="tp-form-grid"><div class="form-group"><label>Start *</label><input type="datetime-local" name="scheduledStart" required></div>
      <div class="form-group"><label>Duration (min)</label><input type="number" data-num name="durationMins" min="15" max="240" value="60"></div>
      <div class="form-group"><label>Location</label><input name="location" maxlength="120"></div></div>
      <div class="form-group"><label>PT package ID (optional)</label><input name="purchaseId" placeholder="UUID of the member's package"></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="2" maxlength="1000"></textarea></div>
      <div class="tp-form-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-green" type="submit">Book</button></div></form>`);
    try { await clientSelect(el.querySelector('#m'), { status: 'active', placeholder: 'Select an active client…' }); } catch (err) { toast(err.message, { error: true }); }
    el.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      body.memberId = Number(body.memberId);
      body.scheduledStart = new Date(body.scheduledStart).toISOString();
      try { await api.post('/pt-sessions', body); toast('Session booked.'); close(); load(); }
      catch (err) { toast(err.message, { error: true }); }
    });
  }

  function complete(s) {
    const { el, close } = openModal(`Close session · ${s.member_name}`, `<form id="f">
      <div class="tp-form-grid"><div class="form-group"><label>Outcome</label><select name="outcome"><option value="completed">Completed</option><option value="no_show">No-show</option></select></div></div>
      <label class="tp-muted"><input type="checkbox" name="chargeNoShow" checked> Deduct a session for a no-show</label>
      <div class="form-group tp-mt-sm"><label>Trainer notes</label><textarea name="trainerNotes" rows="3" maxlength="2000"></textarea></div>
      <div class="tp-form-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-green" type="submit">Close session</button></div></form>`);
    el.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api.patch(`/pt-sessions/${encodeURIComponent(s.public_id)}/complete`, formData(e.target)); toast('Session closed.'); close(); load(); }
      catch (err) { toast(err.message, { error: true }); }
    });
  }

  content.querySelector('#status').addEventListener('change', () => { page = 1; load(); });
  load();
}
