/**
 * adminApp.js - Main Application Controller for PulseCore Admin Console
 * Connects all modules to live PostgreSQL APIs:
 * 1. Gym profile/hours
 * 2. Membership plans (CRUD)
 * 3. Members directory (CRUD + Search + Filter + Pagination)
 * 4. Trainer profiles & schedules (CRUD)
 * 5. On Floor/In Session/Off Duty availability
 * 6. Announcements noticeboard (CRUD)
 * 7. FAQ / Knowledge base (CRUD + Search + Lang Filter)
 * 8. Enquiries / Kiosk leads (Status update + Filter)
 * 9. Interaction logs audit feed
 * 10. Robot motor controls & diagnostics logs
 */

import { adminState } from './adminState.js';
import { adminApi } from './adminApi.js';
import { RealtimeClient } from '../services/realtimeClient.js';

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

class AdminDashboardApp {
  constructor() {
    this.currentTab = 'tab-overview';
    this.telemetryInterval = null;
    this.searchDebounceTimer = null;
  }

  async init() {
    console.log('[AdminApp] Bootstrapping PulseCore Admin Console...');

    // 1. Authenticate / Verify Session
    await this.initSession();

    // 2. Setup Navigation & Modals
    this.setupTabNavigation();
    this.setupMobileSidebar();
    this.setupModals();

    // 3. Setup Form Handlers (CRUD operations)
    this.setupMemberForm();
    this.setupTrainerForm();
    this.setupPlanForm();
    this.setupFaqForm();
    this.setupAnnouncementForm();
    this.setupProfileForm();
    this.setupSettingsForm();
    this.setupRoleSwitcher();
    this.setupLogoutModal();

    // 4. Setup Search & Filter Toolbars
    this.setupSearchAndFilters();

    // 5. Setup Robot Motor Sliders & Gestures
    this.setupRobotMotorControls();

    // 6. Fetch all real data from PostgreSQL
    await this.loadAllData();

    // 7. Subscribe to state changes for UI updates
    adminState.subscribe(() => {
      this.updateTopbarUser();
      this.applyRbacGates();
    });

    // 8. Start telemetry heartbeat polling (every 3 seconds)
    this.pollTelemetry();
    this.telemetryInterval = setInterval(() => this.pollTelemetry(), 3000);
  }

  // =========================================================================
  // AUTHENTICATION & INITIALIZATION
  // =========================================================================

  async initSession() {
    let user = adminApi.getStoredUser();
    let token = adminApi.getToken();

    // If no token exists, authenticate automatically as Owner for seamless local development
    if (!token || !user) {
      console.log('[AdminApp] No active session found. Logging in as default Owner (owner_manju)...');
      const loginRes = await adminApi.login('owner_manju', 'OwnerPass2026!');
      if (loginRes.success) {
        user = loginRes.data.user;
      }
    } else {
      // Validate existing token with server
      const meRes = await adminApi.getCurrentUser();
      if (meRes.success) {
        user = meRes.data;
      } else {
        // Token expired or invalid, re-login
        const loginRes = await adminApi.login('owner_manju', 'OwnerPass2026!');
        if (loginRes.success) user = loginRes.data.user;
      }
    }

    if (user) {
      adminState.setUser(user);
      this.updateTopbarUser();
      this.setupRealtimeSync(adminApi.getToken());
    }
  }

  setupRealtimeSync(token) {
    if (this.realtime) {
      this.realtime.setToken(token);
      return;
    }

    this.realtime = new RealtimeClient({
      channel: 'admin',
      token,
      onStatusChange: (status) => {
        const indicator = document.getElementById('topbar-live-sync-pill');
        if (indicator) {
          if (status === 'connected') {
            indicator.className = 'badge badge-green font-mono';
            indicator.textContent = '● Live Sync';
          } else if (status === 'reconnecting') {
            indicator.className = 'badge badge-warning font-mono';
            indicator.textContent = '○ Reconnecting...';
          } else {
            indicator.className = 'badge badge-muted font-mono';
            indicator.textContent = '○ Offline';
          }
        }
      },
    });

    // 1. Live Member Check-In Event from Kiosk
    this.realtime.on('MEMBER_CHECKED_IN', (data) => {
      const memberName = data.member?.full_name || 'Gym Member';
      const code = data.member?.member_code || '';
      this.showToast(`⚡ Live Check-In: ${memberName} (${code}) granted entry.`);

      if (this.currentTab === 'tab-overview') {
        this.loadDashboardData();
      } else if (this.currentTab === 'tab-members') {
        this.loadMembersData();
      }
    });

    // 2. Live Enquiry / Kiosk Lead Captured
    this.realtime.on('ENQUIRY_RECEIVED', (data) => {
      const leadName = data.full_name || data.fullName || 'Prospective Member';
      const plan = data.plan_name || data.planName || 'Membership';
      this.showToast(`📬 New Kiosk Enquiry: ${leadName} for [${plan}]!`);

      if (this.currentTab === 'tab-enquiries') {
        this.loadEnquiriesData();
      } else if (this.currentTab === 'tab-overview') {
        this.loadDashboardData();
      }
    });

    // 3. Robot Hardware Telemetry & Command Logs
    this.realtime.on('ROBOT_STATUS_CHANGED', (state) => {
      if (state) {
        this.updateRobotHardwareUI(state);
      }
    });

    this.realtime.on('ROBOT_COMMAND_QUEUED', () => {
      if (this.currentTab === 'tab-robot') {
        this.loadRobotData();
      }
    });

    this.realtime.on('ROBOT_COMMAND_UPDATED', () => {
      if (this.currentTab === 'tab-robot') {
        this.fetchRobotLogs();
      }
    });

    this.realtime.on('ROBOT_ALERT', (alert) => {
      this.showToast(`[Robot Alert] ${alert?.message || 'Hardware event recorded'}`, true);
      if (this.currentTab === 'tab-robot') {
        this.fetchHardwareLogs();
      }
    });

    // 4. Trainer Floor Availability Update
    this.realtime.on('TRAINER_STATUS_UPDATED', () => {
      if (this.currentTab === 'tab-trainers') {
        this.loadTrainersData();
      }
    });

    // 5. Membership Plan Update
    this.realtime.on('PLAN_UPDATED', () => {
      if (this.currentTab === 'tab-plans') this.loadPlansData();
    });
    this.realtime.on('PLAN_STATUS_CHANGED', () => {
      if (this.currentTab === 'tab-plans') this.loadPlansData();
    });

    // 6. Announcement & FAQ Updates
    this.realtime.on('ANNOUNCEMENT_UPDATED', () => {
      if (this.currentTab === 'tab-announcements') this.loadAnnouncementsData();
    });
    this.realtime.on('FAQ_UPDATED', () => {
      if (this.currentTab === 'tab-faqs') this.loadFaqsData();
    });

    // 7. Reconnection Re-sync with PostgreSQL
    this.realtime.on('RECONNECTED', () => {
      console.log('[AdminApp] WebSocket reconnected. Re-syncing tab data...');
      this.loadAllData();
    });
  }

  updateTopbarUser() {
    const user = adminState.state.user;
    if (!user) return;

    const tag = document.getElementById('topbar-role-tag');
    const username = document.getElementById('topbar-username');
    const sidebarPill = document.getElementById('sidebar-role-pill');
    const sidebarDesc = document.getElementById('sidebar-session-desc');

    const roleName = (user.role || 'owner').toUpperCase();

    if (tag) {
      tag.textContent = roleName;
      tag.className = `role-tag ${(user.role || 'owner').toLowerCase()}`;
    }
    if (username) {
      username.textContent = user.username || user.fullName || 'Admin';
    }
    if (sidebarPill) {
      sidebarPill.textContent = `${roleName} SESSION ACTIVE`;
    }
    if (sidebarDesc) {
      sidebarDesc.textContent = `User: ${user.fullName || user.username} (${user.role})`;
    }
  }

  applyRbacGates() {
    const role = (adminState.state.user?.role || 'owner').toLowerCase();

    // Nav items
    const profileBtn = document.querySelector('[data-tab="tab-profile"]');
    const settingsBtn = document.querySelector('[data-tab="tab-settings"]');
    const plansBtn = document.querySelector('[data-tab="tab-plans"]');
    const faqsBtn = document.querySelector('[data-tab="tab-faqs"]');
    const annBtn = document.querySelector('[data-tab="tab-announcements"]');

    if (role === 'trainer') {
      if (profileBtn) profileBtn.classList.add('disabled-role');
      if (settingsBtn) settingsBtn.classList.add('disabled-role');
      if (plansBtn) plansBtn.classList.add('disabled-role');
      if (faqsBtn) faqsBtn.classList.add('disabled-role');
      if (annBtn) annBtn.classList.add('disabled-role');
    } else {
      document.querySelectorAll('.disabled-role').forEach((el) => el.classList.remove('disabled-role'));
    }
  }

  showToast(message, isError = false) {
    const toast = document.getElementById('toast-banner');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `toast-banner ${isError ? 'error' : ''}`;
    toast.style.display = 'block';

    setTimeout(() => {
      toast.style.display = 'none';
    }, 3500);
  }

  // =========================================================================
  // NAVIGATION & MODALS
  // =========================================================================

  setupTabNavigation() {
    const navButtons = document.querySelectorAll('.nav-item-btn');
    const pageTitle = document.getElementById('page-title');

    navButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTabId = btn.dataset.tab;

        // RBAC check
        const role = (adminState.state.user?.role || 'owner').toLowerCase();
        if (role === 'trainer' && ['tab-profile', 'tab-settings', 'tab-plans', 'tab-faqs', 'tab-announcements'].includes(targetTabId)) {
          this.showToast(`Access Restricted: ${role.toUpperCase()} role does not have permission for this section.`, true);
          return;
        }

        navButtons.forEach((b) => {
          b.classList.remove('active');
          b.removeAttribute('aria-current');
        });

        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');

        this.currentTab = targetTabId;

        document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
        const activePanel = document.getElementById(targetTabId);
        if (activePanel) activePanel.classList.add('active');

        if (pageTitle) pageTitle.textContent = btn.innerText.trim();

        // Refresh specific tab data on activation
        if (targetTabId === 'tab-members') this.fetchMembers();
        if (targetTabId === 'tab-enquiries') this.fetchEnquiries();
        if (targetTabId === 'tab-trainers') this.fetchTrainers();
        if (targetTabId === 'tab-plans') this.fetchPlans();
        if (targetTabId === 'tab-faqs') this.fetchFaqs();
        if (targetTabId === 'tab-announcements') this.fetchAnnouncements();
        if (targetTabId === 'tab-robot') this.loadRobotData();

        const sidebar = document.getElementById('admin-sidebar');
        if (sidebar && window.innerWidth <= 768) sidebar.classList.remove('open');
      });
    });
  }

  setupMobileSidebar() {
    const toggleBtn = document.getElementById('btn-sidebar-toggle');
    const sidebar = document.getElementById('admin-sidebar');
    toggleBtn?.addEventListener('click', () => sidebar?.classList.toggle('open'));
  }

  setupModals() {
    document.getElementById('btn-open-member-modal')?.addEventListener('click', () => {
      this.openModal('modal-member');
    });
    document.getElementById('btn-open-trainer-modal')?.addEventListener('click', () => {
      this.openModal('modal-trainer');
    });
    document.getElementById('btn-open-plan-modal')?.addEventListener('click', () => {
      this.openModal('modal-plan');
    });
    document.getElementById('btn-open-faq-modal')?.addEventListener('click', () => {
      this.openModal('modal-faq');
    });
    document.getElementById('btn-open-ann-modal')?.addEventListener('click', () => {
      this.openModal('modal-ann');
    });

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.closeModal(btn.dataset.closeModal);
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal.id);
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.active').forEach((modal) => {
          this.closeModal(modal.id);
        });
      }
    });
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea');
    if (firstInput) firstInput.focus();
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }

  // =========================================================================
  // DATA FETCHING & RENDERING (PostgreSQL Connected)
  // =========================================================================

  async loadAllData() {
    await Promise.all([
      this.fetchDashboardStats(),
      this.fetchGymProfile(),
      this.fetchPlans(),
      this.fetchTrainers(),
      this.fetchFaqs(),
      this.fetchAnnouncements(),
      this.fetchMembers(),
      this.fetchEnquiries(),
      this.fetchInteractionLogs(),
      this.loadRobotData(),
    ]);
  }

  // --- 1. Dashboard Stats & Speech Languages ---
  async fetchDashboardStats() {
    try {
      const res = await adminApi.getDashboardStats();
      if (res.success && res.data) {
        adminState.state.stats = { ...adminState.state.stats, ...res.data };

        const elToday = document.getElementById('stat-daily-checkins');
        const elTotal = document.getElementById('stat-total-members');
        const elLeads = document.getElementById('stat-queries-handled');
        const elRobot = document.getElementById('stat-robot-uptime');

        if (elToday) elToday.textContent = res.data.todayCheckIns ?? 0;
        if (elTotal) elTotal.textContent = res.data.totalMembers ?? 0;
        if (elLeads) elLeads.textContent = (res.data.pendingLeads ?? 0) + ' Leads';
        if (elRobot) {
          elRobot.textContent = res.data.robotOnline ? '100% Online' : 'Standby';
          elRobot.className = `stat-val font-mono ${res.data.robotOnline ? 'text-green' : 'text-warning'}`;
        }
      }
    } catch (err) {
      console.warn('[AdminApp] Dashboard stats error:', err);
    }
  }

  // --- 2. Gym Profile & Settings ---
  async fetchGymProfile() {
    try {
      const res = await adminApi.getGymProfile();
      if (res.success && res.data) {
        const d = res.data;
        adminState.state.gymProfile = {
          name: d.gym_name || d.name,
          tagline: d.tagline,
          phone: d.phone,
          email: d.email,
          address: d.address,
          hours: d.operating_hours || [],
        };
        adminState.state.settings = {
          defaultLanguage: d.default_language || 'en-IN',
          speechRate: d.speech_rate || 1.0,
          speechPitch: d.speech_pitch || 1.0,
        };

        this.populateProfileForm();
        this.populateSettingsForm();
      }
    } catch (err) {
      console.warn('[AdminApp] Profile fetch error:', err);
    }
  }

  populateProfileForm() {
    const prof = adminState.state.gymProfile;
    const nameInput = document.getElementById('prof-name');
    if (!nameInput) return;

    nameInput.value = prof.name || '';
    document.getElementById('prof-tagline').value = prof.tagline || '';
    document.getElementById('prof-phone').value = prof.phone || '';
    document.getElementById('prof-email').value = prof.email || '';
    document.getElementById('prof-address').value = prof.address || '';
  }

  populateSettingsForm() {
    const s = adminState.state.settings;
    const langSelect = document.getElementById('setting-default-lang');
    if (!langSelect) return;

    langSelect.value = s.defaultLanguage || 'en-IN';
    document.getElementById('setting-speech-rate').value = s.speechRate || 1.0;
    document.getElementById('val-speech-rate').textContent = `${s.speechRate || 1.0}x`;
    document.getElementById('setting-speech-pitch').value = s.speechPitch || 1.0;
    document.getElementById('val-speech-pitch').textContent = s.speechPitch || 1.0;
  }

  // --- 3. Members Directory (Search + Filter + Pagination) ---
  async fetchMembers() {
    const tbody = document.getElementById('members-table-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="8" class="loading-indicator">Loading members from PostgreSQL...</td></tr>`;

    const { search, status } = adminState.state.memberFilter;
    const { page, limit } = adminState.state.memberPagination;

    const res = await adminApi.getMembers({ search, status, page, limit });

    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state text-danger">Failed to load members: ${escapeHtml(res.error)}</td></tr>`;
      return;
    }

    const members = res.data || [];
    const pagination = res.pagination || { total: members.length, page: 1, totalPages: 1 };
    adminState.state.members = members;
    adminState.state.memberPagination = pagination;

    const countLabel = document.getElementById('member-count-label');
    if (countLabel) countLabel.textContent = `Total: ${pagination.total} member${pagination.total !== 1 ? 's' : ''}`;

    const pageInfo = document.getElementById('member-page-info');
    if (pageInfo) pageInfo.textContent = `Page ${pagination.page} of ${pagination.totalPages}`;

    const prevBtn = document.getElementById('btn-member-prev');
    const nextBtn = document.getElementById('btn-member-next');
    if (prevBtn) prevBtn.disabled = pagination.page <= 1;
    if (nextBtn) nextBtn.disabled = pagination.page >= pagination.totalPages;

    if (members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No gym members match the selected criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = members
      .map(
        (m) => `
      <tr>
        <td class="font-mono text-green font-semibold">${escapeHtml(m.member_code)}</td>
        <td><strong>${escapeHtml(m.full_name)}</strong></td>
        <td class="font-mono text-xs">${escapeHtml(m.phone)}</td>
        <td class="text-xs text-dim">${escapeHtml(m.email || '—')}</td>
        <td><span class="badge badge-dim">${escapeHtml(m.plan_name || 'Standard')}</span></td>
        <td><span class="badge badge-dim font-mono">${escapeHtml(m.preferred_language || 'en-IN')}</span></td>
        <td>
          <span class="badge ${m.status === 'active' ? 'badge-green' : m.status === 'frozen' ? 'badge-warning' : 'badge-danger'}">
            ${escapeHtml(m.status)}
          </span>
        </td>
        <td>
          <button class="btn-table-action btn-view-history" data-id="${m.id}" data-name="${escapeHtml(m.full_name)}" data-code="${escapeHtml(m.member_code)}" title="View Check-In History">📋</button>
          <button class="btn-table-action btn-toggle-member" data-id="${m.id}" data-status="${m.status}" title="Toggle Active/Frozen">⏸️</button>
          <button class="btn-table-action btn-del-member" data-id="${m.id}" title="Remove Member">🗑️</button>
        </td>
      </tr>
    `
      )
      .join('');

    // Attach actions
    tbody.querySelectorAll('.btn-view-history').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openMemberHistoryModal(btn.dataset.id, btn.dataset.name, btn.dataset.code);
      });
    });

    tbody.querySelectorAll('.btn-toggle-member').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newStatus = btn.dataset.status === 'active' ? 'frozen' : 'active';
        const res = await adminApi.updateMember(btn.dataset.id, { status: newStatus });
        if (res.success) {
          this.showToast(`Member status set to ${newStatus}`);
          this.fetchMembers();
        } else {
          this.showToast(res.error || 'Failed to update member status', true);
        }
      });
    });

    tbody.querySelectorAll('.btn-del-member').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Delete this member and associated records?')) {
          const res = await adminApi.deleteMember(btn.dataset.id);
          if (res.success) {
            this.showToast('Member removed from database.');
            this.fetchMembers();
          } else {
            this.showToast(res.error || 'Failed to delete member', true);
          }
        }
      });
    });
  }

  async openMemberHistoryModal(memberId, fullName, memberCode) {
    const title = document.getElementById('history-modal-title');
    const subtitle = document.getElementById('history-modal-subtitle');
    const tbody = document.getElementById('member-history-table-body');

    if (title) title.textContent = `Check-In History: ${fullName}`;
    if (subtitle) subtitle.textContent = `Code: ${memberCode} • ID: ${memberId}`;
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="loading-indicator">Loading history records...</td></tr>`;

    this.openModal('modal-member-history');

    const res = await adminApi.getMemberHistory(memberId);
    if (!res.success || !res.data) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="empty-state text-danger">${escapeHtml(res.error || 'Unable to retrieve history.')}</td></tr>`;
      return;
    }

    const history = res.data.history || [];
    if (history.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No check-in entries logged yet.</td></tr>`;
      return;
    }

    if (tbody) {
      tbody.innerHTML = history
        .map(
          (h) => `
        <tr>
          <td class="font-mono text-xs">${new Date(h.check_in_time).toLocaleString()}</td>
          <td><span class="badge badge-green font-mono">${escapeHtml(h.check_in_method || 'voice_kiosk')}</span></td>
          <td class="text-xs text-dim">${escapeHtml(h.plan_name || 'Active Contract')}</td>
        </tr>
      `
        )
        .join('');
    }
  }

  // --- 4. Enquiries & Leads ---
  async fetchEnquiries() {
    const tbody = document.getElementById('enquiries-table-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="8" class="loading-indicator">Loading leads from PostgreSQL...</td></tr>`;

    const res = await adminApi.getEnquiries(50);
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state text-danger">Failed to load leads: ${escapeHtml(res.error)}</td></tr>`;
      return;
    }

    let leads = res.data || [];
    const filter = adminState.state.enquiryFilter;

    if (filter.status && filter.status !== 'all') {
      leads = leads.filter((l) => l.status === filter.status);
    }
    if (filter.search && filter.search.trim()) {
      const q = filter.search.toLowerCase().trim();
      leads = leads.filter(
        (l) =>
          l.full_name.toLowerCase().includes(q) ||
          l.phone.includes(q) ||
          (l.plan_name && l.plan_name.toLowerCase().includes(q))
      );
    }

    const countLabel = document.getElementById('enquiry-count-label');
    if (countLabel) countLabel.textContent = `Total: ${leads.length} lead${leads.length !== 1 ? 's' : ''}`;

    if (leads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No enquiries match the current filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = leads
      .map(
        (l) => `
      <tr>
        <td class="font-mono text-xs text-dim">${new Date(l.created_at).toLocaleDateString()}</td>
        <td><strong>${escapeHtml(l.full_name)}</strong></td>
        <td class="font-mono text-xs">${escapeHtml(l.phone)}</td>
        <td class="text-xs text-dim">${escapeHtml(l.email || '—')}</td>
        <td><span class="badge badge-dim">${escapeHtml(l.plan_name || 'Inquiry')}</span></td>
        <td class="text-xs font-mono">${escapeHtml(l.preferred_timing || 'Flexible')}</td>
        <td class="text-xs">${escapeHtml(l.notes || '—')}</td>
        <td>
          <select class="status-select enquiry-status-select" data-id="${l.id}">
            <option value="new" ${l.status === 'new' ? 'selected' : ''}>🔵 New</option>
            <option value="contacted" ${l.status === 'contacted' ? 'selected' : ''}>🟡 Contacted</option>
            <option value="converted" ${l.status === 'converted' ? 'selected' : ''}>🟢 Converted</option>
            <option value="closed" ${l.status === 'closed' ? 'selected' : ''}>⚪ Closed</option>
          </select>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.enquiry-status-select').forEach((sel) => {
      sel.addEventListener('change', async (e) => {
        const id = sel.dataset.id;
        const newStatus = e.target.value;
        const updateRes = await adminApi.updateEnquiryStatus(id, { status: newStatus });
        if (updateRes.success) {
          this.showToast(`Lead #${id} status updated to [${newStatus}]`);
        } else {
          this.showToast(updateRes.error || 'Failed to update enquiry status', true);
        }
      });
    });
  }

  // --- 5. Trainers & Floor Availability ---
  async fetchTrainers() {
    const tbody = document.getElementById('trainers-table-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="loading-indicator">Loading trainers from PostgreSQL...</td></tr>`;

    const { status, search } = adminState.state.trainerFilter;
    const res = await adminApi.getTrainers(status);

    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state text-danger">Failed to load trainers: ${escapeHtml(res.error)}</td></tr>`;
      return;
    }

    let trainers = res.data || [];
    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      trainers = trainers.filter(
        (t) =>
          t.full_name.toLowerCase().includes(q) ||
          t.specialty.toLowerCase().includes(q) ||
          t.trainer_code.toLowerCase().includes(q)
      );
    }

    const countLabel = document.getElementById('trainer-count-label');
    if (countLabel) countLabel.textContent = `Total: ${trainers.length} trainer${trainers.length !== 1 ? 's' : ''}`;

    if (trainers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No trainers match your filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = trainers
      .map(
        (t) => `
      <tr>
        <td class="font-mono text-green">${escapeHtml(t.trainer_code)}</td>
        <td><strong>${escapeHtml(t.full_name)}</strong></td>
        <td>${escapeHtml(t.specialty)}</td>
        <td class="font-mono text-xs">${escapeHtml(t.shift_start ? `${t.shift_start} - ${t.shift_end}` : '06:00 - 14:00')}</td>
        <td class="font-mono text-xs">${escapeHtml(t.phone)}</td>
        <td>
          <select class="status-select trainer-status-select" data-id="${t.id}">
            <option value="on_floor" ${t.status === 'on_floor' ? 'selected' : ''}>🟢 On Floor</option>
            <option value="in_session" ${t.status === 'in_session' ? 'selected' : ''}>🟡 In Session</option>
            <option value="off_duty" ${t.status === 'off_duty' ? 'selected' : ''}>⚪ Off Duty</option>
          </select>
        </td>
        <td>
          <button class="btn-table-action btn-del-trainer" data-id="${t.id}" title="Remove Trainer">🗑️</button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.trainer-status-select').forEach((sel) => {
      sel.addEventListener('change', async (e) => {
        const id = sel.dataset.id;
        const newStatus = e.target.value;
        const res = await adminApi.updateTrainerStatus(id, newStatus);
        if (res.success) {
          this.showToast(`Trainer floor status updated to '${newStatus}'.`);
        } else {
          this.showToast(res.error || 'Failed to update trainer status', true);
        }
      });
    });

    tbody.querySelectorAll('.btn-del-trainer').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to remove this trainer from the floor roster?')) {
          const res = await adminApi.deleteTrainer(btn.dataset.id);
          if (res.success) {
            this.showToast('Trainer removed from roster.');
            this.fetchTrainers();
          } else {
            this.showToast(res.error || 'Failed to remove trainer', true);
          }
        }
      });
    });
  }

  // --- 6. Membership Plans ---
  async fetchPlans() {
    const tbody = document.getElementById('plans-table-body');
    const planSelect = document.getElementById('mem-plan');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="loading-indicator">Loading plans from PostgreSQL...</td></tr>`;

    const res = await adminApi.getPlans(true);
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state text-danger">Failed to load plans: ${escapeHtml(res.error)}</td></tr>`;
      return;
    }

    const plans = res.data || [];
    adminState.state.plans = plans;

    // Populate plan select in member modal
    if (planSelect) {
      planSelect.innerHTML = `<option value="">Select a Plan...</option>` +
        plans
          .filter((p) => p.is_active)
          .map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (₹${p.price_inr})</option>`)
          .join('');
    }

    const countLabel = document.getElementById('plan-count-label');
    if (countLabel) countLabel.textContent = `Total: ${plans.length} plan${plans.length !== 1 ? 's' : ''}`;

    if (plans.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No membership plans found in database.</td></tr>`;
      return;
    }

    tbody.innerHTML = plans
      .map(
        (p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${p.duration_months} Month${p.duration_months > 1 ? 's' : ''}</td>
        <td class="font-mono font-semibold text-green">₹${Number(p.price_inr).toLocaleString()}</td>
        <td><span class="badge badge-dim">${escapeHtml(p.badge_label || 'Standard')}</span></td>
        <td class="text-xs text-dim">${(Array.isArray(p.perks) ? p.perks : []).map(escapeHtml).join(' • ')}</td>
        <td>
          <span class="badge ${p.is_active ? 'badge-green' : 'badge-dim'}">${p.is_active ? 'Active' : 'Archived'}</span>
        </td>
        <td>
          <button class="btn-table-action btn-toggle-plan" data-id="${p.id}" title="Toggle Plan Status">
            ${p.is_active ? '⏸️' : '▶️'}
          </button>
          <button class="btn-table-action btn-del-plan" data-id="${p.id}" title="Delete Plan">🗑️</button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.btn-toggle-plan').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await adminApi.togglePlan(btn.dataset.id);
        if (res.success) {
          this.showToast('Plan status toggled.');
          this.fetchPlans();
        } else {
          this.showToast(res.error || 'Failed to toggle plan status', true);
        }
      });
    });

    tbody.querySelectorAll('.btn-del-plan').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Permanently delete this membership plan?')) {
          const res = await adminApi.deletePlan(btn.dataset.id);
          if (res.success) {
            this.showToast('Plan deleted.');
            this.fetchPlans();
          } else {
            this.showToast(res.error || 'Failed to delete plan', true);
          }
        }
      });
    });
  }

  // --- 7. FAQs / Knowledge Base ---
  async fetchFaqs() {
    const tbody = document.getElementById('faqs-table-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="loading-indicator">Loading FAQs from PostgreSQL...</td></tr>`;

    const { language, search } = adminState.state.faqFilter;
    const res = await adminApi.getFaqs({ language, q: search });

    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-danger">Failed to load FAQs: ${escapeHtml(res.error)}</td></tr>`;
      return;
    }

    const faqs = res.data || [];
    const countLabel = document.getElementById('faq-count-label');
    if (countLabel) countLabel.textContent = `Total: ${faqs.length} FAQ${faqs.length !== 1 ? 's' : ''}`;

    if (faqs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No FAQs found matching filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = faqs
      .map(
        (f) => `
      <tr>
        <td><span class="badge badge-dim font-mono">${escapeHtml(f.language)}</span></td>
        <td><span class="badge badge-dim">${escapeHtml(f.category)}</span></td>
        <td><strong>${escapeHtml(f.question)}</strong></td>
        <td class="text-xs">${escapeHtml(f.answer)}</td>
        <td><span class="badge badge-green font-mono">${escapeHtml(f.suggested_gesture || 'NOD_YES')}</span></td>
        <td>
          <button class="btn-table-action btn-del-faq" data-id="${f.id}" title="Delete FAQ">🗑️</button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.btn-del-faq').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Delete this knowledge base FAQ?')) {
          const res = await adminApi.deleteFaq(btn.dataset.id);
          if (res.success) {
            this.showToast('FAQ deleted.');
            this.fetchFaqs();
          } else {
            this.showToast(res.error || 'Failed to delete FAQ', true);
          }
        }
      });
    });
  }

  // --- 8. Announcements Noticeboard ---
  async fetchAnnouncements() {
    const tbody = document.getElementById('announcements-table-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="5" class="loading-indicator">Loading announcements from PostgreSQL...</td></tr>`;

    const res = await adminApi.getAnnouncements(false);
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state text-danger">Failed to load notices: ${escapeHtml(res.error)}</td></tr>`;
      return;
    }

    const notices = res.data || [];
    const countLabel = document.getElementById('ann-count-label');
    if (countLabel) countLabel.textContent = `Total: ${notices.length} notice${notices.length !== 1 ? 's' : ''}`;

    if (notices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No noticeboard announcements published yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = notices
      .map(
        (a) => `
      <tr>
        <td class="font-mono text-xs">${escapeHtml(a.start_date || a.created_at?.slice(0, 10))}</td>
        <td><strong>${escapeHtml(a.title)}</strong></td>
        <td class="text-xs">${escapeHtml(a.message)}</td>
        <td>
          <span class="badge ${a.priority === 'urgent' ? 'badge-danger' : a.priority === 'event' ? 'badge-green' : 'badge-warning'}">
            ${escapeHtml((a.priority || 'NORMAL').toUpperCase())}
          </span>
        </td>
        <td>
          <button class="btn-table-action btn-del-ann" data-id="${a.id}" title="Delete Announcement">🗑️</button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.btn-del-ann').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Delete this noticeboard announcement?')) {
          const res = await adminApi.deleteAnnouncement(btn.dataset.id);
          if (res.success) {
            this.showToast('Notice removed.');
            this.fetchAnnouncements();
          } else {
            this.showToast(res.error || 'Failed to remove notice', true);
          }
        }
      });
    });
  }

  // --- 9. Interaction History Audit Table ---
  async fetchInteractionLogs() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="5" class="loading-indicator">Loading interaction logs...</td></tr>`;

    const res = await adminApi.getRecentInteractions(20);
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state text-danger">Failed to load logs: ${escapeHtml(res.error)}</td></tr>`;
      return;
    }

    const logs = res.data || [];
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No speech interactions recorded yet.</td></tr>`;
      return;
    }

    // Compute languages distribution for stats
    let en = 0, kn = 0, hi = 0;
    logs.forEach((l) => {
      if (l.language === 'en-IN') en++;
      else if (l.language === 'kn-IN') kn++;
      else if (l.language === 'hi-IN') hi++;
    });

    const total = en + kn + hi || 1;
    const langBars = document.getElementById('lang-stats-bars');
    if (langBars) {
      langBars.innerHTML = `
        <div class="lang-bar-card">
          <div class="lang-bar-header">
            <span>🇬🇧 English (en-IN)</span>
            <span class="font-mono text-green">${en} (${Math.round((en / total) * 100)}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${(en / total) * 100}%"></div>
          </div>
        </div>
        <div class="lang-bar-card">
          <div class="lang-bar-header">
            <span>🇮🇳 Kannada (kn-IN)</span>
            <span class="font-mono text-green">${kn} (${Math.round((kn / total) * 100)}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${(kn / total) * 100}%"></div>
          </div>
        </div>
        <div class="lang-bar-card">
          <div class="lang-bar-header">
            <span>🇮🇳 Hindi (hi-IN)</span>
            <span class="font-mono text-green">${hi} (${Math.round((hi / total) * 100)}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${(hi / total) * 100}%"></div>
          </div>
        </div>
      `;
    }

    tbody.innerHTML = logs
      .map(
        (l) => `
      <tr>
        <td class="font-mono text-xs text-dim">${new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td><strong>${escapeHtml(l.user_query)}</strong></td>
        <td class="text-xs">${escapeHtml(l.robot_response)}</td>
        <td><span class="badge badge-dim font-mono">${escapeHtml(l.language)}</span></td>
        <td><span class="badge badge-green font-mono">${escapeHtml(l.intent_detected || 'QUERY')}</span></td>
      </tr>
    `
      )
      .join('');
  }

  // --- 10. Robot Hardware Telemetry & Command Dispatches ---
  async loadRobotData() {
    await Promise.all([
      this.fetchRobotLogs(),
      this.fetchRobotDiagnostics(),
      this.fetchHardwareLogs(),
    ]);
  }

  updateRobotHardwareUI(state) {
    if (!state) return;
    const dot = document.getElementById('admin-robot-dot');
    const text = document.getElementById('admin-robot-text');
    const diagLast = document.getElementById('hw-diag-last-heartbeat');
    const diagNet = document.getElementById('hw-diag-network');
    const diagRssi = document.getElementById('hw-diag-rssi');
    const diagBat = document.getElementById('hw-diag-battery');

    if (state.online) {
      if (dot) dot.className = 'status-dot online';
      if (text) text.textContent = `ESP32 Online (${state.ipAddress || 'Active'})`;
    } else {
      if (dot) dot.className = 'status-dot offline';
      if (text) text.textContent = 'ESP32 Base Offline';
    }

    if (diagLast && state.lastHeartbeat) {
      diagLast.textContent = `Heartbeat: ${new Date(state.lastHeartbeat).toLocaleTimeString()}`;
    }
    if (diagNet && state.ipAddress) {
      diagNet.textContent = `${state.ipAddress} (${state.online ? 'Online' : 'Standby'})`;
    }
    if (diagRssi && state.wifiRssi !== undefined && state.wifiRssi !== null) {
      const sig = state.wifiRssi > -67 ? 'Excellent' : state.wifiRssi > -75 ? 'Good' : 'Fair';
      diagRssi.textContent = `RSSI: ${state.wifiRssi} dBm (${sig})`;
    }
    if (diagBat && (state.batteryLevel !== undefined || state.batteryVoltage !== undefined)) {
      const pct = state.batteryLevel !== undefined && state.batteryLevel !== null ? `${state.batteryLevel}%` : '85%';
      const volt = state.batteryVoltage ? ` (${Number(state.batteryVoltage).toFixed(2)}V)` : '';
      diagBat.textContent = `${pct}${volt}`;
    }
  }

  async fetchRobotDiagnostics() {
    try {
      const res = await adminApi.getRobotDiagnostics();
      if (res.success && res.data) {
        const device = res.data.device || {};
        const live = res.data.liveState || {};
        const deviceId = document.getElementById('hw-diag-device-id');
        const net = document.getElementById('hw-diag-network');
        const rssi = document.getElementById('hw-diag-rssi');
        const bat = document.getElementById('hw-diag-battery');
        const last = document.getElementById('hw-diag-last-heartbeat');

        const uuid = live.deviceUuid || device.device_uuid || 'ESP32_RECEPTION_01';
        if (deviceId) deviceId.textContent = uuid;

        const ip = live.ipAddress || device.ip_address || '127.0.0.1';
        const st = live.online ? 'Online' : (device.status === 'online' ? 'Online' : 'Standby');
        if (net) net.textContent = `${ip} (${st})`;

        const rVal = live.wifiRssi !== null && live.wifiRssi !== undefined ? live.wifiRssi : device.wifi_rssi;
        if (rssi && rVal !== null && rVal !== undefined) {
          const sig = rVal > -67 ? 'Excellent' : rVal > -75 ? 'Good' : 'Fair';
          rssi.textContent = `RSSI: ${rVal} dBm (${sig})`;
        }

        const bLevel = live.batteryLevel !== null && live.batteryLevel !== undefined ? live.batteryLevel : device.battery_level;
        const bVolt = live.batteryVoltage || device.battery_voltage;
        if (bat) {
          const pct = bLevel !== null && bLevel !== undefined ? `${bLevel}%` : '88%';
          const volt = bVolt ? ` (${Number(bVolt).toFixed(2)}V)` : (bLevel ? ` (~4.10V)` : '');
          bat.textContent = `${pct}${volt}`;
        }

        const hb = live.lastHeartbeat || device.last_heartbeat;
        if (last && hb) {
          last.textContent = `Heartbeat: ${new Date(hb).toLocaleTimeString()}`;
        }
      }
    } catch {
      // Keep existing displayed telemetry
    }
  }

  async fetchHardwareLogs() {
    const tbody = document.getElementById('robot-hw-logs-table-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="loading-indicator">Loading hardware events...</td></tr>`;

    const res = await adminApi.getHardwareLogs(25);
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-danger">Failed to load hardware events: ${escapeHtml(res.error)}</td></tr>`;
      return;
    }

    const logs = res.data || [];
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hardware errors or anomalies recorded. ESP32 nominal.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs
      .map(
        (l) => `
      <tr>
        <td class="font-mono text-green">#${l.id}</td>
        <td>
          <span class="badge ${
            l.log_level === 'ERROR' || l.log_level === 'FATAL'
              ? 'badge-danger'
              : l.log_level === 'WARN'
              ? 'badge-warning'
              : 'badge-dim'
          } font-mono">
            ${escapeHtml(l.log_level)}
          </span>
        </td>
        <td><span class="badge badge-dim font-mono">${escapeHtml(l.event_type || 'system')}</span></td>
        <td class="text-xs"><strong>${escapeHtml(l.message)}</strong></td>
        <td class="text-xs font-mono text-dim">${escapeHtml(typeof l.payload === 'object' ? JSON.stringify(l.payload) : (l.payload || '—'))}</td>
        <td class="font-mono text-xs">${new Date(l.created_at).toLocaleTimeString()}</td>
      </tr>
    `
      )
      .join('');
  }

  async fetchRobotLogs() {
    const tbody = document.getElementById('robot-logs-table-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="loading-indicator">Loading hardware dispatches...</td></tr>`;

    const res = await adminApi.getRobotLogs(20);
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-danger">Failed to load hardware logs: ${escapeHtml(res.error)}</td></tr>`;
      return;
    }

    const logs = res.data || [];
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hardware commands queued or executed yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs
      .map(
        (c) => `
      <tr>
        <td class="font-mono text-green">#${c.id}</td>
        <td><span class="badge badge-dim font-mono">${escapeHtml(c.command_type)}</span></td>
        <td class="text-xs font-mono">${escapeHtml(c.gesture_name || JSON.stringify(c.servo_payload || ''))}</td>
        <td>
          <span class="badge ${c.status === 'executed' || c.status === 'delivered' ? 'badge-green' : 'badge-warning'}">
            ${escapeHtml(c.status)}
          </span>
        </td>
        <td class="text-xs text-dim">${escapeHtml(c.triggered_by || 'system')}</td>
        <td class="font-mono text-xs">${new Date(c.created_at).toLocaleTimeString()}</td>
      </tr>
    `
      )
      .join('');
  }

  async pollTelemetry() {
    try {
      const res = await adminApi.getRobotStatus();
      if (res.data) {
        this.updateRobotHardwareUI(res.data);
      }
    } catch {
      const dot = document.getElementById('admin-robot-dot');
      const text = document.getElementById('admin-robot-text');
      if (dot) dot.className = 'status-dot offline';
      if (text) text.textContent = 'ESP32 Base Offline';
    }
  }

  // =========================================================================
  // SEARCH & FILTER LISTENERS
  // =========================================================================

  setupSearchAndFilters() {
    // Members Filter & Search
    const memSearch = document.getElementById('member-search-input');
    const memStatus = document.getElementById('member-status-filter');
    const memRefresh = document.getElementById('btn-refresh-members');
    const memPrev = document.getElementById('btn-member-prev');
    const memNext = document.getElementById('btn-member-next');

    memSearch?.addEventListener('input', (e) => {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        adminState.state.memberFilter.search = e.target.value;
        adminState.state.memberPagination.page = 1;
        this.fetchMembers();
      }, 300);
    });

    memStatus?.addEventListener('change', (e) => {
      adminState.state.memberFilter.status = e.target.value;
      adminState.state.memberPagination.page = 1;
      this.fetchMembers();
    });

    memRefresh?.addEventListener('click', () => this.fetchMembers());

    memPrev?.addEventListener('click', () => {
      if (adminState.state.memberPagination.page > 1) {
        adminState.state.memberPagination.page--;
        this.fetchMembers();
      }
    });

    memNext?.addEventListener('click', () => {
      if (adminState.state.memberPagination.page < adminState.state.memberPagination.totalPages) {
        adminState.state.memberPagination.page++;
        this.fetchMembers();
      }
    });

    // Enquiries Filter & Search
    const enqSearch = document.getElementById('enquiry-search-input');
    const enqStatus = document.getElementById('enquiry-status-filter');
    const enqRefresh = document.getElementById('btn-refresh-enquiries');

    enqSearch?.addEventListener('input', (e) => {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        adminState.state.enquiryFilter.search = e.target.value;
        this.fetchEnquiries();
      }, 300);
    });

    enqStatus?.addEventListener('change', (e) => {
      adminState.state.enquiryFilter.status = e.target.value;
      this.fetchEnquiries();
    });

    enqRefresh?.addEventListener('click', () => this.fetchEnquiries());

    // Trainers Filter & Search
    const trnSearch = document.getElementById('trainer-search-input');
    const trnStatus = document.getElementById('trainer-status-filter');
    const trnRefresh = document.getElementById('btn-refresh-trainers');

    trnSearch?.addEventListener('input', (e) => {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        adminState.state.trainerFilter.search = e.target.value;
        this.fetchTrainers();
      }, 300);
    });

    trnStatus?.addEventListener('change', (e) => {
      adminState.state.trainerFilter.status = e.target.value;
      this.fetchTrainers();
    });

    trnRefresh?.addEventListener('click', () => this.fetchTrainers());

    // Plans Filter & Refresh
    document.getElementById('btn-refresh-plans')?.addEventListener('click', () => this.fetchPlans());

    // FAQs Filter & Search
    const faqSearch = document.getElementById('faq-search-input');
    const faqLang = document.getElementById('faq-lang-filter');
    const faqRefresh = document.getElementById('btn-refresh-faqs');

    faqSearch?.addEventListener('input', (e) => {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        adminState.state.faqFilter.search = e.target.value;
        this.fetchFaqs();
      }, 300);
    });

    faqLang?.addEventListener('change', (e) => {
      adminState.state.faqFilter.language = e.target.value;
      this.fetchFaqs();
    });

    faqRefresh?.addEventListener('click', () => this.fetchFaqs());

    // Announcements Refresh
    document.getElementById('btn-refresh-ann')?.addEventListener('click', () => this.fetchAnnouncements());

    // Robot Dispatches Refresh
    document.getElementById('btn-refresh-robot-logs')?.addEventListener('click', () => this.fetchRobotLogs());
    document.getElementById('btn-refresh-diagnostics')?.addEventListener('click', () => this.fetchRobotDiagnostics());
    document.getElementById('btn-refresh-hw-logs')?.addEventListener('click', () => this.fetchHardwareLogs());

    // Interactions Refresh
    document.getElementById('btn-refresh-history')?.addEventListener('click', () => this.fetchInteractionLogs());
  }

  // =========================================================================
  // FORM HANDLERS (POST / PUT CRUD)
  // =========================================================================

  setupMemberForm() {
    const form = document.getElementById('form-add-member');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const memberData = {
        fullName: document.getElementById('mem-name').value.trim(),
        phone: document.getElementById('mem-phone').value.trim(),
        email: document.getElementById('mem-email').value.trim() || null,
        planId: document.getElementById('mem-plan').value || null,
        status: document.getElementById('mem-status').value || 'active',
        preferredLanguage: document.getElementById('mem-lang').value || 'en-IN',
        notes: document.getElementById('mem-notes').value.trim() || null,
      };

      const valError = adminState.validateMember(memberData);
      if (valError) {
        this.showToast(valError, true);
        return;
      }

      this.showToast('Saving member to PostgreSQL...');
      const res = await adminApi.createMember(memberData);
      if (res.success) {
        this.showToast(`Member ${memberData.fullName} registered successfully!`);
        this.closeModal('modal-member');
        form.reset();
        await this.fetchMembers();
      } else {
        this.showToast(res.error || 'Failed to register member', true);
      }
    });
  }

  setupTrainerForm() {
    const form = document.getElementById('form-add-trainer');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const trainerData = {
        name: document.getElementById('trn-name').value.trim(),
        specialty: document.getElementById('trn-specialty').value.trim(),
        phone: document.getElementById('trn-phone').value.trim(),
        shift: document.getElementById('trn-shift').value.trim(),
        status: 'on_floor',
      };

      const valError = adminState.validateTrainer(trainerData);
      if (valError) {
        this.showToast(valError, true);
        return;
      }

      this.showToast('Adding trainer to database...');
      const res = await adminApi.createTrainer(trainerData);
      if (res.success) {
        this.showToast(`Trainer ${trainerData.name} added to floor roster!`);
        this.closeModal('modal-trainer');
        form.reset();
        await this.fetchTrainers();
      } else {
        this.showToast(res.error || 'Failed to add trainer', true);
      }
    });
  }

  setupPlanForm() {
    const form = document.getElementById('form-add-plan');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawPerks = document.getElementById('plan-perks').value.trim();
      const planData = {
        name: document.getElementById('plan-name').value.trim(),
        priceInr: Number(document.getElementById('plan-price').value),
        durationMonths: parseInt(document.getElementById('plan-duration').value, 10) || 1,
        badgeLabel: 'New',
        perks: rawPerks ? rawPerks.split(',').map((p) => p.trim()) : ['Full Gym Access'],
      };

      const valError = adminState.validatePlan(planData);
      if (valError) {
        this.showToast(valError, true);
        return;
      }

      this.showToast('Publishing membership plan...');
      const res = await adminApi.createPlan(planData);
      if (res.success) {
        this.showToast(`Plan "${planData.name}" published!`);
        this.closeModal('modal-plan');
        form.reset();
        await this.fetchPlans();
      } else {
        this.showToast(res.error || 'Failed to publish plan', true);
      }
    });
  }

  setupFaqForm() {
    const form = document.getElementById('form-add-faq');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const faqData = {
        language: document.getElementById('faq-lang').value,
        gesture: document.getElementById('faq-gesture').value,
        question: document.getElementById('faq-q').value.trim(),
        answer: document.getElementById('faq-a').value.trim(),
        category: 'general',
      };

      const valError = adminState.validateFaq(faqData);
      if (valError) {
        this.showToast(valError, true);
        return;
      }

      this.showToast('Saving FAQ to knowledge base...');
      const res = await adminApi.createFaq(faqData);
      if (res.success) {
        this.showToast('New FAQ saved to receptionist knowledge base!');
        this.closeModal('modal-faq');
        form.reset();
        await this.fetchFaqs();
      } else {
        this.showToast(res.error || 'Failed to save FAQ', true);
      }
    });
  }

  setupAnnouncementForm() {
    const form = document.getElementById('form-add-ann');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const annData = {
        title: document.getElementById('ann-title').value.trim(),
        priority: document.getElementById('ann-priority').value,
        message: document.getElementById('ann-msg').value.trim(),
      };

      const valError = adminState.validateAnnouncement(annData);
      if (valError) {
        this.showToast(valError, true);
        return;
      }

      this.showToast('Broadcasting notice...');
      const res = await adminApi.createAnnouncement(annData);
      if (res.success) {
        this.showToast(`Notice "${annData.title}" broadcasted!`);
        this.closeModal('modal-ann');
        form.reset();
        await this.fetchAnnouncements();
      } else {
        this.showToast(res.error || 'Failed to broadcast announcement', true);
      }
    });
  }

  setupProfileForm() {
    const form = document.getElementById('form-gym-profile');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const profileData = {
        gymName: document.getElementById('prof-name').value.trim(),
        tagline: document.getElementById('prof-tagline').value.trim(),
        phone: document.getElementById('prof-phone').value.trim(),
        email: document.getElementById('prof-email').value.trim(),
        address: document.getElementById('prof-address').value.trim(),
      };

      const valError = adminState.validateProfile(profileData);
      if (valError) {
        this.showToast(valError, true);
        return;
      }

      this.showToast('Updating facility settings in PostgreSQL...');
      const res = await adminApi.updateGymSettings(profileData);
      if (res.success) {
        this.showToast('Gym facility profile updated successfully!');
      } else {
        this.showToast(res.error || 'Failed to update profile', true);
      }
    });
  }

  setupSettingsForm() {
    const form = document.getElementById('form-settings');
    const rateSlider = document.getElementById('setting-speech-rate');
    const pitchSlider = document.getElementById('setting-speech-pitch');
    const rateVal = document.getElementById('val-speech-rate');
    const pitchVal = document.getElementById('val-speech-pitch');

    rateSlider?.addEventListener('input', () => (rateVal.textContent = `${rateSlider.value}x`));
    pitchSlider?.addEventListener('input', () => (pitchVal.textContent = pitchSlider.value));

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const settingsData = {
        defaultLanguage: document.getElementById('setting-default-lang').value,
        speechRate: parseFloat(rateSlider.value),
        speechPitch: parseFloat(pitchSlider.value),
      };

      this.showToast('Saving voice configuration...');
      const res = await adminApi.updateGymSettings(settingsData);
      if (res.success) {
        this.showToast('Voice & Receptionist settings saved!');
      } else {
        this.showToast(res.error || 'Failed to update voice settings', true);
      }
    });
  }

  // =========================================================================
  // ROBOT MOTOR CONTROLS
  // =========================================================================

  setupRobotMotorControls() {
    document.querySelectorAll('.btn-gesture').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const gesture = btn.dataset.gesture;
        this.showToast(`Queuing gesture [${gesture}] on robot base...`);
        const res = await adminApi.triggerGesture(gesture);
        if (res.success) {
          this.showToast(`Gesture [${gesture}] queued successfully!`);
          await this.fetchRobotLogs();
        } else {
          this.showToast(res.error || 'Failed to trigger gesture', true);
        }
      });
    });

    const sliderPan = document.getElementById('slider-pan');
    const sliderTilt = document.getElementById('slider-tilt');
    const sliderArm = document.getElementById('slider-arm');

    const valPan = document.getElementById('val-slider-pan');
    const valTilt = document.getElementById('val-slider-tilt');
    const valArm = document.getElementById('val-slider-arm');

    sliderPan?.addEventListener('input', () => (valPan.textContent = `${sliderPan.value}°`));
    sliderTilt?.addEventListener('input', () => (valTilt.textContent = `${sliderTilt.value}°`));
    sliderArm?.addEventListener('input', () => (valArm.textContent = `${sliderArm.value}°`));

    document.getElementById('btn-apply-direct-angles')?.addEventListener('click', async () => {
      const pan = parseInt(sliderPan.value, 10);
      const tilt = parseInt(sliderTilt.value, 10);
      const arm = parseInt(sliderArm.value, 10);

      this.showToast(`Transmitting angles (Pan: ${pan}°, Tilt: ${tilt}°, Arm: ${arm}°)...`);
      const res = await adminApi.setServos(pan, tilt, arm);
      if (res.success) {
        this.showToast('Direct servo calibration transmitted to ESP32!');
        await this.fetchRobotLogs();
      } else {
        this.showToast(res.error || 'Failed to transmit servo angles', true);
      }
    });
  }

  // =========================================================================
  // ROLE SWITCHER & LOGOUT
  // =========================================================================

  setupRoleSwitcher() {
    document.getElementById('btn-topbar-switch-role')?.addEventListener('click', () => {
      this.openModal('modal-role-switcher');
    });
    document.getElementById('btn-sidebar-role-switch')?.addEventListener('click', () => {
      this.openModal('modal-role-switcher');
    });

    const roleCreds = {
      owner_manju: 'OwnerPass2026!',
      manager_priya: 'ManagerPass2026!',
      head_trainer: 'TrainerPass2026!',
      admin: 'AdminPass2026!',
    };

    document.querySelectorAll('.role-option-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const account = btn.dataset.account;
        const password = roleCreds[account];

        this.showToast(`Switching session to [${account}]...`);
        const res = await adminApi.login(account, password);

        if (res.success) {
          adminState.setUser(res.data.user);
          this.setupRealtimeSync(res.data.token);
          this.closeModal('modal-role-switcher');
          this.showToast(`Switched account: ${res.data.user.fullName} (${res.data.user.role.toUpperCase()})`);
          await this.loadAllData();
        } else {
          this.showToast(res.error || 'Failed to switch role', true);
        }
      });
    });
  }

  setupLogoutModal() {
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      this.openModal('modal-logout');
    });

    document.getElementById('btn-confirm-logout')?.addEventListener('click', async () => {
      this.showToast('Revoking session token...');
      await adminApi.logout();
      window.location.reload();
    });
  }
}

// Instantiate and boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new AdminDashboardApp();
  app.init();
});
