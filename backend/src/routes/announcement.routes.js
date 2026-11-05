import { Router } from 'express';
import * as announcementController from '../controllers/announcement.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

// Public / Kiosk: GET /api/v1/announcements
router.get('/', announcementController.getAnnouncements);

// RBAC Protected (Owner, Manager)
router.post('/', authenticateToken, requireRole('owner', 'manager'), announcementController.createAnnouncement);
router.put('/:id', authenticateToken, requireRole('owner', 'manager'), announcementController.updateAnnouncement);
router.delete('/:id', authenticateToken, requireRole('owner', 'manager'), announcementController.deleteAnnouncement);

export default router;

