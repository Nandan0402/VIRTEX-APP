/**
 * Virtex Admin - System Administration Controller
 * 
 * Handles 10 Core System Administration Features:
 * 1. Admin and Staff Permission Overview (RBAC Matrix)
 * 2. Login Activity History
 * 3. Audit-Log Explorer
 * 4. Database Backup Status & Verification
 * 5. Sanitized Data Export Tools (JSON / CSV)
 * 6. Security Activity Monitoring & Intrusion Alerts
 * 7. API Integration Status & Latency Gauges
 * 8. System Health Dashboard (Node.js Heap, DB Pool, CPU)
 * 9. Error Monitoring & Resolution
 * 10. Application Activity Reports
 * 
 * SECURITY GUARANTEE:
 * Passwords, password hashes, API secrets, and JWT tokens are NEVER exposed.
 */

(function () {
  'use strict';

  // API Endpoints
  const API_BASE = '/api/system-admin';
  const API_ADMIN_BASE = '/api/admin/system-admin';

  // Local State
  let state = {
    currentTab: 'permissions',
    roles: [],
    staffUsers: [],
    loginHistory: [],
    auditLogs: [],
    backups: [],
    exportLogs: [],
    securityOverview: null,
    integrations: [],
    healthMetrics: null,
    errorLogs: [],
    activityReports: null,
    filters: {
      loginSearch: '',
      loginStatus: 'all',
      auditEventType: 'all',
      auditSearch: '',
      errorStatus: 'all',
      errorType: 'all'
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
      headers: { ...getAuthHeaders(), ...(options.headers || {}) }
    };

    try {
      let res = await fetch(`${API_BASE}${endpoint}`, opts);
      if (res.status === 404) {
        res = await fetch(`${API_ADMIN_BASE}${endpoint}`, opts);
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      console.warn(`System Admin API fetch failed for ${endpoint}:`, err.message);
      throw err;
    }
  }

  // Toast Notification
  function showToast(msg, type = 'info') {
    let toast = document.getElementById('sys-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sys-toast';
      toast.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 9999;
        padding: 12px 20px; border-radius: 8px; font-weight: 600;
        font-size: 0.9rem; display: flex; align-items: center; gap: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4); transition: all 0.3s ease;
      `;
      document.body.appendChild(toast);
    }

    const bgMap = {
      success: 'linear-gradient(135deg, #00e676, #00b0ff)',
      error: 'linear-gradient(135deg, #ff5252, #b71c1c)',
      warning: 'linear-gradient(135deg, #ffab00, #ff6d00)',
      info: 'linear-gradient(135deg, #00b0ff, #b388ff)'
    };

    toast.style.background = bgMap[type] || bgMap.info;
    toast.style.color = '#fff';
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 4000);
  }

  // ==========================================
  // INITIALIZATION & TAB NAVIGATION
  // ==========================================
  async function init() {
    setupTabNavigation();
    setupFilters();
    setupModals();
    await loadInitialData();
  }

  function setupTabNavigation() {
    const tabBtns = document.querySelectorAll('.sys-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        if (!targetTab) return;

        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.sys-tab-content').forEach(c => {
          c.style.display = 'none';
        });

        const activePanel = document.getElementById(`tab-content-${targetTab}`);
        if (activePanel) {
          activePanel.style.display = 'block';
        }

        state.currentTab = targetTab;
        handleTabChange(targetTab);
      });
    });

    // Check URL hash on initial load
    if (window.location.hash) {
      const hash = window.location.hash.replace('#', '').toLowerCase();
      const matchingBtn = Array.from(tabBtns).find(b => b.getAttribute('data-tab') === hash);
      if (matchingBtn) matchingBtn.click();
    }
  }

  function handleTabChange(tab) {
    switch (tab) {
      case 'permissions':
        loadPermissionsOverview();
        break;
      case 'logins':
        loadLoginActivity();
        break;
      case 'audit':
        loadAuditLogs();
        break;
      case 'backups':
        loadBackups();
        break;
      case 'exports':
        loadExportLogs();
        break;
      case 'security':
        loadSecurityOverview();
        break;
      case 'integrations':
        loadIntegrations();
        break;
      case 'health':
        loadHealthMetrics();
        break;
      case 'errors':
        loadErrorLogs();
        break;
      case 'reports':
        loadActivityReports();
        break;
    }
  }

  // ==========================================
  // DATA LOADERS
  // ==========================================
  async function loadInitialData() {
    try {
      await Promise.allSettled([
        loadPermissionsOverview(),
        loadBackups(),
        loadSecurityOverview(),
        loadIntegrations(),
        loadHealthMetrics(),
        loadErrorLogs()
      ]);
      updateKpis();
    } catch (err) {
      console.error('Failed to load initial system admin data:', err);
    }
  }

  async function loadPermissionsOverview() {
    try {
      const res = await apiFetch('/permissions');
      if (res.success) {
        state.roles = res.data.roles || [];
        state.staffUsers = res.data.staffUsers || [];
        renderPermissionsOverview();
        updateKpis();
      }
    } catch (err) {
      console.error('Error loading permissions:', err);
    }
  }

  async function loadLoginActivity() {
    try {
      const params = new URLSearchParams();
      if (state.filters.loginSearch) params.append('username', state.filters.loginSearch);
      if (state.filters.loginStatus !== 'all') params.append('status', state.filters.loginStatus);
      params.append('limit', '50');

      const res = await apiFetch(`/logins?${params.toString()}`);
      if (res.success) {
        state.loginHistory = res.data || [];
        renderLoginActivity();
      }
    } catch (err) {
      console.error('Error loading login activity:', err);
    }
  }

  async function loadAuditLogs() {
    try {
      const params = new URLSearchParams();
      if (state.filters.auditEventType !== 'all') params.append('eventType', state.filters.auditEventType);
      if (state.filters.auditSearch) params.append('search', state.filters.auditSearch);
      params.append('limit', '100');

      const res = await apiFetch(`/audit-logs?${params.toString()}`);
      if (res.success) {
        state.auditLogs = res.data || [];
        renderAuditLogs();
      }
    } catch (err) {
      console.error('Error loading audit logs:', err);
    }
  }

  async function loadBackups() {
    try {
      const res = await apiFetch('/backups');
      if (res.success) {
        state.backups = res.data || [];
        renderBackups();
        updateKpis();
      }
    } catch (err) {
      console.error('Error loading backups:', err);
    }
  }

  async function loadExportLogs() {
    try {
      const res = await apiFetch('/exports');
      if (res.success) {
        state.exportLogs = res.data || [];
        renderExportLogs();
      }
    } catch (err) {
      console.error('Error loading export logs:', err);
    }
  }

  async function loadSecurityOverview() {
    try {
      const res = await apiFetch('/security');
      if (res.success) {
        state.securityOverview = res.data || {};
        renderSecurityOverview();
        updateKpis();
      }
    } catch (err) {
      console.error('Error loading security overview:', err);
    }
  }

  async function loadIntegrations() {
    try {
      const res = await apiFetch('/integrations');
      if (res.success) {
        state.integrations = res.data || [];
        renderIntegrations();
        updateKpis();
      }
    } catch (err) {
      console.error('Error loading integrations:', err);
    }
  }

  async function loadHealthMetrics() {
    try {
      const res = await apiFetch('/health');
      if (res.success) {
        state.healthMetrics = res.data || {};
        renderHealthMetrics();
        updateKpis();
      }
    } catch (err) {
      console.error('Error loading health metrics:', err);
    }
  }

  async function loadErrorLogs() {
    try {
      const params = new URLSearchParams();
      if (state.filters.errorStatus !== 'all') params.append('status', state.filters.errorStatus);
      if (state.filters.errorType !== 'all') params.append('errorType', state.filters.errorType);
      params.append('limit', '50');

      const res = await apiFetch(`/errors?${params.toString()}`);
      if (res.success) {
        state.errorLogs = res.data || [];
        renderErrorLogs();
        updateKpis();
      }
    } catch (err) {
      console.error('Error loading error logs:', err);
    }
  }

  async function loadActivityReports() {
    try {
      const res = await apiFetch('/activity-reports');
      if (res.success) {
        state.activityReports = res.data || {};
        renderActivityReports();
      }
    } catch (err) {
      console.error('Error loading activity reports:', err);
    }
  }

  // ==========================================
  // KPI CALCULATIONS
  // ==========================================
  function updateKpis() {
    const kpiStaff = document.getElementById('kpi-total-staff');
    const kpiFailed = document.getElementById('kpi-failed-logins');
    const kpiUptime = document.getElementById('kpi-system-uptime');
    const kpiErrors = document.getElementById('kpi-open-errors');
    const kpiIntegrations = document.getElementById('kpi-healthy-integrations');
    const kpiBackups = document.getElementById('kpi-backup-status');

    if (kpiStaff) kpiStaff.textContent = state.staffUsers.length;
    if (kpiFailed && state.securityOverview) {
      kpiFailed.textContent = state.securityOverview.failedLoginsLast24h || 0;
    }
    if (kpiUptime && state.healthMetrics) {
      kpiUptime.textContent = '0h 0m 0s'; // live value intentionally not shown (set to 0 by request)
    }
    if (kpiErrors) {
      const openCount = state.errorLogs.filter(e => e.status === 'unresolved').length;
      kpiErrors.textContent = openCount;
      const tabBadgeErrors = document.getElementById('tab-badge-errors');
      if (tabBadgeErrors) tabBadgeErrors.textContent = openCount;
    }
    if (kpiIntegrations) {
      const healthy = state.integrations.filter(i => i.status === 'healthy').length;
      kpiIntegrations.textContent = `${healthy} / ${state.integrations.length}`;
    }
    if (kpiBackups) {
      const latest = state.backups[0];
      kpiBackups.textContent = latest ? latest.status.toUpperCase() : 'NONE';
    }

    const tabBadgeBackups = document.getElementById('tab-badge-backups');
    if (tabBadgeBackups) tabBadgeBackups.textContent = state.backups.length;
  }

  // ==========================================
  // RENDER: PERMISSIONS OVERVIEW (FEATURE 1)
  // ==========================================
  function renderPermissionsOverview() {
    // 1. Roles Matrix
    const tbodyRoles = document.getElementById('tbody-roles-matrix');
    if (tbodyRoles && state.roles.length === 0) {
      tbodyRoles.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-dim);">No role definitions configured.</td></tr>`;
    } else if (tbodyRoles) {
      tbodyRoles.innerHTML = state.roles.map(r => {
        const perms = Array.isArray(r.permissions) ? r.permissions : [];
        const isWildcard = perms.includes('*');

        return `
          <tr>
            <td>
              <span class="font-bold text-white">${escapeHtml(r.name)}</span>
              <div class="font-mono text-xs text-dim">${escapeHtml(r.role_code)}</div>
            </td>
            <td style="color: #cbd5e1; font-size: 0.85rem;">${escapeHtml(r.description || '—')}</td>
            <td>
              <span class="badge badge-outline font-mono">${r.user_count || 0} users</span>
            </td>
            <td>
              ${isWildcard 
                ? `<span class="perm-tag all">FULL UNRESTRICTED ACCESS (*)</span>` 
                : perms.map(p => `<span class="perm-tag">${escapeHtml(p)}</span>`).join('')}
            </td>
          </tr>
        `;
      }).join('');
    }

    // 2. Staff Accounts List
    const tbodyStaff = document.getElementById('tbody-staff-accounts');
    if (tbodyStaff) {
      tbodyStaff.innerHTML = state.staffUsers.map(s => {
        const lastLoginStr = s.last_login_at 
          ? new Date(s.last_login_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) 
          : 'Never';

        return `
          <tr>
            <td>
              <div class="font-bold text-white">${escapeHtml(s.full_name)}</div>
              ${s.username && !s.username.includes('@') && s.username !== s.email
                ? `<div class="font-mono text-xs text-dim">@${escapeHtml(s.username)}</div>`
                : '' /* username is an email: already shown in the Email column */}
            </td>
            <td>${escapeHtml(s.email)}</td>
            <td><span class="badge-sys info font-mono">${escapeHtml(String(s.role_name || s.role || '').replace(/_/g, ' ').toUpperCase())}</span></td>
            <td>
              <span class="badge-sys ${s.is_active ? 'success' : 'failure'}">
                ${s.is_active ? 'ACTIVE' : 'SUSPENDED'}
              </span>
            </td>
            <td class="font-mono text-xs text-dim">${lastLoginStr}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // ==========================================
  // RENDER: LOGIN ACTIVITY (FEATURE 2)
  // ==========================================
  function renderLoginActivity() {
    const tbody = document.getElementById('tbody-login-activity');
    if (!tbody) return;

    if (state.loginHistory.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-dim);">No login activity records match the selected filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.loginHistory.map(l => {
      const isSuccess = l.event_type === 'LOGIN_SUCCESS';
      const timeStr = new Date(l.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

      return `
        <tr>
          <td class="font-mono text-xs text-dim">${timeStr}</td>
          <td class="font-bold text-white">${escapeHtml(l.username)}</td>
          <td>
            <span class="badge-sys ${isSuccess ? 'success' : 'failure'}">
              ${escapeHtml(l.event_type)}
            </span>
          </td>
          <td><span class="badge badge-outline font-mono text-xs">${escapeHtml(l.role || 'guest')}</span></td>
          <td class="font-mono text-xs text-white">${escapeHtml(l.ip_address || '127.0.0.1')}</td>
          <td style="max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.78rem; color:var(--text-dim);">
            ${escapeHtml(l.user_agent || 'Unknown Client')}
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // RENDER: AUDIT LOGS (FEATURE 3)
  // ==========================================
  function renderAuditLogs() {
    const tbody = document.getElementById('tbody-audit-logs');
    if (!tbody) return;

    if (state.auditLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-dim);">No audit logs found matching criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.auditLogs.map(a => {
      const timeStr = new Date(a.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      const detailsStr = a.details ? JSON.stringify(a.details) : '—';

      return `
        <tr>
          <td class="font-mono text-xs text-dim">${timeStr}</td>
          <td class="font-bold text-white">${escapeHtml(a.username)}</td>
          <td><span class="badge-sys info">${escapeHtml(a.event_type)}</span></td>
          <td><span class="badge badge-outline font-mono text-xs">${escapeHtml(a.role || 'system')}</span></td>
          <td class="font-mono text-xs">${escapeHtml(a.ip_address || '—')}</td>
          <td style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:'JetBrains Mono'; font-size:0.75rem; color:#cbd5e1;">
            ${escapeHtml(detailsStr)}
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // RENDER: DATABASE BACKUPS (FEATURE 4)
  // ==========================================
  function renderBackups() {
    const tbody = document.getElementById('tbody-database-backups');
    if (!tbody) return;

    if (state.backups.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-dim);">No database snapshots recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.backups.map(b => {
      const isVerified = b.status === 'verified';
      const sizeMb = (b.file_size_bytes / 1024 / 1024).toFixed(2);
      const timeStr = new Date(b.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

      return `
        <tr>
          <td>
            <div class="font-bold text-white">${escapeHtml(b.backup_name)}</div>
            <div class="font-mono text-xs text-dim" style="max-width:280px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(b.file_path)}</div>
          </td>
          <td><span class="badge badge-outline font-mono">${escapeHtml(b.backup_type)}</span></td>
          <td class="font-mono font-bold text-white">${sizeMb} MB</td>
          <td>
            <span class="badge-sys ${isVerified ? 'success' : 'warning'}">
              ${b.status.toUpperCase()}
            </span>
          </td>
          <td class="font-mono text-xs text-dim">${timeStr}</td>
          <td class="font-mono text-xs" style="max-width:140px; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(b.checksum || 'sha256-verified')}
          </td>
          <td>
            ${!isVerified ? `
              <button class="btn btn-sm btn-outline btn-verify-backup" data-id="${b.id}" style="border-color:var(--sys-accent); color:var(--sys-accent);">
                Verify Checksum
              </button>
            ` : `<span class="badge-sys success">✓ VERIFIED</span>`}
          </td>
        </tr>
      `;
    }).join('');

    // Attach verify handler
    tbody.querySelectorAll('.btn-verify-backup').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-id');
        try {
          const res = await apiFetch(`/backups/${id}/verify`, { method: 'PATCH' });
          if (res.success) {
            showToast('Backup verified clean', 'success');
            await loadBackups();
          }
        } catch (err) {
          showToast(`Verification failed: ${err.message}`, 'error');
        }
      };
    });
  }

  // ==========================================
  // RENDER: DATA EXPORTS (FEATURE 5)
  // ==========================================
  function renderExportLogs() {
    const tbody = document.getElementById('tbody-export-logs');
    if (!tbody) return;

    if (state.exportLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-dim);">No data exports logged yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.exportLogs.map(e => {
      const timeStr = new Date(e.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      const sizeKb = (e.file_size_bytes / 1024).toFixed(1);

      return `
        <tr>
          <td class="font-mono text-xs text-dim">${timeStr}</td>
          <td class="font-bold text-white">${escapeHtml(e.export_name)}</td>
          <td><span class="badge badge-outline">${escapeHtml(e.entity_type.toUpperCase())}</span></td>
          <td><span class="badge-sys info font-mono">${escapeHtml(e.export_format.toUpperCase())}</span></td>
          <td class="font-mono">${e.record_count} records (${sizeKb} KB)</td>
          <td><span class="font-mono text-xs text-dim">@${escapeHtml(e.exported_by)}</span></td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // RENDER: SECURITY OVERVIEW (FEATURE 6)
  // ==========================================
  function renderSecurityOverview() {
    if (!state.securityOverview) return;
    const s = state.securityOverview;

    const secFailedEl = document.getElementById('sec-failed-24h');
    const secTokensEl = document.getElementById('sec-blacklisted-tokens');
    const secSessionsEl = document.getElementById('sec-active-sessions');
    const secIpsList = document.getElementById('sec-suspicious-ips');

    if (secFailedEl) secFailedEl.textContent = s.failedLoginsLast24h || 0;
    if (secTokensEl) secTokensEl.textContent = s.activeBlacklistedTokens || 0;
    if (secSessionsEl) secSessionsEl.textContent = s.activeStaffSessions || 0;

    if (secIpsList && Array.isArray(s.suspiciousIps)) {
      if (s.suspiciousIps.length === 0) {
        secIpsList.innerHTML = `<div style="color:var(--text-dim); padding:10px;">Zero malicious IP anomalies detected in past 7 days.</div>`;
      } else {
        secIpsList.innerHTML = s.suspiciousIps.map(ip => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
            <div>
              <span class="font-mono font-bold text-white">🌐 ${escapeHtml(ip.ip_address)}</span>
              <div class="text-xs text-dim">Last attempt: ${new Date(ip.last_attempt).toLocaleTimeString()}</div>
            </div>
            <span class="badge-sys failure">${ip.failed_count} failed attempts</span>
          </div>
        `).join('');
      }
    }
  }

  // ==========================================
  // RENDER: API INTEGRATIONS (FEATURE 7)
  // ==========================================
  function renderIntegrations() {
    const grid = document.getElementById('integrations-grid');
    if (!grid) return;

    grid.innerHTML = state.integrations.map(i => {
      const isHealthy = i.status === 'healthy';
      const badgeClass = isHealthy ? 'success' : i.status === 'standby' ? 'info' : 'warning';

      return `
        <div class="integration-card">
          <div class="integration-header">
            <div>
              <div class="integration-title">${escapeHtml(i.serviceName)}</div>
              <div class="integration-category">${escapeHtml(i.category)}</div>
            </div>
            <span class="badge-sys ${badgeClass}">${i.status.toUpperCase()}</span>
          </div>

          <div style="font-family:'JetBrains Mono', monospace; font-size:0.78rem; color:#94a3b8; word-break:break-all;">
            ${escapeHtml(i.endpoint)}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto; padding-top:8px; border-top:1px solid rgba(255,255,255,0.05);">
            <span class="latency-pill">${i.latencyMs} ms latency</span>
            <span style="font-size:0.75rem; color:var(--text-dim);">${escapeHtml(i.details)}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // ==========================================
  // RENDER: SYSTEM HEALTH (FEATURE 8)
  // ==========================================
  // NOTE: by request, System Health cards display 0 instead of live server readings.
  function renderHealthMetrics() {
    if (!state.healthMetrics) return;
    const h = state.healthMetrics;

    const runtimeEl = document.getElementById('health-runtime-info');
    const memoryEl = document.getElementById('health-memory-info');
    const cpuEl = document.getElementById('health-cpu-info');
    const dbPoolEl = document.getElementById('health-db-pool-info');

    if (runtimeEl && h.runtime) {
      runtimeEl.innerHTML = `
        <div class="health-metric-value" style="color:var(--sys-accent);">0h 0m 0s</div>
        <div style="font-size:0.82rem; color:var(--text-dim); margin-top:4px;">
          Node — • — • PID —
        </div>
      `;
    }

    if (memoryEl && h.memory) {
      memoryEl.innerHTML = `
        <div class="health-metric-value" style="color:var(--sys-blue);">0 MB</div>
        <div style="font-size:0.82rem; color:var(--text-dim); margin-top:4px;">
          Allocated: 0 MB • RSS: 0 MB (0% used)
        </div>
      `;
    }

    if (cpuEl && h.cpu) {
      cpuEl.innerHTML = `
        <div class="health-metric-value" style="color:var(--sys-purple);">0 Cores</div>
        <div style="font-size:0.82rem; color:var(--text-dim); margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          —
        </div>
      `;
    }

    if (dbPoolEl && h.database) {
      dbPoolEl.innerHTML = `
        <div class="health-metric-value" style="color:var(--sys-amber);">0 Conn</div>
        <div style="font-size:0.82rem; color:var(--text-dim); margin-top:4px;">
          Idle: 0 • Waiting Queue: 0
        </div>
      `;
    }
  }

  // ==========================================
  // RENDER: ERROR MONITORING (FEATURE 9)
  // ==========================================
  function renderErrorLogs() {
    const tbody = document.getElementById('tbody-error-logs');
    if (!tbody) return;

    if (state.errorLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-dim);">No application exceptions logged. All systems running stably.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.errorLogs.map(e => {
      const isResolved = e.status === 'resolved';
      const timeStr = new Date(e.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      return `
        <tr>
          <td class="font-mono text-xs text-dim">${timeStr}</td>
          <td>
            <span class="badge-sys ${isResolved ? 'success' : 'failure'}">
              ${escapeHtml(e.error_code || 'APP_ERR')}
            </span>
          </td>
          <td><span class="badge badge-outline font-mono text-xs">${escapeHtml(e.error_type)}</span></td>
          <td style="max-width:320px; color:#cbd5e1; font-size:0.85rem;">
            ${escapeHtml(e.message)}
          </td>
          <td class="font-mono font-bold text-white text-center">${e.occurrence_count || 1}</td>
          <td>
            <span class="badge-sys ${isResolved ? 'success' : 'warning'}">
              ${e.status.toUpperCase()}
            </span>
          </td>
          <td>
            ${!isResolved ? `
              <button class="btn btn-sm btn-green btn-resolve-error" data-id="${e.id}">
                Resolve
              </button>
            ` : `<span class="text-xs text-dim font-mono">Resolved by ${escapeHtml(e.resolved_by || 'Admin')}</span>`}
          </td>
        </tr>
      `;
    }).join('');

    // Attach resolve handlers
    tbody.querySelectorAll('.btn-resolve-error').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-id');
        try {
          const res = await apiFetch(`/errors/${id}/resolve`, { method: 'PATCH' });
          if (res.success) {
            showToast('Error marked as resolved', 'success');
            await loadErrorLogs();
          }
        } catch (err) {
          showToast(`Failed to resolve error: ${err.message}`, 'error');
        }
      };
    });
  }

  // ==========================================
  // RENDER: APPLICATION ACTIVITY (FEATURE 10)
  // ==========================================
  function renderActivityReports() {
    if (!state.activityReports) return;
    const r = state.activityReports;

    const repCheckins = document.getElementById('rep-total-checkins');
    const repInteractions = document.getElementById('rep-total-interactions');
    const repCommands = document.getElementById('rep-total-commands');
    const repAudits = document.getElementById('rep-total-audits');

    if (repCheckins && r.totals) repCheckins.textContent = r.totals.total_check_ins || 0;
    if (repInteractions && r.totals) repInteractions.textContent = r.totals.total_interactions || 0;
    if (repCommands && r.totals) repCommands.textContent = r.totals.total_robot_commands || 0;
    if (repAudits && r.totals) repAudits.textContent = r.totals.total_audit_entries || 0;
  }

  // ==========================================
  // FILTERS & MODALS
  // ==========================================
  function setupFilters() {
    // Login filters
    const loginSearch = document.getElementById('input-login-search');
    const loginStatus = document.getElementById('filter-login-status');
    if (loginSearch) loginSearch.oninput = () => { state.filters.loginSearch = loginSearch.value; loadLoginActivity(); };
    if (loginStatus) loginStatus.onchange = () => { state.filters.loginStatus = loginStatus.value; loadLoginActivity(); };

    // Audit filters
    const auditSearch = document.getElementById('input-audit-search');
    const auditEvent = document.getElementById('filter-audit-event');
    if (auditSearch) auditSearch.oninput = () => { state.filters.auditSearch = auditSearch.value; loadAuditLogs(); };
    if (auditEvent) auditEvent.onchange = () => { state.filters.auditEventType = auditEvent.value; loadAuditLogs(); };

    // Error filters
    const errorStatus = document.getElementById('filter-error-status');
    const errorType = document.getElementById('filter-error-type');
    if (errorStatus) errorStatus.onchange = () => { state.filters.errorStatus = errorStatus.value; loadErrorLogs(); };
    if (errorType) errorType.onchange = () => { state.filters.errorType = errorType.value; loadErrorLogs(); };
  }

  function setupModals() {
    // Trigger Backup button
    const btnTriggerBackup = document.getElementById('btn-open-backup-modal');
    if (btnTriggerBackup) {
      btnTriggerBackup.onclick = () => openModal('modal-trigger-backup');
    }

    // Export Buttons
    document.querySelectorAll('.btn-trigger-export').forEach(btn => {
      btn.onclick = async () => {
        const entity = btn.getAttribute('data-entity');
        const format = btn.getAttribute('data-format') || 'json';

        try {
          showToast(`Exporting sanitized ${entity} data...`, 'info');
          const res = await apiFetch('/export', {
            method: 'POST',
            body: JSON.stringify({ entityType: entity, format })
          });

          if (res.success) {
            // Trigger browser download
            const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = res.meta.exportName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast(`Exported ${res.meta.recordCount} sanitized records successfully!`, 'success');
            await loadExportLogs();
          }
        } catch (err) {
          showToast(`Export failed: ${err.message}`, 'error');
        }
      };
    });

    // Close buttons
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.onclick = () => closeModal();
    });

    // Form: Trigger Backup
    const formBackup = document.getElementById('form-trigger-backup');
    if (formBackup) {
      formBackup.onsubmit = async (e) => {
        e.preventDefault();
        const notes = document.getElementById('backup-notes').value.trim();
        try {
          const res = await apiFetch('/backups', {
            method: 'POST',
            body: JSON.stringify({ notes })
          });
          if (res.success) {
            showToast('Database snapshot created successfully', 'success');
            closeModal();
            formBackup.reset();
            await loadBackups();
          }
        } catch (err) {
          showToast(`Backup failed: ${err.message}`, 'error');
        }
      };
    }
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function closeModal() {
    document.querySelectorAll('.sys-modal-overlay').forEach(ov => ov.classList.remove('active'));
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

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

