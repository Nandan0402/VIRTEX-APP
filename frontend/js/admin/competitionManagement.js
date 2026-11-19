/**
 * Virtex Admin - Events and Fitness Competitions Controller
 * Manages athletic meets, rep challenges, scorecards, leaderboards, rankings, and award certificates.
 */

(function () {
  'use strict';

  // Global State
  let competitions = [];
  let participants = [];
  let certificates = [];
  let membersList = [];
  let trainersList = [];
  let kpisData = null;

  let currentTab = 'competitions';
  let activeTypeFilter = 'All';
  let activeStatusFilter = 'All';
  let selectedLeaderboardCompId = null;

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
    toast.className = `comp-toast toast-${type}`;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.background = type === 'success' ? '#11141e' : '#2b1111';
    toast.style.border = `1px solid ${type === 'success' ? '#ffd600' : '#ff5252'}`;
    toast.style.color = '#fff';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';
    toast.style.fontSize = '0.9rem';
    toast.innerHTML = `<span>${type === 'success' ? '🏆' : '⚠️'}</span> <span>${message}</span>`;
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
      loadCompetitions(),
      loadParticipants(),
      loadCertificates(),
      loadCertificateLogo(),
      loadKpis()
    ]);
  }

  // Fetch Members and Trainers for Select Dropdowns
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
    const selects = ['reg-comp-member-select', 'cert-member-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Member --</option>' +
          membersList.map(m => `<option value="${m.id}">${m.full_name || m.name} (${m.member_code || '#' + m.id})</option>`).join('');
      }
    });
  }

  function populateTrainerDropdowns() {
    let currentTrainerId = null;
    try {
      const stored = JSON.parse(localStorage.getItem('virtex_admin_user_profile') || 'null');
      if (stored && (stored.trainer_id || stored.role === 'trainer')) {
        currentTrainerId = stored.trainer_id || stored.id;
      }
    } catch { }

    const selects = ['new-comp-trainer-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Supervising Coach / Referee --</option>' +
          trainersList.map(t => `<option value="${t.id}" ${currentTrainerId && (String(t.id) === String(currentTrainerId) || String(t.user_id) === String(currentTrainerId)) ? 'selected' : ''}>${t.full_name || t.name} (${t.specialty || 'Trainer'})</option>`).join('');
      }
    });
  }

  // Tab Navigation
  function checkUrlHashTab() {
    const hash = window.location.hash.toLowerCase().replace('#', '');
    if (!hash) return;
    const tabMap = {
      'register': 'participants',
      'participants': 'participants',
      'brackets': 'leaderboard',
      'leaderboard': 'leaderboard',
      'awards': 'certificates',
      'certificates': 'certificates',
      'history': 'history',
      'competitions': 'competitions'
    };
    const target = tabMap[hash];
    if (target) {
      const btn = document.querySelector(`.comp-tab-btn[data-tab="${target}"]`);
      if (btn) btn.click();
    }
  }

  function setupTabListeners() {
    const tabs = document.querySelectorAll('.comp-tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.getAttribute('data-tab');

        document.querySelectorAll('.comp-tab-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById(`tab-${currentTab}`);
        if (target) target.style.display = 'block';

        if (currentTab === 'history') {
          renderPastHistory();
        }
      });
    });

    window.addEventListener('hashchange', checkUrlHashTab);
    checkUrlHashTab();
  }

  // Filters & Search
  function setupFilterListeners() {
    const typeFilter = document.getElementById('filter-comp-type');
    if (typeFilter) {
      typeFilter.addEventListener('change', (e) => {
        activeTypeFilter = e.target.value;
        loadCompetitions();
      });
    }

    const statusFilter = document.getElementById('filter-comp-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        activeStatusFilter = e.target.value;
        loadCompetitions();
      });
    }

    const searchInput = document.getElementById('comp-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderCompetitions();
      });
    }

    // Status chips drive the (hidden) status filter
    document.getElementById('ev-status-chips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-status]'); if (!chip) return;
      setStatusChip(chip.dataset.status);
    });
    // View (cards / list) and sort — remembered in this browser
    document.getElementById('ev-sort')?.addEventListener('change', (e) => { viewPrefs.sort = e.target.value; saveViewPrefs(); renderCompetitions(); });
    document.querySelectorAll('.ev-view [data-view]').forEach((b) => b.addEventListener('click', () => { viewPrefs.view = b.dataset.view; saveViewPrefs(); applyViewPrefs(); renderCompetitions(); }));
    // Quick stats jump to the right place
    document.querySelectorAll('[data-ev-go]').forEach((b) => b.addEventListener('click', () => {
      const go = b.dataset.evGo;
      if (go === 'participants' || go === 'certificates') { document.querySelector(`.comp-tab-btn[data-tab="${go}"]`)?.click(); return; }
      document.querySelector('.comp-tab-btn[data-tab="competitions"]')?.click();
      setStatusChip(go === 'live' ? 'in_progress' : 'All');
    }));
    applyViewPrefs();

    const lbCompSelect = document.getElementById('leaderboard-comp-select');
    if (lbCompSelect) {
      lbCompSelect.addEventListener('change', (e) => {
        selectedLeaderboardCompId = e.target.value;
        if (selectedLeaderboardCompId) {
          loadLeaderboard(selectedLeaderboardCompId);
        }
      });
    }
  }

  // ---------- View preferences (per browser) ----------
  const VIEW_KEY = 'virtex_events_view';
  let viewPrefs = { view: 'grid', sort: 'start_desc' };
  try { viewPrefs = { ...viewPrefs, ...(JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')) }; } catch { /* default view */ }
  function saveViewPrefs() { try { localStorage.setItem(VIEW_KEY, JSON.stringify(viewPrefs)); } catch { /* not saved */ } }
  function applyViewPrefs() {
    const grid = document.getElementById('competitions-grid-container');
    if (grid) grid.classList.toggle('comp-list', viewPrefs.view === 'list');
    document.querySelectorAll('.ev-view [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === viewPrefs.view)));
    const sort = document.getElementById('ev-sort'); if (sort) sort.value = viewPrefs.sort;
  }
  function setStatusChip(status) {
    document.querySelectorAll('#ev-status-chips [data-status]').forEach((c) => {
      const on = c.dataset.status === status; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on));
    });
    const sel = document.getElementById('filter-comp-status');
    if (sel && sel.value !== status) { sel.value = status; sel.dispatchEvent(new Event('change')); }
  }
  // Type filter: the standard types plus every custom type you have used
  const BASE_TYPES = ['Outdoor Games', 'Weightlifting', 'Push-Up Challenge', 'Pull-Up Challenge', 'Squat Challenge', 'Monthly Challenge', 'Transformation', 'General Event'];
  const knownTypes = new Set(BASE_TYPES);
  function refreshTypeFilter() {
    competitions.forEach((c) => c.type && knownTypes.add(c.type));
    const sel = document.getElementById('filter-comp-type'); if (!sel) return;
    const cur = sel.value || 'All';
    sel.innerHTML = '<option value="All">All types</option>' + [...knownTypes].sort((a, b) => a.localeCompare(b))
      .map((ty) => `<option value="${escapeHtml(ty)}">${escapeHtml(ty)}</option>`).join('');
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'All';
  }
  function sortCompetitions(list) {
    const by = viewPrefs.sort;
    const copy = [...list];
    if (by === 'name') copy.sort((a, b) => a.title.localeCompare(b.title));
    else if (by === 'participants') copy.sort((a, b) => Number(b.participants_count || 0) - Number(a.participants_count || 0));
    else if (by === 'start_asc') copy.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    else copy.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
    return copy;
  }

  // API Callers
  async function loadCompetitions() {
    try {
      let url = '/api/v1/admin/competitions?';
      if (activeTypeFilter !== 'All') url += `type=${encodeURIComponent(activeTypeFilter)}&`;
      if (activeStatusFilter !== 'All') url += `status=${encodeURIComponent(activeStatusFilter)}&`;

      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        competitions = json.data || [];
        const badge = document.getElementById('badge-comp-count');
        if (badge) badge.textContent = competitions.length;
        refreshTypeFilter();
        renderCompetitions();
        populateCompetitionDropdowns();
      }
    } catch (err) {
      console.error('Failed to load competitions:', err);
    }
  }

  function populateCompetitionDropdowns() {
    const selects = ['reg-comp-select', 'leaderboard-comp-select', 'cert-comp-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Competition --</option>' +
          competitions.map(c => `<option value="${c.id}">${escapeHtml(c.title)} (${escapeHtml(c.type)})</option>`).join('');
      }
    });

    if (competitions.length > 0 && !selectedLeaderboardCompId) {
      selectedLeaderboardCompId = competitions[0].id;
      const lbSelect = document.getElementById('leaderboard-comp-select');
      if (lbSelect) lbSelect.value = selectedLeaderboardCompId;
      loadLeaderboard(selectedLeaderboardCompId);
    }
  }

  async function loadParticipants() {
    try {
      const res = await fetch('/api/v1/admin/competitions/participants/all', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        participants = json.data || [];
        const badge = document.getElementById('badge-participants-count');
        if (badge) badge.textContent = participants.length;
        renderParticipants();
      }
    } catch (err) {
      console.error('Failed to load participants:', err);
    }
  }

  async function loadLeaderboard(compId) {
    try {
      const res = await fetch(`/api/v1/admin/competitions/${compId}/leaderboard`, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        renderLeaderboard(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    }
  }

  // ---------- Gym logo on certificates (shown next to the VIRTEX logo) ----------
  const VIRTEX_LOGO = '/assets/brand/virtex-mark.svg';
  let certLogoUrl = null;

  async function loadCertificateLogo() {
    try {
      const res = await fetch('/api/v1/admin/competitions/certificate-logo', { headers: getAuthHeaders() });
      const json = await res.json();
      certLogoUrl = res.ok ? (json.data?.url || null) : null;
    } catch { certLogoUrl = null; }
    renderLogoSlots();
  }

  function renderLogoSlots() {
    document.querySelectorAll('[data-cls-gym] .cls-preview').forEach((el) => {
      el.innerHTML = certLogoUrl ? `<img src="${escapeHtml(certLogoUrl)}" alt="Gym logo">` : '<span class="cls-empty">No gym logo yet</span>';
    });
    document.querySelectorAll('[data-cls-remove]').forEach((b) => { b.hidden = !certLogoUrl; });
    document.querySelectorAll('[data-cls-upload]').forEach((b) => { b.textContent = certLogoUrl ? (b.closest('.cls-actions') ? '🔄 Change logo' : '🖼️ Change gym logo') : (b.closest('.cls-actions') ? '⬆️ Upload logo' : '🖼️ Add gym logo'); });
    const st = document.getElementById('cls-tab-status');
    if (st) st.innerHTML = certLogoUrl ? `<img src="${escapeHtml(certLogoUrl)}" alt="">Gym logo on certificates` : 'No gym logo yet — certificates show the VIRTEX logo only';
  }

  async function uploadCertificateLogo(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { showToast('Choose a PNG, JPG or WebP image.', 'error'); return; }
    if (file.size > 2 * 1024 * 1024) { showToast('The logo must be 2 MB or smaller.', 'error'); return; }
    const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
    try {
      const res = await fetch('/api/v1/admin/competitions/certificate-logo', { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ image: dataUrl }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || json.message || 'Could not save the logo.');
      certLogoUrl = json.data?.url || null;
      renderLogoSlots(); renderCertificates();
      showToast('Gym logo saved — it now appears on every certificate.');
    } catch (err) { showToast(err.message || 'Could not save the logo.', 'error'); }
  }

  async function removeCertificateLogo() {
    if (!window.confirm('Remove your gym logo from all certificates? The VIRTEX logo stays.')) return;
    try {
      const res = await fetch('/api/v1/admin/competitions/certificate-logo', { method: 'DELETE', headers: getAuthHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || json.message || 'Could not remove the logo.');
      certLogoUrl = null;
      renderLogoSlots(); renderCertificates();
      showToast('Gym logo removed.');
    } catch (err) { showToast(err.message || 'Could not remove the logo.', 'error'); }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-cls-upload]')) { e.preventDefault(); document.getElementById('cert-logo-file')?.click(); }
    else if (e.target.closest('[data-cls-remove]')) { e.preventDefault(); removeCertificateLogo(); }
    else if (e.target.closest('[data-cert-print]')) { e.preventDefault(); printCertificate(Number(e.target.closest('[data-cert-print]').dataset.certPrint)); }
  });
  document.getElementById('cert-logo-file')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ''; // allow choosing the same file again
    uploadCertificateLogo(f);
  });

  const certLogosHtml = () => `<div class="cert-logos">
      ${certLogoUrl ? `<img class="cert-logo-gym" src="${escapeHtml(certLogoUrl)}" alt="Gym logo">` : '<span></span>'}
      <img class="cert-logo-virtex" src="${VIRTEX_LOGO}" alt="VIRTEX">
    </div>`;

  /** Print-friendly certificate in a new window (Print → "Save as PDF" works too). */
  function printCertificate(id) {
    const c = certificates.find((x) => x.id === id);
    if (!c) return;
    const w = window.open('', '_blank', 'width=1000,height=720');
    if (!w) { showToast('Allow pop-ups to print the certificate.', 'error'); return; }
    const abs = (u) => new URL(u, window.location.origin).href;
    const rank = c.rank_awarded ? ['', '1st Place', '2nd Place', '3rd Place', '4th Place', '5th Place'][c.rank_awarded] || `Rank ${c.rank_awarded}` : '';
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Certificate — ${escapeHtml(c.member_name)}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #1f2937; background: #fff; }
        .sheet { border: 6px double #b8860b; padding: 28px 44px; min-height: 175mm; display: flex; flex-direction: column; align-items: center; text-align: center; position: relative; }
        .logos { width: 100%; display: flex; justify-content: space-between; align-items: center; height: 84px; }
        .logos img { max-height: 84px; max-width: 220px; object-fit: contain; }
        .org { letter-spacing: 4px; text-transform: uppercase; color: #b8860b; font: 700 14px Arial, sans-serif; margin-top: 8px; }
        h1 { font-size: 40px; margin: 10px 0 4px; letter-spacing: 2px; }
        .muted { color: #6b7280; font-size: 17px; margin: 14px 0 4px; }
        .name { font-size: 44px; color: #8b6508; margin: 6px 0; font-style: italic; }
        .award { font-size: 24px; margin: 6px 0; }
        .rank { display: inline-block; margin-top: 6px; padding: 4px 14px; border: 1px solid #b8860b; border-radius: 999px; font: 700 13px Arial, sans-serif; color: #8b6508; }
        .foot { margin-top: auto; width: 100%; display: flex; justify-content: space-between; font: 12px 'Courier New', monospace; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 10px; }
      </style></head><body>
      <div class="sheet">
        <div class="logos">${certLogoUrl ? `<img src="${escapeHtml(abs(certLogoUrl))}" alt="Gym logo">` : '<span></span>'}<img src="${abs(VIRTEX_LOGO)}" alt="VIRTEX"></div>
        <div class="org">${escapeHtml(c.issued_by || 'Virtex Athletics')}</div>
        <h1>CERTIFICATE OF EXCELLENCE</h1>
        <div class="muted">This certifies that</div>
        <div class="name">${escapeHtml(c.member_name)}</div>
        <div class="muted">has successfully achieved</div>
        <div class="award">“${escapeHtml(c.award_title)}”</div>
        <div class="muted">in the <strong>${escapeHtml(c.competition_title)}</strong></div>
        ${rank ? `<div class="rank">${escapeHtml(rank)}</div>` : ''}
        <div class="foot"><span>Code: ${escapeHtml(c.certificate_code)}</span><span>Issued: ${escapeHtml(new Date(c.issued_at).toLocaleDateString())}</span></div>
      </div>
      <script>
        const imgs = [...document.images];
        Promise.all(imgs.map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => window.print(), 150));
      <\/script></body></html>`);
    w.document.close();
  }

  async function loadCertificates() {
    try {
      const res = await fetch('/api/v1/admin/competitions/certificates/all', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        certificates = json.data || [];
        const badge = document.getElementById('badge-certs-count');
        if (badge) badge.textContent = certificates.length;
        renderCertificates();
      }
    } catch (err) {
      console.error('Failed to load certificates:', err);
    }
  }

  async function loadKpis() {
    try {
      const res = await fetch('/api/v1/admin/competitions/kpis/summary', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        kpisData = json.data || null;
        renderKpis();
      }
    } catch (err) {
      console.error('Failed to load competition KPIs:', err);
    }
  }

  // Render Functions
  function renderKpis() {
    if (!kpisData) return;
    const { totalCompetitions, activeCompetitions, liveCompetitions, totalParticipants, totalCertificatesIssued } = kpisData;

    const actEl = document.getElementById('kpi-active-comps');
    if (actEl) actEl.textContent = (liveCompetitions ?? activeCompetitions) || 0; // "Live now" = in progress

    const totEl = document.getElementById('kpi-total-comps');
    if (totEl) totEl.textContent = totalCompetitions || 0;

    const partEl = document.getElementById('kpi-total-participants');
    if (partEl) partEl.textContent = totalParticipants || 0;

    const certEl = document.getElementById('kpi-total-certs');
    if (certEl) certEl.textContent = totalCertificatesIssued || 0;
  }

  function renderCompetitions() {
    const grid = document.getElementById('competitions-grid-container');
    if (!grid) return;

    const search = document.getElementById('comp-search-input')?.value.toLowerCase() || '';
    let filtered = competitions;
    if (search) {
      filtered = filtered.filter(c => c.title.toLowerCase().includes(search) || c.description.toLowerCase().includes(search));
    }

    filtered = sortCompetitions(filtered);
    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🏆</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No competitions here yet</h3>
          <p style="color: #64748b; font-size: 0.9rem; margin-bottom: 12px;">Try another filter, or create one.</p>
          <button type="button" class="btn btn-green btn-sm" onclick="document.getElementById('btn-open-comp-modal').click()">+ New competition</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(c => {
      let statusClass = 'status-upcoming';
      if (c.status === 'in_progress') statusClass = 'status-in_progress';
      else if (c.status === 'completed') statusClass = 'status-completed';

      return `
        <div class="comp-card">
          <div class="comp-banner-wrap">
            <span class="comp-banner-icon" aria-hidden="true">${c.icon ? escapeHtml(c.icon) : autoCompIcon(c.type)}</span>
            ${c.banner_url ? `<img src="${escapeHtml(c.banner_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
            <span class="comp-status-badge ${statusClass}">${c.status.replace('_', ' ')}</span>
            <span class="comp-type-badge">${escapeHtml(c.type)}</span>
          </div>
          <div class="comp-body">
            <h3 class="comp-title">${escapeHtml(c.title)}</h3>
            <p class="comp-desc">${escapeHtml(c.description)}</p>

            ${c.prize_pool ? `
              <div class="comp-prize-box">
                <span>🎁</span>
                <span><strong>Prize Pool:</strong> ${escapeHtml(c.prize_pool)}</span>
              </div>
            ` : ''}

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #0b0d14; padding: 10px; border-radius: 6px; margin-bottom: 14px; font-size: 0.8rem; font-family: 'JetBrains Mono', monospace;">
              <div>
                <span style="color: #64748b;">Metric:</span> <strong style="color: #00e676;">${escapeHtml(c.metric_type)}</strong>
              </div>
              <div>
                <span style="color: #64748b;">Registered:</span> <strong style="color: #ffd600;">${c.participants_count || 0}</strong>
              </div>
              <div>
                <span style="color: #64748b;">Starts:</span> <span style="color: #fff;">${new Date(c.start_date).toLocaleDateString()}</span>
              </div>
              <div>
                <span style="color: #64748b;">Ends:</span> <span style="color: #fff;">${new Date(c.end_date).toLocaleDateString()}</span>
              </div>
            </div>

            <div style="display: flex; gap: 8px; margin-top: auto;">
              <button class="btn btn-outline" style="flex: 1; padding: 8px 12px; font-size: 0.82rem;" onclick="window.viewLeaderboardForComp(${c.id})">
                Leaderboard 📊
              </button>
              <button class="btn btn-green" style="padding: 8px 14px; font-size: 0.82rem;" onclick="window.openRegisterModal(${c.id})">
                + Register
              </button>
            </div>
            <div class="comp-manage">
              <button type="button" class="btn btn-outline btn-xs" onclick="window.editCompetition(${c.id})" aria-label="Edit ${escapeHtml(c.title)}">✏️ Edit</button>
              <button type="button" class="btn btn-outline btn-xs comp-del-btn" onclick="window.deleteCompetition(${c.id})" aria-label="Delete ${escapeHtml(c.title)}">🗑️ Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderParticipants() {
    const tbody = document.getElementById('participants-table-body');
    if (!tbody) return;

    if (participants.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No participant registrations found. Click "Register Lifter" to add competitors.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = participants.map(p => {
      let statusClass = p.status === 'completed' ? 'badge-green' : (p.status === 'checked_in' ? 'badge-blue' : 'badge-gold');

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: #fff;">${escapeHtml(p.member_name)}</div>
            <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(p.member_code)}</div>
          </td>
          <td>
            <div style="font-weight: 600; color: #ffd600;">${escapeHtml(p.competition_title)}</div>
            <div style="font-size: 0.75rem; color: #94a3b8;">Division: ${escapeHtml(p.division || 'Open')}</div>
          </td>
          <td>
            <span class="badge ${statusClass}" style="text-transform: capitalize;">${escapeHtml(p.status)}</span>
          </td>
          <td>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; font-weight: 800; color: #00e676;">
              ${p.score !== null ? Number(p.score).toFixed(1) + ' ' + (p.score_unit || '') : 'Pending Attempt'}
            </div>
            ${p.rank_position ? `<div style="font-size: 0.75rem; color: #ffd600;">Rank #${p.rank_position} ${p.is_winner ? '🏆 PODIUM' : ''}</div>` : ''}
          </td>
          <td>
            <span style="font-size: 0.82rem; color: #cbd5e1;">${escapeHtml(p.verified_by_trainer_name || 'Assigned Judge')}</span>
          </td>
          <td>
            <span style="font-size: 0.8rem; color: #94a3b8;">${escapeHtml(p.trainer_notes || '—')}</span>
          </td>
          <td>
            <button class="btn btn-outline btn-xs" onclick="window.openSubmitScoreModal(${p.id}, '${escapeHtml(p.member_name)}', '${escapeHtml(p.score_unit || 'reps')}')">
              Record Score ⏱️
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderLeaderboard(data) {
    const tbody = document.getElementById('leaderboard-table-body');
    if (!tbody) return;

    if (data.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No official attempts verified for this competition yet.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data.map((item, idx) => {
      let podiumClass = '';
      let medalHtml = `<span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #64748b;">#${idx + 1}</span>`;

      if (idx === 0) {
        podiumClass = 'podium-rank-1';
        medalHtml = '<span class="rank-medal">🥇</span>';
      } else if (idx === 1) {
        podiumClass = 'podium-rank-2';
        medalHtml = '<span class="rank-medal">🥈</span>';
      } else if (idx === 2) {
        podiumClass = 'podium-rank-3';
        medalHtml = '<span class="rank-medal">🥉</span>';
      }

      return `
        <tr class="${podiumClass}">
          <td style="text-align: center; width: 60px;">${medalHtml}</td>
          <td>
            <div style="font-weight: 700; color: #fff;">${escapeHtml(item.member_name)}</div>
            <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(item.member_code)}</div>
          </td>
          <td>
            <span class="circ-badge">${escapeHtml(item.division || 'Open')}</span>
          </td>
          <td>
            <span style="font-family: 'JetBrains Mono', monospace; font-size: 1.1rem; font-weight: 800; color: #00e676;">
              ${Number(item.score).toFixed(1)} ${escapeHtml(item.score_unit || '')}
            </span>
          </td>
          <td>
            <span style="font-size: 0.8rem; color: #94a3b8;">${escapeHtml(item.trainer_notes || 'Verified attempt.')}</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderCertificates() {
    const container = document.getElementById('certificates-container');
    if (!container) return;

    if (certificates.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🎖️</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No award certificates issued yet</h3>
          <p style="color: #64748b; font-size: 0.9rem;">Click "+ Issue Award Certificate" to reward competition winners.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = certificates.map(c => `
      <div class="certificate-card">
        <div class="certificate-watermark">🏆</div>
        ${certLogosHtml()}
        <div class="cert-header">
          <div class="cert-org">${escapeHtml(c.issued_by || 'VIRTEX ATHLETICS')}</div>
          <h3 class="cert-title">CERTIFICATE OF EXCELLENCE</h3>
        </div>
        <div style="text-align: center; font-size: 0.85rem; color: #94a3b8;">This certifies that</div>
        <div class="cert-recipient-name">${escapeHtml(c.member_name)}</div>
        <div style="text-align: center; font-size: 0.85rem; color: #94a3b8;">has successfully achieved</div>
        <div class="cert-award-title">"${escapeHtml(c.award_title)}"</div>
        <div style="text-align: center; font-size: 0.85rem; color: #00e676; margin-bottom: 14px;">
          in the <strong>${escapeHtml(c.competition_title)}</strong>
        </div>
        <div class="cert-footer">
          <div>
            <span>Code: </span><strong>${escapeHtml(c.certificate_code)}</strong>
          </div>
          <div>
            <span>Issued: </span><span>${new Date(c.issued_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div class="cert-actions"><button type="button" class="btn btn-outline btn-xs" data-cert-print="${c.id}">🖨️ Print / Save as PDF</button></div>
      </div>
    `).join('');
  }

  function renderPastHistory() {
    const container = document.getElementById('previous-events-container');
    if (!container) return;

    const completed = competitions.filter(c => c.status === 'completed');
    if (completed.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; background: #11141e; border-radius: 10px; border: 1px dashed #1e2433; color: #64748b;">
          No completed historical competitions archived yet.
        </div>
      `;
      return;
    }

    container.innerHTML = completed.map(c => `
      <div class="admin-card" style="background: #11141e; border: 1px solid #1e2433; border-radius: 10px; padding: 18px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <span class="comp-type-badge" style="position: static; margin-right: 8px;">${escapeHtml(c.type)}</span>
            <strong style="color: #fff; font-size: 1.1rem;">${escapeHtml(c.title)}</strong>
          </div>
          <span class="badge badge-green">COMPLETED</span>
        </div>
        <p style="font-size: 0.85rem; color: #94a3b8; margin: 0 0 10px 0;">${escapeHtml(c.description)}</p>
        <div style="display: flex; gap: 14px; font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; color: #cbd5e1;">
          <span>Finished: <strong>${new Date(c.end_date).toLocaleDateString()}</strong></span>
          <span>Competitors: <strong style="color: #ffd600;">${c.participants_count || 0}</strong></span>
          <span>Podium Winners: <strong style="color: #00e676;">${c.winners_count || 0}</strong></span>
        </div>
      </div>
    `).join('');
  }

  // Modals & User Actions
  function setupModalListeners() {
    // Open New Competition Modal
    const btnNewComp = document.getElementById('btn-open-comp-modal');
    if (btnNewComp) {
      btnNewComp.addEventListener('click', () => openCompetitionForm(null));
    }

    // Open Register Member Modal
    const btnRegister = document.getElementById('btn-open-register-modal');
    if (btnRegister) {
      btnRegister.addEventListener('click', () => {
        document.getElementById('modal-register-participant').classList.add('active');
      });
    }

    // Open Issue Certificate Modal
    const btnIssueCert = document.getElementById('btn-open-cert-modal');
    if (btnIssueCert) {
      btnIssueCert.addEventListener('click', () => {
        document.getElementById('modal-issue-certificate').classList.add('active');
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
    const formComp = document.getElementById('form-new-competition');
    if (formComp) formComp.addEventListener('submit', handleCreateCompetition);

    const formReg = document.getElementById('form-register-participant');
    if (formReg) formReg.addEventListener('submit', handleRegisterParticipant);

    const formScore = document.getElementById('form-submit-score');
    if (formScore) formScore.addEventListener('submit', handleSubmitScore);

    const formCert = document.getElementById('form-issue-certificate');
    if (formCert) formCert.addEventListener('submit', handleIssueCertificate);
  }

  // Handle Create Competition
  // ---------- Create / edit / delete competitions (custom type & metric, outdoor-sport details) ----------
  let editingCompId = null;
  const $id = (id) => document.getElementById(id);
  const optionValues = (sel) => [...$id(sel).options].map((o) => o.value);

  function syncCompForm() {
    const typeCustom = $id('new-comp-type').value === '__custom';
    $id('new-comp-type-custom').hidden = !typeCustom;
    $id('new-comp-type-custom').required = typeCustom;
    const metricCustom = $id('new-comp-metric').value === '__custom';
    $id('new-comp-metric-custom').hidden = !metricCustom;
    $id('new-comp-metric-custom').required = metricCustom;
    const outdoor = $id('new-comp-type').value === 'Outdoor Games';
    const panel = $id('comp-outdoor-custom-fields');
    if (panel) panel.style.display = outdoor ? 'block' : 'none';
    const customSport = $id('outdoor-sport-select')?.value === 'Custom Sport';
    const csWrap = $id('outdoor-custom-sport-wrap');
    if (csWrap) csWrap.style.display = outdoor && customSport ? 'block' : 'none';
    if ($id('outdoor-venue')) $id('outdoor-venue').required = outdoor;
    if ($id('outdoor-custom-sport-name')) $id('outdoor-custom-sport-name').required = outdoor && customSport;
  }
  ['new-comp-type', 'new-comp-metric', 'outdoor-sport-select'].forEach((id) => $id(id)?.addEventListener('change', syncCompForm));

  /** Icon used when the admin has not chosen one (based on the competition type). */
  function autoCompIcon(type) {
    const t = type || '';
    return /push|pull|rep/i.test(t) ? '💪' : /weight|power|lift/i.test(t) ? '🏋️' : /transform|physique/i.test(t) ? '🔥' : /outdoor/i.test(t) ? '⚽' : '🏆';
  }
  function currentType() { return $id('new-comp-type').value === '__custom' ? $id('new-comp-type-custom').value : $id('new-comp-type').value; }
  /** Select an icon in the picker ('' = automatic). */
  function setCompIcon(icon) {
    const v = (icon || '').trim();
    $id('new-comp-icon').value = v;
    let matched = false;
    document.querySelectorAll('#ci-grid .ci-opt').forEach((b) => {
      const on = b.dataset.icon === v;
      if (on) matched = true;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (!matched && v) $id('ci-custom-input').value = v; else if (matched) $id('ci-custom-input').value = '';
    $id('ci-preview').textContent = v || autoCompIcon(currentType());
    $id('ci-preview').title = v ? 'Chosen icon' : 'Automatic icon (from the competition type)';
  }
  $id('ci-grid')?.addEventListener('click', (e) => {
    const b = e.target.closest('.ci-opt'); if (!b) return;
    setCompIcon(b.dataset.icon);
  });
  $id('ci-custom-input')?.addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (/[A-Za-z0-9<>"'`&]/.test(v)) { e.target.setCustomValidity('Paste an emoji (no letters or numbers).'); return; }
    e.target.setCustomValidity('');
    $id('new-comp-icon').value = v;
    document.querySelectorAll('#ci-grid .ci-opt').forEach((b) => { const on = v === '' ? b.dataset.icon === '' : b.dataset.icon === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $id('ci-preview').textContent = v || autoCompIcon(currentType());
  });
  ['new-comp-type', 'new-comp-type-custom'].forEach((id) => $id(id)?.addEventListener('input', () => { if (!$id('new-comp-icon').value) $id('ci-preview').textContent = autoCompIcon(currentType()); }));
  ['new-comp-type'].forEach((id) => $id(id)?.addEventListener('change', () => { if (!$id('new-comp-icon').value) $id('ci-preview').textContent = autoCompIcon(currentType()); }));

  /** Open the competition form empty (create) or filled with an existing competition (edit). */
  function openCompetitionForm(comp) {
    const form = $id('form-new-competition');
    form.reset();
    editingCompId = comp ? comp.id : null;
    $id('comp-modal-title').textContent = comp ? '✏️ Edit competition' : '🏆 Create Gym Competition / Challenge';
    $id('comp-submit-btn').textContent = comp ? 'Save changes' : 'Launch Competition 🚀';
    $id('comp-status-wrap').hidden = !comp;
    if (comp) {
      const d = (v) => (v ? String(v).slice(0, 10) : '');
      $id('new-comp-title').value = comp.title || '';
      if (optionValues('new-comp-type').includes(comp.type)) $id('new-comp-type').value = comp.type;
      else { $id('new-comp-type').value = '__custom'; $id('new-comp-type-custom').value = comp.type || ''; }
      if (optionValues('new-comp-metric').includes(comp.metric_type)) $id('new-comp-metric').value = comp.metric_type;
      else { $id('new-comp-metric').value = '__custom'; $id('new-comp-metric-custom').value = comp.metric_type || ''; }
      $id('new-comp-desc').value = comp.description || '';
      $id('new-comp-start-date').value = d(comp.start_date);
      $id('new-comp-end-date').value = d(comp.end_date);
      $id('new-comp-deadline').value = d(comp.registration_deadline);
      $id('new-comp-trainer-select').value = comp.organizer_trainer_id ? String(comp.organizer_trainer_id) : '';
      $id('new-comp-prize').value = comp.prize_pool || '';
      $id('new-comp-rules').value = comp.rules || '';
      $id('new-comp-banner').value = comp.banner_url || '';
      $id('new-comp-status').value = comp.status || 'upcoming';
      const o = comp.outdoor_details || {};
      if ($id('outdoor-sport-select')) {
        if (o.sport && optionValues('outdoor-sport-select').includes(o.sport)) $id('outdoor-sport-select').value = o.sport;
        else if (o.sport) { $id('outdoor-sport-select').value = 'Custom Sport'; $id('outdoor-custom-sport-name').value = o.sport; }
        $id('outdoor-venue').value = o.venue || '';
        if (o.team_format) $id('outdoor-team-format').value = o.team_format;
        if (o.max_teams) $id('outdoor-max-teams').value = o.max_teams;
        if (o.players_per_team) $id('outdoor-players-per-team').value = o.players_per_team;
        $id('outdoor-equipment').value = o.equipment || '';
        $id('outdoor-weather-plan').value = o.weather_plan || '';
      }
    }
    syncCompForm();
    $id('ci-custom-input').value = '';
    setCompIcon(comp ? (comp.icon || '') : '');
    $id('modal-new-competition').classList.add('active');
    $id('new-comp-title').focus();
  }

  function competitionFormData() {
    const type = $id('new-comp-type').value === '__custom' ? $id('new-comp-type-custom').value.trim() : $id('new-comp-type').value;
    const metric = $id('new-comp-metric').value === '__custom' ? $id('new-comp-metric-custom').value.trim() : $id('new-comp-metric').value;
    const data = {
      title: $id('new-comp-title').value.trim(),
      type,
      description: $id('new-comp-desc').value.trim(),
      metric_type: metric,
      start_date: $id('new-comp-start-date').value,
      end_date: $id('new-comp-end-date').value,
      registration_deadline: $id('new-comp-deadline').value || null,
      organizer_trainer_id: $id('new-comp-trainer-select').value || null,
      prize_pool: $id('new-comp-prize').value.trim(),
      rules: $id('new-comp-rules').value.trim(),
      banner_url: $id('new-comp-banner').value.trim(),
    };
    data.icon = $id('new-comp-icon').value || null;
    if (editingCompId) data.status = $id('new-comp-status').value;
    if (type === 'Outdoor Games' && $id('outdoor-sport-select')) {
      const sport = $id('outdoor-sport-select').value === 'Custom Sport' ? $id('outdoor-custom-sport-name').value.trim() : $id('outdoor-sport-select').value;
      data.outdoor_details = {
        sport, venue: $id('outdoor-venue').value.trim(), team_format: $id('outdoor-team-format').value,
        max_teams: Number($id('outdoor-max-teams').value) || null, players_per_team: Number($id('outdoor-players-per-team').value) || null,
        equipment: $id('outdoor-equipment').value.trim(), weather_plan: $id('outdoor-weather-plan').value.trim(),
      };
    }
    return data;
  }

  window.editCompetition = function (id) {
    const comp = competitions.find((c) => c.id === id);
    if (comp) openCompetitionForm(comp);
  };

  window.deleteCompetition = function (id) {
    const comp = competitions.find((c) => c.id === id);
    if (!comp) return;
    const certs = certificates.filter((c) => c.competition_id === id || c.competition_title === comp.title).length;
    const regs = Number(comp.participants_count || 0);
    $id('del-comp-id').value = id;
    $id('del-comp-name').textContent = comp.title;
    $id('del-comp-participants').textContent = `${regs} registration${regs === 1 ? '' : 's'}`;
    $id('del-comp-certs').textContent = `${certs} certificate${certs === 1 ? '' : 's'}`;
    $id('del-comp-confirm').value = '';
    $id('del-comp-btn').disabled = true;
    $id('modal-delete-competition').classList.add('active');
    $id('del-comp-confirm').focus();
  };
  $id('del-comp-confirm')?.addEventListener('input', (e) => { $id('del-comp-btn').disabled = e.target.value.trim().toUpperCase() !== 'DELETE'; });
  $id('form-delete-competition')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($id('del-comp-confirm').value.trim().toUpperCase() !== 'DELETE') return;
    const btn = $id('del-comp-btn'); btn.disabled = true;
    try {
      const res = await fetch(`/api/v1/admin/competitions/${encodeURIComponent($id('del-comp-id').value)}`, { method: 'DELETE', headers: getAuthHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || json.error || 'Could not delete the competition.');
      $id('modal-delete-competition').classList.remove('active');
      showToast(`🗑️ ${json.message}`);
      await Promise.all([loadCompetitions(), loadParticipants(), loadCertificates(), loadKpis()]);
    } catch (err) {
      showToast(err.message || 'Could not delete the competition.', 'error');
      btn.disabled = false;
    }
  });

  async function handleCreateCompetition(e) {
    e.preventDefault();
    const data = competitionFormData();
    if (!data.type || !data.metric_type) { showToast('Type your own competition type and metric, or pick one from the list.', 'error'); return; }
    if (data.end_date && data.start_date && data.end_date < data.start_date) { showToast('End date cannot be before the start date.', 'error'); return; }
    const editing = editingCompId;

    try {
      const res = await fetch(editing ? `/api/v1/admin/competitions/${editing}` : '/api/v1/admin/competitions', {
        method: editing ? 'PUT' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast(editing ? 'Competition updated.' : 'Fitness competition created successfully!');
        document.getElementById('modal-new-competition').classList.remove('active');
        document.getElementById('form-new-competition').reset();
        editingCompId = null;
        await Promise.all([loadCompetitions(), loadKpis(), loadCertificates()]);
      } else {
        showToast(json.message || 'Failed to save competition', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving competition', 'error');
    }
  }

  // Handle Register Participant
  async function handleRegisterParticipant(e) {
    e.preventDefault();
    const data = {
      competition_id: parseInt(document.getElementById('reg-comp-select').value, 10),
      member_id: parseInt(document.getElementById('reg-comp-member-select').value, 10),
      division: document.getElementById('reg-comp-division').value,
      score_unit: document.getElementById('reg-comp-unit').value
    };

    try {
      const res = await fetch('/api/v1/admin/competitions/participants', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Member enrolled in competition!');
        document.getElementById('modal-register-participant').classList.remove('active');
        document.getElementById('form-register-participant').reset();
        await Promise.all([loadParticipants(), loadCompetitions(), loadKpis()]);
      } else {
        showToast(json.message || 'Failed to register member', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error enrolling competitor', 'error');
    }
  }

  // Handle Submit Score
  let activeScoringParticipantId = null;
  async function handleSubmitScore(e) {
    e.preventDefault();
    if (!activeScoringParticipantId) return;

    const data = {
      score: parseFloat(document.getElementById('score-input-value').value),
      notes: document.getElementById('score-input-notes').value.trim()
    };

    try {
      const res = await fetch(`/api/v1/admin/competitions/participants/${activeScoringParticipantId}/score`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Score verified and leaderboard re-ranked!');
        document.getElementById('modal-submit-score').classList.remove('active');
        document.getElementById('form-submit-score').reset();
        await Promise.all([
          loadParticipants(),
          selectedLeaderboardCompId ? loadLeaderboard(selectedLeaderboardCompId) : Promise.resolve()
        ]);
      } else {
        showToast(json.message || 'Failed to submit score', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error recording score', 'error');
    }
  }

  // Handle Issue Certificate
  async function handleIssueCertificate(e) {
    e.preventDefault();
    const data = {
      competition_id: parseInt(document.getElementById('cert-comp-select').value, 10),
      member_id: parseInt(document.getElementById('cert-member-select').value, 10),
      award_title: document.getElementById('cert-award-title').value.trim(),
      rank_awarded: parseInt(document.getElementById('cert-rank').value, 10) || null
    };

    try {
      const res = await fetch('/api/v1/admin/competitions/certificates', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Verifiable award certificate generated!');
        document.getElementById('modal-issue-certificate').classList.remove('active');
        document.getElementById('form-issue-certificate').reset();
        await Promise.all([loadCertificates(), loadKpis()]);
      } else {
        showToast(json.message || 'Failed to issue certificate', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error issuing award certificate', 'error');
    }
  }

  // Global window functions
  window.viewLeaderboardForComp = function (compId) {
    const tabs = document.querySelectorAll('.comp-tab-btn');
    tabs.forEach(t => t.classList.remove('active'));
    const targetBtn = document.querySelector('.comp-tab-btn[data-tab="leaderboard"]');
    if (targetBtn) targetBtn.classList.add('active');

    document.querySelectorAll('.comp-tab-content').forEach(c => c.style.display = 'none');
    const target = document.getElementById('tab-leaderboard');
    if (target) target.style.display = 'block';

    selectedLeaderboardCompId = compId;
    const lbSelect = document.getElementById('leaderboard-comp-select');
    if (lbSelect) lbSelect.value = compId;
    loadLeaderboard(compId);
  };

  window.openRegisterModal = function (compId) {
    const modal = document.getElementById('modal-register-participant');
    if (!modal) return;
    const select = document.getElementById('reg-comp-select');
    if (select) select.value = compId;
    modal.classList.add('active');
  };

  window.openSubmitScoreModal = function (participantId, memberName, unit) {
    activeScoringParticipantId = participantId;
    const modal = document.getElementById('modal-submit-score');
    if (!modal) return;

    document.getElementById('score-member-name').textContent = memberName;
    document.getElementById('score-unit-label').textContent = unit || 'reps';
    modal.classList.add('active');
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

