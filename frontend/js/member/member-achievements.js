/** Virtex Member Portal — member-achievements.html: Achievements & certificates.
 *  Uses: GET /api/v1/member/achievements — every item is derived on the server from the member's own
 *  records (workout logs, check-ins, strength records, competitions, courses, transformation records).
 *  This page awards nothing: it only shows what the server returns, with its source and verification.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'achievements', title: 'Achievements', subtitle: 'Milestones, personal bests, results and certificates you have earned' });

const CATS = {
  workout: ['🏋️', 'Workout milestones'],
  attendance: ['📅', 'Attendance'],
  personal_best: ['🏅', 'Personal bests'],
  challenge: ['🔥', 'Challenges'],
  competition: ['🏆', 'Competitions'],
  course: ['🎓', 'Courses'],
  transformation: ['📈', 'Transformation'],
};
const dLong = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const dShort = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const monthKey = (d) => new Date(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const vBadge = (v) => `<span class="ac-v ac-v-${esc(v.level)}" title="How this was verified">${v.level === 'self_logged' ? '✎' : '✓'} ${esc(v.label)}</span>`;

if (shell) {
  const { content } = shell;
  let data = null; let filter = 'all';

  function summary() {
    const s = data.summary;
    const tile = (label, v, sub) => `<div class="mm-tile"><span>${esc(label)}</span><b>${v}</b><small>${esc(sub)}</small></div>`;
    return `<section class="pg-card"><div class="ac-tiles">
      ${tile('Achievements earned', s.earned, 'From your records')}
      ${tile('Certificates', s.certificates, 'Issued by staff')}
      ${tile('Not yet awarded', s.pending, 'Awaiting a result, verification or certificate')}
    </div>
    <div class="ac-next">${data.progress.map((p) => {
      const pct = p.next ? Math.min(100, Math.round((p.current / p.next) * 100)) : 100;
      return `<div class="ac-next-item"><div class="ac-next-top"><b>${esc(p.label)}</b><span>${p.current.toLocaleString()} recorded${p.next ? ` · next milestone at ${p.next.toLocaleString()}` : ' · all milestones reached'}</span></div>
        <div class="ac-bar" role="img" aria-label="${p.current} of ${p.next || p.current}"><span style="width:${pct}%"></span></div>${p.note ? `<small>${esc(p.note)}</small>` : ''}</div>`;
    }).join('')}</div></section>`;
  }

  function timeline() {
    const list = data.achievements.filter((a) => filter === 'all' || a.category === filter);
    const present = [...new Set(data.achievements.map((a) => a.category))];
    const chips = `<div class="ac-chips" role="group" aria-label="Filter achievements">
      <button type="button" class="ac-chip${filter === 'all' ? ' on' : ''}" data-f="all" aria-pressed="${filter === 'all'}">All (${data.achievements.length})</button>
      ${Object.entries(CATS).filter(([k]) => present.includes(k)).map(([k, [i, l]]) => `<button type="button" class="ac-chip${filter === k ? ' on' : ''}" data-f="${k}" aria-pressed="${filter === k}">${i} ${esc(l)} (${data.achievements.filter((a) => a.category === k).length})</button>`).join('')}
    </div>`;
    if (!data.achievements.length) {
      return `<section class="pg-card"><h2 class="pg-h">Achievement history</h2>
        <div class="pg-ned"><span class="pg-ned-badge">None yet</span><span>Nothing has been earned yet. Achievements appear here automatically when your records show them — log a workout, check in at the gym, or complete a course or challenge.</span></div></section>`;
    }
    const groups = new Map();
    list.forEach((a) => { const k = monthKey(a.earnedAt); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); });
    return `<section class="pg-card"><h2 class="pg-h">Achievement history</h2>${chips}
      ${[...groups.entries()].map(([m, items]) => `<h3 class="ac-month">${esc(m)}</h3><ol class="ac-list">
        ${items.map((a) => `<li class="ac-item"><span class="ac-icon" aria-hidden="true">${CATS[a.category]?.[0] || '⭐'}</span>
          <div class="ac-body"><b>${esc(a.title)}</b><p>${esc(a.detail)}</p>
            <div class="ac-meta"><time datetime="${esc(new Date(a.earnedAt).toISOString())}">${esc(dLong(a.earnedAt))}</time>${vBadge(a.verification)}
            ${a.verifiedBy ? `<span>by ${esc(a.verifiedBy)}</span>` : ''}
            ${a.certificateCode ? `<button type="button" class="ac-link" data-cert="${esc(a.certificateCode)}">View certificate</button>` : ''}</div></div></li>`).join('')}
      </ol>`).join('')}</section>`;
  }

  function certificates() {
    if (!data.certificates.length) {
      return `<section class="pg-card"><h2 class="pg-h">Certificates</h2><p class="pg-muted">No certificates have been issued to you yet. Certificates are issued by gym staff for completed courses and competition results.</p></section>`;
    }
    return `<section class="pg-card"><h2 class="pg-h">Certificates</h2><div class="ac-certs">
      ${data.certificates.map((c) => `<article class="ac-cert"><span class="ac-cert-kind">${c.kind === 'course' ? '🎓 Course' : '🏆 Competition'}</span>
        <b>${esc(c.title)}</b><span>${esc(c.award || '')}${c.grade ? ` · Grade ${esc(c.grade)}` : ''}${c.rank ? ` · Rank #${esc(c.rank)}` : ''}</span>
        <small>Issued ${esc(dShort(c.issuedAt))}${c.issuedBy ? ` by ${esc(c.issuedBy)}` : ''}</small><code>${esc(c.code)}</code>
        <div class="ac-cert-actions"><button type="button" class="btn btn-outline" data-cert="${esc(c.code)}">View</button>
          ${c.url ? `<a class="btn btn-outline" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Download</a>` : ''}</div></article>`).join('')}
    </div></section>`;
  }

  function pending() {
    if (!data.pending.length) return '';
    return `<section class="pg-card"><h2 class="pg-h">Not yet awarded</h2>
      <p class="pg-muted">These are on record but have not been earned yet. Nothing is awarded until the result is verified or a certificate is issued.</p>
      <ul class="ac-pending">${data.pending.map((p) => `<li><span aria-hidden="true">${CATS[p.category]?.[0] || '⏳'}</span><div><b>${esc(p.title)}</b><small>${esc(p.reason)}</small></div></li>`).join('')}</ul></section>`;
  }

  function rules() {
    const r = data.rules;
    return `<details class="pg-card ac-rules"><summary>How achievements are awarded</summary><ul>
      <li><b>Workout milestones</b> at ${r.workoutMilestones.join(', ')} recorded workouts — dated on the workout that reached it.</li>
      <li><b>Attendance milestones</b> at ${r.attendanceMilestones.join(', ')} gym check-ins recorded by the check-in system.</li>
      <li><b>Personal bests:</b> ${esc(r.personalBest)}</li>
      <li><b>Challenges, competitions and transformation contests:</b> ${esc(r.competitions)}</li>
      <li><b>Courses:</b> ${esc(r.courses)}</li>
      <li><b>Transformation:</b> progress photos you consented to, and keeping body measurements for 1, 3, 6 or 12 months.</li>
      <li>Each achievement shows where it came from. “Recorded by you” means you logged it yourself; staff-verified items say so.</li></ul></details>`;
  }

  function certDialog(code) {
    const c = data.certificates.find((x) => x.code === code);
    if (!c) return;
    let dlg = document.getElementById('ac-dialog');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'ac-dialog'; dlg.className = 'ac-dialog'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<div class="ac-printable" id="ac-printable">
        <div class="ac-paper"><span class="ac-paper-org">Virtex</span>
          <h2>${c.kind === 'course' ? 'Certificate of Completion' : esc(c.award || 'Certificate of Achievement')}</h2>
          <p>This certifies that</p><p class="ac-paper-name">${esc(data.member?.name || '')}</p>
          <p>${c.kind === 'course' ? 'has completed the course' : 'took part in'}</p><p class="ac-paper-title">${esc(c.title)}</p>
          ${c.grade ? `<p>Grade: <b>${esc(c.grade)}</b></p>` : ''}${c.rank ? `<p>Rank: <b>#${esc(c.rank)}</b></p>` : ''}
          <div class="ac-paper-foot"><span>Issued ${esc(dLong(c.issuedAt))}${c.issuedBy ? ` by ${esc(c.issuedBy)}` : ''}</span><span>Certificate no. ${esc(c.code)}</span></div></div></div>
      <p class="ac-dialog-note">Shown from the certificate record issued by gym staff.</p>
      <div class="ac-dialog-actions"><button type="button" class="btn btn-outline" id="ac-print">Print / save as PDF</button>
        ${c.url ? `<a class="btn btn-outline" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Download original</a>` : ''}
        <button type="button" class="btn btn-green" id="ac-close">Close</button></div>`;
    dlg.querySelector('#ac-close').onclick = () => dlg.close();
    dlg.querySelector('#ac-print').onclick = () => { document.body.classList.add('ac-printing'); window.print(); document.body.classList.remove('ac-printing'); };
    dlg.showModal();
  }

  function render() {
    content.innerHTML = `<div class="pg-wrap">${summary()}${certificates()}${timeline()}${pending()}${rules()}</div>`;
    content.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); content.querySelector(`[data-f="${filter}"]`)?.focus(); }));
    content.querySelectorAll('[data-cert]').forEach((b) => b.addEventListener('click', () => certDialog(b.dataset.cert)));
  }

  content.innerHTML = '<div class="mp-loading">Loading your achievements…</div>';
  try {
    data = (await api.get('/achievements')).data;
    render();
  } catch (e) {
    content.innerHTML = notice('Could not load your achievements', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true });
  }
}
