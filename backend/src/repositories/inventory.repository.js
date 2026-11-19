import { pool } from '../config/database.js';

export class InventoryRepository {
  /**
   * KPI and Financial Asset Summary
   */
  async getInventoryKpis() {
    // 1. Gym equipment statistics
    const eqStats = await pool.query(`
      SELECT 
        COUNT(*) AS total_equipment,
        COUNT(*) FILTER (WHERE condition_status = 'operational') AS operational_count,
        COUNT(*) FILTER (WHERE condition_status = 'good') AS good_count,
        COUNT(*) FILTER (WHERE condition_status = 'maintenance_needed') AS maintenance_needed_count,
        COUNT(*) FILTER (WHERE condition_status = 'out_of_service') AS out_of_service_count,
        COUNT(*) FILTER (WHERE next_service_due <= CURRENT_DATE + INTERVAL '7 days') AS upcoming_maintenance_count,
        COALESCE(SUM(purchase_cost), 0) AS total_equipment_asset_value
      FROM gym_equipment
    `);

    // 2. Retail inventory statistics
    const retailStats = await pool.query(`
      SELECT 
        COUNT(*) AS total_skus,
        COALESCE(SUM(stock_quantity), 0) AS total_units_in_stock,
        COALESCE(SUM(stock_quantity * cost_price), 0) AS total_inventory_cost_value,
        COALESCE(SUM(stock_quantity * unit_price), 0) AS total_inventory_retail_value,
        COUNT(*) FILTER (WHERE stock_quantity <= reorder_threshold) AS low_stock_sku_count,
        COUNT(*) FILTER (WHERE stock_quantity = 0) AS out_of_stock_sku_count
      FROM retail_inventory
    `);

    // 3. Service cost statistics
    const serviceStats = await pool.query(`
      SELECT 
        COUNT(*) AS total_service_tickets,
        COALESCE(SUM(cost), 0) AS total_maintenance_spent
      FROM equipment_service_logs
    `);

    // 4. Active purchase orders
    const poStats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'ordered') AS open_po_count,
        COALESCE(SUM(total_cost) FILTER (WHERE status = 'ordered'), 0) AS open_po_total_value
      FROM inventory_purchase_orders
    `);

    return {
      equipment: eqStats.rows[0],
      retail: retailStats.rows[0],
      service: serviceStats.rows[0],
      purchaseOrders: poStats.rows[0]
    };
  }

  /**
   * Detailed Inventory & Equipment Reports
   */
  async getInventoryReports() {
    const kpis = await this.getInventoryKpis();

    // Category breakdown for equipment
    const eqCategoryBreakdown = await pool.query(`
      SELECT 
        category,
        COUNT(*) AS item_count,
        COALESCE(SUM(purchase_cost), 0) AS category_asset_value,
        COUNT(*) FILTER (WHERE condition_status IN ('maintenance_needed', 'out_of_service')) AS issues_count
      FROM gym_equipment
      GROUP BY category
      ORDER BY category_asset_value DESC
    `);

    // Category breakdown for retail
    const retailCategoryBreakdown = await pool.query(`
      SELECT 
        category,
        COUNT(*) AS sku_count,
        COALESCE(SUM(stock_quantity), 0) AS total_units,
        COALESCE(SUM(stock_quantity * cost_price), 0) AS total_cost_value,
        COALESCE(SUM(stock_quantity * unit_price), 0) AS total_retail_value,
        ROUND(
          CASE 
            WHEN SUM(stock_quantity * cost_price) > 0 
            THEN ((SUM(stock_quantity * unit_price) - SUM(stock_quantity * cost_price)) / SUM(stock_quantity * cost_price)) * 100 
            ELSE 0 
          END, 1
        ) AS potential_markup_pct
      FROM retail_inventory
      GROUP BY category
      ORDER BY total_retail_value DESC
    `);

    // Zone breakdown
    const zoneBreakdown = await pool.query(`
      SELECT 
        floor_zone,
        COUNT(*) AS machine_count,
        COALESCE(SUM(purchase_cost), 0) AS zone_value
      FROM gym_equipment
      GROUP BY floor_zone
      ORDER BY machine_count DESC
    `);

    return {
      kpis,
      equipmentByCategory: eqCategoryBreakdown.rows,
      retailByCategory: retailCategoryBreakdown.rows,
      equipmentByZone: zoneBreakdown.rows
    };
  }

  // ==========================================
  // 1. Gym Equipment Operations
  // ==========================================
  async getEquipment({ category, condition_status, floor_zone, search } = {}) {
    let query = `
      SELECT 
        e.*,
        s.name AS supplier_name,
        s.contact_person AS supplier_contact,
        (SELECT COUNT(*) FROM equipment_service_logs WHERE equipment_id = e.id) AS service_history_count
      FROM gym_equipment e
      LEFT JOIN equipment_suppliers s ON e.supplier_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      query += ` AND e.category = $${params.length}`;
    }

    if (condition_status && condition_status !== 'all') {
      params.push(condition_status);
      query += ` AND e.condition_status = $${params.length}`;
    }

    if (floor_zone && floor_zone !== 'all') {
      params.push(floor_zone);
      query += ` AND e.floor_zone = $${params.length}`;
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(e.name) LIKE $${params.length} OR LOWER(e.asset_tag) LIKE $${params.length} OR LOWER(COALESCE(e.brand, '')) LIKE $${params.length})`;
    }

    query += ` ORDER BY e.id DESC`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  async getEquipmentById(id) {
    const res = await pool.query(`
      SELECT 
        e.*,
        s.name AS supplier_name,
        s.contact_person AS supplier_contact,
        s.phone AS supplier_phone,
        s.email AS supplier_email
      FROM gym_equipment e
      LEFT JOIN equipment_suppliers s ON e.supplier_id = s.id
      WHERE e.id = $1
    `, [id]);
    return res.rows[0] || null;
  }

  async createEquipment(data) {
    const {
      asset_tag,
      name,
      category,
      brand,
      model_number,
      serial_number,
      floor_zone,
      purchase_date,
      purchase_cost,
      warranty_until,
      condition_status,
      maintenance_interval_days,
      last_serviced_date,
      next_service_due,
      supplier_id,
      notes
    } = data;

    // Calculate next_service_due if not provided
    const calculatedNextService = next_service_due || (
      maintenance_interval_days ? 
      `CURRENT_DATE + INTERVAL '${parseInt(maintenance_interval_days, 10)} days'` : 
      `CURRENT_DATE + INTERVAL '30 days'`
    );

    const query = `
      INSERT INTO gym_equipment (
        asset_tag, name, category, brand, model_number, serial_number,
        floor_zone, purchase_date, purchase_cost, warranty_until,
        condition_status, maintenance_interval_days, last_serviced_date,
        next_service_due, supplier_id, notes
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13,
        ${next_service_due ? '$14' : calculatedNextService},
        ${next_service_due ? '$15' : '$14'},
        ${next_service_due ? '$16' : '$15'}
      )
      RETURNING *
    `;

    const params = [
      asset_tag,
      name,
      category,
      brand || null,
      model_number || null,
      serial_number || null,
      floor_zone || 'Main Arena',
      purchase_date || new Date().toISOString().split('T')[0],
      purchase_cost || 0.00,
      warranty_until || null,
      condition_status || 'operational',
      maintenance_interval_days || 30,
      last_serviced_date || null
    ];

    if (next_service_due) {
      params.push(next_service_due);
    }
    params.push(supplier_id || null);
    params.push(notes || null);

    const res = await pool.query(query, params);
    return res.rows[0];
  }

  async updateEquipment(id, data) {
    const fields = [];
    const params = [id];

    const updatable = [
      'name', 'category', 'brand', 'model_number', 'serial_number',
      'floor_zone', 'purchase_date', 'purchase_cost', 'warranty_until',
      'condition_status', 'maintenance_interval_days', 'last_serviced_date',
      'next_service_due', 'supplier_id', 'notes'
    ];

    for (const key of updatable) {
      if (data[key] !== undefined) {
        params.push(data[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }

    if (fields.length === 0) return await this.getEquipmentById(id);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    const query = `
      UPDATE gym_equipment
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const res = await pool.query(query, params);
    return res.rows[0];
  }

  async updateEquipmentCondition(id, condition_status) {
    const res = await pool.query(`
      UPDATE gym_equipment
      SET condition_status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id, condition_status]);
    return res.rows[0];
  }

  async deleteEquipment(id) {
    const res = await pool.query('DELETE FROM gym_equipment WHERE id = $1 RETURNING id', [id]);
    return res.rowCount > 0;
  }

  // ==========================================
  // 2. Equipment Service & Maintenance Logs
  // ==========================================
  async getServiceLogs({ equipment_id } = {}) {
    let query = `
      SELECT 
        l.*,
        e.asset_tag,
        e.name AS equipment_name,
        e.category AS equipment_category,
        e.floor_zone
      FROM equipment_service_logs l
      JOIN gym_equipment e ON l.equipment_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (equipment_id) {
      params.push(equipment_id);
      query += ` AND l.equipment_id = $${params.length}`;
    }

    query += ` ORDER BY l.service_date DESC, l.id DESC`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  async createServiceLog(data) {
    const {
      equipment_id,
      service_date,
      service_type,
      technician_name,
      vendor_name,
      cost,
      parts_replaced,
      work_summary,
      condition_after
    } = data;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertRes = await client.query(`
        INSERT INTO equipment_service_logs (
          equipment_id, service_date, service_type, technician_name,
          vendor_name, cost, parts_replaced, work_summary, condition_after
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        equipment_id,
        service_date || new Date().toISOString().split('T')[0],
        service_type,
        technician_name,
        vendor_name || null,
        cost || 0.00,
        parts_replaced || null,
        work_summary,
        condition_after || 'operational'
      ]);

      const serviceLog = insertRes.rows[0];

      // Update equipment condition, last serviced date, and calculate next service date
      await client.query(`
        UPDATE gym_equipment
        SET 
          condition_status = $2,
          last_serviced_date = $3,
          next_service_due = ($3::date + (maintenance_interval_days || ' days')::interval)::date,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [equipment_id, condition_after || 'operational', service_date]);

      await client.query('COMMIT');
      return serviceLog;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // 3. Retail Inventory (Supplements & Merchandise)
  // ==========================================
  async getRetailInventory({ category, status, search } = {}) {
    let query = `
      SELECT 
        r.*,
        s.name AS supplier_name,
        s.contact_person AS supplier_contact,
        (r.stock_quantity * r.unit_price) AS total_retail_value,
        (r.stock_quantity * r.cost_price) AS total_cost_value,
        (r.unit_price - r.cost_price) AS unit_margin,
        CASE 
          WHEN r.cost_price > 0 THEN ROUND(((r.unit_price - r.cost_price) / r.cost_price) * 100, 1)
          ELSE 0
        END AS margin_percentage
      FROM retail_inventory r
      LEFT JOIN equipment_suppliers s ON r.supplier_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      query += ` AND r.category = $${params.length}`;
    }

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND r.status = $${params.length}`;
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(r.name) LIKE $${params.length} OR LOWER(r.sku) LIKE $${params.length} OR LOWER(COALESCE(r.brand, '')) LIKE $${params.length})`;
    }

    query += ` ORDER BY (r.stock_quantity <= r.reorder_threshold) DESC, r.category ASC, r.name ASC`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  async createRetailItem(data) {
    const {
      sku,
      name,
      category,
      brand,
      unit_price,
      cost_price,
      stock_quantity,
      reorder_threshold,
      unit_measure,
      expiry_date,
      supplier_id
    } = data;

    const qty = parseInt(stock_quantity || 0, 10);
    const threshold = parseInt(reorder_threshold || 5, 10);
    let status = 'in_stock';
    if (qty <= 0) status = 'out_of_stock';
    else if (qty <= threshold) status = 'low_stock';

    const res = await pool.query(`
      INSERT INTO retail_inventory (
        sku, name, category, brand, unit_price, cost_price,
        stock_quantity, reorder_threshold, unit_measure, expiry_date,
        supplier_id, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      sku,
      name,
      category,
      brand || null,
      unit_price || 0.00,
      cost_price || 0.00,
      qty,
      threshold,
      unit_measure || 'Units',
      expiry_date || null,
      supplier_id || null,
      status
    ]);

    return res.rows[0];
  }

  async updateRetailItem(id, data) {
    const fields = [];
    const params = [id];

    const updatable = [
      'name', 'category', 'brand', 'unit_price', 'cost_price',
      'stock_quantity', 'reorder_threshold', 'unit_measure',
      'expiry_date', 'supplier_id'
    ];

    for (const key of updatable) {
      if (data[key] !== undefined) {
        params.push(data[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }

    if (fields.length === 0) return null;

    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    // Dynamically recalculate status if stock_quantity or reorder_threshold is modified
    const query = `
      UPDATE retail_inventory
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const res = await pool.query(query, params);
    if (!res.rows[0]) return null;

    // Refresh status column
    const item = res.rows[0];
    let newStatus = 'in_stock';
    if (item.stock_quantity <= 0) newStatus = 'out_of_stock';
    else if (item.stock_quantity <= item.reorder_threshold) newStatus = 'low_stock';

    if (newStatus !== item.status) {
      const statusRes = await pool.query(`
        UPDATE retail_inventory SET status = $2 WHERE id = $1 RETURNING *
      `, [id, newStatus]);
      return statusRes.rows[0];
    }

    return item;
  }

  async updateRetailStock(id, { quantity_change, new_quantity, unit_price, cost_price }) {
    let stockSql = '';
    let statusSql = '';
    const params = [id];

    if (new_quantity !== undefined) {
      params.push(parseInt(new_quantity, 10));
      const paramIdx = params.length;
      stockSql = `stock_quantity = $${paramIdx}`;
      statusSql = `status = CASE 
        WHEN $${paramIdx} <= 0 THEN 'out_of_stock' 
        WHEN $${paramIdx} <= reorder_threshold THEN 'low_stock' 
        ELSE 'in_stock' 
      END`;
    } else if (quantity_change !== undefined) {
      params.push(parseInt(quantity_change, 10));
      const paramIdx = params.length;
      stockSql = `stock_quantity = GREATEST(0, stock_quantity + $${paramIdx})`;
      statusSql = `status = CASE 
        WHEN (stock_quantity + $${paramIdx}) <= 0 THEN 'out_of_stock' 
        WHEN (stock_quantity + $${paramIdx}) <= reorder_threshold THEN 'low_stock' 
        ELSE 'in_stock' 
      END`;
    } else {
      throw new Error('Must provide either quantity_change or new_quantity');
    }

    const setClauses = [stockSql, statusSql];

    if (unit_price !== undefined) {
      params.push(parseFloat(unit_price));
      setClauses.push(`unit_price = $${params.length}`);
    }

    if (cost_price !== undefined) {
      params.push(parseFloat(cost_price));
      setClauses.push(`cost_price = $${params.length}`);
    }

    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);

    const res = await pool.query(`
      UPDATE retail_inventory
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `, params);

    return res.rows[0];
  }

  // ==========================================
  // 4. Low-Stock Alerts
  // ==========================================
  async getLowStockAlerts() {
    const res = await pool.query(`
      SELECT 
        r.*,
        s.name AS supplier_name,
        s.phone AS supplier_phone,
        s.email AS supplier_email,
        (r.reorder_threshold * 2) - r.stock_quantity AS suggested_reorder_qty,
        ((r.reorder_threshold * 2) - r.stock_quantity) * r.cost_price AS estimated_reorder_cost
      FROM retail_inventory r
      LEFT JOIN equipment_suppliers s ON r.supplier_id = s.id
      WHERE r.stock_quantity <= r.reorder_threshold
      ORDER BY r.stock_quantity ASC, r.name ASC
    `);
    return res.rows;
  }

  // ==========================================
  // 5. Suppliers & Vendors
  // ==========================================
  async getSuppliers() {
    const res = await pool.query(`
      SELECT 
        s.*,
        (SELECT COUNT(*) FROM gym_equipment WHERE supplier_id = s.id) AS supplied_equipment_count,
        (SELECT COUNT(*) FROM retail_inventory WHERE supplier_id = s.id) AS supplied_retail_sku_count,
        (SELECT COUNT(*) FROM inventory_purchase_orders WHERE supplier_id = s.id) AS total_orders_count
      FROM equipment_suppliers s
      ORDER BY s.is_active DESC, s.name ASC
    `);
    return res.rows;
  }

  async createSupplier(data) {
    const { name, contact_person, phone, email, category, address } = data;
    const res = await pool.query(`
      INSERT INTO equipment_suppliers (name, contact_person, phone, email, category, address)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      name,
      contact_person || null,
      phone || null,
      email || null,
      category || 'Gym Equipment',
      address || null
    ]);
    return res.rows[0];
  }

  async updateSupplier(id, data) {
    const fields = [];
    const params = [id];

    for (const key of ['name', 'contact_person', 'phone', 'email', 'category', 'address', 'is_active']) {
      if (data[key] !== undefined) {
        params.push(data[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }

    if (fields.length === 0) return null;

    const res = await pool.query(`
      UPDATE equipment_suppliers
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING *
    `, params);
    return res.rows[0];
  }

  // ==========================================
  // 6. Purchase Orders
  // ==========================================
  async getPurchaseOrders({ status } = {}) {
    let query = `
      SELECT 
        po.*,
        s.name AS supplier_name,
        s.contact_person AS supplier_contact,
        s.email AS supplier_email,
        s.phone AS supplier_phone
      FROM inventory_purchase_orders po
      JOIN equipment_suppliers s ON po.supplier_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND po.status = $${params.length}`;
    }

    query += ` ORDER BY po.order_date DESC, po.id DESC`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  async createPurchaseOrder(data) {
    const {
      po_code,
      supplier_id,
      order_date,
      expected_delivery,
      total_cost,
      status,
      items_summary,
      notes
    } = data;

    const autoCode = po_code || `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const res = await pool.query(`
      INSERT INTO inventory_purchase_orders (
        po_code, supplier_id, order_date, expected_delivery,
        total_cost, status, items_summary, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      autoCode,
      supplier_id,
      order_date || new Date().toISOString().split('T')[0],
      expected_delivery || null,
      total_cost || 0.00,
      status || 'ordered',
      JSON.stringify(items_summary || []),
      notes || null
    ]);

    return res.rows[0];
  }

  async updatePurchaseOrderStatus(id, status) {
    const res = await pool.query(`
      UPDATE inventory_purchase_orders
      SET status = $2
      WHERE id = $1
      RETURNING *
    `, [id, status]);
    return res.rows[0];
  }
}

export const inventoryRepository = new InventoryRepository();
