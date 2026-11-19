/**
 * Virtex Admin - Finance and Billing Expansion Controller
 * REST request handlers for admission fees, packages, app access, transactions,
 * tax invoices, receipts, dues reporting, refunds, discounts, expenses, and trainer commissions.
 */

import * as finRepo from '../repositories/finance.repository.js';

// ----------------------------------------------------
// 1. ADMISSION FEES
// ----------------------------------------------------

export async function getAdmissionFees(req, res) {
  try {
    const fees = await finRepo.getAdmissionFees();
    const records = await finRepo.getMemberAdmissionRecords();
    res.json({ success: true, data: { configurations: fees, records } });
  } catch (err) {
    console.error('Error fetching admission fees:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve admission fees' });
  }
}

export async function createAdmissionFee(req, res) {
  try {
    const { name, amount } = req.body;
    if (!name || amount === undefined) {
      return res.status(400).json({ success: false, message: 'Fee name and amount are required' });
    }

    const fee = await finRepo.createAdmissionFee(req.body);
    res.status(201).json({ success: true, data: fee, message: 'Admission fee tier created' });
  } catch (err) {
    console.error('Error creating admission fee:', err);
    res.status(500).json({ success: false, message: 'Failed to create admission fee' });
  }
}

export async function recordMemberAdmission(req, res) {
  try {
    const { member_id, amount } = req.body;
    if (!member_id) {
      return res.status(400).json({ success: false, message: 'Member ID is required' });
    }

    const rec = await finRepo.recordMemberAdmission(req.body);
    res.status(201).json({ success: true, data: rec, message: 'Member admission fee recorded' });
  } catch (err) {
    console.error('Error recording member admission:', err);
    res.status(500).json({ success: false, message: 'Failed to record member admission' });
  }
}

// ----------------------------------------------------
// 2. MEMBERSHIP PACKAGE PRICING
// ----------------------------------------------------

export async function getMembershipPackages(req, res) {
  try {
    const packages = await finRepo.getMembershipPackages();
    res.json({ success: true, data: packages });
  } catch (err) {
    console.error('Error fetching membership packages:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve membership packages' });
  }
}

export async function updatePackagePrice(req, res) {
  try {
    const { id } = req.params;
    const updated = await finRepo.updatePackagePrice(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Package plan not found' });
    }
    res.json({ success: true, data: updated, message: 'Membership package pricing updated' });
  } catch (err) {
    console.error('Error updating package pricing:', err);
    res.status(500).json({ success: false, message: 'Failed to update package pricing' });
  }
}

// ----------------------------------------------------
// 3. DIGITAL APPLICATION ACCESS FEES
// ----------------------------------------------------

export async function getDigitalAppFees(req, res) {
  try {
    const fees = await finRepo.getDigitalAppFees();
    const subs = await finRepo.getMemberAppSubscriptions();
    res.json({ success: true, data: { configurations: fees, subscriptions: subs } });
  } catch (err) {
    console.error('Error fetching app fees:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve digital app fees' });
  }
}

export async function subscribeMemberAppFee(req, res) {
  try {
    const { member_id } = req.body;
    if (!member_id) {
      return res.status(400).json({ success: false, message: 'Member ID is required' });
    }

    const sub = await finRepo.subscribeMemberAppFee(req.body);
    res.status(201).json({ success: true, data: sub, message: 'Digital app access fee recorded' });
  } catch (err) {
    console.error('Error recording app subscription:', err);
    res.status(500).json({ success: false, message: 'Failed to record app subscription' });
  }
}

// ----------------------------------------------------
// 4. FINANCIAL TRANSACTIONS, INVOICES & RECEIPTS
// ----------------------------------------------------

export async function getFinancialTransactions(req, res) {
  try {
    const { member_id, transaction_type, payment_status } = req.query;
    const txs = await finRepo.getFinancialTransactions({ member_id, transaction_type, payment_status });
    res.json({ success: true, data: txs });
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve financial transactions' });
  }
}

export async function createFinancialTransaction(req, res) {
  try {
    const { member_id, amount, transaction_type } = req.body;
    if (!amount) {
      return res.status(400).json({ success: false, message: 'Amount is required' });
    }

    const tx = await finRepo.createFinancialTransaction(req.body);
    res.status(201).json({ success: true, data: tx, message: 'Transaction and GST invoice recorded' });
  } catch (err) {
    console.error('Error creating transaction:', err);
    res.status(500).json({ success: false, message: 'Failed to record transaction' });
  }
}

export async function getTransactionInvoice(req, res) {
  try {
    const { id } = req.params;
    const tx = await finRepo.getTransactionById(id);
    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Breakdown invoice components
    const invoice = {
      invoiceNumber: tx.invoice_number,
      receiptNumber: tx.receipt_number,
      date: tx.transaction_date,
      paymentMethod: tx.payment_method,
      paymentStatus: tx.payment_status,
      member: {
        id: tx.member_id,
        name: tx.member_name,
        code: tx.member_code,
        phone: tx.member_phone,
        email: tx.member_email,
        plan: tx.plan_name
      },
      lineItems: [
        {
          description: `Virtex Fitness Subscription (${tx.transaction_type.toUpperCase()})`,
          amount: parseFloat(tx.amount),
          discount: parseFloat(tx.discount_amount),
          taxable: parseFloat(tx.amount) - parseFloat(tx.discount_amount),
          gstTax18Pct: parseFloat(tx.tax_amount),
          netTotal: parseFloat(tx.net_amount)
        }
      ],
      grossTotal: parseFloat(tx.amount),
      discountTotal: parseFloat(tx.discount_amount),
      gstTotal: parseFloat(tx.tax_amount),
      netPayable: parseFloat(tx.net_amount)
    };

    res.json({ success: true, data: invoice });
  } catch (err) {
    console.error('Error fetching invoice details:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve invoice' });
  }
}

// ----------------------------------------------------
// 5. OUTSTANDING DUES REPORTS
// ----------------------------------------------------

export async function getOutstandingDuesReport(req, res) {
  try {
    const dues = await finRepo.getOutstandingDuesReport();
    res.json({ success: true, data: dues });
  } catch (err) {
    console.error('Error fetching dues report:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve dues report' });
  }
}

// ----------------------------------------------------
// 6. REFUND MANAGEMENT
// ----------------------------------------------------

export async function getRefundRequests(req, res) {
  try {
    const refunds = await finRepo.getRefundRequests();
    res.json({ success: true, data: refunds });
  } catch (err) {
    console.error('Error fetching refunds:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve refunds' });
  }
}

export async function createRefundRequest(req, res) {
  try {
    const { member_id, amount, reason } = req.body;
    if (!member_id || !amount || !reason) {
      return res.status(400).json({ success: false, message: 'Member ID, amount, and reason are required' });
    }

    const refund = await finRepo.createRefundRequest(req.body);
    res.status(201).json({ success: true, data: refund, message: 'Refund request submitted' });
  } catch (err) {
    console.error('Error requesting refund:', err);
    res.status(500).json({ success: false, message: 'Failed to create refund request' });
  }
}

export async function processRefund(req, res) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const updated = await finRepo.processRefund(id, {
      status,
      notes,
      approved_by_user_id: req.user?.id || null
    });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Refund request not found' });
    }
    res.json({ success: true, data: updated, message: `Refund request updated to ${status}` });
  } catch (err) {
    console.error('Error processing refund:', err);
    res.status(500).json({ success: false, message: 'Failed to process refund' });
  }
}

// ----------------------------------------------------
// 7. PROMOTIONAL DISCOUNTS
// ----------------------------------------------------

export async function getPromotionalDiscounts(req, res) {
  try {
    const discounts = await finRepo.getPromotionalDiscounts();
    res.json({ success: true, data: discounts });
  } catch (err) {
    console.error('Error fetching discounts:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve discounts' });
  }
}

export async function createPromotionalDiscount(req, res) {
  try {
    const { code, discount_value } = req.body;
    if (!code || discount_value === undefined) {
      return res.status(400).json({ success: false, message: 'Promo code and discount value are required' });
    }

    const discount = await finRepo.createPromotionalDiscount(req.body);
    res.status(201).json({ success: true, data: discount, message: 'Promotional discount created' });
  } catch (err) {
    console.error('Error creating discount:', err);
    res.status(500).json({ success: false, message: 'Failed to create promotional discount' });
  }
}

// ----------------------------------------------------
// 8. GYM OPERATING EXPENSES
// ----------------------------------------------------

export async function getExpenses(req, res) {
  try {
    const { category, status, start_date, end_date } = req.query;
    const expenses = await finRepo.getExpenses({ category, status, start_date, end_date });
    res.json({ success: true, data: expenses });
  } catch (err) {
    console.error('Error fetching expenses:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve expenses' });
  }
}

export async function createExpense(req, res) {
  try {
    const { category, title, amount } = req.body;
    if (!category || !title || !amount) {
      return res.status(400).json({ success: false, message: 'Category, title, and amount are required' });
    }

    const expense = await finRepo.createExpense({
      ...req.body,
      created_by_user_id: req.user?.id || null
    });
    res.status(201).json({ success: true, data: expense, message: 'Operating expense logged' });
  } catch (err) {
    console.error('Error logging expense:', err);
    res.status(500).json({ success: false, message: 'Failed to record expense' });
  }
}

// ----------------------------------------------------
// 9. TRAINER COMMISSIONS
// ----------------------------------------------------

export async function getTrainerCommissions(req, res) {
  try {
    const { period_month, trainer_id } = req.query;
    const commissions = await finRepo.getTrainerCommissions({ period_month, trainer_id });
    res.json({ success: true, data: commissions });
  } catch (err) {
    console.error('Error fetching trainer commissions:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve commissions' });
  }
}

export async function calculateTrainerCommissions(req, res) {
  try {
    const { period_month } = req.body;
    const calculated = await finRepo.calculateTrainerCommissionsForMonth(period_month);
    res.json({ success: true, data: calculated, message: `Commissions calculated for ${calculated.length} assignments` });
  } catch (err) {
    console.error('Error calculating trainer commissions:', err);
    res.status(500).json({ success: false, message: 'Failed to calculate commissions' });
  }
}

// ----------------------------------------------------
// 10. REVENUE REPORTS & ANALYTICS
// ----------------------------------------------------

export async function getMonthlyRevenueReports(req, res) {
  try {
    const { year } = req.query;
    const reports = await finRepo.getMonthlyRevenueReports({ year });
    res.json({ success: true, data: reports });
  } catch (err) {
    console.error('Error fetching monthly revenue reports:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve revenue reports' });
  }
}

export async function getFinancialAnalytics(req, res) {
  try {
    const analytics = await finRepo.getFinancialAnalytics();
    res.json({ success: true, data: analytics });
  } catch (err) {
    console.error('Error fetching financial analytics:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve financial analytics' });
  }
}

