/**
 * Virtex Admin - Finance and Billing Expansion Controller
 * Manages admission fees, packages, app access, payments, invoices, receipts,
 * outstanding dues, refunds, discounts, expenses, commissions, and revenue analytics.
 */

(function () {
  'use strict';

  // Global State
  let transactions = [];
  let packages = [];
  let duesReport = [];
  let expenses = [];
  let commissions = [];
  let refunds = [];
  let discounts = [];
  let monthlyReports = [];
  let membersList = [];
  let analyticsData = null;

  let currentTab = 'transactions';
  let activeTxType = 'All';
  let activeTxStatus = 'All';

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
    toast.className = `fin-toast toast-${type}`;
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
    toast.innerHTML = `<span>${type === 'success' ? '💰' : '⚠️'}</span> <span>${message}</span>`;
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
      loadAnalytics(),
      loadTransactions(),
      loadPackages(),
      loadDuesReport(),
      loadExpenses(),
      loadCommissions(),
      loadRefundsAndDiscounts(),
      loadMonthlyReports()
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
    const selects = ['tx-member-select', 'admission-member-select', 'refund-member-select', 'settle-member-select'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">-- Choose Member --</option>' +
          membersList.map(m => `<option value="${m.id}">${m.full_name || m.name} (${m.member_code || '#' + m.id})</option>`).join('');
      }
    });
  }

  // Tab Listeners
  function setupTabListeners() {
    const tabs = document.querySelectorAll('.fin-tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.getAttribute('data-tab');

        document.querySelectorAll('.fin-tab-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById(`tab-${currentTab}`);
        if (target) target.style.display = 'block';
      });
    });

    function checkFinanceHash() {
      let hash = window.location.hash ? window.location.hash.replace('#', '').toLowerCase() : '';
      if (hash === 'payouts') hash = 'commissions';
      if (hash === 'expenses') hash = 'expenses';
      const targetBtn = document.querySelector(`.fin-tab-btn[data-tab="${hash}"]`);
      if (targetBtn) targetBtn.click();
    }
    checkFinanceHash();
    window.addEventListener('hashchange', checkFinanceHash);
  }

  // Filter Listeners
  function setupFilterListeners() {
    const typeFilter = document.getElementById('filter-tx-type');
    if (typeFilter) {
      typeFilter.addEventListener('change', (e) => {
        activeTxType = e.target.value;
        loadTransactions();
      });
    }

    const statusFilter = document.getElementById('filter-tx-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        activeTxStatus = e.target.value;
        loadTransactions();
      });
    }

    const searchInput = document.getElementById('tx-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderTransactions();
      });
    }
  }

  // API Callers
  async function loadAnalytics() {
    try {
      const res = await fetch('/api/v1/admin/finance/analytics/summary', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        analyticsData = json.data || null;
        renderAnalytics();
      }
    } catch (err) {
      console.error('Failed to load financial analytics:', err);
    }
  }

  async function loadTransactions() {
    try {
      let url = '/api/v1/admin/finance/transactions/all?';
      if (activeTxType !== 'All') url += `transaction_type=${encodeURIComponent(activeTxType)}&`;
      if (activeTxStatus !== 'All') url += `payment_status=${encodeURIComponent(activeTxStatus)}&`;

      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        transactions = json.data || [];
        const badge = document.getElementById('badge-tx-count');
        if (badge) badge.textContent = transactions.length;
        renderTransactions();
      }
    } catch (err) {
      console.error('Failed to load transactions:', err);
    }
  }

  async function loadPackages() {
    try {
      const res = await fetch('/api/v1/admin/finance/packages', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        packages = json.data || [];
        const badge = document.getElementById('badge-packages-count');
        if (badge) badge.textContent = packages.length;
        renderPackages();
      }
    } catch (err) {
      console.error('Failed to load packages:', err);
    }
  }

  async function loadDuesReport() {
    try {
      const res = await fetch('/api/v1/admin/finance/dues/report', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        duesReport = json.data || [];
        const badge = document.getElementById('badge-dues-count');
        if (badge) badge.textContent = duesReport.length;
        renderDuesReport();
      }
    } catch (err) {
      console.error('Failed to load dues report:', err);
    }
  }

  async function loadExpenses() {
    try {
      const res = await fetch('/api/v1/admin/finance/expenses/all', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        expenses = json.data || [];
        const badge = document.getElementById('badge-expenses-count');
        if (badge) badge.textContent = expenses.length;
        renderExpenses();
      }
    } catch (err) {
      console.error('Failed to load expenses:', err);
    }
  }

  async function loadCommissions() {
    try {
      const res = await fetch('/api/v1/admin/finance/commissions/all', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        commissions = json.data || [];
        const badge = document.getElementById('badge-commissions-count');
        if (badge) badge.textContent = commissions.length;
        renderCommissions();
      }
    } catch (err) {
      console.error('Failed to load commissions:', err);
    }
  }

  async function loadRefundsAndDiscounts() {
    try {
      const [refRes, discRes] = await Promise.all([
        fetch('/api/v1/admin/finance/refunds/all', { headers: getAuthHeaders() }),
        fetch('/api/v1/admin/finance/discounts/all', { headers: getAuthHeaders() })
      ]);

      if (refRes.ok) {
        const rJson = await refRes.json();
        refunds = rJson.data || [];
        renderRefunds();
      }

      if (discRes.ok) {
        const dJson = await discRes.json();
        discounts = dJson.data || [];
        renderDiscounts();
      }
    } catch (err) {
      console.error('Failed to load refunds/discounts:', err);
    }
  }

  async function loadMonthlyReports() {
    try {
      const res = await fetch('/api/v1/admin/finance/reports/monthly', { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        monthlyReports = json.data || [];
        renderMonthlyReports();
      }
    } catch (err) {
      console.error('Failed to load monthly reports:', err);
    }
  }

  // Render Functions
  function renderAnalytics() {
    if (!analyticsData) return;
    const { totalRevenue, netOperatingProfit, totalOperatingExpenses, totalOutstandingDues, totalTrainerCommissions } = analyticsData;

    const revEl = document.getElementById('kpi-total-revenue');
    if (revEl) revEl.textContent = `₹${Number(totalRevenue || 0).toLocaleString()}`;

    const profEl = document.getElementById('kpi-operating-profit');
    if (profEl) {
      profEl.textContent = `₹${Number(netOperatingProfit || 0).toLocaleString()}`;
      profEl.className = netOperatingProfit >= 0 ? 'pl-positive' : 'pl-negative';
    }

    const expEl = document.getElementById('kpi-operating-expenses');
    if (expEl) expEl.textContent = `₹${Number(totalOperatingExpenses || 0).toLocaleString()}`;

    const dueEl = document.getElementById('kpi-outstanding-dues');
    if (dueEl) dueEl.textContent = `₹${Number(totalOutstandingDues || 0).toLocaleString()}`;

    const commEl = document.getElementById('kpi-trainer-commissions');
    if (commEl) commEl.textContent = `₹${Number(totalTrainerCommissions || 0).toLocaleString()}`;
  }

  function renderTransactions() {
    const tbody = document.getElementById('transactions-table-body');
    if (!tbody) return;

    const search = document.getElementById('tx-search-input')?.value.toLowerCase() || '';
    let filtered = transactions;
    if (search) {
      filtered = filtered.filter(t => (t.member_name || '').toLowerCase().includes(search) || t.invoice_number.toLowerCase().includes(search));
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2.5rem; color: #64748b;">
            No transactions found. Click "+ Record Inflow Transaction" to log payments.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(t => `
      <tr>
        <td>
          ${t.member_id
            ? `<div style="font-weight: 700; color: #fff;">${escapeHtml(t.member_name || 'Member')}</div>
          <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(t.member_code || '')}</div>`
            : `<div style="font-weight: 700; color: #94a3b8;">No member linked</div>
          <div style="font-size: 0.75rem; color: #64748b; max-width: 220px;">${escapeHtml(t.notes || 'Payment not linked to a member record')}</div>`}
        </td>
        <td>
          <span class="badge badge-blue font-mono" style="text-transform: uppercase;">${escapeHtml(t.transaction_type)}</span>
        </td>
        <td>
          <span style="font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; color: #94a3b8;">
            ${new Date(t.transaction_date).toLocaleDateString()}
          </span>
        </td>
        <td>
          <span style="font-size: 0.82rem; color: #cbd5e1;">${escapeHtml(t.payment_method)}</span>
        </td>
        <td>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; font-weight: 700; color: #00e676;">
            ₹${Number(t.net_amount).toFixed(2)}
          </div>
          <div style="font-size: 0.72rem; color: #64748b;">Incl. ₹${Number(t.tax_amount).toFixed(2)} GST</div>
        </td>
        <td>
          <span class="badge badge-green">${escapeHtml(t.payment_status.toUpperCase())}</span>
        </td>
        <td>
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: #00e5ff;">${escapeHtml(t.invoice_number)}</span>
        </td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="window.viewTaxInvoice(${t.id})">
            Tax Invoice 📄
          </button>
        </td>
      </tr>
    `).join('');
  }

  function renderPackages() {
    const grid = document.getElementById('packages-grid-container');
    if (!grid) return;

    grid.innerHTML = packages.map(p => `
      <div class="pricing-card ${p.is_featured ? 'pricing-featured' : ''}">
        ${p.badge_label ? `<span class="pricing-badge">${escapeHtml(p.badge_label)}</span>` : ''}
        <h3 style="font-size: 1.25rem; font-weight: 800; color: #fff; margin: 0 0 4px 0;">${escapeHtml(p.name)}</h3>
        <span style="font-size: 0.82rem; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">Duration: ${p.duration_months} Month(s)</span>
        <div class="price-val">₹${Number(p.price_inr).toFixed(2)}</div>
        <span style="font-size: 0.75rem; color: #64748b;">Includes 18% GST Applicable</span>

        <ul class="perks-list">
          ${(p.perks || ['Full Gym Floor Access', 'Locker Room & Shower', 'FitBot Robot AI Sync']).map(perk => `<li>${escapeHtml(perk)}</li>`).join('')}
        </ul>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #1e2433; padding-top: 12px; margin-top: auto;">
          <span style="font-size: 0.8rem; color: #00e676; font-family: 'JetBrains Mono', monospace;">
            ${p.active_subscribers_count || 0} Active Lifters
          </span>
          <button class="btn btn-outline btn-xs" onclick="window.openEditPackageModal(${p.id}, '${escapeHtml(p.name)}', ${p.price_inr}, '${escapeHtml(p.badge_label || '')}')">
            Edit Price ✏️
          </button>
        </div>
      </div>
    `).join('');
  }

  function renderDuesReport() {
    const tbody = document.getElementById('dues-table-body');
    if (!tbody) return;

    if (duesReport.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: #00e676;">
            ✓ All gym members are fully settled! Zero outstanding dues detected.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = duesReport.map(d => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(d.member_name)}</div>
          <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(d.member_code)}</div>
        </td>
        <td>
          <span style="font-size: 0.85rem; color: #cbd5e1;">${escapeHtml(d.plan_name || 'Custom Plan')}</span>
        </td>
        <td>
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: #94a3b8;">${escapeHtml(d.member_phone || '—')}</span>
        </td>
        <td>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 1rem; font-weight: 800; color: #ff5252;">
            ₹${Number(d.fee_due).toFixed(2)}
          </div>
        </td>
        <td>
          <span style="font-size: 0.82rem; font-family: 'JetBrains Mono', monospace; color: #cbd5e1;">
            ${d.fee_due_date ? new Date(d.fee_due_date).toLocaleDateString() : 'Immediate'}
          </span>
        </td>
        <td>
          <span class="badge ${d.overdue_days > 0 ? 'badge-gold' : 'badge-blue'} font-mono">
            ${d.overdue_days > 0 ? `${d.overdue_days} Days Overdue` : 'Pending Current'}
          </span>
        </td>
        <td>
          <button class="btn btn-green btn-xs" onclick="window.openSettleDueModal(${d.member_id}, '${escapeHtml(d.member_name)}', ${d.fee_due})">
            Settle Due 💳
          </button>
        </td>
      </tr>
    `).join('');
  }

  function renderExpenses() {
    const tbody = document.getElementById('expenses-table-body');
    if (!tbody) return;

    tbody.innerHTML = expenses.map(e => `
      <tr>
        <td>
          <span class="badge badge-outline font-mono">${escapeHtml(e.category)}</span>
        </td>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(e.title)}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">Vendor: ${escapeHtml(e.vendor_name)}</div>
        </td>
        <td>
          <span style="font-size: 0.82rem; font-family: 'JetBrains Mono', monospace; color: #cbd5e1;">
            ${new Date(e.expense_date).toLocaleDateString()}
          </span>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: #94a3b8;">${escapeHtml(e.payment_method)}</span>
        </td>
        <td>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; font-weight: 700; color: #ff5252;">
            ₹${Number(e.amount).toFixed(2)}
          </div>
        </td>
        <td>
          <span class="badge ${e.status === 'paid' ? 'badge-green' : 'badge-gold'}">${escapeHtml(e.status.toUpperCase())}</span>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(e.invoice_ref || '—')}</span>
        </td>
      </tr>
    `).join('');
  }

  function renderCommissions() {
    const tbody = document.getElementById('commissions-table-body');
    if (!tbody) return;

    tbody.innerHTML = commissions.map(c => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(c.trainer_name)}</div>
          <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(c.trainer_specialty || 'Coach')}</div>
        </td>
        <td>
          <span style="font-size: 0.85rem; color: #00e5ff;">${escapeHtml(c.client_name || 'Assigned Client')}</span>
        </td>
        <td>
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: #fff;">${escapeHtml(c.period_month)}</span>
        </td>
        <td>
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: #cbd5e1;">₹${Number(c.gross_revenue).toFixed(2)}</span>
        </td>
        <td>
          <span class="badge badge-gold font-mono">${c.commission_rate_pct}%</span>
        </td>
        <td>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 1rem; font-weight: 800; color: #00e676;">
            ₹${Number(c.commission_amount).toFixed(2)}
          </div>
        </td>
        <td>
          <span class="badge ${c.payout_status === 'paid' ? 'badge-green' : 'badge-gold'}">${escapeHtml(c.payout_status.toUpperCase())}</span>
        </td>
      </tr>
    `).join('');
  }

  function renderRefunds() {
    const tbody = document.getElementById('refunds-table-body');
    if (!tbody) return;

    tbody.innerHTML = refunds.map(r => `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(r.member_name)}</div>
          <div style="font-size: 0.75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${escapeHtml(r.member_code)}</div>
        </td>
        <td>
          <span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #ff5252;">₹${Number(r.amount).toFixed(2)}</span>
        </td>
        <td>
          <span style="font-size: 0.82rem; color: #cbd5e1;">${escapeHtml(r.reason)}</span>
        </td>
        <td>
          <span class="badge ${r.status === 'approved' || r.status === 'processed' ? 'badge-green' : 'badge-gold'}">${escapeHtml(r.status.toUpperCase())}</span>
        </td>
        <td>
          <span style="font-size: 0.78rem; font-family: 'JetBrains Mono', monospace; color: #94a3b8;">
            ${new Date(r.requested_at).toLocaleDateString()}
          </span>
        </td>
        <td>
          ${r.status === 'requested' ? `
            <button class="btn btn-outline btn-xs" onclick="window.processRefundStatus(${r.id}, 'approved')">Approve ✓</button>
          ` : `<span style="font-size: 0.78rem; color: #64748b;">Resolved</span>`}
        </td>
      </tr>
    `).join('');
  }

  function renderDiscounts() {
    const tbody = document.getElementById('discounts-table-body');
    if (!tbody) return;

    tbody.innerHTML = discounts.map(d => `
      <tr>
        <td>
          <span style="font-family: 'JetBrains Mono', monospace; font-weight: 800; color: #ffd600;">${escapeHtml(d.code)}</span>
        </td>
        <td>
          <span style="font-size: 0.85rem; color: #cbd5e1;">${escapeHtml(d.description)}</span>
        </td>
        <td>
          <span class="badge badge-green font-mono">${d.discount_type === 'percentage' ? d.discount_value + '%' : '₹' + d.discount_value} OFF</span>
        </td>
        <td>
          <span style="font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; color: #94a3b8;">
            ${new Date(d.start_date).toLocaleDateString()} - ${new Date(d.end_date).toLocaleDateString()}
          </span>
        </td>
        <td>
          <span style="font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; color: #cbd5e1;">${d.times_used} / ${d.max_uses}</span>
        </td>
        <td>
          <span class="badge ${d.is_active ? 'badge-green' : 'badge-outline'}">${d.is_active ? 'ACTIVE' : 'INACTIVE'}</span>
        </td>
      </tr>
    `).join('');
  }

  function renderMonthlyReports() {
    const tbody = document.getElementById('monthly-reports-table-body');
    if (!tbody) return;

    tbody.innerHTML = monthlyReports.map(m => {
      const profit = parseFloat(m.net_profit || 0);
      return `
        <tr>
          <td>
            <strong style="color: #fff; font-family: 'JetBrains Mono', monospace;">${escapeHtml(m.month)}</strong>
          </td>
          <td>
            <span style="font-family: 'JetBrains Mono', monospace; color: #00e676;">₹${Number(m.gross_revenue).toFixed(2)}</span>
          </td>
          <td>
            <span style="font-family: 'JetBrains Mono', monospace; color: #00e5ff;">₹${Number(m.tax_collected).toFixed(2)}</span>
          </td>
          <td>
            <span style="font-family: 'JetBrains Mono', monospace; color: #ffd600;">₹${Number(m.total_refunds).toFixed(2)}</span>
          </td>
          <td>
            <span style="font-family: 'JetBrains Mono', monospace; color: #ff5252;">₹${Number(m.total_expenses).toFixed(2)}</span>
          </td>
          <td>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; font-weight: 800;" class="${profit >= 0 ? 'pl-positive' : 'pl-negative'}">
              ₹${profit.toFixed(2)}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Modals & User Actions
  function setupModalListeners() {
    // Open New Transaction Modal
    const btnNewTx = document.getElementById('btn-open-tx-modal');
    if (btnNewTx) {
      btnNewTx.addEventListener('click', () => {
        document.getElementById('modal-new-transaction').classList.add('active');
      });
    }

    // Open New Expense Modal
    const btnNewExp = document.getElementById('btn-open-expense-modal');
    if (btnNewExp) {
      btnNewExp.addEventListener('click', () => {
        document.getElementById('modal-new-expense').classList.add('active');
      });
    }

    // Open New Discount Modal
    const btnNewDisc = document.getElementById('btn-open-discount-modal');
    if (btnNewDisc) {
      btnNewDisc.addEventListener('click', () => {
        document.getElementById('modal-new-discount').classList.add('active');
      });
    }

    // Calculate Commissions Button
    const btnCalcComm = document.getElementById('btn-calculate-commissions');
    if (btnCalcComm) {
      btnCalcComm.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/v1/admin/finance/commissions/calculate', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ period_month: new Date().toISOString().slice(0, 7) })
          });
          const json = await res.json();
          if (res.ok) {
            showToast('Trainer commissions calculated for current month!');
            await Promise.all([loadCommissions(), loadAnalytics()]);
          } else {
            showToast(json.message || 'Failed to calculate commissions', 'error');
          }
        } catch (err) {
          console.error(err);
          showToast('Error calculating commissions', 'error');
        }
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
    const formTx = document.getElementById('form-new-transaction');
    if (formTx) formTx.addEventListener('submit', handleCreateTransaction);

    const formExp = document.getElementById('form-new-expense');
    if (formExp) formExp.addEventListener('submit', handleCreateExpense);

    const formDisc = document.getElementById('form-new-discount');
    if (formDisc) formDisc.addEventListener('submit', handleCreateDiscount);

    const formPkg = document.getElementById('form-edit-package');
    if (formPkg) formPkg.addEventListener('submit', handleEditPackage);

    const formSettle = document.getElementById('form-settle-due');
    if (formSettle) formSettle.addEventListener('submit', handleSettleDue);
  }

  // Action Handlers
  async function handleCreateTransaction(e) {
    e.preventDefault();
    const data = {
      member_id: parseInt(document.getElementById('tx-member-select').value, 10),
      transaction_type: document.getElementById('tx-type').value,
      amount: parseFloat(document.getElementById('tx-amount').value),
      discount_amount: parseFloat(document.getElementById('tx-discount').value) || 0.00,
      payment_method: document.getElementById('tx-method').value,
      notes: document.getElementById('tx-notes').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/finance/transactions', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Payment transaction and Tax Invoice generated!');
        document.getElementById('modal-new-transaction').classList.remove('active');
        document.getElementById('form-new-transaction').reset();
        await Promise.all([loadTransactions(), loadAnalytics(), loadDuesReport()]);
      } else {
        showToast(json.message || 'Failed to record transaction', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error recording transaction', 'error');
    }
  }

  async function handleCreateExpense(e) {
    e.preventDefault();
    const data = {
      category: document.getElementById('exp-category').value,
      title: document.getElementById('exp-title').value.trim(),
      vendor_name: document.getElementById('exp-vendor').value.trim(),
      amount: parseFloat(document.getElementById('exp-amount').value),
      expense_date: document.getElementById('exp-date').value,
      payment_method: document.getElementById('exp-method').value,
      invoice_ref: document.getElementById('exp-ref').value.trim(),
      notes: document.getElementById('exp-notes').value.trim()
    };

    try {
      const res = await fetch('/api/v1/admin/finance/expenses', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Operating expense logged into ledger!');
        document.getElementById('modal-new-expense').classList.remove('active');
        document.getElementById('form-new-expense').reset();
        await Promise.all([loadExpenses(), loadAnalytics(), loadMonthlyReports()]);
      } else {
        showToast(json.message || 'Failed to record expense', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error recording expense', 'error');
    }
  }

  async function handleCreateDiscount(e) {
    e.preventDefault();
    const data = {
      code: document.getElementById('disc-code').value.trim().toUpperCase(),
      description: document.getElementById('disc-desc').value.trim(),
      discount_type: document.getElementById('disc-type').value,
      discount_value: parseFloat(document.getElementById('disc-value').value),
      min_purchase_amount: parseFloat(document.getElementById('disc-min-amount').value) || 0.00,
      start_date: document.getElementById('disc-start-date').value,
      end_date: document.getElementById('disc-end-date').value,
      max_uses: parseInt(document.getElementById('disc-max-uses').value, 10) || 100
    };

    try {
      const res = await fetch('/api/v1/admin/finance/discounts', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Promotional discount offer active!');
        document.getElementById('modal-new-discount').classList.remove('active');
        document.getElementById('form-new-discount').reset();
        await loadRefundsAndDiscounts();
      } else {
        showToast(json.message || 'Failed to create discount', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error creating discount', 'error');
    }
  }

  let selectedEditPackageId = null;
  async function handleEditPackage(e) {
    e.preventDefault();
    if (!selectedEditPackageId) return;

    const data = {
      price_inr: parseFloat(document.getElementById('pkg-price').value),
      badge_label: document.getElementById('pkg-badge').value.trim()
    };

    try {
      const res = await fetch(`/api/v1/admin/finance/packages/${selectedEditPackageId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Membership package pricing updated!');
        document.getElementById('modal-edit-package').classList.remove('active');
        await loadPackages();
      } else {
        showToast(json.message || 'Failed to update package', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error updating package', 'error');
    }
  }

  let selectedSettleMemberId = null;
  async function handleSettleDue(e) {
    e.preventDefault();
    if (!selectedSettleMemberId) return;

    const amount = parseFloat(document.getElementById('settle-amount').value);
    const method = document.getElementById('settle-method').value;

    const data = {
      member_id: selectedSettleMemberId,
      transaction_type: 'membership',
      amount: amount,
      discount_amount: 0.00,
      payment_method: method,
      notes: 'Outstanding dues settlement'
    };

    try {
      const res = await fetch('/api/v1/admin/finance/transactions', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok) {
        showToast('Outstanding dues settled successfully!');
        document.getElementById('modal-settle-due').classList.remove('active');
        await Promise.all([loadDuesReport(), loadTransactions(), loadAnalytics()]);
      } else {
        showToast(json.message || 'Failed to settle dues', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error settling dues', 'error');
    }
  }

  // Global Window Helpers
  window.viewTaxInvoice = async function (txId) {
    try {
      const res = await fetch(`/api/v1/admin/finance/transactions/${txId}/invoice`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const inv = json.data;

      const container = document.getElementById('invoice-render-area');
      if (!container) return;

      container.innerHTML = `
        <div class="invoice-card">
          <div class="invoice-header">
            <div>
              <h2 style="font-size: 1.5rem; font-weight: 800; color: #fff; margin: 0;">VIRTEX FITNESS</h2>
              <div style="font-size: 0.8rem; color: #00e676; font-weight: 700;">OFFICIAL TAX INVOICE (GST REG. 29AAAAA0000A1Z5)</div>
              <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 4px;">Main Arena, Commercial Boulevard, Bengaluru</div>
            </div>
            <div style="text-align: right;">
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 1.1rem; font-weight: 800; color: #00e5ff;">${escapeHtml(inv.invoiceNumber)}</div>
              <div style="font-size: 0.8rem; color: #94a3b8;">Date: ${new Date(inv.date).toLocaleDateString()}</div>
              <div style="font-size: 0.8rem; color: #ffd600;">Receipt: ${escapeHtml(inv.receiptNumber)}</div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; background: #11141e; padding: 14px; border-radius: 8px; margin-bottom: 20px;">
            <div>
              <span style="font-size: 0.72rem; color: #64748b; text-transform: uppercase;">Billed To (Member)</span>
              <div style="color: #fff; font-weight: 700; font-size: 1.05rem;">${escapeHtml(inv.member?.name || 'No member linked')}</div>
              <div style="font-size: 0.8rem; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">${inv.member?.id ? `Code: ${escapeHtml(inv.member.code || '#' + inv.member.id)}` : 'Not linked to a member record'}</div>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 0.72rem; color: #64748b; text-transform: uppercase;">Payment Details</span>
              <div style="color: #00e676; font-weight: 700;">${escapeHtml(inv.paymentMethod)}</div>
              <span class="badge badge-green font-mono">${escapeHtml(inv.paymentStatus.toUpperCase())}</span>
            </div>
          </div>

          <table class="invoice-table">
            <thead>
              <tr>
                <th>Description</th>
                <th style="text-align: right;">Gross (₹)</th>
                <th style="text-align: right;">GST @ 18% (₹)</th>
                <th style="text-align: right;">Total Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${inv.lineItems.map(item => `
                <tr>
                  <td style="color: #fff; font-weight: 600;">${escapeHtml(item.description)}</td>
                  <td style="text-align: right; font-family: 'JetBrains Mono', monospace;">₹${item.amount.toFixed(2)}</td>
                  <td style="text-align: right; font-family: 'JetBrains Mono', monospace; color: #00e5ff;">₹${item.gstTax18Pct.toFixed(2)}</td>
                  <td style="text-align: right; font-family: 'JetBrains Mono', monospace; font-weight: 800; color: #00e676;">₹${item.netTotal.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div style="display: flex; justify-content: flex-end; margin-bottom: 20px;">
            <div style="width: 260px; background: #0b0d14; padding: 14px; border-radius: 8px; border: 1px solid #1e2433; font-family: 'JetBrains Mono', monospace;">
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #94a3b8; margin-bottom: 6px;">
                <span>Taxable Amount:</span> <span>₹${inv.grossTotal.toFixed(2)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #00e5ff; margin-bottom: 8px;">
                <span>CGST (9%) + SGST (9%):</span> <span>₹${inv.gstTotal.toFixed(2)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 1.1rem; font-weight: 800; color: #fff; border-top: 1px solid #1e2433; padding-top: 8px;">
                <span>Net Paid:</span> <span style="color: #00e676;">₹${inv.netPayable.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #1e2433; padding-top: 14px; font-size: 0.78rem; color: #64748b;">
            <div>Computer generated tax invoice. No physical signature required.</div>
            <button class="btn btn-green btn-xs" onclick="window.print()">Print Official Receipt 🖨️</button>
          </div>
        </div>
      `;

      document.getElementById('modal-invoice').classList.add('active');
    } catch (err) {
      console.error(err);
      showToast('Error loading tax invoice', 'error');
    }
  };

  window.openEditPackageModal = function (pkgId, name, price, badge) {
    selectedEditPackageId = pkgId;
    document.getElementById('pkg-name-display').textContent = name;
    document.getElementById('pkg-price').value = price;
    document.getElementById('pkg-badge').value = badge;
    document.getElementById('modal-edit-package').classList.add('active');
  };

  window.openSettleDueModal = function (memberId, name, dueAmount) {
    selectedSettleMemberId = memberId;
    document.getElementById('settle-member-name').textContent = name;
    document.getElementById('settle-amount').value = dueAmount;
    document.getElementById('modal-settle-due').classList.add('active');
  };

  window.processRefundStatus = async function (refundId, status) {
    try {
      const res = await fetch(`/api/v1/admin/finance/refunds/${refundId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status, notes: 'Approved by Admin' })
      });
      if (res.ok) {
        showToast('Refund processed successfully!');
        await Promise.all([loadRefundsAndDiscounts(), loadAnalytics(), loadMonthlyReports()]);
      }
    } catch (err) {
      console.error(err);
      showToast('Error processing refund', 'error');
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

