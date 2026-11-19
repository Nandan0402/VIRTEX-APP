import { Router } from 'express';
import * as memberController from '../controllers/member.controller.js';
import * as birthdayController from '../controllers/birthday.controller.js';
import { authenticateToken, requireRole, requireResourceOwner } from '../middlewares/auth.js';

const router = Router();

// Public / Kiosk endpoints
router.post('/check-in', memberController.checkIn);
router.post('/enquiry', memberController.createEnquiry);
router.post('/enquiries', memberController.createEnquiry);
router.get('/lookup/:identifier', memberController.lookupMember);
router.get('/recent-checkins', memberController.getRecentCheckIns);
// Lead list contains prospects' personal data -> Admin only (was public)
router.get('/enquiries', authenticateToken, requireRole('owner', 'manager'), memberController.getEnquiries);

// Fees & Birthday Alerts (Must precede generic /:id routes)
// Gym-wide member lists -> Admin only (trainers see their own clients via /api/trainer/clients)
router.get('/fees-alert', authenticateToken, requireRole('owner', 'manager'), memberController.getFeesAlerts);
router.get('/birthday-alert', authenticateToken, requireRole('owner', 'manager'), memberController.getBirthdayAlerts);
// Automatic birthday wishes (members + personal trainers) and trainer dates of birth
router.get('/birthday-auto', authenticateToken, requireRole('owner', 'manager'), birthdayController.autoStatus);
router.post('/birthday-auto/run', authenticateToken, requireRole('owner', 'manager'), birthdayController.runNow);
router.get('/birthday-trainers', authenticateToken, requireRole('owner', 'manager'), birthdayController.listTrainers);
router.patch('/birthday-trainers/:id/dob', authenticateToken, requireRole('owner', 'manager'), birthdayController.setTrainerDob);

// Specific member alert & payment actions
router.post('/:id/send-fee-alert', authenticateToken, requireRole('owner', 'manager'), memberController.sendFeeAlert);
router.post('/:id/send-birthday-wish', authenticateToken, requireRole('owner', 'manager'), memberController.sendBirthdayWish);
router.patch('/:id/dob', authenticateToken, requireRole('owner', 'manager'), memberController.updateDob);

// Enquiry status update: Owner, Manager
router.patch('/enquiries/:id', authenticateToken, requireRole('owner', 'manager'), memberController.updateEnquiry);

// Member Management: Owner, Manager (trainers use /api/trainer/clients — own clients only)
router.get('/', authenticateToken, requireRole('owner', 'manager'), memberController.listMembers);
router.post('/', authenticateToken, requireRole('owner', 'manager'), memberController.createMember);
router.put('/:id', authenticateToken, requireRole('owner', 'manager'), memberController.updateMember);
router.post('/:id/pay-fees', authenticateToken, requireRole('owner', 'manager'), memberController.payMemberFees);
router.patch('/:id/freeze', authenticateToken, requireRole('owner', 'manager'), memberController.freezeMember);
router.delete('/:id/fees', authenticateToken, requireRole('owner', 'manager'), memberController.deleteMemberFees);
router.delete('/:id', authenticateToken, requireRole('owner', 'manager'), memberController.deleteMember);

// Authenticated & Resource-protected history endpoint
router.get(
  '/history/:memberId',
  authenticateToken,
  requireRole('owner', 'manager', 'trainer', 'member'),
  requireResourceOwner({ idParam: 'memberId', role: 'member' }),
  memberController.getMemberHistory
);

export default router;
