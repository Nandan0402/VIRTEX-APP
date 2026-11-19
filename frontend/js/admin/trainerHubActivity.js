/**
 * Virtex Admin — Trainer Hub activity panel (Trainer → Admin oversight).
 *
 * Renders into <section id="trainer-hub-activity"> on admin-personaltraniner.html using
 * GET /api/v1/admin/trainer-hub/activity (owner/manager only, enforced server-side).
 * Shows per trainer: attendance, completed PT sessions, client workout activity,
 * assignments, feedback, diet monitoring and member progress, with a link that opens
 * the trainer's own Trainer Hub in supervisory view (?trainerId=).
 */
const TOKEN_KEY = 'virtex_admin_jwt_token';
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));
const n = (v, suffix = '') => (v === null || v === undefined || v === '' ? '—' : `${esc(v)}${suffix}`);
const hours = (secs) => `${(Number(secs || 0) / 3600).toFixed(1)} h`;

function shell(root, inner, days) {
  root.innerHTML = `<div class="card thub-card">
    <div class="thub-head">
      <div><h3>📊 Trainer Hub activity</h3>
        <p>Attendance, PT sessions, client workouts, diet monitoring and member progress reported from each trainer's hub.</p></div>
      <label class="thub-range">Period
        <select class="select-filter" id="thub-days">
          ${[7, 30, 90].map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>Last ${d} days</option>`).join('')}
        </select></label>
    </div>
    <div id="thub-body">${inner}</div></div>`;
}

async function load(root, days = 30) {
  const token = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();
  shell(root, '<div class="thub-muted">Loading trainer activity…</div>', days);
  root.querySelector('#thub-days').addEventListener('change', (e) => load(root, Number(e.target.value)));
  const body = root.querySelector('#thub-body');
  if (!token) { body.innerHTML = '<div class="thub-muted">Sign in to view trainer activity.</div>'; return; }
  try {
    const res = await fetch(`/api/v1/admin/trainer-hub/activity?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    if (res.status === 403) { root.innerHTML = ''; return; }          // not owner/manager: hide panel
    if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status}).`);
    const { trainers, ptSessionsAvailable } = json.data;
    if (!trainers.length) {
      body.innerHTML = '<div class="thub-empty"><b>No trainers yet</b><span>Add a trainer with a login above; their Trainer Hub activity will appear here.</span></div>';
      return;
    }
    body.innerHTML = `<div class="table-responsive"><table class="admin-table thub-table"><thead><tr>
        <th>Trainer</th><th>Clients</th><th>Attendance</th><th>PT sessions done</th><th>Client workouts</th>
        <th>Assigned</th><th>Feedback</th><th>Diet monitoring</th><th>Avg client progress</th></tr></thead><tbody>
      ${trainers.map((t) => `<tr>
        <td><div class="thub-name">${esc(t.full_name)}</div><div class="thub-muted">${n(t.trainer_code)} · ${n(t.status)}${t.has_login ? '' : ' · <span class="thub-warn">no login</span>'}</div></td>
        <td>${t.active_clients}<div class="thub-muted">${t.paused_clients} paused</div></td>
        <td>${t.attendance_days} days<div class="thub-muted">${hours(t.work_seconds)}</div></td>
        <td>${ptSessionsAvailable ? t.completed_pt_sessions : '<span class="thub-muted" title="Needs the Trainer Hub PT session migration">after DB update</span>'}</td>
        <td>${t.client_workout_sessions}<div class="thub-muted">sessions logged</div></td>
        <td>${t.workouts_assigned} workouts<div class="thub-muted">${t.diet_plans_assigned} diet plans</div></td>
        <td>${t.feedback_given}</td>
        <td>${t.client_nutrition_logs} logs<div class="thub-muted">adherence ${n(t.avg_diet_adherence, '%')}</div></td>
        <td>${n(t.avg_client_progress, '%')}</td>      </tr>`).join('')}</tbody></table></div>`;
  } catch (err) {
    body.innerHTML = `<div class="thub-error">⚠️ Could not load trainer activity: ${esc(err.message)}</div>`;
  }
}

const root = document.getElementById('trainer-hub-activity');
if (root) load(root);
