import { Router } from 'express';
import * as memberController from '../controllers/member.controller.js';
import { authenticateToken, requireRole, requireResourceOwner } from '../middlewares/auth.js';

const router = Router();

// Public / Kiosk endpoints
router.post('/check-in', memberController.checkIn);
router.post('/enquiry', memberController.createEnquiry);
router.get('/lookup/:identifier', memberController.lookupMember);
router.get('/recent-checkins', memberController.getRecentCheckIns);
router.get('/enquiries', memberController.getEnquiries);

// Enquiry status update: Owner, Manager
router.patch('/enquiries/:id', authenticateToken, requireRole('owner', 'manager'), memberController.updateEnquiry);

// Member Management: Owner, Manager, Trainer
router.get('/', authenticateToken, requireRole('owner', 'manager', 'trainer'), memberController.listMembers);
router.post('/', authenticateToken, requireRole('owner', 'manager'), memberController.createMember);
router.put('/:id', authenticateToken, requireRole('owner', 'manager'), memberController.updateMember);
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
