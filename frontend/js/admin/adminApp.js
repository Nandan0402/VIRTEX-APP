/**
 * adminApp.js - Main Application Controller for Virtex Admin Console
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
import { playNotificationSound } from '../components/notifySound.js';

// ---- Fees & Plans: who a plan is for + Mon–Sun planner (migration 031)
const PLAN_DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const PLAN_TYPES = [['', '—'], ['pt', '🤝 PT (with trainer)'], ['self', '🏋️ Self-training'], ['ladies', '👩 Ladies-only'], ['rest', '😴 Rest']];
const PLAN_AUD = { all: '<span class="pl-aud">👥 Everyone</span>', girls: '<span class="pl-aud girls">👧 Girls</span>', boys: '<span class="pl-aud boys">👦 Boys</span>' };
const planEsc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function planWeekSummary(ws) {
  const days = Object.values(ws || {});
  const n = (t) => days.filter((d) => d && d.type === t).length;
  const chips = [['pt', 'PT'], ['self', 'Self'], ['ladies', 'Ladies']].filter(([t]) => n(t)).map(([t, l]) => `<span class="pl-chip ${t}">${l} ${n(t)}</span>`).join('');
  return chips ? `<div class="pl-sum">${chips}</div>` : '<span class="text-dim text-xs">Not set</span>';
}
function renderPlanWeek(ws) {
  const box = document.getElementById('plan-week'); if (!box) return;
  box.innerHTML = PLAN_DAYS.map(([k, l]) => {
    const d = (ws || {})[k] || {};
    return `<div class="pl-day" data-day="${k}" data-type="${planEsc(d.type || '')}"><b>${l}</b>
      <select aria-label="${l} type">${PLAN_TYPES.map(([v, t]) => `<option value="${v}"${(d.type || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <input type="time" aria-label="${l} start" value="${planEsc(d.start || '')}"><input type="time" aria-label="${l} end" value="${planEsc(d.end || '')}"></div>`;
  }).join('');
}
/** Planner → { mon: {type,start,end}, … } (days left on “—” are skipped). Returns an error string when a time is wrong. */
function readPlanWeek(loose = false) {
  const out = {};
  for (const row of document.querySelectorAll('#plan-week .pl-day')) {
    const [sel, st, en] = row.querySelectorAll('select, input');
    if (!sel.value) continue;
    const d = { type: sel.value };
    if (sel.value !== 'rest' && (st.value || en.value)) {
      if (!loose && (!st.value || !en.value)) return `Give both a start and end time for ${row.querySelector('b').textContent} (or leave both empty).`;
      if (!loose && en.value <= st.value) return `End time must be after start time on ${row.querySelector('b').textContent}.`;
      d.start = st.value; d.end = en.value;
    }
    out[row.dataset.day] = d;
  }
  return out;
}


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
    this.analyticsPeriod = 'weekly';
    this.analyticsStartDate = '';
    this.analyticsEndDate = '';
    this.failedPage = 1;
    this.failedTotalPages = 1;
    this.failedSearch = '';
    this.robotCmdPage = 1;
    this.robotCmdTotalPages = 1;
    this.robotCmdSearch = '';
    this.robotCmdStatus = 'all';
    this.chartInstances = {};
    this.scheduleViewMode = 'expanded'; // Separate individual days by default (Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday)
  }

  async init() {
    console.log('[AdminApp] Bootstrapping Virtex Admin Console...');

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
    this.setupAnalyticsControls();

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

    // 0. Immediately render stored session in UI to prevent UI flash
    if (user) {
      adminState.setUser(user);
      this.updateTopbarUser();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const requestedRole = urlParams.get('role');
    // No stored demo credentials: every account signs in through its login page.
    const roleCreds = {};

    let sessionValid = false;

    // 1. If token exists, verify with server (/auth/me)
    if (token) {
      const meRes = await adminApi.getCurrentUser();
      if (meRes.success && meRes.data) {
        user = meRes.data;
        sessionValid = true;
      }
    }

    // 2. If a specific role was requested in query string (e.g. ?role=owner or ?role=trainer)
    if (requestedRole && roleCreds[requestedRole.toLowerCase()]) {
      const targetRole = requestedRole.toLowerCase();
      const target = roleCreds[targetRole];
      const currentRole = (user?.role || '').toLowerCase();

      // Check if current authenticated user already satisfies requested role
      const roleMatches = sessionValid && (
        (targetRole === 'trainer' && currentRole === 'trainer') ||
        ((targetRole === 'owner' || targetRole === 'admin') && (currentRole === 'owner' || currentRole === 'admin' || currentRole === 'superadmin')) ||
        (targetRole === 'manager' && (currentRole === 'manager' || currentRole === 'owner' || currentRole === 'admin'))
      );

      if (!sessionValid || !roleMatches) {
        console.log(`[AdminApp] Establishing session for role: ${requestedRole} (${target.username})...`);
        const loginRes = await adminApi.login(target.username, target.password);
        if (loginRes.success) {
          user = loginRes.data.user;
          token = loginRes.data.token;
          sessionValid = true;
        }
      }
    } else if (!sessionValid) {
      // 3. No valid session: go to the admin login page (it returns here after sign-in)
      console.log('[AdminApp] No valid session found. Redirecting to admin login...');
      await adminApi.redirectToLogin();
    }

    if (user && token) {
      adminState.setUser(user);
      this.updateTopbarUser();
      this.setupRealtimeSync(token);
    }

    // Hash or role based initial tab routing
    const initialHash = window.location.hash.replace('#', '');
    if (initialHash) {
      this.switchTab(initialHash, false);
    } else if (requestedRole === 'trainer' || requestedRole === 'personal_trainer') {
      window.location.replace('admin-personaltraniner.html');
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
      playNotificationSound('message');

      if (this.currentTab === 'tab-overview') {
        this.fetchAnalyticsOverview();
      } else if (this.currentTab === 'tab-kiosk') {
        this.fetchInteractionLogs();
      } else if (this.currentTab === 'tab-analytics') {
        this.loadAnalyticsDashboard();
      }
    });

    // 2. Live Enquiry / Kiosk Lead Captured
    this.realtime.on('ENQUIRY_RECEIVED', (data) => {
      const leadName = data.full_name || data.fullName || 'Prospective Member';
      const plan = data.plan_name || data.planName || 'Membership';
      this.showToast(`📬 New Kiosk Enquiry: ${leadName} for [${plan}]!`);
      playNotificationSound('message');

      if (this.currentTab === 'tab-overview') {
        this.fetchAnalyticsOverview();
      } else if (this.currentTab === 'tab-kiosk') {
        this.fetchInteractionLogs();
      } else if (this.currentTab === 'tab-analytics') {
        this.loadAnalyticsDashboard();
      }
    });

    // 3. Robot Hardware Telemetry & Command Logs
    this.realtime.on('ROBOT_STATUS_CHANGED', (state) => {
      if (state) {
        this.updateRobotHardwareUI(state);
      }
    });

    this.realtime.on('ROBOT_COMMAND_QUEUED', () => {
      if (this.currentTab === 'tab-robot') this.fetchAnalyticsRobotCommands();
    });

    this.realtime.on('ROBOT_COMMAND_UPDATED', () => {
      if (this.currentTab === 'tab-robot') this.fetchAnalyticsRobotCommands();
    });

    this.realtime.on('ROBOT_ALERT', (alert) => {
      this.showToast(`[Robot Alert] ${alert?.message || 'Hardware event recorded'}`, true);
      playNotificationSound('alert');
      if (this.currentTab === 'tab-robot') this.fetchHardwareLogs();
    });

    // 4. Trainer Floor Availability Update (trainer roster table lives in the Analytics tab)
    this.realtime.on('TRAINER_STATUS_UPDATED', () => {
      if (this.currentTab === 'tab-analytics') this.fetchAnalyticsTrainers();
    });

    // 5. Membership Plan Update
    this.realtime.on('PLAN_UPDATED', () => {
      if (this.currentTab === 'tab-plans') this.fetchPlans();
    });
    this.realtime.on('PLAN_STATUS_CHANGED', () => {
      if (this.currentTab === 'tab-plans') this.fetchPlans();
    });

    // 6. FAQ Updates (announcements are managed on admin-notification.html)
    this.realtime.on('FAQ_UPDATED', () => {
      if (this.currentTab === 'tab-faqs') this.fetchFaqs();
    });

    // 7. Reconnection Re-sync with PostgreSQL
    this.realtime.on('RECONNECTED', () => {
      console.log('[AdminApp] WebSocket reconnected. Re-syncing tab data...');
      this.loadAllData();
    });
  }

  updateTopbarUser() {
    const user = adminState.state.user || adminApi.getStoredUser();
    if (!user) return;

    const roleName = (user.role || 'owner').toUpperCase();
    const roleLower = (user.role || 'owner').toLowerCase();
    let fullName = (user.fullName || user.full_name || user.name || user.username || 'Nandan.B').trim();
    if (fullName === 'Manju Owner') fullName = 'Nandan.B';
    const rawUsername = user.username || user.email || 'nandanb449';
    const shortHandle = (rawUsername === 'owner_manju' || rawUsername === 'nandanb449@gmail.com')
      ? 'nandanb449'
      : (rawUsername.includes('@') && !rawUsername.startsWith('@')
        ? rawUsername.split('@')[0]
        : rawUsername.replace(/^@/, ''));
    const handleDisplay = `@${shortHandle}`;

    // Calculate user initials for profile avatar
    let initials = '';
    const cleanWords = fullName.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (cleanWords.length >= 2) {
      initials = (cleanWords[0][0] + cleanWords[1][0]).toUpperCase();
    } else if (cleanWords.length === 1 && cleanWords[0].length >= 2) {
      initials = cleanWords[0].slice(0, 2).toUpperCase();
    } else if (cleanWords.length === 1 && cleanWords[0].length === 1) {
      initials = cleanWords[0].toUpperCase();
    } else {
      initials = shortHandle.slice(0, 2).toUpperCase();
    }

    // Elements in sidebar profile card
    const elInitials = document.getElementById('sidebar-user-initials');
    let elPhoto = document.getElementById('sidebar-user-photo');
    const elFullName = document.getElementById('sidebar-user-fullname');
    const elHandle = document.getElementById('sidebar-user-handle');
    const elRolePill = document.getElementById('sidebar-role-pill');
    const elAvatar = document.getElementById('sidebar-user-avatar');

    const avatarUrl = user.avatarUrl || user.avatar_url;
    if (!elPhoto && elAvatar) {
      elPhoto = document.createElement('img');
      elPhoto.id = 'sidebar-user-photo';
      elPhoto.alt = 'Avatar';
      elPhoto.style.cssText = 'width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: none;';
      elAvatar.insertBefore(elPhoto, elInitials);
    }

    if (avatarUrl && elPhoto) {
      elPhoto.src = avatarUrl;
      elPhoto.style.display = 'block';
      if (elInitials) elInitials.style.display = 'none';
    } else {
      if (elPhoto) elPhoto.style.display = 'none';
      if (elInitials) {
        elInitials.textContent = initials;
        elInitials.style.display = 'block';
      }
    }
    if (elFullName) {
      elFullName.textContent = fullName;
      elFullName.title = fullName;
    }
    if (elHandle) {
      elHandle.textContent = handleDisplay;
      elHandle.title = rawUsername;
    }
    if (elRolePill) {
      elRolePill.textContent = roleName;
      elRolePill.className = `role-badge-pill role-${roleLower}`;
    }
    if (elAvatar) {
      elAvatar.className = `user-avatar avatar-${roleLower}`;
    }

    // Topbar & legacy fallback elements
    const tag = document.getElementById('topbar-role-tag');
    const username = document.getElementById('topbar-username');
    const sidebarDesc = document.getElementById('sidebar-session-desc');

    if (tag) {
      tag.textContent = roleName;
      tag.className = `role-tag ${roleLower}`;
    }
    if (username) {
      username.textContent = rawUsername;
    }
    if (sidebarDesc) {
      sidebarDesc.textContent = `User: ${fullName} (${user.role})`;
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

  switchTab(targetTabId, updateUrl = true) {
    if (!targetTabId) return;
    // The Live Kiosk Activity Feed tab was removed: old links and bookmarks open the Overview instead.
    if (targetTabId === 'tab-kiosk') {
      targetTabId = 'tab-overview';
      if (window.location.hash === '#tab-kiosk') history.replaceState(null, '', '#tab-overview');
    }

    // 1. Direct redirects for dedicated standalone admin consoles
    const standaloneRedirects = {
      'tab-members': 'admin-members.html',
      'tab-enquiries': 'admin-messages.html',
      'tab-messages': 'admin-messages.html',
      'tab-trainers': 'admin-personaltraniner.html',
      'tab-announcements': 'admin-notification.html',
      'tab-working-hours': 'admin-working-hours.html',
      'tab-calendar': 'admin-calander.html',
      'tab-user-profile': 'admin-profile.html',
    };

    if (standaloneRedirects[targetTabId]) {
      window.location.replace(standaloneRedirects[targetTabId]);
      return;
    }

    // 2. Validate target panel
    const activePanel = document.getElementById(targetTabId);
    if (!activePanel) return;

    // 3. RBAC permission verification
    const role = (adminState.state.user?.role || 'owner').toLowerCase();
    if (role === 'trainer' && ['tab-profile', 'tab-settings', 'tab-plans', 'tab-faqs'].includes(targetTabId)) {
      this.showToast(`Access Restricted: ${role.toUpperCase()} role does not have permission for this section.`, true);
      return;
    }

    // 4. Update Navigation Sidebar Active State
    const navButtons = document.querySelectorAll('.nav-item-btn');
    navButtons.forEach((b) => {
      b.classList.remove('active');
      b.removeAttribute('aria-current');
    });

    const activeBtn = document.querySelector(`.nav-item-btn[data-tab="${targetTabId}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-current', 'page');
    }

    // Also check for sub-items in expandable accordion navigation
    const activeSubItem = document.querySelector(`.nav-sub-item[data-tab="${targetTabId}"]`);
    if (activeSubItem) {
      document.querySelectorAll('.nav-sub-item').forEach((i) => i.classList.remove('active'));
      activeSubItem.classList.add('active');
      const group = activeSubItem.closest('.nav-group');
      if (group) {
        group.classList.add('expanded', 'has-active');
        group.querySelector('.nav-group-header')?.setAttribute('aria-expanded', 'true');
      }
    }

    this.currentTab = targetTabId;

    // 5. Switch Tab Panels
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    activePanel.classList.add('active');

    // 6. Update Top Header Title & Document Title
    const titleMap = {
      'tab-overview': 'Overview & Statistics',
      'tab-kiosk': 'Live Kiosk Activity Feed',
      'tab-analytics': 'Reports',
      'tab-plans': 'Fees & Plans',
      'tab-robot': 'Robot Telemetry & Controls',
      'tab-faqs': 'Knowledge Base FAQs',
      'tab-profile': 'Gym Facility Profile',
      'tab-settings': 'Language & System Settings',
    };

    const tabLabel = titleMap[targetTabId]
      || activeBtn?.innerText?.trim()
      || activeSubItem?.querySelector('.nav-sub-label')?.innerText?.trim()
      || 'Dashboard';

    const pageTitle = document.getElementById('page-title');
    if (pageTitle) {
      pageTitle.textContent = tabLabel;
    }
    document.title = `Virtex Admin • ${tabLabel}`;

    // 7. Update URL Hash in Browser History
    if (updateUrl && window.location.hash !== `#${targetTabId}`) {
      try {
        history.replaceState(null, '', `#${targetTabId}`);
      } catch (e) {
        window.location.hash = targetTabId;
      }
    }

    // 8. Refresh dynamic data for active tab
    if (targetTabId === 'tab-overview') {
      this.fetchAnalyticsOverview();
    } else if (targetTabId === 'tab-analytics') {
      this.loadAnalyticsDashboard();
      setTimeout(() => {
        Object.values(this.chartInstances).forEach((c) => c && typeof c.resize === 'function' && c.resize());
      }, 50);
    } else if (targetTabId === 'tab-kiosk') {
      this.fetchInteractionLogs();
      this.fetchAnalyticsFailedInteractions();
    } else if (targetTabId === 'tab-plans') {
      this.fetchPlans();
    } else if (targetTabId === 'tab-faqs') {
      this.fetchFaqs();
    } else if (targetTabId === 'tab-robot') {
      this.loadRobotData();
    } else if (targetTabId === 'tab-profile' || targetTabId === 'tab-settings') {
      this.fetchGymProfile();
    }

    // 9. Auto-close mobile drawer
    const sidebar = document.getElementById('admin-sidebar');
    if (sidebar && window.innerWidth <= 768) sidebar.classList.remove('open');
  }

  setupTabNavigation() {
    const navButtons = document.querySelectorAll('.nav-item-btn');

    navButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const targetTabId = btn.dataset.tab;
        if (!targetTabId) return; // Allow normal <a> links to standalone pages
        e.preventDefault();
        this.switchTab(targetTabId, true);
      });
    });

    // Listen for hash navigation (browser back/forward or external anchors)
    window.addEventListener('hashchange', () => {
      const newHash = window.location.hash.replace('#', '');
      if (newHash && newHash !== this.currentTab) {
        this.switchTab(newHash, false);
      }
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
      this.resetPlanForm();
      this.openModal('modal-plan');
    });
    document.getElementById('btn-open-faq-modal')?.addEventListener('click', () => {
      this.openModal('modal-faq');
    });
    document.getElementById('btn-open-ann-modal')?.addEventListener('click', () => {
      this.openModal('modal-ann');
    });

    // Sidebar user profile card click handler -> navigates directly to admin-profile.html
    const userCard = document.getElementById('sidebar-user-card');
    userCard?.addEventListener('click', (e) => {
      if (e.target.closest('#btn-logout')) return;
      window.location.href = 'admin-profile.html';
    });

    userCard?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('#btn-logout')) return;
        e.preventDefault();
        window.location.href = 'admin-profile.html';
      }
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

  openUserProfileModal() {
    window.location.href = 'admin-profile.html';
  }

  confirmDialog({
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    icon = '🗑️',
    confirmText = 'Delete',
    confirmClass = 'btn-danger',
    cancelText = 'Cancel',
  } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('modal-confirm');
      const titleEl = document.getElementById('modal-confirm-title');
      const msgEl = document.getElementById('modal-confirm-message');
      const iconEl = document.getElementById('modal-confirm-icon');
      const okBtn = document.getElementById('modal-confirm-ok-btn');
      const cancelBtn = document.getElementById('modal-confirm-cancel-btn');

      if (!modal || !okBtn || !cancelBtn) {
        resolve(window.confirm(message));
        return;
      }

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      if (iconEl) iconEl.textContent = icon;
      if (okBtn) {
        okBtn.textContent = confirmText;
        okBtn.className = `btn ${confirmClass}`;
      }
      if (cancelBtn) {
        cancelBtn.textContent = cancelText;
      }

      this.openModal('modal-confirm');

      let resolved = false;

      const finish = (val) => {
        if (resolved) return;
        resolved = true;
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        window.removeEventListener('keydown', handleKey);
        this.closeModal('modal-confirm');
        resolve(val);
      };

      const handleOk = (e) => {
        e.preventDefault();
        finish(true);
      };

      const handleCancel = (e) => {
        e.preventDefault();
        finish(false);
      };

      const handleKey = (e) => {
        if (e.key === 'Escape') finish(false);
      };

      okBtn.addEventListener('click', handleOk);
      cancelBtn.addEventListener('click', handleCancel);
      window.addEventListener('keydown', handleKey);
      okBtn.focus();
    });
  }

  // =========================================================================
  // DATA FETCHING & RENDERING (PostgreSQL Connected)
  // =========================================================================

  async loadAllData() {
    await Promise.all([
      this.loadAnalyticsDashboard(),
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

        // KPI cards on the Overview tab are owned by fetchAnalyticsOverview() (period-filtered).
        // Writing them here too made the cards flip between two data sources, and put the
        // pending-leads count into the "AI Queries" card.
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

    this.renderOperatingHours(prof.hours);
  }

  // =========================================================================
  // OPERATING HOURS CUSTOMIZER
  // =========================================================================

  renderOperatingHours(storedHours = []) {
    const container = document.getElementById('schedule-days-container');
    if (!container) return;

    if (!this.scheduleViewMode) {
      this.scheduleViewMode = 'expanded';
    }

    container.innerHTML = '';

    // Index stored hours by day name
    const hoursMap = {};
    if (Array.isArray(storedHours)) {
      storedHours.forEach((h) => {
        if (h && h.day) {
          hoursMap[h.day.toLowerCase()] = h;
        } else if (h && h.days) {
          const lower = h.days.toLowerCase();
          if (lower.includes('friday') || lower.includes('weekday') || lower.includes('mon-fri') || lower.includes('mon – fri')) {
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach((d) => (hoursMap[d] = h));
          } else if (lower.includes('saturday')) {
            hoursMap['saturday'] = h;
          } else if (lower.includes('sunday')) {
            hoursMap['sunday'] = h;
          }
        }
      });
    }

    // Update the Toggle button in the preset bar
    const toggleModeBtn = document.getElementById('btn-toggle-day-mode');
    if (toggleModeBtn) {
      if (this.scheduleViewMode === 'grouped') {
        toggleModeBtn.innerHTML = '📋 Separate All 7 Days';
        toggleModeBtn.title = 'Switch to day-by-day separate view for individual customization';
      } else {
        toggleModeBtn.innerHTML = '📁 Group Weekdays (Optional)';
        toggleModeBtn.title = 'Optionally group Monday to Friday into a single row';
      }
    }

    // Determine items to display based on scheduleViewMode:
    // 'grouped' = 3 rows (Mon-Fri unified, Saturday, Sunday) -> Eliminates duplicate weekday rows
    // 'expanded' = 7 individual rows
    const scheduleItems = this.scheduleViewMode === 'grouped' ? [
      {
        dayKey: 'mon-fri',
        label: 'Monday – Friday',
        badge: '📅 Monday – Friday',
        subBadge: '<span class="badge badge-outline text-xs" style="font-size: 0.68rem; padding: 2px 7px; color: var(--accent-green); border-color: rgba(0, 230, 153, 0.35); background: rgba(0, 230, 153, 0.08);">Weekdays Unified</span>',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        isGroup: true,
      },
      {
        dayKey: 'saturday',
        label: 'Saturday',
        badge: '📅 Saturday',
        subBadge: '',
        days: ['saturday'],
        isGroup: false,
      },
      {
        dayKey: 'sunday',
        label: 'Sunday',
        badge: '📅 Sunday',
        subBadge: '',
        days: ['sunday'],
        isGroup: false,
      },
    ] : [
      { dayKey: 'monday', label: 'Monday', badge: '📅 Monday', subBadge: '', days: ['monday'], isGroup: false },
      { dayKey: 'tuesday', label: 'Tuesday', badge: '📅 Tuesday', subBadge: '', days: ['tuesday'], isGroup: false },
      { dayKey: 'wednesday', label: 'Wednesday', badge: '📅 Wednesday', subBadge: '', days: ['wednesday'], isGroup: false },
      { dayKey: 'thursday', label: 'Thursday', badge: '📅 Thursday', subBadge: '', days: ['thursday'], isGroup: false },
      { dayKey: 'friday', label: 'Friday', badge: '📅 Friday', subBadge: '', days: ['friday'], isGroup: false },
      { dayKey: 'saturday', label: 'Saturday', badge: '📅 Saturday', subBadge: '', days: ['saturday'], isGroup: false },
      { dayKey: 'sunday', label: 'Sunday', badge: '📅 Sunday', subBadge: '', days: ['sunday'], isGroup: false },
    ];

    const classOptions = [
      { val: 'Zumba & Aerobics', label: '💃 Zumba & Aerobics' },
      { val: 'Yoga & Pilates', label: '🧘 Yoga & Pilates' },
      { val: 'General Gym', label: '🏋️ General Gym (Floor)' },
      { val: 'Group Classes', label: '👥 Group Classes (All Batches)' },
      { val: 'Gym & Group Classes', label: '🏋️+👥 Gym & Group Classes' },
      { val: 'HIIT & CrossFit', label: '🔥 HIIT & CrossFit' },
      { val: 'Boxing & MMA', label: '🥊 Boxing & MMA' },
      { val: 'Personal Training', label: '⚡ Personal Training' },
      { val: 'Open Gym / 24/7', label: '🕒 Open Gym / 24/7' },
      { val: 'Custom', label: '✏️ Custom Class...' },
    ];
    this._classOptions = classOptions;

    scheduleItems.forEach((item) => {
      const primaryKey = item.days[0];
      const existing = hoursMap[primaryKey] || {};
      const isClosed = Boolean(existing.is_closed || (existing.status && existing.status.toLowerCase() === 'closed'));

      // Determine initial slots from existing data (supports shifts array, shift 1 & shift 2, or standard defaults)
      let initialSlots = [];
      if (Array.isArray(existing.shifts) && existing.shifts.length > 0) {
        initialSlots = existing.shifts.map((s) => ({
          open: s.open || '06:00',
          close: s.close || '22:00',
          class_type: s.class_type || 'General Gym',
          note: s.note || '',
          is24h: s.open === '00:00' && s.close === '23:59',
        }));
      } else {
        const openTime = existing.open || (item.dayKey === 'sunday' ? '07:00' : '06:00');
        const closeTime = existing.close || (item.dayKey === 'sunday' ? '13:00' : (item.dayKey === 'saturday' ? '21:00' : '22:00'));
        const is24h = openTime === '00:00' && closeTime === '23:59';
        const defaultClass = is24h ? 'Open Gym / 24/7' : (item.dayKey === 'sunday' ? 'General Gym' : 'Gym & Group Classes');
        const classType = existing.class_type || defaultClass;
        const note = existing.note || (item.dayKey === 'sunday' && closeTime === '13:00' ? 'Half Day' : '');

        initialSlots.push({
          open: openTime,
          close: closeTime,
          class_type: classType,
          note,
          is24h,
        });

        if (existing.shift2_open && existing.shift2_close) {
          initialSlots.push({
            open: existing.shift2_open,
            close: existing.shift2_close,
            class_type: existing.shift2_class_type || 'Yoga & Pilates',
            note: existing.shift2_note || '',
            is24h: false,
          });
        }
      }

      const card = document.createElement('div');
      card.className = `schedule-day-card ${isClosed ? 'is-closed' : ''}`;
      card.dataset.day = item.label;
      card.dataset.groupKey = item.dayKey;
      if (item.isGroup) {
        card.dataset.isGroup = 'true';
      }

      card.innerHTML = `
        <div class="schedule-day-main-row">
          <div class="schedule-day-meta">
            <span class="day-badge">${item.badge}</span>
            ${item.subBadge || ''}
            <button type="button" class="btn-day-toggle ${isClosed ? 'closed' : 'open'}" data-action="toggle-status">
              ${isClosed ? '🔴 CLOSED' : '🟢 OPEN'}
            </button>
          </div>

          <div class="schedule-day-actions" style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-outline btn-xs btn-add-slot" data-action="add-slot" ${isClosed ? 'disabled' : ''} style="color: var(--accent-green); border-color: rgba(0, 230, 153, 0.4); font-size: 0.74rem; padding: 3px 9px;">
              ➕ Add Time / Class Slot
            </button>
            ${!item.isGroup && item.label === 'Monday' ? `<button type="button" class="btn btn-outline btn-xs" data-action="copy-weekdays" title="Copy Monday schedule to Tue-Fri" style="font-size: 0.68rem; padding: 2px 8px;">📋 Copy to Weekdays</button>` : ''}
          </div>
        </div>

        <div class="schedule-slots-container">
          <!-- Rendered dynamically -->
        </div>
      `;

      // Render slots
      this.renderCardSlots(card, initialSlots, isClosed);

      // Event listener: Toggle OPEN / CLOSED
      const toggleBtn = card.querySelector('[data-action="toggle-status"]');
      const addSlotBtn = card.querySelector('[data-action="add-slot"]');

      toggleBtn?.addEventListener('click', () => {
        const currentlyClosed = card.classList.contains('is-closed');
        if (currentlyClosed) {
          card.classList.remove('is-closed');
          toggleBtn.className = 'btn-day-toggle open';
          toggleBtn.textContent = '🟢 OPEN';
          if (addSlotBtn) addSlotBtn.disabled = false;
          card.querySelectorAll('input, select, button.btn-remove-slot').forEach((el) => (el.disabled = false));
        } else {
          card.classList.add('is-closed');
          toggleBtn.className = 'btn-day-toggle closed';
          toggleBtn.textContent = '🔴 CLOSED';
          if (addSlotBtn) addSlotBtn.disabled = true;
          card.querySelectorAll('input, select, button.btn-remove-slot').forEach((el) => (el.disabled = true));
        }
        this.updateLiveHoursPill();
      });

      // Event listener: Add Slot
      addSlotBtn?.addEventListener('click', () => {
        const currentSlots = this.getCardSlots(card);
        let newSlot;
        if (currentSlots.length === 1) {
          // If first slot is morning, default second slot to evening yoga
          newSlot = { open: '17:30', close: '19:30', class_type: 'Yoga & Pilates', note: 'Evening Yoga Batch', is24h: false };
        } else if (currentSlots.length === 2) {
          // Third slot: Night HIIT
          newSlot = { open: '19:45', close: '21:30', class_type: 'HIIT & CrossFit', note: 'Night HIIT Session', is24h: false };
        } else {
          // Extra slot: General Group Classes
          newSlot = { open: '12:00', close: '14:00', class_type: 'Group Classes', note: 'Afternoon Functional Session', is24h: false };
        }
        currentSlots.push(newSlot);
        this.renderCardSlots(card, currentSlots, card.classList.contains('is-closed'));
        this.updateLiveHoursPill();
        this.showToast('➕ Added new time & class slot!');
      });

      // Event listener: Copy Monday to Weekdays (in expanded mode)
      if (!item.isGroup && item.label === 'Monday') {
        const copyBtn = card.querySelector('[data-action="copy-weekdays"]');
        copyBtn?.addEventListener('click', () => {
          const mSlots = this.getCardSlots(card);
          const mClosed = card.classList.contains('is-closed');

          ['Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((tDay) => {
            const targetCard = container.querySelector(`[data-day="${tDay}"]`);
            if (!targetCard) return;
            const tToggle = targetCard.querySelector('[data-action="toggle-status"]');
            const tAddBtn = targetCard.querySelector('[data-action="add-slot"]');

            if (mClosed) {
              targetCard.classList.add('is-closed');
              if (tToggle) {
                tToggle.className = 'btn-day-toggle closed';
                tToggle.textContent = '🔴 CLOSED';
              }
              if (tAddBtn) tAddBtn.disabled = true;
            } else {
              targetCard.classList.remove('is-closed');
              if (tToggle) {
                tToggle.className = 'btn-day-toggle open';
                tToggle.textContent = '🟢 OPEN';
              }
              if (tAddBtn) tAddBtn.disabled = false;
            }

            this.renderCardSlots(targetCard, mSlots, mClosed);
          });

          this.showToast('📋 Copied Monday slots and classes to Tuesday through Friday!');
          this.updateLiveHoursPill();
        });
      }

      container.appendChild(card);
    });

    this.setupSchedulePresets();
    this.updateLiveHoursPill();
  }

  // Helper to extract all slot values from a card
  getCardSlots(card) {
    const rows = card.querySelectorAll('.schedule-slot-row');
    const slots = [];
    rows.forEach((row) => {
      const open = row.querySelector('.time-open')?.value || '06:00';
      const close = row.querySelector('.time-close')?.value || '22:00';
      const class_type = row.querySelector('.select-class-type')?.value || 'General Gym';
      const note = row.querySelector('.input-note')?.value.trim() || '';
      const is24h = Boolean(row.querySelector('.cb-24h')?.checked);
      slots.push({ open, close, class_type, note, is24h });
    });
    if (slots.length === 0) {
      slots.push({ open: '06:00', close: '22:00', class_type: 'General Gym', note: '', is24h: false });
    }
    return slots;
  }

  // Helper to render all slots inside a card's slots container
  renderCardSlots(card, slots = [], isClosed = false) {
    const slotsContainer = card.querySelector('.schedule-slots-container');
    if (!slotsContainer) return;
    slotsContainer.innerHTML = '';

    const classOptions = this._classOptions || [
      { val: 'Zumba & Aerobics', label: '💃 Zumba & Aerobics' },
      { val: 'Yoga & Pilates', label: '🧘 Yoga & Pilates' },
      { val: 'General Gym', label: '🏋️ General Gym (Floor)' },
      { val: 'Group Classes', label: '👥 Group Classes (All Batches)' },
      { val: 'Gym & Group Classes', label: '🏋️+👥 Gym & Group Classes' },
      { val: 'HIIT & CrossFit', label: '🔥 HIIT & CrossFit' },
      { val: 'Boxing & MMA', label: '🥊 Boxing & MMA' },
      { val: 'Personal Training', label: '⚡ Personal Training' },
      { val: 'Open Gym / 24/7', label: '🕒 Open Gym / 24/7' },
      { val: 'Custom', label: '✏️ Custom Class...' },
    ];

    const canDelete = slots.length > 1;

    slots.forEach((slot, index) => {
      const matched = classOptions.some((o) => o.val === slot.class_type);
      const selectedClass = matched ? slot.class_type : 'Custom';
      const displayNote = !matched && slot.class_type && !slot.note ? slot.class_type : (slot.note || '');

      const slotRow = document.createElement('div');
      slotRow.className = 'schedule-slot-row';
      slotRow.dataset.slotIndex = String(index);

      slotRow.innerHTML = `
        <span class="slot-badge text-xs font-mono">⏰ Slot ${index + 1}:</span>

        <div class="time-slot-group">
          <input type="time" class="time-open" value="${slot.open || '06:00'}" ${isClosed ? 'disabled' : ''} />
          <span class="text-xs text-dim">to</span>
          <input type="time" class="time-close" value="${slot.close || '10:00'}" ${isClosed ? 'disabled' : ''} />
        </div>

        <label class="text-xs text-dim font-mono cb-24h-label" style="display: inline-flex; align-items: center; gap: 4px; user-select: none; cursor: pointer;">
          <input type="checkbox" class="cb-24h" ${slot.is24h ? 'checked' : ''} ${isClosed ? 'disabled' : ''} /> 24h
        </label>

        <div class="class-picker-wrapper" style="display: inline-flex; align-items: center; gap: 6px;">
          <span class="text-xs text-dim" style="font-weight: 600;">Class:</span>
          <select class="select-class-type" style="padding: 4px 8px; font-size: 0.74rem; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); color: #fff;" ${isClosed ? 'disabled' : ''}>
            ${classOptions.map((opt) => `<option value="${opt.val}" ${opt.val === selectedClass ? 'selected' : ''}>${opt.label}</option>`).join('')}
          </select>
          <input type="text" class="input-note" placeholder="Class notes (e.g. Morning Zumba, Evening Yoga)" value="${escapeHtml(displayNote)}" style="width: 210px; padding: 4px 8px; font-size: 0.74rem; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); color: #fff;" ${isClosed ? 'disabled' : ''} />
        </div>

        ${canDelete ? `
          <button type="button" class="btn btn-outline btn-xs btn-remove-slot" title="Remove this time slot" ${isClosed ? 'disabled' : ''} style="color: var(--danger); border-color: rgba(239, 68, 68, 0.4); padding: 3px 8px; font-size: 0.74rem; margin-left: auto;">
            🗑️
          </button>
        ` : ''}
      `;

      // Event listener: 24h Checkbox
      const cb24 = slotRow.querySelector('.cb-24h');
      const timeOpen = slotRow.querySelector('.time-open');
      const timeClose = slotRow.querySelector('.time-close');
      const selectClass = slotRow.querySelector('.select-class-type');
      const inputNote = slotRow.querySelector('.input-note');
      const removeBtn = slotRow.querySelector('.btn-remove-slot');

      cb24?.addEventListener('change', () => {
        if (cb24.checked) {
          timeOpen.value = '00:00';
          timeClose.value = '23:59';
          if (selectClass) selectClass.value = 'Open Gym / 24/7';
          if (inputNote && !inputNote.value) inputNote.value = '24/7 Open Floor Access';
        } else {
          timeOpen.value = '06:00';
          timeClose.value = '10:00';
          if (selectClass) selectClass.value = 'General Gym';
        }
        this.updateLiveHoursPill();
      });

      timeOpen?.addEventListener('change', () => {
        if (timeOpen.value === '00:00' && timeClose.value === '23:59') {
          cb24.checked = true;
        } else {
          cb24.checked = false;
        }
        this.updateLiveHoursPill();
      });

      timeClose?.addEventListener('change', () => {
        if (timeOpen.value === '00:00' && timeClose.value === '23:59') {
          cb24.checked = true;
        } else {
          cb24.checked = false;
        }
        this.updateLiveHoursPill();
      });

      selectClass?.addEventListener('change', () => {
        if (selectClass.value === 'Custom') {
          inputNote.focus();
        } else if (!inputNote.value || inputNote.value === '24/7 Access') {
          if (selectClass.value === 'Zumba & Aerobics') inputNote.value = 'Morning Zumba Batch';
          else if (selectClass.value === 'Yoga & Pilates') inputNote.value = 'Evening Yoga & Pilates';
          else if (selectClass.value === 'HIIT & CrossFit') inputNote.value = 'High-Intensity CrossFit Session';
          else if (selectClass.value === 'General Gym') inputNote.value = 'Open Floor & Cardio';
          else if (selectClass.value === 'Group Classes') inputNote.value = 'Group Fitness Sessions';
          else if (selectClass.value === 'Open Gym / 24/7') inputNote.value = '24/7 Open Floor Access';
        }
        this.updateLiveHoursPill();
      });

      inputNote?.addEventListener('input', () => {
        this.updateLiveHoursPill();
      });

      removeBtn?.addEventListener('click', () => {
        const remaining = this.getCardSlots(card).filter((_, i) => i !== index);
        this.renderCardSlots(card, remaining, isClosed);
        this.updateLiveHoursPill();
        this.showToast('🗑️ Removed time slot.');
      });

      slotsContainer.appendChild(slotRow);
    });
  }

  setupSchedulePresets() {
    const container = document.getElementById('schedule-days-container');
    if (!container || container._presetsBound) return;
    container._presetsBound = true;

    // Toggle Day Mode (Grouped Weekdays vs Expanded 7 Days)
    const toggleModeBtn = document.getElementById('btn-toggle-day-mode');
    toggleModeBtn?.addEventListener('click', () => {
      const currentHours = this.collectOperatingHours();
      this.scheduleViewMode = this.scheduleViewMode === 'grouped' ? 'expanded' : 'grouped';
      this.renderOperatingHours(currentHours);
      this.showToast(
        this.scheduleViewMode === 'grouped'
          ? '📁 Grouped weekdays: Monday–Friday merged into a single row.'
          : '📋 Separate 7 days: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday.'
      );
    });

    // Preset 1: Dual Batches - Morning Zumba & Evening Yoga
    document.getElementById('btn-preset-dual-classes')?.addEventListener('click', () => {
      const weekdaySlots = [
        { open: '06:00', close: '08:30', class_type: 'Zumba & Aerobics', note: 'Morning Zumba Batch', is24h: false },
        { open: '17:30', close: '19:30', class_type: 'Yoga & Pilates', note: 'Evening Yoga Batch', is24h: false },
      ];
      const satSlots = [
        { open: '06:00', close: '09:00', class_type: 'HIIT & CrossFit', note: 'Morning Weekend HIIT', is24h: false },
        { open: '17:00', close: '19:00', class_type: 'Yoga & Pilates', note: 'Sunset Yoga', is24h: false },
      ];
      const sunSlots = [
        { open: '07:00', close: '12:00', class_type: 'General Gym', note: 'Open Gym (Half Day Recovery)', is24h: false },
      ];

      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((d) => {
        this.setDayCard(d, { is_closed: false, slots: weekdaySlots });
      });
      this.setDayCard('Saturday', { is_closed: false, slots: satSlots });
      this.setDayCard('Sunday', { is_closed: false, slots: sunSlots });
      this.showToast('💃 Applied Dual Timings: Morning Zumba & Evening Yoga!');
      this.updateLiveHoursPill();
    });

    // Preset 2: Standard Gym Timings
    document.getElementById('btn-preset-standard')?.addEventListener('click', () => {
      const standardSlots = [
        { open: '06:00', close: '22:00', class_type: 'Gym & Group Classes', note: 'General Gym & Scheduled Classes', is24h: false },
      ];
      const satSlots = [
        { open: '06:00', close: '21:00', class_type: 'Gym & Group Classes', note: 'Weekend Floor & Classes', is24h: false },
      ];
      const sunSlots = [
        { open: '07:00', close: '13:00', class_type: 'General Gym', note: 'Half Day Recovery', is24h: false },
      ];

      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((d) => {
        this.setDayCard(d, { is_closed: false, slots: standardSlots });
      });
      this.setDayCard('Saturday', { is_closed: false, slots: satSlots });
      this.setDayCard('Sunday', { is_closed: false, slots: sunSlots });
      this.showToast('⚡ Applied Standard Gym Timings (Mon-Sat 6 AM - 10 PM, Sun 7 AM - 1 PM)');
      this.updateLiveHoursPill();
    });

    // Preset 3: Gym + Group Classes (AM Gym / PM Group Classes)
    document.getElementById('btn-preset-group-classes')?.addEventListener('click', () => {
      const weekdaySlots = [
        { open: '06:00', close: '11:00', class_type: 'General Gym', note: 'Morning Weights & Cardio Floor', is24h: false },
        { open: '17:00', close: '21:30', class_type: 'Group Classes', note: 'Zumba, Yoga & HIIT Batches', is24h: false },
      ];
      const satSlots = [
        { open: '06:00', close: '12:00', class_type: 'Gym & Group Classes', note: 'Weekend Bootcamp & Floor', is24h: false },
        { open: '16:00', close: '20:00', class_type: 'Yoga & Pilates', note: 'Evening Yoga & Stretch', is24h: false },
      ];
      const sunSlots = [
        { open: '07:00', close: '13:00', class_type: 'General Gym', note: 'Open Gym Recovery (Half Day)', is24h: false },
      ];

      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((d) => {
        this.setDayCard(d, { is_closed: false, slots: weekdaySlots });
      });
      this.setDayCard('Saturday', { is_closed: false, slots: satSlots });
      this.setDayCard('Sunday', { is_closed: false, slots: sunSlots });
      this.showToast('👥 Applied Gym + Group Classes Schedule (Morning Gym / Evening Group Classes)');
      this.updateLiveHoursPill();
    });

    // Preset 4: 24/7 Access
    document.getElementById('btn-preset-247')?.addEventListener('click', () => {
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      days.forEach((d) => {
        this.setDayCard(d, {
          is_closed: false,
          slots: [{ open: '00:00', close: '23:59', is24h: true, class_type: 'Open Gym / 24/7', note: '24/7 Access' }],
        });
      });
      this.showToast('⚡ Applied 24/7 Facility Open All Week!');
      this.updateLiveHoursPill();
    });

    // Preset 5: Split Shifts
    document.getElementById('btn-preset-split')?.addEventListener('click', () => {
      const weekdaySlots = [
        { open: '06:00', close: '11:00', class_type: 'General Gym', note: 'Morning Strength & Cardio', is24h: false },
        { open: '16:00', close: '22:00', class_type: 'Group Classes', note: 'Evening Group Fitness & Zumba', is24h: false },
      ];
      const satSlots = [
        { open: '06:00', close: '11:00', class_type: 'General Gym', note: 'Morning Workout', is24h: false },
        { open: '16:00', close: '21:00', class_type: 'Yoga & Pilates', note: 'Evening Yoga & Core', is24h: false },
      ];
      const sunSlots = [
        { open: '07:00', close: '13:00', class_type: 'General Gym', note: 'Half Day Recovery', is24h: false },
      ];

      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((d) => {
        this.setDayCard(d, { is_closed: false, slots: weekdaySlots });
      });
      this.setDayCard('Saturday', { is_closed: false, slots: satSlots });
      this.setDayCard('Sunday', { is_closed: false, slots: sunSlots });
      this.showToast('⚡ Applied Split Shift Schedule (Morning Gym 6-11 AM & Evening Group Classes 4-10 PM)');
      this.updateLiveHoursPill();
    });

    // Preset 6: Weekdays Only
    document.getElementById('btn-preset-weekdays-only')?.addEventListener('click', () => {
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((d) => {
        this.setDayCard(d, {
          is_closed: false,
          slots: [{ open: '06:00', close: '22:00', class_type: 'Gym & Group Classes', note: 'Gym & Scheduled Classes', is24h: false }],
        });
      });
      this.setDayCard('Saturday', {
        is_closed: false,
        slots: [{ open: '06:00', close: '20:00', class_type: 'General Gym', note: 'Saturday Floor Session', is24h: false }],
      });
      this.setDayCard('Sunday', {
        is_closed: true,
        slots: [{ open: '07:00', close: '13:00', class_type: 'General Gym', note: 'Sunday Closed (Weekend Rest)', is24h: false }],
      });
      this.showToast('⚡ Applied Weekdays Only (Sunday Closed)');
      this.updateLiveHoursPill();
    });
  }

  setDayCard(dayName, {
    is_closed = false,
    slots = null,
    open = '06:00',
    close = '22:00',
    is24h = false,
    class_type = 'General Gym',
    note = '',
    hasShift2 = false,
    shift2_open = '16:00',
    shift2_close = '22:00',
    shift2_class_type = 'Group Classes',
    shift2_note = '',
  } = {}) {
    let card = document.querySelector(`.schedule-day-card[data-day="${dayName}"]`);
    if (!card) {
      const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      if (weekdays.includes(dayName)) {
        card = document.querySelector('.schedule-day-card[data-group-key="mon-fri"]') || 
               document.querySelector('.schedule-day-card[data-is-group="true"]') ||
               document.querySelector('.schedule-day-card[data-day*="Monday"]');
      }
    }
    if (!card) return;

    const toggle = card.querySelector('[data-action="toggle-status"]');
    const addSlotBtn = card.querySelector('[data-action="add-slot"]');

    if (is_closed) {
      card.classList.add('is-closed');
      if (toggle) {
        toggle.className = 'btn-day-toggle closed';
        toggle.textContent = '🔴 CLOSED';
      }
      if (addSlotBtn) addSlotBtn.disabled = true;
    } else {
      card.classList.remove('is-closed');
      if (toggle) {
        toggle.className = 'btn-day-toggle open';
        toggle.textContent = '🟢 OPEN';
      }
      if (addSlotBtn) addSlotBtn.disabled = false;
    }

    // Determine target slots
    let targetSlots = slots;
    if (!Array.isArray(targetSlots) || targetSlots.length === 0) {
      targetSlots = [{ open, close, is24h, class_type, note }];
      if (hasShift2) {
        targetSlots.push({ open: shift2_open, close: shift2_close, class_type: shift2_class_type, note: shift2_note, is24h: false });
      }
    }

    this.renderCardSlots(card, targetSlots, is_closed);
  }

  collectOperatingHours() {
    const cards = document.querySelectorAll('.schedule-day-card');
    const list = [];
    cards.forEach((card) => {
      const day = card.dataset.day || '';
      const isGroup = card.dataset.isGroup === 'true' || day.includes('–') || day.includes('-') || day.toLowerCase().includes('weekdays');
      const isClosed = card.classList.contains('is-closed');
      const slots = this.getCardSlots(card);

      const makeItem = (dayName) => {
        const primary = slots[0] || { open: '06:00', close: '22:00', class_type: 'General Gym', note: '' };
        const item = {
          day: dayName,
          open: primary.open,
          close: primary.close,
          is_closed: isClosed,
          class_type: primary.class_type,
          shifts: slots.map((s) => ({
            open: s.open,
            close: s.close,
            class_type: s.class_type,
            note: s.note,
          })),
        };
        if (primary.note) {
          item.note = primary.note;
        }
        if (slots.length > 1) {
          item.shift2_open = slots[1].open;
          item.shift2_close = slots[1].close;
          item.shift2_class_type = slots[1].class_type;
          if (slots[1].note) item.shift2_note = slots[1].note;
        }
        return item;
      };

      if (isGroup) {
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((weekday) => {
          list.push(makeItem(weekday));
        });
      } else {
        list.push(makeItem(day));
      }
    });
    return list;
  }

  updateLiveHoursPill() {
    const pill = document.getElementById('hours-live-status-pill');
    if (!pill) return;
    const now = new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = dayNames[now.getDay()];

    let card = document.querySelector(`.schedule-day-card[data-day="${currentDay}"]`);
    if (!card) {
      const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      if (weekdays.includes(currentDay)) {
        card = document.querySelector('.schedule-day-card[data-group-key="mon-fri"]') || 
               document.querySelector('.schedule-day-card[data-is-group="true"]') ||
               document.querySelector('.schedule-day-card[data-day*="Monday"]');
      }
    }
    if (!card) return;

    if (card.classList.contains('is-closed')) {
      pill.className = 'badge badge-warning font-mono text-xs';
      pill.textContent = `● Live Today (${currentDay}): CLOSED`;
      return;
    }

    const slots = this.getCardSlots(card);
    let displayStr = '';
    if (slots.length === 1) {
      displayStr = `${slots[0].open} – ${slots[0].close} • ${slots[0].class_type}`;
    } else if (slots.length === 2) {
      displayStr = `${slots[0].open}–${slots[0].close} (${slots[0].class_type}) & ${slots[1].open}–${slots[1].close} (${slots[1].class_type})`;
    } else {
      displayStr = `${slots.length} Classes: ${slots.map((s) => `${s.open} ${s.class_type}`).join(', ')}`;
    }

    pill.className = 'badge badge-green font-mono text-xs';
    pill.textContent = `● Live Today (${currentDay}): ${displayStr}`;
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
        const confirmed = await this.confirmDialog({
          title: 'Archive Gym Member',
          message: 'Archive this member? They are marked inactive and their portal login is disabled. All history (check-ins, payments, workouts, PT sessions) is kept.',
          icon: '🗑️',
          confirmText: 'Archive Member',
          confirmClass: 'btn-danger',
        });
        if (confirmed) {
          const res = await adminApi.deleteMember(btn.dataset.id);
          if (res.success) {
            this.showToast('Member archived — history kept.');
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
        const confirmed = await this.confirmDialog({
          title: 'Remove Trainer',
          message: 'Are you sure you want to remove this trainer from the floor roster?',
          icon: '🏋️',
          confirmText: 'Remove Trainer',
          confirmClass: 'btn-danger',
        });
        if (confirmed) {
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

    tbody.innerHTML = `<tr><td colspan="8" class="loading-indicator">Loading plans from PostgreSQL...</td></tr>`;

    const res = await adminApi.getPlans(true);
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state text-danger">Failed to load plans: ${escapeHtml(res.error)}</td></tr>`;
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
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No fee plans yet. Use “+ Create fee plan”.</td></tr>`;
      return;
    }

    tbody.innerHTML = plans
      .map(
        (p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${PLAN_AUD[p.audience || 'all']}</td>
        <td>${p.duration_months} Month${p.duration_months > 1 ? 's' : ''}</td>
        <td class="font-mono font-semibold text-green">₹${Number(p.price_inr).toLocaleString()}</td>
        <td>${planWeekSummary(p.weekly_schedule)}</td>
        <td class="text-xs text-dim">${(Array.isArray(p.perks) ? p.perks : []).map(escapeHtml).join(' • ')}</td>
        <td>
          <span class="badge ${p.is_active ? 'badge-green' : 'badge-dim'}">${p.is_active ? 'Active' : 'Archived'}</span>
        </td>
        <td style="white-space: nowrap;">
          <div style="display: inline-flex; align-items: center; gap: 6px;">
            <button class="btn-table-action btn-edit-plan" data-id="${p.id}" title="Edit fee plan">✏️</button>
            <a class="btn-table-action" href="admin-feessalert.html?search=${encodeURIComponent(p.name)}" title="Fees due for ${escapeHtml(p.name)}">💳</a>
            <button class="btn-table-action btn-toggle-plan" data-id="${p.id}" title="Toggle Plan Status">
              ${p.is_active ? '⏸️' : '▶️'}
            </button>
            <button class="btn-table-action btn-del-plan" data-id="${p.id}" title="Delete Plan">🗑️</button>
          </div>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.btn-edit-plan').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = plans.find((x) => String(x.id) === btn.dataset.id);
        if (!p) return;
        this.resetPlanForm(p);
        this.openModal('modal-plan');
      });
    });

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
        const confirmed = await this.confirmDialog({
          title: 'Delete Membership Plan',
          message: 'Permanently delete this membership plan from PostgreSQL?',
          icon: '💳',
          confirmText: 'Delete Plan',
          confirmClass: 'btn-danger',
        });
        if (confirmed) {
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
        const confirmed = await this.confirmDialog({
          title: 'Delete Knowledge Base FAQ',
          message: 'Delete this knowledge base FAQ from PostgreSQL?',
          icon: '❓',
          confirmText: 'Delete FAQ',
          confirmClass: 'btn-danger',
        });
        if (confirmed) {
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
        const confirmed = await this.confirmDialog({
          title: 'Delete Noticeboard Announcement',
          message: 'Delete this noticeboard announcement from PostgreSQL?',
          icon: '📢',
          confirmText: 'Delete Announcement',
          confirmClass: 'btn-danger',
        });
        if (confirmed) {
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

    const rawLogs = res.data || [];
    if (rawLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No speech interactions recorded yet.</td></tr>`;
      return;
    }

    // Deduplicate logs so identical query entries within the same minute or duplicate IDs never repeat
    const seenEntries = new Set();
    const logs = [];
    for (const l of rawLogs) {
      const timeSlot = new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dedupeKey = `${(l.user_query || '').trim().toLowerCase()}_${l.language}_${timeSlot}`;
      if (!seenEntries.has(dedupeKey)) {
        seenEntries.add(dedupeKey);
        logs.push(l);
      }
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
      this.fetchAnalyticsRobotCommands(),
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
          <span class="badge ${l.log_level === 'ERROR' || l.log_level === 'FATAL'
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

  async pollTelemetry() {
    // 1. Robot Hardware Telemetry
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

    // 2. PostgreSQL Database Connection Status
    try {
      const health = await adminApi.getHealth();
      const dbDot = document.getElementById('admin-db-dot');
      const dbText = document.getElementById('admin-db-text');
      if (health && health.database === 'connected') {
        if (dbDot) dbDot.className = 'status-dot online';
        const latency = health.diagnostics?.latencyMs ?? 0;
        if (dbText) dbText.textContent = `PostgreSQL: Connected (${latency}ms)`;
      } else {
        if (dbDot) dbDot.className = 'status-dot offline';
        if (dbText) dbText.textContent = 'PostgreSQL: Disconnected';
      }
    } catch {
      const dbDot = document.getElementById('admin-db-dot');
      const dbText = document.getElementById('admin-db-text');
      if (dbDot) dbDot.className = 'status-dot offline';
      if (dbText) dbText.textContent = 'PostgreSQL: Offline';
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
    document.getElementById('btn-refresh-diagnostics')?.addEventListener('click', () => this.fetchRobotDiagnostics());
    document.getElementById('btn-refresh-hw-logs')?.addEventListener('click', () => this.fetchHardwareLogs());

    // Interactions Refresh
    document.getElementById('btn-refresh-history')?.addEventListener('click', () => this.fetchInteractionLogs());
  }

  // =========================================================================
  // ANALYTICS & INTERACTION MONITORING CONTROLLERS
  // =========================================================================

  setupAnalyticsControls() {
    // 1. Timeframe Presets
    document.querySelectorAll('.filter-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-preset-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.analyticsPeriod = btn.dataset.period || 'weekly';
        this.analyticsStartDate = '';
        this.analyticsEndDate = '';
        const startInput = document.getElementById('analytics-start-date');
        const endInput = document.getElementById('analytics-end-date');
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        this.loadAnalyticsDashboard();
      });
    });

    // 2. Custom Date Range
    document.getElementById('btn-apply-date-filter')?.addEventListener('click', () => {
      const s = document.getElementById('analytics-start-date')?.value;
      const e = document.getElementById('analytics-end-date')?.value;
      this.analyticsStartDate = s || '';
      this.analyticsEndDate = e || '';
      document.querySelectorAll('.filter-preset-btn').forEach((b) => b.classList.remove('active'));
      this.loadAnalyticsDashboard();
    });

    // 3. Role Report Export
    document.getElementById('btn-export-report')?.addEventListener('click', () => {
      this.exportAnalyticsReport();
    });

    // 4. Popular FAQs Refresh
    document.getElementById('btn-refresh-faqs-analytics')?.addEventListener('click', () => {
      this.fetchAnalyticsPopularFaqs();
    });

    // 5. Trainer Availability Refresh
    document.getElementById('btn-refresh-trainer-analytics')?.addEventListener('click', () => {
      this.fetchAnalyticsTrainers();
    });

    // 6. Failed Interactions Search & Pagination
    const failedSearch = document.getElementById('failed-query-search');
    const failedRefresh = document.getElementById('btn-refresh-failed');
    const failedPrev = document.getElementById('btn-failed-prev');
    const failedNext = document.getElementById('btn-failed-next');

    failedSearch?.addEventListener('input', (e) => {
      clearTimeout(this.failedDebounce);
      this.failedDebounce = setTimeout(() => {
        this.failedSearch = e.target.value.trim();
        this.failedPage = 1;
        this.fetchAnalyticsFailedInteractions();
      }, 300);
    });

    failedRefresh?.addEventListener('click', () => this.fetchAnalyticsFailedInteractions());

    failedPrev?.addEventListener('click', () => {
      if (this.failedPage > 1) {
        this.failedPage--;
        this.fetchAnalyticsFailedInteractions();
      }
    });

    failedNext?.addEventListener('click', () => {
      if (this.failedPage < (this.failedTotalPages || 1)) {
        this.failedPage++;
        this.fetchAnalyticsFailedInteractions();
      }
    });

    // 7. Robot Commands Search, Status Filter & Pagination
    const cmdSearch = document.getElementById('robot-command-search');
    const cmdStatus = document.getElementById('robot-command-status-filter');
    const cmdRefresh = document.getElementById('btn-refresh-robot-commands');
    const cmdPrev = document.getElementById('btn-robot-cmd-prev');
    const cmdNext = document.getElementById('btn-robot-cmd-next');

    cmdSearch?.addEventListener('input', (e) => {
      clearTimeout(this.cmdDebounce);
      this.cmdDebounce = setTimeout(() => {
        this.robotCmdSearch = e.target.value.trim();
        this.robotCmdPage = 1;
        this.fetchAnalyticsRobotCommands();
      }, 300);
    });

    cmdStatus?.addEventListener('change', (e) => {
      this.robotCmdStatus = e.target.value;
      this.robotCmdPage = 1;
      this.fetchAnalyticsRobotCommands();
    });

    cmdRefresh?.addEventListener('click', () => this.fetchAnalyticsRobotCommands());

    cmdPrev?.addEventListener('click', () => {
      if (this.robotCmdPage > 1) {
        this.robotCmdPage--;
        this.fetchAnalyticsRobotCommands();
      }
    });

    cmdNext?.addEventListener('click', () => {
      if (this.robotCmdPage < (this.robotCmdTotalPages || 1)) {
        this.robotCmdPage++;
        this.fetchAnalyticsRobotCommands();
      }
    });
  }

  async loadAnalyticsDashboard() {
    // Admin → Reports (simple month-by-month view). The old charts' canvases were removed from the tab;
    // fetchAnalyticsOverview() below still feeds the Overview tab's KPI cards.
    import('./reportsDashboard.js').then((m) => m.loadReports()).catch((e) => console.warn('[AdminApp] Reports load error:', e));
    try {
      await Promise.all([
        this.fetchAnalyticsOverview(),
        this.fetchAnalyticsPopularFaqs(),
        this.fetchAnalyticsTrainers(),
        this.fetchAnalyticsFailedInteractions(),
        this.fetchAnalyticsRobotCommands(),
      ]);
    } catch (err) {
      console.warn('[AdminApp] Analytics dashboard loading error:', err);
    }
  }

  async fetchAnalyticsOverview() {
    try {
      const res = await adminApi.getAnalyticsOverview({
        startDate: this.analyticsStartDate,
        endDate: this.analyticsEndDate,
        period: this.analyticsPeriod,
      });

      if (!res.success || !res.data) return;
      const d = res.data;

      const periodLabel = document.getElementById('overview-period-label');
      if (periodLabel) {
        const presetNames = { daily: 'Today', weekly: 'Last 7 Days', monthly: 'Last 30 Days' };
        periodLabel.textContent = (this.analyticsStartDate || this.analyticsEndDate)
          ? `${this.analyticsStartDate || '…'} → ${this.analyticsEndDate || 'today'}`
          : (presetNames[this.analyticsPeriod] || 'Last 7 Days');
      }

      // Update KPI Cards
      const elCheckins = document.getElementById('stat-daily-checkins');
      const elCheckinsSub = document.getElementById('stat-checkins-sub');
      const elEnquiries = document.getElementById('stat-total-enquiries');
      const elConvRate = document.getElementById('stat-conversion-rate');
      const elQueries = document.getElementById('stat-queries-handled');
      const elLatencyP95 = document.getElementById('stat-latency-p95');
      const elUptime = document.getElementById('stat-robot-uptime');
      const elRobotBatt = document.getElementById('stat-robot-battery');
      const elTrainers = document.getElementById('stat-trainers-floor');
      const elFloorRatio = document.getElementById('stat-floor-ratio');

      if (elCheckins) elCheckins.textContent = d.summary?.total_checkins ?? d.checkIns?.total ?? 0;
      if (elCheckinsSub) {
        elCheckinsSub.textContent = `Voice: ${d.checkIns?.kiosk_voice ?? 0} | Manual: ${d.checkIns?.kiosk_manual ?? 0}`;
      }
      if (elEnquiries) elEnquiries.textContent = d.summary?.new_enquiries ?? d.enquiries?.total ?? 0;
      if (elConvRate) {
        const conv = d.enquiries?.conversion_rate_pct ?? 0;
        elConvRate.textContent = `${conv}% conv`;
      }
      if (elQueries) elQueries.textContent = d.summary?.total_ai_queries ?? d.aiPerformance?.total_interactions ?? 0;
      if (elLatencyP95) {
        elLatencyP95.textContent = `p95: ${d.aiPerformance?.p95_latency_ms ?? 0}ms`;
      }
      if (elUptime) {
        const isOnline = d.robotUptime?.device?.status === 'online';
        if (!isOnline) {
          elUptime.textContent = 'Standby';
          elUptime.className = 'stat-val font-mono text-warning';
        } else {
          elUptime.textContent = `${d.robotUptime?.uptimePercentage ?? 100}%`;
          elUptime.className = 'stat-val font-mono text-green';
        }
      }
      if (elRobotBatt) {
        const isOnline = d.robotUptime?.device?.status === 'online';
        // Battery is no longer shown; show Wi-Fi signal only
        const rssiVal = d.robotUptime?.device?.wifi_rssi;
        elRobotBatt.textContent = isOnline && rssiVal ? `Wi-Fi ${rssiVal} dBm` : 'Standby';
      }
      if (elTrainers) elTrainers.textContent = d.summary?.trainers_on_floor ?? 0;
      if (elFloorRatio) {
        const trainersCount = d.summary?.trainers_on_floor || 0;
        const totalCheckins = d.summary?.total_checkins || 0;
        const ratio = trainersCount > 0 ? (totalCheckins / trainersCount).toFixed(1) : '0';
        elFloorRatio.textContent = `Ratio: ${ratio}:1`;
      }

      // Badges
      const badgeCheckins = document.getElementById('badge-checkins-count');
      if (badgeCheckins) badgeCheckins.textContent = `${d.checkIns?.total ?? 0} Total`;

      const badgeLatency = document.getElementById('badge-latency-avg');
      if (badgeLatency) badgeLatency.textContent = `Avg: ${d.aiPerformance?.avg_latency_ms ?? 0}ms`;

      const badgeEnquiries = document.getElementById('badge-enquiries-total');
      if (badgeEnquiries) badgeEnquiries.textContent = `${d.enquiries?.total ?? 0} Leads`;

      // Render Charts
      this.renderCheckinsChart(d.checkInsTrend || []);
      this.renderLanguageChart(d.languageDistribution || []);
      this.renderLatencyChart(d.aiPerformance || {});
      this.renderEnquiriesChart(d.enquiriesByPlan || [], d.enquiries || {});
    } catch (err) {
      console.warn('[AdminApp] Overview fetch error:', err);
    }
  }

  // --- Chart 1: Check-in Volume & Methods Trend ---
  renderCheckinsChart(trend = []) {
    const canvas = document.getElementById('chart-checkins-trend');
    if (!canvas || !window.Chart) return;

    if (this.chartInstances['checkins']) {
      this.chartInstances['checkins'].destroy();
    }

    const labels = trend.map((t) => {
      const d = new Date(t.bucket);
      return isNaN(d) ? t.bucket : d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    });

    const voiceData = trend.map((t) => t.voice_checkins || 0);
    const manualData = trend.map((t) => t.manual_checkins || 0);
    const rfidData = trend.map((t) => t.rfid_checkins || 0);
    const qrData = trend.map((t) => t.qr_checkins || 0);

    const ctx = canvas.getContext('2d');
    this.chartInstances['checkins'] = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Today'],
        datasets: [
          {
            label: 'Voice (Kiosk)',
            data: voiceData.length ? voiceData : [0],
            backgroundColor: 'rgba(0, 230, 118, 0.75)',
            borderColor: '#00e676',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'Manual (Kiosk)',
            data: manualData.length ? manualData : [0],
            backgroundColor: 'rgba(34, 211, 238, 0.75)',
            borderColor: '#22d3ee',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'RFID Card',
            data: rfidData.length ? rfidData : [0],
            backgroundColor: 'rgba(168, 85, 247, 0.75)',
            borderColor: '#a855f7',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'Mobile QR',
            data: qrData.length ? qrData : [0],
            backgroundColor: 'rgba(234, 179, 8, 0.75)',
            borderColor: '#eab308',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94a3b8' },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94a3b8', precision: 0 },
          },
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#cbd5e1', font: { family: 'Plus Jakarta Sans', size: 11 } },
          },
        },
      },
    });
  }

  // --- Chart 2: Language Distribution Doughnut ---
  renderLanguageChart(distribution = []) {
    const canvas = document.getElementById('chart-language-doughnut');
    if (!canvas || !window.Chart) return;

    if (this.chartInstances['language']) {
      this.chartInstances['language'].destroy();
    }

    const hasData = Array.isArray(distribution) && distribution.length > 0 && distribution.some((d) => (d.count || 0) > 0);
    const badgeLang = document.getElementById('badge-lang-count');
    if (badgeLang) {
      badgeLang.textContent = hasData ? `${distribution.length} Languages` : '0 Queries';
    }

    const labels = hasData
      ? distribution.map((d) => d.languageName || d.language)
      : ['No interactions recorded'];
    const data = hasData
      ? distribution.map((d) => d.count || 0)
      : [1];

    const ctx = canvas.getContext('2d');
    this.chartInstances['language'] = new window.Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: hasData
              ? [
                'rgba(0, 230, 118, 0.85)',
                'rgba(34, 211, 238, 0.85)',
                'rgba(253, 224, 71, 0.85)',
              ]
              : ['rgba(255, 255, 255, 0.05)'],
            borderColor: hasData ? '#0e1118' : 'rgba(255, 255, 255, 0.1)',
            borderWidth: 2,
            hoverOffset: hasData ? 4 : 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#cbd5e1', font: { family: 'Plus Jakarta Sans', size: 11 }, padding: 14 },
          },
          tooltip: {
            enabled: hasData,
          },
        },
      },
    });
  }

  // --- Chart 3: AI Latency Trend ---
  renderLatencyChart(aiPerformance = {}) {
    const canvas = document.getElementById('chart-latency-trend');
    if (!canvas || !window.Chart) return;

    if (this.chartInstances['latency']) {
      this.chartInstances['latency'].destroy();
    }

    const avg = aiPerformance.avg_latency_ms || 0;
    const p95 = aiPerformance.p95_latency_ms || 0;
    const hasLatency = avg > 0 || p95 > 0;
    const badgeLatency = document.getElementById('badge-latency-avg');
    if (badgeLatency) {
      badgeLatency.textContent = `Avg: ${avg}ms`;
    }

    const ctx = canvas.getContext('2d');
    this.chartInstances['latency'] = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels: ['6h Ago', '4h Ago', '2h Ago', 'Current'],
        datasets: [
          {
            label: 'Avg Latency (ms)',
            data: hasLatency ? [avg + 15, Math.max(0, avg - 8), avg + 6, avg] : [0, 0, 0, 0],
            borderColor: '#22d3ee',
            backgroundColor: 'rgba(34, 211, 238, 0.1)',
            fill: true,
            tension: 0.35,
            pointRadius: hasLatency ? 4 : 0,
          },
          {
            label: 'P95 Latency (ms)',
            data: hasLatency ? [p95 + 30, Math.max(0, p95 - 20), p95 + 15, p95] : [0, 0, 0, 0],
            borderColor: '#c084fc',
            backgroundColor: 'rgba(192, 132, 252, 0.1)',
            fill: true,
            tension: 0.35,
            pointRadius: hasLatency ? 4 : 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
          y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#cbd5e1', font: { family: 'Plus Jakarta Sans', size: 11 } },
          },
        },
      },
    });
  }

  // --- Chart 4: Enquiries & Plan Acquisition Funnel ---
  renderEnquiriesChart(byPlan = [], summary = {}) {
    const canvas = document.getElementById('chart-enquiries-funnel');
    if (!canvas || !window.Chart) return;

    if (this.chartInstances['enquiries']) {
      this.chartInstances['enquiries'].destroy();
    }

    const hasPlans = Array.isArray(byPlan) && byPlan.length > 0 && byPlan.some((p) => (p.count || 0) > 0);
    const badgeTotal = document.getElementById('badge-enquiries-total');
    if (badgeTotal) {
      const totalEnq = byPlan.reduce((acc, p) => acc + (p.count || 0), 0);
      badgeTotal.textContent = `${totalEnq} Enquiries`;
    }

    const labels = hasPlans ? byPlan.map((p) => p.plan_name) : ['Standard', 'Pro', 'Elite'];
    const data = hasPlans ? byPlan.map((p) => p.count || 0) : [0, 0, 0];

    const ctx = canvas.getContext('2d');
    this.chartInstances['enquiries'] = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Inquiries by Plan',
            data,
            backgroundColor: [
              'rgba(234, 179, 8, 0.75)',
              'rgba(0, 230, 118, 0.75)',
              'rgba(34, 211, 238, 0.75)',
              'rgba(168, 85, 247, 0.75)',
            ],
            borderColor: '#eab308',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        scales: {
          x: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', precision: 0 } },
          y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#cbd5e1' } },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });
  }

  // --- Popular FAQs & Detected Intents ---
  async fetchAnalyticsPopularFaqs() {
    const tbody = document.getElementById('popular-faqs-table-body');
    if (!tbody) return;

    try {
      const res = await adminApi.getAnalyticsFaqs({
        startDate: this.analyticsStartDate,
        endDate: this.analyticsEndDate,
        limit: 10,
      });

      if (!res.success || !res.data?.popularFaqs?.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No categorized FAQ interactions recorded yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = res.data.popularFaqs
        .map((f) => `
          <tr>
            <td><span class="badge badge-green font-mono">#${f.rank}</span></td>
            <td><strong>${escapeHtml(f.intent)}</strong></td>
            <td><span class="font-mono">${f.count}</span></td>
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="flex: 1; height: 6px; background: #1e2433; border-radius: 3px; overflow: hidden; min-width: 60px;">
                  <div style="width: ${f.percentage}%; height: 100%; background: var(--green);"></div>
                </div>
                <span class="font-mono text-xs text-dim">${f.percentage}%</span>
              </div>
            </td>
            <td>
              <span class="badge badge-outline text-xs">EN: ${f.count_en || 0}</span>
              <span class="badge badge-outline text-xs">KN: ${f.count_kn || 0}</span>
              <span class="badge badge-outline text-xs">HI: ${f.count_hi || 0}</span>
            </td>
            <td><span class="font-mono text-cyan">${f.avg_latency_ms || 0}ms</span></td>
          </tr>
        `)
        .join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-danger">Failed to load FAQs: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // --- Trainer Availability & Floor Load ---
  async fetchAnalyticsTrainers() {
    const tbody = document.getElementById('analytics-trainers-table-body');
    const ratioPill = document.getElementById('trainer-ratio-pill');
    if (!tbody) return;

    try {
      const res = await adminApi.getAnalyticsTrainers();
      if (!res.success || !res.data) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No trainer roster records available.</td></tr>`;
        return;
      }

      const { summary, memberTrainerRatio, roster } = res.data;
      if (ratioPill) {
        ratioPill.textContent = `Ratio: ${memberTrainerRatio} Floor Load`;
      }

      if (!roster?.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No trainers scheduled today.</td></tr>`;
        return;
      }

      tbody.innerHTML = roster
        .map((t) => {
          const statusClass = t.status === 'on_floor' ? 'active' : t.status === 'in_session' ? 'warning' : 'frozen';
          const shiftText = t.shift_start && t.shift_end ? `${t.shift_start} - ${t.shift_end}` : 'Standard Shift';
          return `
            <tr>
              <td><span class="font-mono text-dim text-xs">${escapeHtml(t.trainer_code)}</span></td>
              <td><strong>${escapeHtml(t.full_name)}</strong></td>
              <td><span class="text-xs text-dim">${escapeHtml(t.specialty || 'General')}</span></td>
              <td><span class="badge badge-${statusClass}">${escapeHtml((t.status || 'off_duty').replace('_', ' ').toUpperCase())}</span></td>
              <td><span class="font-mono text-xs">${shiftText}</span></td>
            </tr>
          `;
        })
        .join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state text-danger">Failed to load trainer roster: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // --- Failed & Ungrounded Interactions Monitor ---
  async fetchAnalyticsFailedInteractions() {
    const tbody = document.getElementById('failed-interactions-table-body');
    const pageInfo = document.getElementById('failed-page-info');
    const ratePill = document.getElementById('failed-rate-pill');
    const prevBtn = document.getElementById('btn-failed-prev');
    const nextBtn = document.getElementById('btn-failed-next');
    if (!tbody) return;

    try {
      const res = await adminApi.getAnalyticsFailedInteractions({
        page: this.failedPage,
        limit: 5,
        search: this.failedSearch,
        startDate: this.analyticsStartDate,
        endDate: this.analyticsEndDate,
      });

      if (!res.success || !res.data) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Could not retrieve interaction logs.</td></tr>`;
        return;
      }

      const { records, totalPages, failureRatePct, page } = res.data;
      this.failedTotalPages = totalPages || 1;

      if (ratePill) ratePill.textContent = `${failureRatePct || 0}% Failure Rate`;
      if (pageInfo) pageInfo.textContent = `Page ${page || 1} of ${this.failedTotalPages}`;
      if (prevBtn) prevBtn.disabled = (page || 1) <= 1;
      if (nextBtn) nextBtn.disabled = (page || 1) >= this.failedTotalPages;

      if (!records?.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-green">✅ Excellent! Zero ungrounded or failed interactions found for this timeframe.</td></tr>`;
        return;
      }

      tbody.innerHTML = records
        .map((r) => {
          const timeStr = r.created_at ? new Date(r.created_at).toLocaleTimeString() : '—';
          return `
            <tr>
              <td><span class="font-mono text-xs text-dim">${timeStr}</span></td>
              <td><strong>${escapeHtml(r.user_query || '—')}</strong></td>
              <td class="text-dim text-xs">${escapeHtml(r.robot_response || '—')}</td>
              <td><span class="badge badge-outline text-xs">${escapeHtml(r.language || 'en-IN')}</span></td>
              <td><span class="badge badge-yellow text-xs">${escapeHtml(r.intent_detected || 'fallback')}</span></td>
              <td><span class="font-mono text-xs text-warning">${r.latency_ms || 0}ms</span></td>
            </tr>
          `;
        })
        .join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-danger">Failed to scan interaction logs: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // --- Robot Command History ---
  async fetchAnalyticsRobotCommands() {
    const tbody = document.getElementById('robot-commands-table-body');
    const pageInfo = document.getElementById('robot-cmd-page-info');
    const countPill = document.getElementById('robot-total-commands-pill');
    const prevBtn = document.getElementById('btn-robot-cmd-prev');
    const nextBtn = document.getElementById('btn-robot-cmd-next');
    if (!tbody) return;

    try {
      const res = await adminApi.getAnalyticsRobotCommands({
        page: this.robotCmdPage,
        limit: 8,
        search: this.robotCmdSearch,
        status: this.robotCmdStatus,
        startDate: this.analyticsStartDate,
        endDate: this.analyticsEndDate,
      });

      if (!res.success || !res.data) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Could not retrieve robot commands.</td></tr>`;
        return;
      }

      const { commands, total, totalPages, page } = res.data;
      this.robotCmdTotalPages = totalPages || 1;

      if (countPill) countPill.textContent = `${total || 0} Commands`;
      if (pageInfo) pageInfo.textContent = `Page ${page || 1} of ${this.robotCmdTotalPages}`;
      if (prevBtn) prevBtn.disabled = (page || 1) <= 1;
      if (nextBtn) nextBtn.disabled = (page || 1) >= this.robotCmdTotalPages;

      if (!commands?.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No matching robot command records found.</td></tr>`;
        return;
      }

      tbody.innerHTML = commands
        .map((c) => {
          const timeStr = c.created_at ? new Date(c.created_at).toLocaleTimeString() : '—';
          const statusClass = c.status === 'executed' ? 'active' : c.status === 'failed' ? 'expired' : 'warning';
          const payloadPreview = c.gesture_name
            ? `<span class="badge badge-green text-xs font-mono">${escapeHtml(c.gesture_name)}</span>`
            : `<span class="font-mono text-xs text-dim">${escapeHtml(JSON.stringify(c.servo_payload || {}).slice(0, 30))}...</span>`;

          return `
            <tr>
              <td><span class="font-mono text-xs text-dim">#${c.id}</span></td>
              <td><span class="badge badge-outline text-xs">${escapeHtml(c.command_type)}</span></td>
              <td>${payloadPreview}</td>
              <td><span class="text-dim text-xs">${escapeHtml(c.triggered_by || 'system')}</span></td>
              <td><span class="badge badge-${statusClass}">${escapeHtml((c.status || 'pending').toUpperCase())}</span></td>
              <td><span class="font-mono text-xs text-cyan">${c.execution_time_ms ? `${c.execution_time_ms}ms` : '—'}</span></td>
              <td><span class="font-mono text-xs text-dim">${timeStr}</span></td>
            </tr>
          `;
        })
        .join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state text-danger">Failed to load command history: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // --- Export Role-Tailored Report ---
  async exportAnalyticsReport() {
    this.showToast('Generating role-customized analytics report...');
    try {
      const res = await adminApi.getAnalyticsReport({
        period: this.analyticsPeriod,
        startDate: this.analyticsStartDate,
        endDate: this.analyticsEndDate,
      });

      if (!res.success || !res.data) {
        this.showToast(res.error || 'Failed to generate report', true);
        return;
      }

      const report = res.data;
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `virtex_report_${report.generatedForRole || 'staff'}_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      this.showToast(`✅ Downloaded ${report.reportType} report for role [${report.generatedForRole}].`);
    } catch (err) {
      this.showToast(`Report export error: ${err.message}`, true);
    }
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
        password: document.getElementById('mem-password')?.value.trim() || undefined,
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

  /** Fill the fee-plan modal for a new plan (no argument) or for editing an existing plan. */
  resetPlanForm(plan = null) {
    const form = document.getElementById('form-add-plan');
    if (!form) return;
    form.reset();
    document.getElementById('plan-edit-id').value = plan ? plan.id : '';
    document.getElementById('plan-modal-title').textContent = plan ? `Edit fee plan — ${plan.name}` : 'Create fee plan';
    document.getElementById('plan-submit-btn').textContent = plan ? 'Save changes' : 'Add Plan';
    if (plan) {
      document.getElementById('plan-name').value = plan.name;
      document.getElementById('plan-price').value = Number(plan.price_inr);
      document.getElementById('plan-duration').value = plan.duration_months;
      document.getElementById('plan-perks').value = (plan.perks || []).join(', ');
    }
    const aud = form.querySelector(`input[name="plan-audience"][value="${plan?.audience || 'all'}"]`);
    if (aud) aud.checked = true;
    renderPlanWeek(plan?.weekly_schedule || {});
  }

  setupPlanForm() {
    const form = document.getElementById('form-add-plan');
    document.getElementById('plan-week')?.addEventListener('change', (e) => {
      const row = e.target.closest('.pl-day'); if (row && e.target.tagName === 'SELECT') row.dataset.type = e.target.value;
    });
    form?.querySelectorAll('[data-pl-preset]').forEach((b) => b.addEventListener('click', () => {
      const cur = readPlanWeek(true);
      if (b.dataset.plPreset === 'clear') renderPlanWeek({});
      else if (b.dataset.plPreset === 'ladies') renderPlanWeek({ ...cur, sat: { type: 'ladies', start: '16:00', end: '18:00' } });
      else renderPlanWeek({ mon: { type: 'pt', start: '07:00', end: '08:00' }, tue: { type: 'self' }, wed: { type: 'pt', start: '07:00', end: '08:00' }, thu: { type: 'self' }, fri: { type: 'pt', start: '07:00', end: '08:00' }, sat: { type: 'self' }, sun: { type: 'rest' } });
    }));
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawPerks = document.getElementById('plan-perks').value.trim();
      const editId = document.getElementById('plan-edit-id').value;
      const week = readPlanWeek();
      if (typeof week === 'string') { this.showToast(week, true); return; }
      const planData = {
        name: document.getElementById('plan-name').value.trim(),
        priceInr: Number(document.getElementById('plan-price').value),
        durationMonths: parseInt(document.getElementById('plan-duration').value, 10) || 1,
        perks: rawPerks ? rawPerks.split(',').map((p) => p.trim()).filter(Boolean) : ['Full Gym Access'],
        audience: form.querySelector('input[name="plan-audience"]:checked')?.value || 'all',
        weeklySchedule: week,
      };
      if (!editId) planData.badgeLabel = 'New';

      const valError = adminState.validatePlan(planData);
      if (valError) {
        this.showToast(valError, true);
        return;
      }

      this.showToast(editId ? 'Saving fee plan...' : 'Publishing fee plan...');
      const res = editId ? await adminApi.updatePlan(editId, planData) : await adminApi.createPlan(planData);
      if (res.success) {
        this.showToast(editId ? `Fee plan "${planData.name}" saved.` : `Plan "${planData.name}" published!`);
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
      const collectedHours = this.collectOperatingHours();
      const profileData = {
        gymName: document.getElementById('prof-name').value.trim(),
        tagline: document.getElementById('prof-tagline').value.trim(),
        phone: document.getElementById('prof-phone').value.trim(),
        email: document.getElementById('prof-email').value.trim(),
        address: document.getElementById('prof-address').value.trim(),
      };
      if (collectedHours && collectedHours.length > 0) {
        profileData.operatingHours = collectedHours;
      }

      const valError = adminState.validateProfile(profileData);
      if (valError) {
        this.showToast(valError, true);
        return;
      }

      this.showToast('Saving facility profile to PostgreSQL...');
      const res = await adminApi.updateGymSettings(profileData);
      if (res.success) {
        this.showToast('✅ Gym facility profile updated successfully!');
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
          await this.fetchAnalyticsRobotCommands();
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
        await this.fetchAnalyticsRobotCommands();
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

    const roleCreds = {}; // demo staff accounts removed; switch accounts by logging out and in

    document.querySelectorAll('.role-option-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const account = btn.dataset.account;
        const password = roleCreds[account];
        if (!account || !password) return; // e.g. the "Member Kiosk" link — just follow it

        this.showToast(`Switching session to [${account}]...`);
        const res = await adminApi.login(account, password);

        if (res.success) {
          adminState.setUser(res.data.user);
          this.updateTopbarUser();
          this.setupRealtimeSync(res.data.token);
          this.closeModal('modal-role-switcher');
          const name = res.data.user.fullName || res.data.user.full_name || res.data.user.username;
          this.showToast(`Switched account: ${name} (${res.data.user.role.toUpperCase()})`);
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
      window.location.href = 'index.html';
    });
  }
}

// Instantiate and boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new AdminDashboardApp();
  window.adminApp = app;
  app.init();
});
