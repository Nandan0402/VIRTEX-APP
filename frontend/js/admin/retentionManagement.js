/**
 * Virtex Admin - Member Retention and Communication Management Controller
 * Handles 10 Core Features:
 * 1. Email Templates
 * 2. Push Notification Campaigns
 * 3. Member Announcements
 * 4. Automated Renewal Reminders
 * 5. Inactive / Dormant Member Follow-ups
 * 6. Member Feedback & NPS Surveys
 * 7. Complaint Management Tickets
 * 8. Communication History Audit Trail
 * 9. Audience Segmentation
 * 10. Campaign Performance Reports
 */

(function () {
  'use strict';

  // API Endpoints
  const API_BASE = '/api/retention';
  const API_ADMIN_BASE = '/api/admin/retention';

  // Local State
  let state = {
    currentTab: 'campaigns',
    campaigns: [],
    templates: [],
    segments: [],
    announcements: [],
    expiringRenewals: [],
    inactives: [],
    feedbacks: [],
    complaints: [],
    history: [],
    reports: null,
    membersList: [],
    filters: {
      campType: 'all',
      campStatus: 'all',
      campSearch: '',
      tplCategory: 'all',
      tplSearch: '',
      fbSentiment: 'all',
      fbCategory: 'all',
      fbSearch: '',
      cmpStatus: 'all',
      cmpPriority: 'all',
      cmpSearch: '',
      histChannel: 'all'
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

  // Unified Fetch with fallback to /api/admin/retention
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
    toast.className = `ret-toast toast-${type}`;
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
    toast.innerHTML = `<span>${type === 'success' ? '🚀' : '⚠️'}</span> <span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
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

  function formatDateTime(dStr) {
    if (!dStr) return 'N/A';
    try {
      const d = new Date(dStr);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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
    const tabBtns = document.querySelectorAll('.ret-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentTab = btn.dataset.tab;

        document.querySelectorAll('.ret-tab-content').forEach(pane => {
          pane.style.display = 'none';
        });

        const activePane = document.getElementById(`tab-content-${state.currentTab}`);
        if (activePane) {
          activePane.style.display = 'block';
        }

        if (state.currentTab === 'reports') {
          loadReports();
        }
      });
    });
  }

  function initFilterListeners() {
    // Campaign filters
    const campType = document.getElementById('camp-filter-type');
    const campStatus = document.getElementById('camp-filter-status');
    const campSearch = document.getElementById('camp-search');
    if (campType) campType.addEventListener('change', (e) => { state.filters.campType = e.target.value; renderCampaigns(); });
    if (campStatus) campStatus.addEventListener('change', (e) => { state.filters.campStatus = e.target.value; renderCampaigns(); });
    if (campSearch) campSearch.addEventListener('input', (e) => { state.filters.campSearch = e.target.value.toLowerCase(); renderCampaigns(); });

    // Template filters
    const tplCat = document.getElementById('tpl-filter-category');
    const tplSearch = document.getElementById('tpl-search');
    if (tplCat) tplCat.addEventListener('change', (e) => { state.filters.tplCategory = e.target.value; renderTemplates(); });
    if (tplSearch) tplSearch.addEventListener('input', (e) => { state.filters.tplSearch = e.target.value.toLowerCase(); renderTemplates(); });

    // Feedback filters
    const fbSent = document.getElementById('fb-filter-sentiment');
    const fbCat = document.getElementById('fb-filter-category');
    const fbSearch = document.getElementById('fb-search');
    if (fbSent) fbSent.addEventListener('change', (e) => { state.filters.fbSentiment = e.target.value; renderFeedbacks(); });
    if (fbCat) fbCat.addEventListener('change', (e) => { state.filters.fbCategory = e.target.value; renderFeedbacks(); });
    if (fbSearch) fbSearch.addEventListener('input', (e) => { state.filters.fbSearch = e.target.value.toLowerCase(); renderFeedbacks(); });

    // Complaints filters
    const cmpStat = document.getElementById('cmp-filter-status');
    const cmpPrio = document.getElementById('cmp-filter-priority');
    const cmpSearch = document.getElementById('cmp-search');
    if (cmpStat) cmpStat.addEventListener('change', (e) => { state.filters.cmpStatus = e.target.value; renderComplaints(); });
    if (cmpPrio) cmpPrio.addEventListener('change', (e) => { state.filters.cmpPriority = e.target.value; renderComplaints(); });
    if (cmpSearch) cmpSearch.addEventListener('input', (e) => { state.filters.cmpSearch = e.target.value.toLowerCase(); renderComplaints(); });

    // History filter
    const histChan = document.getElementById('hist-filter-channel');
    if (histChan) histChan.addEventListener('change', (e) => { state.filters.histChannel = e.target.value; renderHistory(); });
  }

  // ==========================================
  // DATA FETCHING
  // ==========================================
  async function loadAllData() {
    await Promise.allSettled([
      loadReports(),
      loadCampaigns(),
      loadTemplates(),
      loadSegments(),
      loadAnnouncements(),
      loadRenewals(),
      loadInactives(),
      loadFeedbacks(),
      loadComplaints(),
      loadHistory(),
      loadMembersDropdown()
    ]);
  }

  async function loadReports() {
    try {
      const res = await apiFetch('/reports');
      if (res && res.success) {
        state.reports = res.data;
        renderKpis();
        renderReports();
      }
    } catch (e) {
      console.error('Failed to load retention reports:', e);
    }
  }

  async function loadCampaigns() {
    try {
      const res = await apiFetch('/campaigns');
      if (res && res.success) {
        state.campaigns = res.data;
        renderCampaigns();
      }
    } catch (e) {
      console.error('Failed to load campaigns:', e);
    }
  }

  async function loadTemplates() {
    try {
      const res = await apiFetch('/templates');
      if (res && res.success) {
        state.templates = res.data;
        renderTemplates();
        populateTemplateDropdown();
      }
    } catch (e) {
      console.error('Failed to load templates:', e);
    }
  }

  async function loadSegments() {
    try {
      const res = await apiFetch('/segments');
      if (res && res.success) {
        state.segments = res.data;
        renderSegments();
        populateSegmentDropdown();
      }
    } catch (e) {
      console.error('Failed to load segments:', e);
    }
  }

  async function loadAnnouncements() {
    try {
      const res = await apiFetch('/announcements');
      if (res && res.success) {
        state.announcements = res.data;
        renderAnnouncements();
      }
    } catch (e) {
      console.error('Failed to load announcements:', e);
    }
  }

  async function loadRenewals() {
    try {
      const res = await apiFetch('/renewals/expiring?daysAhead=14');
      if (res && res.success) {
        state.expiringRenewals = res.data;
        renderRenewals();
        const badge = document.getElementById('tab-badge-renewals');
        if (badge) badge.textContent = state.expiringRenewals.length;
      }
    } catch (e) {
      console.error('Failed to load renewals:', e);
    }
  }

  async function loadInactives() {
    try {
      const res = await apiFetch('/inactives?daysInactive=14');
      if (res && res.success) {
        state.inactives = res.data;
        renderInactives();
        const badge = document.getElementById('tab-badge-inactives');
        if (badge) badge.textContent = state.inactives.length;
      }
    } catch (e) {
      console.error('Failed to load inactives:', e);
    }
  }

  async function loadFeedbacks() {
    try {
      const res = await apiFetch('/feedbacks');
      if (res && res.success) {
        state.feedbacks = res.data;
        renderFeedbacks();
      }
    } catch (e) {
      console.error('Failed to load feedbacks:', e);
    }
  }

  async function loadComplaints() {
    try {
      const res = await apiFetch('/complaints');
      if (res && res.success) {
        state.complaints = res.data;
        renderComplaints();
        const badge = document.getElementById('tab-badge-complaints');
        const openCount = state.complaints.filter(c => c.status === 'open' || c.status === 'in_progress').length;
        if (badge) badge.textContent = openCount;
      }
    } catch (e) {
      console.error('Failed to load complaints:', e);
    }
  }

  async function loadHistory() {
    try {
      const res = await apiFetch('/history?limit=150');
      if (res && res.success) {
        state.history = res.data;
        renderHistory();
      }
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  }

  async function loadMembersDropdown() {
    try {
      const res = await fetch('/api/members?limit=200', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data && (data.success || Array.isArray(data))) {
        state.membersList = Array.isArray(data) ? data : (data.data || []);
        populateMemberDropdowns();
      }
    } catch (e) {
      console.warn('Failed to load members for dropdown:', e);
    }
  }

  // ==========================================
  // RENDERERS
  // ==========================================

  function renderKpis() {
    if (!state.reports) return;
    const { overview, nps, complaints } = state.reports;

    const elSent = document.getElementById('kpi-total-sent');
    const elDelivery = document.getElementById('kpi-delivery-rate');
    const elOpen = document.getElementById('kpi-open-rate');
    const elConversion = document.getElementById('kpi-conversion-rate');
    const elNps = document.getElementById('kpi-nps-score');
    const elComplaints = document.getElementById('kpi-open-complaints');

    if (elSent) elSent.textContent = overview.totalSent.toLocaleString();
    if (elDelivery) elDelivery.textContent = `${overview.deliveryRate}%`;
    if (elOpen) elOpen.textContent = `${overview.openRate}%`;
    if (elConversion) elConversion.textContent = `${overview.conversionRate}%`;
    if (elNps) elNps.textContent = `+${nps.npsScore}`;
    if (elComplaints) elComplaints.textContent = complaints.open_complaints || 0;
  }

  // 1. Render Campaigns
  function renderCampaigns() {
    const container = document.getElementById('campaigns-grid');
    if (!container) return;

    let items = state.campaigns.filter(c => {
      if (state.filters.campType !== 'all' && c.campaign_type !== state.filters.campType) return false;
      if (state.filters.campStatus !== 'all' && c.status !== state.filters.campStatus) return false;
      if (state.filters.campSearch) {
        const q = state.filters.campSearch;
        if (!c.title.toLowerCase().includes(q) && !c.message_body.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (items.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 2.5rem; text-align: center; background: #11141e; border: 1px dashed #1e2433; border-radius: 10px;">
          <div style="font-size: 2rem; margin-bottom: 8px;">📣</div>
          <h4 style="color: #fff;">No Campaigns Found</h4>
          <p style="color: var(--text-dim); font-size: 0.88rem;">Create a push notification or automated renewal campaign to engage your members.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(c => `
      <div class="camp-card">
        <div>
          <div class="camp-header">
            <span class="badge badge-outline text-xs">${escapeHtml(c.campaign_type.replace('_', ' ').toUpperCase())}</span>
            <span class="status-pill status-${c.status === 'completed' ? 'operational' : c.status === 'running' ? 'good' : 'neutral'}">
              ● ${c.status.toUpperCase()}
            </span>
          </div>
          <h4 class="camp-title">${escapeHtml(c.title)}</h4>
          <div style="font-size: 0.8rem; color: var(--ret-accent); margin-top: 4px;">
            Audience: <strong>${escapeHtml(c.segment_name || c.target_segment_code)}</strong>
          </div>
          <p style="font-size: 0.82rem; color: #94a3b8; margin: 8px 0; line-height: 1.4;">
            ${escapeHtml(c.message_body.slice(0, 110))}${c.message_body.length > 110 ? '...' : ''}
          </p>

          <div class="camp-metrics-row">
            <div class="camp-metric-item">
              <span class="camp-metric-val">${c.sent_count}</span>
              <span class="camp-metric-label">Sent</span>
            </div>
            <div class="camp-metric-item">
              <span class="camp-metric-val text-green">${c.delivered_count}</span>
              <span class="camp-metric-label">Delivered</span>
            </div>
            <div class="camp-metric-item">
              <span class="camp-metric-val text-cyan">${c.opened_count}</span>
              <span class="camp-metric-label">Opened</span>
            </div>
            <div class="camp-metric-item">
              <span class="camp-metric-val text-purple">${c.converted_count}</span>
              <span class="camp-metric-label">Converted</span>
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; border-top: 1px solid #1a1e2c; padding-top: 10px;">
          <span style="font-size: 0.75rem; color: var(--text-dim);">${formatDate(c.created_at)}</span>
          ${c.status === 'draft' ? `
            <button class="btn btn-sm btn-green" onclick="window.VirtexRet.launchCampaign(${c.id})">
              🚀 Launch Now
            </button>
          ` : '<span style="font-size: 0.78rem; color: #00e676; font-weight: 600;">✓ Dispatched</span>'}
        </div>
      </div>
    `).join('');
  }

  // 2. Render Email Templates
  function renderTemplates() {
    const container = document.getElementById('templates-grid');
    if (!container) return;

    let items = state.templates.filter(t => {
      if (state.filters.tplCategory !== 'all' && t.category !== state.filters.tplCategory) return false;
      if (state.filters.tplSearch) {
        const q = state.filters.tplSearch;
        if (!t.name.toLowerCase().includes(q) && !t.subject.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (items.length === 0) {
      container.innerHTML = `<div style="color: var(--text-dim); padding: 1rem;">No templates found.</div>`;
      return;
    }

    container.innerHTML = items.map(t => `
      <div class="admin-card" style="padding: 1.25rem; background: #11141e; border: 1px solid #1e2433; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <h4 style="color: #fff; font-weight: 700; font-size: 1rem;">${escapeHtml(t.name)}</h4>
          <span class="badge badge-outline text-xs">${escapeHtml(t.category)}</span>
        </div>
        <div style="font-size: 0.82rem; color: var(--ret-cyan); margin-bottom: 8px;">
          ✉️ <strong>Subject:</strong> ${escapeHtml(t.subject)}
        </div>
        <div class="template-preview-box">
          ${t.body_html}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 0.78rem; color: var(--text-dim);">
          <span>Used in ${t.campaign_usage_count || 0} campaigns</span>
          <button class="btn btn-sm btn-outline" onclick="window.VirtexRet.useTemplateInCampaign(${t.id})">
            Apply to Campaign →
          </button>
        </div>
      </div>
    `).join('');
  }

  // 3. Render Audience Segments
  function renderSegments() {
    const container = document.getElementById('segments-grid');
    if (!container) return;

    container.innerHTML = state.segments.map(s => `
      <div class="admin-card" style="padding: 1.25rem; background: #11141e; border: 1px solid #1e2433; border-radius: 8px; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span class="badge badge-outline font-mono text-xs">${escapeHtml(s.code)}</span>
            <span class="font-mono font-bold text-green" style="font-size: 1.2rem;">${s.member_count} Members</span>
          </div>
          <h4 style="color: #fff; font-weight: 700; font-size: 1.05rem; margin-bottom: 4px;">${escapeHtml(s.name)}</h4>
          <p style="font-size: 0.82rem; color: var(--text-dim); line-height: 1.4;">${escapeHtml(s.description || 'Target retention cohort')}</p>
        </div>
        <div style="margin-top: 14px; display: flex; gap: 8px;">
          <button class="btn btn-sm btn-outline" style="width: 100%;" onclick="window.VirtexRet.viewSegmentMembers('${s.code}', '${escapeHtml(s.name)}')">
            👥 View Segment Roster
          </button>
        </div>
      </div>
    `).join('');
  }

  // 4. Render Announcements
  function renderAnnouncements() {
    const container = document.getElementById('announcements-container');
    if (!container) return;

    if (state.announcements.length === 0) {
      container.innerHTML = `<div style="color: var(--text-dim); padding: 1.5rem; text-align: center;">No active member announcements posted.</div>`;
      return;
    }

    container.innerHTML = state.announcements.map(a => `
      <div class="alert-banner-item" style="border-left-color: ${a.priority === 'urgent' ? 'var(--ret-red)' : 'var(--ret-accent)'};">
        <div class="alert-item-meta">
          <div class="alert-badge-icon">${a.priority === 'urgent' ? '🚨' : '📢'}</div>
          <div>
            <div style="font-weight: 700; color: #fff; font-size: 1rem;">${escapeHtml(a.title)}</div>
            <div style="font-size: 0.82rem; color: #cbd5e1; margin-top: 4px; line-height: 1.4;">
              ${escapeHtml(a.message)}
            </div>
            <div style="display: flex; gap: 12px; margin-top: 6px; font-size: 0.75rem; color: var(--text-dim);">
              <span>Priority: <strong>${a.priority.toUpperCase()}</strong></span>
              <span>Active: ${formatDate(a.start_date)} - ${formatDate(a.end_date)}</span>
            </div>
          </div>
        </div>
        <div>
          <button class="btn btn-sm btn-outline" onclick="window.VirtexRet.broadcastAnnouncementPush(${a.id})">
            📲 Broadcast Push
          </button>
        </div>
      </div>
    `).join('');
  }

  // 5. Render Renewal Reminders
  function renderRenewals() {
    const tbody = document.getElementById('renewals-tbody');
    if (!tbody) return;

    if (state.expiringRenewals.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim);">No memberships expiring within the next 14 days.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.expiringRenewals.map(m => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(m.full_name)}</div>
          <span class="font-mono text-xs text-dim">${escapeHtml(m.member_code || '')}</span>
        </td>
        <td>${escapeHtml(m.phone || 'N/A')}</td>
        <td><span class="badge badge-outline text-xs">${escapeHtml(m.plan_name || 'Standard')}</span></td>
        <td class="font-mono text-xs">${formatDate(m.fee_due_date)}</td>
        <td class="font-mono font-bold text-amber">${m.fee_due > 0 ? `₹${parseFloat(m.fee_due).toFixed(2)}` : '₹0.00'}</td>
        <td class="text-xs text-dim">${m.fee_alert_sent_at ? formatDateTime(m.fee_alert_sent_at) : 'Never'}</td>
        <td>
          <button class="btn btn-sm btn-green" onclick="window.VirtexRet.openSendReminderModal(${m.id}, '${escapeHtml(m.full_name)}')">
            🔔 Send Reminder
          </button>
        </td>
      </tr>
    `).join('');
  }

  // 6. Render Dormant Member Inactives
  function renderInactives() {
    const tbody = document.getElementById('inactives-tbody');
    if (!tbody) return;

    if (state.inactives.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-dim);">No members currently classified as dormant.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.inactives.map(m => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(m.full_name)}</div>
          <span class="font-mono text-xs text-dim">${escapeHtml(m.member_code || '')}</span>
        </td>
        <td>${escapeHtml(m.phone || 'N/A')}</td>
        <td><span class="badge badge-outline text-xs">${escapeHtml(m.plan_name || 'Standard')}</span></td>
        <td class="font-mono text-xs">${m.last_activity_date ? formatDate(m.last_activity_date) : '<span class="text-amber">14+ Days Inactive</span>'}</td>
        <td class="font-mono">${m.past_followup_count} times</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="window.VirtexRet.openWinBackModal(${m.id}, '${escapeHtml(m.full_name)}')">
            🎁 Win-Back Message
          </button>
        </td>
      </tr>
    `).join('');
  }

  // 7. Render Feedbacks (NPS)
  function renderFeedbacks() {
    const container = document.getElementById('feedbacks-container');
    if (!container) return;

    let items = state.feedbacks.filter(f => {
      if (state.filters.fbSentiment !== 'all' && f.sentiment !== state.filters.fbSentiment) return false;
      if (state.filters.fbCategory !== 'all' && f.category !== state.filters.fbCategory) return false;
      if (state.filters.fbSearch) {
        const q = state.filters.fbSearch;
        if (!f.feedback_text.toLowerCase().includes(q) && !f.member_name.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (items.length === 0) {
      container.innerHTML = `<div style="color: var(--text-dim); padding: 1.5rem; text-align: center;">No feedback entries found.</div>`;
      return;
    }

    container.innerHTML = items.map(f => `
      <div class="admin-card" style="padding: 1.25rem; background: #11141e; border: 1px solid #1e2433; border-radius: 8px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div>
            <span style="font-weight: 700; color: #fff; font-size: 0.95rem;">${escapeHtml(f.member_name)}</span>
            <span class="font-mono text-xs text-dim">(${escapeHtml(f.plan_name || 'Member')})</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="font-mono font-bold" style="color: ${f.nps_score >= 9 ? 'var(--ret-accent)' : f.nps_score <= 6 ? 'var(--ret-red)' : 'var(--ret-blue)'};">
              Score: ${f.nps_score}/10
            </span>
            <span class="status-pill sentiment-${f.sentiment}">${f.sentiment.toUpperCase()}</span>
          </div>
        </div>

        <p style="font-size: 0.88rem; color: #cbd5e1; line-height: 1.45; margin: 8px 0;">
          "${escapeHtml(f.feedback_text)}"
        </p>

        ${f.admin_response ? `
          <div style="background: #090c12; border-left: 3px solid var(--ret-accent); padding: 8px 12px; border-radius: 4px; font-size: 0.82rem; color: #94a3b8; margin-top: 8px;">
            <strong style="color: #fff;">Admin Response:</strong> ${escapeHtml(f.admin_response)}
          </div>
        ` : `
          <div style="margin-top: 8px;">
            <button class="btn btn-sm btn-outline" onclick="window.VirtexRet.openRespondFeedbackModal(${f.id})">
              💬 Respond & Record Action
            </button>
          </div>
        `}
      </div>
    `).join('');
  }

  // 8. Render Complaints Management
  function renderComplaints() {
    const tbody = document.getElementById('complaints-tbody');
    if (!tbody) return;

    let items = state.complaints.filter(c => {
      if (state.filters.cmpStatus !== 'all' && c.status !== state.filters.cmpStatus) return false;
      if (state.filters.cmpPriority !== 'all' && c.priority !== state.filters.cmpPriority) return false;
      if (state.filters.cmpSearch) {
        const q = state.filters.cmpSearch;
        if (!c.subject.toLowerCase().includes(q) && !c.ticket_number.toLowerCase().includes(q) && !c.member_name.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim);">No complaint tickets logged.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(c => `
      <tr>
        <td class="font-mono font-bold text-cyan">${escapeHtml(c.ticket_number)}</td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(c.member_name)}</div>
          <div style="font-size: 0.75rem; color: var(--text-dim);">${escapeHtml(c.member_phone || '')}</div>
        </td>
        <td><span class="status-pill priority-${c.priority}">${c.priority.toUpperCase()}</span></td>
        <td style="max-width: 250px;">
          <div style="font-weight: 600; color: #fff; font-size: 0.85rem;">${escapeHtml(c.subject)}</div>
          <div style="font-size: 0.78rem; color: var(--text-dim); line-height: 1.3;">${escapeHtml(c.description.slice(0, 80))}...</div>
        </td>
        <td><span class="badge badge-outline text-xs">${escapeHtml(c.status.toUpperCase())}</span></td>
        <td style="font-size: 0.8rem; color: #cbd5e1;">${escapeHtml(c.assigned_to || 'Duty Lead')}</td>
        <td>
          ${c.status !== 'resolved' ? `
            <button class="btn btn-sm btn-green" onclick="window.VirtexRet.openResolveComplaintModal(${c.id}, '${escapeHtml(c.ticket_number)}')">
              ✓ Resolve Ticket
            </button>
          ` : '<span style="font-size: 0.75rem; color: #00e676;">✓ Closed</span>'}
        </td>
      </tr>
    `).join('');
  }

  // 9. Render Communication History
  function renderHistory() {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    let items = state.history.filter(h => {
      if (state.filters.histChannel !== 'all' && h.channel !== state.filters.histChannel) return false;
      return true;
    });

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-dim);">No communication history recorded.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(h => `
      <tr>
        <td class="font-mono text-xs">${formatDateTime(h.created_at)}</td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(h.member_name)}</div>
          <span class="font-mono text-xs text-dim">${escapeHtml(h.member_code || '')}</span>
        </td>
        <td><span class="badge badge-outline text-xs">${escapeHtml(h.channel.toUpperCase())}</span></td>
        <td style="max-width: 280px;">
          <div style="font-weight: 600; color: #fff; font-size: 0.85rem;">${escapeHtml(h.subject || '')}</div>
          <div style="font-size: 0.78rem; color: #94a3b8; line-height: 1.3;">${escapeHtml(h.message.slice(0, 100))}...</div>
        </td>
        <td><span class="status-pill status-${h.delivery_status === 'delivered' || h.delivery_status === 'opened' ? 'operational' : 'good'}">${h.delivery_status.toUpperCase()}</span></td>
        <td style="font-size: 0.78rem; color: var(--text-dim);">${escapeHtml(h.sent_by)}</td>
      </tr>
    `).join('');
  }

  // 10. Render Campaign Reports & NPS Breakdown
  function renderReports() {
    if (!state.reports) return;
    const { overview, nps, campaignTypeBreakdown } = state.reports;

    const elNpsBig = document.getElementById('report-nps-big-score');
    if (elNpsBig) elNpsBig.textContent = `+${nps.npsScore}`;

    const elNpsDetails = document.getElementById('report-nps-details');
    if (elNpsDetails) {
      elNpsDetails.innerHTML = `
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; width: 100%; margin-top: 10px;">
          <span style="color: var(--ret-accent);">Promoters (9-10): <strong>${nps.promoters}</strong></span>
          <span style="color: var(--ret-blue);">Passives (7-8): <strong>${nps.passives}</strong></span>
          <span style="color: var(--ret-red);">Detractors (0-6): <strong>${nps.detractors}</strong></span>
        </div>
      `;
    }

    const typeTbody = document.getElementById('report-types-tbody');
    if (typeTbody && campaignTypeBreakdown) {
      typeTbody.innerHTML = campaignTypeBreakdown.map(t => `
        <tr>
          <td><span class="badge badge-outline text-xs">${escapeHtml(t.campaign_type.replace('_', ' ').toUpperCase())}</span></td>
          <td class="font-mono">${t.campaigns_count}</td>
          <td class="font-mono font-bold">${t.sent}</td>
          <td class="font-mono font-bold text-green">${t.converted}</td>
          <td class="font-mono text-cyan">${t.sent > 0 ? Math.round((t.converted / t.sent) * 100) : 0}%</td>
        </tr>
      `).join('');
    }
  }

  // ==========================================
  // MODALS & ACTIONS
  // ==========================================

  function populateMemberDropdowns() {
    const selects = [
      document.getElementById('modal-feedback-member'),
      document.getElementById('modal-complaint-member')
    ];
    selects.forEach(sel => {
      if (!sel) return;
      sel.innerHTML = `<option value="">-- Select Gym Member --</option>` +
        state.membersList.map(m => `<option value="${m.id}">${escapeHtml(m.full_name)} (${escapeHtml(m.member_code || m.phone || '')})</option>`).join('');
    });
  }

  function populateSegmentDropdown() {
    const sel = document.getElementById('modal-camp-segment');
    if (sel) {
      sel.innerHTML = state.segments.map(s => `<option value="${s.code}">${escapeHtml(s.name)} (${s.member_count} members)</option>`).join('');
    }
  }

  function populateTemplateDropdown() {
    const sel = document.getElementById('modal-camp-template');
    if (sel) {
      sel.innerHTML = `<option value="">-- None (Custom Message) --</option>` +
        state.templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
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
    const btnCamp = document.getElementById('btn-open-create-campaign');
    if (btnCamp) btnCamp.addEventListener('click', () => openModal('modal-create-campaign'));

    const btnTpl = document.getElementById('btn-open-create-template');
    if (btnTpl) btnTpl.addEventListener('click', () => openModal('modal-create-template'));

    const btnAnn = document.getElementById('btn-open-create-announcement');
    if (btnAnn) btnAnn.addEventListener('click', () => openModal('modal-create-announcement'));

    const btnFb = document.getElementById('btn-open-log-feedback');
    if (btnFb) btnFb.addEventListener('click', () => openModal('modal-log-feedback'));

    const btnCmp = document.getElementById('btn-open-create-complaint');
    if (btnCmp) btnCmp.addEventListener('click', () => openModal('modal-create-complaint'));

    // Modal Close Buttons
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const overlay = btn.closest('.ret-modal-overlay');
        if (overlay) closeModal(overlay.id);
      });
    });

    // Form Submissions
    initForms();
  }

  function initForms() {
    // 1. Create Campaign Form
    const formCamp = document.getElementById('form-create-campaign');
    if (formCamp) {
      formCamp.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          title: document.getElementById('modal-camp-title').value.trim(),
          campaign_type: document.getElementById('modal-camp-type').value,
          target_segment_code: document.getElementById('modal-camp-segment').value,
          template_id: parseInt(document.getElementById('modal-camp-template').value, 10) || null,
          message_title: document.getElementById('modal-camp-msg-title').value.trim(),
          message_body: document.getElementById('modal-camp-body').value.trim()
        };

        try {
          const res = await apiFetch('/campaigns', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Retention campaign created!');
            closeModal('modal-create-campaign');
            formCamp.reset();
            loadCampaigns();
            loadReports();
          } else {
            showToast(res.message || 'Failed to create campaign', 'error');
          }
        } catch (err) {
          showToast('Failed to create campaign', 'error');
        }
      });
    }

    // 2. Create Template Form
    const formTpl = document.getElementById('form-create-template');
    if (formTpl) {
      formTpl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          name: document.getElementById('modal-tpl-name').value.trim(),
          category: document.getElementById('modal-tpl-category').value,
          subject: document.getElementById('modal-tpl-subject').value.trim(),
          body_html: document.getElementById('modal-tpl-body').value.trim()
        };

        try {
          const res = await apiFetch('/templates', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Email template saved!');
            closeModal('modal-create-template');
            formTpl.reset();
            loadTemplates();
          } else {
            showToast(res.message || 'Failed to create template', 'error');
          }
        } catch (err) {
          showToast('Failed to create template', 'error');
        }
      });
    }

    // 3. Create Announcement Form
    const formAnn = document.getElementById('form-create-announcement');
    if (formAnn) {
      formAnn.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          title: document.getElementById('modal-ann-title').value.trim(),
          message: document.getElementById('modal-ann-message').value.trim(),
          priority: document.getElementById('modal-ann-priority').value,
          broadcast_push: document.getElementById('modal-ann-push').checked
        };

        try {
          const res = await apiFetch('/announcements', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Member announcement published!');
            closeModal('modal-create-announcement');
            formAnn.reset();
            loadAnnouncements();
            loadCampaigns();
          } else {
            showToast(res.message || 'Failed to publish announcement', 'error');
          }
        } catch (err) {
          showToast('Failed to publish announcement', 'error');
        }
      });
    }

    // 4. Send Renewal Reminder Form
    const formReminder = document.getElementById('form-send-reminder');
    if (formReminder) {
      formReminder.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          member_id: parseInt(document.getElementById('modal-reminder-mem-id').value, 10),
          channel: document.getElementById('modal-reminder-channel').value,
          customMessage: document.getElementById('modal-reminder-msg').value.trim()
        };

        try {
          const res = await apiFetch('/renewals/send-reminder', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Renewal reminder sent!');
            closeModal('modal-send-reminder');
            loadRenewals();
            loadHistory();
            loadReports();
          } else {
            showToast(res.message || 'Failed to send reminder', 'error');
          }
        } catch (err) {
          showToast('Failed to send reminder', 'error');
        }
      });
    }

    // 5. Send Win-Back Message Form
    const formWinBack = document.getElementById('form-send-winback');
    if (formWinBack) {
      formWinBack.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          member_id: parseInt(document.getElementById('modal-winback-mem-id').value, 10),
          channel: document.getElementById('modal-winback-channel').value,
          message: document.getElementById('modal-winback-msg').value.trim(),
          offerCode: document.getElementById('modal-winback-offer').value.trim()
        };

        try {
          const res = await apiFetch('/inactives/send-followup', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Win-back message delivered!');
            closeModal('modal-send-winback');
            loadInactives();
            loadHistory();
          } else {
            showToast(res.message || 'Failed to send win-back', 'error');
          }
        } catch (err) {
          showToast('Failed to send win-back', 'error');
        }
      });
    }

    // 6. Record Feedback Form
    const formFb = document.getElementById('form-log-feedback');
    if (formFb) {
      formFb.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          member_id: parseInt(document.getElementById('modal-feedback-member').value, 10),
          nps_score: parseInt(document.getElementById('modal-feedback-score').value, 10),
          category: document.getElementById('modal-feedback-cat').value,
          feedback_text: document.getElementById('modal-feedback-text').value.trim()
        };

        try {
          const res = await apiFetch('/feedbacks', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Member feedback saved!');
            closeModal('modal-log-feedback');
            formFb.reset();
            loadFeedbacks();
            loadReports();
          } else {
            showToast(res.message || 'Failed to save feedback', 'error');
          }
        } catch (err) {
          showToast('Failed to save feedback', 'error');
        }
      });
    }

    // 7. Respond to Feedback Form
    const formRespFb = document.getElementById('form-respond-feedback');
    if (formRespFb) {
      formRespFb.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('modal-resp-fb-id').value;
        const response = document.getElementById('modal-resp-fb-text').value.trim();

        try {
          const res = await apiFetch(`/feedbacks/${id}/respond`, {
            method: 'PATCH',
            body: JSON.stringify({ admin_response: response })
          });
          if (res && res.success) {
            showToast('Response saved!');
            closeModal('modal-respond-feedback');
            loadFeedbacks();
          } else {
            showToast(res.message || 'Failed to respond', 'error');
          }
        } catch (err) {
          showToast('Failed to record response', 'error');
        }
      });
    }

    // 8. Create Complaint Ticket Form
    const formCmp = document.getElementById('form-create-complaint');
    if (formCmp) {
      formCmp.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          member_id: parseInt(document.getElementById('modal-complaint-member').value, 10),
          category: document.getElementById('modal-complaint-cat').value,
          priority: document.getElementById('modal-complaint-priority').value,
          subject: document.getElementById('modal-complaint-subj').value.trim(),
          description: document.getElementById('modal-complaint-desc').value.trim(),
          assigned_to: document.getElementById('modal-complaint-assign').value.trim()
        };

        try {
          const res = await apiFetch('/complaints', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Complaint ticket logged!');
            closeModal('modal-create-complaint');
            formCmp.reset();
            loadComplaints();
            loadReports();
          } else {
            showToast(res.message || 'Failed to log complaint', 'error');
          }
        } catch (err) {
          showToast('Failed to create ticket', 'error');
        }
      });
    }

    // 9. Resolve Complaint Form
    const formResCmp = document.getElementById('form-resolve-complaint');
    if (formResCmp) {
      formResCmp.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('modal-res-cmp-id').value;
        const payload = {
          status: document.getElementById('modal-res-cmp-status').value,
          resolution_notes: document.getElementById('modal-res-cmp-notes').value.trim()
        };

        try {
          const res = await apiFetch(`/complaints/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          });
          if (res && res.success) {
            showToast('Complaint status updated!');
            closeModal('modal-resolve-complaint');
            loadComplaints();
            loadReports();
          } else {
            showToast(res.message || 'Failed to update ticket', 'error');
          }
        } catch (err) {
          showToast('Failed to resolve ticket', 'error');
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
  window.VirtexRet = {
    async launchCampaign(id) {
      if (!confirm('Launch this campaign and dispatch to the target segment?')) return;
      try {
        const res = await apiFetch(`/campaigns/${id}/launch`, { method: 'POST' });
        if (res && res.success) {
          showToast('Campaign successfully dispatched!');
          loadCampaigns();
          loadHistory();
          loadReports();
        } else {
          showToast(res.message || 'Failed to launch', 'error');
        }
      } catch (e) {
        showToast('Error dispatching campaign', 'error');
      }
    },

    useTemplateInCampaign(tplId) {
      const tpl = state.templates.find(t => t.id === tplId);
      if (!tpl) return;
      document.getElementById('modal-camp-title').value = tpl.name;
      document.getElementById('modal-camp-msg-title').value = tpl.subject;
      document.getElementById('modal-camp-body').value = tpl.body_html.replace(/<[^>]*>/g, '').trim();
      document.getElementById('modal-camp-template').value = tpl.id;
      openModal('modal-create-campaign');
    },

    async viewSegmentMembers(segmentCode, segmentName) {
      try {
        const res = await apiFetch(`/segments/${segmentCode}/members`);
        if (res && res.success) {
          document.getElementById('modal-roster-title').textContent = `${segmentName} (${res.total} Members)`;
          const tbody = document.getElementById('modal-roster-tbody');
          tbody.innerHTML = res.data.map(m => `
            <tr>
              <td style="font-weight: 600; color: #fff;">${escapeHtml(m.full_name)}</td>
              <td class="font-mono text-xs">${escapeHtml(m.member_code || '')}</td>
              <td>${escapeHtml(m.phone || 'N/A')}</td>
              <td><span class="badge badge-outline text-xs">${escapeHtml(m.plan_name || '')}</span></td>
              <td><span class="status-pill status-${m.status === 'active' ? 'operational' : 'maintenance_needed'}">${m.status}</span></td>
            </tr>
          `).join('');
          openModal('modal-view-roster');
        }
      } catch (e) {
        showToast('Failed to load roster', 'error');
      }
    },

    async broadcastAnnouncementPush(annId) {
      const ann = state.announcements.find(a => a.id === annId);
      if (!ann) return;
      if (!confirm(`Broadcast announcement "${ann.title}" to all active members via Push Notification?`)) return;

      try {
        const res = await apiFetch('/campaigns', {
          method: 'POST',
          body: JSON.stringify({
            title: `Push Broadcast: ${ann.title}`,
            campaign_type: 'push_notification',
            target_segment_code: 'all_active',
            message_title: ann.title,
            message_body: ann.message,
            status: 'draft'
          })
        });

        if (res && res.success) {
          await apiFetch(`/campaigns/${res.data.id}/launch`, { method: 'POST' });
          showToast('Announcement pushed to active members!');
          loadCampaigns();
          loadHistory();
          loadReports();
        }
      } catch (e) {
        showToast('Failed to broadcast announcement', 'error');
      }
    },

    openSendReminderModal(memberId, memberName) {
      document.getElementById('modal-reminder-mem-id').value = memberId;
      document.getElementById('modal-reminder-mem-name').value = memberName;
      document.getElementById('modal-reminder-msg').value = `Hi ${memberName}, your Virtex Gym membership renewal is coming up! Renew now to retain your founding rate.`;
      openModal('modal-send-reminder');
    },

    openWinBackModal(memberId, memberName) {
      document.getElementById('modal-winback-mem-id').value = memberId;
      document.getElementById('modal-winback-mem-name').value = memberName;
      document.getElementById('modal-winback-msg').value = `Hey ${memberName}, your gym buddies miss you! Stop in this week for a free body scan and routine tune-up.`;
      document.getElementById('modal-winback-offer').value = 'COMEBACK20';
      openModal('modal-send-winback');
    },

    openRespondFeedbackModal(fbId) {
      const fb = state.feedbacks.find(f => f.id === fbId);
      if (!fb) return;
      document.getElementById('modal-resp-fb-id').value = fb.id;
      document.getElementById('modal-resp-fb-author').value = `${fb.member_name} (Score: ${fb.nps_score}/10)`;
      document.getElementById('modal-resp-fb-text').value = '';
      openModal('modal-respond-feedback');
    },

    openResolveComplaintModal(cmpId, ticketNumber) {
      document.getElementById('modal-res-cmp-id').value = cmpId;
      document.getElementById('modal-res-cmp-ticket').value = ticketNumber;
      document.getElementById('modal-res-cmp-notes').value = '';
      openModal('modal-resolve-complaint');
    },

    exportReportSummary() {
      window.print();
    }
  };
  window.PulseCoreRet = window.VirtexRet;

})();

