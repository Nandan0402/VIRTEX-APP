/** Virtex Trainer Hub — trainer-attendance.html page logic.
 *  History: GET /api/v1/trainer/attendance (own records only, from the routine tracker).
 *  Submit to admin:
 *   - ⬇ Download CSV (opens in Excel / Google Sheets) for the chosen dates
 *   - 🖨 Print / Save as PDF (a clean attendance sheet)
 *   - 📤 Send to admin: the summary + day-by-day list is posted in the trainer's existing chat with the
 *     gym team (POST /api/v1/trainer/messages/gym), so the admin sees it in Admin → Messages.
 */
import { api, ApiError } from './trainer-api.js';
import { initShell, esc, dash, fmtDate, fmtDateTime, fmtDuration, badge, emptyState, renderError, renderPager, toast } from './trainer-navigation.js';

const shell = await initShell({ page: 'attendance', title: 'Attendance', subtitle: 'Your punch-in history from the routine tracker — download it or send it to the admin' });

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (sec) => { const s = Math.max(0, Number(sec) || 0); return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`; };
const timeOnly = (v) => (v ? new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—');
const dayOnly = (v) => (v ? new Date(String(v).length === 10 ? `${v}T00:00:00` : v).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—');
/** CSV cell: quoted, and cells starting with = + - @ are prefixed so spreadsheets never run them as formulas. */
const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };

if (shell) {
  const { content, trainer } = shell;
  const me = { name: trainer?.full_name || trainer?.fullName || document.getElementById('tp-foot-name')?.textContent || 'Trainer', code: trainer?.trainer_code || trainer?.trainerCode || '' };
  const now = new Date();
  content.innerHTML = `
    <div class="tp-toolbar ta-toolbar">
      <label class="tp-muted">From <input type="date" class="select-filter" id="from" value="${ymd(new Date(now.getFullYear(), now.getMonth(), 1))}"></label>
      <label class="tp-muted">To <input type="date" class="select-filter" id="to" value="${ymd(now)}"></label>
      <div class="ta-quick" role="group" aria-label="Quick range">
        <button type="button" class="btn btn-outline" data-range="this">This month</button>
        <button type="button" class="btn btn-outline" data-range="last">Last month</button>
      </div>
    </div>
    <section class="card ta-submit" aria-labelledby="ta-submit-h">
      <div><h2 id="ta-submit-h">📤 Submit attendance to the admin</h2>
        <p class="tp-muted">For the dates above. Download a file, print it, or send it straight to the admin's Messages.</p></div>
      <div class="ta-actions">
        <button type="button" class="btn btn-outline" id="ta-csv">⬇ Download (Excel / CSV)</button>
        <button type="button" class="btn btn-outline" id="ta-print">🖨 Print / Save PDF</button>
        <button type="button" class="btn btn-green" id="ta-send">📤 Send to admin</button>
      </div>
    </section>
    <div class="tp-grid" id="totals"></div>
    <div class="card"><div class="table-responsive" id="list"></div><div class="tp-pager" id="pager"></div></div>`;
  const list = content.querySelector('#list');
  const pager = content.querySelector('#pager');
  const totals = content.querySelector('#totals');
  const fromEl = content.querySelector('#from');
  const toEl = content.querySelector('#to');
  let page = 1;
  let busy = false;

  async function load() {
    list.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
    try {
      const res = await api.get('/attendance', { page, limit: 20, from: fromEl.value, to: toEl.value });
      const t = res.totals || {};
      totals.innerHTML = `<div class="tp-stat"><div class="tp-stat-label">Days present</div><div class="tp-stat-value">${t.days_present ?? 0}</div></div>
        <div class="tp-stat"><div class="tp-stat-label">Total work time</div><div class="tp-stat-value">${fmtDuration(t.total_work_seconds)}</div></div>`;
      if (!res.data.length) { list.innerHTML = emptyState('No attendance records', 'Punch in with the In / Break / Out buttons at the top to start tracking.'); pager.innerHTML = ''; return; }
      list.innerHTML = `<table class="admin-table"><thead><tr><th>Date</th><th>Punch in</th><th>Punch out</th><th>Work</th><th>Breaks</th><th>Status</th><th>Notes</th></tr></thead><tbody>
        ${res.data.map((r) => `<tr><td class="tp-strong">${fmtDate(r.punch_date)}</td><td>${fmtDateTime(r.punch_in)}</td><td>${fmtDateTime(r.punch_out)}</td>
          <td>${fmtDuration(r.total_work_seconds)}</td><td>${fmtDuration(r.total_break_seconds)}</td><td>${badge(r.status)}</td><td>${dash(r.routine_notes)}</td></tr>`).join('')}</tbody></table>`;
      renderPager(pager, res.pagination, (p) => { page = p; load(); });
    } catch (err) { renderError(list, err, 'Attendance'); totals.innerHTML = ''; pager.innerHTML = ''; }
  }

  /** Every record in the chosen range (all pages), oldest first. */
  async function fetchAll() {
    if (fromEl.value && toEl.value && fromEl.value > toEl.value) throw new Error('“From” must be on or before “To”.');
    const rows = []; let totalsAll = {};
    for (let p = 1; p <= 50; p++) {
      const res = await api.get('/attendance', { page: p, limit: 100, from: fromEl.value, to: toEl.value });
      rows.push(...(res.data || [])); totalsAll = res.totals || totalsAll;
      if (p >= (res.pagination?.totalPages || 1)) break;
    }
    rows.sort((a, b) => String(a.punch_date).localeCompare(String(b.punch_date)));
    return { rows, totals: totalsAll };
  }
  const rangeLabel = () => `${fromEl.value ? dayOnly(fromEl.value) : 'start'} – ${toEl.value ? dayOnly(toEl.value) : 'today'}`;
  const fileStem = () => `attendance_${(me.code || me.name).replace(/[^A-Za-z0-9]+/g, '-')}_${fromEl.value || 'all'}_to_${toEl.value || ymd(new Date())}`;

  async function withBusy(btn, fn) {
    if (busy) return; busy = true; const label = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
    try { await fn(); } catch (err) { toast(err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong.', { error: true }); }
    finally { busy = false; btn.disabled = false; btn.textContent = label; }
  }

  // ⬇ CSV (Excel opens it; the BOM keeps ₹ and names readable)
  content.querySelector('#ta-csv').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const { rows, totals: t } = await fetchAll();
    if (!rows.length) { toast('No attendance in these dates to download.', { error: true }); return; }
    const lines = [
      ['Trainer', me.name], ['Trainer code', me.code], ['Period', rangeLabel()], ['Days present', t.days_present ?? rows.length], ['Total work time', hm(t.total_work_seconds)], [],
      ['Date', 'Punch in', 'Punch out', 'Work (h:mm)', 'Breaks (h:mm)', 'Status', 'Notes'],
      ...rows.map((r) => [String(r.punch_date).slice(0, 10), timeOnly(r.punch_in), timeOnly(r.punch_out), hm(r.total_work_seconds), hm(r.total_break_seconds), r.status || '', r.routine_notes || '']),
    ].map((l) => l.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + lines], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${fileStem()}.csv` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Downloaded ${rows.length} day${rows.length === 1 ? '' : 's'} of attendance.`);
  }));

  // 🖨 Print / Save as PDF: a clean sheet in a new window
  content.querySelector('#ta-print').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const { rows, totals: t } = await fetchAll();
    if (!rows.length) { toast('No attendance in these dates to print.', { error: true }); return; }
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups for this site to print the sheet.', { error: true }); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(fileStem())}</title>
      <style>body{font-family:Arial,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0 0 4px}p{margin:2px 0;font-size:13px}
      table{border-collapse:collapse;width:100%;margin-top:14px;font-size:12px}th,td{border:1px solid #999;padding:6px 8px;text-align:left}th{background:#eee}
      .sum{margin-top:10px;font-weight:bold}.sign{margin-top:40px;display:flex;justify-content:space-between;font-size:12px}</style></head><body>
      <h1>Virtex — Trainer attendance</h1><p><b>Trainer:</b> ${esc(me.name)}${me.code ? ` (${esc(me.code)})` : ''}</p><p><b>Period:</b> ${esc(rangeLabel())}</p>
      <p class="sum">Days present: ${esc(String(t.days_present ?? rows.length))} · Total work time: ${esc(hm(t.total_work_seconds))}</p>
      <table><thead><tr><th>Date</th><th>Punch in</th><th>Punch out</th><th>Work</th><th>Breaks</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(dayOnly(String(r.punch_date).slice(0, 10)))}</td><td>${esc(timeOnly(r.punch_in))}</td><td>${esc(timeOnly(r.punch_out))}</td><td>${esc(hm(r.total_work_seconds))}</td><td>${esc(hm(r.total_break_seconds))}</td><td>${esc(r.status || '')}</td><td>${esc(r.routine_notes || '')}</td></tr>`).join('')}
      </tbody></table><div class="sign"><span>Trainer signature: ____________________</span><span>Admin signature: ____________________</span></div>
      <p style="margin-top:16px;color:#666;font-size:11px">Printed ${esc(new Date().toLocaleString())}</p>
      <script>window.onload=()=>{window.print();}<\/script></body></html>`);
    w.document.close();
  }));

  // 📤 Send to admin (into the trainer's chat with the gym team)
  content.querySelector('#ta-send').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const { rows, totals: t } = await fetchAll();
    if (!rows.length) { toast('No attendance in these dates to send.', { error: true }); return; }
    if (!confirm(`Send your attendance for ${rangeLabel()} (${rows.length} day${rows.length === 1 ? '' : 's'}) to the admin?`)) return;
    const head = `📋 Attendance — ${me.name}${me.code ? ` (${me.code})` : ''}\nPeriod: ${rangeLabel()}\nDays present: ${t.days_present ?? rows.length} · Total work: ${hm(t.total_work_seconds)}\n`;
    const dayLines = rows.map((r) => `• ${dayOnly(String(r.punch_date).slice(0, 10))}: ${timeOnly(r.punch_in)}–${timeOnly(r.punch_out)} · ${hm(r.total_work_seconds)}${r.status ? ` · ${r.status}` : ''}`);
    let body = `${head}\n${dayLines.join('\n')}`;
    if (body.length > 3900) {               // messages are limited to 4,000 characters
      let kept = dayLines.length;
      while (kept > 0 && `${head}\n${dayLines.slice(0, kept).join('\n')}\n…and ${dayLines.length - kept} more days (download the file for all).`.length > 3900) kept--;
      body = `${head}\n${dayLines.slice(0, kept).join('\n')}\n…and ${dayLines.length - kept} more days (download the file for all).`;
    }
    const r = await api.post('/messages/gym', { body });
    toast('✅ Attendance sent to the admin.');
    const go = document.createElement('a'); go.href = `trainer-messages.html?thread=${encodeURIComponent(r.data?.id || '')}`;
    if (confirm('Sent! Open the conversation with the admin?')) location.href = go.href;
  }));

  content.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    const d = new Date();
    if (b.dataset.range === 'last') { fromEl.value = ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)); toEl.value = ymd(new Date(d.getFullYear(), d.getMonth(), 0)); }
    else { fromEl.value = ymd(new Date(d.getFullYear(), d.getMonth(), 1)); toEl.value = ymd(d); }
    page = 1; load();
  }));
  fromEl.addEventListener('change', () => { page = 1; load(); });
  toEl.addEventListener('change', () => { page = 1; load(); });
  window.addEventListener('routine:status-changed', () => load());   // topbar punch controls
  load();
}
