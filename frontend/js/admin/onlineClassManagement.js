/**
 * Virtex Admin - Online Classes and Courses Management Controller
 * Manages live livestream classes, recorded VOD workouts, yoga, group fitness,
 * member registration, online attendance, masterclass courses, video lessons,
 * quizzes, completion tracking, digital certificates, and learning analytics.
 */

(function () {
  'use strict';

  // Global State
  let onlineClasses = [];
  let classRegistrations = [];
  let coursesList = [];
  let enrolmentsList = [];
  let certificatesList = [];
  let membersList = [];
  let trainersList = [];
  let analyticsData = null;

  let currentTab = 'classes';
  let activeCategoryFilter = 'All';
  let activeTypeFilter = 'All';
  let activeStatusFilter = 'All';
  let selectedCourseForLesson = null;
  let selectedCourseForQuiz = null;

  // Auth Helper
  function getAuthHeaders() {
    const token = (localStorage.getItem('virtex_admin_jwt_token') || localStorage.getItem('token'));
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  }

  // Toast Notifications
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `oc-toast toast-${type}`;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.background = type === 'success' ? '#11141e' : '#2b1111';
    toast.style.border = `1px solid ${type === 'success' ? '#00e5ff' : '#ff5252'}`;
    toast.style.color = '#fff';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';
    toast.style.fontSize = '0.9rem';
    toast.innerHTML = `<span>${type === 'success' ? '📺' : '⚠️'}</span> <span>${message}</span>`;
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
      loadOnlineClasses(),
      loadClassRegistrations(),
      loadCourses(),
      loadEnrolments(),
      loadCertificates(),
      loadAnalytics()
    ]);
  }

  // Fetch Members & Trainers
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
    const selects = ['reg-class-member-select', 'enrol-course-member-select', 'cert-member-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Member --</option>' +
          membersList.map(m => `<option value="${m.id}">${m.full_name || m.name} (${m.member_code || '#' + m.id})</option>`).join('');
      }
    });
  }

  function populateTrainerDropdowns() {
    const selects = ['new-class-trainer-select', 'new-course-trainer-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Lead Instructor / Coach --</option>' +
          trainersList.map(t => `<option value="${t.id}">${t.full_name || t.name} (${t.specialty || 'Trainer'})</option>`).join('');
      }
    });
  }

  // Tab Navigation
  function setupTabListeners() {
    const tabs = document.querySelectorAll('.oc-tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.getAttribute('data-tab');

        document.querySelectorAll('.oc-tab-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById(`tab-${currentTab}`);
        if (target) target.style.display = 'block';
      });
    });
  }

  // Filter Listeners
  function setupFilterListeners() {
    const catFilter = document.getElementById('filter-oc-category');
    if (catFilter) {
      catFilter.addEventListener('change', (e) => {
        activeCategoryFilter = e.target.value;
        loadOnlineClasses();
      });
    }

    const typeFilter = document.getElementById('filter-oc-type');
    if (typeFilter) {
      typeFilter.addEventListener('change', (e) => {
        activeTypeFilter = e.target.value;
        loadOnlineClasses();
      });
    }

    const statusFilter = document.getElementById('filter-oc-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        activeStatusFilter = e.target.value;
        loadOnlineClasses();
      });
    }

    const searchInput = document.getElementById('oc-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderOnlineClasses();
      });
    }
  }

  // API Callers
  async function loadOnlineClasses() {
    try {
      let url = '/api/v1/admin/classes?';
      if (activeCategoryFilter !== 'All') url += `category=${encodeURIComponent(activeCategoryFilter)}&`;
      if (activeTypeFilter !== 'All') url += `class_type=${encodeURIComponent(activeTypeFilter)}&`;
      if (activeStatusFilter !== 'All') url += `status=${encodeURIComponent(activeStatusFilter)}&`;

      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        onlineClasses = json.data || [];
        const badge = document.getElementById('badge-classes-count');
        if (badge) badge.textContent = onlineClasses.length;
        renderOnlineClasses();
        populateClassDropdowns();
      }
    } catch (err) {
      console.error('Failed to load online classes:', err);
    }
  }

  function populateClassDropdowns() {
    const select = document.getElementById('reg-class-select');
    if (select) {
      select.innerHTML = '<option value="">-- Choose Class / VOD Session --</option>' +
        onlineClasses.map(c => `<option value="${c.id}">${c.title} (${c.category} • ${c.class_type})</option>`).join('');
    }
  }

  async function loadClassRegistrations() {
    try {
      const res = await fetch('/api/v1/admin/classes/registrations/all', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        classRegistrations = json.data || [];
        const badge = document.getElementById('badge-registrations-count');
        if (badge) badge.textContent = classRegistrations.length;
        renderClassRegistrations();
      }
    } catch (err) {
      console.error('Failed to load class registrations:', err);
    }
  }

  async function loadCourses() {
    try {
      const res = await fetch('/api/v1/admin/classes/courses/all', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        coursesList = json.data || [];
        const badge = document.getElementById('badge-courses-count');
        if (badge) badge.textContent = coursesList.length;
        renderCourses();
        populateCourseDropdowns();
      }
    } catch (err) {
      console.error('Failed to load courses:', err);
    }
  }

  function populateCourseDropdowns() {
    const selects = ['enrol-course-select', 'cert-course-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Course --</option>' +
          coursesList.map(c => `<option value="${c.id}">${c.title} (${c.level})</option>`).join('');
      }
    });
  }

  async function loadEnrolments() {
    try {
      const res = await fetch('/api/v1/admin/classes/enrolments/all', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        enrolmentsList = json.data || [];
        const badge = document.getElementById('badge-enrolments-count');
        if (badge) badge.textContent = enrolmentsList.length;
        renderEnrolments();
      }
    } catch (err) {
      console.error('Failed to load enrolments:', err);
    }
  }

  async function loadCertificates() {
    try {
      const res = await fetch('/api/v1/admin/classes/certificates/all', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        certificatesList = json.data || [];
        const badge = document.getElementById('badge-certs-count');
        if (badge) badge.textContent = certificatesList.length;
        renderCertificates();
      }
    } catch (err) {
      console.error('Failed to load certificates:', err);
    }
  }

  async function loadAnalytics() {
    try {
      const res = await fetch('/api/v1/admin/classes/analytics/summary', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        analyticsData = json.data || null;
        renderAnalytics();
      }
    } catch (err) {
      console.error('Failed to load learning analytics:', err);
    }
  }

  // Render Functions
  function renderAnalytics() {
    if (!analyticsData) return;
    const { totalClasses, activeClasses, totalEnrolments, completionRate, totalWatchHours } = analyticsData;

    const tc = document.getElementById('kpi-total-classes');
    if (tc) tc.textContent = totalClasses || 0;

    const ac = document.getElementById('kpi-active-streams');
    if (ac) ac.textContent = activeClasses || 0;

    const te = document.getElementById('kpi-total-enrolments');
    if (te) te.textContent = totalEnrolments || 0;

    const cr = document.getElementById('kpi-completion-rate');
    if (cr) cr.textContent = `${completionRate || 0}%`;

    const wh = document.getElementById('kpi-total-watch-hours');
    if (wh) wh.textContent = `${totalWatchHours || 0} hrs`;
  }

  function renderOnlineClasses() {
    const grid = document.getElementById('classes-grid-container');
    if (!grid) return;

    const search = document.getElementById('oc-search-input')?.value.toLowerCase() || '';
    let filtered = onlineClasses;
    if (search) {
      filtered = filtered.filter(c => c.title.toLowerCase().includes(search) || c.description.toLowerCase().includes(search));
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">📺</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No online classes found</h3>
          <p style="color: #64748b; font-size: 0.9rem;">Click "+ Schedule Class / VOD" to add a session.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(c => {
      let pillClass = 'pill-scheduled';
      let pillLabel = 'SCHEDULED';
      if (c.status === 'live_now') {
        pillClass = 'pill-live';
        pillLabel = '🔴 LIVE NOW';
      } else if (c.class_type === 'vod_recorded') {
        pillClass = 'pill-vod';
        pillLabel = '🎬 VOD REPLAY';
      } else if (c.status === 'completed') {
        pillClass = 'pill-completed';
        pillLabel = 'COMPLETED';
      }

      return `
        <div class="oc-card">
          <div class="oc-banner-wrap">
            <span class="oc-banner-icon" aria-hidden="true">${/yoga|pilates|stretch|mobility/i.test(c.category || '') ? '🧘' : /hiit|group|cardio/i.test(c.category || '') ? '🔥' : /recover/i.test(c.category || '') ? '🧊' : c.stream_type === 'vod' || /record/i.test(c.category || '') ? '🎞️' : '🎥'}</span>
            ${c.thumbnail_url ? `<img src="${escapeHtml(c.thumbnail_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
            <span class="oc-live-pill ${pillClass}">${pillLabel}</span>
            <span class="oc-cat-tag">${escapeHtml(c.category)}</span>
          </div>
          <div class="oc-body">
            <h3 class="oc-title">${escapeHtml(c.title)}</h3>
            <p class="oc-desc">${escapeHtml(c.description)}</p>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #0b0d14; padding: 10px; border-radius: 6px; margin-bottom: 14px; font-size: 0.8rem; font-family: 'JetBrains Mono', monospace;">
              <div>
                <span style="color: #64748b;">Instructor:</span> <strong style="color: #00e5ff;">${c.instructor_name ? escapeHtml(c.instructor_name) : '<span style="color:#64748b;font-weight:500;">Unassigned</span>'}</strong>
              </div>
              <div>
                <span style="color: #64748b;">Duration:</span> <strong style="color: #ffd600;">${c.duration_mins} mins</strong>
              </div>
              <div>
                <span style="color: #64748b;">Starts:</span> <span style="color: #fff;">${new Date(c.scheduled_at).toLocaleDateString()}</span>
              </div>
              <div>
                <span style="color: #64748b;">Students:</span> <strong style="color: #00e676;">${c.participants_count || 0} registered</strong>
              </div>
            </div>

            <div style="display: flex; gap: 8px; margin-top: auto;">
              ${c.stream_url ? `
                <a href="${escapeHtml(c.stream_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="flex: 1; padding: 8px 10px; font-size: 0.82rem; text-decoration: none; text-align: center;">
                  Open Stream 🔗
                </a>
              ` : ''}
              <button class="btn btn-green" style="padding: 8px 14px; font-size: 0.82rem;" onclick="window.openRegisterClassModal(${c.id})">
                Register Member +
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderClassRegistrations() {
    const tbody = document.getElementById('registrations-table-body');
    if (!tbody) return;

    if (classRegistrations.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No member registrations found. Click "Register Member" to enroll athletes.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = classRegistrations.map(r => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(r.member_name)}</div>
          <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(r.member_code)}</div>
        </td>
        <td>
          <div style="font-weight: 600; color: #00e5ff;">${escapeHtml(r.class_title)}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">${escapeHtml(r.class_category)} • ${escapeHtml(r.class_type)}</div>
        </td>
        <td>
          <span style="font-size: 0.82rem; color: #cbd5e1; font-family: 'JetBrains Mono', monospace;">
            ${new Date(r.registered_at).toLocaleDateString()}
          </span>
        </td>
        <td>
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" ${r.attended ? 'checked' : ''} onchange="window.toggleAttendance(${r.id}, this.checked)" style="accent-color: #00e676; width: 16px; height: 16px;">
            <span class="badge ${r.attended ? 'badge-green' : 'badge-gold'}">${r.attended ? 'ATTENDED' : 'REGISTERED'}</span>
          </label>
        </td>
        <td>
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.88rem; color: #ffd600;">
            ${r.watch_time_mins || 0} mins
          </span>
        </td>
        <td>
          <span style="font-size: 0.82rem; color: #94a3b8; text-transform: capitalize;">${escapeHtml(r.status)}</span>
        </td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="window.promptLogWatchTime(${r.id}, ${r.watch_time_mins || 0})">
            Log Mins ⏱️
          </button>
        </td>
      </tr>
    `).join('');
  }

  function renderCourses() {
    const container = document.getElementById('courses-container');
    if (!container) return;

    if (coursesList.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🎓</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No courses created yet</h3>
          <p style="color: #64748b; font-size: 0.9rem;">Click "+ New Course" to launch a curriculum.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = coursesList.map(c => `
      <div class="course-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span class="badge badge-blue font-mono">${escapeHtml(c.category)}</span>
              <span class="badge badge-outline font-mono">${escapeHtml(c.level)}</span>
              <span class="badge badge-green font-mono">${c.estimated_hours} hrs</span>
            </div>
            <h3 style="font-size: 1.25rem; font-weight: 800; color: #fff; margin: 0 0 6px 0;">${escapeHtml(c.title)}</h3>
            <p style="font-size: 0.88rem; color: #94a3b8; margin: 0 0 10px 0; max-width: 800px;">${escapeHtml(c.description)}</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-xs" onclick="window.openAddLessonModal(${c.id}, '${escapeHtml(c.title)}')">+ Add Video Lesson</button>
            <button class="btn btn-outline btn-xs" onclick="window.openQuizModal(${c.id}, '${escapeHtml(c.title)}')">Assessments / Quiz 📝</button>
            <button class="btn btn-green btn-xs" onclick="window.openEnrolCourseModal(${c.id})">Enrol Student +</button>
          </div>
        </div>

        <div style="display: flex; gap: 16px; font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; color: #cbd5e1; border-top: 1px solid #1e2433; padding-top: 10px; margin-top: 10px;">
          <span>Instructor: <strong style="color: #00e5ff;">${c.instructor_name ? escapeHtml(c.instructor_name) : '<span style="color:#64748b;font-weight:500;">Unassigned</span>'}</strong></span>
          <span>Curriculum: <strong style="color: #ffd600;">${c.lessons_count || 0} Lessons</strong></span>
          <span>Students Enrolled: <strong style="color: #00e676;">${c.enrolments_count || 0}</strong></span>
          <span>Graduates: <strong style="color: #b388ff;">${c.completions_count || 0}</strong></span>
        </div>
      </div>
    `).join('');
  }

  function renderEnrolments() {
    const tbody = document.getElementById('enrolments-table-body');
    if (!tbody) return;

    if (enrolmentsList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No course enrolments recorded. Click "Enrol Student" to start a member's journey.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = enrolmentsList.map(e => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(e.member_name)}</div>
          <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(e.member_code)}</div>
        </td>
        <td>
          <div style="font-weight: 600; color: #00e5ff;">${escapeHtml(e.course_title)}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">${escapeHtml(e.course_category)} (${escapeHtml(e.course_level)})</div>
        </td>
        <td style="width: 220px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-family: 'JetBrains Mono', monospace; margin-bottom: 2px;">
            <span style="color: #fff;">${e.progress_pct || 0}% Complete</span>
            <span style="color: #94a3b8;">${e.lessons_completed || 0} / ${e.total_lessons || 0} Lessons</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-fill" style="width: ${e.progress_pct || 0}%;"></div>
          </div>
        </td>
        <td>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; font-weight: 700; color: ${e.quiz_passed ? '#00e676' : '#ffd600'};">
            ${e.quiz_score_pct !== null ? e.quiz_score_pct + '%' : 'Pending'}
          </div>
          <div style="font-size: 0.72rem; color: #64748b;">${e.quiz_passed ? '✓ PASSED' : 'NOT PASSED'}</div>
        </td>
        <td>
          <span class="badge ${e.status === 'completed' ? 'badge-green' : 'badge-blue'}">${e.status.toUpperCase()}</span>
        </td>
        <td>
          <span style="font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; color: #cbd5e1;">
            ${e.certificate_code ? `🎖️ ${e.certificate_code}` : 'In Progress'}
          </span>
        </td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="window.promptUpdateProgress(${e.id}, ${e.progress_pct || 0}, ${e.lessons_completed || 0}, ${e.total_lessons || 0})">
            Update ✏️
          </button>
        </td>
      </tr>
    `).join('');
  }

  function renderCertificates() {
    const container = document.getElementById('certificates-container');
    if (!container) return;

    if (certificatesList.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🎖️</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No academy certificates issued yet</h3>
          <p style="color: #64748b; font-size: 0.9rem;">Course certificates are automatically generated upon 100% completion & quiz pass.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = certificatesList.map(c => `
      <div class="academy-cert-card">
        <div class="academy-cert-watermark">🎓</div>
        <div class="academy-cert-header">
          <div class="academy-cert-org">${escapeHtml(c.issued_by || 'VIRTEX ACADEMY')}</div>
          <h3 class="academy-cert-title">CERTIFICATE OF COMPLETION</h3>
        </div>
        <div style="text-align: center; font-size: 0.85rem; color: #94a3b8;">This certifies that</div>
        <div class="academy-cert-recipient">${escapeHtml(c.member_name)}</div>
        <div style="text-align: center; font-size: 0.85rem; color: #94a3b8;">has successfully mastered all modules of</div>
        <div class="academy-cert-course">"${escapeHtml(c.course_title)}"</div>
        <div style="text-align: center; font-size: 0.82rem; color: #00e676; margin-bottom: 14px; font-family: 'JetBrains Mono', monospace;">
          Grade: ${escapeHtml(c.grade_score || 'Distinction')}
        </div>
        <div class="academy-cert-footer">
          <div>
            <span>Code: </span><strong style="color: #00e5ff;">${escapeHtml(c.certificate_code)}</strong>
          </div>
          <div>
            <span>Conferred: </span><span>${new Date(c.issued_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  // Modals & User Actions
  function setupModalListeners() {
    // Open New Class Modal
    const btnNewClass = document.getElementById('btn-open-class-modal');
    if (btnNewClass) {
      btnNewClass.addEventListener('click', () => {
        document.getElementById('modal-new-class').classList.add('active');
      });
    }

    // Open Register Class Modal
    const btnRegClass = document.getElementById('btn-open-reg-class-modal');
    if (btnRegClass) {
      btnRegClass.addEventListener('click', () => {
        document.getElementById('modal-register-class').classList.add('active');
      });
    }

    // Open New Course Modal
    const btnNewCourse = document.getElementById('btn-open-course-modal');
    if (btnNewCourse) {
      btnNewCourse.addEventListener('click', () => {
        document.getElementById('modal-new-course').classList.add('active');
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
    const formClass = document.getElementById('form-new-class');
    if (formClass) formClass.addEventListener('submit', handleCreateClass);

    const formRegClass = document.getElementById('form-register-class');
    if (formRegClass) formRegClass.addEventListener('submit', handleRegisterClass);

    const formCourse = document.getElementById('form-new-course');
    if (formCourse) formCourse.addEventListener('submit', handleCreateCourse);

    const formLesson = document.getElementById('form-add-lesson');
    if (formLesson) formLesson.addEventListener('submit', handleAddLesson);

    const formQuiz = document.getElementById('form-quiz');
    if (formQuiz) formQuiz.addEventListener('submit', handleSaveQuiz);

    const formEnrol = document.getElementById('form-enrol-course');
    if (formEnrol) formEnrol.addEventListener('submit', handleEnrolCourse);

    const formCert = document.getElementById('form-issue-cert');
    if (formCert) formCert.addEventListener('submit', handleIssueCertificate);
  }

  // Action Handlers
  async function handleCreateClass(e) {
    e.preventDefault();
    const data = {
      title: document.getElementById('new-class-title').value.trim(),
      category: document.getElementById('new-class-category').value,
      class_type: document.getElementById('new-class-type').value,
      instructor_trainer_id: document.getElementById('new-class-trainer-select').value || null,
      scheduled_at: document.getElementById('new-class-scheduled-at').value,
      duration_mins: parseInt(document.getElementById('new-class-duration').value, 10) || 45,
      stream_url: document.getElementById('new-class-stream-url').value.trim(),
      thumbnail_url: document.getElementById('new-class-thumbnail').value.trim(),
      max_participants: parseInt(document.getElementById('new-class-max-capacity').value, 10) || 50,
      difficulty: document.getElementById('new-class-difficulty').value,
      description: document.getElementById('new-class-desc').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/classes', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Online class scheduled successfully!');
        document.getElementById('modal-new-class').classList.remove('active');
        document.getElementById('form-new-class').reset();
        await Promise.all([loadOnlineClasses(), loadAnalytics()]);
      } else {
        showToast(json.message || 'Failed to create online class', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving online class', 'error');
    }
  }

  async function handleRegisterClass(e) {
    e.preventDefault();
    const data = {
      class_id: parseInt(document.getElementById('reg-class-select').value, 10),
      member_id: parseInt(document.getElementById('reg-class-member-select').value, 10)
    };

    try {
      const res = await fetch('/api/v1/admin/classes/registrations', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Member registered for class!');
        document.getElementById('modal-register-class').classList.remove('active');
        document.getElementById('form-register-class').reset();
        await Promise.all([loadClassRegistrations(), loadOnlineClasses(), loadAnalytics()]);
      } else {
        showToast(json.message || 'Failed to register member', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error registering member for class', 'error');
    }
  }

  async function handleCreateCourse(e) {
    e.preventDefault();
    const data = {
      title: document.getElementById('new-course-title').value.trim(),
      category: document.getElementById('new-course-category').value,
      level: document.getElementById('new-course-level').value,
      estimated_hours: parseFloat(document.getElementById('new-course-hours').value) || 4.0,
      instructor_trainer_id: document.getElementById('new-course-trainer-select').value || null,
      thumbnail_url: document.getElementById('new-course-thumbnail').value.trim(),
      description: document.getElementById('new-course-desc').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/classes/courses', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Masterclass course created successfully!');
        document.getElementById('modal-new-course').classList.remove('active');
        document.getElementById('form-new-course').reset();
        await Promise.all([loadCourses(), loadAnalytics()]);
      } else {
        showToast(json.message || 'Failed to create course', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving course', 'error');
    }
  }

  async function handleAddLesson(e) {
    e.preventDefault();
    if (!selectedCourseForLesson) return;

    const data = {
      title: document.getElementById('lesson-title').value.trim(),
      duration_mins: parseInt(document.getElementById('lesson-duration').value, 10) || 15,
      video_url: document.getElementById('lesson-video-url').value.trim(),
      content_notes: document.getElementById('lesson-notes').value.trim()
    };

    try {
      const res = await fetch(`/api/v1/admin/classes/courses/${selectedCourseForLesson}/lessons`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Video lesson appended to curriculum!');
        document.getElementById('modal-add-lesson').classList.remove('active');
        document.getElementById('form-add-lesson').reset();
        await Promise.all([loadCourses(), loadEnrolments()]);
      } else {
        showToast(json.message || 'Failed to add lesson', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error adding video lesson', 'error');
    }
  }

  async function handleSaveQuiz(e) {
    e.preventDefault();
    if (!selectedCourseForQuiz) return;

    const qText = document.getElementById('quiz-q1-text').value.trim();
    const opt0 = document.getElementById('quiz-q1-opt0').value.trim();
    const opt1 = document.getElementById('quiz-q1-opt1').value.trim();
    const correctIdx = parseInt(document.getElementById('quiz-q1-correct').value, 10);

    const data = {
      title: document.getElementById('quiz-title').value.trim() || 'Course Assessment',
      pass_percentage: parseInt(document.getElementById('quiz-pass-pct').value, 10) || 80,
      quiz_data: [
        {
          question: qText || 'Fundamental movement principle test question',
          options: [opt0 || 'Option A', opt1 || 'Option B'],
          correctIndex: correctIdx || 0
        }
      ]
    };

    try {
      const res = await fetch(`/api/v1/admin/classes/courses/${selectedCourseForQuiz}/quiz`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Course quiz updated successfully!');
        document.getElementById('modal-quiz').classList.remove('active');
        await loadCourses();
      } else {
        showToast(json.message || 'Failed to save quiz', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving quiz', 'error');
    }
  }

  async function handleEnrolCourse(e) {
    e.preventDefault();
    const data = {
      course_id: parseInt(document.getElementById('enrol-course-select').value, 10),
      member_id: parseInt(document.getElementById('enrol-course-member-select').value, 10)
    };

    try {
      const res = await fetch('/api/v1/admin/classes/enrolments', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Member enrolled in course!');
        document.getElementById('modal-enrol-course').classList.remove('active');
        document.getElementById('form-enrol-course').reset();
        await Promise.all([loadEnrolments(), loadCourses(), loadAnalytics()]);
      } else {
        showToast(json.message || 'Failed to enrol member', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error enrolling student', 'error');
    }
  }

  async function handleIssueCertificate(e) {
    e.preventDefault();
    const data = {
      course_id: parseInt(document.getElementById('cert-course-select').value, 10),
      member_id: parseInt(document.getElementById('cert-member-select').value, 10),
      grade_score: document.getElementById('cert-grade').value.trim() || '100% (High Distinction)',
      issued_by: document.getElementById('cert-issued-by').value.trim() || 'Virtex Academy of Exercise Science'
    };

    try {
      const res = await fetch('/api/v1/admin/classes/certificates', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Official academy digital certificate issued!');
        document.getElementById('modal-issue-cert').classList.remove('active');
        document.getElementById('form-issue-cert').reset();
        await Promise.all([loadCertificates(), loadAnalytics()]);
      } else {
        showToast(json.message || 'Failed to issue certificate', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error generating certificate', 'error');
    }
  }

  // Global Window Helpers
  window.openRegisterClassModal = function (classId) {
    const modal = document.getElementById('modal-register-class');
    if (!modal) return;
    const select = document.getElementById('reg-class-select');
    if (select && classId) select.value = classId;
    modal.classList.add('active');
  };

  window.openAddLessonModal = function (courseId, courseTitle) {
    selectedCourseForLesson = courseId;
    const modal = document.getElementById('modal-add-lesson');
    if (!modal) return;
    document.getElementById('lesson-course-title-display').textContent = courseTitle;
    modal.classList.add('active');
  };

  window.openQuizModal = async function (courseId, courseTitle) {
    selectedCourseForQuiz = courseId;
    const modal = document.getElementById('modal-quiz');
    if (!modal) return;
    document.getElementById('quiz-course-title-display').textContent = courseTitle;

    // Load existing quiz if any
    try {
      const res = await fetch(`/api/v1/admin/classes/courses/${courseId}/quiz`, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        const q = json.data;
        if (q) {
          document.getElementById('quiz-title').value = q.title || '';
          document.getElementById('quiz-pass-pct').value = q.pass_percentage || 80;
          if (q.quiz_data && q.quiz_data[0]) {
            document.getElementById('quiz-q1-text').value = q.quiz_data[0].question || '';
            document.getElementById('quiz-q1-opt0').value = q.quiz_data[0].options?.[0] || '';
            document.getElementById('quiz-q1-opt1').value = q.quiz_data[0].options?.[1] || '';
            document.getElementById('quiz-q1-correct').value = q.quiz_data[0].correctIndex || 0;
          }
        }
      }
    } catch (err) {
      console.warn('Could not fetch quiz details:', err);
    }

    modal.classList.add('active');
  };

  window.openEnrolCourseModal = function (courseId) {
    const modal = document.getElementById('modal-enrol-course');
    if (!modal) return;
    const select = document.getElementById('enrol-course-select');
    if (select && courseId) select.value = courseId;
    modal.classList.add('active');
  };

  window.toggleAttendance = async function (regId, attended) {
    try {
      const res = await fetch(`/api/v1/admin/classes/registrations/${regId}/attendance`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ attended })
      });
      if (res.ok) {
        showToast(attended ? 'Member marked as ATTENDED!' : 'Attendance flag cleared.');
        await loadClassRegistrations();
      }
    } catch (err) {
      console.error(err);
      showToast('Error updating attendance status', 'error');
    }
  };

  window.promptLogWatchTime = async function (regId, currentMins) {
    const minsStr = prompt('Enter total watch time in minutes:', currentMins || 45);
    if (minsStr === null) return;
    const mins = parseInt(minsStr, 10);
    if (isNaN(mins)) return;

    try {
      const res = await fetch(`/api/v1/admin/classes/registrations/${regId}/attendance`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ watch_time_mins: mins, attended: true })
      });
      if (res.ok) {
        showToast(`Logged ${mins} minutes watch time!`);
        await Promise.all([loadClassRegistrations(), loadAnalytics()]);
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving watch time', 'error');
    }
  };

  window.promptUpdateProgress = async function (enrolId, curProg, curLessons, totalLessons) {
    const newLessonsStr = prompt(`Enter completed lessons (Total: ${totalLessons}):`, curLessons);
    if (newLessonsStr === null) return;
    const newLessons = parseInt(newLessonsStr, 10);
    if (isNaN(newLessons)) return;

    const quizScoreStr = prompt('Enter quiz score percentage (0-100):', 85);
    const quizScore = quizScoreStr !== null ? parseInt(quizScoreStr, 10) : null;
    const quizPassed = quizScore !== null && quizScore >= 75;

    try {
      const res = await fetch(`/api/v1/admin/classes/enrolments/${enrolId}/progress`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          lessons_completed: newLessons,
          quiz_score_pct: quizScore,
          quiz_passed: quizPassed
        })
      });
      if (res.ok) {
        showToast('Student curriculum progress updated!');
        await Promise.all([loadEnrolments(), loadCourses(), loadAnalytics(), loadCertificates()]);
      }
    } catch (err) {
      console.error(err);
      showToast('Error updating progress', 'error');
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

  // Auto-init on DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

