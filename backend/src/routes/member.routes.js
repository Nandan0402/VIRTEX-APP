import { Router } from 'express';
import * as memberController from '../controllers/member.controller.js';

const router = Router();

router.post('/check-in', memberController.checkIn);
router.get('/recent-checkins', memberController.getRecentCheckIns);
router.get('/lookup/:identifier', memberController.lookupMember);

export default router;

