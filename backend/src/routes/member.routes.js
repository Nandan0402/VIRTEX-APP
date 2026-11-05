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

// Authenticated & Resource-protected history endpoint
router.get(
  '/history/:memberId',
  authenticateToken,
  requireRole('owner', 'manager', 'trainer', 'member'),
  requireResourceOwner({ idParam: 'memberId', role: 'member' }),
  memberController.getMemberHistory
);

export default router;
