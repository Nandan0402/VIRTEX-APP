import { Router } from 'express';
import * as faqController from '../controllers/faq.controller.js';

const router = Router();

// GET /api/faqs
router.get('/', faqController.getFaqs);

export default router;

