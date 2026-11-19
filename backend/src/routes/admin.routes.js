import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import * as memberController from '../controllers/member.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';
import analyticsRoutes from './analytics.routes.js';
import performanceRoutes from './performance.routes.js';
import workoutRoutes from './workout.routes.js';
import dietRoutes from './diet.routes.js';
import recoveryRoutes from './recovery.routes.js';
import measurementRoutes from './measurement.routes.js';
import competitionRoutes from './competition.routes.js';
import onlineClassRoutes from './onlineClass.routes.js';
import libraryRoutes from './library.routes.js';
import financeRoutes from './finance.routes.js';
import inventoryRoutes from './inventory.routes.js';
import retentionRoutes from './retention.routes.js';
import operationsRoutes from './operations.routes.js';
import roboticsManagementRoutes from './roboticsManagement.routes.js';
import systemAdminRoutes from './systemAdmin.routes.js';
import { denyRoles } from '../middlewares/portalAccess.js';
import * as trainerHubController from '../controllers/trainerHub.controller.js';
import * as passwordRequestController from '../controllers/passwordRequest.controller.js';
import * as adminSignupController from '../controllers/adminSignup.controller.js';
import * as memberMessagesController from '../controllers/memberMessages.controller.js';
import * as memberGroupsController from '../controllers/memberGroups.controller.js';
import * as reportsController from '../controllers/reports.controller.js';
import * as feeStatusController from '../controllers/feeStatus.controller.js';
import * as trainingTimes from '../controllers/trainingTimes.controller.js';
import * as memberMenu from '../controllers/memberMenu.controller.js';
import * as adminLogins from '../controllers/adminLogins.controller.js';

const router = Router();

// Protect ALL admin routes server-side with JWT authentication
router.use(authenticateToken);

// Member-record modules return EVERY member's data and cannot enforce
// "trainers see only their assigned clients" -> Admin only. Trainers use /api/trainer/*.
const adminOnlyMemberData = denyRoles('trainer', 'member');

// Approved Admin Modules Integration
router.use('/analytics', analyticsRoutes);
router.use('/performance', adminOnlyMemberData, performanceRoutes);
router.use('/workouts', adminOnlyMemberData, workoutRoutes);
router.use('/diet', adminOnlyMemberData, dietRoutes);
router.use('/recovery', adminOnlyMemberData, recoveryRoutes);
router.use('/measurements', adminOnlyMemberData, measurementRoutes);
router.use('/competitions', competitionRoutes);
router.use('/classes', onlineClassRoutes);
router.use('/library', libraryRoutes);
router.use('/finance', adminOnlyMemberData, financeRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/retention', retentionRoutes);
router.use('/operations', operationsRoutes);
router.use('/robotics-management', roboticsManagementRoutes);
router.use('/system-admin', systemAdminRoutes);

// Trainer Hub oversight (Trainer -> Admin): attendance, completed PT sessions, workout
// activity, diet monitoring and member progress per trainer. Owner and Manager only.
router.get('/trainer-hub/activity', requireRole('owner', 'manager'), trainerHubController.getAdminActivity);

// Trainer password change requests (trainers cannot change their own password; the admin sets it)
router.get('/trainer-password-requests', requireRole('owner', 'manager'), passwordRequestController.listOpenRequests);
router.post('/trainer-password-requests/:id/dismiss', requireRole('owner', 'manager'), passwordRequestController.dismissRequest);

// Reports (Admin → Reports): month-by-month leads, amount, members, trainers. Owner and Manager.
router.get('/reports/summary', requireRole('owner', 'manager'), reportsController.summary);
// Trainer gym-welfare share (default 20% of their PT clients' monthly fees), due at month end (migration 031)
router.get('/trainer-welfare', requireRole('owner', 'manager'), feeStatusController.adminWelfareList);
// Training times (migration 033): general trainer + time per member, PT times, member time-shift requests
router.get('/training-times', requireRole('owner', 'manager'), trainingTimes.adminOverview);
// Member Portal menu per member type (personal-training vs general), migration 035
router.get('/member-menu', requireRole('owner', 'manager'), memberMenu.adminGetMenu);
// Logins & Access: member / trainer logins (add, freeze, password, reset Google 2-step, delete)
router.get('/logins', requireRole('owner', 'manager'), adminLogins.list);
router.post('/logins', requireRole('owner', 'manager'), adminLogins.create);
router.patch('/logins/:userId', requireRole('owner', 'manager'), adminLogins.setActive);
router.post('/logins/:userId/password', requireRole('owner', 'manager'), adminLogins.setPassword);
router.post('/logins/:userId/reset-google', requireRole('owner', 'manager'), adminLogins.resetGoogle);
router.delete('/logins/:userId', requireRole('owner', 'manager'), adminLogins.remove);
router.put('/member-menu', requireRole('owner', 'manager'), memberMenu.adminSaveMenu);
router.post('/general-training', requireRole('owner', 'manager'), trainingTimes.adminAssignGeneral);
router.post('/general-training/:id/end', requireRole('owner', 'manager'), trainingTimes.adminEndGeneral);
router.get('/time-shift-requests', requireRole('owner', 'manager'), trainingTimes.adminListRequests);
router.post('/time-shift-requests/:id/approve', requireRole('owner', 'manager'), trainingTimes.adminApprove);
router.post('/time-shift-requests/:id/reject', requireRole('owner', 'manager'), trainingTimes.adminReject);
router.post('/trainer-welfare/:trainerId/pay', requireRole('owner', 'manager'), feeStatusController.adminWelfarePay);

// Operations Dashboard: Accessible to Owner and Manager
router.get('/dashboard', requireRole('owner', 'manager'), adminController.getDashboardStats);

// Facility Settings: Accessible to Owner and Manager
router.put('/settings', requireRole('owner', 'manager'), adminController.updateSettings);

// Lead Management: Accessible to Owner and Manager
router.get('/enquiries', requireRole('owner', 'manager'), adminController.getEnquiries);
router.post('/enquiries', requireRole('owner', 'manager'), memberController.createEnquiry);
router.patch('/enquiries/:id', requireRole('owner', 'manager'), memberController.updateEnquiry);
router.delete('/enquiries/:id', requireRole('owner', 'manager'), memberController.deleteEnquiry);

// Staff User Provisioning: Strictly Owner only
router.get('/users', requireRole('owner'), adminController.getUsers);
router.post('/users', requireRole('owner'), adminController.createUser);

// Member ↔ gym team 1-to-1 messages (shared owner/manager inbox)
router.get('/member-messages', requireRole('owner', 'manager'), memberMessagesController.inbox);
router.post('/member-messages', requireRole('owner', 'manager'), memberMessagesController.start);
router.get('/member-messages/:threadId', requireRole('owner', 'manager'), memberMessagesController.open);
router.post('/member-messages/:threadId', requireRole('owner', 'manager'), memberMessagesController.send);

// Trainer ↔ gym team 1-to-1 messages (same shared owner/manager inbox)
router.get('/trainer-messages', requireRole('owner', 'manager'), memberMessagesController.trainerInbox);
router.post('/trainer-messages', requireRole('owner', 'manager'), memberMessagesController.trainerStart);
router.get('/trainer-messages/:threadId', requireRole('owner', 'manager'), memberMessagesController.trainerOpen);
router.post('/trainer-messages/:threadId', requireRole('owner', 'manager'), memberMessagesController.trainerSend);

// Member group conversations: ONLY the gym team creates groups and manages who is in them
const staffOnly = requireRole('owner', 'manager');
router.get('/member-groups', staffOnly, memberGroupsController.list);
router.post('/member-groups', staffOnly, memberGroupsController.create);
router.get('/member-groups/:groupId', staffOnly, memberGroupsController.open);
router.patch('/member-groups/:groupId', staffOnly, memberGroupsController.update);
router.post('/member-groups/:groupId/messages', staffOnly, memberGroupsController.send);
router.post('/member-groups/:groupId/members', staffOnly, memberGroupsController.addMembers);
router.delete('/member-groups/:groupId/members/:memberId', staffOnly, memberGroupsController.removeMember);

// Admin sign-up requests from the admin sign-in page (owner approves or rejects)
router.get('/admin-signups', requireRole('owner'), adminSignupController.listPendingSignups);
router.post('/admin-signups/:userId/approve', requireRole('owner'), adminSignupController.approveSignup);
router.post('/admin-signups/:userId/reject', requireRole('owner'), adminSignupController.rejectSignup);

// Security & Authentication Audit Logs: Strictly Owner only
router.get('/audit-logs', requireRole('owner'), adminController.getAuditLogs);
router.get('/sync-logs', requireRole('owner', 'manager'), adminController.getSyncLogs);

export default router;

