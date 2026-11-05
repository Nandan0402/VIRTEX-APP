import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import * as memberController from '../controllers/member.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

// Protect ALL admin routes server-side with JWT authentication
router.use(authenticateToken);

// Operations Dashboard: Accessible to Owner and Manager
router.get('/dashboard', requireRole('owner', 'manager'), adminController.getDashboardStats);

// Facility Settings: Accessible to Owner and Manager
router.put('/settings', requireRole('owner', 'manager'), adminController.updateSettings);

// Lead Management: Accessible to Owner and Manager
router.get('/enquiries', requireRole('owner', 'manager'), adminController.getEnquiries);
router.patch('/enquiries/:id', requireRole('owner', 'manager'), memberController.updateEnquiry);

// Staff User Provisioning: Strictly Owner only
router.get('/users', requireRole('owner'), adminController.getUsers);
router.post('/users', requireRole('owner'), adminController.createUser);

// Security & Authentication Audit Logs: Strictly Owner only
router.get('/audit-logs', requireRole('owner'), adminController.getAuditLogs);

export default router;

