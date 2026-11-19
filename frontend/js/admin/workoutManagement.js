/**
 * Virtex Admin - Workout & Training Management Controller
 * Handles Program Builder, Exercise Library, Member Assignments, Session Logs, and Analytics.
 */

(function () {
  'use strict';

  // Global State
  let exercises = [];
  let programs = [];
  let assignments = [];
  let sessionLogs = [];
  let analyticsData = null;
  let membersList = [];
  let trainersList = [];

  let currentTab = 'programs';
  let activeMuscleFilter = 'All';
  let exerciseSearchTerm = '';
  let programSearchTerm = '';

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
    toast.className = `workout-toast toast-${type}`;
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
      loadExercises(),
      loadPrograms(),
      loadAssignments(),
      loadSessionLogs(),
      loadAnalytics()
    ]);
  }

  // Load Members and Trainers for Select Dropdowns
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
    const selects = ['assign-member-select', 'log-member-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Member --</option>' +
          membersList.map(m => `<option value="${m.id}">${m.full_name || m.name} (${m.member_code || '#' + m.id})</option>`).join('');
      }
    });
  }

  function populateTrainerDropdowns() {
    const selects = ['builder-trainer-select', 'assign-trainer-select', 'filter-trainer-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const isFilter = id === 'filter-trainer-select';
        el.innerHTML = (isFilter ? '<option value="All">All Trainers</option>' : '<option value="">-- Select Trainer --</option>') +
          trainersList.map(t => `<option value="${t.id}">${t.full_name || t.name} (${t.specialty || 'Trainer'})</option>`).join('');
      }
    });
  }

  // Tab Navigation
  function setupTabListeners() {
    const tabs = document.querySelectorAll('.workout-tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.getAttribute('data-tab');

        document.querySelectorAll('.workout-tab-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById(`tab-${currentTab}`);
        if (target) target.style.display = 'block';
      });
    });

    function checkWorkoutHash() {
      let hash = window.location.hash ? window.location.hash.replace('#', '').toLowerCase() : '';
      if (hash === 'logs') hash = 'sessions';
      const targetBtn = document.querySelector(`.workout-tab-btn[data-tab="${hash}"]`);
      if (targetBtn) targetBtn.click();
    }
    checkWorkoutHash();
    window.addEventListener('hashchange', checkWorkoutHash);
  }

  // Filters & Search
  function setupFilterListeners() {
    // Muscle Group Pills
    document.querySelectorAll('.filter-pill[data-muscle]').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill[data-muscle]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeMuscleFilter = pill.getAttribute('data-muscle');
        renderExercises();
      });
    });

    // Exercise Search
    const exSearch = document.getElementById('exercise-search-input');
    if (exSearch) {
      exSearch.addEventListener('input', (e) => {
        exerciseSearchTerm = e.target.value.toLowerCase();
        renderExercises();
      });
    }

    // Program Search & Filter
    const prgSearch = document.getElementById('program-search-input');
    if (prgSearch) {
      prgSearch.addEventListener('input', (e) => {
        programSearchTerm = e.target.value.toLowerCase();
        renderPrograms();
      });
    }

    const trFilter = document.getElementById('filter-trainer-select');
    if (trFilter) {
      trFilter.addEventListener('change', () => {
        loadPrograms();
      });
    }

    const goalFilter = document.getElementById('filter-goal-select');
    if (goalFilter) {
      goalFilter.addEventListener('change', () => {
        loadPrograms();
      });
    }

    const splitFilter = document.getElementById('filter-split-select');
    if (splitFilter) {
      splitFilter.addEventListener('change', () => {
        loadPrograms();
      });
    }

    // Assignment Status Filter
    const assignStatus = document.getElementById('filter-assignment-status');
    if (assignStatus) {
      assignStatus.addEventListener('change', (e) => {
        loadAssignments(e.target.value);
      });
    }
  }

  // API Callers
  async function loadExercises() {
    try {
      const res = await fetch('/api/v1/admin/workouts/exercises', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        exercises = json.data || [];
        const countBadge = document.getElementById('badge-exercise-count');
        if (countBadge) countBadge.textContent = exercises.length;
        renderExercises();
      }
    } catch (err) {
      console.error('Failed to load exercises:', err);
    }
  }

  async function loadPrograms() {
    try {
      let url = '/api/v1/admin/workouts/programs?';
      const tr = document.getElementById('filter-trainer-select')?.value;
      const goal = document.getElementById('filter-goal-select')?.value;
      const split = document.getElementById('filter-split-select')?.value;

      if (tr && tr !== 'All') url += `trainer_id=${encodeURIComponent(tr)}&`;
      if (goal && goal !== 'All') url += `goal=${encodeURIComponent(goal)}&`;
      if (split && split !== 'All') url += `split_type=${encodeURIComponent(split)}&`;

      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        programs = json.data || [];
        const countBadge = document.getElementById('badge-program-count');
        if (countBadge) countBadge.textContent = programs.length;
        renderPrograms();
        populateProgramSelects();
      }
    } catch (err) {
      console.error('Failed to load programs:', err);
    }
  }

  function populateProgramSelects() {
    const selects = ['assign-program-select', 'log-program-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Program --</option>' +
          programs.map(p => `<option value="${p.id}">${p.name} (${p.split_type})</option>`).join('');
      }
    });
  }

  async function loadAssignments(status = 'All') {
    try {
      let url = '/api/v1/admin/workouts/assignments';
      if (status && status !== 'All') url += `?status=${encodeURIComponent(status)}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        assignments = json.data || [];
        const countBadge = document.getElementById('badge-assignment-count');
        if (countBadge) countBadge.textContent = assignments.length;
        renderAssignments();
      }
    } catch (err) {
      console.error('Failed to load assignments:', err);
    }
  }

  async function loadSessionLogs() {
    try {
      const res = await fetch('/api/v1/admin/workouts/sessions', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        sessionLogs = json.data || [];
        const countBadge = document.getElementById('badge-session-count');
        if (countBadge) countBadge.textContent = sessionLogs.length;
        renderSessionLogs();
      }
    } catch (err) {
      console.error('Failed to load session logs:', err);
    }
  }

  async function loadAnalytics() {
    try {
      const res = await fetch('/api/v1/admin/workouts/analytics', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        analyticsData = json.data || null;
        renderAnalytics();
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
    }
  }

  // Render Functions
  function renderExercises() {
    const container = document.getElementById('exercise-grid-container');
    if (!container) return;

    let filtered = exercises;
    if (activeMuscleFilter !== 'All') {
      filtered = filtered.filter(e => e.muscle_group.toLowerCase() === activeMuscleFilter.toLowerCase());
    }
    if (exerciseSearchTerm) {
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(exerciseSearchTerm) ||
        (e.target_muscles && e.target_muscles.toLowerCase().includes(exerciseSearchTerm)) ||
        e.equipment.toLowerCase().includes(exerciseSearchTerm)
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🔍</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No exercises found</h3>
          <p style="color: #64748b; font-size: 0.9rem;">Try adjusting your muscle group filter or search query.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(ex => `
      <div class="exercise-card">
        <div>
          <div class="exercise-header">
            <h4 class="exercise-title">${escapeHtml(ex.name)}</h4>
          </div>
          <div class="exercise-tags">
            <span class="tag-muscle">${escapeHtml(ex.muscle_group)}</span>
            <span class="tag-equip">${escapeHtml(ex.equipment)}</span>
            <span class="tag-diff">${escapeHtml(ex.difficulty)}</span>
          </div>
          <p class="exercise-desc">${escapeHtml(ex.instructions)}</p>
        </div>
        <div class="exercise-footer">
          <span style="font-size: 0.78rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">
            ${ex.target_muscles ? escapeHtml(ex.target_muscles) : 'General'}
          </span>
          <button class="btn btn-outline btn-xs" onclick="window.viewExerciseDetail(${ex.id})" style="padding: 4px 10px; font-size: 0.78rem;">
            Instructions 📖
          </button>
        </div>
      </div>
    `).join('');
  }

  function renderPrograms() {
    const container = document.getElementById('programs-grid-container');
    if (!container) return;

    let filtered = programs;
    if (programSearchTerm) {
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(programSearchTerm) ||
        (p.description && p.description.toLowerCase().includes(programSearchTerm))
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">📋</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No workout programs match filters</h3>
          <p style="color: #64748b; font-size: 0.9rem;">Click "+ Build Program" to assemble a new training routine.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(prg => `
      <div class="program-card">
        <div class="program-meta">
          <span class="tag-muscle">${escapeHtml(prg.split_type)}</span>
          <span class="tag-equip">${escapeHtml(prg.goal)}</span>
          <span class="tag-diff">${escapeHtml(prg.difficulty_level || 'Intermediate')}</span>
        </div>
        <h3 class="program-title">${escapeHtml(prg.name)}</h3>
        <p class="program-desc">${escapeHtml(prg.description || 'Customized strength & physique split.')}</p>

        <div class="program-stats">
          <div>
            <div class="program-stat-val">${prg.days_count || 0}</div>
            <div class="program-stat-lbl">Days / Wk</div>
          </div>
          <div>
            <div class="program-stat-val">${prg.exercises_count || 0}</div>
            <div class="program-stat-lbl">Exercises</div>
          </div>
          <div>
            <div class="program-stat-val" style="color: #00e676;">${prg.active_assignments_count || 0}</div>
            <div class="program-stat-lbl">Active Lifters</div>
          </div>
        </div>

        <div style="font-size: 0.82rem; color: #94a3b8; margin-bottom: 14px; display: flex; align-items: center; gap: 6px;">
          <span>👤 Coach:</span>
          <strong style="color: #fff;">${escapeHtml(prg.trainer_name || 'Virtex Head Trainer')}</strong>
        </div>

        <div style="display: flex; gap: 8px; margin-top: auto;">
          <button class="btn btn-outline" style="flex: 1; padding: 8px 12px; font-size: 0.82rem;" onclick="window.viewProgramSchedule(${prg.id})">
            View Schedule 📅
          </button>
          <button class="btn btn-green" style="padding: 8px 14px; font-size: 0.82rem;" onclick="window.openAssignModal(${prg.id})">
            Assign +
          </button>
        </div>
      </div>
    `).join('');
  }

  function renderAssignments() {
    const tbody = document.getElementById('assignments-table-body');
    if (!tbody) return;

    if (assignments.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No member workout assignments recorded. Click "Assign Member" to enroll a lifter.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = assignments.map(a => {
      const statusClass = a.status === 'active' ? 'badge-green' : (a.status === 'completed' ? 'badge-blue' : 'badge-gold');
      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: #fff;">${escapeHtml(a.member_name)}</div>
            <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(a.member_code || '#' + a.member_id)}</div>
          </td>
          <td>
            <div style="font-weight: 600; color: #00b0ff;">${escapeHtml(a.program_name)}</div>
            <div style="font-size: 0.75rem; color: #94a3b8;">${escapeHtml(a.split_type)} • ${escapeHtml(a.goal)}</div>
          </td>
          <td>
            <span style="color: #e2e8f0; font-size: 0.85rem;">${escapeHtml(a.trainer_name || 'Assigned Coach')}</span>
          </td>
          <td>
            <span style="font-size: 0.82rem; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">
              ${a.start_date ? new Date(a.start_date).toLocaleDateString() : '—'}
            </span>
          </td>
          <td>
            <span class="badge ${statusClass}" style="text-transform: capitalize;">${escapeHtml(a.status)}</span>
          </td>
          <td>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: #00e676; font-weight: 700;">
              ${a.total_logged_sessions || 0} sessions
            </div>
            <div style="font-size: 0.72rem; color: #64748b;">
              Last: ${a.last_session_date ? new Date(a.last_session_date).toLocaleDateString() : 'None'}
            </div>
          </td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-outline btn-xs" onclick="window.viewMemberProgress(${a.member_id}, '${escapeHtml(a.member_name)}')" title="View Strength PRs & Analytics">
                PRs 🏆
              </button>
              ${a.status === 'active' ? `
                <button class="btn btn-outline btn-xs" style="color: #ffd600; border-color: rgba(255,214,0,0.3);" onclick="window.updateAssignmentStatus(${a.id}, 'completed')">
                  Complete
                </button>
              ` : `
                <button class="btn btn-outline btn-xs" style="color: #00e676; border-color: rgba(0,230,118,0.3);" onclick="window.updateAssignmentStatus(${a.id}, 'active')">
                  Reactivate
                </button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderSessionLogs() {
    const tbody = document.getElementById('session-logs-table-body');
    if (!tbody) return;

    if (sessionLogs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No workout session logs logged yet. Click "Log Completed Session" to register a workout.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = sessionLogs.map(s => {
      let rpeClass = 'rpe-med';
      if (s.rpe_rating <= 7) rpeClass = 'rpe-low';
      else if (s.rpe_rating >= 9) rpeClass = 'rpe-high';

      return `
        <tr>
          <td>
            <span style="font-size: 0.82rem; color: #e2e8f0; font-family: 'JetBrains Mono', monospace;">
              ${new Date(s.completed_at).toLocaleDateString()} ${new Date(s.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </td>
          <td>
            <div style="font-weight: 700; color: #fff;">${escapeHtml(s.member_name)}</div>
            <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(s.member_code)}</div>
          </td>
          <td>
            <div style="font-weight: 600; color: #00b0ff;">${escapeHtml(s.program_name || 'Independent Routine')}</div>
            <div style="font-size: 0.75rem; color: #94a3b8;">${escapeHtml(s.day_name || 'Full Workout')}</div>
          </td>
          <td>
            <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.88rem; color: #fff;">
              ${s.duration_minutes || 60} mins
            </span>
          </td>
          <td>
            <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.92rem; color: #00e676; font-weight: 700;">
              ${Number(s.total_volume_kg || 0).toLocaleString()} kg
            </span>
          </td>
          <td>
            <span class="rpe-meter ${rpeClass}">RPE ${s.rpe_rating || 8}/10</span>
          </td>
          <td>
            <button class="btn btn-outline btn-xs" onclick="window.viewSessionDetail(${s.id})">
              Details 🔍
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderAnalytics() {
    if (!analyticsData) return;
    const { kpis, splitDistribution, muscleDistribution, topPrs } = analyticsData;

    // KPI Cards
    const exEl = document.getElementById('kpi-total-exercises');
    if (exEl) exEl.textContent = kpis.totalExercises;

    const prgEl = document.getElementById('kpi-total-programs');
    if (prgEl) prgEl.textContent = kpis.totalPrograms;

    const actEl = document.getElementById('kpi-active-lifters');
    if (actEl) actEl.textContent = kpis.activeAssignments;

    const volEl = document.getElementById('kpi-total-volume');
    if (volEl) volEl.textContent = `${Math.round(kpis.totalVolumeKg / 1000)}k kg`;

    const wkEl = document.getElementById('kpi-sessions-week');
    if (wkEl) wkEl.textContent = kpis.sessionsThisWeek;

    // Top PRs
    const prsTbody = document.getElementById('top-prs-tbody');
    if (prsTbody && topPrs) {
      if (topPrs.length === 0) {
        prsTbody.innerHTML = '<tr><td colspan="3" style="color: #64748b; text-align: center;">No records logged yet.</td></tr>';
      } else {
        prsTbody.innerHTML = topPrs.map((pr, idx) => `
          <tr>
            <td style="font-weight: 700; color: #ffd600;">
              ${idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `#${idx + 1}`))}
              <span style="color: #fff; margin-left: 6px;">${escapeHtml(pr.exercise_name)}</span>
            </td>
            <td style="color: #e2e8f0;">${escapeHtml(pr.member_name)}</td>
            <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #00e676;">${Number(pr.top_weight_kg).toFixed(1)} kg</td>
          </tr>
        `).join('');
      }
    }

    // Split Distribution
    const splitContainer = document.getElementById('split-distribution-list');
    if (splitContainer && splitDistribution) {
      splitContainer.innerHTML = splitDistribution.map(s => `
        <div style="margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
            <span style="color: #fff;">${escapeHtml(s.split_type)}</span>
            <span style="color: #00e676; font-family: 'JetBrains Mono', monospace;">${s.count} programs</span>
          </div>
          <div style="height: 6px; background: #1e2433; border-radius: 3px; overflow: hidden;">
            <div style="width: ${Math.min(100, s.count * 25)}%; height: 100%; background: #00e676; border-radius: 3px;"></div>
          </div>
        </div>
      `).join('');
    }
  }

  // Modals & User Actions
  function setupModalListeners() {
    // Open New Exercise Modal
    const btnNewEx = document.getElementById('btn-open-exercise-modal');
    if (btnNewEx) {
      btnNewEx.addEventListener('click', () => {
        document.getElementById('modal-new-exercise').classList.add('active');
      });
    }

    // Open Program Builder Modal
    const btnNewPrg = document.getElementById('btn-open-program-modal');
    if (btnNewPrg) {
      btnNewPrg.addEventListener('click', () => {
        resetProgramBuilderForm();
        document.getElementById('modal-program-builder').classList.add('active');
      });
    }

    // Open Assign Program Modal
    const btnOpenAssign = document.getElementById('btn-open-assign-modal');
    if (btnOpenAssign) {
      btnOpenAssign.addEventListener('click', () => {
        document.getElementById('modal-assign-program').classList.add('active');
      });
    }

    // Open Log Session Modal
    const btnOpenLog = document.getElementById('btn-open-log-modal');
    if (btnOpenLog) {
      btnOpenLog.addEventListener('click', () => {
        document.getElementById('modal-log-session').classList.add('active');
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
    const formNewEx = document.getElementById('form-new-exercise');
    if (formNewEx) {
      formNewEx.addEventListener('submit', handleCreateExercise);
    }

    const formProgram = document.getElementById('form-program-builder');
    if (formProgram) {
      formProgram.addEventListener('submit', handleCreateProgram);
    }

    const formAssign = document.getElementById('form-assign-program');
    if (formAssign) {
      formAssign.addEventListener('submit', handleAssignProgram);
    }

    const formLog = document.getElementById('form-log-session');
    if (formLog) {
      formLog.addEventListener('submit', handleLogSession);
    }

    // Program Builder Add Day Button
    const btnAddDay = document.getElementById('btn-builder-add-day');
    if (btnAddDay) {
      btnAddDay.addEventListener('click', addProgramBuilderDay);
    }
  }

  // Create Exercise Handler
  async function handleCreateExercise(e) {
    e.preventDefault();
    const data = {
      name: document.getElementById('ex-name').value.trim(),
      muscle_group: document.getElementById('ex-muscle-group').value,
      equipment: document.getElementById('ex-equipment').value,
      difficulty: document.getElementById('ex-difficulty').value,
      instructions: document.getElementById('ex-instructions').value.trim(),
      target_muscles: document.getElementById('ex-targets').value.trim(),
      video_url: document.getElementById('ex-video').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/workouts/exercises', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Exercise successfully added to library!');
        document.getElementById('modal-new-exercise').classList.remove('active');
        document.getElementById('form-new-exercise').reset();
        await loadExercises();
      } else {
        showToast(json.message || 'Failed to create exercise', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Network error while creating exercise', 'error');
    }
  }

  // Program Builder Helpers
  let builderDayCount = 0;
  function resetProgramBuilderForm() {
    const container = document.getElementById('builder-days-container');
    if (container) container.innerHTML = '';
    builderDayCount = 0;
    addProgramBuilderDay(); // Start with Day 1
  }

  function addProgramBuilderDay() {
    builderDayCount++;
    const container = document.getElementById('builder-days-container');
    if (!container) return;

    const dayDiv = document.createElement('div');
    dayDiv.className = 'schedule-day-card';
    dayDiv.id = `builder-day-${builderDayCount}`;
    dayDiv.innerHTML = `
      <div class="schedule-day-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: #00e676; font-weight: 700;">Day ${builderDayCount}</span>
          <input type="text" class="form-control day-name-input" placeholder="e.g. Day ${builderDayCount}: Push (Chest & Shoulders)" value="Day ${builderDayCount}: Training Day" style="padding: 4px 8px; font-size: 0.85rem; width: 260px;" required>
        </div>
        <button type="button" class="btn btn-outline btn-xs" onclick="document.getElementById('builder-day-${builderDayCount}').remove()" style="color: #ff5252; border-color: rgba(255,82,82,0.3);">Remove Day</button>
      </div>
      <div class="day-exercises-list" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
        <!-- Exercise rows will go here -->
      </div>
      <button type="button" class="btn btn-outline btn-xs" onclick="window.addExerciseToDay(${builderDayCount})">
        + Add Exercise to Day ${builderDayCount}
      </button>
    `;
    container.appendChild(dayDiv);
    window.addExerciseToDay(builderDayCount);
  }

  window.addExerciseToDay = function (dayNum) {
    const dayCard = document.getElementById(`builder-day-${dayNum}`);
    if (!dayCard) return;
    const list = dayCard.querySelector('.day-exercises-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'exercise-row-item';
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '2fr 1fr 1fr 1fr 30px';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.background = '#0b0d14';
    row.style.padding = '8px';
    row.style.borderRadius = '6px';
    row.style.border = '1px solid #1e2433';

    const exerciseOptions = exercises.map(e => `<option value="${e.id}">${e.name} (${e.muscle_group})</option>`).join('');

    row.innerHTML = `
      <select class="form-control ex-select" style="padding: 5px 8px; font-size: 0.82rem;" required>
        <option value="">Select Exercise</option>
        ${exerciseOptions}
      </select>
      <input type="number" class="form-control ex-sets" placeholder="Sets" value="3" min="1" max="15" style="padding: 5px 8px; font-size: 0.82rem;" required>
      <input type="text" class="form-control ex-reps" placeholder="Reps" value="8-12" style="padding: 5px 8px; font-size: 0.82rem;" required>
      <input type="number" class="form-control ex-rest" placeholder="Rest (s)" value="90" min="0" step="15" style="padding: 5px 8px; font-size: 0.82rem;" required>
      <button type="button" style="background: transparent; border: none; color: #ff5252; cursor: pointer; font-size: 1.1rem;" onclick="this.closest('.exercise-row-item').remove()">×</button>
    `;
    list.appendChild(row);
  };

  async function handleCreateProgram(e) {
    e.preventDefault();
    const name = document.getElementById('prg-name').value.trim();
    const trainer_id = document.getElementById('builder-trainer-select').value || null;
    const difficulty_level = document.getElementById('prg-difficulty').value;
    const goal = document.getElementById('prg-goal').value;
    const split_type = document.getElementById('prg-split-type').value;
    const description = document.getElementById('prg-description').value.trim();

    const days = [];
    document.querySelectorAll('.schedule-day-card').forEach((dayCard, dIdx) => {
      const dayName = dayCard.querySelector('.day-name-input')?.value || `Day ${dIdx + 1}`;
      const exRows = dayCard.querySelectorAll('.exercise-row-item');
      const dayExercises = [];

      exRows.forEach(row => {
        const exId = row.querySelector('.ex-select')?.value;
        const sets = row.querySelector('.ex-sets')?.value;
        const reps = row.querySelector('.ex-reps')?.value;
        const rest = row.querySelector('.ex-rest')?.value;
        if (exId) {
          dayExercises.push({
            exercise_id: parseInt(exId, 10),
            sets: parseInt(sets, 10) || 3,
            reps: reps || '8-12',
            rest_seconds: parseInt(rest, 10) || 90
          });
        }
      });

      days.push({
        day_number: dIdx + 1,
        day_name: dayName,
        exercises: dayExercises
      });
    });

    try {
      const res = await fetch('/api/v1/admin/workouts/programs', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name,
          trainer_id,
          difficulty_level,
          goal,
          split_type,
          description,
          is_template: true,
          days
        })
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Workout program created successfully!');
        document.getElementById('modal-program-builder').classList.remove('active');
        await loadPrograms();
      } else {
        showToast(json.message || 'Failed to create program', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving workout program', 'error');
    }
  }

  // Handle Assign Program
  async function handleAssignProgram(e) {
    e.preventDefault();
    const data = {
      member_id: parseInt(document.getElementById('assign-member-select').value, 10),
      program_id: parseInt(document.getElementById('assign-program-select').value, 10),
      assigned_by_trainer_id: document.getElementById('assign-trainer-select').value || null,
      start_date: document.getElementById('assign-start-date').value || null,
      notes: document.getElementById('assign-notes').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/workouts/assignments', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Program assigned to member successfully!');
        document.getElementById('modal-assign-program').classList.remove('active');
        document.getElementById('form-assign-program').reset();
        await loadAssignments();
      } else {
        showToast(json.message || 'Failed to assign program', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error creating member assignment', 'error');
    }
  }

  // Handle Log Workout Session
  async function handleLogSession(e) {
    e.preventDefault();
    const member_id = parseInt(document.getElementById('log-member-select').value, 10);
    const program_id = document.getElementById('log-program-select').value || null;
    const duration_minutes = parseInt(document.getElementById('log-duration').value, 10) || 60;
    const rpe_rating = parseInt(document.getElementById('log-rpe').value, 10) || 8;
    const notes = document.getElementById('log-notes').value.trim();

    // Grab set entries from dynamic list
    const items = [];
    document.querySelectorAll('.log-set-row').forEach(row => {
      const exId = row.querySelector('.log-ex-select')?.value;
      const setNum = row.querySelector('.log-set-num')?.value;
      const reps = row.querySelector('.log-reps')?.value;
      const weight = row.querySelector('.log-weight')?.value;
      if (exId && reps && weight) {
        items.push({
          exercise_id: parseInt(exId, 10),
          set_number: parseInt(setNum, 10) || 1,
          reps_completed: parseInt(reps, 10),
          weight_kg: parseFloat(weight)
        });
      }
    });

    try {
      const res = await fetch('/api/v1/admin/workouts/sessions', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          member_id,
          program_id,
          duration_minutes,
          rpe_rating,
          notes,
          items
        })
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Workout session logged successfully!');
        document.getElementById('modal-log-session').classList.remove('active');
        document.getElementById('form-log-session').reset();
        await Promise.all([loadSessionLogs(), loadAnalytics()]);
      } else {
        showToast(json.message || 'Failed to log workout session', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error submitting session log', 'error');
    }
  }

  // Global window functions for inline onclick handlers
  window.viewExerciseDetail = async function (id) {
    const ex = exercises.find(e => e.id === id);
    if (!ex) return;

    const modal = document.getElementById('modal-view-exercise');
    if (!modal) return;

    document.getElementById('view-ex-title').textContent = ex.name;
    document.getElementById('view-ex-muscle').textContent = ex.muscle_group;
    document.getElementById('view-ex-equip').textContent = ex.equipment;
    document.getElementById('view-ex-diff').textContent = ex.difficulty;
    document.getElementById('view-ex-targets').textContent = ex.target_muscles || 'Target muscle group';
    document.getElementById('view-ex-instructions').textContent = ex.instructions;

    const videoBtn = document.getElementById('view-ex-video-btn');
    if (videoBtn) {
      if (ex.video_url) {
        videoBtn.href = ex.video_url;
        videoBtn.style.display = 'inline-flex';
      } else {
        videoBtn.style.display = 'none';
      }
    }

    modal.classList.add('active');
  };

  window.viewProgramSchedule = async function (id) {
    try {
      const res = await fetch(`/api/v1/admin/workouts/programs/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const prg = json.data;

      const modal = document.getElementById('modal-view-schedule');
      if (!modal) return;

      document.getElementById('view-schedule-title').textContent = `${prg.name} (${prg.split_type})`;
      const container = document.getElementById('view-schedule-days');
      container.innerHTML = '';

      if (!prg.days || prg.days.length === 0) {
        container.innerHTML = '<p style="color: #64748b; padding: 1rem;">No daily split configured yet for this program.</p>';
      } else {
        prg.days.forEach(day => {
          const dCard = document.createElement('div');
          dCard.className = 'schedule-day-card';
          dCard.innerHTML = `
            <div class="schedule-day-header">
              <span class="schedule-day-title">
                <span style="color: #00e676;">Day ${day.day_number}:</span> ${escapeHtml(day.day_name)}
              </span>
              <span style="font-size: 0.78rem; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">
                ${day.focus || ''}
              </span>
            </div>
            <table class="exercise-table">
              <thead>
                <tr>
                  <th>Exercise Movement</th>
                  <th>Target Sets</th>
                  <th>Target Reps</th>
                  <th>Rest Period</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                ${day.exercises && day.exercises.length > 0 ? day.exercises.map(ex => `
                  <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(ex.exercise_name)}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; color: #00e676; font-weight: 700;">${ex.sets} sets</td>
                    <td style="font-family: 'JetBrains Mono', monospace;">${escapeHtml(ex.reps)}</td>
                    <td style="font-family: 'JetBrains Mono', monospace; color: #00b0ff;">${ex.rest_seconds}s</td>
                    <td style="font-size: 0.8rem; color: #94a3b8;">${escapeHtml(ex.notes || '—')}</td>
                  </tr>
                `).join('') : '<tr><td colspan="5" style="color: #64748b;">No exercises listed for this day.</td></tr>'}
              </tbody>
            </table>
          `;
          container.appendChild(dCard);
        });
      }

      modal.classList.add('active');
    } catch (err) {
      console.error(err);
      showToast('Failed to load program schedule', 'error');
    }
  };

  window.openAssignModal = function (programId) {
    const modal = document.getElementById('modal-assign-program');
    if (!modal) return;
    const select = document.getElementById('assign-program-select');
    if (select) select.value = programId;
    modal.classList.add('active');
  };

  window.updateAssignmentStatus = async function (id, status) {
    try {
      const res = await fetch(`/api/v1/admin/workouts/assignments/${id}/status`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        showToast(`Assignment status changed to ${status}`);
        await loadAssignments();
      } else {
        showToast('Failed to update status', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error updating status', 'error');
    }
  };

  window.viewMemberProgress = async function (memberId, memberName) {
    try {
      const res = await fetch(`/api/v1/admin/workouts/progress/${memberId}`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const { personalBests, strengthProgression } = json.data;

      const modal = document.getElementById('modal-member-progress');
      if (!modal) return;

      document.getElementById('progress-member-name').textContent = memberName || `Member #${memberId}`;
      const prsTbody = document.getElementById('member-prs-tbody');
      prsTbody.innerHTML = '';

      if (!personalBests || personalBests.length === 0) {
        prsTbody.innerHTML = '<tr><td colspan="4" style="color: #64748b; text-align: center;">No personal bests logged yet.</td></tr>';
      } else {
        prsTbody.innerHTML = personalBests.map(pr => `
          <tr>
            <td style="font-weight: 700; color: #fff;">
              <span class="pr-badge">PR</span> ${escapeHtml(pr.exercise_name)}
            </td>
            <td><span class="tag-muscle">${escapeHtml(pr.muscle_group || 'General')}</span></td>
            <td style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #00e676; font-size: 1rem;">
              ${Number(pr.max_weight_kg).toFixed(1)} kg
            </td>
            <td style="font-size: 0.78rem; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">
              ${pr.date_achieved ? new Date(pr.date_achieved).toLocaleDateString() : '—'}
            </td>
          </tr>
        `).join('');
      }

      // Progression list
      const progTbody = document.getElementById('member-progression-tbody');
      progTbody.innerHTML = '';
      if (!strengthProgression || strengthProgression.length === 0) {
        progTbody.innerHTML = '<tr><td colspan="5" style="color: #64748b; text-align: center;">No progressive overload logs.</td></tr>';
      } else {
        progTbody.innerHTML = strengthProgression.map(s => `
          <tr>
            <td style="color: #e2e8f0;">${escapeHtml(s.exercise_name)}</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: #fff;">${Number(s.weight_kg).toFixed(1)} kg</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: #94a3b8;">${s.reps} reps</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: #ffd600; font-weight: 700;">${Number(s.estimated_one_rep_max).toFixed(1)} kg</td>
            <td style="font-size: 0.78rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${new Date(s.logged_at).toLocaleDateString()}</td>
          </tr>
        `).join('');
      }

      modal.classList.add('active');
    } catch (err) {
      console.error(err);
      showToast('Failed to load member PR progress', 'error');
    }
  };

  window.viewSessionDetail = async function (id) {
    try {
      const res = await fetch(`/api/v1/admin/workouts/sessions/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const session = json.data;

      const modal = document.getElementById('modal-session-detail');
      if (!modal) return;

      document.getElementById('detail-session-member').textContent = `${session.member_name} (${session.member_code})`;
      document.getElementById('detail-session-program').textContent = session.program_name || 'Independent Routine';
      document.getElementById('detail-session-day').textContent = session.day_name || 'General';
      document.getElementById('detail-session-vol').textContent = `${Number(session.total_volume_kg).toLocaleString()} kg`;
      document.getElementById('detail-session-dur').textContent = `${session.duration_minutes} mins`;
      document.getElementById('detail-session-rpe').textContent = `RPE ${session.rpe_rating}/10`;
      document.getElementById('detail-session-notes').textContent = session.notes || 'No notes logged.';

      const tbody = document.getElementById('detail-session-items-tbody');
      tbody.innerHTML = '';
      if (!session.items || session.items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="color: #64748b; text-align: center;">No individual sets recorded.</td></tr>';
      } else {
        tbody.innerHTML = session.items.map(it => `
          <tr>
            <td style="font-weight: 600; color: #fff;">${escapeHtml(it.exercise_name)}</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: #94a3b8;">Set ${it.set_number}</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: #00e676; font-weight: 700;">${Number(it.weight_kg).toFixed(1)} kg</td>
            <td style="font-family: 'JetBrains Mono', monospace; color: #e2e8f0;">${it.reps_completed} reps</td>
            <td>${it.is_pr ? '<span class="pr-badge">NEW PR!</span>' : '<span style="color: #64748b;">—</span>'}</td>
          </tr>
        `).join('');
      }

      modal.classList.add('active');
    } catch (err) {
      console.error(err);
      showToast('Failed to load session details', 'error');
    }
  };

  // Helper function to escape HTML
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

