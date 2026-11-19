/**
 * Virtex Admin - Diet & Nutrition Management Controller
 * Handles Diet Plans, Food Database, Meal Schedules, Macro & Water Tracking, Assignments, and Adherence Analytics.
 */

(function () {
  'use strict';

  // Global State
  let foods = [];
  let plans = [];
  let assignments = [];
  let dailyLogs = [];
  let analyticsData = null;
  let membersList = [];
  let trainersList = [];

  let currentTab = 'plans';
  let activeFoodCategory = 'All';
  let foodSearchTerm = '';
  let planSearchTerm = '';

  // Auth Helper
  function getAuthHeaders() {
    const token = (localStorage.getItem('virtex_admin_jwt_token') || localStorage.getItem('token'));
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  }

  // Toast Notification
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `diet-toast toast-${type}`;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.background = type === 'success' ? '#11141e' : '#2b1111';
    toast.style.border = `1px solid ${type === 'success' ? '#00e676' : '#ff5252'}`;
    toast.style.color = '#fff';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';
    toast.style.fontSize = '0.9rem';
    toast.innerHTML = `<span>${type === 'success' ? '✓' : '⚠️'}</span> <span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Initialize
  async function init() {
    setupTabListeners();
    setupFilterListeners();
    setupModalListeners();

    await Promise.all([
      fetchMembersAndTrainers(),
      loadFoods(),
      loadPlans(),
      loadAssignments(),
      loadDailyLogs(),
      loadAnalytics()
    ]);
  }

  // Fetch Members and Trainers for Select Dropdowns
  async function fetchMembersAndTrainers() {
    try {
      const memRes = await fetch('/api/v1/members', { headers: getAuthHeaders() });
      if (memRes.ok) {
        const memJson = await memRes.json();
        membersList = memJson.data || memJson.members || [];
        populateMemberDropdowns();
      }

      const trRes = await fetch('/api/v1/trainers', { headers: getAuthHeaders() });
      if (trRes.ok) {
        const trJson = await trRes.json();
        trainersList = trJson.data || trJson.trainers || [];
        populateTrainerDropdowns();
      }
    } catch (err) {
      console.warn('Could not fetch members/trainers for dropdowns:', err);
    }
  }

  function populateMemberDropdowns() {
    const selects = ['assign-diet-member-select', 'log-diet-member-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Member --</option>' +
          membersList.map(m => `<option value="${m.id}">${m.full_name || m.name} (${m.member_code || '#' + m.id})</option>`).join('');
      }
    });
  }

  function populateTrainerDropdowns() {
    const selects = ['diet-builder-trainer-select', 'assign-diet-trainer-select', 'filter-diet-trainer-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const isFilter = id === 'filter-diet-trainer-select';
        el.innerHTML = (isFilter ? '<option value="All">All Trainers</option>' : '<option value="">-- Select Trainer --</option>') +
          trainersList.map(t => `<option value="${t.id}">${t.full_name || t.name} (${t.specialty || 'Trainer'})</option>`).join('');
      }
    });
  }

  // Tab Navigation
  function setupTabListeners() {
    const tabs = document.querySelectorAll('.diet-tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.getAttribute('data-tab');

        document.querySelectorAll('.diet-tab-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById(`diet-tab-${currentTab}`);
        if (target) target.style.display = 'block';
      });
    });

    function checkDietHash() {
      let hash = window.location.hash ? window.location.hash.replace('#', '').toLowerCase() : '';
      if (!hash) return;
      const targetBtn = document.querySelector(`.diet-tab-btn[data-tab="${hash}"]`);
      if (targetBtn) targetBtn.click();
    }
    checkDietHash();
    window.addEventListener('hashchange', checkDietHash);
  }

  // Filters & Search
  function setupFilterListeners() {
    // Food Category Filter Pills
    document.querySelectorAll('.filter-pill[data-food-cat]').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill[data-food-cat]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeFoodCategory = pill.getAttribute('data-food-cat');
        renderFoods();
      });
    });

    // Food Search
    const fSearch = document.getElementById('food-search-input');
    if (fSearch) {
      fSearch.addEventListener('input', (e) => {
        foodSearchTerm = e.target.value.toLowerCase();
        renderFoods();
      });
    }

    // Plan Search & Filters
    const pSearch = document.getElementById('diet-plan-search-input');
    if (pSearch) {
      pSearch.addEventListener('input', (e) => {
        planSearchTerm = e.target.value.toLowerCase();
        renderPlans();
      });
    }

    const trFilter = document.getElementById('filter-diet-trainer-select');
    if (trFilter) {
      trFilter.addEventListener('change', () => loadPlans());
    }

    const goalFilter = document.getElementById('filter-diet-goal-select');
    if (goalFilter) {
      goalFilter.addEventListener('change', () => loadPlans());
    }

    // Assignment Status Filter
    const assignStatus = document.getElementById('filter-diet-assignment-status');
    if (assignStatus) {
      assignStatus.addEventListener('change', (e) => loadAssignments(e.target.value));
    }
  }

  // Plan names are stored like "Lean Muscle Shred (2100 kcal)"; calories are already shown
  // separately (kcal chip / dropdown suffix), so drop the trailing "(NNNN kcal)" when displaying.
  function displayPlanName(name) {
    return String(name || '').replace(/\s*\(\s*[\d,.]+\s*kcal\s*\)\s*$/i, '').trim() || name || '';
  }

  // Show a visible error instead of a blank grid/table when an API call fails
  function showLoadError(targetId, what, res, badgeId) {
    const el = document.getElementById(targetId);
    const msg = res && res.status === 401
      ? 'Your admin session has expired. Please sign in again.'
      : `Could not load ${what}${res ? ` (HTTP ${res.status})` : ''}. Please refresh.`;
    if (el) {
      el.innerHTML = el.tagName === 'TBODY'
        ? `<tr><td colspan="7"><div class="diet-load-error">⚠️ ${msg}</div></td></tr>`
        : `<div class="diet-load-error">⚠️ ${msg}</div>`;
    }
    const badge = badgeId && document.getElementById(badgeId);
    if (badge) badge.textContent = '!';
  }

  // API Callers
  async function loadFoods() {
    try {
      const res = await fetch('/api/v1/admin/diet/foods', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        foods = json.data || [];
        const badge = document.getElementById('badge-food-count');
        if (badge) badge.textContent = foods.length;
        renderFoods();
      } else {
        showLoadError('food-grid-container', 'foods', res, 'badge-food-count');
      }
    } catch (err) {
      console.error('Failed to load foods:', err);
      showLoadError('food-grid-container', 'foods', null, 'badge-food-count');
    }
  }

  async function loadPlans() {
    try {
      let url = '/api/v1/admin/diet/plans?';
      const tr = document.getElementById('filter-diet-trainer-select')?.value;
      const goal = document.getElementById('filter-diet-goal-select')?.value;

      if (tr && tr !== 'All') url += `trainer_id=${encodeURIComponent(tr)}&`;
      if (goal && goal !== 'All') url += `goal=${encodeURIComponent(goal)}&`;

      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        plans = json.data || [];
        const badge = document.getElementById('badge-plan-count');
        if (badge) badge.textContent = plans.length;
        renderPlans();
        populatePlanSelects();
      } else {
        showLoadError('diet-plans-grid-container', 'diet plans', res, 'badge-plan-count');
      }
    } catch (err) {
      console.error('Failed to load diet plans:', err);
      showLoadError('diet-plans-grid-container', 'diet plans', null, 'badge-plan-count');
    }
  }

  function populatePlanSelects() {
    const selects = ['assign-diet-plan-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Diet Plan --</option>' +
          plans.map(p => `<option value="${p.id}">${escapeHtml(displayPlanName(p.name))} (${p.target_calories} kcal • ${p.goal})</option>`).join('');
      }
    });
  }

  async function loadAssignments(status = 'All') {
    try {
      let url = '/api/v1/admin/diet/assignments';
      if (status && status !== 'All') url += `?status=${encodeURIComponent(status)}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        assignments = json.data || [];
        const badge = document.getElementById('badge-diet-assignment-count');
        if (badge) badge.textContent = assignments.length;
        renderAssignments();
      } else {
        showLoadError('diet-assignments-tbody', 'diet assignments', res, 'badge-diet-assignment-count');
      }
    } catch (err) {
      console.error('Failed to load diet assignments:', err);
      showLoadError('diet-assignments-tbody', 'diet assignments', null, 'badge-diet-assignment-count');
    }
  }

  async function loadDailyLogs() {
    try {
      const res = await fetch('/api/v1/admin/diet/logs', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        dailyLogs = json.data || [];
        const badge = document.getElementById('badge-diet-log-count');
        if (badge) badge.textContent = dailyLogs.length;
        renderDailyLogs();
      } else {
        showLoadError('daily-nutrition-logs-tbody', 'nutrition logs', res, 'badge-diet-log-count');
      }
    } catch (err) {
      console.error('Failed to load daily nutrition logs:', err);
      showLoadError('daily-nutrition-logs-tbody', 'nutrition logs', null, 'badge-diet-log-count');
    }
  }

  async function loadAnalytics() {
    try {
      const res = await fetch('/api/v1/admin/diet/analytics', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        analyticsData = json.data || null;
        renderAnalytics();
      }
    } catch (err) {
      console.error('Failed to load diet analytics:', err);
    }
  }

  // Render Functions
  function renderFoods() {
    const container = document.getElementById('food-grid-container');
    if (!container) return;

    let filtered = foods;
    if (activeFoodCategory !== 'All') {
      filtered = filtered.filter(f => f.category.toLowerCase() === activeFoodCategory.toLowerCase());
    }
    if (foodSearchTerm) {
      filtered = filtered.filter(f =>
        f.name.toLowerCase().includes(foodSearchTerm) ||
        f.category.toLowerCase().includes(foodSearchTerm)
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🍎</div>
          <h3 style="color: #fff; margin-bottom: 6px;">${foods.length === 0 ? 'No foods yet' : 'No foods found'}</h3>
          <p style="color: #64748b; font-size: 0.9rem;">${foods.length === 0
            ? 'Click "+ New Food Item" to add foods and their macros.'
            : 'Try selecting a different food category or query.'}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(f => `
      <div class="food-card">
        <div class="food-header">
          <h4 class="food-title">${escapeHtml(f.name)}</h4>
          <span class="food-portion">${escapeHtml(f.serving_size)}</span>
        </div>
        <div style="display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap;">
          <span class="tag-muscle">${escapeHtml(f.category)}</span>
          ${f.is_vegetarian ? '<span class="tag-diff" style="color: #00e676; background: rgba(0,230,118,0.1);">Vegetarian</span>' : ''}
          ${f.is_vegan ? '<span class="tag-diff" style="color: #00b0ff; background: rgba(0,176,255,0.1);">Vegan</span>' : ''}
        </div>
        <div class="food-macros-row">
          <div>
            <div class="food-macro-num" style="color: var(--macro-cal);">${Math.round(f.calories)}</div>
            <div class="food-macro-sub">kcal</div>
          </div>
          <div>
            <div class="food-macro-num" style="color: var(--macro-protein);">${Number(f.protein_g).toFixed(1)}g</div>
            <div class="food-macro-sub">Protein</div>
          </div>
          <div>
            <div class="food-macro-num" style="color: var(--macro-carbs);">${Number(f.carbs_g).toFixed(1)}g</div>
            <div class="food-macro-sub">Carbs</div>
          </div>
          <div>
            <div class="food-macro-num" style="color: var(--macro-fats);">${Number(f.fats_g).toFixed(1)}g</div>
            <div class="food-macro-sub">Fats</div>
          </div>
        </div>
      </div>
    `).join('');
  }

  function renderPlans() {
    const container = document.getElementById('diet-plans-grid-container');
    if (!container) return;

    let filtered = plans;
    if (planSearchTerm) {
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(planSearchTerm) ||
        (p.description && p.description.toLowerCase().includes(planSearchTerm))
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🥗</div>
          <h3 style="color: #fff; margin-bottom: 6px;">${(plans.length === 0 && !planSearchTerm
            && (document.getElementById('filter-diet-trainer-select')?.value || 'All') === 'All'
            && (document.getElementById('filter-diet-goal-select')?.value || 'All') === 'All')
            ? 'No diet plans yet' : 'No diet plans match filters'}</h3>
          <p style="color: #64748b; font-size: 0.9rem;">Click "+ Build Diet Plan" to assemble a personalized nutrition blueprint.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(prg => `
      <div class="plan-card">
        <div style="display: flex; gap: 8px; margin-bottom: 10px;">
          <span class="tag-muscle">${escapeHtml(prg.goal)}</span>
          <span class="tag-diff">${prg.meals_count || 0} Scheduled Meals</span>
        </div>
        <h3 class="plan-title">${escapeHtml(displayPlanName(prg.name))}</h3>
        <p class="plan-desc">${escapeHtml(prg.description || 'Targeted macronutrient protocol designed for physique and recovery.')}</p>

        <div class="macro-target-chips">
          <span class="macro-chip chip-cal">🔥 ${prg.target_calories} kcal</span>
          <span class="macro-chip chip-pro">🥩 ${prg.target_protein_g}g Pro</span>
          <span class="macro-chip chip-carb">🌾 ${prg.target_carbs_g}g Carb</span>
          <span class="macro-chip chip-fat">🥑 ${prg.target_fats_g}g Fat</span>
          <span class="macro-chip chip-water">💧 ${prg.target_water_ml}ml H2O</span>
        </div>

        <div style="font-size: 0.82rem; color: #94a3b8; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <span>👤 Author:</span>
            <strong style="color: #fff; margin-left: 4px;">${escapeHtml(prg.trainer_name || 'Virtex Nutritionist')}</strong>
          </div>
          <div style="color: #00e676; font-family: 'JetBrains Mono', monospace; font-weight: 700;">
            ${prg.active_assigned_members || 0} active lifters
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: auto;">
          <button class="btn btn-outline" style="flex: 1; padding: 8px 12px; font-size: 0.82rem;" onclick="window.viewDietPlanDetails(${prg.id})">
            Meal Breakdown 🔍
          </button>
          <button class="btn btn-green" style="padding: 8px 14px; font-size: 0.82rem;" onclick="window.openAssignDietModal(${prg.id})">
            Assign +
          </button>
        </div>
      </div>
    `).join('');
  }

  function renderAssignments() {
    const tbody = document.getElementById('diet-assignments-tbody');
    if (!tbody) return;

    if (assignments.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No member diet assignments recorded. Click "Assign Member" to enroll a client.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = assignments.map(a => {
      const statusClass = a.status === 'active' ? 'badge-green' : (a.status === 'completed' ? 'badge-blue' : 'badge-gold');
      let adhClass = 'adh-high';
      if (a.avg_adherence_percent < 75) adhClass = 'adh-low';
      else if (a.avg_adherence_percent < 90) adhClass = 'adh-med';

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: #fff;">${escapeHtml(a.member_name)}</div>
            <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(a.member_code || '#' + a.member_id)}</div>
          </td>
          <td>
            <div style="font-weight: 600; color: #00e676;">${escapeHtml(displayPlanName(a.plan_name))}</div>
            <div style="font-size: 0.75rem; color: #94a3b8;">${a.target_calories} kcal • ${escapeHtml(a.goal)}</div>
          </td>
          <td>
            <span style="color: #e2e8f0; font-size: 0.85rem;">${escapeHtml(a.trainer_name || 'Nutrition Coach')}</span>
          </td>
          <td>
            <span class="adherence-badge ${adhClass}">${a.avg_adherence_percent || 0}%</span>
            <div style="font-size: 0.72rem; color: #64748b;">${a.days_logged_count || 0} days logged</div>
          </td>
          <td>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: #00e5ff; font-weight: 700;">
              ${a.avg_water_ml ? a.avg_water_ml + ' ml' : '—'}
            </div>
          </td>
          <td>
            <span class="badge ${statusClass}" style="text-transform: capitalize;">${escapeHtml(a.status)}</span>
          </td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-outline btn-xs" onclick="window.viewMemberNutritionReport(${a.member_id}, '${escapeHtml(a.member_name)}')" title="View Nutrition Report">
                Report 📈
              </button>
              ${a.status === 'active' ? `
                <button class="btn btn-outline btn-xs" style="color: #ffd600; border-color: rgba(255,214,0,0.3);" onclick="window.updateDietAssignmentStatus(${a.id}, 'completed')">
                  Complete
                </button>
              ` : `
                <button class="btn btn-outline btn-xs" style="color: #00e676; border-color: rgba(0,230,118,0.3);" onclick="window.updateDietAssignmentStatus(${a.id}, 'active')">
                  Reactivate
                </button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderDailyLogs() {
    const tbody = document.getElementById('daily-nutrition-logs-tbody');
    if (!tbody) return;

    if (dailyLogs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No daily nutrition logs logged yet. Click "Log Daily Nutrition" to register meals.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = dailyLogs.map(l => {
      let adhClass = 'adh-high';
      if (l.adherence_score < 75) adhClass = 'adh-low';
      else if (l.adherence_score < 90) adhClass = 'adh-med';

      const waterPct = Math.min(100, Math.round((l.water_intake_ml / 4000) * 100));

      return `
        <tr>
          <td>
            <span style="font-size: 0.85rem; color: #e2e8f0; font-family: 'JetBrains Mono', monospace;">
              ${new Date(l.log_date).toLocaleDateString()}
            </span>
          </td>
          <td>
            <div style="font-weight: 700; color: #fff;">${escapeHtml(l.member_name)}</div>
            <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(l.member_code)}</div>
          </td>
          <td>
            <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; color: var(--macro-cal); font-weight: 700;">
              ${Math.round(l.total_calories)} kcal
            </span>
          </td>
          <td>
            <div style="font-size: 0.82rem; font-family: 'JetBrains Mono', monospace;">
              <span style="color: var(--macro-protein); font-weight: 700;">${Math.round(l.total_protein_g)}g P</span> • 
              <span style="color: var(--macro-carbs);">${Math.round(l.total_carbs_g)}g C</span> • 
              <span style="color: var(--macro-fats);">${Math.round(l.total_fats_g)}g F</span>
            </div>
          </td>
          <td>
            <div class="water-meter-wrap" style="max-width: 160px;">
              <span style="font-size: 0.82rem; font-family: 'JetBrains Mono', monospace; color: #00e5ff; font-weight: 700;">
                ${l.water_intake_ml} ml
              </span>
              <div class="water-progress-track">
                <div class="water-progress-fill" style="width: ${waterPct}%;"></div>
              </div>
            </div>
          </td>
          <td>
            <span class="adherence-badge ${adhClass}">${l.adherence_score}%</span>
          </td>
          <td>
            <span style="font-size: 0.8rem; color: #94a3b8;">${escapeHtml(l.notes || '—')}</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderAnalytics() {
    if (!analyticsData) return;
    const { kpis, goalDistribution, foodCategories, trainerMonitoring } = analyticsData;

    // Macro & KPI Summary Box — show "—" when there is no logged data (no placeholder numbers)
    const calEl = document.getElementById('kpi-avg-calories');
    if (calEl) calEl.textContent = kpis.avgCalories ? `${kpis.avgCalories} kcal` : '— kcal';

    const proEl = document.getElementById('kpi-avg-protein');
    if (proEl) proEl.textContent = kpis.avgProteinG ? `${kpis.avgProteinG}g` : '—g';

    const waterEl = document.getElementById('kpi-avg-water');
    if (waterEl) waterEl.textContent = kpis.avgWaterMl ? `${(kpis.avgWaterMl / 1000).toFixed(1)}L` : '—L';

    const adhEl = document.getElementById('kpi-overall-adherence');
    if (adhEl) adhEl.textContent = kpis.avgAdherencePercent ? `${kpis.avgAdherencePercent}%` : '—%';

    const foodsEl = document.getElementById('kpi-total-foods');
    if (foodsEl) foodsEl.textContent = kpis.totalFoods;

    const plansEl = document.getElementById('kpi-total-diet-plans');
    if (plansEl) plansEl.textContent = kpis.totalPlans;

    // Goal Distribution
    const goalList = document.getElementById('diet-goal-distribution-list');
    if (goalList && goalDistribution) {
      goalList.innerHTML = goalDistribution.map(g => `
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
            <span style="color: #fff;">${escapeHtml(g.goal)}</span>
            <span style="color: #00e676; font-family: 'JetBrains Mono', monospace;">${g.count} plans</span>
          </div>
          <div style="height: 6px; background: #1e2433; border-radius: 3px; overflow: hidden;">
            <div style="width: ${Math.min(100, g.count * 30)}%; height: 100%; background: #00e676; border-radius: 3px;"></div>
          </div>
        </div>
      `).join('');
    }

    // Trainer Monitoring
    const trTbody = document.getElementById('trainer-diet-monitoring-tbody');
    if (trTbody && trainerMonitoring) {
      if (trainerMonitoring.length === 0) {
        trTbody.innerHTML = '<tr><td colspan="3" style="color: #64748b; text-align: center;">No active trainer diet monitoring yet.</td></tr>';
      } else {
        trTbody.innerHTML = trainerMonitoring.map(t => `
          <tr>
            <td style="font-weight: 700; color: #fff;">${escapeHtml(t.trainer_name)}</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: #00b0ff; font-weight: 700;">${t.active_clients_count} clients</td>
            <td>
              <span class="adherence-badge ${t.clients_avg_adherence >= 90 ? 'adh-high' : 'adh-med'}">
                ${t.clients_avg_adherence}% avg
              </span>
            </td>
          </tr>
        `).join('');
      }
    }
  }

  // Modals & User Actions
  function setupModalListeners() {
    // Open New Food Modal
    const btnNewFood = document.getElementById('btn-open-food-modal');
    if (btnNewFood) {
      btnNewFood.addEventListener('click', () => {
        document.getElementById('modal-new-food').classList.add('active');
      });
    }

    // Open Diet Plan Builder Modal
    const btnNewPlan = document.getElementById('btn-open-diet-plan-modal');
    if (btnNewPlan) {
      btnNewPlan.addEventListener('click', () => {
        resetDietPlanBuilder();
        document.getElementById('modal-diet-plan-builder').classList.add('active');
      });
    }

    // Open Assign Diet Modal
    const btnOpenAssign = document.getElementById('btn-open-diet-assign-modal');
    if (btnOpenAssign) {
      btnOpenAssign.addEventListener('click', () => {
        document.getElementById('modal-assign-diet-plan').classList.add('active');
      });
    }

    // Open Log Daily Nutrition Modal
    const btnOpenLog = document.getElementById('btn-open-diet-log-modal');
    if (btnOpenLog) {
      btnOpenLog.addEventListener('click', () => {
        document.getElementById('modal-log-daily-nutrition').classList.add('active');
      });
    }

    // Close buttons
    document.querySelectorAll('.workout-modal-close, .btn-modal-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.workout-modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });

    // Form Submissions
    const formNewFood = document.getElementById('form-new-food');
    if (formNewFood) formNewFood.addEventListener('submit', handleCreateFood);

    const formDietPlan = document.getElementById('form-diet-plan-builder');
    if (formDietPlan) formDietPlan.addEventListener('submit', handleCreateDietPlan);

    const formAssign = document.getElementById('form-assign-diet-plan');
    if (formAssign) formAssign.addEventListener('submit', handleAssignDietPlan);

    const formLog = document.getElementById('form-log-daily-nutrition');
    if (formLog) formLog.addEventListener('submit', handleLogDailyNutrition);

    // Add Meal to Builder
    const btnAddMeal = document.getElementById('btn-builder-add-meal');
    if (btnAddMeal) btnAddMeal.addEventListener('click', addDietBuilderMeal);
  }

  // Create Food Handler
  async function handleCreateFood(e) {
    e.preventDefault();
    const data = {
      name: document.getElementById('food-name').value.trim(),
      category: document.getElementById('food-category').value,
      serving_size: document.getElementById('food-serving-size').value.trim(),
      calories: parseFloat(document.getElementById('food-calories').value),
      protein_g: parseFloat(document.getElementById('food-protein').value),
      carbs_g: parseFloat(document.getElementById('food-carbs').value),
      fats_g: parseFloat(document.getElementById('food-fats').value),
      fiber_g: parseFloat(document.getElementById('food-fiber').value) || 0,
      is_vegetarian: document.getElementById('food-is-veg').checked,
      is_vegan: document.getElementById('food-is-vegan').checked
    };

    try {
      const res = await fetch('/api/v1/admin/diet/foods', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Food item added to database!');
        document.getElementById('modal-new-food').classList.remove('active');
        document.getElementById('form-new-food').reset();
        await loadFoods();
      } else {
        showToast(json.message || 'Failed to add food item', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving food item', 'error');
    }
  }

  // Diet Plan Builder Helpers
  let builderMealCount = 0;
  function resetDietPlanBuilder() {
    const container = document.getElementById('builder-meals-container');
    if (container) container.innerHTML = '';
    builderMealCount = 0;
    // Add default Breakfast, Lunch, Dinner, Snack
    addDietBuilderMeal('Breakfast', '08:00:00');
    addDietBuilderMeal('Lunch', '13:00:00');
    addDietBuilderMeal('Snack', '16:30:00');
    addDietBuilderMeal('Dinner', '20:30:00');
  }

  function addDietBuilderMeal(defaultName = 'Meal', defaultTime = '12:00:00') {
    builderMealCount++;
    const container = document.getElementById('builder-meals-container');
    if (!container) return;

    const mealDiv = document.createElement('div');
    mealDiv.className = 'meal-timeline-card';
    mealDiv.id = `builder-meal-${builderMealCount}`;
    mealDiv.innerHTML = `
      <div class="meal-timeline-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="text" class="form-control meal-name-input" value="${defaultName}" style="padding: 4px 8px; font-size: 0.88rem; width: 140px; font-weight: 700; color: #fff;" required>
          <input type="time" class="form-control meal-time-input" value="${defaultTime}" style="padding: 4px 8px; font-size: 0.85rem; width: 120px;" required>
        </div>
        <button type="button" class="btn btn-outline btn-xs" onclick="document.getElementById('builder-meal-${builderMealCount}').remove()" style="color: #ff5252; border-color: rgba(255,82,82,0.3);">Remove Meal</button>
      </div>
      <div class="meal-food-items-list" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
        <!-- Food item rows inserted here -->
      </div>
      <button type="button" class="btn btn-outline btn-xs" onclick="window.addFoodToMeal(${builderMealCount})">
        + Add Food to ${defaultName}
      </button>
    `;
    container.appendChild(mealDiv);
    window.addFoodToMeal(builderMealCount);
  }

  window.addFoodToMeal = function (mealNum) {
    const mealCard = document.getElementById(`builder-meal-${mealNum}`);
    if (!mealCard) return;
    const list = mealCard.querySelector('.meal-food-items-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'meal-food-row-item';
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '2fr 1fr 1fr 1fr 1fr 30px';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.background = '#0b0d14';
    row.style.padding = '8px';
    row.style.borderRadius = '6px';
    row.style.border = '1px solid #1e2433';

    const foodOptions = foods.map(f => `<option value="${f.id}" data-cal="${f.calories}" data-p="${f.protein_g}" data-c="${f.carbs_g}" data-f="${f.fats_g}">${f.name} (${f.serving_size})</option>`).join('');

    row.innerHTML = `
      <select class="form-control meal-food-select" style="padding: 5px 8px; font-size: 0.82rem;" onchange="window.updateMealRowMacros(this)" required>
        <option value="">Select Food Item</option>
        ${foodOptions}
      </select>
      <input type="text" class="form-control meal-portion-input" placeholder="Portion (e.g. 150g)" value="1 portion" style="padding: 5px 8px; font-size: 0.82rem;" required>
      <input type="number" class="form-control meal-row-cal" placeholder="kcal" value="150" style="padding: 5px 8px; font-size: 0.82rem; color: var(--macro-cal);" required>
      <input type="number" class="form-control meal-row-p" placeholder="P (g)" value="20" style="padding: 5px 8px; font-size: 0.82rem; color: var(--macro-protein);" required>
      <input type="number" class="form-control meal-row-c" placeholder="C (g)" value="15" style="padding: 5px 8px; font-size: 0.82rem; color: var(--macro-carbs);" required>
      <button type="button" style="background: transparent; border: none; color: #ff5252; cursor: pointer; font-size: 1.1rem;" onclick="this.closest('.meal-food-row-item').remove()">×</button>
    `;
    list.appendChild(row);
  };

  window.updateMealRowMacros = function (selectEl) {
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    if (!selectedOpt) return;
    const row = selectEl.closest('.meal-food-row-item');
    if (!row) return;

    const cal = selectedOpt.getAttribute('data-cal');
    const p = selectedOpt.getAttribute('data-p');
    const c = selectedOpt.getAttribute('data-c');

    if (cal) row.querySelector('.meal-row-cal').value = Math.round(cal);
    if (p) row.querySelector('.meal-row-p').value = Math.round(p);
    if (c) row.querySelector('.meal-row-c').value = Math.round(c);
  };

  // Create Diet Plan Handler
  async function handleCreateDietPlan(e) {
    e.preventDefault();
    const name = document.getElementById('diet-plan-name').value.trim();
    const trainer_id = document.getElementById('diet-builder-trainer-select').value || null;
    const goal = document.getElementById('diet-plan-goal').value;
    const target_calories = parseInt(document.getElementById('diet-target-cal').value, 10);
    const target_protein_g = parseInt(document.getElementById('diet-target-protein').value, 10);
    const target_carbs_g = parseInt(document.getElementById('diet-target-carbs').value, 10);
    const target_fats_g = parseInt(document.getElementById('diet-target-fats').value, 10);
    const target_water_ml = parseInt(document.getElementById('diet-target-water').value, 10) || 3500;
    const description = document.getElementById('diet-plan-desc').value.trim();

    const meals = [];
    document.querySelectorAll('.meal-timeline-card').forEach(mCard => {
      const mealType = mCard.querySelector('.meal-name-input')?.value || 'Meal';
      const scheduledTime = mCard.querySelector('.meal-time-input')?.value || '12:00:00';
      const foodRows = mCard.querySelectorAll('.meal-food-row-item');
      const items = [];

      foodRows.forEach(row => {
        const foodId = row.querySelector('.meal-food-select')?.value;
        const portion = row.querySelector('.meal-portion-input')?.value || '1 portion';
        const cal = parseFloat(row.querySelector('.meal-row-cal')?.value) || 0;
        const p = parseFloat(row.querySelector('.meal-row-p')?.value) || 0;
        const c = parseFloat(row.querySelector('.meal-row-c')?.value) || 0;

        if (foodId) {
          items.push({
            food_item_id: parseInt(foodId, 10),
            servings: 1.0,
            custom_portion: portion,
            calories: cal,
            protein_g: p,
            carbs_g: c,
            fats_g: 5.0
          });
        }
      });

      meals.push({
        meal_type: mealType,
        scheduled_time: scheduledTime,
        items
      });
    });

    try {
      const res = await fetch('/api/v1/admin/diet/plans', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name,
          trainer_id,
          goal,
          target_calories,
          target_protein_g,
          target_carbs_g,
          target_fats_g,
          target_water_ml,
          description,
          is_template: true,
          meals
        })
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Diet plan created successfully!');
        document.getElementById('modal-diet-plan-builder').classList.remove('active');
        await loadPlans();
      } else {
        showToast(json.message || 'Failed to create diet plan', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving diet plan', 'error');
    }
  }

  // Handle Assign Diet Plan
  async function handleAssignDietPlan(e) {
    e.preventDefault();
    const data = {
      member_id: parseInt(document.getElementById('assign-diet-member-select').value, 10),
      plan_id: parseInt(document.getElementById('assign-diet-plan-select').value, 10),
      assigned_by_trainer_id: document.getElementById('assign-diet-trainer-select').value || null,
      start_date: document.getElementById('assign-diet-start-date').value || null,
      notes: document.getElementById('assign-diet-notes').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/diet/assignments', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Diet plan assigned to member successfully!');
        document.getElementById('modal-assign-diet-plan').classList.remove('active');
        document.getElementById('form-assign-diet-plan').reset();
        await loadAssignments();
      } else {
        showToast(json.message || 'Failed to assign diet plan', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error assigning diet plan', 'error');
    }
  }

  // Handle Log Daily Nutrition
  async function handleLogDailyNutrition(e) {
    e.preventDefault();
    const data = {
      member_id: parseInt(document.getElementById('log-diet-member-select').value, 10),
      log_date: document.getElementById('log-diet-date').value || null,
      total_calories: parseFloat(document.getElementById('log-diet-cal').value) || 0,
      total_protein_g: parseFloat(document.getElementById('log-diet-protein').value) || 0,
      total_carbs_g: parseFloat(document.getElementById('log-diet-carbs').value) || 0,
      total_fats_g: parseFloat(document.getElementById('log-diet-fats').value) || 0,
      water_intake_ml: parseInt(document.getElementById('log-diet-water').value, 10) || 0,
      adherence_score: parseInt(document.getElementById('log-diet-adherence').value, 10) || 95,
      notes: document.getElementById('log-diet-notes').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/diet/logs', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Daily nutrition and water recorded successfully!');
        document.getElementById('modal-log-daily-nutrition').classList.remove('active');
        document.getElementById('form-log-daily-nutrition').reset();
        await Promise.all([loadDailyLogs(), loadAnalytics()]);
      } else {
        showToast(json.message || 'Failed to record log', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error recording nutrition log', 'error');
    }
  }

  // Global window functions
  window.viewDietPlanDetails = async function (id) {
    try {
      const res = await fetch(`/api/v1/admin/diet/plans/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const plan = json.data;

      const modal = document.getElementById('modal-view-diet-schedule');
      if (!modal) return;

      document.getElementById('view-diet-plan-title').textContent = `${displayPlanName(plan.name)} (${plan.goal})`;
      document.getElementById('view-diet-plan-macros').innerHTML = `
        <span class="macro-chip chip-cal">🔥 ${plan.target_calories} kcal</span>
        <span class="macro-chip chip-pro">🥩 ${plan.target_protein_g}g Protein</span>
        <span class="macro-chip chip-carb">🌾 ${plan.target_carbs_g}g Carbs</span>
        <span class="macro-chip chip-fat">🥑 ${plan.target_fats_g}g Fat</span>
        <span class="macro-chip chip-water">💧 ${plan.target_water_ml}ml H2O</span>
      `;

      const container = document.getElementById('view-diet-plan-meals');
      container.innerHTML = '';

      if (!plan.meals || plan.meals.length === 0) {
        container.innerHTML = '<p style="color: #64748b; padding: 1rem;">No meal schedule configured yet for this plan.</p>';
      } else {
        plan.meals.forEach(m => {
          const mCard = document.createElement('div');
          mCard.className = 'meal-timeline-card';
          mCard.innerHTML = `
            <div class="meal-timeline-header">
              <span class="meal-timeline-title">
                <span style="color: #00e676;">🍽️ ${escapeHtml(m.meal_type)}</span>
                <span style="font-size: 0.8rem; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">⏰ ${m.scheduled_time || 'Scheduled'}</span>
              </span>
              <span style="font-size: 0.78rem; color: #64748b;">${escapeHtml(m.notes || '')}</span>
            </div>
            <table class="exercise-table">
              <thead>
                <tr>
                  <th>Food Item</th>
                  <th>Portion</th>
                  <th>Calories</th>
                  <th>Protein</th>
                  <th>Carbs</th>
                </tr>
              </thead>
              <tbody>
                ${m.items && m.items.length > 0 ? m.items.map(it => `
                  <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(it.food_name)}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; color: #94a3b8;">${escapeHtml(it.custom_portion || '1 serving')}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; color: var(--macro-cal); font-weight: 700;">${Math.round(it.calories)} kcal</td>
                    <td style="font-family: 'JetBrains Mono', monospace; color: var(--macro-protein);">${Number(it.protein_g).toFixed(1)}g</td>
                    <td style="font-family: 'JetBrains Mono', monospace; color: var(--macro-carbs);">${Number(it.carbs_g).toFixed(1)}g</td>
                  </tr>
                `).join('') : '<tr><td colspan="5" style="color: #64748b;">No food items listed for this meal.</td></tr>'}
              </tbody>
            </table>
          `;
          container.appendChild(mCard);
        });
      }

      modal.classList.add('active');
    } catch (err) {
      console.error(err);
      showToast('Failed to load diet plan details', 'error');
    }
  };

  window.openAssignDietModal = function (planId) {
    const modal = document.getElementById('modal-assign-diet-plan');
    if (!modal) return;
    const select = document.getElementById('assign-diet-plan-select');
    if (select) select.value = planId;
    modal.classList.add('active');
  };

  window.updateDietAssignmentStatus = async function (id, status) {
    try {
      const res = await fetch(`/api/v1/admin/diet/assignments/${id}/status`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        showToast(`Assignment status updated to ${status}`);
        await loadAssignments();
      } else {
        showToast('Failed to update status', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error updating assignment status', 'error');
    }
  };

  window.viewMemberNutritionReport = async function (memberId, memberName) {
    try {
      const res = await fetch(`/api/v1/admin/diet/logs?member_id=${memberId}&limit=14`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const logs = json.data || [];

      const modal = document.getElementById('modal-member-nutrition-report');
      if (!modal) return;

      document.getElementById('report-member-name').textContent = memberName || `Member #${memberId}`;
      const tbody = document.getElementById('report-member-logs-tbody');
      tbody.innerHTML = '';

      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color: #64748b; text-align: center;">No daily nutrition records logged yet.</td></tr>';
      } else {
        tbody.innerHTML = logs.map(l => `
          <tr>
            <td style="font-family: 'JetBrains Mono', monospace; color: #fff;">${new Date(l.log_date).toLocaleDateString()}</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: var(--macro-cal); font-weight: 700;">${Math.round(l.total_calories)} kcal</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: var(--macro-protein);">${Math.round(l.total_protein_g)}g</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: var(--macro-carbs);">${Math.round(l.total_carbs_g)}g</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: #00e5ff; font-weight: 700;">${l.water_intake_ml} ml</td>
            <td><span class="adherence-badge ${l.adherence_score >= 90 ? 'adh-high' : 'adh-med'}">${l.adherence_score}%</span></td>
          </tr>
        `).join('');
      }

      modal.classList.add('active');
    } catch (err) {
      console.error(err);
      showToast('Failed to load member nutrition report', 'error');
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

