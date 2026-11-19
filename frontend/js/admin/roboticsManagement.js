/**
 * Virtex Admin - FitBot Robotics & AI Management Controller
 * 
 * Handles 11 Core Robotics Features:
 * 1. Robot Device Registration & Fleet Overview
 * 2. Device Health Monitoring & Diagnostics
 * 3. Battery Monitoring & Voltage Management
 * 4. Wi-Fi Monitoring & RSSI Signal Strengths
 * 5. Sensor Monitoring & Telemetry (Ultrasonic, PIR, Thermal, RFID, Lux)
 * 6. Robot Activity History (Gestures, Voice TTS & Routine Actions)
 * 7. Hardware Event Logs with Level Filters
 * 8. Device Connection & Fault Alerts
 * 9. Robotics Fleet Analytics
 * 10. Device Maintenance History & Service Schedules
 * 11. Safety Monitoring & Collision Safeguards
 */

(function () {
  'use strict';

  // API Endpoints
  const API_BASE = '/api/robotics-management';
  const API_ADMIN_BASE = '/api/admin/robotics-management';

  // Local State
  let state = {
    currentTab: 'fleet',
    devices: [],
    selectedDeviceId: null,
    healthMetrics: null,
    sensorTelemetry: [],
    activityHistory: [],
    eventLogs: [],
    alerts: [],
    maintenanceLogs: [],
    safetyIncidents: [],
    analytics: null,
    filters: {
      fleetStatus: 'all',
      fleetSearch: '',
      sensorType: 'all',
      logLevel: 'all',
      alertSeverity: 'all',
      alertResolved: 'false',
      safetySeverity: 'all'
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
      console.warn(`Robotics API fetch failed for ${endpoint}:`, err.message);
      throw err;
    }
  }

  // Toast Notification
  function showToast(msg, type = 'info') {
    let toast = document.getElementById('robot-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'robot-toast';
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
      error: 'linear-gradient(135deg, #ff1744, #b71c1c)',
      warning: 'linear-gradient(135deg, #ff9100, #ff6d00)',
      info: 'linear-gradient(135deg, #2979ff, #00e5ff)'
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
  // INITIALIZATION & TAB SWITCHING
  // ==========================================
  async function init() {
    setupTabNavigation();
    setupModals();
    setupFilters();
    setupVoiceLabListeners();
    await loadInitialData();
  }

  function checkUrlHashTab() {
    const hash = window.location.hash.toLowerCase().replace('#', '');
    if (!hash) return;
    const tabMap = {
      'voice': 'voice',
      'fleet': 'fleet',
      'health': 'health',
      'sensors': 'sensors',
      'activity': 'activity',
      'logs': 'logs',
      'alerts': 'alerts',
      'maintenance': 'maintenance',
      'safety': 'safety',
      'analytics': 'analytics'
    };
    const target = tabMap[hash];
    if (target) {
      const btn = document.querySelector(`.robot-tab-btn[data-tab="${target}"]`);
      if (btn) btn.click();
    }
  }

  function setupTabNavigation() {
    const tabBtns = document.querySelectorAll('.robot-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        if (!targetTab) return;

        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.robot-tab-content').forEach(c => {
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

    window.addEventListener('hashchange', checkUrlHashTab);
    checkUrlHashTab();
  }

  function setupVoiceLabListeners() {
    const langSelect = document.getElementById('voice-lang-select');
    const presetSelect = document.getElementById('voice-persona-preset');
    const pitchSlider = document.getElementById('voice-pitch-slider');
    const rateSlider = document.getElementById('voice-rate-slider');
    const pitchLabel = document.getElementById('label-voice-pitch');
    const rateLabel = document.getElementById('label-voice-rate');
    const speechInput = document.getElementById('voice-speech-input');
    const speakBtn = document.getElementById('btn-speak-voice');
    const stopBtn = document.getElementById('btn-stop-voice');

    pitchSlider?.addEventListener('input', (e) => {
      if (pitchLabel) pitchLabel.textContent = e.target.value;
    });

    rateSlider?.addEventListener('input', (e) => {
      if (rateLabel) rateLabel.textContent = e.target.value;
    });

    const presets = {
      welcome: {
        'en-IN': "Welcome to Virtex Fitness Club! Please scan your RFID tag or look into the kiosk camera to check in.",
        'kn-IN': "ಪಲ್ಸ್‌ಕೋರ್ ಫಿಟ್ನೆಸ್ ಕ್ಲಬ್‌ಗೆ ಸುಸ್ವಾಗತ! ದಯವಿಟ್ಟು ನಿಮ್ಮ RFID ಕಾರ್ಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.",
        'hi-IN': "पल्सकोर फिटनेस क्लब में आपका स्वागत है! कृपया चेक-इन करने के लिए अपना आरएफआईडी कार्ड स्कैन करें।",
        'en-US': "Welcome to Virtex Fitness Club! Please scan your RFID tag to check in."
      },
      workout: {
        'en-IN': "Let's crush this workout! Great form, keep the core tight!",
        'kn-IN': "ಉತ್ತಮ ಶಕ್ತಿ! ಈ ವ್ಯಾಯಾಮವನ್ನು ಮುಂದುವರಿಸಿ!",
        'hi-IN': "शानदार जोश! अपना वर्कआउट जारी रखें और कोर को मजबूत रखें!",
        'en-US': "Let's crush this workout! Great form, keep your core tight!"
      },
      renewal: {
        'en-IN': "A gentle reminder: your annual membership renewal is coming up in 5 days.",
        'kn-IN': "ನೆನಪಿಕೆ: ನಿಮ್ಮ ಸದಸ್ಯತ್ವ 5 ದಿನಗಳಲ್ಲಿ ಮುಕ್ತಾಯವಾಗಲಿದೆ. ದಯವಿಟ್ಟು ನವೀಕರಿಸಿ.",
        'hi-IN': "याद दिलाना: आपकी सदस्यता 5 दिनों में समाप्त होने वाली है।",
        'en-US': "A gentle reminder: your annual membership renewal is coming up in 5 days."
      },
      tour: {
        'en-IN': "To your left is the cardio zone and to your right is the free weights arena and recovery sauna.",
        'kn-IN': "ಎಡಭಾಗದಲ್ಲಿ ಕಾರ್ಡಿಯೋ ವಲಯವಿದೆ ಮತ್ತು ಬಲಭಾಗದಲ್ಲಿ ವೇಟ್‌ಲಿಫ್ಟಿಂಗ್ ಮತ್ತು ಸೌನಾ ಇವೆ.",
        'hi-IN': "बाईं ओर कार्डियो ज़ोन है और दाईं ओर वेटलिफ्टिंग और सौना रिकवरी है।",
        'en-US': "To your left is the cardio zone and to your right is the free weights arena."
      }
    };

    function updatePresetText() {
      const p = presetSelect ? presetSelect.value : 'welcome';
      const l = langSelect ? langSelect.value : 'en-IN';
      if (presets[p] && presets[p][l] && speechInput) {
        speechInput.value = presets[p][l];
      }
    }

    presetSelect?.addEventListener('change', updatePresetText);
    langSelect?.addEventListener('change', updatePresetText);

    speakBtn?.addEventListener('click', () => {
      const text = speechInput?.value.trim();
      if (!text) return;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = langSelect?.value || 'en-IN';
        utterance.pitch = parseFloat(pitchSlider?.value || 1.0);
        utterance.rate = parseFloat(rateSlider?.value || 1.0);
        window.speechSynthesis.speak(utterance);
      } else {
        showToast('Speech playback is not supported in this browser.', 'error');
      }
    });

    stopBtn?.addEventListener('click', () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    });

    document.getElementById('btn-reset-voice-defaults')?.addEventListener('click', () => {
      if (pitchSlider) { pitchSlider.value = '1.0'; if (pitchLabel) pitchLabel.textContent = '1.0'; }
      if (rateSlider) { rateSlider.value = '1.0'; if (rateLabel) rateLabel.textContent = '1.0'; }
      if (langSelect) langSelect.value = 'en-IN';
      if (presetSelect) presetSelect.value = 'welcome';
      updatePresetText();
    });
  }

  function handleTabChange(tab) {
    switch (tab) {
      case 'fleet':
        renderFleetCards();
        break;
      case 'health':
        loadHealthMetrics();
        break;
      case 'battery':
      case 'wifi':
        renderPowerAndWifi();
        break;
      case 'sensors':
        loadSensorTelemetry();
        break;
      case 'activity':
        loadActivityHistory();
        break;
      case 'logs':
        loadHardwareLogs();
        break;
      case 'alerts':
        loadAlerts();
        break;
      case 'maintenance':
        loadMaintenanceHistory();
        break;
      case 'safety':
        loadSafetyIncidents();
        break;
      case 'analytics':
        loadAnalytics();
        break;
    }
  }

  // ==========================================
  // DATA LOADERS
  // ==========================================
  async function loadInitialData() {
    try {
      await loadDevices();
      await loadAlerts();
      await loadAnalytics();
      updateKpis();
    } catch (err) {
      console.error('Failed to load initial robotics data:', err);
    }
  }

  async function loadDevices() {
    try {
      const queryParams = new URLSearchParams();
      if (state.filters.fleetStatus !== 'all') queryParams.append('status', state.filters.fleetStatus);
      if (state.filters.fleetSearch) queryParams.append('search', state.filters.fleetSearch);

      const res = await apiFetch(`/devices?${queryParams.toString()}`);
      if (res.success) {
        state.devices = res.data || [];
        if (!state.selectedDeviceId && state.devices.length > 0) {
          state.selectedDeviceId = state.devices[0].id;
        }
        populateDeviceSelectors();
        renderFleetCards();
        updateKpis();
      }
    } catch (err) {
      console.error('Error loading devices:', err);
    }
  }

  function populateDeviceSelectors() {
    const selectors = document.querySelectorAll('.device-selector-sync');
    selectors.forEach(sel => {
      const currentVal = sel.value;
      sel.innerHTML = state.devices.map(d => 
        `<option value="${d.id}">${d.device_name} (${d.device_uuid})</option>`
      ).join('');
      if (currentVal && state.devices.some(d => d.id == currentVal)) {
        sel.value = currentVal;
      } else if (state.selectedDeviceId) {
        sel.value = state.selectedDeviceId;
      }
    });
  }

  async function loadHealthMetrics() {
    if (!state.selectedDeviceId) return;
    try {
      const res = await apiFetch(`/devices/${state.selectedDeviceId}/health`);
      if (res.success) {
        state.healthMetrics = res.data;
        renderHealthMetrics();
      }
    } catch (err) {
      console.error('Error loading health metrics:', err);
    }
  }

  async function loadSensorTelemetry() {
    try {
      const queryParams = new URLSearchParams();
      if (state.selectedDeviceId) queryParams.append('device_id', state.selectedDeviceId);
      if (state.filters.sensorType !== 'all') queryParams.append('sensor_type', state.filters.sensorType);
      queryParams.append('limit', '50');

      const res = await apiFetch(`/telemetry?${queryParams.toString()}`);
      if (res.success) {
        state.sensorTelemetry = res.data || [];
        renderSensorTelemetry();
      }
    } catch (err) {
      console.error('Error loading sensor telemetry:', err);
    }
  }

  async function loadActivityHistory() {
    try {
      const queryParams = new URLSearchParams();
      if (state.selectedDeviceId) queryParams.append('device_id', state.selectedDeviceId);
      queryParams.append('limit', '50');

      const res = await apiFetch(`/activity?${queryParams.toString()}`);
      if (res.success) {
        state.activityHistory = res.data || [];
        renderActivityHistory();
      }
    } catch (err) {
      console.error('Error loading activity history:', err);
    }
  }

  async function loadHardwareLogs() {
    try {
      const queryParams = new URLSearchParams();
      if (state.selectedDeviceId) queryParams.append('device_id', state.selectedDeviceId);
      if (state.filters.logLevel !== 'all') queryParams.append('log_level', state.filters.logLevel);
      queryParams.append('limit', '80');

      const res = await apiFetch(`/logs?${queryParams.toString()}`);
      if (res.success) {
        state.eventLogs = res.data || [];
        renderHardwareLogs();
      }
    } catch (err) {
      console.error('Error loading hardware logs:', err);
    }
  }

  async function loadAlerts() {
    try {
      const queryParams = new URLSearchParams();
      if (state.filters.alertSeverity !== 'all') queryParams.append('severity', state.filters.alertSeverity);
      if (state.filters.alertResolved !== 'all') queryParams.append('is_resolved', state.filters.alertResolved);

      const res = await apiFetch(`/alerts?${queryParams.toString()}`);
      if (res.success) {
        state.alerts = res.data || [];
        renderAlerts();
        updateKpis();
      }
    } catch (err) {
      console.error('Error loading alerts:', err);
    }
  }

  async function loadMaintenanceHistory() {
    try {
      const queryParams = new URLSearchParams();
      if (state.selectedDeviceId) queryParams.append('device_id', state.selectedDeviceId);

      const res = await apiFetch(`/maintenance?${queryParams.toString()}`);
      if (res.success) {
        state.maintenanceLogs = res.data || [];
        renderMaintenanceHistory();
      }
    } catch (err) {
      console.error('Error loading maintenance history:', err);
    }
  }

  async function loadSafetyIncidents() {
    try {
      const queryParams = new URLSearchParams();
      if (state.selectedDeviceId) queryParams.append('device_id', state.selectedDeviceId);
      if (state.filters.safetySeverity !== 'all') queryParams.append('severity', state.filters.safetySeverity);
      queryParams.append('limit', '50');

      const res = await apiFetch(`/safety?${queryParams.toString()}`);
      if (res.success) {
        state.safetyIncidents = res.data || [];
        renderSafetyIncidents();
      }
    } catch (err) {
      console.error('Error loading safety incidents:', err);
    }
  }

  async function loadAnalytics() {
    try {
      const res = await apiFetch('/analytics');
      if (res.success) {
        state.analytics = res.data || {};
        renderAnalytics();
      }
    } catch (err) {
      console.error('Error loading robotics analytics:', err);
    }
  }

  // ==========================================
  // KPI CALCULATIONS & RENDERING
  // ==========================================
  function updateKpis() {
    const totalDevicesEl = document.getElementById('kpi-total-devices');
    const onlineDevicesEl = document.getElementById('kpi-online-devices');
    const avgBatteryEl = document.getElementById('kpi-avg-battery');
    const avgWifiEl = document.getElementById('kpi-avg-wifi');
    const activeAlertsEl = document.getElementById('kpi-active-alerts');
    const safetyCountEl = document.getElementById('kpi-safety-events');

    const total = state.devices.length;
    const online = state.devices.filter(d => d.status === 'online').length;
    // Average only real readings; null => no data ("—")
    const avgOf = (vals) => (vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) / vals.length) : null);
    const avgBatt = avgOf(state.devices.filter(d => d.battery_level != null).map(d => Number(d.battery_level)));
    const avgRssi = avgOf(state.devices.filter(d => d.wifi_rssi != null).map(d => Number(d.wifi_rssi)));
    const unresolvedAlerts = state.alerts.filter(a => !a.is_resolved).length;
    const safetyEvents = state.safetyIncidents.length;

    if (totalDevicesEl) totalDevicesEl.textContent = total;
    if (onlineDevicesEl) onlineDevicesEl.textContent = `${online} / ${total}`;
    if (avgBatteryEl) avgBatteryEl.textContent = avgBatt == null ? '—' : `${avgBatt}%`;
    if (avgWifiEl) avgWifiEl.textContent = avgRssi == null ? '—' : `${avgRssi} dBm`;
    if (activeAlertsEl) activeAlertsEl.textContent = unresolvedAlerts;
    if (safetyCountEl) safetyCountEl.textContent = safetyEvents;

    // Update Tab Badges
    const badgeFleet = document.getElementById('tab-badge-fleet');
    const badgeAlerts = document.getElementById('tab-badge-alerts');
    const badgeSafety = document.getElementById('tab-badge-safety');

    if (badgeFleet) badgeFleet.textContent = total;
    if (badgeAlerts) badgeAlerts.textContent = unresolvedAlerts;
    if (badgeSafety) badgeSafety.textContent = safetyEvents;
  }

  // ==========================================
  // RENDER: FLEET CARDS (FEATURE 1)
  // ==========================================
  function renderFleetCards() {
    const container = document.getElementById('fleet-cards-container');
    if (!container) return;

    if (state.devices.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 3rem; text-align: center; color: var(--text-dim); background: var(--robot-card-bg); border-radius: 12px; border: 1px dashed var(--robot-border);">
          <div style="font-size: 2.5rem; margin-bottom: 12px;">🤖</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No Robot Devices Registered</h3>
          <p style="font-size: 0.9rem; margin-bottom: 16px;">Register your first FitBot ESP32 receptionist or floor patrol rover.</p>
          <button class="btn btn-green" id="btn-empty-register">➕ Register New Robot</button>
        </div>
      `;
      const btn = document.getElementById('btn-empty-register');
      if (btn) btn.onclick = () => openModal('modal-register-device');
      return;
    }

    container.innerHTML = state.devices.map(d => {
      const isOnline = d.status === 'online';
      // Only real readings — show "—" and empty meters when the robot hasn't reported
      const batt = d.battery_level != null ? Number(d.battery_level) : null;
      const battColor = batt == null ? 'green' : batt > 50 ? 'green' : batt > 25 ? 'amber' : 'red';
      const rssi = d.wifi_rssi != null ? Number(d.wifi_rssi) : null;
      const rssiPercent = rssi == null ? 0 : Math.min(100, Math.max(10, Math.round((rssi + 100) * 1.6)));

      return `
        <div class="robot-device-card ${state.selectedDeviceId === d.id ? 'active-device' : ''}" data-device-id="${d.id}">
          <div class="robot-card-header">
            <div>
              <div class="robot-card-title">
                <span>🤖</span> ${escapeHtml(d.device_name)}
              </div>
              <div class="robot-card-uuid">UUID: ${escapeHtml(d.device_uuid)} • SN: ${escapeHtml(d.serial_number || 'N/A')}</div>
            </div>
            <span class="robot-status-pill ${isOnline ? 'online' : 'offline'}">
              <span class="robot-pulse-dot"></span> ${d.status}
            </span>
          </div>

          <div style="font-size: 0.82rem; color: #cbd5e1; display: flex; gap: 8px; align-items: center;">
            <span style="color: var(--robot-accent);">📍 Zone:</span>
            <span>${escapeHtml(d.location_zone || 'Reception Desk')}</span>
          </div>

          <div class="robot-specs-row">
            <div class="robot-spec-item">
              <span class="robot-spec-title">Battery</span>
              <span class="robot-spec-value" style="color: ${batt == null ? 'var(--text-dim)' : batt > 25 ? '#00e676' : '#ff1744'};">${batt == null ? '—' : `${batt}%`}</span>
              <div class="robot-meter-wrap">
                <div class="robot-meter-bar">
                  <div class="robot-meter-fill ${battColor}" style="width: ${batt ?? 0}%;"></div>
                </div>
              </div>
            </div>

            <div class="robot-spec-item">
              <span class="robot-spec-title">Wi-Fi RSSI</span>
              <span class="robot-spec-value">${rssi == null ? '—' : `${rssi} dBm`}</span>
              <div class="robot-meter-wrap">
                <div class="robot-meter-bar">
                  <div class="robot-meter-fill blue" style="width: ${rssiPercent}%;"></div>
                </div>
              </div>
            </div>

            <div class="robot-spec-item">
              <span class="robot-spec-title">Firmware</span>
              <span class="robot-spec-value">v${escapeHtml(d.firmware_version || '1.0')}</span>
              <span style="font-size: 0.68rem; color: var(--text-dim); margin-top: 4px;">ESP32 Node</span>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; margin-top: 4px;">
            <div style="font-size: 0.75rem; color: var(--text-dim);">
              IP: <span class="font-mono text-white">${escapeHtml(d.ip_address || '—')}</span>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-sm btn-outline btn-select-device" data-id="${d.id}" title="Select for Live Telemetry">
                ${state.selectedDeviceId === d.id ? '✓ Selected' : 'Select'}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click handlers
    container.querySelectorAll('.btn-select-device').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        state.selectedDeviceId = id;
        populateDeviceSelectors();
        renderFleetCards();
        showToast(`Selected device #${id} for telemetry view`, 'info');
      });
    });
  }

  // ==========================================
  // RENDER: HEALTH, POWER & WI-FI (FEATURES 2, 3, 4)
  // ==========================================
  function renderHealthMetrics() {
    const h = state.healthMetrics;
    if (!h) return;

    const healthScoreEl = document.getElementById('diag-health-score');
    const healthStatusEl = document.getElementById('diag-health-status');
    const batteryVoltsEl = document.getElementById('diag-batt-volts');
    const batteryHrsEl = document.getElementById('diag-batt-hours');
    const wifiQualityEl = document.getElementById('diag-wifi-quality');
    const wifiIpEl = document.getElementById('diag-wifi-ip');

    if (healthScoreEl) healthScoreEl.textContent = `${h.healthScore} / 100`;
    if (healthStatusEl) healthStatusEl.textContent = h.healthScore > 80 ? 'Optimal Performance' : 'Requires Attention';
    if (batteryVoltsEl) batteryVoltsEl.textContent = `${h.battery.voltage} V (${h.battery.status})`;
    if (batteryHrsEl) batteryHrsEl.textContent = `~${h.battery.estHoursRemaining} hrs remaining`;
    if (wifiQualityEl) wifiQualityEl.textContent = `${h.wifi.quality} (${h.wifi.rssi} dBm)`;
    if (wifiIpEl) wifiIpEl.textContent = `${h.wifi.ipAddress} (${h.wifi.macAddress})`;
  }

  function renderPowerAndWifi() {
    const dev = state.devices.find(d => d.id === state.selectedDeviceId) || state.devices[0];
    if (!dev) return;

    const batt = dev.battery_level != null ? Number(dev.battery_level) : null;
    const volts = dev.battery_voltage != null ? dev.battery_voltage : null;
    const charging = dev.charging_status || (batt == null ? 'no data' : 'discharging');
    const rssi = dev.wifi_rssi != null ? Number(dev.wifi_rssi) : null;

    const battFill = document.getElementById('power-batt-fill');
    const battText = document.getElementById('power-batt-text');
    const battVoltText = document.getElementById('power-batt-volts');
    const battStatusText = document.getElementById('power-batt-status');

    if (battFill) {
      battFill.style.width = `${batt ?? 0}%`;
      battFill.className = `robot-meter-fill ${batt == null || batt > 50 ? 'green' : batt > 25 ? 'amber' : 'red'}`;
    }
    if (battText) battText.textContent = batt == null ? '—' : `${batt}%`;
    if (battVoltText) battVoltText.textContent = volts == null ? '— V DC' : `${volts} V DC`;
    if (battStatusText) battStatusText.textContent = charging.toUpperCase();

    const wifiFill = document.getElementById('wifi-rssi-fill');
    const wifiVal = document.getElementById('wifi-rssi-val');
    const wifiQualityText = document.getElementById('wifi-quality-text');

    const rssiPercent = rssi == null ? 0 : Math.min(100, Math.max(10, Math.round((rssi + 100) * 1.6)));
    if (wifiFill) wifiFill.style.width = `${rssiPercent}%`;
    if (wifiVal) wifiVal.textContent = rssi == null ? '— dBm' : `${rssi} dBm`;
    if (wifiQualityText) {
      wifiQualityText.textContent = rssi == null ? 'NO SIGNAL DATA' : rssi >= -65 ? 'EXCELLENT SIGNAL' : rssi >= -75 ? 'GOOD SIGNAL' : 'WEAK SIGNAL';
    }
  }

  // ==========================================
  // RENDER: SENSOR TELEMETRY (FEATURE 5)
  // ==========================================
  function renderSensorTelemetry() {
    const tbody = document.getElementById('tbody-sensor-telemetry');
    if (!tbody) return;

    if (state.sensorTelemetry.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-dim);">No telemetry recordings logged for this sensor filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.sensorTelemetry.map(t => {
      const statusClass = t.status === 'normal' ? 'success' : t.status === 'warning' ? 'warning' : 'critical';
      const dateStr = new Date(t.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      return `
        <tr>
          <td class="font-mono text-xs text-dim">${dateStr}</td>
          <td><span class="font-bold text-white">${escapeHtml(t.device_name)}</span></td>
          <td><span class="badge badge-outline font-mono text-xs">${escapeHtml(t.sensor_type.toUpperCase())}</span></td>
          <td>${escapeHtml(t.sensor_name)}</td>
          <td>
            <span class="font-mono font-bold text-white" style="font-size:1rem;">${t.reading_value}</span>
            <span class="text-xs text-dim">${escapeHtml(t.unit)}</span>
          </td>
          <td>
            <span class="badge-robot ${statusClass}">${t.status.toUpperCase()}</span>
          </td>
          <td class="text-xs text-dim font-mono">
            ${t.threshold_min !== null ? `Min: ${t.threshold_min}` : ''} ${t.threshold_max !== null ? `Max: ${t.threshold_max}` : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // RENDER: ACTIVITY & COMMANDS (FEATURE 6)
  // ==========================================
  function renderActivityHistory() {
    const tbody = document.getElementById('tbody-robot-activity');
    if (!tbody) return;

    if (state.activityHistory.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-dim);">No gesture or routine activities recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.activityHistory.map(c => {
      const statusClass = c.status === 'completed' ? 'success' : c.status === 'failed' ? 'critical' : 'warning';
      const timeStr = new Date(c.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

      return `
        <tr>
          <td class="font-mono text-xs text-dim">${timeStr}</td>
          <td class="font-bold text-white">${escapeHtml(c.device_name)}</td>
          <td><span class="badge badge-outline font-mono">${escapeHtml(c.command_type)}</span></td>
          <td>
            <span style="color: var(--robot-cyan); font-weight: 600;">
              ${escapeHtml(c.gesture_name || 'Standard Motion')}
            </span>
          </td>
          <td><span class="badge-robot ${statusClass}">${c.status.toUpperCase()}</span></td>
          <td class="font-mono text-xs">${c.execution_time_ms ? `${c.execution_time_ms} ms` : '—'}</td>
          <td class="text-xs text-dim">${escapeHtml(c.triggered_by || 'Autonomous Routine')}</td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // RENDER: HARDWARE EVENT LOGS (FEATURE 7)
  // ==========================================
  function renderHardwareLogs() {
    const tbody = document.getElementById('tbody-hardware-logs');
    if (!tbody) return;

    if (state.eventLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-dim);">No hardware event logs recorded matching criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.eventLogs.map(l => {
      const level = (l.log_level || 'INFO').toLowerCase();
      const timeStr = new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      return `
        <tr>
          <td class="font-mono text-xs text-dim">${timeStr}</td>
          <td class="font-bold text-white">${escapeHtml(l.device_name || 'ESP32 Device')}</td>
          <td><span class="badge-robot ${level}">${escapeHtml(l.log_level)}</span></td>
          <td class="font-mono text-xs text-cyan">${escapeHtml(l.event_type || 'SYS_EVENT')}</td>
          <td style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${escapeHtml(l.message)}
          </td>
          <td class="font-mono text-xs text-dim">
            ${l.payload ? JSON.stringify(l.payload).substring(0, 40) + '...' : '—'}
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // RENDER: CONNECTION ALERTS (FEATURE 8)
  // ==========================================
  function renderAlerts() {
    const tbody = document.getElementById('tbody-device-alerts');
    if (!tbody) return;

    if (state.alerts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-dim);">All devices operating normally. No alerts logged.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.alerts.map(a => {
      const sevClass = a.severity === 'critical' || a.severity === 'emergency' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info';
      const timeStr = new Date(a.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

      return `
        <tr>
          <td class="font-mono text-xs text-dim">${timeStr}</td>
          <td class="font-bold text-white">${escapeHtml(a.device_name)}</td>
          <td><span class="badge-robot ${sevClass}">${a.severity.toUpperCase()}</span></td>
          <td style="font-weight:600; color:#fff;">${escapeHtml(a.alert_type)}</td>
          <td style="color:#cbd5e1;">${escapeHtml(a.message)}</td>
          <td>
            ${a.is_resolved 
              ? `<span class="badge-robot success">RESOLVED</span>` 
              : `<button class="btn btn-sm btn-outline btn-resolve-alert" data-id="${a.id}" style="border-color:#ff1744; color:#ff1744;">Resolve</button>`
            }
          </td>
        </tr>
      `;
    }).join('');

    // Attach resolve handlers
    tbody.querySelectorAll('.btn-resolve-alert').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        try {
          const res = await apiFetch(`/alerts/${id}/resolve`, {
            method: 'PATCH',
            body: JSON.stringify({ resolved_by: 'Duty Admin' })
          });
          if (res.success) {
            showToast('Alert resolved successfully', 'success');
            await loadAlerts();
          }
        } catch (err) {
          showToast(`Failed to resolve alert: ${err.message}`, 'error');
        }
      });
    });
  }

  // ==========================================
  // RENDER: MAINTENANCE HISTORY (FEATURE 10)
  // ==========================================
  function renderMaintenanceHistory() {
    const tbody = document.getElementById('tbody-maintenance-records');
    if (!tbody) return;

    if (state.maintenanceLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-dim);">No maintenance records found for selected criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.maintenanceLogs.map(m => {
      const isCompleted = m.status === 'completed';
      const schedDate = new Date(m.scheduled_date).toLocaleDateString([], { dateStyle: 'medium' });

      return `
        <tr>
          <td class="font-bold text-white">${escapeHtml(m.device_name)}</td>
          <td><span class="badge badge-outline">${escapeHtml(m.maintenance_type)}</span></td>
          <td class="font-mono text-xs">${schedDate}</td>
          <td>${escapeHtml(m.technician_name)}</td>
          <td class="font-mono font-bold text-white">₹${parseFloat(m.cost || 0).toFixed(2)}</td>
          <td>
            <span class="badge-robot ${isCompleted ? 'success' : 'warning'}">${m.status.toUpperCase()}</span>
          </td>
          <td>
            ${!isCompleted ? `
              <button class="btn btn-sm btn-green btn-complete-maint" data-id="${m.id}">Mark Done</button>
            ` : `<span class="text-xs text-dim font-mono">Done ${m.completed_date || ''}</span>`}
          </td>
        </tr>
      `;
    }).join('');

    // Attach mark done handlers
    tbody.querySelectorAll('.btn-complete-maint').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        try {
          const res = await apiFetch(`/maintenance/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'completed' })
          });
          if (res.success) {
            showToast('Maintenance marked as completed', 'success');
            await loadMaintenanceHistory();
          }
        } catch (err) {
          showToast(`Failed to update maintenance: ${err.message}`, 'error');
        }
      });
    });
  }

  // ==========================================
  // RENDER: SAFETY MONITORING (FEATURE 11)
  // ==========================================
  function renderSafetyIncidents() {
    const tbody = document.getElementById('tbody-safety-incidents');
    if (!tbody) return;

    if (state.safetyIncidents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-dim);">Zero safety incidents or collisions recorded. Fleet safeguards active.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.safetyIncidents.map(s => {
      const sevClass = s.severity === 'critical' ? 'critical' : s.severity === 'warning' ? 'warning' : 'info';
      const timeStr = new Date(s.occurred_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

      return `
        <tr>
          <td class="font-mono text-xs text-dim">${timeStr}</td>
          <td class="font-bold text-white">${escapeHtml(s.device_name)}</td>
          <td><span class="badge-robot ${sevClass}">${s.severity.toUpperCase()}</span></td>
          <td style="color:#fff; font-weight:600;">${escapeHtml(s.safety_event_type)}</td>
          <td style="color:var(--robot-accent); font-weight:600;">${escapeHtml(s.safety_action_taken)}</td>
          <td class="text-xs text-dim">${escapeHtml(s.zone_location || 'Main Reception')}</td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // RENDER: ROBOTICS ANALYTICS (FEATURE 9)
  // ==========================================
  function renderAnalytics() {
    if (!state.analytics) return;
    const a = state.analytics;

    const cmdTotalEl = document.getElementById('analytics-cmd-total');
    const cmdSuccessEl = document.getElementById('analytics-cmd-success');
    const avgExecEl = document.getElementById('analytics-avg-exec');
    const topGesturesList = document.getElementById('analytics-top-gestures');

    if (cmdTotalEl) cmdTotalEl.textContent = a.commands?.total_commands_executed || 0;
    if (cmdSuccessEl) cmdSuccessEl.textContent = `${a.commands?.successful_commands || 0} (${Math.round((a.commands?.successful_commands / Math.max(1, a.commands?.total_commands_executed)) * 100)}%)`;
    if (avgExecEl) avgExecEl.textContent = `${a.commands?.avg_execution_time_ms || 320} ms`;

    if (topGesturesList && Array.isArray(a.topGestures)) {
      topGesturesList.innerHTML = a.topGestures.map(g => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
          <span style="color:#fff; font-weight:600;">👋 ${escapeHtml(g.gesture_name)}</span>
          <span class="badge badge-green font-mono">${g.count} executions</span>
        </div>
      `).join('');
    }
  }

  // ==========================================
  // MODALS & EVENT HANDLERS
  // ==========================================
  function setupModals() {
    // Open Register Modal
    const btnOpenRegister = document.getElementById('btn-open-register-modal');
    if (btnOpenRegister) {
      btnOpenRegister.onclick = () => openModal('modal-register-device');
    }

    // Open Schedule Maint Modal
    const btnOpenMaint = document.getElementById('btn-open-maint-modal');
    if (btnOpenMaint) {
      btnOpenMaint.onclick = () => openModal('modal-schedule-maint');
    }

    // Open Record Sensor Modal
    const btnOpenSensor = document.getElementById('btn-open-sensor-modal');
    if (btnOpenSensor) {
      btnOpenSensor.onclick = () => openModal('modal-record-sensor');
    }

    // Open Log Safety Modal
    const btnOpenSafety = document.getElementById('btn-open-safety-modal');
    if (btnOpenSafety) {
      btnOpenSafety.onclick = () => openModal('modal-log-safety');
    }

    // Close buttons on all modals
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.onclick = () => closeModal();
    });

    // Close on overlay click
    document.querySelectorAll('.robot-modal-overlay').forEach(ov => {
      ov.onclick = (e) => {
        if (e.target === ov) closeModal();
      };
    });

    // Handle Form Submissions
    setupFormSubmissions();
  }

  function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('active');
  }

  function closeModal() {
    document.querySelectorAll('.robot-modal-overlay').forEach(ov => ov.classList.remove('active'));
  }

  function setupFormSubmissions() {
    // 1. Device Registration Form
    const formReg = document.getElementById('form-register-device');
    if (formReg) {
      formReg.onsubmit = async (e) => {
        e.preventDefault();
        const body = {
          device_name: document.getElementById('reg-device-name').value.trim(),
          device_uuid: document.getElementById('reg-device-uuid').value.trim(),
          device_model: document.getElementById('reg-device-model').value.trim(),
          serial_number: document.getElementById('reg-device-sn').value.trim(),
          ip_address: document.getElementById('reg-device-ip').value.trim(),
          mac_address: document.getElementById('reg-device-mac').value.trim(),
          location_zone: document.getElementById('reg-device-zone').value.trim()
        };

        try {
          const res = await apiFetch('/devices', {
            method: 'POST',
            body: JSON.stringify(body)
          });
          if (res.success) {
            showToast('Robot device registered successfully', 'success');
            closeModal();
            formReg.reset();
            await loadDevices();
          }
        } catch (err) {
          showToast(`Registration failed: ${err.message}`, 'error');
        }
      };
    }

    // 2. Schedule Maintenance Form
    const formMaint = document.getElementById('form-schedule-maint');
    if (formMaint) {
      formMaint.onsubmit = async (e) => {
        e.preventDefault();
        const body = {
          device_id: parseInt(document.getElementById('maint-device-id').value, 10),
          maintenance_type: document.getElementById('maint-type').value,
          technician_name: document.getElementById('maint-tech').value.trim(),
          scheduled_date: document.getElementById('maint-date').value,
          cost: parseFloat(document.getElementById('maint-cost').value || 0),
          work_summary: document.getElementById('maint-summary').value.trim()
        };

        try {
          const res = await apiFetch('/maintenance', {
            method: 'POST',
            body: JSON.stringify(body)
          });
          if (res.success) {
            showToast('Maintenance scheduled successfully', 'success');
            closeModal();
            formMaint.reset();
            await loadMaintenanceHistory();
          }
        } catch (err) {
          showToast(`Scheduling failed: ${err.message}`, 'error');
        }
      };
    }

    // 3. Record Sensor Reading Form
    const formSensor = document.getElementById('form-record-sensor');
    if (formSensor) {
      formSensor.onsubmit = async (e) => {
        e.preventDefault();
        const body = {
          device_id: parseInt(document.getElementById('sensor-device-id').value, 10),
          sensor_type: document.getElementById('sensor-type').value,
          sensor_name: document.getElementById('sensor-name').value.trim(),
          reading_value: parseFloat(document.getElementById('sensor-value').value),
          unit: document.getElementById('sensor-unit').value.trim(),
          threshold_min: document.getElementById('sensor-thresh-min').value ? parseFloat(document.getElementById('sensor-thresh-min').value) : null,
          threshold_max: document.getElementById('sensor-thresh-max').value ? parseFloat(document.getElementById('sensor-thresh-max').value) : null
        };

        try {
          const res = await apiFetch('/telemetry', {
            method: 'POST',
            body: JSON.stringify(body)
          });
          if (res.success) {
            showToast('Sensor reading recorded', 'success');
            closeModal();
            formSensor.reset();
            await loadSensorTelemetry();
          }
        } catch (err) {
          showToast(`Recording failed: ${err.message}`, 'error');
        }
      };
    }

    // 4. Log Safety Incident Form
    const formSafety = document.getElementById('form-log-safety');
    if (formSafety) {
      formSafety.onsubmit = async (e) => {
        e.preventDefault();
        const body = {
          device_id: parseInt(document.getElementById('safety-device-id').value, 10),
          safety_event_type: document.getElementById('safety-type').value,
          severity: document.getElementById('safety-severity').value,
          safety_action_taken: document.getElementById('safety-action').value.trim(),
          zone_location: document.getElementById('safety-zone').value.trim(),
          notes: document.getElementById('safety-notes').value.trim()
        };

        try {
          const res = await apiFetch('/safety', {
            method: 'POST',
            body: JSON.stringify(body)
          });
          if (res.success) {
            showToast('Safety incident logged successfully', 'success');
            closeModal();
            formSafety.reset();
            await loadSafetyIncidents();
            updateKpis();
          }
        } catch (err) {
          showToast(`Failed to log safety incident: ${err.message}`, 'error');
        }
      };
    }
  }

  function setupFilters() {
    // Fleet search & status
    const fleetStatus = document.getElementById('filter-fleet-status');
    const fleetSearch = document.getElementById('input-fleet-search');
    if (fleetStatus) {
      fleetStatus.onchange = () => {
        state.filters.fleetStatus = fleetStatus.value;
        loadDevices();
      };
    }
    if (fleetSearch) {
      fleetSearch.oninput = () => {
        state.filters.fleetSearch = fleetSearch.value;
        loadDevices();
      };
    }

    // Sensor type filter
    const sensorFilter = document.getElementById('filter-sensor-type');
    if (sensorFilter) {
      sensorFilter.onchange = () => {
        state.filters.sensorType = sensorFilter.value;
        loadSensorTelemetry();
      };
    }

    // Log level filter
    const logFilter = document.getElementById('filter-log-level');
    if (logFilter) {
      logFilter.onchange = () => {
        state.filters.logLevel = logFilter.value;
        loadHardwareLogs();
      };
    }

    // Alert filters
    const alertSevFilter = document.getElementById('filter-alert-severity');
    const alertResFilter = document.getElementById('filter-alert-resolved');
    if (alertSevFilter) {
      alertSevFilter.onchange = () => {
        state.filters.alertSeverity = alertSevFilter.value;
        loadAlerts();
      };
    }
    if (alertResFilter) {
      alertResFilter.onchange = () => {
        state.filters.alertResolved = alertResFilter.value;
        loadAlerts();
      };
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

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

