/**
 * Virtex Admin - Gym Equipment and Inventory Management Controller
 * Handles 12 core features:
 * 1. Gym equipment inventory
 * 2. Equipment registration
 * 3. Equipment categories
 * 4. Equipment condition status & live updates
 * 5. Equipment maintenance schedules & countdowns
 * 6. Service history logs & maintenance cost tracking
 * 7. Supplement inventory
 * 8. Merchandise inventory
 * 9. Supplier management
 * 10. Purchase orders
 * 11. Low-stock alerts
 * 12. Asset & inventory valuation reports
 */

(function () {
  'use strict';

  // API Endpoints (supporting direct route or /admin prefix)
  const API_BASE = '/api/inventory';
  const API_ADMIN_BASE = '/api/admin/inventory';

  // Local State
  let state = {
    currentTab: 'equipment',
    equipment: [],
    serviceLogs: [],
    retailItems: [],
    lowStockAlerts: [],
    suppliers: [],
    purchaseOrders: [],
    kpis: null,
    reports: null,
    filters: {
      eqCategory: 'all',
      eqCondition: 'all',
      eqZone: 'all',
      eqSearch: '',
      retailCategory: 'all',
      retailStatus: 'all',
      retailSearch: '',
      poStatus: 'all'
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

  // Unified Fetch with fallback to /api/admin/inventory
  async function apiFetch(endpoint, options = {}) {
    const opts = {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...(options.headers || {})
      }
    };

    // Try primary path first
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, opts);
      if (res.status === 404) {
        // Fallback to /api/admin/inventory
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
    toast.className = `inv-toast toast-${type}`;
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
    toast.innerHTML = `<span>${type === 'success' ? '📦' : '⚠️'}</span> <span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Currency & Date Formatters
  function formatCurrency(val) {
    const num = parseFloat(val) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  function getDaysUntil(dStr) {
    if (!dStr) return null;
    const target = new Date(dStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    const diffTime = target - today;
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  }

  // ==========================================
  // INITIALIZATION & TAB SWITCHING
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initFilterListeners();
    initModalHandlers();
    loadAllData();
  });

  function checkUrlHashTab() {
    const hash = window.location.hash.toLowerCase().replace('#', '');
    if (!hash) return;
    const tabMap = {
      'maintenance': 'service',
      'service': 'service',
      'retail': 'retail',
      'alerts': 'alerts',
      'suppliers': 'suppliers',
      'reports': 'reports',
      'equipment': 'equipment'
    };
    const target = tabMap[hash];
    if (target) {
      const btn = document.querySelector(`.inv-tab-btn[data-tab="${target}"]`);
      if (btn) btn.click();
    }
  }

  function initTabs() {
    const tabBtns = document.querySelectorAll('.inv-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentTab = btn.dataset.tab;

        document.querySelectorAll('.inv-tab-content').forEach(pane => {
          pane.style.display = 'none';
        });

        const activePane = document.getElementById(`tab-content-${state.currentTab}`);
        if (activePane) {
          activePane.style.display = 'block';
        }

        // Lazy reload reports if switching to reports tab
        if (state.currentTab === 'reports') {
          loadReports();
        }
      });
    });

    window.addEventListener('hashchange', checkUrlHashTab);
    checkUrlHashTab();
  }

  function initFilterListeners() {
    // Equipment filters
    const eqCatSelect = document.getElementById('eq-filter-category');
    const eqCondSelect = document.getElementById('eq-filter-condition');
    const eqZoneSelect = document.getElementById('eq-filter-zone');
    const eqSearch = document.getElementById('eq-search');

    if (eqCatSelect) {
      eqCatSelect.addEventListener('change', (e) => {
        state.filters.eqCategory = e.target.value;
        renderEquipment();
      });
    }
    if (eqCondSelect) {
      eqCondSelect.addEventListener('change', (e) => {
        state.filters.eqCondition = e.target.value;
        renderEquipment();
      });
    }
    if (eqZoneSelect) {
      eqZoneSelect.addEventListener('change', (e) => {
        state.filters.eqZone = e.target.value;
        renderEquipment();
      });
    }
    if (eqSearch) {
      eqSearch.addEventListener('input', (e) => {
        state.filters.eqSearch = e.target.value.toLowerCase();
        renderEquipment();
      });
    }

    // Retail filters
    const retailCat = document.getElementById('retail-filter-category');
    const retailStatus = document.getElementById('retail-filter-status');
    const retailSearch = document.getElementById('retail-search');

    if (retailCat) {
      retailCat.addEventListener('change', (e) => {
        state.filters.retailCategory = e.target.value;
        renderRetail();
      });
    }
    if (retailStatus) {
      retailStatus.addEventListener('change', (e) => {
        state.filters.retailStatus = e.target.value;
        renderRetail();
      });
    }
    if (retailSearch) {
      retailSearch.addEventListener('input', (e) => {
        state.filters.retailSearch = e.target.value.toLowerCase();
        renderRetail();
      });
    }

    // PO Status filter
    const poStatus = document.getElementById('po-filter-status');
    if (poStatus) {
      poStatus.addEventListener('change', (e) => {
        state.filters.poStatus = e.target.value;
        renderPurchaseOrders();
      });
    }
  }

  // ==========================================
  // DATA FETCHING
  // ==========================================
  async function loadAllData() {
    await Promise.allSettled([
      loadKpis(),
      loadEquipment(),
      loadServiceLogs(),
      loadRetailInventory(),
      loadLowStockAlerts(),
      loadSuppliers(),
      loadPurchaseOrders()
    ]);
  }

  async function loadKpis() {
    try {
      const res = await apiFetch('/kpis');
      if (res && res.success) {
        state.kpis = res.data;
        renderKpis();
      }
    } catch (e) {
      console.error('Failed to load KPIs:', e);
    }
  }

  async function loadEquipment() {
    try {
      const res = await apiFetch('/equipment');
      if (res && res.success) {
        state.equipment = res.data;
        renderEquipment();
      }
    } catch (e) {
      console.error('Failed to load equipment:', e);
    }
  }

  async function loadServiceLogs() {
    try {
      const res = await apiFetch('/service-logs');
      if (res && res.success) {
        state.serviceLogs = res.data;
        renderServiceLogs();
      }
    } catch (e) {
      console.error('Failed to load service logs:', e);
    }
  }

  async function loadRetailInventory() {
    try {
      const res = await apiFetch('/retail');
      if (res && res.success) {
        state.retailItems = res.data;
        renderRetail();
      }
    } catch (e) {
      console.error('Failed to load retail items:', e);
    }
  }

  async function loadLowStockAlerts() {
    try {
      const res = await apiFetch('/low-stock-alerts');
      if (res && res.success) {
        state.lowStockAlerts = res.data;
        renderLowStockAlerts();
        updateAlertBadges();
      }
    } catch (e) {
      console.error('Failed to load low stock alerts:', e);
    }
  }

  async function loadSuppliers() {
    try {
      const res = await apiFetch('/suppliers');
      if (res && res.success) {
        state.suppliers = res.data;
        renderSuppliers();
        populateSupplierDropdowns();
      }
    } catch (e) {
      console.error('Failed to load suppliers:', e);
    }
  }

  async function loadPurchaseOrders() {
    try {
      const res = await apiFetch('/purchase-orders');
      if (res && res.success) {
        state.purchaseOrders = res.data;
        renderPurchaseOrders();
      }
    } catch (e) {
      console.error('Failed to load purchase orders:', e);
    }
  }

  async function loadReports() {
    try {
      const res = await apiFetch('/reports');
      if (res && res.success) {
        state.reports = res.data;
        renderReports();
      }
    } catch (e) {
      console.error('Failed to load reports:', e);
    }
  }

  // ==========================================
  // RENDERERS
  // ==========================================

  function renderKpis() {
    if (!state.kpis) return;
    const { equipment, retail, service, purchaseOrders } = state.kpis;

    const elEqCount = document.getElementById('kpi-total-equipment');
    const elAssetVal = document.getElementById('kpi-equipment-asset-val');
    const elRetailVal = document.getElementById('kpi-retail-val');
    const elLowStock = document.getElementById('kpi-low-stock-count');
    const elOpenPo = document.getElementById('kpi-open-po-count');

    if (elEqCount) elEqCount.textContent = equipment.total_equipment || 0;
    if (elAssetVal) elAssetVal.textContent = formatCurrency(equipment.total_equipment_asset_value);
    if (elRetailVal) elRetailVal.textContent = formatCurrency(retail.total_inventory_retail_value);
    if (elLowStock) elLowStock.textContent = retail.low_stock_sku_count || 0;
    if (elOpenPo) elOpenPo.textContent = purchaseOrders.open_po_count || 0;
  }

  function updateAlertBadges() {
    const badge = document.getElementById('tab-badge-alerts');
    if (badge) {
      const count = state.lowStockAlerts.length;
      badge.textContent = count;
      if (count > 0) {
        badge.classList.add('badge-alert');
      } else {
        badge.classList.remove('badge-alert');
      }
    }
  }

  // 1. Render Gym Equipment Registry
  function renderEquipment() {
    const container = document.getElementById('equipment-grid');
    if (!container) return;

    let items = state.equipment.filter(item => {
      if (state.filters.eqCategory !== 'all' && item.category !== state.filters.eqCategory) return false;
      if (state.filters.eqCondition !== 'all' && item.condition_status !== state.filters.eqCondition) return false;
      if (state.filters.eqZone !== 'all' && item.floor_zone !== state.filters.eqZone) return false;
      if (state.filters.eqSearch) {
        const q = state.filters.eqSearch;
        const matchName = item.name.toLowerCase().includes(q);
        const matchTag = item.asset_tag.toLowerCase().includes(q);
        const matchBrand = (item.brand || '').toLowerCase().includes(q);
        if (!matchName && !matchTag && !matchBrand) return false;
      }
      return true;
    });

    if (items.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 3rem; text-align: center; background: #11141e; border: 1px dashed #1e2433; border-radius: 10px;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🔍</div>
          <h4 style="color: #fff; margin-bottom: 6px;">No Equipment Found</h4>
          <p style="color: var(--text-dim); font-size: 0.88rem;">Try adjusting your search criteria or register a new gym asset.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(item => {
      const daysUntil = getDaysUntil(item.next_service_due);
      let scheduleClass = 'schedule-ok';
      let scheduleText = 'Scheduled';

      if (daysUntil !== null) {
        if (daysUntil < 0) {
          scheduleClass = 'schedule-overdue';
          scheduleText = `Overdue (${Math.abs(daysUntil)}d)`;
        } else if (daysUntil <= 7) {
          scheduleClass = 'schedule-due';
          scheduleText = `Due in ${daysUntil}d`;
        } else {
          scheduleText = `Due in ${daysUntil}d`;
        }
      }

      return `
        <div class="eq-card border-${item.condition_status}">
          <div>
            <div class="eq-header">
              <span class="eq-asset-tag">${escapeHtml(item.asset_tag)}</span>
              <span class="status-pill status-${item.condition_status}">
                ${formatConditionStatus(item.condition_status)}
              </span>
            </div>
            <h4 class="eq-title">${escapeHtml(item.name)}</h4>
            <div class="eq-brand-model">
              ${item.brand ? escapeHtml(item.brand) : 'Standard'} • ${item.category}
            </div>

            <div class="eq-details-grid">
              <div class="eq-detail-row">
                <span class="eq-detail-label">Floor Zone</span>
                <span class="eq-detail-value">📍 ${escapeHtml(item.floor_zone || 'Arena')}</span>
              </div>
              <div class="eq-detail-row">
                <span class="eq-detail-label">Asset Cost</span>
                <span class="eq-detail-value font-mono">${formatCurrency(item.purchase_cost)}</span>
              </div>
              <div class="eq-detail-row">
                <span class="eq-detail-label">Last Serviced</span>
                <span class="eq-detail-value">${formatDate(item.last_serviced_date)}</span>
              </div>
              <div class="eq-detail-row">
                <span class="eq-detail-label">Next Maintenance</span>
                <span class="eq-detail-value">
                  <span class="schedule-pill ${scheduleClass}">${scheduleText}</span>
                </span>
              </div>
            </div>
          </div>

          <div class="eq-actions">
            <button class="btn btn-sm btn-outline" onclick="window.VirtexInv.openServiceModal(${item.id})">
              🔧 Log Service
            </button>
            <button class="btn btn-sm btn-outline" onclick="window.VirtexInv.openEditConditionModal(${item.id})">
              ⚙️ Condition
            </button>
            <button class="btn btn-sm btn-outline" onclick="window.VirtexInv.openEditEquipmentModal(${item.id})">
              ✏️ Edit
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. Render Maintenance & Service Logs
  function renderServiceLogs() {
    const tbody = document.getElementById('service-logs-tbody');
    if (!tbody) return;

    if (state.serviceLogs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim);">
            No service history records logged yet.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = state.serviceLogs.map(log => `
      <tr>
        <td class="font-mono text-xs">${formatDate(log.service_date)}</td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(log.equipment_name)}</div>
          <span class="eq-asset-tag text-xs">${escapeHtml(log.asset_tag)}</span>
        </td>
        <td>
          <span class="badge badge-outline text-xs">${escapeHtml(log.service_type)}</span>
        </td>
        <td>
          <div style="font-weight: 500;">${escapeHtml(log.technician_name)}</div>
          <div style="font-size: 0.75rem; color: var(--text-dim);">${escapeHtml(log.vendor_name || 'In-House')}</div>
        </td>
        <td style="max-width: 250px;">
          <div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.3;">${escapeHtml(log.work_summary)}</div>
          ${log.parts_replaced ? `<div style="font-size: 0.75rem; color: var(--inv-accent); margin-top: 4px;">🔧 Parts: ${escapeHtml(log.parts_replaced)}</div>` : ''}
        </td>
        <td class="font-mono font-bold">${formatCurrency(log.cost)}</td>
        <td>
          <span class="status-pill status-${log.condition_after}">
            ${formatConditionStatus(log.condition_after)}
          </span>
        </td>
      </tr>
    `).join('');
  }

  // 3. Render Supplement & Merchandise Retail Pro-Shop
  function renderRetail() {
    const tbody = document.getElementById('retail-tbody');
    if (!tbody) return;

    let items = state.retailItems.filter(item => {
      if (state.filters.retailCategory !== 'all' && item.category !== state.filters.retailCategory) return false;
      if (state.filters.retailStatus !== 'all' && item.status !== state.filters.retailStatus) return false;
      if (state.filters.retailSearch) {
        const q = state.filters.retailSearch;
        const matchName = item.name.toLowerCase().includes(q);
        const matchSku = item.sku.toLowerCase().includes(q);
        const matchBrand = (item.brand || '').toLowerCase().includes(q);
        if (!matchName && !matchSku && !matchBrand) return false;
      }
      return true;
    });

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-dim);">
            No retail products found matching criteria.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items.map(item => {
      const margin = item.margin_percentage || 0;
      const marginClass = margin >= 40 ? 'margin-high' : 'margin-normal';

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: #fff;">${escapeHtml(item.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-dim); font-family: 'JetBrains Mono', monospace;">
              SKU: ${escapeHtml(item.sku)} • ${item.brand || 'Virtex'}
            </div>
          </td>
          <td>
            <span class="badge badge-outline text-xs">${escapeHtml(item.category)}</span>
          </td>
          <td class="font-mono font-bold text-green">${formatCurrency(item.unit_price)}</td>
          <td class="font-mono text-dim">${formatCurrency(item.cost_price)}</td>
          <td>
            <span class="margin-badge ${marginClass}">+${margin}%</span>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="font-mono font-bold ${item.stock_quantity <= item.reorder_threshold ? 'text-amber' : ''}">
                ${item.stock_quantity}
              </span>
              <span style="font-size: 0.75rem; color: var(--text-dim);">${escapeHtml(item.unit_measure || 'units')}</span>
            </div>
            <div style="font-size: 0.7rem; color: #64748b;">Threshold: ${item.reorder_threshold}</div>
          </td>
          <td>
            <span class="status-pill status-${item.status}">
              ${formatStockStatus(item.status)}
            </span>
          </td>
          <td>
            <button class="btn btn-sm btn-outline" onclick="window.VirtexInv.openAdjustStockModal(${item.id})">
              📦 Adjust
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 4. Render Low-Stock Alerts
  function renderLowStockAlerts() {
    const container = document.getElementById('low-stock-container');
    if (!container) return;

    if (state.lowStockAlerts.length === 0) {
      container.innerHTML = `
        <div style="padding: 2.5rem; text-align: center; background: #11141e; border: 1px solid #1e2433; border-radius: 10px;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">✅</div>
          <h4 style="color: #fff; margin-bottom: 6px;">All Stock Levels Healthy</h4>
          <p style="color: var(--text-dim); font-size: 0.88rem;">No supplements, merchandise, or accessories are currently below their reorder threshold.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.lowStockAlerts.map(item => `
      <div class="alert-banner-item">
        <div class="alert-item-meta">
          <div class="alert-badge-icon">⚠️</div>
          <div>
            <div style="font-weight: 700; color: #fff; font-size: 1rem;">${escapeHtml(item.name)}</div>
            <div style="font-size: 0.8rem; color: #cbd5e1; margin-top: 3px;">
              <span class="font-mono text-xs">SKU: ${escapeHtml(item.sku)}</span> • 
              <span>Supplier: <strong>${escapeHtml(item.supplier_name || 'Standard Vendor')}</strong></span>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 6px; font-size: 0.8rem;">
              <span style="color: var(--inv-red); font-weight: 600;">Current Stock: ${item.stock_quantity} units</span>
              <span style="color: var(--text-dim);">Min Threshold: ${item.reorder_threshold} units</span>
              <span style="color: var(--inv-cyan);">Suggested Order: <strong>${item.suggested_reorder_qty} units</strong></span>
              <span class="font-mono text-dim">Est. Cost: ${formatCurrency(item.estimated_reorder_cost)}</span>
            </div>
          </div>
        </div>
        <div>
          <button class="btn btn-sm btn-green" onclick="window.VirtexInv.quickCreatePOFromAlert(${item.id})">
            📝 Generate Purchase Order
          </button>
        </div>
      </div>
    `).join('');
  }

  // 5. Render Suppliers & Purchase Orders
  function renderSuppliers() {
    const container = document.getElementById('suppliers-grid');
    if (!container) return;

    if (state.suppliers.length === 0) {
      container.innerHTML = `<div style="color: var(--text-dim);">No suppliers registered yet.</div>`;
      return;
    }

    container.innerHTML = state.suppliers.map(sup => `
      <div class="admin-card" style="padding: 1.25rem; background: #11141e; border: 1px solid #1e2433; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <h4 style="color: #fff; font-weight: 700; font-size: 1rem;">${escapeHtml(sup.name)}</h4>
          <span class="badge badge-outline text-xs">${escapeHtml(sup.category)}</span>
        </div>
        <div style="font-size: 0.82rem; color: #cbd5e1; margin-bottom: 8px;">
          <div>👤 <strong>Contact:</strong> ${escapeHtml(sup.contact_person || 'N/A')}</div>
          <div>📞 <strong>Phone:</strong> ${escapeHtml(sup.phone || 'N/A')}</div>
          <div>✉️ <strong>Email:</strong> ${escapeHtml(sup.email || 'N/A')}</div>
        </div>
        <div style="font-size: 0.78rem; color: var(--text-dim); margin-top: 6px; border-top: 1px solid #1a1e2c; padding-top: 6px;">
          Supplies: ${sup.supplied_equipment_count} machines, ${sup.supplied_retail_sku_count} retail SKUs
        </div>
      </div>
    `).join('');
  }

  function renderPurchaseOrders() {
    const tbody = document.getElementById('po-tbody');
    if (!tbody) return;

    let orders = state.purchaseOrders.filter(po => {
      if (state.filters.poStatus !== 'all' && po.status !== state.filters.poStatus) return false;
      return true;
    });

    if (orders.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim);">
            No purchase orders logged.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = orders.map(po => `
      <tr>
        <td class="font-mono font-bold text-cyan">${escapeHtml(po.po_code)}</td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(po.supplier_name)}</div>
          <div style="font-size: 0.75rem; color: var(--text-dim);">${escapeHtml(po.supplier_contact || '')}</div>
        </td>
        <td class="font-mono text-xs">${formatDate(po.order_date)}</td>
        <td class="font-mono text-xs">${formatDate(po.expected_delivery)}</td>
        <td class="font-mono font-bold text-green">${formatCurrency(po.total_cost)}</td>
        <td>
          <span class="status-pill status-${po.status === 'ordered' ? 'good' : po.status === 'received' ? 'operational' : 'maintenance_needed'}">
            ${po.status.toUpperCase()}
          </span>
        </td>
        <td>
          ${po.status === 'ordered' ? `
            <button class="btn btn-sm btn-green" onclick="window.VirtexInv.markPOReceived(${po.id})">
              ✓ Mark Received
            </button>
          ` : '<span style="font-size: 0.75rem; color: #64748b;">Completed</span>'}
        </td>
      </tr>
    `).join('');
  }

  // 6. Render Reports & Asset Valuations
  function renderReports() {
    if (!state.reports) return;
    const { equipmentByCategory, retailByCategory, equipmentByZone } = state.reports;

    const elEqCatContainer = document.getElementById('report-equipment-categories');
    if (elEqCatContainer) {
      elEqCatContainer.innerHTML = equipmentByCategory.map(cat => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #1a1e2c;">
          <div>
            <div style="font-weight: 600; color: #fff;">${escapeHtml(cat.category)}</div>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${cat.item_count} machines (${cat.issues_count} need attention)</div>
          </div>
          <div class="font-mono font-bold text-cyan">${formatCurrency(cat.category_asset_value)}</div>
        </div>
      `).join('');
    }

    const elRetailCatContainer = document.getElementById('report-retail-categories');
    if (elRetailCatContainer) {
      elRetailCatContainer.innerHTML = retailByCategory.map(cat => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #1a1e2c;">
          <div>
            <div style="font-weight: 600; color: #fff;">${escapeHtml(cat.category)}</div>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${cat.sku_count} SKUs • ${cat.total_units} units in stock</div>
          </div>
          <div style="text-align: right;">
            <div class="font-mono font-bold text-green">${formatCurrency(cat.total_retail_value)}</div>
            <div style="font-size: 0.72rem; color: var(--inv-accent);">Margin: +${cat.potential_markup_pct}%</div>
          </div>
        </div>
      `).join('');
    }

    const elZoneContainer = document.getElementById('report-floor-zones');
    if (elZoneContainer) {
      elZoneContainer.innerHTML = equipmentByZone.map(zone => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #1a1e2c;">
          <div>
            <div style="font-weight: 600; color: #fff;">📍 ${escapeHtml(zone.floor_zone)}</div>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${zone.machine_count} active assets</div>
          </div>
          <div class="font-mono font-bold">${formatCurrency(zone.zone_value)}</div>
        </div>
      `).join('');
    }
  }

  // ==========================================
  // MODALS & ACTIONS
  // ==========================================

  function populateSupplierDropdowns() {
    const selects = [
      document.getElementById('modal-eq-supplier'),
      document.getElementById('modal-retail-supplier'),
      document.getElementById('modal-po-supplier')
    ];

    selects.forEach(sel => {
      if (!sel) return;
      const currentVal = sel.value;
      sel.innerHTML = `<option value="">-- Select Supplier --</option>` +
        state.suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.category)})</option>`).join('');
      if (currentVal) sel.value = currentVal;
    });
  }

  function initModalHandlers() {
    // Open Register Equipment Modal
    const btnOpenReg = document.getElementById('btn-open-register-equipment');
    if (btnOpenReg) {
      btnOpenReg.addEventListener('click', () => {
        openModal('modal-register-equipment');
        const tagInput = document.getElementById('modal-eq-asset-tag');
        if (tagInput && !tagInput.value) {
          tagInput.value = `PC-EQ-${Math.floor(100 + Math.random() * 900)}`;
        }
      });
    }

    // Open Add Retail Product Modal
    const btnOpenAddRetail = document.getElementById('btn-open-add-retail');
    if (btnOpenAddRetail) {
      btnOpenAddRetail.addEventListener('click', () => {
        openModal('modal-add-retail');
        const skuInput = document.getElementById('modal-retail-sku');
        if (skuInput && !skuInput.value) {
          skuInput.value = `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
        }
      });
    }

    // Open Add Supplier Modal
    const btnOpenAddSupplier = document.getElementById('btn-open-add-supplier');
    if (btnOpenAddSupplier) {
      btnOpenAddSupplier.addEventListener('click', () => {
        openModal('modal-add-supplier');
      });
    }

    // Open Create PO Modal
    const btnOpenCreatePO = document.getElementById('btn-open-create-po');
    if (btnOpenCreatePO) {
      btnOpenCreatePO.addEventListener('click', () => {
        openModal('modal-create-po');
        const poCodeInput = document.getElementById('modal-po-code');
        if (poCodeInput && !poCodeInput.value) {
          poCodeInput.value = `PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
        }
      });
    }

    // Modal Close Buttons
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const overlay = btn.closest('.inv-modal-overlay');
        if (overlay) closeModal(overlay.id);
      });
    });

    // Forms
    initForms();
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }

  function initForms() {
    // 1. Register Equipment Form
    const formRegEq = document.getElementById('form-register-equipment');
    if (formRegEq) {
      formRegEq.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          asset_tag: document.getElementById('modal-eq-asset-tag').value.trim(),
          name: document.getElementById('modal-eq-name').value.trim(),
          category: document.getElementById('modal-eq-category').value,
          brand: document.getElementById('modal-eq-brand').value.trim(),
          model_number: document.getElementById('modal-eq-model').value.trim(),
          floor_zone: document.getElementById('modal-eq-zone').value,
          purchase_cost: parseFloat(document.getElementById('modal-eq-cost').value) || 0,
          purchase_date: document.getElementById('modal-eq-date').value || null,
          condition_status: document.getElementById('modal-eq-condition').value,
          maintenance_interval_days: parseInt(document.getElementById('modal-eq-interval').value, 10) || 30,
          supplier_id: parseInt(document.getElementById('modal-eq-supplier').value, 10) || null,
          notes: document.getElementById('modal-eq-notes').value.trim()
        };

        try {
          const res = await apiFetch('/equipment', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          if (res && res.success) {
            showToast('Equipment registered successfully!');
            closeModal('modal-register-equipment');
            formRegEq.reset();
            loadEquipment();
            loadKpis();
          } else {
            showToast(res.message || 'Failed to register equipment', 'error');
          }
        } catch (err) {
          showToast('Failed to register equipment', 'error');
        }
      });
    }

    // 2. Service Log Form
    const formLogService = document.getElementById('form-log-service');
    if (formLogService) {
      formLogService.addEventListener('submit', async (e) => {
        e.preventDefault();
        const eqId = parseInt(document.getElementById('modal-service-eq-id').value, 10);
        const payload = {
          equipment_id: eqId,
          service_date: document.getElementById('modal-service-date').value,
          service_type: document.getElementById('modal-service-type').value,
          technician_name: document.getElementById('modal-service-tech').value.trim(),
          vendor_name: document.getElementById('modal-service-vendor').value.trim(),
          cost: parseFloat(document.getElementById('modal-service-cost').value) || 0,
          parts_replaced: document.getElementById('modal-service-parts').value.trim(),
          work_summary: document.getElementById('modal-service-summary').value.trim(),
          condition_after: document.getElementById('modal-service-condition-after').value
        };

        try {
          const res = await apiFetch('/service-logs', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          if (res && res.success) {
            showToast('Maintenance service logged successfully!');
            closeModal('modal-log-service');
            formLogService.reset();
            loadServiceLogs();
            loadEquipment();
            loadKpis();
          } else {
            showToast(res.message || 'Failed to log service', 'error');
          }
        } catch (err) {
          showToast('Failed to log maintenance', 'error');
        }
      });
    }

    // 3. Add Retail Item Form
    const formAddRetail = document.getElementById('form-add-retail');
    if (formAddRetail) {
      formAddRetail.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          sku: document.getElementById('modal-retail-sku').value.trim(),
          name: document.getElementById('modal-retail-name').value.trim(),
          category: document.getElementById('modal-retail-category').value,
          brand: document.getElementById('modal-retail-brand').value.trim(),
          unit_price: parseFloat(document.getElementById('modal-retail-unit-price').value) || 0,
          cost_price: parseFloat(document.getElementById('modal-retail-cost-price').value) || 0,
          stock_quantity: parseInt(document.getElementById('modal-retail-stock-qty').value, 10) || 0,
          reorder_threshold: parseInt(document.getElementById('modal-retail-threshold').value, 10) || 5,
          unit_measure: document.getElementById('modal-retail-unit-measure').value.trim(),
          supplier_id: parseInt(document.getElementById('modal-retail-supplier').value, 10) || null
        };

        try {
          const res = await apiFetch('/retail', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          if (res && res.success) {
            showToast('Retail product added to Pro-Shop inventory!');
            closeModal('modal-add-retail');
            formAddRetail.reset();
            loadRetailInventory();
            loadLowStockAlerts();
            loadKpis();
          } else {
            showToast(res.message || 'Failed to add product', 'error');
          }
        } catch (err) {
          showToast('Failed to register retail product', 'error');
        }
      });
    }

    // 4. Adjust Retail Stock Form
    const formAdjustStock = document.getElementById('form-adjust-stock');
    if (formAdjustStock) {
      formAdjustStock.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = parseInt(document.getElementById('modal-adjust-item-id').value, 10);
        const newQty = parseInt(document.getElementById('modal-adjust-qty').value, 10);

        try {
          const res = await apiFetch(`/retail/${id}/stock`, {
            method: 'PATCH',
            body: JSON.stringify({ new_quantity: newQty })
          });

          if (res && res.success) {
            showToast('Stock quantity updated!');
            closeModal('modal-adjust-stock');
            loadRetailInventory();
            loadLowStockAlerts();
            loadKpis();
          } else {
            showToast(res.message || 'Failed to adjust stock', 'error');
          }
        } catch (err) {
          showToast('Failed to update stock', 'error');
        }
      });
    }

    // 5. Add Supplier Form
    const formAddSupplier = document.getElementById('form-add-supplier');
    if (formAddSupplier) {
      formAddSupplier.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          name: document.getElementById('modal-sup-name').value.trim(),
          contact_person: document.getElementById('modal-sup-contact').value.trim(),
          phone: document.getElementById('modal-sup-phone').value.trim(),
          email: document.getElementById('modal-sup-email').value.trim(),
          category: document.getElementById('modal-sup-category').value,
          address: document.getElementById('modal-sup-address').value.trim()
        };

        try {
          const res = await apiFetch('/suppliers', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          if (res && res.success) {
            showToast('Supplier registered!');
            closeModal('modal-add-supplier');
            formAddSupplier.reset();
            loadSuppliers();
          } else {
            showToast(res.message || 'Failed to register supplier', 'error');
          }
        } catch (err) {
          showToast('Failed to register supplier', 'error');
        }
      });
    }

    // 6. Create Purchase Order Form
    const formCreatePO = document.getElementById('form-create-po');
    if (formCreatePO) {
      formCreatePO.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          po_code: document.getElementById('modal-po-code').value.trim(),
          supplier_id: parseInt(document.getElementById('modal-po-supplier').value, 10),
          order_date: document.getElementById('modal-po-date').value,
          expected_delivery: document.getElementById('modal-po-delivery').value || null,
          total_cost: parseFloat(document.getElementById('modal-po-cost').value) || 0,
          status: 'ordered',
          notes: document.getElementById('modal-po-notes').value.trim()
        };

        try {
          const res = await apiFetch('/purchase-orders', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          if (res && res.success) {
            showToast('Purchase Order generated successfully!');
            closeModal('modal-create-po');
            formCreatePO.reset();
            loadPurchaseOrders();
            loadKpis();
          } else {
            showToast(res.message || 'Failed to create PO', 'error');
          }
        } catch (err) {
          showToast('Failed to generate purchase order', 'error');
        }
      });
    }

    // 7. Update Condition Form
    const formEditCond = document.getElementById('form-edit-condition');
    if (formEditCond) {
      formEditCond.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = parseInt(document.getElementById('modal-cond-eq-id').value, 10);
        const condition = document.getElementById('modal-cond-status').value;

        try {
          const res = await apiFetch(`/equipment/${id}/condition`, {
            method: 'PATCH',
            body: JSON.stringify({ condition_status: condition })
          });

          if (res && res.success) {
            showToast('Equipment condition status updated!');
            closeModal('modal-edit-condition');
            loadEquipment();
            loadKpis();
          } else {
            showToast(res.message || 'Failed to update condition', 'error');
          }
        } catch (err) {
          showToast('Failed to update condition', 'error');
        }
      });
    }
  }

  // ==========================================
  // HELPER FORMATTERS & WINDOW EXPORTS
  // ==========================================

  function formatConditionStatus(status) {
    const map = {
      'operational': '● Operational',
      'good': '● Good',
      'maintenance_needed': '▲ Maintenance Due',
      'out_of_service': '✖ Out of Service'
    };
    return map[status] || status;
  }

  function formatStockStatus(status) {
    const map = {
      'in_stock': '● In Stock',
      'low_stock': '▲ Low Stock',
      'out_of_stock': '✖ Out of Stock'
    };
    return map[status] || status;
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

  // Public Actions exposed on window.VirtexInv
  window.VirtexInv = {
    openServiceModal(eqId) {
      const eq = state.equipment.find(e => e.id === eqId);
      if (!eq) return;

      document.getElementById('modal-service-eq-id').value = eq.id;
      document.getElementById('modal-service-eq-name').value = `${eq.name} (${eq.asset_tag})`;
      document.getElementById('modal-service-date').value = new Date().toISOString().split('T')[0];
      openModal('modal-log-service');
    },

    openEditConditionModal(eqId) {
      const eq = state.equipment.find(e => e.id === eqId);
      if (!eq) return;

      document.getElementById('modal-cond-eq-id').value = eq.id;
      document.getElementById('modal-cond-eq-name').value = `${eq.name} (${eq.asset_tag})`;
      document.getElementById('modal-cond-status').value = eq.condition_status;
      openModal('modal-edit-condition');
    },

    openEditEquipmentModal(eqId) {
      const eq = state.equipment.find(e => e.id === eqId);
      if (!eq) return;

      document.getElementById('modal-eq-asset-tag').value = eq.asset_tag;
      document.getElementById('modal-eq-name').value = eq.name;
      document.getElementById('modal-eq-category').value = eq.category;
      document.getElementById('modal-eq-brand').value = eq.brand || '';
      document.getElementById('modal-eq-model').value = eq.model_number || '';
      document.getElementById('modal-eq-zone').value = eq.floor_zone || 'Main Arena';
      document.getElementById('modal-eq-cost').value = eq.purchase_cost;
      document.getElementById('modal-eq-condition').value = eq.condition_status;
      document.getElementById('modal-eq-interval').value = eq.maintenance_interval_days;
      if (eq.supplier_id) document.getElementById('modal-eq-supplier').value = eq.supplier_id;
      document.getElementById('modal-eq-notes').value = eq.notes || '';

      openModal('modal-register-equipment');
    },

    openAdjustStockModal(itemId) {
      const item = state.retailItems.find(i => i.id === itemId);
      if (!item) return;

      document.getElementById('modal-adjust-item-id').value = item.id;
      document.getElementById('modal-adjust-name').value = `${item.name} (${item.sku})`;
      document.getElementById('modal-adjust-current').value = `${item.stock_quantity} ${item.unit_measure || 'units'}`;
      document.getElementById('modal-adjust-qty').value = item.stock_quantity;
      openModal('modal-adjust-stock');
    },

    quickCreatePOFromAlert(itemId) {
      const alertItem = state.lowStockAlerts.find(i => i.id === itemId);
      if (!alertItem) return;

      document.getElementById('modal-po-code').value = `PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
      document.getElementById('modal-po-supplier').value = alertItem.supplier_id || '';
      document.getElementById('modal-po-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('modal-po-cost').value = alertItem.estimated_reorder_cost;
      document.getElementById('modal-po-notes').value = `Replenish ${alertItem.suggested_reorder_qty} units of ${alertItem.name} (${alertItem.sku}).`;

      openModal('modal-create-po');
    },

    async markPOReceived(poId) {
      if (!confirm('Mark this Purchase Order as received? This will log delivery confirmation.')) return;
      try {
        const res = await apiFetch(`/purchase-orders/${poId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'received' })
        });
        if (res && res.success) {
          showToast('Purchase Order marked as received!');
          loadPurchaseOrders();
          loadKpis();
        } else {
          showToast(res.message || 'Failed to update PO', 'error');
        }
      } catch (err) {
        showToast('Failed to update PO', 'error');
      }
    },

    exportReportSummary() {
      window.print();
    }
  };
  window.PulseCoreInv = window.VirtexInv;

})();

