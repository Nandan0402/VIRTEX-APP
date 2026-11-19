/**
 * Virtex Admin - Gym Operations & Staff Management Routes
 * Endpoints for staff registration, profiles, roles & permissions,
 * attendance reports, shift management, branch management, facility zones,
 * facility maintenance logs, staff performance, and branch analytics.
 */

import { Router } from 'express';
import * as opsCtrl from '../controllers/operations.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';
import { forceOwnUserQuery, selfOnlyForTrainer, requireOwnStaffShift } from '../middlewares/portalAccess.js';

const router = Router();

router.use(authenticateToken);

// Staff Registration & Profiles
// Full staff directory (includes salary/HR fields) -> Admin only
router.get('/staff', requireRole('owner', 'manager'), opsCtrl.getStaffProfiles);
router.post('/staff', requireRole('owner', 'manager'), opsCtrl.registerStaff);
router.get('/staff/:id', requireRole('owner', 'manager', 'trainer'), selfOnlyForTrainer('id'), opsCtrl.getStaffProfileById);
router.put('/staff/:id', requireRole('owner', 'manager'), opsCtrl.updateStaffProfile);

// Staff Roles and Permissions
router.get('/roles', requireRole('owner', 'manager'), opsCtrl.getRolesAndPermissions);
router.patch('/staff/:id/role', requireRole('owner'), opsCtrl.updateStaffRole);

// Staff Attendance Reports (from routine_punches)
router.get('/attendance', requireRole('owner', 'manager', 'trainer'), forceOwnUserQuery('user_id'), opsCtrl.getStaffAttendanceReports);

// Staff Shift Management
router.get('/shifts', requireRole('owner', 'manager', 'trainer'), forceOwnUserQuery('user_id'), opsCtrl.getStaffShifts);
router.post('/shifts', requireRole('owner', 'manager'), opsCtrl.createStaffShift);
router.patch('/shifts/:id/status', requireRole('owner', 'manager', 'trainer'), requireOwnStaffShift, opsCtrl.updateStaffShiftStatus);

// Branch Management
router.get('/branches', requireRole('owner', 'manager', 'trainer'), opsCtrl.getBranches);
router.post('/branches', requireRole('owner', 'manager'), opsCtrl.createBranch);
router.put('/branches/:id', requireRole('owner', 'manager'), opsCtrl.updateBranch);

// Facility Zones Management
router.get('/facilities', requireRole('owner', 'manager', 'trainer'), opsCtrl.getFacilities);
router.post('/facilities', requireRole('owner', 'manager'), opsCtrl.createFacility);
router.patch('/facilities/:id/status', requireRole('owner', 'manager'), opsCtrl.updateFacilityStatus);

// Facility Maintenance
router.get('/maintenance', requireRole('owner', 'manager', 'trainer'), opsCtrl.getFacilityMaintenanceLogs);
router.post('/maintenance', requireRole('owner', 'manager'), opsCtrl.createFacilityMaintenanceLog);
router.patch('/maintenance/:id/status', requireRole('owner', 'manager'), opsCtrl.updateFacilityMaintenanceStatus);

// Performance & Branch Analytics
router.get('/performance', requireRole('owner', 'manager'), opsCtrl.getStaffPerformanceReports);
router.get('/analytics/branches', requireRole('owner', 'manager'), opsCtrl.getBranchAnalytics);

export default router;

