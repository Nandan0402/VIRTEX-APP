/**
 * Virtex Admin - Fitness Books and Digital Library Controller
 * Manages book catalogue, secure file downloads, access permissions,
 * purchase transactions, and member reading progress tracking.
 */

(function () {
  'use strict';

  // Global State
  let booksList = [];
  let purchasesList = [];
  let progressList = [];
  let membersList = [];
  let kpisData = null;

  let currentTab = 'catalogue';
  let activeCategoryFilter = 'All';
  let activePaidFilter = 'All';
  let activeTierFilter = 'All';

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
    toast.className = `lib-toast toast-${type}`;
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
    toast.innerHTML = `<span>${type === 'success' ? '📚' : '⚠️'}</span> <span>${message}</span>`;
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
      fetchMembers(),
      loadBooks(),
      loadPurchases(),
      loadReadingProgress(),
      loadKpis()
    ]);
  }

  // Fetch Members
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
    const selects = ['purchase-member-select', 'progress-member-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Member --</option>' +
          membersList.map(m => `<option value="${m.id}">${m.full_name || m.name} (${m.member_code || '#' + m.id})</option>`).join('');
      }
    });
  }

  // Tab Listeners
  function checkUrlHashTab() {
    const hash = window.location.hash.toLowerCase().replace('#', '');
    if (!hash) return;
    const tabMap = {
      'guides': 'catalogue',
      'catalogue': 'catalogue',
      'rules': 'categories',
      'categories': 'categories',
      'stats': 'purchases',
      'purchases': 'purchases',
      'progress': 'progress'
    };
    const target = tabMap[hash];
    if (target) {
      const btn = document.querySelector(`.lib-tab-btn[data-tab="${target}"]`);
      if (btn) btn.click();
      if (hash === 'guides') {
        const catFilter = document.getElementById('filter-lib-category');
        if (catFilter) {
          catFilter.value = 'Fitness & Training';
          catFilter.dispatchEvent(new Event('change'));
        }
      }
    }
  }

  function setupTabListeners() {
    const tabs = document.querySelectorAll('.lib-tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.getAttribute('data-tab');

        document.querySelectorAll('.lib-tab-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById(`tab-${currentTab}`);
        if (target) target.style.display = 'block';

        if (currentTab === 'categories') {
          renderCategoryOverview();
        }
      });
    });

    window.addEventListener('hashchange', checkUrlHashTab);
    checkUrlHashTab();
  }

  // Filter Listeners
  function setupFilterListeners() {
    const catFilter = document.getElementById('filter-lib-category');
    if (catFilter) {
      catFilter.addEventListener('change', (e) => {
        activeCategoryFilter = e.target.value;
        loadBooks();
      });
    }

    const paidFilter = document.getElementById('filter-lib-paid');
    if (paidFilter) {
      paidFilter.addEventListener('change', (e) => {
        activePaidFilter = e.target.value;
        loadBooks();
      });
    }

    const tierFilter = document.getElementById('filter-lib-tier');
    if (tierFilter) {
      tierFilter.addEventListener('change', (e) => {
        activeTierFilter = e.target.value;
        loadBooks();
      });
    }

    const searchInput = document.getElementById('lib-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderBooks();
      });
    }
  }

  // API Callers
  async function loadBooks() {
    try {
      let url = '/api/v1/admin/library?';
      if (activeCategoryFilter !== 'All') url += `category=${encodeURIComponent(activeCategoryFilter)}&`;
      if (activePaidFilter !== 'All') url += `is_paid=${encodeURIComponent(activePaidFilter)}&`;
      if (activeTierFilter !== 'All') url += `access_tier=${encodeURIComponent(activeTierFilter)}&`;

      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        booksList = json.data || [];
        const badge = document.getElementById('badge-books-count');
        if (badge) badge.textContent = booksList.length;
        renderBooks();
        populateBookDropdowns();
      }
    } catch (err) {
      console.error('Failed to load books:', err);
    }
  }

  function populateBookDropdowns() {
    const selects = ['purchase-book-select', 'progress-book-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Book --</option>' +
          booksList.map(b => `<option value="${b.id}" data-price="${b.price_amount}">${b.title} (${b.category} • ${b.is_paid ? '₹' + b.price_amount : 'FREE'})</option>`).join('');
      }
    });

    const pBookSelect = document.getElementById('purchase-book-select');
    if (pBookSelect) {
      pBookSelect.addEventListener('change', (e) => {
        const opt = e.target.selectedOptions[0];
        const price = opt?.getAttribute('data-price') || '0.00';
        const priceInput = document.getElementById('purchase-amount');
        if (priceInput) priceInput.value = price;
      });
    }
  }

  async function loadPurchases() {
    try {
      const res = await fetch('/api/v1/admin/library/purchases/all', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        purchasesList = json.data || [];
        const badge = document.getElementById('badge-purchases-count');
        if (badge) badge.textContent = purchasesList.length;
        renderPurchases();
      }
    } catch (err) {
      console.error('Failed to load purchases:', err);
    }
  }

  async function loadReadingProgress() {
    try {
      const res = await fetch('/api/v1/admin/library/progress/all', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        progressList = json.data || [];
        const badge = document.getElementById('badge-progress-count');
        if (badge) badge.textContent = progressList.length;
        renderReadingProgress();
      }
    } catch (err) {
      console.error('Failed to load reading progress:', err);
    }
  }

  async function loadKpis() {
    try {
      const res = await fetch('/api/v1/admin/library/kpis/summary', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        kpisData = json.data || null;
        renderKpis();
      }
    } catch (err) {
      console.error('Failed to load library KPIs:', err);
    }
  }

  // Render Functions
  function renderKpis() {
    if (!kpisData) return;
    const { totalBooks, paidBooks, freeBooks, totalDownloads, activeReaders, totalRevenue } = kpisData;

    const tb = document.getElementById('kpi-total-books');
    if (tb) tb.textContent = totalBooks || 0;

    const pb = document.getElementById('kpi-paid-books');
    if (pb) pb.textContent = `${paidBooks || 0} Paid / ${freeBooks || 0} Free`;

    const td = document.getElementById('kpi-total-downloads');
    if (td) td.textContent = totalDownloads || 0;

    const ar = document.getElementById('kpi-active-readers');
    if (ar) ar.textContent = activeReaders || 0;

    const tr = document.getElementById('kpi-total-revenue');
    if (tr) tr.textContent = `₹${Number(totalRevenue || 0).toLocaleString()}`;
  }

  function renderBooks() {
    const grid = document.getElementById('books-grid-container');
    if (!grid) return;

    const search = document.getElementById('lib-search-input')?.value.toLowerCase() || '';
    let filtered = booksList;
    if (search) {
      filtered = filtered.filter(b => b.title.toLowerCase().includes(search) || b.author.toLowerCase().includes(search) || b.category.toLowerCase().includes(search));
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">📚</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No books found in catalogue</h3>
          <p style="color: #64748b; font-size: 0.9rem;">Click "+ Publish / Upload Book" to add digital documents.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(b => {
      let tierClass = 'tier-all';
      let tierLabel = 'ALL PATRONS';
      if (b.access_tier === 'vip_tier') {
        tierClass = 'tier-vip';
        tierLabel = 'VIP MEMBERS';
      } else if (b.access_tier === 'staff_only') {
        tierClass = 'tier-staff';
        tierLabel = 'STAFF ONLY';
      } else if (b.access_tier === 'purchased_only') {
        tierClass = 'tier-purchased';
        tierLabel = 'PURCHASE REQUIRED';
      }

      return `
        <div class="book-card">
          <div class="book-cover-wrap">
            <span class="book-cover-icon" aria-hidden="true">${/nutrition|diet/i.test(b.category || '') ? '🥗' : /anatomy|biomech|kinesi/i.test(b.category || '') ? '🦴' : /bodybuild|hypertroph/i.test(b.category || '') ? '💪' : /rule|policy|facility/i.test(b.category || '') ? '📜' : '📘'}</span>
            ${b.cover_url ? `<img src="${escapeHtml(b.cover_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
            <span class="book-tier-pill ${tierClass}">${tierLabel}</span>
            <span class="book-price-tag">${b.is_paid ? '₹' + Number(b.price_amount).toFixed(2) : 'FREE'}</span>
          </div>
          <div class="book-body">
            <span class="badge badge-blue font-mono text-xs" style="align-self: flex-start; margin-bottom: 6px;">${escapeHtml(b.category)}</span>
            <h3 class="book-title">${escapeHtml(b.title)}</h3>
            <div class="book-author">By <strong>${escapeHtml(b.author)}</strong></div>
            <p class="book-desc">${escapeHtml(b.description)}</p>

            <div class="book-meta-grid">
              <div>
                <span style="color: #64748b;">Format:</span> <strong style="color: #ffd600;">${b.file_format || 'PDF'}</strong>
              </div>
              <div>
                <span style="color: #64748b;">Pages:</span> <strong style="color: #fff;">${b.page_count} pgs</strong>
              </div>
              <div>
                <span style="color: #64748b;">File Size:</span> <span style="color: #cbd5e1;">${b.file_size_mb} MB</span>
              </div>
              <div>
                <span style="color: #64748b;">Downloads:</span> <strong style="color: #00e676;">${b.downloads_count}</strong>
              </div>
            </div>

            <div style="display: flex; gap: 8px; margin-top: auto; flex-wrap: wrap;">
              <button class="btn btn-outline" style="flex: 1; padding: 8px 10px; font-size: 0.8rem;" onclick="window.downloadBookDocument(${b.id}, '${escapeHtml(b.title)}')">
                Secure Download 📥
              </button>
              ${b.is_paid ? `
                <button class="btn btn-outline" style="padding: 8px 10px; font-size: 0.8rem;" onclick="window.openRecordPurchaseModal(${b.id})">
                  Purchase 💳
                </button>
              ` : ''}
              <button class="btn btn-green" style="padding: 8px 12px; font-size: 0.8rem;" onclick="window.openUpdateProgressModal(${b.id}, ${b.page_count})">
                Log Read 📖
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderPurchases() {
    const tbody = document.getElementById('purchases-table-body');
    if (!tbody) return;

    if (purchasesList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No purchase transactions logged yet. Click "Record Purchase" to log member transactions.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = purchasesList.map(p => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(p.member_name)}</div>
          <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(p.member_code)}</div>
        </td>
        <td>
          <div style="font-weight: 600; color: #ffd600;">${escapeHtml(p.book_title)}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">${escapeHtml(p.book_category)}</div>
        </td>
        <td>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; font-weight: 700; color: #00e676;">
            ₹${Number(p.amount_paid).toFixed(2)}
          </div>
        </td>
        <td>
          <span style="font-size: 0.82rem; color: #cbd5e1;">${escapeHtml(p.payment_method)}</span>
        </td>
        <td>
          <span style="font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; color: #00b0ff;">${escapeHtml(p.invoice_code)}</span>
        </td>
        <td>
          <span style="font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; color: #94a3b8;">
            ${new Date(p.purchased_at).toLocaleDateString()}
          </span>
        </td>
      </tr>
    `).join('');
  }

  function renderReadingProgress() {
    const tbody = document.getElementById('progress-table-body');
    if (!tbody) return;

    if (progressList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No reading progress entries found. Click "Log Read" on any book card.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = progressList.map(r => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(r.member_name)}</div>
          <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(r.member_code)}</div>
        </td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(r.book_title)}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">By ${escapeHtml(r.book_author)}</div>
        </td>
        <td style="width: 220px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-family: 'JetBrains Mono', monospace; margin-bottom: 2px;">
            <span style="color: #ffd600;">Page ${r.current_page} / ${r.total_pages}</span>
            <span style="color: #fff;">${r.progress_pct}%</span>
          </div>
          <div class="reading-bar-wrap">
            <div class="reading-bar-fill" style="width: ${r.progress_pct}%;"></div>
          </div>
        </td>
        <td>
          <span class="badge ${r.completed ? 'badge-green' : 'badge-blue'}">${r.completed ? 'COMPLETED' : 'IN PROGRESS'}</span>
        </td>
        <td>
          <span style="font-size: 0.82rem; color: #cbd5e1;">${escapeHtml(r.notes || '—')}</span>
        </td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="window.promptQuickPageUpdate(${r.book_id}, ${r.member_id}, ${r.current_page}, ${r.total_pages})">
            Page Update ✏️
          </button>
        </td>
      </tr>
    `).join('');
  }

  function renderCategoryOverview() {
    const container = document.getElementById('category-overview-container');
    if (!container) return;

    const categories = [
      { name: 'Fitness & Training', icon: '🏋️', desc: 'Periodization models, strength conditioning, power development, and coach programming manuals.' },
      { name: 'Bodybuilding & Hypertrophy', icon: '💪', desc: 'Volume thresholds, mechanical tension science, muscle damage recovery, and posing guides.' },
      { name: 'Human Anatomy & Biomechanics', icon: '🦴', desc: 'Musculoskeletal leverage, joint kinematics, spinal forces, and orthopedic treatises.' },
      { name: 'Nutrition & Dietetics', icon: '🥗', desc: 'Macronutrient timing, sports supplementation, cellular hydration, and micronutrient balance.' },
      { name: 'Exercise Physiology & Science', icon: '🔬', desc: 'Bioenergetics, mitochondrial adaptation, VO2 kinetics, and lactate threshold studies.' },
      { name: 'Gym Facility Rulebook', icon: '📋', desc: 'Club codes of conduct, equipment safety standards, emergency protocols, and member guidelines.' }
    ];

    // Only show categories that actually contain books (no empty "0 Books" placeholder cards)
    const withCounts = categories
      .map(c => ({ ...c, count: booksList.filter(b => b.category === c.name).length }))
      .filter(c => c.count > 0);

    if (withCounts.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #11141e; border-radius: 12px; border: 1px dashed #1e2433;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🗂️</div>
          <h3 style="color: #fff; margin-bottom: 6px;">No categories in use yet</h3>
          <p style="color: #64748b; font-size: 0.9rem; margin: 0;">Categories appear here once books are published to them.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = withCounts.map(c => {
      const count = c.count;
      return `
        <div class="admin-card" style="background: #11141e; border: 1px solid #1e2433; border-radius: 10px; padding: 18px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="font-size: 1.8rem;">${c.icon}</div>
            <span class="badge badge-gold font-mono">${count} Books</span>
          </div>
          <h4 style="color: #fff; font-size: 1.1rem; margin: 0 0 6px 0;">${c.name}</h4>
          <p style="font-size: 0.82rem; color: #94a3b8; line-height: 1.5; margin: 0 0 12px 0;">${c.desc}</p>
          <button class="btn btn-outline btn-xs" onclick="window.filterByCategory('${escapeHtml(c.name)}')">View Collection →</button>
        </div>
      `;
    }).join('');
  }

  // Modals & User Actions
  function setupModalListeners() {
    // Open New Book Modal
    const btnNewBook = document.getElementById('btn-open-book-modal');
    if (btnNewBook) {
      btnNewBook.addEventListener('click', () => {
        document.getElementById('modal-new-book').classList.add('active');
      });
    }

    // Open Record Purchase Modal
    const btnRecordPurchase = document.getElementById('btn-open-purchase-modal');
    if (btnRecordPurchase) {
      btnRecordPurchase.addEventListener('click', () => {
        document.getElementById('modal-record-purchase').classList.add('active');
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
    const formBook = document.getElementById('form-new-book');
    if (formBook) formBook.addEventListener('submit', handleCreateBook);

    const formPurchase = document.getElementById('form-record-purchase');
    if (formPurchase) formPurchase.addEventListener('submit', handleRecordPurchase);

    const formProgress = document.getElementById('form-update-progress');
    if (formProgress) formProgress.addEventListener('submit', handleUpdateProgress);

    // Paid Checkbox Toggle
    const chkPaid = document.getElementById('new-book-paid');
    if (chkPaid) {
      chkPaid.addEventListener('change', (e) => {
        const priceRow = document.getElementById('new-book-price-row');
        if (priceRow) priceRow.style.display = e.target.checked ? 'block' : 'none';
      });
    }
  }

  // Action Handlers
  async function handleCreateBook(e) {
    e.preventDefault();
    const isPaid = document.getElementById('new-book-paid').checked;

    const data = {
      title: document.getElementById('new-book-title').value.trim(),
      author: document.getElementById('new-book-author').value.trim(),
      category: document.getElementById('new-book-category').value,
      description: document.getElementById('new-book-desc').value.trim(),
      cover_url: document.getElementById('new-book-cover').value.trim(),
      secure_file_path: document.getElementById('new-book-filepath').value.trim() || `vault/books/${Date.now()}.pdf`,
      file_format: document.getElementById('new-book-format').value,
      file_size_mb: parseFloat(document.getElementById('new-book-filesize').value) || 8.5,
      page_count: parseInt(document.getElementById('new-book-pages').value, 10) || 200,
      is_paid: isPaid,
      price_amount: isPaid ? (parseFloat(document.getElementById('new-book-price').value) || 499.00) : 0.00,
      access_tier: document.getElementById('new-book-tier').value,
      status: document.getElementById('new-book-status').value
    };

    try {
      const res = await fetch('/api/v1/admin/library', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Book published to library catalogue!');
        document.getElementById('modal-new-book').classList.remove('active');
        document.getElementById('form-new-book').reset();
        await Promise.all([loadBooks(), loadKpis()]);
      } else {
        showToast(json.message || 'Failed to publish book', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving book', 'error');
    }
  }

  async function handleRecordPurchase(e) {
    e.preventDefault();
    const data = {
      book_id: parseInt(document.getElementById('purchase-book-select').value, 10),
      member_id: parseInt(document.getElementById('purchase-member-select').value, 10),
      amount_paid: parseFloat(document.getElementById('purchase-amount').value) || 0.00,
      payment_method: document.getElementById('purchase-method').value
    };

    try {
      const res = await fetch('/api/v1/admin/library/purchases', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Purchase invoice recorded successfully!');
        document.getElementById('modal-record-purchase').classList.remove('active');
        document.getElementById('form-record-purchase').reset();
        await Promise.all([loadPurchases(), loadKpis(), loadBooks()]);
      } else {
        showToast(json.message || 'Failed to record purchase', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error recording purchase', 'error');
    }
  }

  async function handleUpdateProgress(e) {
    e.preventDefault();
    const data = {
      book_id: parseInt(document.getElementById('progress-book-select').value, 10),
      member_id: parseInt(document.getElementById('progress-member-select').value, 10),
      current_page: parseInt(document.getElementById('progress-current-page').value, 10) || 1,
      total_pages: parseInt(document.getElementById('progress-total-pages').value, 10) || 100,
      notes: document.getElementById('progress-notes').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/library/progress', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Member reading progress updated!');
        document.getElementById('modal-update-progress').classList.remove('active');
        document.getElementById('form-update-progress').reset();
        await Promise.all([loadReadingProgress(), loadKpis(), loadBooks()]);
      } else {
        showToast(json.message || 'Failed to update reading progress', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving reading progress', 'error');
    }
  }

  // Global Window Helpers
  window.downloadBookDocument = async function (bookId, title) {
    try {
      showToast(`Initiating secure vault stream for "${title}"...`);
      const res = await fetch(`/api/v1/admin/library/${bookId}/download`, {
        headers: { 'Authorization': getAuthHeaders().Authorization }
      });

      if (!res.ok) {
        const json = await res.json();
        showToast(json.message || 'Access restricted by document permissions', 'error');
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('Document securely downloaded from vault!');
      await loadBooks();
    } catch (err) {
      console.error('Download error:', err);
      showToast('Error streaming secure document', 'error');
    }
  };

  window.openRecordPurchaseModal = function (bookId) {
    const modal = document.getElementById('modal-record-purchase');
    if (!modal) return;
    const select = document.getElementById('purchase-book-select');
    if (select && bookId) {
      select.value = bookId;
      select.dispatchEvent(new Event('change'));
    }
    modal.classList.add('active');
  };

  window.openUpdateProgressModal = function (bookId, totalPages) {
    const modal = document.getElementById('modal-update-progress');
    if (!modal) return;
    const select = document.getElementById('progress-book-select');
    if (select && bookId) select.value = bookId;
    const totInput = document.getElementById('progress-total-pages');
    if (totInput && totalPages) totInput.value = totalPages;
    modal.classList.add('active');
  };

  window.promptQuickPageUpdate = async function (bookId, memberId, curPage, totPages) {
    const newPageStr = prompt(`Enter current page number (Total: ${totPages}):`, curPage);
    if (newPageStr === null) return;
    const newPage = parseInt(newPageStr, 10);
    if (isNaN(newPage)) return;

    try {
      const res = await fetch('/api/v1/admin/library/progress', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          book_id: bookId,
          member_id: memberId,
          current_page: newPage,
          total_pages: totPages
        })
      });
      if (res.ok) {
        showToast('Reading progress updated!');
        await Promise.all([loadReadingProgress(), loadKpis(), loadBooks()]);
      }
    } catch (err) {
      console.error(err);
      showToast('Error updating page', 'error');
    }
  };

  window.filterByCategory = function (catName) {
    const tabs = document.querySelectorAll('.lib-tab-btn');
    tabs.forEach(t => t.classList.remove('active'));
    const targetBtn = document.querySelector('.lib-tab-btn[data-tab="catalogue"]');
    if (targetBtn) targetBtn.classList.add('active');

    document.querySelectorAll('.lib-tab-content').forEach(c => c.style.display = 'none');
    const target = document.getElementById('tab-catalogue');
    if (target) target.style.display = 'block';

    const catSelect = document.getElementById('filter-lib-category');
    if (catSelect) {
      catSelect.value = catName;
      activeCategoryFilter = catName;
      loadBooks();
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

