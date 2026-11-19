/**
 * Virtex Admin - Finance and Billing Expansion Router
 * Secure REST routes for admission fees, membership package pricing, app fees,
 * payment history, invoices, dues reports, refunds, promo discounts, expenses,
 * trainer commissions, and financial analytics.
 */

import { Router } from 'express';
import * as finController from '../controllers/finance.controller.js';
import * as finDelete from '../controllers/financeDelete.controller.js';
import { requireRole } from '../middlewares/auth.js';

const router = Router();

// Analytics & Overview
router.get('/analytics/summary', requireRole('owner', 'manager'), finController.getFinancialAnalytics);
router.get('/reports/monthly', requireRole('owner', 'manager'), finController.getMonthlyRevenueReports);

// Transactions & Tax Invoices
router.get('/transactions/all', requireRole('owner', 'manager'), finController.getFinancialTransactions);
router.post('/transactions', requireRole('owner', 'manager'), finController.createFinancialTransaction);
router.delete('/transactions/:id', requireRole('owner', 'manager'), finDelete.deleteTransaction);   // audited; undoes a membership fee payment on the member
router.get('/transactions/:id/invoice', requireRole('owner', 'manager'), finController.getTransactionInvoice);

// Admission Fees & Digital App Access Fees
router.get('/admission-fees', requireRole('owner', 'manager'), finController.getAdmissionFees);
router.post('/admission-fees', requireRole('owner', 'manager'), finController.createAdmissionFee);
router.post('/admission-fees/record', requireRole('owner', 'manager'), finController.recordMemberAdmission);

router.get('/app-fees', requireRole('owner', 'manager'), finController.getDigitalAppFees);
router.post('/app-fees/subscribe', requireRole('owner', 'manager'), finController.subscribeMemberAppFee);

// Membership Packages
router.get('/packages', requireRole('owner', 'manager'), finController.getMembershipPackages);
router.patch('/packages/:id', requireRole('owner', 'manager'), finController.updatePackagePrice);

// Outstanding Dues Report
router.get('/dues/report', requireRole('owner', 'manager', 'trainer'), finController.getOutstandingDuesReport);

// Refunds & Disputes
router.get('/refunds/all', requireRole('owner', 'manager'), finController.getRefundRequests);
router.post('/refunds', requireRole('owner', 'manager'), finController.createRefundRequest);
router.patch('/refunds/:id', requireRole('owner', 'manager'), finController.processRefund);

// Discounts & Promo Codes
router.get('/discounts/all', requireRole('owner', 'manager'), finController.getPromotionalDiscounts);
router.post('/discounts', requireRole('owner', 'manager'), finController.createPromotionalDiscount);

// Gym Operating Expense Ledger
router.get('/expenses/all', requireRole('owner', 'manager'), finController.getExpenses);
router.post('/expenses', requireRole('owner', 'manager'), finController.createExpense);
router.delete('/expenses/:id', requireRole('owner', 'manager'), finDelete.deleteExpense);           // audited

// Trainer Commission Calculations
router.get('/commissions/all', requireRole('owner', 'manager', 'trainer'), finController.getTrainerCommissions);
router.post('/commissions/calculate', requireRole('owner', 'manager'), finController.calculateTrainerCommissions);

export default router;

