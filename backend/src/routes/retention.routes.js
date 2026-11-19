/**
 * Virtex Admin - Member Retention and Communication Routes
 * Endpoints for email templates, push notifications, announcements, renewal reminders,
 * inactive follow-ups, feedback & NPS surveys, complaints, audience segments, and campaign reports.
 */

import { Router } from 'express';
import * as retCtrl from '../controllers/retention.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';
import { denyRoles } from '../middlewares/portalAccess.js';

const router = Router();

router.use(authenticateToken);
// Retention data covers every member (segments, feedback, complaints, renewals) -> Admin only.
router.use(denyRoles('trainer', 'member'));

// Performance Reports & KPIs
router.get('/reports', requireRole('owner', 'manager'), retCtrl.getRetentionPerformanceReports);

// Audience Segmentation
router.get('/segments', requireRole('owner', 'manager', 'trainer'), retCtrl.getAudienceSegments);
router.get('/segments/:code/members', requireRole('owner', 'manager', 'trainer'), retCtrl.getSegmentMembers);

// Campaigns & Push Notifications
router.get('/campaigns', requireRole('owner', 'manager', 'trainer'), retCtrl.getCampaigns);
router.post('/campaigns', requireRole('owner', 'manager'), retCtrl.createCampaign);
router.get('/campaigns/:id', requireRole('owner', 'manager', 'trainer'), retCtrl.getCampaignById);
router.post('/campaigns/:id/launch', requireRole('owner', 'manager'), retCtrl.launchCampaign);

// Email Templates
router.get('/templates', requireRole('owner', 'manager', 'trainer'), retCtrl.getEmailTemplates);
router.post('/templates', requireRole('owner', 'manager'), retCtrl.createEmailTemplate);
router.get('/templates/:id', requireRole('owner', 'manager', 'trainer'), retCtrl.getEmailTemplateById);
router.put('/templates/:id', requireRole('owner', 'manager'), retCtrl.updateEmailTemplate);
router.delete('/templates/:id', requireRole('owner', 'manager'), retCtrl.deleteEmailTemplate);

// Member Announcements
router.get('/announcements', requireRole('owner', 'manager', 'trainer'), retCtrl.getMemberAnnouncements);
router.post('/announcements', requireRole('owner', 'manager'), retCtrl.createMemberAnnouncement);

// Automated Renewal Reminders
router.get('/renewals/expiring', requireRole('owner', 'manager', 'trainer'), retCtrl.getExpiringMembersForRenewal);
router.post('/renewals/send-reminder', requireRole('owner', 'manager', 'trainer'), retCtrl.sendRenewalReminder);

// Inactive Member Follow-ups
router.get('/inactives', requireRole('owner', 'manager', 'trainer'), retCtrl.getInactiveMembers);
router.post('/inactives/send-followup', requireRole('owner', 'manager', 'trainer'), retCtrl.sendInactiveFollowup);

// Member Feedback (NPS)
router.get('/feedbacks', requireRole('owner', 'manager', 'trainer'), retCtrl.getFeedbacks);
router.post('/feedbacks', requireRole('owner', 'manager', 'trainer'), retCtrl.createFeedback);
router.patch('/feedbacks/:id/respond', requireRole('owner', 'manager'), retCtrl.respondToFeedback);

// Complaints Management
router.get('/complaints', requireRole('owner', 'manager', 'trainer'), retCtrl.getComplaints);
router.post('/complaints', requireRole('owner', 'manager', 'trainer'), retCtrl.createComplaint);
router.patch('/complaints/:id/status', requireRole('owner', 'manager'), retCtrl.updateComplaintStatus);

// Communication History
router.get('/history', requireRole('owner', 'manager', 'trainer'), retCtrl.getCommunicationHistory);
router.post('/history', requireRole('owner', 'manager', 'trainer'), retCtrl.logCommunication);

export default router;

