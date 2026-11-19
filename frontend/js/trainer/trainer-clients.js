/** Virtex Trainer Hub — trainer-clients.html page logic. */
import { api } from './trainer-api.js';
import { initShell, esc, dash, fmtDate, badge, emptyState, renderError, renderPager, pageHref } from './trainer-navigation.js';

/** Training time from the PT assignment: "Morning (07:00 AM - 08:00 AM)" → ⏰ 07:00 AM – 08:00 AM · Morning · 3× / week */
function slotCell(c) {
  const raw = String(c.preferred_slot || '').trim();
  const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const when = m ? m[2].replace(/\s*-\s*/, ' – ') : raw;
  const part = m ? m[1] : '';
  const per = Number(c.sessions_per_week) > 0 ? `${Number(c.sessions_per_week)}× / week` : '';
  if (!when && !per) return '<span class="tp-muted">Not set</span>';
  return `<div class="tp-strong">${when ? `⏰ ${esc(when)}` : ''}</div><div class="tp-muted">${[part, per].filter(Boolean).map(esc).join(' · ')}</div>`;
}

const shell = await initShell({ page: 'clients', title: 'My Clients', subtitle: 'Members assigned to you for personal training' });

if (shell) {
  const { content } = shell;
  content.innerHTML = `
    <div class="tp-toolbar">
      <input class="input-search" id="q" placeholder="Search name, code, phone…" maxlength="80">
      <select class="select-filter" id="status">
        <option value="">All statuses</option><option value="active">Active</option><option value="paused">Paused</option>
        <option value="completed">Completed</option><option value="cancelled">Cancelled</option>
      </select>
      <span class="spacer"></span><span class="tp-muted">Completed and cancelled assignments are listed for history; their records close when the assignment ends.</span>
    </div>
    <div class="card"><div class="table-responsive" id="list"></div><div class="tp-pager" id="pager"></div></div>`;

  const list = content.querySelector('#list');
  const pager = content.querySelector('#pager');
  let page = 1;

  async function load() {
    list.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
    try {
      const res = await api.get('/clients', {
        page, limit: 20, search: content.querySelector('#q').value.trim(), status: content.querySelector('#status').value,
      });
      if (!res.data.length) { list.innerHTML = emptyState('No clients found', 'Clients appear here once an administrator assigns them to you.'); pager.innerHTML = ''; return; }
      list.innerHTML = `<table class="admin-table"><thead><tr><th>Member</th><th>Contact</th><th>Plan</th><th>Assignment</th><th>Time</th><th>Period</th><th></th></tr></thead><tbody>
        ${res.data.map((c) => `<tr>
          <td><div class="tp-strong">${esc(c.full_name)}</div><div class="tp-muted">${dash(c.member_code)}</div></td>
          <td>${dash(c.phone)}<div class="tp-muted">${dash(c.email)}</div></td>
          <td>${dash(c.plan_name)}<div>${badge(c.member_status)}</div></td>
          <td>${badge(c.assignment_status)}</td>
          <td>${slotCell(c)}</td>
          <td>${fmtDate(c.start_date)} → ${c.end_date ? fmtDate(c.end_date) : 'ongoing'}</td>
          <td>${['active', 'paused'].includes(c.assignment_status)
            ? `<a class="btn btn-outline" href="${pageHref('trainer-client-profile.html', { memberId: c.member_id })}">Open</a>`
            : '<span class="tp-muted" title="Access to the records of this member ended with the assignment">Access ended</span>'}</td></tr>`).join('')}
        </tbody></table>`;
      renderPager(pager, res.pagination, (p) => { page = p; load(); });
    } catch (err) { renderError(list, err, 'Clients'); pager.innerHTML = ''; }
  }

  let t;
  content.querySelector('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 300); });
  content.querySelector('#status').addEventListener('change', () => { page = 1; load(); });
  load();
}
