/** Virtex Member Portal — member-facilities.html: Gym facilities.
 *  Uses: GET /api/v1/member/facilities — opening hours (Admin Working Hours / gym settings), facility zones and
 *  maintenance (Staff Operations), equipment condition (Inventory) and maintenance notices (Announcements).
 *  Read-only. A facility is shown as available only when Admin marked it open and no maintenance is in progress.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'facilities', title: 'Gym Facilities', subtitle: 'Opening hours, facilities, equipment and notices' });

const dDate = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const t12 = (hm) => { if (!hm) return '—'; const [h, m] = hm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const MSTATUS = { in_progress: ['In progress', 'warn'], scheduled: ['Scheduled', 'na'], completed: ['Completed', 'ok'] };

if (shell) {
  const { content } = shell;
  let data = null;

  const facCard = (f) => `<article class="fc-zone${f.available ? '' : ' off'}">
      <div class="fc-zone-top"><span class="cl-group">${esc(f.type || 'Facility')}</span><span class="oc-out oc-out-${f.available ? 'ok' : 'no'}">${esc(f.label)}</span></div>
      <h3>${esc(f.name)}</h3>
      <p class="cl-meta">${[f.floor, f.capacity ? `up to ${f.capacity} people` : null, data.branches.length > 1 ? f.branch : null].filter(Boolean).map(esc).join(' · ')}</p>
      ${f.notes ? `<p class="cl-desc">${esc(f.notes)}</p>` : ''}${f.note ? `<p class="fc-warn">⚠️ ${esc(f.note)}</p>` : ''}</article>`;

  function hoursSection() {
    const h = data.hours;
    if (!h.configured) return '<section class="pg-card"><h2 class="pg-h">🕒 Opening hours</h2><p class="pg-muted">Opening hours have not been published yet. Please ask at reception.</p></section>';
    return `<section class="pg-card"><div class="cl-head"><h2 class="pg-h">🕒 Opening hours</h2>
        ${h.openNow === null ? '' : `<span class="oc-out oc-out-${h.openNow ? 'ok' : 'no'}">${h.openNow ? `Open now · closes ${esc(t12(h.closesAt))}` : 'Closed now'}</span>`}</div>
      <table class="admin-table fc-hours"><tbody>${h.days.map((d) => `<tr class="${d.day === h.today ? 'is-today' : ''}"><th>${esc(d.day)}${d.day === h.today ? ' <small>(today)</small>' : ''}</th>
        <td>${!d.configured ? '<span class="pg-missing">Not set</span>' : d.closed ? '<span class="fc-closed">Closed</span>' : `${esc(t12(d.open))} – ${esc(t12(d.close))}`}</td></tr>`).join('')}</tbody></table>
      <p class="pg-muted">Working days: <b>${h.workingDays.length === 7 ? 'every day' : h.workingDays.map(esc).join(', ') || 'none published'}</b>.</p>
      ${data.branches.length > 1 ? `<details class="co-notes"><summary>Other branches</summary><ul class="fc-branches">${data.branches.map((b) => `<li><b>${esc(b.name)}</b>${b.address ? ` — ${esc(b.address)}` : ''}${b.hours ? ` · ${esc(b.hours)}` : ''}</li>`).join('')}</ul></details>` : ''}
    </section>`;
  }

  function classSection() {
    const days = data.hours.days.filter((d) => d.configured && !d.closed && d.classes.length);
    if (!data.classSpaces.length && !days.length) return '';
    return `<section class="pg-card"><h2 class="pg-h">💃 Class facilities</h2>
      ${data.classSpaces.length ? `<div class="fc-grid">${data.classSpaces.map(facCard).join('')}</div>` : ''}
      ${days.length ? `<h3 class="cl-day">Regular class sessions</h3><div class="pg-scroll"><table class="admin-table pg-tbl fc-sessions"><tbody>${days.map((d) => `<tr><th>${esc(d.day)}</th><td>${d.classes.map((c) => `<span class="fc-sess"><b>${esc(t12(c.start))}–${esc(t12(c.end))}</b> ${esc(c.title)}</span>`).join('')}</td></tr>`).join('')}</tbody></table></div>
        <p class="pg-foot">Book specific classes on the <a href="member-classes.html">Classes</a> page.</p>` : ''}</section>`;
  }

  function equipmentSection() {
    if (!data.equipment.length) return '<section class="pg-card"><h2 class="pg-h">🏋️ Equipment</h2><p class="pg-muted">The equipment list has not been published yet.</p></section>';
    return `<section class="pg-card"><h2 class="pg-h">🏋️ Equipment</h2><div class="pg-scroll"><table class="admin-table pg-tbl"><thead><tr><th>Equipment</th><th>Area</th><th>Available</th><th>Out of use</th></tr></thead><tbody>
      ${data.equipment.map((e) => `<tr><td><b>${esc(e.category)}</b>${e.availableNames.length ? `<small class="pg-sub">${e.availableNames.slice(0, 6).map(esc).join(', ')}${e.availableNames.length > 6 ? '…' : ''}</small>` : ''}</td><td>${esc(e.zone)}</td>
        <td>${e.available}</td><td>${e.unavailable ? `<span class="fc-closed" title="${esc(e.unavailableNames.join(', '))}">${e.unavailable}</span>` : '0'}</td></tr>`).join('')}
      </tbody></table></div><p class="pg-foot">Items marked for maintenance or out of service are counted as out of use.</p></section>`;
  }

  function maintenanceSection() {
    if (!data.maintenance.length) return '';
    return `<section class="pg-card"><h2 class="pg-h">🛠️ Maintenance notices</h2><ul class="nt-list">${data.maintenance.map((m) => {
      const [label, cls] = MSTATUS[m.status] || [m.status, 'na'];
      return `<li class="nt-item"><span class="nt-ic" aria-hidden="true">🛠️</span><div class="nt-main"><b>${esc(m.title)}</b>
        <p>${esc(m.facility)}${m.floor ? ` · ${esc(m.floor)}` : ''}${m.notes ? ` — ${esc(m.notes)}` : ''}</p>
        <small>${m.status === 'completed' && m.completedDate ? `Completed ${esc(dDate(m.completedDate))}` : `Scheduled ${esc(dDate(m.scheduledDate))}`}</small></div>
        <span class="oc-out oc-out-${cls}">${esc(label)}</span></li>`;
    }).join('')}</ul></section>`;
  }

  function render() {
    const g = data.gym;
    const avail = data.facilities.filter((f) => f.available).length;
    content.innerHTML = `<div class="pg-wrap">
      ${data.notices.length ? `<section class="pg-card fc-notices"><h2 class="pg-h">📌 Facility notices</h2><ul class="an-list">${data.notices.map((n) => `<li class="an-item an-${n.kind === 'announcement' ? 'schedule' : 'important'}"><b>${esc(n.title)}</b>${n.message ? `<p>${esc(n.message)}</p>` : ''}${n.until ? `<small>Until ${esc(dDate(n.until))}</small>` : ''}</li>`).join('')}</ul></section>` : ''}
      ${g ? `<section class="pg-card fc-gym"><h2 class="pg-h">${esc(g.name)}</h2>${g.tagline ? `<p class="pg-muted">${esc(g.tagline)}</p>` : ''}
        <p class="cl-meta">${[g.address, g.phone, g.email].filter(Boolean).map(esc).join(' · ')}</p></section>` : ''}
      ${hoursSection()}
      <section class="pg-card"><h2 class="pg-h">🏢 Facilities <small class="mm-count">${avail} of ${data.facilities.length} available</small></h2>
        ${data.facilities.length ? `<div class="fc-grid">${data.facilities.map(facCard).join('')}</div>` : '<p class="pg-muted">No facilities have been published yet.</p>'}</section>
      ${data.recoveryZones.length ? `<section class="pg-card"><h2 class="pg-h">🧖 Sauna &amp; recovery zones</h2><div class="fc-grid">${data.recoveryZones.map(facCard).join('')}</div></section>` : ''}
      ${classSection()}${equipmentSection()}${maintenanceSection()}
      <p class="pg-foot">Information is managed by the gym and updated by staff. If something is marked unavailable, please don't use it until it reopens.</p></div>`;
  }

  content.innerHTML = '<div class="mp-loading">Loading facilities…</div>';
  try { data = (await api.get('/facilities')).data; render(); }
  catch (e) { content.innerHTML = notice('Could not load facility information', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true }); }
}
