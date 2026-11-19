/**
 * Virtex Admin - Fitness Books and Digital Library Router
 * Secure REST routes for catalogue exploration, digital uploads, purchase history,
 * reading progress tracking, and protected document downloads.
 */

import { Router } from 'express';
import * as libController from '../controllers/library.controller.js';
import { requireRole } from '../middlewares/auth.js';

const router = Router();

// KPIs & Analytics
router.get('/kpis/summary', requireRole('owner', 'manager', 'trainer'), libController.getLibraryKpis);

// Book Catalogue & Publishing
router.get('/', requireRole('owner', 'manager', 'trainer'), libController.getBooks);
router.post('/', requireRole('owner', 'manager', 'trainer'), libController.createBook);
router.get('/:id', requireRole('owner', 'manager', 'trainer'), libController.getBookById);
router.patch('/:id', requireRole('owner', 'manager', 'trainer'), libController.updateBook);
router.delete('/:id', requireRole('owner', 'manager'), libController.deleteBook);

// Secure Access Controlled Document Stream
router.get('/:id/download', requireRole('owner', 'manager', 'trainer'), libController.downloadSecureDocument);

// Purchases & Invoices
router.get('/purchases/all', requireRole('owner', 'manager', 'trainer'), libController.getPurchases);
router.post('/purchases', requireRole('owner', 'manager', 'trainer'), libController.recordPurchase);

// Reading Progress Tracking
router.get('/progress/all', requireRole('owner', 'manager', 'trainer'), libController.getReadingProgress);
router.post('/progress', requireRole('owner', 'manager', 'trainer'), libController.updateReadingProgress);

export default router;

