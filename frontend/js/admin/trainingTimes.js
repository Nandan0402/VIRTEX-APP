/**
 * trainingTimes.js — Admin → Training Times (admin-training-times.html)
 *  - Time-change requests from members: approve (optionally with a different time) or reject.
 *  - General training: give a member a general trainer + time; end it.
 *  - Personal training times (read-only here; edited on Assign Trainer).
 * API: /api/v1/admin/training-times, /general-training, /time-shift-requests (migration 033).
 */
import { adminApi } from './adminApi.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const to12 = (t) => { if (!t) return '—'; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const range = (a, b) => (a && b ? `${to12(a)} – ${to12(b)}` : '—');
const when = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

async function call(path, opts = {}) {
  const res = await fetch(`/api/v1/admin${path}`, { ...opts, headers: adminApi.getHeaders(true) });
  if (res.status === 401) { adminApi.redirectToLogin(); throw new Error('Please sign in again.'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw Object.assign(new Error(j.error || j.message || `Request failed (${res.status})`), { status: res.status });
  return j;
}
const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body || {}) });

function toast(msg, error = false) {
  const n = document.createElement('div');
  n.className = 'toast-banner'; n.setAttribute('role', 'status');
  n.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:9999;padding:.7rem 1rem;border-radius:10px;font-weight:700;font-size:.88rem;background:${error ? '#7f1d1d' : '#064e3b'};color:#fff;border:1px solid ${error ? '#ef4444' : '#10b981'}`;
  n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 3500);
}

let overview = null;

async function loadRequests() {
  const box = $('tt-requests');
  try {
    const all = $('tt-req-all').checked;
    const rows = (await call(`/time-shift-requests${all ? '?status=all' : ''}`)).data;
    const pending = rows.filter((r) => r.status === 'pending').length;
    $('tt-req-count').textContent = pending ? `${pending} pending` : '';
    if (!rows.length) { box.innerHTML = `<p class="tt-muted">${all ? 'No requests yet.' : 'No pending requests. When a member asks to change their training time it appears here.'}</p>`; return; }
    box.innerHTML = rows.map((r) => {
      const kind = r.kind === 'personal' ? '<span class="tt-tag pt">Personal</span>' : '<span class="tt-tag gen">General</span>';
      const head = `<div class="tt-req-top"><span><b>${esc(r.member_name)}</b> <span class="tt-muted">${esc(r.member_code || '')}</span> ${kind}
          ${r.trainer_name ? `<span class="tt-muted">· trainer ${esc(r.trainer_name)}</span>` : ''}</span>
        <span><span class="tt-tag ${esc(r.status)}">${esc(r.status)}</span> <span class="tt-muted">${esc(when(r.created_at))}</span></span></div>
        <div class="tt-change"><span class="from">${esc(r.current_label || '—')}</span>→ <span class="to">${esc(range(r.requested_start, r.requested_end))}</span>
          ${r.reason ? `<div class="tt-muted">“${esc(r.reason)}”</div>` : ''}</div>`;
      if (r.status !== 'pending') {
        return `<div class="tt-req">${head}<div class="tt-muted">${r.status === 'approved' ? `Approved for ${esc(range(r.approved_start, r.approved_end))}` : r.status === 'rejected' ? 'Rejected' : 'Cancelled'}${r.decided_by_name ? ` by ${esc(r.decided_by_name)}` : ''}${r.admin_note ? ` — ${esc(r.admin_note)}` : ''}</div></div>`;
      }
      return `<div class="tt-req pending" data-req="${esc(r.id)}">${head}
        <div class="tt-actions">
          <label class="tt-muted">Time <input type="time" data-f="start" value="${esc(r.requested_start)}"> – <input type="time" data-f="end" value="${esc(r.requested_end)}"></label>
          <input type="text" data-f="note" maxlength="300" placeholder="Note to the member (optional)">
          <button type="button" class="btn btn-green btn-sm" data-act="approve">✓ Approve</button>
          <button type="button" class="btn btn-sm btn-danger-soft" data-act="reject">✗ Reject</button>
        </div></div>`;
    }).join('');
  } catch (e) { box.innerHTML = `<p class="tt-err">${esc(e.message)}</p>`; }
}

function renderGeneral() {
  const g = overview.general;
  $('tt-general').innerHTML = g.length
    ? `<table class="tt-table"><thead><tr><th>Time</th><th>Member</th><th>General trainer</th><th>Note</th><th></th></tr></thead><tbody>
        ${g.map((x) => `<tr><td class="tt-time">${esc(range(x.start_time, x.end_time))}</td>
          <td>${esc(x.member_name)} <span class="tt-muted">${esc(x.member_code || '')}</span></td>
          <td>${esc(x.trainer_name || '—')}</td><td class="tt-muted">${esc(x.notes || '')}</td>
          <td style="text-align:right;white-space:nowrap"><button type="button" class="btn btn-outline btn-sm" data-edit="${x.id}">Change</button>
            <button type="button" class="btn btn-sm btn-danger-soft" data-end="${x.id}" data-name="${esc(x.member_name)}">End</button></td></tr>`).join('')}</tbody></table>`
    : '<p class="tt-muted">No general-training times yet. Pick a member, a trainer and a time above.</p>';
}

function renderPersonal() {
  const p = overview.personal;
  $('tt-personal').innerHTML = p.length
    ? `<table class="tt-table"><thead><tr><th>Time</th><th>Member</th><th>Personal trainer</th><th>Sessions</th><th>Status</th></tr></thead><tbody>
        ${p.map((x) => `<tr><td class="tt-time">${x.start_time ? esc(range(x.start_time, x.end_time)) : esc(x.preferred_slot || 'Not set')}</td>
          <td>${esc(x.member_name)} <span class="tt-muted">${esc(x.member_code || '')}</span></td><td>${esc(x.trainer_name || '—')}</td>
          <td>${x.sessions_per_week ? `${esc(x.sessions_per_week)}× / week` : '—'}</td><td>${esc(x.status)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="tt-muted">No personal-training assignments.</p>';
}

function fillSelects(keepMember, keepTrainer) {
  const ms = $('tt-member'); const ts = $('tt-trainer');
  ms.innerHTML = '<option value="">Choose a member…</option>' + overview.members.map((m) => {
    const tag = m.has_general ? ' · has general time' : m.has_pt ? ' · has PT' : '';
    return `<option value="${m.id}">${esc(m.full_name)} (${esc(m.member_code || '')})${tag}</option>`;
  }).join('');
  ts.innerHTML = '<option value="">Choose a trainer…</option>' + overview.trainers.map((t) => `<option value="${t.id}">${esc(t.full_name)}${t.specialty ? ` — ${esc(t.specialty)}` : ''}</option>`).join('');
  if (keepMember) ms.value = keepMember; if (keepTrainer) ts.value = keepTrainer;
}

async function loadOverview() {
  try {
    overview = (await call('/training-times')).data;
    fillSelects($('tt-member').value, $('tt-trainer').value);
    renderGeneral(); renderPersonal();
  } catch (e) {
    const msg = e.status === 503 ? 'Training times need database migration 033.' : e.message;
    ['tt-general', 'tt-personal'].forEach((id) => { $(id).innerHTML = `<p class="tt-err">${esc(msg)}</p>`; });
  }
}

// ---- events
$('tt-req-all').addEventListener('change', loadRequests);
$('tt-requests').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const card = btn.closest('[data-req]'); const id = card.dataset.req;
  const f = (k) => card.querySelector(`[data-f="${k}"]`).value;
  const approve = btn.dataset.act === 'approve';
  if (!approve && !confirm('Reject this time-change request?')) return;
  card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    const r = await post(`/time-shift-requests/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, approve ? { startTime: f('start'), endTime: f('end'), note: f('note') } : { note: f('note') });
    toast(r.message || 'Done.');
    await Promise.all([loadRequests(), loadOverview()]);
  } catch (err) { toast(err.message, true); card.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
});

$('tt-assign').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('tt-assign-err'); err.textContent = '';
  const body = { memberId: Number($('tt-member').value), trainerId: Number($('tt-trainer').value), startTime: $('tt-start').value, endTime: $('tt-end').value, notes: $('tt-notes').value };
  if (!body.memberId) { err.textContent = 'Choose a member.'; return; }
  if (!body.trainerId) { err.textContent = 'Choose a general trainer.'; return; }
  if (!body.startTime || !body.endTime || body.endTime <= body.startTime) { err.textContent = 'Give a start and an end time (end after start).'; return; }
  const btn = $('tt-assign-btn'); btn.disabled = true;
  try {
    const r = await post('/general-training', body);
    toast(`✅ ${r.message}`);
    $('tt-member').value = ''; $('tt-notes').value = '';
    await loadOverview();
  } catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; }
});

$('tt-general').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    const x = overview.general.find((g) => String(g.id) === ed.dataset.edit); if (!x) return;
    $('tt-member').value = x.member_id; $('tt-trainer').value = x.trainer_id || ''; $('tt-start').value = x.start_time; $('tt-end').value = x.end_time; $('tt-notes').value = x.notes || '';
    $('tt-assign').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('tt-trainer').focus();
    return;
  }
  const end = e.target.closest('[data-end]');
  if (end) {
    if (!confirm(`End general training for ${end.dataset.name}? It stays in the history.`)) return;
    end.disabled = true;
    try { const r = await post(`/general-training/${end.dataset.end}/end`); toast(r.message); await loadOverview(); }
    catch (err) { toast(err.message, true); end.disabled = false; }
  }
});

loadOverview();
loadRequests();
if (location.hash === '#requests') setTimeout(() => $('requests').scrollIntoView({ block: 'start' }), 300);
