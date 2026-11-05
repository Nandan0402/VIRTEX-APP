import { Router } from 'express';
import * as faqController from '../controllers/faq.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

// Public: GET /api/faqs
router.get('/', faqController.getFaqs);

// RBAC Protected: Owner, Manager
router.post('/', authenticateToken, requireRole('owner', 'manager'), faqController.createFaq);
router.put('/:id', authenticateToken, requireRole('owner', 'manager'), faqController.updateFaq);
router.delete('/:id', authenticateToken, requireRole('owner', 'manager'), faqController.deleteFaq);

export default router;

