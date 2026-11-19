/** Virtex Member Portal — member-trainer.html: the trainer assigned by Admin (PT Client Allocation).
 *  Data: GET /api/v1/member/trainer — personal_trainer_assignments (active/paused) + trainers, the trainer's
 *  photo from their login, PT packages/sessions (after the PT migration) and recent coaching feedback.
 *  Read-only: assignments are made by the gym team; members cannot assign themselves.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';
import { money, fmtDate, statusPill, label, NONE } from './member-billing-utils.js';
import { mountTrainingTimes } from './member-training-times.js';

const shell = await initShell({ page: 'trainer', title: 'My Trainer', subtitle: 'Your personal trainer, PT plan and sessions' });

const safePhoto = (u) => (typeof u === 'string' && (/^\/uploads\/avatars\/[\w.-]+$/.test(u) || /^data:image\/(png|jpeg|webp);base64,/.test(u)) ? u : null);
const initials = (n) => String(n || 'T').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const AFTER_DB = 'Available after the gym completes its PT system update.';

function noTrainer() {
  return `<section class="card tr-empty">
    <div class="tr-empty-ico" aria-hidden="true">🎓</div>
    <h2>No personal trainer assigned yet</h2>
    <p>Your personal trainer will be assigned by the admin. Once the admin assigns a trainer, their profile, your PT plan and upcoming sessions will appear here.</p>
    <p class="tr-muted">Interested in personal training? Ask the admin to assign you a trainer.</p>
    <div class="tr-actions"><a class="btn btn-outline" href="member-membership.html">View my membership</a><a class="btn btn-outline" href="member-messages.html">💬 Message the admin</a></div>
  </section>`;
}

function profileCard(t) {
  const photo = safePhoto(t.trainer_avatar_url);
  const specs = String(t.specialty || '').split(/\s*[,/|]\s*/).filter(Boolean);
  const certs = Array.isArray(t.certifications) ? t.certifications.filter(Boolean) : [];
  return `<section class="card tr-profile">
    <div class="tr-photo-wrap">${photo ? `<img class="tr-photo" src="${esc(photo)}" alt="Photo of ${esc(t.trainer_name)}">` : `<div class="tr-photo tr-photo-initials" aria-label="No photo">${esc(initials(t.trainer_name))}</div>`}</div>
    <div class="tr-main">
      <div class="tr-name-row"><h2>${esc(t.trainer_name)}</h2>${t.assignment_status === 'paused' ? '<span class="tr-tag tr-tag-warn">Training paused</span>' : ''}</div>
      <div class="tr-id">Trainer ID <span class="tr-mono">${t.trainer_code ? esc(t.trainer_code) : `#${esc(t.trainer_id)}`}</span></div>
      <dl class="tr-kv">
        <dt>Specialisations</dt><dd>${specs.length ? specs.map((s) => `<span class="tr-chip">${esc(s)}</span>`).join(' ') : NONE}</dd>
        <dt>Qualifications</dt><dd>${certs.length ? `<ul class="tr-certs">${certs.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '<span class="bl-none">Not listed</span>'}</dd>
        <dt>Experience</dt><dd>${t.trainer_since ? `Coaching at Virtex since ${fmtDate(t.trainer_since, { month: 'long', year: 'numeric' })}` : '<span class="bl-none">Not listed</span>'}</dd>
      </dl>
      ${t.bio ? `<p class="tr-bio">${esc(t.bio)}</p>` : ''}
    </div>
  </section>`;
}

function contactCard(t) {
  return `<section class="card tr-section"><h2>Contact your trainer</h2>
    <ul class="tr-contact">
      ${t.trainer_email ? `<li><span aria-hidden="true">✉️</span><div><b>Email</b><a href="mailto:${esc(t.trainer_email)}">${esc(t.trainer_email)}</a></div></li>` : ''}
      <li><span aria-hidden="true">💬</span><div><b>Message in the portal</b><a href="member-messages.html">Open messages</a><small>${esc(AFTER_DB)}</small></div></li>
      <li><span aria-hidden="true">🏢</span><div><b>Front desk</b><span>Ask the team to reach your trainer or change your session time.</span></div></li>
    </ul></section>`;
}

function allocationCard(t) {
  return `<section class="card tr-section"><h2>Your PT plan</h2>
    <dl class="tr-kv">
      <dt>Assigned on</dt><dd>${fmtDate(t.start_date || t.assigned_at)}</dd>
      <dt>Status</dt><dd>${statusPill(t.assignment_status)}</dd>
      ${t.end_date ? `<dt>Ends on</dt><dd>${fmtDate(t.end_date)}</dd>` : ''}
      <dt>Sessions per week</dt><dd>${t.sessions_per_week ? esc(t.sessions_per_week) : NONE}</dd>
      <dt>Preferred slot</dt><dd>${t.preferred_slot ? label(t.preferred_slot) : NONE}</dd>
      <dt>Training goal</dt><dd>${t.training_goal ? esc(t.training_goal) : NONE}</dd>
      <dt>Monthly PT fee</dt><dd>${money(t.monthly_fee)}</dd>
      <dt>Paid / due</dt><dd>${money(t.fee_paid)} / ${money(t.fee_due)} ${t.payment_status ? statusPill(t.payment_status) : ''}</dd>
    </dl></section>`;
}

function packagesCard(packages) {
  let body;
  if (packages === null) body = `<p class="tr-muted">${esc(AFTER_DB)} Until then, your PT plan above shows your sessions per week and fees.</p>`;
  else if (!packages.length) body = emptyState('No PT package on record', 'Session packages bought at the front desk appear here.');
  else {
    body = `<ul class="tr-list">${packages.map((p) => {
      const used = Number(p.sessions_used) || 0; const total = Number(p.sessions_total) || 0;
      const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
      return `<li><div class="tr-list-main"><b>${p.package_name ? esc(p.package_name) : 'PT package'}</b> ${statusPill(p.status)}
          <div class="tr-muted">${esc(p.sessions_remaining ?? '—')} of ${esc(total || '—')} sessions left · valid ${fmtDate(p.valid_from)} – ${fmtDate(p.valid_until)}</div>
          ${total ? `<div class="tr-meter" role="meter" aria-label="Sessions used" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${used}"><span style="width:${pct}%"></span></div>` : ''}</div></li>`;
    }).join('')}</ul>`;
  }
  return `<section class="card tr-section"><h2>PT package</h2>${body}</section>`;
}

function sessionsCard(sessions) {
  let body;
  if (sessions === null) body = `<p class="tr-muted">${esc(AFTER_DB)} Session times are arranged with your trainer or at the front desk.</p>`;
  else if (!sessions.length) body = emptyState('No upcoming sessions', 'Booked personal training sessions appear here.');
  else body = `<ul class="tr-list">${sessions.map((s) => `<li><div class="tr-when">${fmtDate(s.scheduled_start, { weekday: 'short', day: 'numeric', month: 'short' })}
      <span>${esc(new Date(s.scheduled_start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}</span></div>
      <div class="tr-list-main"><b>${s.location ? esc(s.location) : 'PT session'}</b><div class="tr-muted">${s.trainer_name ? esc(s.trainer_name) : ''}</div></div>${statusPill(s.status)}</li>`).join('')}</ul>`;
  return `<section class="card tr-section"><h2>Upcoming sessions</h2>${body}</section>`;
}

function feedbackCard(rows) {
  const body = rows.length
    ? `<ul class="tr-list">${rows.map((f) => `<li><div class="tr-list-main"><div class="tr-muted">${fmtDate(f.created_at)} · <span class="tr-chip">${esc(f.comment_type)}</span></div>
        <p class="tr-feedback">${esc(f.comment_text)}</p></div></li>`).join('')}</ul>`
    : emptyState('No feedback yet', 'Coaching notes from your trainer will appear here.');
  return `<section class="card tr-section"><h2>Recent coaching feedback</h2>${body}</section>`;
}

if (shell) {
  const { content } = shell;
  // ⏰ My training times (personal + general, set by the admin) + time-change requests — shown above the trainer card.
  const times = document.createElement('div'); times.className = 'tt-mount';
  content.before(times);
  mountTrainingTimes(times);
  content.innerHTML = '<div class="mp-muted mp-loading">Loading your trainer…</div>';
  try {
    const d = (await api.get('/trainer')).data;
    const t = d.current;
    if (!t) {
      content.innerHTML = noTrainer();
    } else {
      content.innerHTML = `${profileCard(t)}
        <div class="tr-cols">${allocationCard(t)}${contactCard(t)}</div>
        <div class="tr-cols">${packagesCard(d.packages)}${sessionsCard(d.upcomingSessions)}</div>
        ${feedbackCard(d.feedback || [])}
        ${d.all.length > 1 ? `<p class="tr-muted">You have ${d.all.length} current trainer allocations; the active one is shown. Ask the admin if this looks wrong.</p>` : ''}`;
    }
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) content.innerHTML = notice('Could not load your trainer', err.message || 'Unexpected error.', { error: true });
  }
}
