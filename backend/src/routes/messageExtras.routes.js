/**
 * /api/v1/messages — 📎 attachments and 📊 polls in Messages, for members, trainers and the gym team (migration 034).
 * Access per conversation is checked in messageExtras.controller.js.
 */
import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.js';
import * as c from '../controllers/messageExtras.controller.js';

const router = Router();
router.use(authenticateToken);
router.get('/files/:fileId', c.downloadFile);
router.post('/polls/:pollId/vote', c.votePoll);
router.post('/polls/:pollId/close', c.closePoll);
router.get('/:threadId/extras', c.getExtras);
router.post('/:threadId/attachments', c.postAttachment);
router.post('/:threadId/polls', c.postPoll);
export default router;
