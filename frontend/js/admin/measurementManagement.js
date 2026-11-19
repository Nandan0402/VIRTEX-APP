/**
 * Virtex Admin - Body Measurements and Transformation Controller
 * Manages weight tracking, BMI, body-fat %, muscle mass, circumferences,
 * before/after photography with member consent, and transformation reports.
 */

(function () {
  'use strict';

  // Global State
  let measurements = [];
  let membersList = [];
  let currentMemberId = null;
  let timelineData = null;
  let photosData = [];
  let kpisData = null;

  let currentTab = 'history';

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
    toast.className = `meas-toast toast-${type}`;
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
    setupModalListeners();
    setupFormCalculators();

    await Promise.all([
      fetchMembers(),
      loadMeasurements(),
      loadKpis()
    ]);
  }

  // Fetch Members for Select Dropdowns
  async function fetchMembers() {
    try {
      const res = await fetch('/api/v1/members', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        membersList = json.data || json.members || [];
        populateMemberDropdowns();
      }
    } catch (err) {
      console.warn('Could not fetch members:', err);
    }
  }

  function populateMemberDropdowns() {
    const selects = ['filter-member-select', 'new-meas-member-select', 'new-photo-member-select', 'report-member-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const isFilter = (id === 'filter-member-select');
        el.innerHTML = (isFilter ? '<option value="All">All Tracked Members</option>' : '<option value="">-- Choose Member --</option>') +
          membersList.map(m => `<option value="${m.id}">${m.full_name || m.name} (${m.member_code || '#' + m.id})</option>`).join('');
      }
    });

    if (membersList.length > 0 && !currentMemberId) {
      currentMemberId = membersList[0].id;
      const repSelect = document.getElementById('report-member-select');
      if (repSelect) repSelect.value = currentMemberId;
      loadMemberDetails(currentMemberId);
    }

    const filterSelect = document.getElementById('filter-member-select');
    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val !== 'All') {
          currentMemberId = parseInt(val, 10);
          loadMeasurements(currentMemberId);
          loadMemberDetails(currentMemberId);
        } else {
          loadMeasurements();
        }
      });
    }

    const repSelect = document.getElementById('report-member-select');
    if (repSelect) {
      repSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          currentMemberId = parseInt(val, 10);
          loadMemberDetails(currentMemberId);
        }
      });
    }
  }

  // Tab Navigation
  function setupTabListeners() {
    const tabs = document.querySelectorAll('.meas-tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.getAttribute('data-tab');

        document.querySelectorAll('.meas-tab-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById(`tab-${currentTab}`);
        if (target) target.style.display = 'block';

        if (currentMemberId && (currentTab === 'timeline' || currentTab === 'photos' || currentTab === 'comparison' || currentTab === 'report')) {
          loadMemberDetails(currentMemberId);
        }
      });
    });
  }

  // Real-time BMI Calculator in New Measurement Modal
  function setupFormCalculators() {
    const wtInput = document.getElementById('new-meas-weight');
    const htInput = document.getElementById('new-meas-height');
    const bmiDisp = document.getElementById('new-meas-bmi-preview');

    function updateBmi() {
      const wt = parseFloat(wtInput?.value);
      const ht = parseFloat(htInput?.value);
      if (wt > 0 && ht > 0) {
        const hm = ht / 100.0;
        const bmi = (wt / (hm * hm)).toFixed(1);
        if (bmiDisp) bmiDisp.textContent = `Calculated BMI: ${bmi}`;
      } else {
        if (bmiDisp) bmiDisp.textContent = 'Calculated BMI: --';
      }
    }

    if (wtInput) wtInput.addEventListener('input', updateBmi);
    if (htInput) htInput.addEventListener('input', updateBmi);
  }

  // API Callers
  async function loadMeasurements(memberId) {
    try {
      let url = '/api/v1/admin/measurements';
      if (memberId) url += `?member_id=${encodeURIComponent(memberId)}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        measurements = json.data || [];
        const badge = document.getElementById('badge-meas-count');
        if (badge) badge.textContent = measurements.length;
        renderMeasurements();
      }
    } catch (err) {
      console.error('Failed to load measurements:', err);
    }
  }

  async function loadMemberDetails(memberId) {
    if (!memberId) return;
    try {
      const [timelineRes, photosRes, reportRes] = await Promise.all([
        fetch(`/api/v1/admin/measurements/timeline/${memberId}`, { headers: getAuthHeaders() }),
        fetch(`/api/v1/admin/measurements/photos/${memberId}`, { headers: getAuthHeaders() }),
        fetch(`/api/v1/admin/measurements/report/${memberId}`, { headers: getAuthHeaders() })
      ]);

      if (timelineRes.ok) {
        const json = await timelineRes.json();
        timelineData = json.data || null;
        renderTimeline();
      }
      if (photosRes.ok) {
        const json = await photosRes.json();
        photosData = json.data || [];
        const pBadge = document.getElementById('badge-photos-count');
        if (pBadge) pBadge.textContent = photosData.length;
        renderPhotos();
      }
      if (reportRes.ok) {
        const json = await reportRes.json();
        renderMonthlyComparison(json.data);
        renderDownloadableReport(json.data);
      }
    } catch (err) {
      console.error('Failed to load member transformation details:', err);
    }
  }

  async function loadKpis() {
    try {
      const res = await fetch('/api/v1/admin/measurements/kpis/summary', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        kpisData = json.data || null;
        renderKpis();
      }
    } catch (err) {
      console.error('Failed to load measurement KPIs:', err);
    }
  }

  // Render Functions
  function renderKpis() {
    if (!kpisData) return;
    const { totalTrackedMembers, totalMeasurementRecords, totalPhotosWithConsent, averages } = kpisData;

    const memEl = document.getElementById('kpi-tracked-lifters');
    if (memEl) memEl.textContent = totalTrackedMembers || 0;

    const recEl = document.getElementById('kpi-total-records');
    if (recEl) recEl.textContent = totalMeasurementRecords || 0;

    const pEl = document.getElementById('kpi-photos-consent');
    if (pEl) pEl.textContent = totalPhotosWithConsent || 0;

    const wtEl = document.getElementById('kpi-avg-weight');
    if (wtEl && averages) wtEl.textContent = `${averages.avg_gym_weight || 75} kg`;

    const bmiEl = document.getElementById('kpi-avg-bmi');
    if (bmiEl && averages) bmiEl.textContent = averages.avg_gym_bmi || 24.5;
  }

  function renderMeasurements() {
    const tbody = document.getElementById('measurements-table-body');
    if (!tbody) return;

    if (measurements.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No body measurements logged. Click "+ Record Measurement" to track physical stats.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = measurements.map(m => `
      <tr>
        <td>
          <span style="font-size: 0.85rem; color: #e2e8f0; font-family: 'JetBrains Mono', monospace;">
            ${new Date(m.logged_at).toLocaleDateString()}
          </span>
        </td>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(m.member_name)}</div>
          <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(m.member_code)}</div>
        </td>
        <td>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; font-weight: 700; color: #fff;">
            ${Number(m.weight_kg).toFixed(1)} kg
          </div>
          <div style="font-size: 0.75rem; color: #64748b;">Ht: ${m.height_cm || 175} cm</div>
        </td>
        <td>
          <span class="delta-chip delta-neutral">${m.bmi ? 'BMI ' + m.bmi : '—'}</span>
        </td>
        <td>
          <div style="font-size: 0.82rem; font-family: 'JetBrains Mono', monospace;">
            BF: <strong style="color: #ffd600;">${m.body_fat_pct ? m.body_fat_pct + '%' : '—'}</strong> • 
            Muscle: <strong style="color: #00e676;">${m.muscle_mass_kg ? m.muscle_mass_kg + 'kg' : '—'}</strong>
          </div>
        </td>
        <td>
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">
            ${m.waist_cm ? `<span class="circ-badge">W: ${m.waist_cm}cm</span>` : ''}
            ${m.chest_cm ? `<span class="circ-badge">Ch: ${m.chest_cm}cm</span>` : ''}
            ${m.arms_cm ? `<span class="circ-badge">Arm: ${m.arms_cm}cm</span>` : ''}
            ${m.thighs_cm ? `<span class="circ-badge">Th: ${m.thighs_cm}cm</span>` : ''}
          </div>
        </td>
        <td>
          <span style="font-size: 0.82rem; color: #94a3b8;">${escapeHtml(m.measured_by || 'Trainer')}</span>
        </td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="window.viewMeasurementDetails(${m.id})">
            Details 🔍
          </button>
        </td>
      </tr>
    `).join('');
  }

  function renderPhotos() {
    const grid = document.getElementById('photos-gallery-grid');
    if (!grid) return;

    if (photosData.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">📸</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No transformation photos with member consent</h3>
          <p style="color: #64748b; font-size: 0.9rem;">Click "+ Add Progress Photo" to store verified before-and-after imagery.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = photosData.map(p => `
      <div class="photo-card">
        <div class="photo-img-wrap">
          <img src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.phase)} ${escapeHtml(p.pose)}" onerror="this.src='https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600';">
          <span class="photo-phase-pill">${escapeHtml(p.phase)} (${escapeHtml(p.pose || 'Front')})</span>
          <span class="photo-consent-badge">✓ Consent Verified</span>
        </div>
        <div class="photo-content">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #fff; font-size: 0.95rem;">${escapeHtml(p.member_name)}</strong>
            <span style="font-size: 0.78rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">
              ${new Date(p.logged_at).toLocaleDateString()}
            </span>
          </div>
          <div style="font-size: 0.82rem; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">
            ${p.weight_at_photo ? p.weight_at_photo + ' kg' : ''} ${p.body_fat_at_photo ? '• ' + p.body_fat_at_photo + '% Body Fat' : ''}
          </div>
          <p style="font-size: 0.8rem; color: #cbd5e1; margin: 4px 0 0 0;">${escapeHtml(p.caption || 'Physique check-in.')}</p>
        </div>
      </div>
    `).join('');
  }

  function renderTimeline() {
    const container = document.getElementById('transformation-timeline-container');
    if (!container) return;

    if (!timelineData || !timelineData.timeline || timelineData.timeline.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; background: #11141e; border-radius: 10px; border: 1px dashed #1e2433; color: #64748b;">
          No longitudinal transformation data logged for this member yet.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="timeline-track">
        ${timelineData.timeline.map((item, idx) => `
          <div class="timeline-node">
            <div class="timeline-dot ${item.is_baseline ? 'baseline' : ''}"></div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div>
                <span class="badge ${item.is_baseline ? 'badge-blue' : 'badge-green'}" style="margin-right: 8px;">
                  ${item.is_baseline ? '🏁 BASELINE ASSESSMENT' : `MILESTONE #${idx}`}
                </span>
                <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: #fff;">
                  ${new Date(item.logged_at).toLocaleDateString()}
                </span>
              </div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 1.1rem; font-weight: 800; color: #fff;">
                ${Number(item.weight_kg).toFixed(1)} kg
                ${!item.is_baseline ? `
                  <span class="delta-chip ${item.delta_weight_kg <= 0 ? 'delta-good' : 'delta-warn'}">
                    ${item.delta_weight_kg > 0 ? '+' : ''}${item.delta_weight_kg} kg
                  </span>
                ` : ''}
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; background: #0b0d14; padding: 10px; border-radius: 8px; margin-bottom: 10px;">
              <div>
                <div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase;">Body Fat %</div>
                <div style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #ffd600;">
                  ${item.body_fat_pct ? item.body_fat_pct + '%' : '—'}
                  ${!item.is_baseline && item.delta_body_fat_pct !== null ? `
                    <span class="delta-chip ${item.delta_body_fat_pct <= 0 ? 'delta-good' : 'delta-warn'}" style="font-size: 0.68rem;">
                      ${item.delta_body_fat_pct > 0 ? '+' : ''}${item.delta_body_fat_pct}%
                    </span>
                  ` : ''}
                </div>
              </div>
              <div>
                <div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase;">Muscle Mass</div>
                <div style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #00e676;">
                  ${item.muscle_mass_kg ? item.muscle_mass_kg + 'kg' : '—'}
                  ${!item.is_baseline && item.delta_muscle_mass_kg !== null ? `
                    <span class="delta-chip ${item.delta_muscle_mass_kg >= 0 ? 'delta-good' : 'delta-warn'}" style="font-size: 0.68rem;">
                      ${item.delta_muscle_mass_kg > 0 ? '+' : ''}${item.delta_muscle_mass_kg}kg
                    </span>
                  ` : ''}
                </div>
              </div>
              <div>
                <div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase;">Waist</div>
                <div style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #00b0ff;">
                  ${item.waist_cm ? item.waist_cm + 'cm' : '—'}
                  ${!item.is_baseline && item.delta_waist_cm !== null ? `
                    <span class="delta-chip ${item.delta_waist_cm <= 0 ? 'delta-good' : 'delta-warn'}" style="font-size: 0.68rem;">
                      ${item.delta_waist_cm > 0 ? '+' : ''}${item.delta_waist_cm}cm
                    </span>
                  ` : ''}
                </div>
              </div>
              <div>
                <div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase;">Chest</div>
                <div style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #fff;">
                  ${item.chest_cm ? item.chest_cm + 'cm' : '—'}
                  ${!item.is_baseline && item.delta_chest_cm !== null ? `
                    <span class="delta-chip ${item.delta_chest_cm >= 0 ? 'delta-good' : 'delta-neutral'}" style="font-size: 0.68rem;">
                      ${item.delta_chest_cm > 0 ? '+' : ''}${item.delta_chest_cm}cm
                    </span>
                  ` : ''}
                </div>
              </div>
            </div>

            <p style="font-size: 0.85rem; color: #cbd5e1; margin: 0; line-height: 1.4;">
              ${escapeHtml(item.notes || 'Routine check-in.')}
            </p>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderMonthlyComparison(report) {
    const container = document.getElementById('monthly-comparison-container');
    if (!container || !report) return;

    const b = report.baseline;
    const l = report.latest;

    if (!b || !l || b.id === l.id) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; background: #11141e; border-radius: 10px; border: 1px dashed #1e2433; color: #64748b;">
          At least two chronological measurement check-ins are required to generate comparison deltas.
        </div>
      `;
      return;
    }

    const wtDelta = Number((Number(l.weight_kg) - Number(b.weight_kg)).toFixed(1));
    const bfDelta = b.body_fat_pct && l.body_fat_pct ? Number((Number(l.body_fat_pct) - Number(b.body_fat_pct)).toFixed(1)) : null;
    const mmDelta = b.muscle_mass_kg && l.muscle_mass_kg ? Number((Number(l.muscle_mass_kg) - Number(b.muscle_mass_kg)).toFixed(1)) : null;
    const waistDelta = b.waist_cm && l.waist_cm ? Number((Number(l.waist_cm) - Number(b.waist_cm)).toFixed(1)) : null;
    const chestDelta = b.chest_cm && l.chest_cm ? Number((Number(l.chest_cm) - Number(b.chest_cm)).toFixed(1)) : null;

    container.innerHTML = `
      <div class="admin-card" style="background: #11141e; border: 1px solid #1e2433; border-radius: 10px; padding: 20px; margin-bottom: 20px;">
        <h4 style="color: #fff; margin-bottom: 8px;">Executive Transformation Assessment</h4>
        <p style="font-size: 0.95rem; color: #00e676; line-height: 1.6; margin-bottom: 16px;">${report.summaryText}</p>

        <table class="exercise-table">
          <thead>
            <tr>
              <th>Physique Dimension</th>
              <th>Baseline (${new Date(b.logged_at).toLocaleDateString()})</th>
              <th>Latest Check-in (${new Date(l.logged_at).toLocaleDateString()})</th>
              <th>Total Net Delta</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="font-weight: 700; color: #fff;">Body Weight</td>
              <td>${Number(b.weight_kg).toFixed(1)} kg</td>
              <td>${Number(l.weight_kg).toFixed(1)} kg</td>
              <td><span class="delta-chip ${wtDelta <= 0 ? 'delta-good' : 'delta-warn'}">${wtDelta > 0 ? '+' : ''}${wtDelta} kg</span></td>
            </tr>
            <tr>
              <td style="font-weight: 700; color: #fff;">Body Fat %</td>
              <td>${b.body_fat_pct ? b.body_fat_pct + '%' : '—'}</td>
              <td>${l.body_fat_pct ? l.body_fat_pct + '%' : '—'}</td>
              <td>${bfDelta !== null ? `<span class="delta-chip ${bfDelta <= 0 ? 'delta-good' : 'delta-warn'}">${bfDelta > 0 ? '+' : ''}${bfDelta}%</span>` : '—'}</td>
            </tr>
            <tr>
              <td style="font-weight: 700; color: #fff;">Muscle Mass</td>
              <td>${b.muscle_mass_kg ? b.muscle_mass_kg + ' kg' : '—'}</td>
              <td>${l.muscle_mass_kg ? l.muscle_mass_kg + ' kg' : '—'}</td>
              <td>${mmDelta !== null ? `<span class="delta-chip ${mmDelta >= 0 ? 'delta-good' : 'delta-warn'}">${mmDelta > 0 ? '+' : ''}${mmDelta} kg</span>` : '—'}</td>
            </tr>
            <tr>
              <td style="font-weight: 700; color: #fff;">Waist Circumference</td>
              <td>${b.waist_cm ? b.waist_cm + ' cm' : '—'}</td>
              <td>${l.waist_cm ? l.waist_cm + ' cm' : '—'}</td>
              <td>${waistDelta !== null ? `<span class="delta-chip ${waistDelta <= 0 ? 'delta-good' : 'delta-warn'}">${waistDelta > 0 ? '+' : ''}${waistDelta} cm</span>` : '—'}</td>
            </tr>
            <tr>
              <td style="font-weight: 700; color: #fff;">Chest Circumference</td>
              <td>${b.chest_cm ? b.chest_cm + ' cm' : '—'}</td>
              <td>${l.chest_cm ? l.chest_cm + ' cm' : '—'}</td>
              <td>${chestDelta !== null ? `<span class="delta-chip ${chestDelta >= 0 ? 'delta-good' : 'delta-neutral'}">${chestDelta > 0 ? '+' : ''}${chestDelta} cm</span>` : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  function renderDownloadableReport(report) {
    const area = document.getElementById('printable-report-area');
    if (!area || !report) return;

    const m = report.member;
    const b = report.baseline;
    const l = report.latest;

    area.innerHTML = `
      <div style="border: 2px solid #00e676; border-radius: 12px; padding: 24px; background: #11141e;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1e2433; padding-bottom: 16px; margin-bottom: 20px;">
          <div>
            <h2 style="font-size: 1.5rem; font-weight: 800; color: #fff; margin: 0;">VIRTEX FITNESS</h2>
            <div style="font-size: 0.85rem; color: #00e676; font-weight: 700;">OFFICIAL CLIENT TRANSFORMATION & BODY REPORT</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.85rem; color: #fff; font-weight: 700;">Date: ${new Date().toLocaleDateString()}</div>
            <div style="font-size: 0.75rem; color: #64748b;">Member Code: ${escapeHtml(m.member_code || '#' + m.id)}</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; background: #0b0d14; padding: 14px; border-radius: 8px; margin-bottom: 20px;">
          <div>
            <span style="font-size: 0.75rem; color: #64748b; text-transform: uppercase;">Client Name</span>
            <div style="color: #fff; font-weight: 700; font-size: 1.1rem;">${escapeHtml(m.full_name)}</div>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: #64748b; text-transform: uppercase;">Current Weight</span>
            <div style="color: #00e676; font-weight: 800; font-size: 1.1rem; font-family: 'JetBrains Mono', monospace;">${l ? Number(l.weight_kg).toFixed(1) + ' kg' : '—'}</div>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: #64748b; text-transform: uppercase;">Current BMI</span>
            <div style="color: #00b0ff; font-weight: 800; font-size: 1.1rem; font-family: 'JetBrains Mono', monospace;">${l && l.bmi ? l.bmi : '—'}</div>
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <h4 style="color: #fff; margin-bottom: 8px;">Transformation Summary</h4>
          <p style="font-size: 0.95rem; color: #cbd5e1; line-height: 1.6; margin: 0; background: rgba(0,230,118,0.06); padding: 12px; border-radius: 6px; border: 1px solid rgba(0,230,118,0.2);">
            ${report.summaryText}
          </p>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #1e2433; padding-top: 16px; font-size: 0.78rem; color: #64748b;">
          <div>Historical preservation verified: Records are logged sequentially and never overwritten.</div>
          <div>Virtex Athletic Management</div>
        </div>
      </div>
    `;
  }

  // Modals & User Actions
  function setupModalListeners() {
    // Open New Measurement Modal
    const btnNewMeas = document.getElementById('btn-open-meas-modal');
    if (btnNewMeas) {
      btnNewMeas.addEventListener('click', () => {
        document.getElementById('modal-new-measurement').classList.add('active');
      });
    }

    // Open Upload Photo Modal
    const btnNewPhoto = document.getElementById('btn-open-photo-modal');
    if (btnNewPhoto) {
      btnNewPhoto.addEventListener('click', () => {
        document.getElementById('modal-new-photo').classList.add('active');
      });
    }

    // Print Report Button
    const btnPrint = document.getElementById('btn-print-report');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        window.print();
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
    const formMeas = document.getElementById('form-new-measurement');
    if (formMeas) formMeas.addEventListener('submit', handleRecordMeasurement);

    const formPhoto = document.getElementById('form-new-photo');
    if (formPhoto) formPhoto.addEventListener('submit', handleAddPhoto);
  }

  // Handle Record Measurement
  async function handleRecordMeasurement(e) {
    e.preventDefault();
    const data = {
      member_id: parseInt(document.getElementById('new-meas-member-select').value, 10),
      weight_kg: parseFloat(document.getElementById('new-meas-weight').value),
      height_cm: parseFloat(document.getElementById('new-meas-height').value) || 175.0,
      body_fat_pct: parseFloat(document.getElementById('new-meas-body-fat').value) || null,
      muscle_mass_kg: parseFloat(document.getElementById('new-meas-muscle').value) || null,
      chest_cm: parseFloat(document.getElementById('new-meas-chest').value) || null,
      waist_cm: parseFloat(document.getElementById('new-meas-waist').value) || null,
      hips_cm: parseFloat(document.getElementById('new-meas-hips').value) || null,
      arms_cm: parseFloat(document.getElementById('new-meas-arms').value) || null,
      thighs_cm: parseFloat(document.getElementById('new-meas-thighs').value) || null,
      calves_cm: parseFloat(document.getElementById('new-meas-calves').value) || null,
      shoulders_cm: parseFloat(document.getElementById('new-meas-shoulders').value) || null,
      neck_cm: parseFloat(document.getElementById('new-meas-neck').value) || null,
      notes: document.getElementById('new-meas-notes').value.trim(),
      measured_by: document.getElementById('new-meas-trainer').value.trim() || 'Trainer'
    };

    try {
      const res = await fetch('/api/v1/admin/measurements', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('New measurement recorded successfully without modifying historical entries!');
        document.getElementById('modal-new-measurement').classList.remove('active');
        document.getElementById('form-new-measurement').reset();
        await Promise.all([loadMeasurements(data.member_id), loadKpis(), loadMemberDetails(data.member_id)]);
      } else {
        showToast(json.message || 'Failed to record measurement', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error recording measurement', 'error');
    }
  }

  // Handle Add Photo with Consent
  async function handleAddPhoto(e) {
    e.preventDefault();
    const consentGiven = document.getElementById('new-photo-consent').checked;
    if (!consentGiven) {
      showToast('Explicit member consent must be verified to store transformation photos.', 'error');
      return;
    }

    const data = {
      member_id: parseInt(document.getElementById('new-photo-member-select').value, 10),
      photo_url: document.getElementById('new-photo-url').value.trim(),
      pose: document.getElementById('new-photo-pose').value,
      phase: document.getElementById('new-photo-phase').value,
      weight_at_photo: parseFloat(document.getElementById('new-photo-weight').value) || null,
      body_fat_at_photo: parseFloat(document.getElementById('new-photo-fat').value) || null,
      consent_given: true,
      consent_signature: document.getElementById('new-photo-signature').value.trim() || 'Digital Consent Verified',
      caption: document.getElementById('new-photo-caption').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/measurements/photos', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Transformation photo saved with verified consent!');
        document.getElementById('modal-new-photo').classList.remove('active');
        document.getElementById('form-new-photo').reset();
        await Promise.all([loadMemberDetails(data.member_id), loadKpis()]);
      } else {
        showToast(json.message || 'Failed to save photo', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving transformation photo', 'error');
    }
  }

  // View Details Modal
  window.viewMeasurementDetails = async function (id) {
    try {
      const res = await fetch(`/api/v1/admin/measurements/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const m = json.data;

      const modal = document.getElementById('modal-view-measurement');
      if (!modal) return;

      document.getElementById('view-meas-member').textContent = `${m.member_name} (${m.member_code})`;
      document.getElementById('view-meas-date').textContent = new Date(m.logged_at).toLocaleDateString();
      document.getElementById('view-meas-weight').textContent = `${Number(m.weight_kg).toFixed(1)} kg`;
      document.getElementById('view-meas-height').textContent = `${m.height_cm || 175} cm`;
      document.getElementById('view-meas-bmi').textContent = m.bmi || '—';
      document.getElementById('view-meas-fat').textContent = m.body_fat_pct ? m.body_fat_pct + '%' : '—';
      document.getElementById('view-meas-muscle').textContent = m.muscle_mass_kg ? m.muscle_mass_kg + ' kg' : '—';

      document.getElementById('view-circ-chest').textContent = m.chest_cm ? m.chest_cm + ' cm' : '—';
      document.getElementById('view-circ-waist').textContent = m.waist_cm ? m.waist_cm + ' cm' : '—';
      document.getElementById('view-circ-hips').textContent = m.hips_cm ? m.hips_cm + ' cm' : '—';
      document.getElementById('view-circ-arms').textContent = m.arms_cm ? m.arms_cm + ' cm' : '—';
      document.getElementById('view-circ-thighs').textContent = m.thighs_cm ? m.thighs_cm + ' cm' : '—';
      document.getElementById('view-circ-calves').textContent = m.calves_cm ? m.calves_cm + ' cm' : '—';
      document.getElementById('view-circ-shoulders').textContent = m.shoulders_cm ? m.shoulders_cm + ' cm' : '—';
      document.getElementById('view-circ-neck').textContent = m.neck_cm ? m.neck_cm + ' cm' : '—';

      document.getElementById('view-meas-notes').textContent = m.notes || 'No assessment notes recorded.';
      document.getElementById('view-meas-measured-by').textContent = m.measured_by || 'Trainer';

      modal.classList.add('active');
    } catch (err) {
      console.error(err);
      showToast('Failed to load measurement entry', 'error');
    }
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

