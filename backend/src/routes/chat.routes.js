import { Router } from 'express';
import * as chatController from '../controllers/chat.controller.js';
import { validateChatMessage } from '../middlewares/validator.js';

const router = Router();

router.post('/message', validateChatMessage, chatController.sendMessage);
router.get('/languages', chatController.listLanguages);

export default router;

