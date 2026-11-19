/**
 * topbarRoutineNav.js - Topbar Routine Punch Station & Quick Nav Links
 * Mounts the top-right controls:
 * 1. Notification Icon (links to admin-notification.html with counter badge)
 * 2. Message Icon (links to admin-messages.html with unread counter badge)
 * 3. Quick Punch Buttons: Punch In (🟢), Break (☕), Punch Out (⏹️) with live status pill
 * 4. Centered confirmation & break reason modals
 */

import { adminApi } from '../admin/adminApi.js';
import './adminSidebarNav.js';

class TopbarRoutineNav {
  constructor() {
    this.statusData = null;
    this.timerInterval = null;
    this.pollInterval = null;
    this.elapsedSeconds = 0;
  }

  async init() {
    this.injectModalsIfNeeded();
    this.mountTopbarHtml();
    this.bindEvents();
    this.bindLifecycle();
    await this.syncStatus();
    await this.syncBadges();
    this.startPolling();
  }

  startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => {
      this.syncStatus();
      this.syncBadges();
    }, 25000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  bindLifecycle() {
    window.addEventListener('pagehide', () => {
      this.stopPolling();
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    });

    window.addEventListener('pageshow', () => {
      this.syncStatus();
      this.syncBadges();
      this.startPolling();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.stopPolling();
      } else if (document.visibilityState === 'visible') {
        this.syncStatus();
        this.syncBadges();
        this.startPolling();
      }
    });
  }

  mountTopbarHtml() {
    const topbar = document.querySelector('.admin-topbar');
    if (!topbar) return;

    let rightContainer = topbar.querySelector('.topbar-right');
    if (!rightContainer) {
      rightContainer = document.createElement('div');
      rightContainer.className = 'topbar-right';
      topbar.appendChild(rightContainer);
    }

    // Check if topbar-routine-group already mounted
    if (rightContainer.querySelector('#topbar-routine-group')) {
      return;
    }

    // Preserve any existing action buttons in topbar-right (e.g. database status or page-specific action buttons)
    const existingChildren = Array.from(rightContainer.children);

    const navMarkup = document.createElement('div');
    navMarkup.style.display = 'contents';
    navMarkup.innerHTML = `
      <!-- Routine Tracker Quick Punch Group -->
      <div class="topbar-routine-group" id="topbar-routine-group">
        <a href="admin-routine-tracker.html" class="topbar-routine-badge status-out" id="topbar-routine-badge" title="Click to open full Routine Tracker">
          <span class="topbar-status-dot"></span>
          <span id="topbar-routine-text">PUNCHED OUT</span>
        </a>

        <div class="topbar-punch-btns">
          <button type="button" class="topbar-icon-btn btn-topbar-punch-in" id="topbar-btn-punch-in" title="Punch In (Start Daily Shift)">
            <span>🟢</span>
            <span class="topbar-btn-text">Punch In</span>
          </button>

          <button type="button" class="topbar-icon-btn btn-topbar-break" id="topbar-btn-break" title="Take or Resume Routine Break" disabled>
            <span id="topbar-break-icon">☕</span>
            <span class="topbar-btn-text" id="topbar-break-text">Break</span>
          </button>

          <button type="button" class="topbar-icon-btn btn-topbar-punch-out" id="topbar-btn-punch-out" title="Punch Out (End Daily Shift)" disabled>
            <span>⏹️</span>
            <span class="topbar-btn-text">Punch Out</span>
          </button>
        </div>
      </div>

      <div class="topbar-divider-vert"></div>

      <!-- Message Link Icon -->
      <a href="admin-messages.html" class="topbar-nav-icon-link" id="topbar-message-link" title="Member Messages">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="topbar-counter-badge" id="topbar-message-badge" style="display: none;">0</span>
      </a>

      <!-- Notification Link Icon -->
      <a href="admin-notification.html" class="topbar-nav-icon-link" id="topbar-notification-link" title="Notifications & System Announcements">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <span class="topbar-counter-badge topbar-counter-red" id="topbar-notification-badge" style="display: none;">0</span>
      </a>
    `;

    // Append to rightContainer
    while (navMarkup.firstChild) {
      rightContainer.appendChild(navMarkup.firstChild);
    }
  }

  injectModalsIfNeeded() {
    // 1. Centered Confirmation Modal
    if (!document.getElementById('custom-confirm-modal')) {
      const confirmModal = document.createElement('div');
      confirmModal.className = 'center-modal-overlay';
      confirmModal.id = 'custom-confirm-modal';
      confirmModal.setAttribute('role', 'dialog');
      confirmModal.setAttribute('aria-modal', 'true');
      confirmModal.innerHTML = `
        <div class="center-modal-card">
          <div class="center-modal-icon-badge icon-badge-danger" id="confirm-modal-icon">⏹️</div>
          <h3 class="center-modal-title" id="confirm-modal-title">Confirm Punch Out</h3>
          <p class="center-modal-desc" id="confirm-modal-desc">
            Are you sure you want to Punch Out and finish your routine shift for today?
          </p>
          <div class="center-modal-actions">
            <button type="button" class="btn-center-cancel" id="btn-confirm-cancel">Cancel</button>
            <button type="button" class="btn-center-confirm btn-confirm-danger" id="btn-confirm-ok">Yes, Punch Out</button>
          </div>
        </div>
      `;
      document.body.appendChild(confirmModal);
    }

    // 2. Centered Break Reason Modal
    if (!document.getElementById('custom-break-modal')) {
      const breakModal = document.createElement('div');
      breakModal.className = 'center-modal-overlay';
      breakModal.id = 'custom-break-modal';
      breakModal.setAttribute('role', 'dialog');
      breakModal.setAttribute('aria-modal', 'true');
      breakModal.innerHTML = `
        <div class="center-modal-card">
          <div class="center-modal-icon-badge icon-badge-amber">☕</div>
          <h3 class="center-modal-title">Take Routine Break</h3>
          <p class="center-modal-desc" style="margin-bottom: 0.85rem;">
            Pause your active shift tracking. Enter an optional reason for this break:
          </p>
          <input type="text" id="break-reason-input" class="form-control-dark" style="width: 100%; margin-bottom: 1.25rem; text-align: left;" value="Routine Lunch / Coffee Break" placeholder="e.g. Lunch break, Equipment setup" />
          <div class="center-modal-actions">
            <button type="button" class="btn-center-cancel" id="btn-break-cancel">Cancel</button>
            <button type="button" class="btn-center-confirm btn-confirm-amber" id="btn-break-ok">Start Break</button>
          </div>
        </div>
      `;
      document.body.appendChild(breakModal);
    }
  }

  askConfirmation({ title = 'Confirmation', message = 'Are you sure?', confirmText = 'Confirm', confirmStyle = 'danger', icon = '⏹️' } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('custom-confirm-modal');
      if (!modal) return resolve(window.confirm(message));

      const titleEl = document.getElementById('confirm-modal-title');
      const descEl = document.getElementById('confirm-modal-desc');
      const iconEl = document.getElementById('confirm-modal-icon');
      const okBtn = document.getElementById('btn-confirm-ok');
      const cancelBtn = document.getElementById('btn-confirm-cancel');

      titleEl.textContent = title;
      descEl.textContent = message;
      iconEl.textContent = icon;
      okBtn.textContent = confirmText;

      iconEl.className = `center-modal-icon-badge icon-badge-${confirmStyle}`;
      okBtn.className = `btn-center-confirm btn-confirm-${confirmStyle}`;

      modal.style.display = 'flex';

      function cleanup(result) {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKeyDown);
        resolve(result);
      }

      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onBackdrop(e) {
        if (e.target === modal) cleanup(false);
      }
      function onKeyDown(e) {
        if (e.key === 'Escape') cleanup(false);
        else if (e.key === 'Enter') cleanup(true);
      }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKeyDown);
    });
  }

  askBreakReason() {
    return new Promise((resolve) => {
      const modal = document.getElementById('custom-break-modal');
      const input = document.getElementById('break-reason-input');
      const okBtn = document.getElementById('btn-break-ok');
      const cancelBtn = document.getElementById('btn-break-cancel');

      if (!modal || !input) {
        const val = window.prompt('Reason for routine break (optional):', 'Routine Lunch / Coffee Break');
        return resolve(val);
      }

      modal.style.display = 'flex';
      input.focus();
      input.select();

      function cleanup(reason) {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        input.removeEventListener('keydown', onInputKey);
        document.removeEventListener('keydown', onDocKey);
        resolve(reason);
      }

      function onOk() { cleanup(input.value.trim() || 'Routine Break'); }
      function onCancel() { cleanup(null); }
      function onBackdrop(e) { if (e.target === modal) cleanup(null); }
      function onInputKey(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOk();
        }
      }
      function onDocKey(e) {
        if (e.key === 'Escape') cleanup(null);
      }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      input.addEventListener('keydown', onInputKey);
      document.addEventListener('keydown', onDocKey);
    });
  }

  showToast(message, isError = false) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px;';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = `
      background: ${isError ? '#ef4444' : '#13161f'};
      color: #fff;
      border: 1px solid ${isError ? '#b91c1c' : '#00e676'};
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 0.85rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      gap: 8px;
      transition: opacity 0.3s ease;
    `;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  formatTime(totalSec) {
    const sec = Math.max(0, Math.floor(totalSec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  bindEvents() {
    const inBtn = document.getElementById('topbar-btn-punch-in');
    const breakBtn = document.getElementById('topbar-btn-break');
    const outBtn = document.getElementById('topbar-btn-punch-out');

    if (inBtn) {
      inBtn.addEventListener('click', async () => {
        try {
          const res = await adminApi.routinePunchIn('Shift punch from top navigation');
          if (res && res.success) {
            this.showToast(res.message || '🟢 Successfully punched in!');
            await this.syncStatus();
            window.dispatchEvent(new CustomEvent('routine:status-changed', { detail: res }));
          } else {
            this.showToast(res?.error || 'Failed to punch in.', true);
          }
        } catch (err) {
          this.showToast('Error punching in.', true);
        }
      });
    }

    if (breakBtn) {
      breakBtn.addEventListener('click', async () => {
        const current = this.statusData?.status;
        try {
          let res;
          if (current === 'punched_in') {
            const reason = await this.askBreakReason();
            if (reason === null) return;
            res = await adminApi.routineStartBreak(reason || 'Routine Break');
          } else if (current === 'on_break') {
            const proceed = await this.askConfirmation({
              title: 'Resume Routine Shift',
              message: 'Ready to finish your break and resume your active shift tracking?',
              confirmText: 'Resume Shift',
              confirmStyle: 'green',
              icon: '▶️',
            });
            if (!proceed) return;
            res = await adminApi.routineEndBreak();
          }

          if (res && res.success) {
            this.showToast(res.message);
            await this.syncStatus();
            window.dispatchEvent(new CustomEvent('routine:status-changed', { detail: res }));
          } else if (res) {
            this.showToast(res.error || 'Failed to update break status.', true);
          }
        } catch (err) {
          this.showToast('Error updating break.', true);
        }
      });
    }

    if (outBtn) {
      outBtn.addEventListener('click', async () => {
        const confirmed = await this.askConfirmation({
          title: 'Confirm Punch Out',
          message: 'Are you sure you want to Punch Out and finish your routine shift for today?',
          confirmText: 'Yes, Punch Out',
          confirmStyle: 'danger',
          icon: '⏹️',
        });
        if (!confirmed) return;

        try {
          const res = await adminApi.routinePunchOut('Shift completed from top navigation');
          if (res && res.success) {
            this.showToast(res.message || '⏹️ Successfully punched out.');
            await this.syncStatus();
            window.dispatchEvent(new CustomEvent('routine:status-changed', { detail: res }));
          } else {
            this.showToast(res?.error || 'Failed to punch out.', true);
          }
        } catch (err) {
          this.showToast('Error punching out.', true);
        }
      });
    }

    // Listen for cross-page or child component routine updates
    window.addEventListener('routine:status-changed', () => {
      this.syncStatus();
    });

    // Mobile sidebar toggle & click-outside closer
    const sidebar = document.getElementById('admin-sidebar');
    const toggleBtn = document.getElementById('btn-sidebar-toggle');
    if (toggleBtn && sidebar && !toggleBtn.dataset.routineBound) {
      toggleBtn.dataset.routineBound = 'true';
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('open');
      });

      document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
          if (!sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
            sidebar.classList.remove('open');
          }
        }
      });
    }
  }

  async syncStatus() {
    try {
      const res = await adminApi.getRoutineStatus();
      if (res && res.success) {
        this.statusData = res.data || {};
        this.renderState();
      }
    } catch (err) {
      console.warn('[TopbarRoutine] Sync error:', err.message);
    }
  }

  renderState() {
    const badge = document.getElementById('topbar-routine-badge');
    const textEl = document.getElementById('topbar-routine-text');
    const inBtn = document.getElementById('topbar-btn-punch-in');
    const breakBtn = document.getElementById('topbar-btn-break');
    const breakIcon = document.getElementById('topbar-break-icon');
    const breakText = document.getElementById('topbar-break-text');
    const outBtn = document.getElementById('topbar-btn-punch-out');

    if (!badge || !textEl) return;

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    const s = this.statusData?.status;

    if (s === 'punched_in') {
      badge.className = 'topbar-routine-badge status-in';
      this.elapsedSeconds = Number(this.statusData.elapsed_work_seconds || 0);
      textEl.textContent = `IN ${this.formatTime(this.elapsedSeconds)}`;

      if (inBtn) inBtn.disabled = true;
      if (breakBtn) {
        breakBtn.disabled = false;
        if (breakIcon) breakIcon.textContent = '☕';
        if (breakText) breakText.textContent = 'Break';
      }
      if (outBtn) outBtn.disabled = false;

      // Live tick
      this.timerInterval = setInterval(() => {
        this.elapsedSeconds += 1;
        textEl.textContent = `IN ${this.formatTime(this.elapsedSeconds)}`;
      }, 1000);

    } else if (s === 'on_break') {
      badge.className = 'topbar-routine-badge status-break';
      this.elapsedSeconds = Number(this.statusData.current_break_seconds || 0);
      textEl.textContent = `BREAK ${this.formatTime(this.elapsedSeconds)}`;

      if (inBtn) inBtn.disabled = true;
      if (breakBtn) {
        breakBtn.disabled = false;
        if (breakIcon) breakIcon.textContent = '▶️';
        if (breakText) breakText.textContent = 'Resume';
      }
      if (outBtn) outBtn.disabled = false;

      // Live tick
      this.timerInterval = setInterval(() => {
        this.elapsedSeconds += 1;
        textEl.textContent = `BREAK ${this.formatTime(this.elapsedSeconds)}`;
      }, 1000);

    } else {
      badge.className = 'topbar-routine-badge status-out';
      textEl.textContent = 'PUNCHED OUT';

      if (inBtn) inBtn.disabled = false;
      if (breakBtn) {
        breakBtn.disabled = true;
        if (breakIcon) breakIcon.textContent = '☕';
        if (breakText) breakText.textContent = 'Break';
      }
      if (outBtn) outBtn.disabled = true;
    }
  }

  async syncBadges() {
    try {
      // 1. Notifications badge: active announcements
      const notifBadge = document.getElementById('topbar-notification-badge');
      if (notifBadge) {
        const annRes = await adminApi.getAnnouncements(true).catch(() => null);
        const list = annRes?.data || annRes?.announcements || [];
        const count = list.length || 0;
        if (count > 0) {
          notifBadge.textContent = count > 99 ? '99+' : String(count);
          notifBadge.style.display = 'inline-block';
        } else {
          notifBadge.style.display = 'none';
        }
      }

      // 2. Messages badge: unread member + trainer messages (direct + groups) in the gym team inbox
      const msgBadge = document.getElementById('topbar-message-badge');
      if (msgBadge) {
        const get = (u) => fetch(`/api/v1/admin/${u}`, { headers: adminApi.getHeaders(true) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const [dm, grp, tm] = await Promise.all([get('member-messages'), get('member-groups'), get('trainer-messages')]);
        const newCount = (dm?.data?.unreadTotal || 0) + (tm?.data?.unreadTotal || 0) + (grp?.data?.groups || []).reduce((n, g) => n + (g.unread || 0), 0);
        if (newCount > 0) {
          msgBadge.textContent = newCount > 99 ? '99+' : String(newCount);
          msgBadge.style.display = 'inline-block';
        } else {
          msgBadge.style.display = 'none';
        }
      }
    } catch (err) {
      // Silent catch
    }
  }
}

export const topbarRoutineNav = new TopbarRoutineNav();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => topbarRoutineNav.init());
} else {
  topbarRoutineNav.init();
}

