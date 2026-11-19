/**
 * Virtex Admin - Recovery and Wellness Controller
 * Manages muscle soreness tracking, sleep analytics, fatigue index, rest-day scheduling,
 * and trainer client monitoring.
 * Notice: Non-medical athletic wellness and lifestyle monitoring.
 */

(function () {
  'use strict';

  // Global State
  let recoveryLogs = [];
  let trainerClients = [];
  let heatmapData = [];
  let kpisData = null;
  let membersList = [];
  let trainersList = [];

  let currentTab = 'logs';
  let activeReadinessFilter = 'All';
  let selectedHeatmapMemberId = null;

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
    toast.className = `recovery-toast toast-${type}`;
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
      loadRecoveryLogs(),
      loadTrainerOverview(),
      loadKpis()
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
    const selects = ['log-recovery-member-select', 'heatmap-member-select', 'review-member-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Select Member --</option>' +
          membersList.map(m => `<option value="${m.id}">${m.full_name || m.name} (${m.member_code || '#' + m.id})</option>`).join('');
      }
    });

    if (membersList.length > 0 && !selectedHeatmapMemberId) {
      selectedHeatmapMemberId = membersList[0].id;
      const hmSelect = document.getElementById('heatmap-member-select');
      if (hmSelect) hmSelect.value = selectedHeatmapMemberId;
      loadHeatmap(selectedHeatmapMemberId);
    }
  }

  function populateTrainerDropdowns() {
    const selects = ['filter-recovery-trainer-select', 'review-trainer-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const isFilter = id === 'filter-recovery-trainer-select';
        el.innerHTML = (isFilter ? '<option value="All">All Trainers</option>' : '<option value="">-- Select Coach --</option>') +
          trainersList.map(t => `<option value="${t.id}">${t.full_name || t.name} (${t.specialty || 'Trainer'})</option>`).join('');
      }
    });
  }

  // Tab Navigation
  function checkUrlHashTab() {
    const hash = window.location.hash.toLowerCase().replace('#', '');
    if (!hash) return;
    const tabMap = {
      'soreness': 'heatmap',
      'heatmap': 'heatmap',
      'zones': 'zones',
      'logs': 'logs',
      'trainer': 'trainer',
      'trends': 'trends'
    };
    const target = tabMap[hash];
    if (target) {
      const btn = document.querySelector(`.recovery-tab-btn[data-tab="${target}"]`);
      if (btn) btn.click();
    }
  }

  function setupTabListeners() {
    const tabs = document.querySelectorAll('.recovery-tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.getAttribute('data-tab');

        document.querySelectorAll('.recovery-tab-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById(`rec-tab-${currentTab}`);
        if (target) target.style.display = 'block';
      });
    });

    window.addEventListener('hashchange', checkUrlHashTab);
    checkUrlHashTab();
  }

  // Filters & Search
  function setupFilterListeners() {
    const statusFilter = document.getElementById('filter-readiness-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        activeReadinessFilter = e.target.value;
        loadRecoveryLogs(activeReadinessFilter);
      });
    }

    const hmMemberSelect = document.getElementById('heatmap-member-select');
    if (hmMemberSelect) {
      hmMemberSelect.addEventListener('change', (e) => {
        selectedHeatmapMemberId = e.target.value;
        if (selectedHeatmapMemberId) {
          loadHeatmap(selectedHeatmapMemberId);
        }
      });
    }

    const trFilter = document.getElementById('filter-recovery-trainer-select');
    if (trFilter) {
      trFilter.addEventListener('change', (e) => {
        loadTrainerOverview(e.target.value);
      });
    }
  }

  // API Callers
  async function loadRecoveryLogs(status = 'All') {
    try {
      let url = '/api/v1/admin/recovery/logs';
      if (status && status !== 'All') url += `?readiness_status=${encodeURIComponent(status)}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        recoveryLogs = json.data || [];
        const badge = document.getElementById('badge-recovery-logs-count');
        if (badge) badge.textContent = recoveryLogs.length;
        renderRecoveryLogs();
      }
    } catch (err) {
      console.error('Failed to load recovery logs:', err);
    }
  }

  async function loadTrainerOverview(trainerId = 'All') {
    try {
      let url = '/api/v1/admin/recovery/trainer-overview';
      if (trainerId && trainerId !== 'All') url += `?trainer_id=${encodeURIComponent(trainerId)}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        trainerClients = json.data || [];
        const badge = document.getElementById('badge-trainer-clients-count');
        if (badge) badge.textContent = trainerClients.length;
        renderTrainerOverview();
      }
    } catch (err) {
      console.error('Failed to load trainer overview:', err);
    }
  }

  async function loadHeatmap(memberId) {
    try {
      const res = await fetch(`/api/v1/admin/recovery/soreness/${memberId}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        heatmapData = json.data || [];
        renderHeatmap();
      }
    } catch (err) {
      console.error('Failed to load soreness heatmap:', err);
    }
  }

  async function loadKpis() {
    try {
      const res = await fetch('/api/v1/admin/recovery/kpis', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        kpisData = json.data || null;
        renderKpis();
      }
    } catch (err) {
      console.error('Failed to load recovery KPIs:', err);
    }
  }

  // Render Functions
  function renderKpis() {
    if (!kpisData) return;
    const { kpis, statusDistribution } = kpisData;

    // Show "—" when nothing has been logged yet (no placeholder numbers; DB may return "0" strings)
    const hasVal = (v) => v !== null && v !== undefined && Number(v) !== 0 && !Number.isNaN(Number(v));
    const tracked = Number(kpis.total_tracked_members) || 0;

    const rdEl = document.getElementById('kpi-avg-readiness');
    if (rdEl) rdEl.textContent = hasVal(kpis.avg_gym_readiness) ? `${Number(kpis.avg_gym_readiness)}%` : '—%';

    const slEl = document.getElementById('kpi-avg-sleep');
    if (slEl) slEl.textContent = hasVal(kpis.avg_sleep_hours) ? `${Number(kpis.avg_sleep_hours)} hrs` : '— hrs';

    const restEl = document.getElementById('kpi-rest-days-week');
    if (restEl) restEl.textContent = tracked ? (Number(kpis.rest_days_last_7_days) || 0) : '—';

    const memEl = document.getElementById('kpi-tracked-members');
    if (memEl) memEl.textContent = tracked || '—';

    // Status distribution
    const distContainer = document.getElementById('recovery-status-distribution');
    if (distContainer && statusDistribution) {
      distContainer.innerHTML = statusDistribution.map(s => {
        let pillClass = 'pill-good';
        if (s.readiness_status === 'Optimal') pillClass = 'pill-optimal';
        else if (s.readiness_status === 'Moderate') pillClass = 'pill-moderate';
        else if (s.readiness_status === 'Needs Recovery') pillClass = 'pill-fatigue';

        return `
          <div style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
              <span class="readiness-pill ${pillClass}" style="font-size: 0.78rem; padding: 2px 8px;">${escapeHtml(s.readiness_status)}</span>
              <span style="color: #fff; font-family: 'JetBrains Mono', monospace;">${s.count} logs</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  function renderRecoveryLogs() {
    const tbody = document.getElementById('recovery-logs-tbody');
    if (!tbody) return;

    if (recoveryLogs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No recovery assessments found. Click "Log Recovery Assessment" to register daily wellness.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = recoveryLogs.map(l => {
      let pillClass = 'pill-good';
      if (l.readiness_status === 'Optimal') pillClass = 'pill-optimal';
      else if (l.readiness_status === 'Moderate') pillClass = 'pill-moderate';
      else if (l.readiness_status === 'Needs Recovery') pillClass = 'pill-fatigue';

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
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div>
                <span class="tag-user-reported">User-Reported</span>
              </div>
              <div style="font-size: 0.82rem; color: #cbd5e1; font-family: 'JetBrains Mono', monospace;">
                😴 ${l.sleep_hours}h (Q: ${l.sleep_quality}/10) • ⚡ Eng: ${l.energy_level ?? '—'}/10 • ⚡ Str: ${l.stress_level ?? '—'}/10
              </div>
              ${l.fatigue_level != null || l.self_assessment ? `<div style="font-size: 0.78rem; color: #94a3b8;">Fatigue: <strong style="color:#e2e8f0;">${l.fatigue_level ?? '—'}/10</strong>${l.self_assessment ? ` • Self-assessed: <strong style="color:#e2e8f0;">${escapeHtml(({ fully_recovered: 'Fully recovered', mostly_recovered: 'Mostly recovered', partly_recovered: 'Partly recovered', not_recovered: 'Not recovered' })[l.self_assessment] || l.self_assessment)}</strong>` : ''}</div>` : ''}
              <div style="font-size: 0.78rem; color: #94a3b8;">
                Soreness: <strong style="color: #ffd600;">${l.overall_soreness_rating}/10</strong>
                ${l.is_rest_day ? ' • <span style="color: #00e676;">Rest Day: ' + escapeHtml(l.rest_day_activity || 'Rest') + '</span>' : ''}
              </div>
            </div>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div>
                <span class="tag-calculated">System-Calculated</span>
              </div>
              ${l.readiness_score == null
                ? '<span style="font-size: 0.8rem; color: #94a3b8;">Not calculated — member self-report only</span>'
                : `<span class="readiness-pill ${pillClass}">${l.readiness_score}% (${escapeHtml(l.readiness_status)})</span>
              <div style="font-size: 0.75rem; color: #94a3b8;">Fatigue Index: ${l.fatigue_index ?? '—'}%</div>`}
            </div>
          </td>
          <td>
            <span style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.4;">
              ${l.readiness_score == null ? '—' : escapeHtml(l.recommended_action || 'Standard training.')}
            </span>
          </td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-outline btn-xs" onclick="window.viewMemberRecoveryDetails(${l.id})">
                Details 🔍
              </button>
              <button class="btn btn-outline btn-xs" style="color: #00e676; border-color: rgba(0,230,118,0.3);" onclick="window.openMemberTrendReport(${l.member_id}, '${escapeHtml(l.member_name)}')">
                Trends 📈
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderHeatmap() {
    const grid = document.getElementById('soreness-heatmap-container');
    if (!grid) return;

    if (heatmapData.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; background: #11141e; border-radius: 10px; border: 1px dashed #1e2433;">
          <div style="font-size: 2rem; margin-bottom: 8px;">🧘</div>
          <h4 style="color: #fff; margin-bottom: 4px;">No muscle soreness logged for this member</h4>
          <p style="color: #64748b; font-size: 0.85rem;">Select another member or log a new recovery assessment.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = heatmapData.map(item => {
      let fillClass = 'soreness-fill-0';
      let statusColor = '#64748b';
      let statusText = 'Fully Rested';

      if (item.soreness_level >= 7) {
        fillClass = 'soreness-fill-high';
        statusColor = '#ff5252';
        statusText = 'Severe DOMS / High Tightness';
      } else if (item.soreness_level >= 4) {
        fillClass = 'soreness-fill-med';
        statusColor = '#ffd600';
        statusText = 'Moderate Soreness';
      } else if (item.soreness_level >= 1) {
        fillClass = 'soreness-fill-mild';
        statusColor = '#00e676';
        statusText = 'Mild Tension';
      }

      return `
        <div class="soreness-muscle-card">
          <div class="soreness-muscle-header">
            <span class="soreness-muscle-title">${escapeHtml(item.muscle_group)}</span>
            <span style="font-family: 'JetBrains Mono', monospace; font-weight: 800; color: ${statusColor};">
              ${item.soreness_level}/10
            </span>
          </div>
          <div class="soreness-meter-track">
            <div class="soreness-meter-fill ${fillClass}" style="width: ${item.soreness_level * 10}%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #64748b;">
            <span style="color: ${statusColor}; font-weight: 600;">${statusText}</span>
            <span>${item.notes ? escapeHtml(item.notes) : ''}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderTrainerOverview() {
    const grid = document.getElementById('trainer-clients-grid');
    if (!grid) return;

    if (trainerClients.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; background: #11141e; border-radius: 10px; border: 1px dashed #1e2433;">
          <div style="font-size: 2rem; margin-bottom: 8px;">🏋️</div>
          <h4 style="color: #fff; margin-bottom: 4px;">No personal training clients found</h4>
          <p style="color: #64748b; font-size: 0.85rem;">Ensure members are assigned to personal trainers in the Trainer module.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = trainerClients.map(c => {
      let pillClass = 'pill-good';
      if (c.readiness_status === 'Optimal') pillClass = 'pill-optimal';
      else if (c.readiness_status === 'Moderate') pillClass = 'pill-moderate';
      else if (c.readiness_status === 'Needs Recovery') pillClass = 'pill-fatigue';

      return `
        <div class="trainer-client-card">
          <div class="client-header">
            <div>
              <h4 class="client-name">${escapeHtml(c.member_name)}</h4>
              <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">
                ${escapeHtml(c.member_code)} • Coach: ${escapeHtml(c.trainer_name)}
              </div>
            </div>
            <span class="readiness-pill ${pillClass}">
              ${c.readiness_score || 0}%
            </span>
          </div>

          <div class="client-metrics-grid">
            <div>
              <div class="client-metric-val" style="color: #00b0ff;">${c.sleep_hours || 0}h</div>
              <div class="client-metric-lbl">Sleep Hours</div>
            </div>
            <div>
              <div class="client-metric-val" style="color: #ffd600;">${c.overall_soreness_rating || 0}/10</div>
              <div class="client-metric-lbl">Soreness</div>
            </div>
            <div>
              <div class="client-metric-val" style="color: #b388ff;">${c.fatigue_index || 0}%</div>
              <div class="client-metric-lbl">Fatigue Index</div>
            </div>
          </div>

          <div style="font-size: 0.82rem; color: #cbd5e1; margin-bottom: 12px; background: #0b0d14; padding: 8px 12px; border-radius: 6px; border: 1px solid #1e2433;">
            <div style="font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 700; margin-bottom: 2px;">Latest Coach Advice:</div>
            <div>${escapeHtml(c.trainer_advice || 'Monitoring physical load and recovery metrics.')}</div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: auto;">
            <button class="btn btn-outline" style="flex: 1; padding: 6px 10px; font-size: 0.8rem;" onclick="window.openTrainerReviewModal(${c.member_id}, ${c.trainer_id}, '${escapeHtml(c.member_name)}')">
              Prescribe Advice ✍️
            </button>
            <button class="btn btn-green btn-xs" style="padding: 6px 12px; font-size: 0.8rem;" onclick="window.openMemberTrendReport(${c.member_id}, '${escapeHtml(c.member_name)}')">
              Report 📈
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Modals & User Actions
  function setupModalListeners() {
    // Open Log Recovery Assessment Modal
    const btnOpenLog = document.getElementById('btn-open-recovery-log-modal');
    if (btnOpenLog) {
      btnOpenLog.addEventListener('click', () => {
        resetRecoveryLogForm();
        document.getElementById('modal-log-recovery').classList.add('active');
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
    const formLog = document.getElementById('form-log-recovery');
    if (formLog) formLog.addEventListener('submit', handleLogRecovery);

    const formReview = document.getElementById('form-trainer-review');
    if (formReview) formReview.addEventListener('submit', handleTrainerReview);

    // Dynamic Soreness Row
    const btnAddSoreness = document.getElementById('btn-add-soreness-row');
    if (btnAddSoreness) {
      btnAddSoreness.addEventListener('click', addSorenessInputRow);
    }
  }

  function resetRecoveryLogForm() {
    const list = document.getElementById('soreness-inputs-list');
    if (list) list.innerHTML = '';
    addSorenessInputRow('Quadriceps', 3);
    addSorenessInputRow('Chest', 2);
  }

  function addSorenessInputRow(defaultMuscle = 'Quadriceps', defaultLevel = 2) {
    const list = document.getElementById('soreness-inputs-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'soreness-input-row';
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '2fr 1fr 2fr 30px';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.background = '#0b0d14';
    row.style.padding = '8px';
    row.style.borderRadius = '6px';
    row.style.border = '1px solid #1e2433';

    const muscles = ['Quadriceps', 'Hamstrings', 'Glutes', 'Chest', 'Upper Back', 'Lower Back', 'Shoulders', 'Arms', 'Calves', 'Core'];
    const options = muscles.map(m => `<option value="${m}" ${m === defaultMuscle ? 'selected' : ''}>${m}</option>`).join('');

    row.innerHTML = `
      <select class="form-control soreness-muscle-select" style="padding: 5px 8px; font-size: 0.82rem;" required>
        ${options}
      </select>
      <input type="number" class="form-control soreness-level-input" placeholder="0-10" value="${defaultLevel}" min="0" max="10" style="padding: 5px 8px; font-size: 0.82rem;" required>
      <input type="text" class="form-control soreness-notes-input" placeholder="Notes (e.g. DOMS)" style="padding: 5px 8px; font-size: 0.82rem;">
      <button type="button" style="background: transparent; border: none; color: #ff5252; cursor: pointer; font-size: 1.1rem;" onclick="this.closest('.soreness-input-row').remove()">×</button>
    `;
    list.appendChild(row);
  }

  // Handle Log Recovery
  async function handleLogRecovery(e) {
    e.preventDefault();
    const member_id = parseInt(document.getElementById('log-recovery-member-select').value, 10);
    const log_date = document.getElementById('log-recovery-date').value || null;
    const sleep_hours = parseFloat(document.getElementById('log-sleep-hours').value);
    const sleep_quality = parseInt(document.getElementById('log-sleep-quality').value, 10);
    const energy_level = parseInt(document.getElementById('log-energy-level').value, 10);
    const stress_level = parseInt(document.getElementById('log-stress-level').value, 10);
    const hydration_liters = parseFloat(document.getElementById('log-hydration-liters').value) || 3.0;
    const overall_soreness_rating = parseInt(document.getElementById('log-overall-soreness').value, 10);
    const is_rest_day = document.getElementById('log-is-rest-day').checked;
    const rest_day_activity = document.getElementById('log-rest-activity').value.trim() || null;
    const user_notes = document.getElementById('log-recovery-notes').value.trim();

    const sorenessItems = [];
    document.querySelectorAll('.soreness-input-row').forEach(row => {
      const muscle = row.querySelector('.soreness-muscle-select')?.value;
      const level = row.querySelector('.soreness-level-input')?.value;
      const notes = row.querySelector('.soreness-notes-input')?.value;
      if (muscle) {
        sorenessItems.push({
          muscle_group: muscle,
          soreness_level: parseInt(level, 10) || 0,
          notes: notes || ''
        });
      }
    });

    try {
      const res = await fetch('/api/v1/admin/recovery/logs', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          member_id,
          log_date,
          sleep_hours,
          sleep_quality,
          energy_level,
          stress_level,
          hydration_liters,
          overall_soreness_rating,
          is_rest_day,
          rest_day_activity,
          user_notes,
          sorenessItems
        })
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Recovery assessment recorded successfully!');
        document.getElementById('modal-log-recovery').classList.remove('active');
        document.getElementById('form-log-recovery').reset();
        await Promise.all([loadRecoveryLogs(), loadKpis(), loadTrainerOverview()]);
      } else {
        showToast(json.message || 'Failed to save recovery log', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error recording recovery assessment', 'error');
    }
  }

  // Handle Trainer Review Advice
  async function handleTrainerReview(e) {
    e.preventDefault();
    const data = {
      member_id: parseInt(document.getElementById('review-member-select').value, 10),
      trainer_id: parseInt(document.getElementById('review-trainer-select').value, 10) || null,
      fatigue_risk_level: document.getElementById('review-risk-level').value,
      suggested_rest_days: parseInt(document.getElementById('review-suggested-rest').value, 10) || 1,
      trainer_advice: document.getElementById('review-advice-text').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/recovery/trainer-reviews', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Trainer recovery prescription saved!');
        document.getElementById('modal-trainer-review').classList.remove('active');
        document.getElementById('form-trainer-review').reset();
        await loadTrainerOverview();
      } else {
        showToast(json.message || 'Failed to save review', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving trainer advice', 'error');
    }
  }

  // Global window functions
  window.viewMemberRecoveryDetails = async function (id) {
    try {
      const res = await fetch(`/api/v1/admin/recovery/logs/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const log = json.data;

      const modal = document.getElementById('modal-view-recovery-detail');
      if (!modal) return;

      document.getElementById('view-rec-member').textContent = `${log.member_name} (${log.member_code})`;
      document.getElementById('view-rec-date').textContent = new Date(log.log_date).toLocaleDateString();
      document.getElementById('view-rec-sleep').textContent = `${log.sleep_hours} hrs (Quality: ${log.sleep_quality}/10)`;
      document.getElementById('view-rec-energy').textContent = log.energy_level == null ? 'Not recorded' : `${log.energy_level}/10`;
      document.getElementById('view-rec-stress').textContent = log.stress_level == null ? 'Not recorded' : `${log.stress_level}/10`;
      document.getElementById('view-rec-hydration').textContent = log.hydration_liters == null ? 'Not recorded' : `${log.hydration_liters} Liters`;
      document.getElementById('view-rec-readiness').textContent = log.readiness_score == null ? 'Not calculated (member self-report)' : `${log.readiness_score}% (${log.readiness_status})`;
      document.getElementById('view-rec-fatigue').textContent = log.fatigue_index == null ? (log.fatigue_level == null ? '—' : `Member-reported fatigue: ${log.fatigue_level}/10`) : `${log.fatigue_index}%`;
      document.getElementById('view-rec-action').textContent = log.readiness_score == null ? '—' : (log.recommended_action || 'Standard workouts.');
      document.getElementById('view-rec-notes').textContent = log.user_notes || 'No notes logged.';

      const tbody = document.getElementById('view-rec-soreness-tbody');
      tbody.innerHTML = '';
      if (!log.soreness_details || log.soreness_details.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="color: #64748b; text-align: center;">No specific muscle soreness reported.</td></tr>';
      } else {
        tbody.innerHTML = log.soreness_details.map(s => `
          <tr>
            <td style="font-weight: 700; color: #fff;">${escapeHtml(s.muscle_group)}</td>
            <td style="font-family: 'JetBrains Mono', monospace; font-weight: 800; color: ${s.soreness_level >= 7 ? '#ff5252' : (s.soreness_level >= 4 ? '#ffd600' : '#00e676')};">
              ${s.soreness_level}/10
            </td>
            <td style="font-size: 0.8rem; color: #94a3b8;">${escapeHtml(s.notes || '—')}</td>
          </tr>
        `).join('');
      }

      modal.classList.add('active');
    } catch (err) {
      console.error(err);
      showToast('Failed to load log details', 'error');
    }
  };

  window.openMemberTrendReport = async function (memberId, memberName) {
    try {
      const res = await fetch(`/api/v1/admin/recovery/report/${memberId}?days=14`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const { summary, dailyLogs } = json.data;

      const modal = document.getElementById('modal-member-trend-report');
      if (!modal) return;

      document.getElementById('report-trend-member-name').textContent = memberName || `Member #${memberId}`;
      document.getElementById('rep-avg-readiness').textContent = `${summary.avg_readiness_score || 0}%`;
      document.getElementById('rep-avg-sleep').textContent = `${summary.avg_sleep_hours || 0}h`;
      document.getElementById('rep-rest-days').textContent = `${summary.rest_days_count || 0} days`;
      document.getElementById('rep-avg-soreness').textContent = `${summary.avg_soreness_rating || 0}/10`;

      const tbody = document.getElementById('report-trend-logs-tbody');
      tbody.innerHTML = '';

      if (!dailyLogs || dailyLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color: #64748b; text-align: center;">No recovery trends recorded yet.</td></tr>';
      } else {
        tbody.innerHTML = dailyLogs.map(l => {
          let pillClass = 'pill-good';
          if (l.readiness_status === 'Optimal') pillClass = 'pill-optimal';
          else if (l.readiness_status === 'Moderate') pillClass = 'pill-moderate';
          else if (l.readiness_status === 'Needs Recovery') pillClass = 'pill-fatigue';

          return `
            <tr>
              <td style="font-family: 'JetBrains Mono', monospace; color: #fff;">${new Date(l.log_date).toLocaleDateString()}</td>
              <td><span class="readiness-pill ${pillClass}" style="font-size: 0.75rem; padding: 2px 6px;">${l.readiness_score}%</span></td>
              <td style="font-family: 'JetBrains Mono', monospace; color: #00b0ff;">${l.sleep_hours}h (Q: ${l.sleep_quality}/10)</td>
              <td style="font-family: 'JetBrains Mono', monospace; color: #ffd600;">${l.overall_soreness_rating}/10</td>
              <td style="font-family: 'JetBrains Mono', monospace; color: #b388ff;">${l.fatigue_index}%</td>
              <td>${l.is_rest_day ? '<span style="color: #00e676; font-weight: 700;">Rest Day</span>' : '<span style="color: #64748b;">Training</span>'}</td>
            </tr>
          `;
        }).join('');
      }

      modal.classList.add('active');
    } catch (err) {
      console.error(err);
      showToast('Failed to load recovery trend report', 'error');
    }
  };

  window.openTrainerReviewModal = function (memberId, trainerId, memberName) {
    const modal = document.getElementById('modal-trainer-review');
    if (!modal) return;
    const memSelect = document.getElementById('review-member-select');
    if (memSelect) memSelect.value = memberId;
    const trSelect = document.getElementById('review-trainer-select');
    if (trSelect && trainerId) trSelect.value = trainerId;
    modal.classList.add('active');
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

