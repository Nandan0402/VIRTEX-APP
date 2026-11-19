import { Router } from 'express';
import * as routineController from '../controllers/routine.controller.js';
import { authenticateToken, requireRole, normalizeRole } from '../middlewares/auth.js';

const router = Router();

// Routine status & operations: accessible to owner, manager, trainer, reception_staff
router.use(authenticateToken);
// Staff attendance only: member and guest accounts must not create staff punch records.
router.use((req, res, next) => (['member', 'guest'].includes(normalizeRole(req.user?.role))
  ? res.status(403).json({ success: false, error: 'The routine tracker is for staff accounts only.' })
  : next()));

router.get('/current', routineController.getCurrentStatus);
router.post('/punch-in', routineController.punchIn);
router.post('/break-start', routineController.startBreak);
router.post('/break-end', routineController.endBreak);
router.post('/punch-out', routineController.punchOut);
router.get('/history', routineController.getHistory);

export default router;

