/** Virtex Member Portal — member-dashboard.html: the member's main dashboard.
 *  Data: GET /api/v1/member/dashboard (caller's own records only) + GET /api/v1/announcements.
 *  Nothing is estimated or invented: when a value does not exist in PostgreSQL the card says so.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';
import { applyGenderTheme, feeBanner, weekCard, tipsCard } from './member-dashboard-extras.js';
import { menuKeyForHref, isHidden } from './member-sidebar.js';

/** Remove dashboard parts that lead to features the admin switched off for this member. */
function applyMenuChoices(root) {
  const visible = window.__memberMenu?.visible;
  if (!visible) return;
  root.querySelectorAll('a[href]').forEach((a) => {
    if (!isHidden(visible, menuKeyForHref(a.getAttribute('href')))) return;
    const sec = a.closest('.md-section-head') ? a.closest('.md-section') : null;
    // The progress chart is "graphic progress" (its own switch): keep the chart, drop only its link to the hidden page.
    const isChart = sec && /Progress chart/i.test(sec.querySelector('h2')?.textContent || '');
    const holder = a.closest('.md-card, .md-quick-btn') || (isChart ? null : sec);
    (holder || a).remove();
  });
  if (visible['dashboard-progress'] === false) {
    root.querySelectorAll('.md-section').forEach((s) => { if (/Progress chart/i.test(s.querySelector('h2')?.textContent || '')) s.remove(); });
  }
  root.querySelectorAll('.md-cols').forEach((c) => { if (!c.children.length) c.remove(); });
}

const shell = await initShell({ page: 'dashboard', title: 'Dashboard', subtitle: 'Your membership, training and progress at a glance' });

// ------------------------------------------------------------------ formatting
const dash = (v, suffix = '') => (v === null || v === undefined || v === '' ? '—' : `${esc(v)}${suffix}`);
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const num = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(d));
const money = (v) => (v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const PILL = { active: 'ok', paid: 'ok', completed: 'ok', paused: 'warn', pending: 'warn', partial: 'warn', due: 'bad', overdue: 'bad', expired: 'bad', inactive: 'bad', cancelled: 'dim', frozen: 'warn' };
const pill = (v) => (v ? `<span class="md-pill md-pill-${PILL[String(v).toLowerCase()] || 'dim'}">${esc(String(v).replace(/_/g, ' '))}</span>` : '');

/** One stat card. `value`/`sub` are trusted HTML built from escaped parts. */
const card = ({ icon, label, value, sub = '', href = '', state = '' }) => `
  <${href ? `a href="${href}"` : 'div'} class="md-card${state ? ` md-card-${state}` : ''}">
    <div class="md-card-top"><span class="md-card-ico" aria-hidden="true">${icon}</span><span class="md-card-label">${esc(label)}</span></div>
    <div class="md-card-value">${value}</div>
    ${sub ? `<div class="md-card-sub">${sub}</div>` : ''}
  </${href ? 'a' : 'div'}>`;
const empty = (text) => `<span class="md-card-empty">${esc(text)}</span>`;

// ------------------------------------------------------------------ cards
function statCards(d) {
  const p = d.profile;
  const m = d.membership;
  const w = d.workout;
  const target = d.diet.active?.target_calories ? Number(d.diet.active.target_calories) : null;
  const today = d.diet.today;

  // 5. Workout completion: trainer-recorded % if present, else real sessions vs the PT weekly target, else raw count.
  let completion;
  if (w.completionPct !== null && w.completionPct !== undefined) {
    completion = { value: `${num(w.completionPct)}%`, sub: 'Recorded in your performance profile' };
  } else if (w.targetPerWeek) {
    completion = { value: `${w.activity.sessions_7d} / ${esc(w.targetPerWeek)}`, sub: 'Sessions logged in the last 7 days vs your weekly PT target' };
  } else {
    completion = { value: String(w.activity.sessions_7d), sub: `Sessions logged in the last 7 days · ${w.activity.sessions_30d} in 30 days` };
  }

  const expiry = m?.end_date
    ? { value: fmtDate(m.end_date), sub: m.days_remaining >= 0 ? `${m.days_remaining} day${m.days_remaining === 1 ? '' : 's'} remaining` : `Expired ${Math.abs(m.days_remaining)} days ago`,
      state: m.days_remaining < 0 ? 'bad' : m.days_remaining <= 7 ? 'warn' : '' }
    : { value: empty('No membership period on record'), sub: p.fee_due_date ? `Next fee due ${fmtDate(p.fee_due_date)}` : 'Ask the front desk to confirm your plan dates' };

  const nextW = w.next?.day;
  const pt = d.ptSessions;
  const prof = d.progress.profile;
  const latest = d.progress.latestMeasurement;

  return [
    card({ icon: '💳', label: 'Membership status', href: 'member-profile.html',
      value: `${pill(p.status) || '—'}`,
      sub: `${esc(p.plan_name || m?.plan_name || 'No plan on record')} · payment ${pill(p.payment_status) || '—'}${Number(p.fee_due) > 0 ? ` · ${money(p.fee_due)} due` : ''}` }),
    card({ icon: '📅', label: 'Membership expiry', ...expiry }),
    card({ icon: '🎓', label: 'Assigned trainer', href: 'member-trainer.html',
      value: d.trainer ? esc(d.trainer.trainer_name) : empty('No trainer assigned'),
      sub: d.trainer ? `${dash(d.trainer.specialty)}${d.trainer.sessions_per_week ? ` · ${esc(d.trainer.sessions_per_week)} sessions/week` : ''}` : 'Ask the front desk about personal training' }),
    card({ icon: '🏋️', label: "Today's workout", href: 'member-workouts.html',
      value: nextW ? esc(nextW.day_name || `Day ${nextW.day_number}`) : empty(w.active ? 'Programme has no days yet' : 'No active programme'),
      sub: nextW ? `${esc(w.active.program_name)}${nextW.focus ? ` · ${esc(nextW.focus)}` : ''}` : (w.active ? esc(w.active.program_name) : 'Your trainer will assign one') }),
    card({ icon: '✅', label: 'Workout completion', href: 'member-workout-logs.html', value: completion.value, sub: esc(completion.sub) }),
    card({ icon: '🥗', label: 'Diet plan', href: 'member-diet-plan.html',
      value: d.diet.active ? esc(d.diet.active.plan_name) : empty('No diet plan assigned'),
      sub: d.diet.active ? `${target ? `${target} kcal/day target` : 'No calorie target set'}${d.diet.active.assigned_by ? ` · by ${esc(d.diet.active.assigned_by)}` : ''}` : '' }),
    card({ icon: '🤝', label: 'Upcoming PT sessions', href: 'member-pt-sessions.html',
      value: pt === null ? empty('Available after database update') : pt.length ? String(pt.length) : empty('None booked'),
      sub: pt && pt.length ? `Next: ${fmtDateTime(pt[0].scheduled_start)}${pt[0].trainer_name ? ` with ${esc(pt[0].trainer_name)}` : ''}` : '' }),
    card({ icon: '📈', label: 'Fitness progress', href: 'member-progress.html',
      value: prof?.overall_progress_pct !== null && prof?.overall_progress_pct !== undefined ? `${num(prof.overall_progress_pct)}%`
        : latest?.weight_kg ? `${num(latest.weight_kg, 1)} kg` : empty('No progress data yet'),
      sub: prof?.overall_progress_pct !== null && prof?.overall_progress_pct !== undefined ? `Overall progress${prof.progress_status ? ` · ${esc(prof.progress_status)}` : ''}`
        : latest?.weight_kg ? `Latest weight · ${fmtDate(latest.logged_at)}` : 'Record a measurement to start tracking' }),
    card({ icon: '🚪', label: 'Attendance', value: `${d.attendance.days_this_month} day${d.attendance.days_this_month === 1 ? '' : 's'}`,
      sub: `This month · ${d.attendance.days_30d} in the last 30 days${d.attendance.last_check_in ? ` · last ${fmtDate(d.attendance.last_check_in)}` : ''}` }),
    card({ icon: '🔔', label: 'Notifications',
      value: d.notifications === null ? empty('Available after database update') : String(d.notifications.unread),
      sub: d.notifications === null ? '' : 'Unread' }),
  ].join('');
}

// ------------------------------------------------------------------ sections
const section = (title, inner, action = '') => `<section class="card md-section"><div class="md-section-head"><h2>${esc(title)}</h2>${action}</div>${inner}</section>`;

function todayWorkout(w) {
  if (!w.active) return emptyState('No active workout programme', 'When your trainer assigns a programme, your next session appears here.');
  if (!w.next) return emptyState('Your programme has no training days yet', 'Your trainer is still setting it up.');
  const { day, basis, lastLogged } = w.next;
  const why = basis === 'start' ? 'First session of your programme — nothing logged yet.'
    : `Next in your programme after ${esc(lastLogged.day_name || `Day ${lastLogged.day_number}`)} (logged ${fmtDate(lastLogged.completed_at)}).`;
  const ex = day.exercises || [];
  return `<div class="md-workout-head"><div><div class="md-workout-day">${esc(day.day_name || `Day ${day.day_number}`)}</div>
      <div class="mp-muted">${esc(w.active.program_name)}${day.focus ? ` · ${esc(day.focus)}` : ''}</div></div>
      <a class="btn btn-green" href="member-workout-logs.html">Log this workout</a></div>
    <p class="md-basis">${why}</p>
    ${ex.length ? `<ol class="md-ex-list">${ex.map((e) => `<li><span class="md-ex-name">${esc(e.exercise_name)}</span>
        <span class="md-ex-meta">${dash(e.sets)} × ${dash(e.reps)}${e.target_weight_kg ? ` · ${esc(e.target_weight_kg)} kg` : ''}${e.rest_seconds ? ` · rest ${esc(e.rest_seconds)}s` : ''}</span></li>`).join('')}</ol>`
      : emptyState('No exercises on this day yet')}
    ${w.active.trainer_notes ? `<div class="md-note"><b>Trainer note:</b> ${esc(w.active.trainer_notes)}</div>` : ''}`;
}

function classesList(rows) {
  if (!rows.length) return emptyState('No upcoming classes', 'Scheduled gym classes will appear here.');
  return `<ul class="md-list">${rows.map((c) => `<li><div class="md-list-main"><div class="md-list-title">${esc(c.title)}</div>
      <div class="mp-muted">${fmtDateTime(c.scheduled_at)}${c.duration_mins ? ` · ${esc(c.duration_mins)} min` : ''}${c.instructor_name ? ` · ${esc(c.instructor_name)}` : ''}</div></div>
      ${c.registered ? pill('registered') : c.category ? `<span class="md-chip">${esc(c.category)}</span>` : ''}</li>`).join('')}</ul>`;
}

function feedbackList(rows) {
  if (!rows.length) return emptyState('No trainer feedback yet', 'Coaching notes from your trainer will appear here.');
  return `<ul class="md-list">${rows.map((f) => `<li class="md-feedback"><div class="md-list-main">
      <div class="mp-muted">${fmtDate(f.created_at)}${f.trainer_name ? ` · ${esc(f.trainer_name)}` : ''} <span class="md-chip">${esc(f.comment_type)}</span></div>
      <div class="md-feedback-text">${esc(f.comment_text)}</div></div></li>`).join('')}</ul>`;
}

const ACT_ICON = { workout: '🏋️', nutrition: '🍽️', recovery: '🛌', measurement: '📏', check_in: '🚪' };
function activityList(rows) {
  if (!rows.length) return emptyState('No activity yet', 'Workouts, measurements and gym visits you log appear here.');
  return `<ul class="md-list">${rows.map((a) => `<li><span class="md-act-ico" aria-hidden="true">${ACT_ICON[a.kind] || '•'}</span>
      <div class="md-list-main"><div class="md-list-title">${esc(a.title)}</div><div class="mp-muted">${fmtDateTime(a.at)}${a.detail ? ` · ${esc(a.detail)}` : ''}</div></div></li>`).join('')}</ul>`;
}

function announcementList(rows) {
  if (rows === null) return '<div class="mp-muted">Announcements could not be loaded right now.</div>';
  if (!rows.length) return emptyState('No announcements', 'News from the gym will appear here.');
  return `<ul class="md-list">${rows.map((a) => `<li class="md-ann md-ann-${esc(String(a.priority || 'normal').toLowerCase())}"><div class="md-list-main">
      <div class="md-list-title">${esc(a.title)}</div><div class="md-ann-body">${esc(a.message)}</div></div>
      ${a.priority ? `<span class="md-chip">${esc(a.priority)}</span>` : ''}</li>`).join('')}</ul>`;
}

// ------------------------------------------------------------------ progress chart (single series: body weight)
function weightChart(series) {
  const pts = series.map((s) => ({ t: new Date(s.logged_at), v: Number(s.weight_kg) })).filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) {
    return emptyState('Not enough measurements for a chart yet',
      pts.length ? `One weight entry recorded (${pts[0].v.toFixed(1)} kg). Add another measurement to see your trend.` : 'Record your body measurements to start your progress chart.');
  }
  const W = 640; const H = 220; const L = 44; const R = 16; const T = 16; const B = 30;
  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs); let hi = Math.max(...vs);
  const pad = Math.max((hi - lo) * 0.15, 0.5); lo -= pad; hi += pad;
  const t0 = pts[0].t.getTime(); const t1 = pts[pts.length - 1].t.getTime() || t0 + 1;
  const x = (t) => L + ((t.getTime() - t0) / Math.max(t1 - t0, 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi];
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const first = pts[0]; const last = pts[pts.length - 1];
  const change = last.v - first.v;
  const label = (t) => t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `<figure class="md-chart" data-points='${esc(JSON.stringify(pts.map((p) => [p.t.toISOString(), p.v])))}'>
    <figcaption class="md-chart-cap"><span>Body weight (kg)</span>
      <span class="mp-muted">${change >= 0 ? '+' : ''}${change.toFixed(1)} kg since ${label(first.t)} · ${pts.length} measurements</span></figcaption>
    <div class="md-chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Body weight from ${esc(label(first.t))} to ${esc(label(last.t))}: ${first.v.toFixed(1)} kg to ${last.v.toFixed(1)} kg">
        ${ticks.map((v) => `<line class="md-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="md-axis" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`).join('')}
        <text class="md-axis" x="${L}" y="${H - 8}">${esc(label(first.t))}</text>
        <text class="md-axis" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(label(last.t))}</text>
        <line class="md-cross" id="md-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
        <path class="md-line" d="${path}"/>
        ${pts.map((p) => `<circle class="md-dot" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4"/>`).join('')}
        <text class="md-direct" x="${(x(last.t) - 6).toFixed(1)}" y="${(y(last.v) - 10).toFixed(1)}" text-anchor="end">${last.v.toFixed(1)} kg</text>
        <rect class="md-hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
      </svg>
      <div class="md-tip" id="md-tip" hidden></div>
    </div>
    <details class="md-table"><summary>Show data table</summary>
      <table class="admin-table"><thead><tr><th>Date</th><th>Weight (kg)</th></tr></thead>
      <tbody>${pts.slice().reverse().map((p) => `<tr><td>${esc(p.t.toLocaleDateString())}</td><td>${p.v.toFixed(1)}</td></tr>`).join('')}</tbody></table></details>
  </figure>`;
}

/** Crosshair + tooltip: snaps to the nearest measurement. */
function wireChart(root) {
  const fig = root.querySelector('.md-chart');
  if (!fig) return;
  const svg = fig.querySelector('svg'); const tip = fig.querySelector('#md-tip'); const cross = fig.querySelector('#md-cross');
  const dots = [...fig.querySelectorAll('.md-dot')];
  const data = JSON.parse(fig.dataset.points);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * (svg.viewBox.baseVal.width / r.width);
    let best = 0;
    dots.forEach((d, i) => { if (Math.abs(d.cx.baseVal.value - sx) < Math.abs(dots[best].cx.baseVal.value - sx)) best = i; });
    const dot = dots[best];
    dots.forEach((d) => d.classList.toggle('is-active', d === dot));
    cross.setAttribute('x1', dot.cx.baseVal.value); cross.setAttribute('x2', dot.cx.baseVal.value); cross.setAttribute('visibility', 'visible');
    const [iso, v] = data[best];
    tip.textContent = `${new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · ${Number(v).toFixed(1)} kg`;
    tip.hidden = false;
    const px = (dot.cx.baseVal.value / svg.viewBox.baseVal.width) * r.width;
    const py = (dot.cy.baseVal.value / svg.viewBox.baseVal.height) * r.height;
    tip.style.left = `${Math.min(Math.max(px, 70), r.width - 70)}px`;
    tip.style.top = `${Math.max(py - 40, 0)}px`;
  };
  const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.classList.remove('is-active')); };
  const hit = fig.querySelector('.md-hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', leave);
}

// ------------------------------------------------------------------ page
const QUICK = [
  ['📝', 'Log a workout', 'member-workout-logs.html'],
  ['📏', 'Record measurements', 'member-measurements.html'],
  ['📈', 'View progress', 'member-progress.html'],
  ['🎓', 'My trainer', 'member-trainer.html'],
];

if (shell) {
  const { content } = shell;
  content.innerHTML = '<div class="mp-muted mp-loading">Loading your dashboard…</div>';
  try {
    const [d, announcements, fs] = await Promise.all([
      api.get('/dashboard').then((r) => r.data),
      fetch('/api/v1/announcements?activeOnly=true&limit=5').then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => j.data || []).catch(() => null),
      api.get('/fee-status').then((r) => r.data).catch(() => null), // fee countdown, gender, plan week
    ]);
    applyGenderTheme(fs?.gender);
    const first = String(d.profile.full_name || '').split(/\s+/)[0] || 'there';
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    content.innerHTML = `
      ${feeBanner(fs?.fee)}
      <section class="md-hero card">
        <div><div class="md-hero-greet">${greet}, ${esc(first)} 👋</div>
          <div class="mp-muted">${esc(d.profile.member_code || '')}${d.profile.plan_name ? ` · ${esc(d.profile.plan_name)}` : ''} · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
        <nav class="md-quick" aria-label="Quick actions">${QUICK.map(([i, l, h]) => `<a class="md-quick-btn" href="${h}"><span aria-hidden="true">${i}</span>${esc(l)}</a>`).join('')}</nav>
      </section>
      <div class="md-cards">${statCards(d)}</div>
      ${fs ? `<div class="md-cols">${weekCard(fs.plan, fs.gender)}${tipsCard(fs.gender)}</div>` : ''}
      <div class="md-cols">
        ${section("Today's workout", todayWorkout(d.workout), '<a class="btn btn-outline" href="member-workouts.html">All workouts</a>')}
        ${section('Progress chart', weightChart(d.progress.weightSeries), '<a class="btn btn-outline" href="member-progress.html">Full progress</a>')}
      </div>
      <div class="md-cols">
        ${section('Recent trainer feedback', feedbackList(d.feedback), '<a class="btn btn-outline" href="member-trainer.html">My trainer</a>')}
        ${section('Upcoming classes', classesList(d.classes))}
      </div>
      <div class="md-cols">
        ${section('Recent activity', activityList(d.recentActivity))}
        ${section('Gym announcements', announcementList(announcements))}
      </div>`;
    applyMenuChoices(content);
    wireChart(content);
  } catch (err) {
    // 401 = session ended: member-api.js is already redirecting to sign-in
    if (!(err instanceof ApiError && err.status === 401)) content.innerHTML = notice(err.status === 403 ? 'Access denied' : 'Could not load your dashboard', err.message || 'Unexpected error.', { error: true });
  }
}
