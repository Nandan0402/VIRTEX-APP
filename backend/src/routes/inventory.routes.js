/**
 * Virtex Admin - Inventory & Equipment Routes
 * Secure REST routes for gym equipment registry, condition monitoring,
 * maintenance schedules & service logs, retail supplements & merchandise,
 * low-stock alerts, suppliers, purchase orders, and asset valuation reports.
 */

import { Router } from 'express';
import * as invCtrl from '../controllers/inventory.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(authenticateToken);

// KPIs & Reports
router.get('/kpis', requireRole('owner', 'manager', 'trainer'), invCtrl.getInventoryKpis);
router.get('/reports', requireRole('owner', 'manager'), invCtrl.getInventoryReports);

// Gym Equipment Registry
router.get('/equipment', requireRole('owner', 'manager', 'trainer'), invCtrl.getEquipment);
router.post('/equipment', requireRole('owner', 'manager'), invCtrl.createEquipment);
router.get('/equipment/:id', requireRole('owner', 'manager', 'trainer'), invCtrl.getEquipmentById);
router.put('/equipment/:id', requireRole('owner', 'manager'), invCtrl.updateEquipment);
router.patch('/equipment/:id/condition', requireRole('owner', 'manager', 'trainer'), invCtrl.updateEquipmentCondition);
router.delete('/equipment/:id', requireRole('owner', 'manager'), invCtrl.deleteEquipment);

// Equipment Maintenance Schedules & Service History
router.get('/service-logs', requireRole('owner', 'manager', 'trainer'), invCtrl.getServiceLogs);
router.post('/service-logs', requireRole('owner', 'manager', 'trainer'), invCtrl.createServiceLog);

// Supplement & Merchandise Pro-Shop Inventory
router.get('/retail', requireRole('owner', 'manager', 'trainer'), invCtrl.getRetailInventory);
router.post('/retail', requireRole('owner', 'manager'), invCtrl.createRetailItem);
router.put('/retail/:id', requireRole('owner', 'manager'), invCtrl.updateRetailItem);
router.patch('/retail/:id/stock', requireRole('owner', 'manager', 'trainer'), invCtrl.updateRetailStock);

// Low-Stock Alerts
router.get('/low-stock-alerts', requireRole('owner', 'manager', 'trainer'), invCtrl.getLowStockAlerts);

// Suppliers & Vendors
router.get('/suppliers', requireRole('owner', 'manager'), invCtrl.getSuppliers);
router.post('/suppliers', requireRole('owner', 'manager'), invCtrl.createSupplier);
router.put('/suppliers/:id', requireRole('owner', 'manager'), invCtrl.updateSupplier);

// Purchase Orders
router.get('/purchase-orders', requireRole('owner', 'manager'), invCtrl.getPurchaseOrders);
router.post('/purchase-orders', requireRole('owner', 'manager'), invCtrl.createPurchaseOrder);
router.patch('/purchase-orders/:id/status', requireRole('owner', 'manager'), invCtrl.updatePurchaseOrderStatus);

export default router;

