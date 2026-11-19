/** Virtex Member Portal — member-diet-plan.html: the diet plan assigned by the member's trainer.
 *  Read: GET /api/v1/member/diet-plans                 (current = latest active assignment, history)
 *        GET /api/v1/member/diet-plans/:assignmentId   (a past or current plan of the member's; 404 otherwise)
 *  Read-only. Trainer edits to the plan appear here immediately ("last updated" is shown).
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';

const shell = await initShell({
  page: 'diet-plans',
  title: 'Diet Plan',
  subtitle: 'How to eat for bulking, cutting or maintenance — and the plan from your trainer'
});

const NONE = '<span class="dp-none">Not set</span>';
const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const fmt = (v, unit = '', d = 0) => (n(v) === null ? NONE : `${esc(n(v).toLocaleString(undefined, { maximumFractionDigits: d }))}${unit}`);
const fmtDate = (v, o = { day: 'numeric', month: 'short', year: 'numeric' }) => (v ? esc(new Date(v).toLocaleDateString(undefined, o)) : '—');

function formatTime(t) {
  if (!t) return '';
  const s = String(t).trim();
  const parts = s.split(':');
  if (parts.length >= 2) {
    const hours = parseInt(parts[0], 10);
    const mins = parts[1].padStart(2, '0');
    if (!isNaN(hours)) {
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const h12 = hours % 12 || 12;
      return `${h12}:${mins} ${ampm}`;
    }
  }
  return esc(s.slice(0, 5));
}

const GROUPS = [
  { key: 'breakfast', label: 'Breakfast', icon: '🌅', match: /breakfast/i },
  { key: 'lunch', label: 'Lunch', icon: '🍛', match: /lunch/i },
  { key: 'dinner', label: 'Dinner', icon: '🌙', match: /dinner|supper/i },
  { key: 'snacks', label: 'Snacks', icon: '🍎', match: /snack|pre[- ]?workout|post[- ]?workout|mid/i },
];

const groupOf = (m) => GROUPS.find((g) => g.match.test(m.meal_type || '')) || { key: 'other', label: 'Other Meals', icon: '🍽️' };

/** Quantity exactly as planned: custom portion, else servings × the food's serving size. */
function quantity(i) {
  if (i.custom_portion) return esc(i.custom_portion);
  const s = n(i.servings);
  if (s === null) return NONE;
  return `${esc(s.toLocaleString(undefined, { maximumFractionDigits: 2 }))} × ${i.serving_size ? esc(i.serving_size) : 'serving'}`;
}

function totals(items) {
  return items.reduce((t, i) => ({
    kcal: t.kcal + (n(i.calories) || 0),
    p: t.p + (n(i.protein_g) || 0),
    c: t.c + (n(i.carbs_g) || 0),
    f: t.f + (n(i.fats_g) || 0)
  }), { kcal: 0, p: 0, c: 0, f: 0 });
}

function targetTile(label, target, unit, planned, icon) {
  const pct = n(target) && planned !== null ? Math.min(150, Math.round((planned / n(target)) * 100)) : null;
  return `<div class="dp-tile">
    <div>
      <span class="dp-tile-label">${icon} ${esc(label)} Target</span>
      <b>${fmt(target, unit)}</b>
    </div>
    ${pct !== null ? `
      <div>
        <div class="dp-meter" role="meter" aria-label="${esc(label)} planned in meals" aria-valuemin="0" aria-valuemax="${n(target)}" aria-valuenow="${Math.round(planned)}">
          <span style="width:${Math.min(pct, 100)}%"></span>
        </div>
        <small>${esc(Math.round(planned).toLocaleString())}${unit} planned (${pct}%)</small>
      </div>` : '<small>&nbsp;</small>'}
  </div>`;
}

function mealCard(m) {
  const t = totals(m.items || []);
  const tags = (i) => [
    i.is_vegan && 'Vegan',
    !i.is_vegan && i.is_vegetarian && 'Vegetarian',
    i.is_gluten_free && 'Gluten-Free'
  ].filter(Boolean).map((x) => `<span class="dp-tag">${x}</span>`).join('');

  return `<article class="dp-meal">
    <header>
      <h4>${esc(m.meal_type || 'Meal')}</h4>
      ${m.scheduled_time ? `<span class="dp-time">🕒 ${formatTime(m.scheduled_time)}</span>` : ''}
    </header>
    ${m.items && m.items.length ? `
      <div class="table-responsive">
        <table class="admin-table dp-table">
          <thead>
            <tr>
              <th>Food Item</th>
              <th>Food Quantity</th>
              <th>Calories</th>
              <th>Protein</th>
              <th>Carbohydrates</th>
              <th>Fat</th>
            </tr>
          </thead>
          <tbody>
            ${m.items.map((i) => `
              <tr>
                <td><span class="dp-food">${esc(i.food_name)}</span> ${tags(i)}</td>
                <td>${quantity(i)}</td>
                <td>${fmt(i.calories, ' kcal')}</td>
                <td>${fmt(i.protein_g, ' g', 1)}</td>
                <td>${fmt(i.carbs_g, ' g', 1)}</td>
                <td>${fmt(i.fats_g, ' g', 1)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2">Meal Total</td>
              <td>${fmt(t.kcal, ' kcal')}</td>
              <td>${fmt(t.p, ' g', 1)}</td>
              <td>${fmt(t.c, ' g', 1)}</td>
              <td>${fmt(t.f, ' g', 1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`
      : '<p class="dp-none">No food items listed for this meal.</p>'}
    ${m.notes ? `<div class="dp-instr"><b>📋 Meal Instructions:</b> ${esc(m.notes)}</div>` : ''}
  </article>`;
}

function macroCard(plan, t) {
  if (!t || t.kcal === 0) return '';
  const protKcal = t.p * 4;
  const carbsKcal = t.c * 4;
  const fatKcal = t.f * 9;
  const totalMacroKcal = protKcal + carbsKcal + fatKcal || 1;
  const protPct = Math.round((protKcal / totalMacroKcal) * 100);
  const carbsPct = Math.round((carbsKcal / totalMacroKcal) * 100);
  const fatPct = Math.max(0, 100 - protPct - carbsPct);

  return `<section class="card dp-macro-card" aria-label="Nutritional Information & Macro Distribution">
    <div class="dp-macro-head">
      <div>
        <h3>📊 Planned Nutritional Distribution & Macro Split</h3>
        <p class="dp-sub">Caloric ratio based on prescribed meals: Protein (4 kcal/g), Carbs (4 kcal/g), Fat (9 kcal/g)</p>
      </div>
    </div>
    <div class="dp-macro-bar" role="img" aria-label="Macro breakdown: Protein ${protPct}%, Carbs ${carbsPct}%, Fat ${fatPct}%">
      <div class="dp-macro-seg dp-macro-prot" style="width: ${protPct}%" title="Protein ${protPct}%"></div>
      <div class="dp-macro-seg dp-macro-carbs" style="width: ${carbsPct}%" title="Carbohydrates ${carbsPct}%"></div>
      <div class="dp-macro-seg dp-macro-fat" style="width: ${fatPct}%" title="Fat ${fatPct}%"></div>
    </div>
    <div class="dp-macro-legend">
      <div class="dp-macro-item"><span class="dp-dot dp-dot-prot"></span><b>🥩 Protein:</b> <span>${fmt(t.p, ' g', 1)} (${protPct}% of kcal)</span></div>
      <div class="dp-macro-item"><span class="dp-dot dp-dot-carbs"></span><b>🍚 Carbs:</b> <span>${fmt(t.c, ' g', 1)} (${carbsPct}% of kcal)</span></div>
      <div class="dp-macro-item"><span class="dp-dot dp-dot-fat"></span><b>🥑 Fat:</b> <span>${fmt(t.f, ' g', 1)} (${fatPct}% of kcal)</span></div>
      <div class="dp-macro-item"><span class="dp-dot dp-dot-water"></span><b>💧 Water Target:</b> <span>${n(plan.target_water_ml) === null ? NONE : `${esc((n(plan.target_water_ml) / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }))} L`}</span></div>
    </div>
  </section>`;
}

function planView({ assignment, plan }, { historical = false, isCurrent = true } = {}) {
  if (!plan) return notice('Plan unavailable', 'This diet plan could not be found. Please contact your trainer.', { error: true });
  const meals = plan.meals || [];
  const all = meals.flatMap((m) => m.items || []);
  const t = all.length ? totals(all) : null;

  // Group meals into Breakfast, Lunch, Dinner, Snacks, and Other
  const grouped = [...GROUPS, { key: 'other', label: 'Other Meals', icon: '🍽️' }]
    .map((g) => ({ ...g, meals: meals.filter((m) => groupOf(m).key === g.key) }))
    .filter((g) => g.meals.length || g.key !== 'other');

  // Only the member's current (latest) active assignment carries the "Latest Authorised Plan" badge.
  const isCurrentActive = assignment.status === 'active' && !historical && isCurrent;

  return `
    ${historical ? `
      <aside class="dp-history-banner" role="region" aria-label="Historical diet plan notice">
        <div class="dp-history-banner-main">
          <span class="dp-history-icon">📜</span>
          <div class="dp-history-text">
            <strong>Historical Diet Plan (Archived)</strong>
            <p>This plan was marked <b>${esc(assignment.status)}</b>${assignment.end_date ? ` on ${fmtDate(assignment.end_date)}` : ''}. Preserved permanently for your records.</p>
          </div>
        </div>
        <button type="button" class="btn btn-outline" id="dp-back-top">← Back to Latest Authorised Plan</button>
      </aside>` : ''}

    <section class="card dp-head">
      <div class="dp-head-row">
        <div class="dp-head-title-group">
          <div class="dp-head-title-row">
            <h2>${esc(plan.name)}</h2>
            ${isCurrentActive ? '<span class="dp-badge dp-badge-auth">✓ Latest Authorised Plan</span>' : `<span class="dp-badge dp-badge-${assignment.status === 'completed' ? 'completed' : 'paused'}">${esc(assignment.status)}</span>`}
            ${plan.goal ? `<span class="dp-chip">${esc(plan.goal)}</span>` : ''}
          </div>
          <div class="dp-meta">
            <span>${assignment.assigned_by || plan.trainer_name ? `Prescribed by Coach <b>${esc(assignment.assigned_by || plan.trainer_name)}</b>` : 'Prescribed by your trainer'}</span>
            <span>· Active since ${fmtDate(assignment.start_date)}</span>
            ${assignment.end_date ? `<span>· Ended on ${fmtDate(assignment.end_date)}</span>` : ''}
          </div>
        </div>
        <div class="dp-head-actions">
          <div class="dp-updated" title="Reflects the trainer's latest modifications">🔄 Plan last updated ${fmtDate(plan.updated_at || plan.created_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
          <a class="btn btn-outline" href="member-messages.html" title="Send a question to your trainer">💬 Message Trainer</a>
        </div>
      </div>
      ${plan.description ? `<p class="dp-desc">${esc(plan.description)}</p>` : ''}
      ${assignment.notes ? `<div class="dp-trainer-note"><b>💬 Note from your trainer:</b> ${esc(assignment.notes)}</div>` : ''}
    </section>

    <section class="dp-tiles" aria-label="Prescribed daily targets">
      ${targetTile('Calories', plan.target_calories, ' kcal', t ? t.kcal : null, '🔥')}
      ${targetTile('Protein', plan.target_protein_g, ' g', t ? t.p : null, '🥩')}
      ${targetTile('Carbohydrates', plan.target_carbs_g, ' g', t ? t.c : null, '🍚')}
      ${targetTile('Fat', plan.target_fats_g, ' g', t ? t.f : null, '🥑')}
      <div class="dp-tile">
        <div>
          <span class="dp-tile-label">💧 Water Intake Target</span>
          <b>${n(plan.target_water_ml) === null ? NONE : `${esc((n(plan.target_water_ml) / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }))} L`}</b>
        </div>
        <small>${n(plan.target_water_ml) === null ? '&nbsp;' : `${esc(n(plan.target_water_ml).toLocaleString())} ml per day`}</small>
      </div>
    </section>

    ${macroCard(plan, t)}

    <section class="card dp-schedule">
      <h3>Meal Schedule & Prescribed Foods</h3>
      ${meals.length ? `
        <nav class="dp-jump" aria-label="Jump to meal schedule">
          ${grouped.map((g) => `<a href="#dp-${g.key}">${g.icon} ${g.label}${g.meals.length ? ` (${g.meals.length})` : ''}</a>`).join('')}
        </nav>
        ${grouped.map((g) => `
          <section class="dp-group" id="dp-${g.key}">
            <h3 class="dp-group-h">${g.icon} ${g.label}</h3>
            ${g.meals.length ? g.meals.map(mealCard).join('') : `<p class="dp-none">No ${g.label.toLowerCase()} scheduled in this plan.</p>`}
          </section>`).join('')}`
      : emptyState('No meals in this plan yet', 'Your trainer has set your daily targets but has not yet added individual meals.')}
    </section>`;
}

if (shell) {
  const { content } = shell;
  // Same read-only Diet Guide the gym admin sees, shown above the member's own trainer plan.
  const guide = document.createElement('section');
  guide.className = 'dp-guide'; guide.setAttribute('aria-label', 'Diet guide');
  content.before(guide);
  window.VirtexDietGuide?.mount(guide, { note: "📘 General guide from your gym. Your personal trainer's plan (if you have one) is below." });
  const planHead = document.createElement('h2');
  planHead.className = 'dp-plan-head'; planHead.textContent = "🧑‍🏫 Your trainer's diet plan";
  content.before(planHead);
  let data = null;

  function render(view = null) {
    // Archived = no longer active. Another ACTIVE assignment is not historical.
    const isHistorical = !!view && view.assignment.status !== 'active';

    const pastList = data.history.length ? `
      <section class="card dp-history">
        <div class="dp-history-head">
          <h3>📚 Past Diet Plans (History Archive)</h3>
          <p class="dp-sub">Historical diet plans assigned by your trainers are preserved permanently for your records.</p>
        </div>
        <ul>
          ${data.history.map((a) => `
            <li>
              <div class="dp-history-info">
                <div class="dp-history-title-row">
                  <b>${esc(a.plan_name)}</b>
                  <span class="dp-badge dp-badge-${a.status === 'completed' ? 'completed' : 'paused'}">${esc(a.status)}</span>
                  ${a.goal ? `<span class="dp-chip">${esc(a.goal)}</span>` : ''}
                </div>
                <div class="dp-sub">
                  ${fmtDate(a.start_date)} – ${a.end_date ? fmtDate(a.end_date) : 'Present'}
                  ${a.assigned_by ? ` · Prescribed by Coach ${esc(a.assigned_by)}` : ''}
                </div>
                <div class="dp-history-targets">
                  Daily: ${fmt(a.target_calories, ' kcal')} · ${fmt(a.target_protein_g, ' g')} protein · ${fmt(a.target_carbs_g, ' g')} carbs · ${fmt(a.target_fats_g, ' g')} fat · ${fmt(a.target_water_ml, ' ml')} water
                </div>
              </div>
              <button type="button" class="btn btn-outline" data-view="${a.id}">View Plan Details</button>
            </li>`).join('')}
        </ul>
      </section>` : `
      <section class="card dp-history">
        <div class="dp-history-head">
          <h3>📚 Past Diet Plans (History Archive)</h3>
          <p class="dp-sub">No historical diet plans on your account yet. When your trainer assigns an updated plan, earlier plans will be archived here.</p>
        </div>
      </section>`;

    const others = data.otherActive.length ? `
      <div class="card" style="padding: 0.9rem 1.2rem; margin-top: 1rem;">
        <span class="dp-badge dp-badge-active">Other Active Plans</span>
        <p class="dp-sub" style="margin-top: 6px;">You also have ${data.otherActive.length} other active diet assignment${data.otherActive.length === 1 ? '' : 's'}:
          ${data.otherActive.map((a) => `<button type="button" class="dp-link" data-view="${a.id}"><b>${esc(a.plan_name)}</b></button>`).join(', ')}.
        </p>
      </div>` : '';

    const main = view
      ? `${planView(view, { historical: isHistorical, isCurrent: view.assignment.id === data.current?.assignment.id })}
         <p style="margin-top: 1rem;"><button type="button" class="btn btn-outline" id="dp-back-bottom">← Back to Latest Authorised Plan</button></p>`
      : data.current
        ? planView(data.current)
        : `<section class="card dp-empty">
             ${emptyState('No diet plan assigned yet', 'Your trainer creates your personalized diet plan. Once it is assigned and authorised, your meal schedule and daily nutritional targets will appear here.')}
             <div class="dp-empty-links">
               <a class="btn btn-outline" href="member-trainer.html">View My Trainer</a>
             </div>
           </section>`;

    content.innerHTML = `${main}${others}${pastList}`;

    content.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => openAssignment(b.dataset.view)));

    const backAction = () => {
      history.replaceState(null, '', 'member-diet-plan.html');
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    content.querySelector('#dp-back-top')?.addEventListener('click', backAction);
    content.querySelector('#dp-back-bottom')?.addEventListener('click', backAction);
  }

  async function openAssignment(id) {
    try {
      content.innerHTML = '<div class="mp-muted mp-loading">Loading diet plan details…</div>';
      const view = (await api.get(`/diet-plans/${encodeURIComponent(id)}`)).data;
      history.replaceState(null, '', `member-diet-plan.html?assignment=${encodeURIComponent(id)}`);
      render(view);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        // Replace the loading text: show the member's own plan again with the error on top.
        history.replaceState(null, '', 'member-diet-plan.html');
        render();
        content.insertAdjacentHTML('afterbegin', notice(err.status === 404 ? 'Plan not found' : 'Could not open this plan', err.status === 404 ? 'That diet plan is not linked to your account.' : err.message, { error: true }));
      }
    }
  }

  content.innerHTML = '<div class="mp-muted mp-loading">Loading your assigned diet plan…</div>';
  try {
    data = (await api.get('/diet-plans')).data;
    const wanted = new URLSearchParams(location.search).get('assignment');
    if (wanted) {
      await openAssignment(wanted);
    } else {
      render();
    }
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) {
      content.innerHTML = notice('Could not load your diet plan', err.message || 'Unexpected error while fetching your diet plan.', { error: true });
    }
  }
}
