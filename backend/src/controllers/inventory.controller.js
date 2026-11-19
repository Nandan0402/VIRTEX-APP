/**
 * Virtex Admin - Inventory & Equipment Controller
 * REST handlers for gym equipment registry, service logs, retail inventory,
 * suppliers, purchase orders, low-stock alerts, and financial asset reporting.
 */

import { inventoryRepository } from '../repositories/inventory.repository.js';

// ==========================================
// 1. KPI & REPORTING HANDLERS
// ==========================================

export async function getInventoryKpis(req, res) {
  try {
    const kpis = await inventoryRepository.getInventoryKpis();
    res.json({ success: true, data: kpis });
  } catch (err) {
    console.error('Error fetching inventory KPIs:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve inventory KPIs' });
  }
}

export async function getInventoryReports(req, res) {
  try {
    const reports = await inventoryRepository.getInventoryReports();
    res.json({ success: true, data: reports });
  } catch (err) {
    console.error('Error fetching inventory reports:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve inventory reports' });
  }
}

// ==========================================
// 2. GYM EQUIPMENT REGISTRY HANDLERS
// ==========================================

export async function getEquipment(req, res) {
  try {
    const { category, condition_status, floor_zone, search } = req.query;
    const items = await inventoryRepository.getEquipment({ category, condition_status, floor_zone, search });
    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Error fetching equipment list:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve equipment list' });
  }
}

export async function getEquipmentById(req, res) {
  try {
    const { id } = req.params;
    const item = await inventoryRepository.getEquipmentById(id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }
    res.json({ success: true, data: item });
  } catch (err) {
    console.error('Error fetching equipment item:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve equipment details' });
  }
}

export async function createEquipment(req, res) {
  try {
    const { asset_tag, name, category } = req.body;
    if (!asset_tag || !name || !category) {
      return res.status(400).json({ success: false, message: 'Asset tag, name, and category are required' });
    }

    const created = await inventoryRepository.createEquipment(req.body);
    res.status(201).json({ success: true, data: created, message: 'Equipment registered successfully' });
  } catch (err) {
    console.error('Error registering equipment:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'An asset with this Asset Tag already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to register equipment' });
  }
}

export async function updateEquipment(req, res) {
  try {
    const { id } = req.params;
    const updated = await inventoryRepository.updateEquipment(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }
    res.json({ success: true, data: updated, message: 'Equipment details updated' });
  } catch (err) {
    console.error('Error updating equipment:', err);
    res.status(500).json({ success: false, message: 'Failed to update equipment' });
  }
}

export async function updateEquipmentCondition(req, res) {
  try {
    const { id } = req.params;
    const { condition_status } = req.body;
    if (!condition_status) {
      return res.status(400).json({ success: false, message: 'condition_status is required' });
    }

    const updated = await inventoryRepository.updateEquipmentCondition(id, condition_status);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }
    res.json({ success: true, data: updated, message: 'Equipment condition status updated' });
  } catch (err) {
    console.error('Error updating equipment condition:', err);
    res.status(500).json({ success: false, message: 'Failed to update equipment condition' });
  }
}

export async function deleteEquipment(req, res) {
  try {
    const { id } = req.params;
    const success = await inventoryRepository.deleteEquipment(id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }
    res.json({ success: true, message: 'Equipment record removed from inventory' });
  } catch (err) {
    console.error('Error deleting equipment:', err);
    res.status(500).json({ success: false, message: 'Failed to delete equipment record' });
  }
}

// ==========================================
// 3. EQUIPMENT SERVICE LOGS HANDLERS
// ==========================================

export async function getServiceLogs(req, res) {
  try {
    const { equipment_id } = req.query;
    const logs = await inventoryRepository.getServiceLogs({ equipment_id });
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('Error fetching service logs:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve service logs' });
  }
}

export async function createServiceLog(req, res) {
  try {
    const { equipment_id, service_type, technician_name, work_summary } = req.body;
    if (!equipment_id || !service_type || !technician_name || !work_summary) {
      return res.status(400).json({ 
        success: false, 
        message: 'Equipment ID, service type, technician name, and work summary are required' 
      });
    }

    const created = await inventoryRepository.createServiceLog(req.body);
    res.status(201).json({ success: true, data: created, message: 'Service maintenance logged successfully' });
  } catch (err) {
    console.error('Error creating service log:', err);
    res.status(500).json({ success: false, message: 'Failed to log maintenance service' });
  }
}

// ==========================================
// 4. RETAIL INVENTORY HANDLERS
// ==========================================

export async function getRetailInventory(req, res) {
  try {
    const { category, status, search } = req.query;
    const items = await inventoryRepository.getRetailInventory({ category, status, search });
    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Error fetching retail inventory:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve retail inventory' });
  }
}

export async function createRetailItem(req, res) {
  try {
    const { sku, name, category, unit_price, cost_price, stock_quantity } = req.body;
    if (!sku || !name || !category || unit_price === undefined || cost_price === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'SKU, product name, category, unit price, and cost price are required' 
      });
    }

    const created = await inventoryRepository.createRetailItem(req.body);
    res.status(201).json({ success: true, data: created, message: 'Retail product registered in inventory' });
  } catch (err) {
    console.error('Error adding retail item:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'A retail product with this SKU already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to add product to retail inventory' });
  }
}

export async function updateRetailItem(req, res) {
  try {
    const { id } = req.params;
    const updated = await inventoryRepository.updateRetailItem(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Retail item not found' });
    }
    res.json({ success: true, data: updated, message: 'Retail product updated successfully' });
  } catch (err) {
    console.error('Error updating retail item:', err);
    res.status(500).json({ success: false, message: 'Failed to update retail product' });
  }
}

export async function updateRetailStock(req, res) {
  try {
    const { id } = req.params;
    const { quantity_change, new_quantity, unit_price, cost_price } = req.body;

    if (quantity_change === undefined && new_quantity === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Either quantity_change or new_quantity must be provided' 
      });
    }

    const updated = await inventoryRepository.updateRetailStock(id, {
      quantity_change,
      new_quantity,
      unit_price,
      cost_price
    });

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Retail item not found' });
    }

    res.json({ success: true, data: updated, message: 'Stock quantity updated successfully' });
  } catch (err) {
    console.error('Error adjusting retail stock:', err);
    res.status(500).json({ success: false, message: 'Failed to adjust stock' });
  }
}

// ==========================================
// 5. LOW-STOCK ALERTS HANDLERS
// ==========================================

export async function getLowStockAlerts(req, res) {
  try {
    const alerts = await inventoryRepository.getLowStockAlerts();
    res.json({ success: true, data: alerts });
  } catch (err) {
    console.error('Error fetching low stock alerts:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve low-stock alerts' });
  }
}

// ==========================================
// 6. SUPPLIERS HANDLERS
// ==========================================

export async function getSuppliers(req, res) {
  try {
    const suppliers = await inventoryRepository.getSuppliers();
    res.json({ success: true, data: suppliers });
  } catch (err) {
    console.error('Error fetching suppliers:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve suppliers' });
  }
}

export async function createSupplier(req, res) {
  try {
    const { name, category } = req.body;
    if (!name || !category) {
      return res.status(400).json({ success: false, message: 'Supplier name and category are required' });
    }

    const created = await inventoryRepository.createSupplier(req.body);
    res.status(201).json({ success: true, data: created, message: 'Supplier registered successfully' });
  } catch (err) {
    console.error('Error creating supplier:', err);
    res.status(500).json({ success: false, message: 'Failed to create supplier' });
  }
}

export async function updateSupplier(req, res) {
  try {
    const { id } = req.params;
    const updated = await inventoryRepository.updateSupplier(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }
    res.json({ success: true, data: updated, message: 'Supplier details updated successfully' });
  } catch (err) {
    console.error('Error updating supplier:', err);
    res.status(500).json({ success: false, message: 'Failed to update supplier' });
  }
}

// ==========================================
// 7. PURCHASE ORDERS HANDLERS
// ==========================================

export async function getPurchaseOrders(req, res) {
  try {
    const { status } = req.query;
    const orders = await inventoryRepository.getPurchaseOrders({ status });
    res.json({ success: true, data: orders });
  } catch (err) {
    console.error('Error fetching purchase orders:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve purchase orders' });
  }
}

export async function createPurchaseOrder(req, res) {
  try {
    const { supplier_id, total_cost } = req.body;
    if (!supplier_id) {
      return res.status(400).json({ success: false, message: 'Supplier ID is required' });
    }

    const created = await inventoryRepository.createPurchaseOrder(req.body);
    res.status(201).json({ success: true, data: created, message: 'Purchase order generated successfully' });
  } catch (err) {
    console.error('Error creating purchase order:', err);
    res.status(500).json({ success: false, message: 'Failed to create purchase order' });
  }
}

export async function updatePurchaseOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const updated = await inventoryRepository.updatePurchaseOrderStatus(id, status);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    res.json({ success: true, data: updated, message: `Purchase order status updated to ${status}` });
  } catch (err) {
    console.error('Error updating purchase order status:', err);
    res.status(500).json({ success: false, message: 'Failed to update purchase order status' });
  }
}

