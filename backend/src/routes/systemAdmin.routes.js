/**
 * Virtex Admin - System Administration Routes
 * 
 * Endpoints for:
 * 1. Admin and staff permission overview
 * 2. Login activity history
 * 3. Audit-log viewer
 * 4. Database backup status & verification
 * 5. Data export tools
 * 6. Security activity monitoring
 * 7. API integration status
 * 8. System health dashboard
 * 9. Error monitoring
 * 10. Application activity reports
 */

import { Router } from 'express';
import * as sysCtrl from '../controllers/systemAdmin.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(authenticateToken);

// 1. Admin & Staff Permissions Overview
router.get('/permissions', requireRole('owner', 'manager'), sysCtrl.getPermissionsOverview);

// 2. Login Activity History
router.get('/logins', requireRole('owner', 'manager'), sysCtrl.getLoginActivity);

// 3. Audit-Log Viewer
router.get('/audit-logs', requireRole('owner'), sysCtrl.getAuditLogs);

// 4. Database Backup Status & Verification
router.get('/backups', requireRole('owner', 'manager'), sysCtrl.getDatabaseBackups);
router.post('/backups', requireRole('owner'), sysCtrl.triggerDatabaseBackup);
router.patch('/backups/:id/verify', requireRole('owner', 'manager'), sysCtrl.verifyDatabaseBackup);

// 5. Data Export Tools
router.get('/exports', requireRole('owner', 'manager'), sysCtrl.getExportLogs);
router.post('/export', requireRole('owner', 'manager'), sysCtrl.exportData);

// 6. Security Activity Monitoring
router.get('/security', requireRole('owner', 'manager'), sysCtrl.getSecurityMonitoring);

// 7. API Integration Status
router.get('/integrations', requireRole('owner', 'manager', 'trainer'), sysCtrl.getApiIntegrationStatus);

// 8. System Health Dashboard
router.get('/health', requireRole('owner', 'manager', 'trainer'), sysCtrl.getSystemHealth);

// 9. Error Monitoring
router.get('/errors', requireRole('owner', 'manager'), sysCtrl.getErrorLogs);
router.patch('/errors/:id/resolve', requireRole('owner', 'manager'), sysCtrl.resolveErrorLog);

// 10. Application Activity Reports
router.get('/activity-reports', requireRole('owner', 'manager'), sysCtrl.getActivityReports);

export default router;

