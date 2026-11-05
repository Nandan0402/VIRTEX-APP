/**
 * adminApp.js - Main Application Controller for Trainer & Admin Dashboard
 */

import { adminState } from './adminState.js';
import { adminApi } from './adminApi.js';

/**
 * Sanitize untrusted text before insertion into the DOM to eliminate XSS vectors
 */
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
  }

  init() {
    console.log('[AdminApp] Bootstrapping Trainer/Admin Console...');

    // 1. Setup Navigation & Modals
    this.setupTabNavigation();
    this.setupMobileSidebar();
    this.setupModals();

    // 2. Setup Form Listeners
    this.setupProfileForm();
    this.setupSettingsForm();
    this.setupTrainerForm();
    this.setupPlanForm();
    this.setupFaqForm();
    this.setupAnnouncementForm();
    this.setupLogoutModal();

    // 3. Setup Robot Motor Sliders & Controls
    this.setupRobotMotorControls();

    // 4. Initial Render of All Views
    this.renderAll();

    // 5. Subscribe to State Changes
    adminState.subscribe(() => {
      this.renderAll();
    });

    // 6. Polling for Live Hardware & Server Health
    this.pollTelemetry();
    setInterval(() => this.pollTelemetry(), 3000);
  }

  // --- UI Toast Notification ---
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

  // --- Navigation Tabs ---
  setupTabNavigation() {
    const navButtons = document.querySelectorAll('.nav-item-btn');
    const pageTitle = document.getElementById('page-title');

    navButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        navButtons.forEach((b) => {
          b.classList.remove('active');
          b.removeAttribute('aria-current');
        });

        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');

        const targetTabId = btn.dataset.tab;
        this.currentTab = targetTabId;

        // Hide all tabs & activate target
        document.querySelectorAll('.tab-panel').forEach((panel) => {
          panel.classList.remove('active');
        });

        const activePanel = document.getElementById(targetTabId);
        if (activePanel) {
          activePanel.classList.add('active');
        }

        if (pageTitle) {
          pageTitle.textContent = btn.innerText.trim();
        }

        // Close sidebar on mobile upon tab selection
        const sidebar = document.getElementById('admin-sidebar');
        if (sidebar && window.innerWidth <= 768) {
          sidebar.classList.remove('open');
        }
      });
    });
  }

  setupMobileSidebar() {
    const toggleBtn = document.getElementById('btn-sidebar-toggle');
    const sidebar = document.getElementById('admin-sidebar');

    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }
  }

  // --- Modal Helpers ---
  setupModals() {
    // Open modal buttons
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

    // Close modal buttons
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.closeModal;
        this.closeModal(modalId);
      });
    });

    // Close on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
          modal.setAttribute('aria-hidden', 'true');
        }
      });
    });

    // Close on ESC
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.active').forEach((modal) => {
          modal.classList.remove('active');
          modal.setAttribute('aria-hidden', 'true');
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

  // --- Robot Controls & Sliders ---
  setupRobotMotorControls() {
    // 1. Gesture Buttons
    document.querySelectorAll('.btn-gesture').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const gesture = btn.dataset.gesture;
        this.showToast(`Transmitting gesture [${gesture}] to ESP32...`);
        const res = await adminApi.triggerGesture(gesture);
        if (res.success) {
          this.showToast(`Gesture [${gesture}] successfully queued on robot base.`);
        }
      });
    });

    // 2. Direct Sliders
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
        this.showToast('Direct servo angles transmitted to ESP32!');
      }
    });
  }

  // --- Form Handlers ---
  setupTrainerForm() {
    const form = document.getElementById('form-add-trainer');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const trainerData = {
          name: document.getElementById('trn-name').value.trim(),
          specialty: document.getElementById('trn-specialty').value.trim(),
          phone: document.getElementById('trn-phone').value.trim(),
          shift: document.getElementById('trn-shift').value.trim(),
          status: 'on_floor',
        };
        adminState.addTrainer(trainerData);
        this.closeModal('modal-trainer');
        form.reset();
        this.showToast(`Trainer ${trainerData.name} added to floor roster!`);
      } catch (err) {
        this.showToast(err.message, true);
      }
    });
  }

  setupPlanForm() {
    const form = document.getElementById('form-add-plan');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const rawPerks = document.getElementById('plan-perks').value.trim();
        const planData = {
          name: document.getElementById('plan-name').value.trim(),
          price: Number(document.getElementById('plan-price').value),
          duration: document.getElementById('plan-duration').value.trim(),
          badge: 'New',
          perks: rawPerks ? rawPerks.split(',').map((p) => p.trim()) : ['Full Gym Access'],
        };
        adminState.addPlan(planData);
        this.closeModal('modal-plan');
        form.reset();
        this.showToast(`Plan "${planData.name}" published!`);
      } catch (err) {
        this.showToast(err.message, true);
      }
    });
  }

  setupFaqForm() {
    const form = document.getElementById('form-add-faq');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const faqData = {
          language: document.getElementById('faq-lang').value,
          gesture: document.getElementById('faq-gesture').value,
          question: document.getElementById('faq-q').value.trim(),
          answer: document.getElementById('faq-a').value.trim(),
          category: 'general',
        };
        adminState.addFaq(faqData);
        this.closeModal('modal-faq');
        form.reset();
        this.showToast('New FAQ saved to receptionist knowledge base!');
      } catch (err) {
        this.showToast(err.message, true);
      }
    });
  }

  setupAnnouncementForm() {
    const form = document.getElementById('form-add-ann');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const annData = {
          title: document.getElementById('ann-title').value.trim(),
          priority: document.getElementById('ann-priority').value,
          message: document.getElementById('ann-msg').value.trim(),
        };
        adminState.addAnnouncement(annData);
        this.closeModal('modal-ann');
        form.reset();
        this.showToast(`Notice "${annData.title}" broadcasted!`);
      } catch (err) {
        this.showToast(err.message, true);
      }
    });
  }

  setupProfileForm() {
    const form = document.getElementById('form-gym-profile');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const profileData = {
          name: document.getElementById('prof-name').value.trim(),
          tagline: document.getElementById('prof-tagline').value.trim(),
          phone: document.getElementById('prof-phone').value.trim(),
          email: document.getElementById('prof-email').value.trim(),
          address: document.getElementById('prof-address').value.trim(),
          hours: [
            {
              days: 'Monday – Friday',
              open: document.getElementById('prof-weekday-open').value,
              close: document.getElementById('prof-weekday-close').value,
              status: 'Open',
            },
            {
              days: 'Saturday',
              open: document.getElementById('prof-sat-open').value,
              close: document.getElementById('prof-sat-close').value,
              status: 'Open',
            },
            {
              days: 'Sunday',
              open: document.getElementById('prof-sun-open').value,
              close: document.getElementById('prof-sun-close').value,
              status: 'Half Day',
            },
          ],
        };
        adminState.updateGymProfile(profileData);
        adminApi.syncProfileToServer(profileData);
        this.showToast('Gym Profile & Operating Hours updated!');
      } catch (err) {
        this.showToast(err.message, true);
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

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const settingsData = {
        defaultLanguage: document.getElementById('setting-default-lang').value,
        speechRate: parseFloat(rateSlider.value),
        speechPitch: parseFloat(pitchSlider.value),
      };
      adminState.updateSettings(settingsData);
      this.showToast('Voice & Receptionist settings saved!');
    });
  }

  setupLogoutModal() {
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      this.openModal('modal-logout');
    });

    document.getElementById('btn-confirm-reset-session')?.addEventListener('click', () => {
      localStorage.removeItem('pulsecore_admin_state_v1');
      window.location.reload();
    });
  }

  // --- Rendering Methods ---
  renderAll() {
    this.renderStats();
    this.renderTrainersTable();
    this.renderPlansTable();
    this.renderFaqsTable();
    this.renderAnnouncementsTable();
    this.populateProfileForm();
    this.populateSettingsForm();
    this.renderInteractionHistory();
  }

  renderStats() {
    const stats = adminState.state.stats;
    const langBarsContainer = document.getElementById('lang-stats-bars');

    const totalQueries =
      (stats.languagesCount['en-IN'] || 0) +
      (stats.languagesCount['kn-IN'] || 0) +
      (stats.languagesCount['hi-IN'] || 0) || 1;

    if (langBarsContainer) {
      langBarsContainer.innerHTML = `
        <div class="lang-bar-card">
          <div class="lang-bar-header">
            <span>🇬🇧 English (en-IN)</span>
            <span class="font-mono text-green">${stats.languagesCount['en-IN']} (${Math.round((stats.languagesCount['en-IN'] / totalQueries) * 100)}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${(stats.languagesCount['en-IN'] / totalQueries) * 100}%"></div>
          </div>
        </div>

        <div class="lang-bar-card">
          <div class="lang-bar-header">
            <span>🇮🇳 Kannada (kn-IN)</span>
            <span class="font-mono text-green">${stats.languagesCount['kn-IN']} (${Math.round((stats.languagesCount['kn-IN'] / totalQueries) * 100)}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${(stats.languagesCount['kn-IN'] / totalQueries) * 100}%"></div>
          </div>
        </div>

        <div class="lang-bar-card">
          <div class="lang-bar-header">
            <span>🇮🇳 Hindi (hi-IN)</span>
            <span class="font-mono text-green">${stats.languagesCount['hi-IN']} (${Math.round((stats.languagesCount['hi-IN'] / totalQueries) * 100)}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${(stats.languagesCount['hi-IN'] / totalQueries) * 100}%"></div>
          </div>
        </div>
      `;
    }
  }

  renderTrainersTable() {
    const tbody = document.getElementById('trainers-table-body');
    if (!tbody) return;

    tbody.innerHTML = adminState.state.trainers
      .map(
        (t) => `
      <tr>
        <td class="font-mono text-green">${escapeHtml(t.code)}</td>
        <td><strong>${escapeHtml(t.name)}</strong></td>
        <td>${escapeHtml(t.specialty)}</td>
        <td class="font-mono text-xs">${escapeHtml(t.shift)}</td>
        <td class="font-mono text-xs">${escapeHtml(t.phone)}</td>
        <td>
          <select class="status-select" data-trainer-id="${escapeHtml(t.id)}">
            <option value="on_floor" ${t.status === 'on_floor' ? 'selected' : ''}>🟢 On Floor</option>
            <option value="in_session" ${t.status === 'in_session' ? 'selected' : ''}>🟡 In Session</option>
            <option value="off_duty" ${t.status === 'off_duty' ? 'selected' : ''}>⚪ Off Duty</option>
          </select>
        </td>
        <td>
          <button class="btn-table-action btn-del-trainer" data-id="${escapeHtml(t.id)}" title="Remove Trainer">🗑️</button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.status-select').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const trnId = sel.dataset.trainerId;
        adminState.updateTrainerStatus(trnId, e.target.value);
        this.showToast('Trainer floor status updated.');
      });
    });

    tbody.querySelectorAll('.btn-del-trainer').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (confirm('Are you sure you want to remove this trainer?')) {
          adminState.deleteTrainer(btn.dataset.id);
          this.showToast('Trainer removed from roster.');
        }
      });
    });
  }

  renderPlansTable() {
    const tbody = document.getElementById('plans-table-body');
    if (!tbody) return;

    tbody.innerHTML = adminState.state.plans
      .map(
        (p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(p.duration)}</td>
        <td class="font-mono font-semibold text-green">₹${p.price.toLocaleString()}</td>
        <td><span class="badge badge-dim">${escapeHtml(p.badge || 'Standard')}</span></td>
        <td class="text-xs text-dim">${p.perks.map(escapeHtml).join(' • ')}</td>
        <td>
          <span class="badge ${p.active ? 'badge-green' : 'badge-dim'}">${p.active ? 'Active' : 'Archived'}</span>
        </td>
        <td>
          <button class="btn-table-action btn-toggle-plan" data-id="${escapeHtml(p.id)}" title="Toggle Plan Status">
            ${p.active ? '⏸️' : '▶️'}
          </button>
          <button class="btn-table-action btn-del-plan" data-id="${escapeHtml(p.id)}" title="Delete Plan">🗑️</button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.btn-toggle-plan').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.togglePlanStatus(btn.dataset.id);
        this.showToast('Plan status toggled.');
      });
    });

    tbody.querySelectorAll('.btn-del-plan').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this membership plan?')) {
          adminState.deletePlan(btn.dataset.id);
          this.showToast('Plan deleted.');
        }
      });
    });
  }

  renderFaqsTable() {
    const tbody = document.getElementById('faqs-table-body');
    if (!tbody) return;

    tbody.innerHTML = adminState.state.faqs
      .map(
        (f) => `
      <tr>
        <td><span class="badge badge-dim font-mono">${escapeHtml(f.language)}</span></td>
        <td><span class="badge badge-dim">${escapeHtml(f.category)}</span></td>
        <td><strong>${escapeHtml(f.question)}</strong></td>
        <td class="text-xs">${escapeHtml(f.answer)}</td>
        <td><span class="badge badge-green font-mono">${escapeHtml(f.gesture)}</span></td>
        <td>
          <button class="btn-table-action btn-del-faq" data-id="${escapeHtml(f.id)}" title="Delete FAQ">🗑️</button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.btn-del-faq').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.deleteFaq(btn.dataset.id);
        this.showToast('FAQ deleted.');
      });
    });
  }

  renderAnnouncementsTable() {
    const tbody = document.getElementById('announcements-table-body');
    if (!tbody) return;

    tbody.innerHTML = adminState.state.announcements
      .map(
        (a) => `
      <tr>
        <td class="font-mono text-xs">${escapeHtml(a.date)}</td>
        <td><strong>${escapeHtml(a.title)}</strong></td>
        <td class="text-xs">${escapeHtml(a.message)}</td>
        <td>
          <span class="badge ${a.priority === 'urgent' ? 'badge-danger' : a.priority === 'event' ? 'badge-green' : 'badge-warning'}">
            ${escapeHtml(a.priority.toUpperCase())}
          </span>
        </td>
        <td>
          <button class="btn-table-action btn-del-ann" data-id="${escapeHtml(a.id)}" title="Delete Announcement">🗑️</button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('.btn-del-ann').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.deleteAnnouncement(btn.dataset.id);
        this.showToast('Notice removed.');
      });
    });
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

    const weekdayHours = prof.hours?.find((h) => h.days.includes('Monday'));
    if (weekdayHours) {
      document.getElementById('prof-weekday-open').value = weekdayHours.open || '06:00';
      document.getElementById('prof-weekday-close').value = weekdayHours.close || '22:00';
    }
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

  async renderInteractionHistory() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    try {
      const res = await adminApi.getRecentCheckIns();
      const recentCheckins = res.data || [];

      // Combine checkins and mock receptionist questions for the interaction audit log
      const logs = [
        {
          time: new Date(Date.now() - 3 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          inquiry: 'Member Check-In: GYM001 (Rahul Sharma)',
          response: 'Welcome back Rahul! Access Granted.',
          lang: 'kn-IN',
          gesture: 'GREET_WAVE',
        },
        {
          time: new Date(Date.now() - 12 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          inquiry: 'What are your gym operating hours?',
          response: 'Open Mon-Sat 6 AM to 10 PM, Sun 7 AM to 1 PM.',
          lang: 'en-IN',
          gesture: 'NOD_YES',
        },
        {
          time: new Date(Date.now() - 28 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          inquiry: 'Member Check-In: GYM002 (Priya Patel)',
          response: 'नमस्ते प्रिया! आपका वर्कआउट शानदार रहे!',
          lang: 'hi-IN',
          gesture: 'GREET_WAVE',
        },
      ];

      tbody.innerHTML = logs
        .map(
          (l) => `
        <tr>
          <td class="font-mono text-xs text-dim">${escapeHtml(l.time)}</td>
          <td><strong>${escapeHtml(l.inquiry)}</strong></td>
          <td class="text-xs">${escapeHtml(l.response)}</td>
          <td><span class="badge badge-dim font-mono">${escapeHtml(l.lang)}</span></td>
          <td><span class="badge badge-green font-mono">${escapeHtml(l.gesture)}</span></td>
        </tr>
      `
        )
        .join('');
    } catch {
      // Fallback
    }
  }

  async pollTelemetry() {
    try {
      const res = await adminApi.getRobotStatus();
      const dot = document.getElementById('admin-robot-dot');
      const text = document.getElementById('admin-robot-text');

      if (res.data?.online) {
        if (dot) dot.className = 'status-dot online';
        if (text) text.textContent = `ESP32 Online (${res.data.ipAddress})`;
      } else {
        if (dot) dot.className = 'status-dot offline';
        if (text) text.textContent = 'ESP32 Base Offline';
      }
    } catch {
      const dot = document.getElementById('admin-robot-dot');
      const text = document.getElementById('admin-robot-text');
      if (dot) dot.className = 'status-dot offline';
      if (text) text.textContent = 'ESP32 Base Offline';
    }
  }
}

// Bootstrap once DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new AdminDashboardApp();
  app.init();
});

