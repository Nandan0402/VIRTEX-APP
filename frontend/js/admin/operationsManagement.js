/**
 * Virtex Admin - Gym Operations & Staff Management Controller
 * Handles 10 Core Features:
 * 1. Staff Registration
 * 2. Staff Profiles
 * 3. Staff Roles and Permissions
 * 4. Staff Attendance Reports (from routine_punches)
 * 5. Staff Shift Management
 * 6. Branch Management
 * 7. Facility Management
 * 8. Facility Maintenance
 * 9. Staff Performance Reports
 * 10. Branch-Wise Analytics
 */

(function () {
  'use strict';

  // API Endpoints
  const API_BASE = '/api/operations';
  const API_ADMIN_BASE = '/api/admin/operations';

  // Local State
  let state = {
    currentTab: 'staff',
    staff: [],
    roles: [],
    attendance: { punches: [], summary: {} },
    shifts: [],
    branches: [],
    facilities: [],
    maintenanceLogs: [],
    performance: [],
    branchAnalytics: null,
    filters: {
      staffBranch: 'all',
      staffDept: 'all',
      staffRole: 'all',
      staffSearch: '',
      shiftBranch: 'all',
      shiftStatus: 'all',
      attBranch: 'all',
      facBranch: 'all',
      facStatus: 'all',
      maintStatus: 'all'
    }
  };

  // Auth Header Helper
  function getAuthHeaders() {
    const token = (localStorage.getItem('virtex_admin_jwt_token') || localStorage.getItem('token'));
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  }

  // Unified Fetch with fallback
  async function apiFetch(endpoint, options = {}) {
    const opts = {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...(options.headers || {})
      }
    };

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, opts);
      if (res.status === 404) {
        const fallbackRes = await fetch(`${API_ADMIN_BASE}${endpoint}`, opts);
        return await fallbackRes.json();
      }
      return await res.json();
    } catch (err) {
      console.warn(`Primary fetch failed for ${endpoint}, trying admin fallback...`, err);
      try {
        const fallbackRes = await fetch(`${API_ADMIN_BASE}${endpoint}`, opts);
        return await fallbackRes.json();
      } catch (fallbackErr) {
        console.error('All fetch attempts failed:', fallbackErr);
        throw fallbackErr;
      }
    }
  }

  // Toast Notification
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `ops-toast toast-${type}`;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #11141e;
      border: 1px solid ${type === 'success' ? '#00e676' : '#ff5252'};
      color: #fff;
      padding: 12px 20px;
      border-radius: 8px;
      z-index: 9999;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.9rem;
      animation: fadeIn 0.3s ease;
    `;
    toast.innerHTML = `<span>${type === 'success' ? '👔' : '⚠️'}</span> <span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function formatCurrency(val) {
    const num = parseFloat(val) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(dStr) {
    if (!dStr) return 'N/A';
    try {
      const d = new Date(dStr);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return dStr;
    }
  }

  function formatTime(dStr) {
    if (!dStr) return 'N/A';
    try {
      const d = new Date(dStr);
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return dStr;
    }
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initFilterListeners();
    initModalHandlers();
    loadAllData();
  });

  function initTabs() {
    const tabBtns = document.querySelectorAll('.ops-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentTab = btn.dataset.tab;

        document.querySelectorAll('.ops-tab-content').forEach(pane => {
          pane.style.display = 'none';
        });

        const activePane = document.getElementById(`tab-content-${state.currentTab}`);
        if (activePane) {
          activePane.style.display = 'block';
        }

        if (state.currentTab === 'analytics') {
          loadBranchAnalytics();
        }
      });
    });

    checkUrlHashTab();
    window.addEventListener('hashchange', checkUrlHashTab);
  }

  function checkUrlHashTab() {
    const hash = window.location.hash ? window.location.hash.replace('#', '').toLowerCase() : '';
    if (!hash) return;
    const matchingBtn = document.querySelector(`.ops-tab-btn[data-tab="${hash}"]`);
    if (matchingBtn) {
      matchingBtn.click();
      if (hash === 'shifts') {
        setTimeout(() => {
          document.getElementById('tab-content-shifts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
      }
    }
  }

  function initFilterListeners() {
    // Staff filters
    const staffBranch = document.getElementById('staff-filter-branch');
    const staffDept = document.getElementById('staff-filter-dept');
    const staffRole = document.getElementById('staff-filter-role');
    const staffSearch = document.getElementById('staff-search');
    if (staffBranch) staffBranch.addEventListener('change', (e) => { state.filters.staffBranch = e.target.value; renderStaff(); });
    if (staffDept) staffDept.addEventListener('change', (e) => { state.filters.staffDept = e.target.value; renderStaff(); });
    if (staffRole) staffRole.addEventListener('change', (e) => { state.filters.staffRole = e.target.value; renderStaff(); });
    if (staffSearch) staffSearch.addEventListener('input', (e) => { state.filters.staffSearch = e.target.value.toLowerCase(); renderStaff(); });

    // Shifts filters
    const shiftBranch = document.getElementById('shift-filter-branch');
    const shiftStatus = document.getElementById('shift-filter-status');
    if (shiftBranch) shiftBranch.addEventListener('change', (e) => { state.filters.shiftBranch = e.target.value; renderShifts(); });
    if (shiftStatus) shiftStatus.addEventListener('change', (e) => { state.filters.shiftStatus = e.target.value; renderShifts(); });

    // Facilities filters
    const facBranch = document.getElementById('fac-filter-branch');
    const facStatus = document.getElementById('fac-filter-status');
    if (facBranch) facBranch.addEventListener('change', (e) => { state.filters.facBranch = e.target.value; renderFacilities(); });
    if (facStatus) facStatus.addEventListener('change', (e) => { state.filters.facStatus = e.target.value; renderFacilities(); });

    // Maintenance filter
    const maintStatus = document.getElementById('maint-filter-status');
    if (maintStatus) maintStatus.addEventListener('change', (e) => { state.filters.maintStatus = e.target.value; renderMaintenance(); });
  }

  // ==========================================
  // DATA FETCHING
  // ==========================================
  async function loadAllData() {
    await Promise.allSettled([
      loadStaff(),
      loadBranches(),
      loadRoles(),
      loadAttendance(),
      loadShifts(),
      loadFacilities(),
      loadMaintenance(),
      loadPerformance(),
      loadBranchAnalytics()
    ]);
  }

  async function loadStaff() {
    try {
      const res = await apiFetch('/staff');
      if (res && res.success) {
        state.staff = res.data;
        renderStaff();
        populateStaffDropdowns();
        updateKpis();
      }
    } catch (e) {
      console.error('Failed to load staff:', e);
    }
  }

  async function loadBranches() {
    try {
      const res = await apiFetch('/branches');
      if (res && res.success) {
        state.branches = res.data;
        renderBranches();
        populateBranchDropdowns();
        updateKpis();
      }
    } catch (e) {
      console.error('Failed to load branches:', e);
    }
  }

  async function loadRoles() {
    try {
      const res = await apiFetch('/roles');
      if (res && res.success) {
        state.roles = res.data;
        renderRoles();
      }
    } catch (e) {
      console.error('Failed to load roles:', e);
    }
  }

  async function loadAttendance() {
    try {
      const res = await apiFetch('/attendance');
      if (res && res.success) {
        state.attendance = res.data;
        renderAttendance();
        updateKpis();
      }
    } catch (e) {
      console.error('Failed to load attendance:', e);
    }
  }

  async function loadShifts() {
    try {
      const res = await apiFetch('/shifts');
      if (res && res.success) {
        state.shifts = res.data;
        renderShifts();
      }
    } catch (e) {
      console.error('Failed to load shifts:', e);
    }
  }

  async function loadFacilities() {
    try {
      const res = await apiFetch('/facilities');
      if (res && res.success) {
        state.facilities = res.data;
        renderFacilities();
        populateFacilityDropdowns();
        updateKpis();
      }
    } catch (e) {
      console.error('Failed to load facilities:', e);
    }
  }

  async function loadMaintenance() {
    try {
      const res = await apiFetch('/maintenance');
      if (res && res.success) {
        state.maintenanceLogs = res.data;
        renderMaintenance();
        updateKpis();
      }
    } catch (e) {
      console.error('Failed to load maintenance logs:', e);
    }
  }

  async function loadPerformance() {
    try {
      const res = await apiFetch('/performance');
      if (res && res.success) {
        state.performance = res.data;
        renderPerformance();
      }
    } catch (e) {
      console.error('Failed to load performance:', e);
    }
  }

  async function loadBranchAnalytics() {
    try {
      const res = await apiFetch('/analytics/branches');
      if (res && res.success) {
        state.branchAnalytics = res.data;
        renderBranchAnalytics();
      }
    } catch (e) {
      console.error('Failed to load branch analytics:', e);
    }
  }

  function updateKpis() {
    const elStaff = document.getElementById('kpi-total-staff');
    const elBranches = document.getElementById('kpi-total-branches');
    const elActive = document.getElementById('kpi-on-floor-today');
    const elHours = document.getElementById('kpi-total-hours');
    const elZones = document.getElementById('kpi-open-zones');
    const elMaint = document.getElementById('kpi-scheduled-maint');

    if (elStaff) elStaff.textContent = state.staff.length;
    if (elBranches) elBranches.textContent = state.branches.length;
    if (elActive && state.attendance.summary) {
      elActive.textContent = state.attendance.summary.currently_active_on_floor || state.attendance.summary.active_staff_punched || 0;
    }
    if (elHours && state.attendance.summary) {
      const hrs = Math.round(parseFloat(state.attendance.summary.total_hours_worked || 0));
      elHours.textContent = `${hrs} hrs`;
    }
    if (elZones) {
      const openZones = state.facilities.filter(f => f.status === 'open').length;
      elZones.textContent = openZones;
    }
    if (elMaint) {
      const sched = state.maintenanceLogs.filter(m => m.status === 'scheduled').length;
      elMaint.textContent = sched;
    }
  }

  // ==========================================
  // RENDERERS
  // ==========================================

  // 1. Render Staff Profiles Grid
  function renderStaff() {
    const container = document.getElementById('staff-grid');
    if (!container) return;

    let items = state.staff.filter(s => {
      if (state.filters.staffBranch !== 'all' && s.branch_id != state.filters.staffBranch) return false;
      if (state.filters.staffDept !== 'all' && s.department !== state.filters.staffDept) return false;
      if (state.filters.staffRole !== 'all' && s.role !== state.filters.staffRole) return false;
      if (state.filters.staffSearch) {
        const q = state.filters.staffSearch;
        const matchName = s.full_name.toLowerCase().includes(q);
        const matchEmail = s.email.toLowerCase().includes(q);
        const matchEmp = (s.employee_id || '').toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchEmp) return false;
      }
      return true;
    });

    if (items.length === 0) {
      container.innerHTML = `<div style="grid-column: 1 / -1; padding: 2.5rem; text-align: center; color: var(--text-dim);">No staff profiles match filters.</div>`;
      return;
    }

    container.innerHTML = items.map(s => {
      const initials = s.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
      return `
        <div class="staff-card">
          <div>
            <div class="staff-header">
              <div class="staff-avatar-circle">${initials}</div>
              <div>
                <div class="staff-name">${escapeHtml(s.full_name)}</div>
                <div class="staff-designation">${escapeHtml(s.designation || 'Staff Member')}</div>
              </div>
            </div>

            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
              <span class="badge badge-green text-xs font-mono">${escapeHtml(s.role.toUpperCase())}</span>
              <span class="badge badge-outline text-xs">${escapeHtml(s.employee_id || 'PC-EMP')}</span>
            </div>

            <div class="staff-info-box">
              <div class="staff-info-row">
                <span style="color: #64748b;">Branch:</span>
                <span style="font-weight: 600;">📍 ${escapeHtml(s.branch_name || 'Flagship Indiranagar')}</span>
              </div>
              <div class="staff-info-row">
                <span style="color: #64748b;">Department:</span>
                <span>${escapeHtml(s.department || 'Operations')}</span>
              </div>
              <div class="staff-info-row">
                <span style="color: #64748b;">Phone:</span>
                <span>${escapeHtml(s.phone || 'N/A')}</span>
              </div>
              <div class="staff-info-row">
                <span style="color: #64748b;">Work Type:</span>
                <span>${escapeHtml(s.employment_type || 'Full-Time')}</span>
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 10px; border-top: 1px solid #1a1e2c; padding-top: 10px;">
            <button class="btn btn-sm btn-outline" style="flex: 1;" onclick="window.VirtexOps.openEditStaffModal(${s.user_id})">
              ✏️ Edit Profile
            </button>
            <button class="btn btn-sm btn-outline" onclick="window.VirtexOps.openAssignRoleModal(${s.user_id}, '${escapeHtml(s.full_name)}', '${s.role}')">
              🛡️ Role
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. Render Roles & Permissions
  function renderRoles() {
    const container = document.getElementById('roles-grid');
    if (!container) return;

    container.innerHTML = state.roles.map(r => `
      <div class="admin-card" style="padding: 1.25rem; background: #11141e; border: 1px solid #1e2433; border-radius: 8px; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span class="badge badge-green font-mono text-xs">${escapeHtml(r.role_code.toUpperCase())}</span>
            <span class="font-mono text-xs text-dim">${r.assigned_staff_count || 0} Staff Assigned</span>
          </div>
          <h4 style="color: #fff; font-weight: 700; font-size: 1.05rem; margin-bottom: 4px;">${escapeHtml(r.name)}</h4>
          <p style="font-size: 0.82rem; color: var(--text-dim); line-height: 1.4; margin-bottom: 12px;">${escapeHtml(r.description || '')}</p>

          <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 6px; font-weight: 600;">Granted Permission Scopes:</div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${(r.permissions || []).map(p => `<span class="badge badge-outline font-mono text-xs">${escapeHtml(p)}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('');
  }

  // 3. Render Attendance Reports
  function renderAttendance() {
    const tbody = document.getElementById('attendance-tbody');
    if (!tbody) return;

    const punches = state.attendance.punches || [];
    if (punches.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim);">No attendance punch records found in the Routine Tracker.</td></tr>`;
      return;
    }

    tbody.innerHTML = punches.map(p => `
      <tr>
        <td class="font-mono text-xs">${formatDate(p.punch_date)}</td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(p.user_name || 'Staff Member')}</div>
          <span class="font-mono text-xs text-dim">${escapeHtml(p.user_role || '')} • ${escapeHtml(p.employee_id || '')}</span>
        </td>
        <td><span class="badge badge-outline text-xs">📍 ${escapeHtml(p.branch_name || 'Indiranagar')}</span></td>
        <td class="font-mono text-xs text-green">${p.punch_in ? formatTime(p.punch_in) : '--'}</td>
        <td class="font-mono text-xs text-cyan">${p.punch_out ? formatTime(p.punch_out) : '<span class="status-pill status-open">ACTIVE</span>'}</td>
        <td class="font-mono font-bold">${p.work_hours || 0} hrs</td>
        <td>
          <span class="status-pill status-${p.status === 'punched_out' ? 'completed' : 'open'}">
            ${p.status === 'punched_out' ? '● COMPLETED' : '● ON FLOOR'}
          </span>
        </td>
      </tr>
    `).join('');
  }

  // 4. Render Staff Shifts
  function renderShifts() {
    const tbody = document.getElementById('shifts-tbody');
    if (!tbody) return;

    let items = state.shifts.filter(s => {
      if (state.filters.shiftBranch !== 'all' && s.branch_id != state.filters.shiftBranch) return false;
      if (state.filters.shiftStatus !== 'all' && s.status !== state.filters.shiftStatus) return false;
      return true;
    });

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim);">No staff shifts scheduled.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(s => `
      <tr>
        <td class="font-mono text-xs">${formatDate(s.shift_date)}</td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(s.staff_name)}</div>
          <span class="font-mono text-xs text-dim">${escapeHtml(s.staff_role)}</span>
        </td>
        <td><span class="badge badge-outline text-xs">📍 ${escapeHtml(s.branch_name)}</span></td>
        <td><div style="font-weight: 500;">${escapeHtml(s.shift_type)}</div></td>
        <td class="font-mono text-xs">${s.start_time} - ${s.end_time}</td>
        <td><span class="status-pill status-${s.status}">${s.status.toUpperCase()}</span></td>
        <td>
          ${s.status === 'scheduled' ? `
            <button class="btn btn-sm btn-green" onclick="window.VirtexOps.markShiftCompleted(${s.id})">
              ✓ Complete
            </button>
          ` : '<span style="font-size: 0.75rem; color: #64748b;">Logged</span>'}
        </td>
      </tr>
    `).join('');
  }

  // 5. Render Branches
  function renderBranches() {
    const container = document.getElementById('branches-grid');
    if (!container) return;

    container.innerHTML = state.branches.map(b => `
      <div class="admin-card" style="padding: 1.25rem; background: #11141e; border: 1px solid #1e2433; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div>
            <h4 style="color: #fff; font-weight: 700; font-size: 1.1rem;">${escapeHtml(b.name)}</h4>
            <div class="font-mono text-xs text-dim">Code: ${escapeHtml(b.code)}</div>
          </div>
          <span class="status-pill status-open">ACTIVE</span>
        </div>

        <div style="font-size: 0.82rem; color: #cbd5e1; margin: 10px 0; line-height: 1.4;">
          <div>📍 ${escapeHtml(b.address)}, ${escapeHtml(b.city)}</div>
          <div>📞 ${escapeHtml(b.phone || 'N/A')}</div>
          <div>👤 <strong>Manager:</strong> ${escapeHtml(b.manager_name || 'Duty Lead')}</div>
          <div>⏰ <strong>Hours:</strong> ${escapeHtml(b.operating_hours)}</div>
        </div>

        <div style="display: flex; gap: 8px; font-size: 0.78rem; border-top: 1px solid #1a1e2c; padding-top: 8px; margin-top: 8px;">
          <span class="badge badge-outline">Staff: <strong>${b.staff_count}</strong></span>
          <span class="badge badge-outline">Zones: <strong>${b.facility_zones_count}</strong></span>
          <span class="badge badge-outline">Max: <strong>${b.max_capacity}</strong></span>
        </div>
      </div>
    `).join('');
  }

  // 6. Render Facility Zones
  function renderFacilities() {
    const tbody = document.getElementById('facilities-tbody');
    if (!tbody) return;

    let items = state.facilities.filter(f => {
      if (state.filters.facBranch !== 'all' && f.branch_id != state.filters.facBranch) return false;
      if (state.filters.facStatus !== 'all' && f.status !== state.filters.facStatus) return false;
      return true;
    });

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim);">No facility zones found.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(f => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(f.zone_name)}</div>
          <span class="text-xs text-dim">${escapeHtml(f.notes || '')}</span>
        </td>
        <td><span class="badge badge-outline text-xs">📍 ${escapeHtml(f.branch_name)}</span></td>
        <td><span class="badge badge-outline text-xs">${escapeHtml(f.facility_type)}</span></td>
        <td>${escapeHtml(f.floor_number)}</td>
        <td class="font-mono font-bold">${f.capacity} athletes</td>
        <td><span class="status-pill status-${f.status}">${f.status.toUpperCase()}</span></td>
        <td>
          <select class="ret-select text-xs" onchange="window.VirtexOps.changeFacilityStatus(${f.id}, this.value)">
            <option value="open" ${f.status === 'open' ? 'selected' : ''}>Open</option>
            <option value="maintenance" ${f.status === 'maintenance' ? 'selected' : ''}>Maintenance</option>
            <option value="closed" ${f.status === 'closed' ? 'selected' : ''}>Closed</option>
          </select>
        </td>
      </tr>
    `).join('');
  }

  // 7. Render Facility Maintenance Logs
  function renderMaintenance() {
    const tbody = document.getElementById('maintenance-tbody');
    if (!tbody) return;

    let items = state.maintenanceLogs.filter(m => {
      if (state.filters.maintStatus !== 'all' && m.status !== state.filters.maintStatus) return false;
      return true;
    });

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim);">No maintenance tickets found.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(m => `
      <tr>
        <td class="font-mono text-xs">${formatDate(m.scheduled_date)}</td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(m.zone_name)}</div>
          <span class="badge badge-outline text-xs">📍 ${escapeHtml(m.branch_name)}</span>
        </td>
        <td><div style="font-weight: 500;">${escapeHtml(m.maintenance_type)}</div></td>
        <td>${escapeHtml(m.technician_name)}</td>
        <td class="font-mono font-bold">${formatCurrency(m.cost)}</td>
        <td><span class="status-pill status-${m.status}">${m.status.toUpperCase()}</span></td>
        <td>
          ${m.status === 'scheduled' || m.status === 'in_progress' ? `
            <button class="btn btn-sm btn-green" onclick="window.VirtexOps.markMaintenanceCompleted(${m.id})">
              ✓ Complete
            </button>
          ` : '<span style="font-size: 0.75rem; color: #00e676;">✓ Verified</span>'}
        </td>
      </tr>
    `).join('');
  }

  // 8. Render Staff Performance
  function renderPerformance() {
    const tbody = document.getElementById('performance-tbody');
    if (!tbody) return;

    if (state.performance.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim);">No performance statistics computed.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.performance.map(p => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(p.name)}</div>
          <span class="font-mono text-xs text-dim">${escapeHtml(p.designation)}</span>
        </td>
        <td><span class="badge badge-outline text-xs">📍 ${escapeHtml(p.branchName)}</span></td>
        <td class="font-mono font-bold">${p.loggedHours} hrs</td>
        <td class="font-mono">${p.completedShifts} shifts</td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="font-mono font-bold text-green">${p.punctualityScore}%</span>
            <div style="width: 60px; height: 6px; background: #1e2433; border-radius: 3px; overflow: hidden;">
              <div style="width: ${p.punctualityScore}%; height: 100%; background: #00e676;"></div>
            </div>
          </div>
        </td>
        <td class="font-mono font-bold text-cyan">${p.activePtClients > 0 ? `${p.activePtClients} clients` : '--'}</td>
        <td class="font-mono font-bold text-amber">⭐ ${p.overallRating} / 5.0</td>
      </tr>
    `).join('');
  }

  // 9. Render Branch Analytics
  function renderBranchAnalytics() {
    if (!state.branchAnalytics) return;
    const { branches } = state.branchAnalytics;

    const container = document.getElementById('branch-analytics-grid');
    if (!container) return;

    container.innerHTML = branches.map(b => `
      <div class="branch-stat-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
          <div>
            <h4 style="color: #fff; font-weight: 800; font-size: 1.15rem;">${escapeHtml(b.name)}</h4>
            <div class="font-mono text-xs text-dim">Code: ${escapeHtml(b.code)} • ${escapeHtml(b.city)}</div>
          </div>
          <span class="badge badge-green font-mono text-xs">ONLINE</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0;">
          <div class="staff-info-box" style="margin: 0;">
            <span style="font-size: 0.72rem; color: #64748b; text-transform: uppercase;">Active Members</span>
            <span class="font-mono font-bold text-green" style="font-size: 1.25rem;">${b.activeMembers}</span>
          </div>
          <div class="staff-info-box" style="margin: 0;">
            <span style="font-size: 0.72rem; color: #64748b; text-transform: uppercase;">Capacity Utilization</span>
            <span class="font-mono font-bold text-cyan" style="font-size: 1.25rem;">${b.capacityUtilizationPct}%</span>
          </div>
          <div class="staff-info-box" style="margin: 0;">
            <span style="font-size: 0.72rem; color: #64748b; text-transform: uppercase;">Assigned Staff</span>
            <span class="font-mono font-bold" style="font-size: 1.25rem;">${b.staffCount}</span>
          </div>
          <div class="staff-info-box" style="margin: 0;">
            <span style="font-size: 0.72rem; color: #64748b; text-transform: uppercase;">Asset Valuation</span>
            <span class="font-mono font-bold text-amber" style="font-size: 1.1rem;">${formatCurrency(b.equipmentAssetValue)}</span>
          </div>
        </div>

        <div style="font-size: 0.8rem; color: #cbd5e1; border-top: 1px solid #1a1e2c; padding-top: 8px;">
          👤 Branch Manager: <strong>${escapeHtml(b.managerName)}</strong>
        </div>
      </div>
    `).join('');
  }

  // ==========================================
  // MODALS & ACTIONS
  // ==========================================
  function populateBranchDropdowns() {
    const selects = [
      document.getElementById('staff-filter-branch'),
      document.getElementById('shift-filter-branch'),
      document.getElementById('fac-filter-branch'),
      document.getElementById('modal-staff-branch'),
      document.getElementById('modal-shift-branch'),
      document.getElementById('modal-fac-branch'),
      document.getElementById('modal-maint-branch')
    ];
    selects.forEach(sel => {
      if (!sel) return;
      const isFilter = sel.id.includes('filter');
      sel.innerHTML = (isFilter ? `<option value="all">All Branches</option>` : `<option value="">-- Select Branch --</option>`) +
        state.branches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    });
  }

  function populateStaffDropdowns() {
    const selects = [
      document.getElementById('modal-shift-staff'),
      document.getElementById('modal-branch-manager')
    ];
    selects.forEach(sel => {
      if (!sel) return;
      sel.innerHTML = `<option value="">-- Select Staff Member --</option>` +
        state.staff.map(s => `<option value="${s.user_id}">${escapeHtml(s.full_name)} (${escapeHtml(s.role)})</option>`).join('');
    });
  }

  function populateFacilityDropdowns() {
    const sel = document.getElementById('modal-maint-fac');
    if (sel) {
      sel.innerHTML = `<option value="">-- Select Facility Zone --</option>` +
        state.facilities.map(f => `<option value="${f.id}">${escapeHtml(f.zone_name)} (${escapeHtml(f.branch_name)})</option>`).join('');
    }
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }

  function initModalHandlers() {
    // Open modal buttons
    const btnRegStaff = document.getElementById('btn-open-register-staff');
    if (btnRegStaff) btnRegStaff.addEventListener('click', () => openModal('modal-register-staff'));

    const btnSchedShift = document.getElementById('btn-open-schedule-shift');
    if (btnSchedShift) btnSchedShift.addEventListener('click', () => openModal('modal-schedule-shift'));

    const btnAddBranch = document.getElementById('btn-open-add-branch');
    if (btnAddBranch) btnAddBranch.addEventListener('click', () => openModal('modal-add-branch'));

    const btnAddFac = document.getElementById('btn-open-add-facility');
    if (btnAddFac) btnAddFac.addEventListener('click', () => openModal('modal-add-facility'));

    const btnSchedMaint = document.getElementById('btn-open-schedule-maint');
    if (btnSchedMaint) btnSchedMaint.addEventListener('click', () => openModal('modal-schedule-maint'));

    // Modal Close Buttons
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const overlay = btn.closest('.ops-modal-overlay');
        if (overlay) closeModal(overlay.id);
      });
    });

    initForms();
  }

  function initForms() {
    // 1. Register Staff Form
    const formRegStaff = document.getElementById('form-register-staff');
    if (formRegStaff) {
      formRegStaff.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          full_name: document.getElementById('modal-staff-name').value.trim(),
          email: document.getElementById('modal-staff-email').value.trim(),
          username: document.getElementById('modal-staff-username').value.trim() || undefined,
          role: document.getElementById('modal-staff-role').value,
          phone: document.getElementById('modal-staff-phone').value.trim(),
          branch_id: parseInt(document.getElementById('modal-staff-branch').value, 10) || null,
          department: document.getElementById('modal-staff-dept').value,
          designation: document.getElementById('modal-staff-desig').value.trim(),
          employment_type: document.getElementById('modal-staff-type').value,
          base_salary: parseFloat(document.getElementById('modal-staff-salary').value) || 0,
          emergency_contact_name: document.getElementById('modal-staff-emerg-name').value.trim(),
          emergency_contact_phone: document.getElementById('modal-staff-emerg-phone').value.trim()
        };

        try {
          const res = await apiFetch('/staff', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Staff registered successfully!');
            closeModal('modal-register-staff');
            formRegStaff.reset();
            loadStaff();
            loadPerformance();
          } else {
            showToast(res.message || 'Failed to register staff', 'error');
          }
        } catch (err) {
          showToast('Failed to register staff member', 'error');
        }
      });
    }

    // 2. Schedule Shift Form
    const formShift = document.getElementById('form-schedule-shift');
    if (formShift) {
      formShift.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          user_id: parseInt(document.getElementById('modal-shift-staff').value, 10),
          branch_id: parseInt(document.getElementById('modal-shift-branch').value, 10),
          shift_date: document.getElementById('modal-shift-date').value,
          shift_type: document.getElementById('modal-shift-type').value,
          start_time: document.getElementById('modal-shift-start').value,
          end_time: document.getElementById('modal-shift-end').value,
          notes: document.getElementById('modal-shift-notes').value.trim()
        };

        try {
          const res = await apiFetch('/shifts', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Staff shift scheduled!');
            closeModal('modal-schedule-shift');
            formShift.reset();
            loadShifts();
          } else {
            showToast(res.message || 'Failed to schedule shift', 'error');
          }
        } catch (err) {
          showToast('Failed to schedule shift', 'error');
        }
      });
    }

    // 3. Add Branch Form
    const formBranch = document.getElementById('form-add-branch');
    if (formBranch) {
      formBranch.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          name: document.getElementById('modal-branch-name').value.trim(),
          code: document.getElementById('modal-branch-code').value.trim().toUpperCase(),
          address: document.getElementById('modal-branch-address').value.trim(),
          city: document.getElementById('modal-branch-city').value.trim(),
          phone: document.getElementById('modal-branch-phone').value.trim(),
          manager_id: parseInt(document.getElementById('modal-branch-manager').value, 10) || null,
          max_capacity: parseInt(document.getElementById('modal-branch-capacity').value, 10) || 150
        };

        try {
          const res = await apiFetch('/branches', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Branch added successfully!');
            closeModal('modal-add-branch');
            formBranch.reset();
            loadBranches();
            loadBranchAnalytics();
          } else {
            showToast(res.message || 'Failed to add branch', 'error');
          }
        } catch (err) {
          showToast('Failed to add branch', 'error');
        }
      });
    }

    // 4. Add Facility Form
    const formFac = document.getElementById('form-add-facility');
    if (formFac) {
      formFac.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          branch_id: parseInt(document.getElementById('modal-fac-branch').value, 10),
          zone_name: document.getElementById('modal-fac-name').value.trim(),
          facility_type: document.getElementById('modal-fac-type').value,
          floor_number: document.getElementById('modal-fac-floor').value.trim(),
          capacity: parseInt(document.getElementById('modal-fac-cap').value, 10) || 30,
          status: 'open'
        };

        try {
          const res = await apiFetch('/facilities', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Facility zone added!');
            closeModal('modal-add-facility');
            formFac.reset();
            loadFacilities();
          } else {
            showToast(res.message || 'Failed to add zone', 'error');
          }
        } catch (err) {
          showToast('Failed to add facility zone', 'error');
        }
      });
    }

    // 5. Schedule Maintenance Form
    const formMaint = document.getElementById('form-schedule-maint');
    if (formMaint) {
      formMaint.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          facility_id: parseInt(document.getElementById('modal-maint-fac').value, 10),
          branch_id: parseInt(document.getElementById('modal-maint-branch').value, 10),
          maintenance_type: document.getElementById('modal-maint-type').value.trim(),
          technician_name: document.getElementById('modal-maint-tech').value.trim(),
          scheduled_date: document.getElementById('modal-maint-date').value,
          cost: parseFloat(document.getElementById('modal-maint-cost').value) || 0,
          status: 'scheduled'
        };

        try {
          const res = await apiFetch('/maintenance', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Facility maintenance scheduled!');
            closeModal('modal-schedule-maint');
            formMaint.reset();
            loadMaintenance();
          } else {
            showToast(res.message || 'Failed to schedule maintenance', 'error');
          }
        } catch (err) {
          showToast('Failed to schedule maintenance', 'error');
        }
      });
    }

    // 6. Update Role Form
    const formRole = document.getElementById('form-assign-role');
    if (formRole) {
      formRole.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('modal-role-user-id').value;
        const newRole = document.getElementById('modal-role-select').value;

        try {
          const res = await apiFetch(`/staff/${userId}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role: newRole })
          });
          if (res && res.success) {
            showToast('Staff role updated!');
            closeModal('modal-assign-role');
            loadStaff();
            loadRoles();
          } else {
            showToast(res.message || 'Failed to update role', 'error');
          }
        } catch (err) {
          showToast('Failed to update staff role', 'error');
        }
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==========================================
  // WINDOW EXPORTS
  // ==========================================
  window.VirtexOps = {
    openAssignRoleModal(userId, userName, currentRole) {
      document.getElementById('modal-role-user-id').value = userId;
      document.getElementById('modal-role-user-name').value = userName;
      document.getElementById('modal-role-select').value = currentRole;
      openModal('modal-assign-role');
    },

    openEditStaffModal(userId) {
      const s = state.staff.find(st => st.user_id === userId);
      if (!s) return;
      document.getElementById('modal-staff-name').value = s.full_name;
      document.getElementById('modal-staff-email').value = s.email;
      document.getElementById('modal-staff-role').value = s.role;
      document.getElementById('modal-staff-phone').value = s.phone || '';
      if (s.branch_id) document.getElementById('modal-staff-branch').value = s.branch_id;
      document.getElementById('modal-staff-dept').value = s.department || 'Operations';
      document.getElementById('modal-staff-desig').value = s.designation || '';
      openModal('modal-register-staff');
    },

    async markShiftCompleted(shiftId) {
      try {
        const res = await apiFetch(`/shifts/${shiftId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed' })
        });
        if (res && res.success) {
          showToast('Shift marked completed!');
          loadShifts();
          loadPerformance();
        }
      } catch (e) {
        showToast('Failed to update shift', 'error');
      }
    },

    async changeFacilityStatus(facId, status) {
      try {
        const res = await apiFetch(`/facilities/${facId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status })
        });
        if (res && res.success) {
          showToast(`Zone status changed to ${status}`);
          loadFacilities();
        }
      } catch (e) {
        showToast('Failed to update status', 'error');
      }
    },

    async markMaintenanceCompleted(maintId) {
      try {
        const res = await apiFetch(`/maintenance/${maintId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed' })
        });
        if (res && res.success) {
          showToast('Maintenance marked completed!');
          loadMaintenance();
          loadFacilities();
        }
      } catch (e) {
        showToast('Failed to complete maintenance', 'error');
      }
    },

    exportReportSummary() {
      window.print();
    }
  };
  window.PulseCoreOps = window.VirtexOps;

})();
