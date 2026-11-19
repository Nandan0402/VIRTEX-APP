-- Migration 014: Finance and Billing Expansion
-- Extends existing members, membership_plans, and PT assignments with:
-- 1. Admission fee management
-- 2. Membership package pricing configuration
-- 3. Digital application access fees
-- 4. Unified payment history & transactions
-- 5. Tax invoice generation
-- 6. Payment receipts
-- 7. Outstanding dues reporting
-- 8. Refund management
-- 9. Discounts & promotional offers
-- 10. Monthly revenue reports
-- 11. Gym expense ledger
-- 12. Trainer commission calculations
-- 13. High-level financial analytics

-- 1. Admission Fee Configurations & Member Records
CREATE TABLE IF NOT EXISTS admission_fees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  amount NUMERIC(8,2) NOT NULL DEFAULT 1000.00,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_admission_records (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  admission_fee_id INTEGER REFERENCES admission_fees(id) ON DELETE SET NULL,
  amount NUMERIC(8,2) NOT NULL DEFAULT 1000.00,
  status VARCHAR(20) NOT NULL DEFAULT 'paid', -- 'paid', 'waived', 'pending'
  waiver_reason TEXT,
  receipt_code VARCHAR(100) UNIQUE,
  paid_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Digital Application Access Fees
CREATE TABLE IF NOT EXISTS digital_app_fees (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  billing_cycle VARCHAR(20) NOT NULL DEFAULT 'annual', -- 'annual', 'monthly', 'lifetime'
  amount NUMERIC(8,2) NOT NULL DEFAULT 499.00,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_app_fee_subscriptions (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  app_fee_id INTEGER REFERENCES digital_app_fees(id) ON DELETE SET NULL,
  amount_paid NUMERIC(8,2) NOT NULL DEFAULT 499.00,
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  payment_status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'expired', 'pending'
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Promotional Discounts & Coupons
CREATE TABLE IF NOT EXISTS promotional_discounts (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage', -- 'percentage', 'flat'
  discount_value NUMERIC(8,2) NOT NULL DEFAULT 10.00,
  min_purchase_amount NUMERIC(8,2) NOT NULL DEFAULT 0.00,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  max_uses INTEGER DEFAULT 100,
  times_used INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Unified Financial Transactions Ledger (Inflows)
CREATE TABLE IF NOT EXISTS financial_transactions (
  id SERIAL PRIMARY KEY,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  transaction_type VARCHAR(50) NOT NULL, -- 'membership', 'admission_fee', 'app_access_fee', 'pt_fee', 'book_purchase'
  reference_id INTEGER,
  amount NUMERIC(10,2) NOT NULL,
  tax_amount NUMERIC(8,2) NOT NULL DEFAULT 0.00, -- 18% GST component
  discount_amount NUMERIC(8,2) NOT NULL DEFAULT 0.00,
  net_amount NUMERIC(10,2) NOT NULL,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'UPI / QR',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'completed', -- 'completed', 'pending', 'refunded', 'failed'
  invoice_number VARCHAR(100) UNIQUE NOT NULL,
  receipt_number VARCHAR(100) UNIQUE NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fin_tx_member ON financial_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_date ON financial_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_fin_tx_type ON financial_transactions(transaction_type);

-- 5. Refund Requests & Approvals
CREATE TABLE IF NOT EXISTS refund_requests (
  id SERIAL PRIMARY KEY,
  transaction_id INTEGER REFERENCES financial_transactions(id) ON DELETE SET NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'requested', -- 'requested', 'approved', 'processed', 'rejected'
  approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  notes TEXT
);

-- 6. Gym Operating Expenses Ledger (Outflows)
CREATE TABLE IF NOT EXISTS gym_expenses (
  id SERIAL PRIMARY KEY,
  category VARCHAR(50) NOT NULL, -- 'Equipment Maintenance', 'Facility Rent', 'Electricity & Utilities', 'Staff Salaries', 'Supplements & Goods', 'Software & Robotics', 'Marketing & Events'
  title VARCHAR(255) NOT NULL,
  vendor_name VARCHAR(255) NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  expense_date DATE NOT NULL,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'Bank Transfer',
  invoice_ref VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'paid', -- 'paid', 'pending'
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gym_expenses_date ON gym_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_gym_expenses_cat ON gym_expenses(category);

-- 7. Trainer Commission Calculations
CREATE TABLE IF NOT EXISTS trainer_commissions (
  id SERIAL PRIMARY KEY,
  trainer_id INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  assignment_id INTEGER REFERENCES personal_trainer_assignments(id) ON DELETE SET NULL,
  period_month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
  gross_revenue NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  commission_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 25.00,
  commission_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  payout_status VARCHAR(20) NOT NULL DEFAULT 'calculated', -- 'calculated', 'approved', 'paid'
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trainer_comm_trainer ON trainer_commissions(trainer_id, period_month);

-- Seed Initial Baseline Records
DO $$
DECLARE
  v_mem_rahul INTEGER;
  v_mem_priya INTEGER;
  v_mem_david INTEGER;
  v_trn_arjun INTEGER;
  v_trn_karan INTEGER;
  v_pt_assign INTEGER;
  v_tx_id INTEGER;
BEGIN
  -- Lookup existing members
  SELECT id INTO v_mem_rahul FROM members WHERE full_name ILIKE '%Rahul%' LIMIT 1;
  SELECT id INTO v_mem_priya FROM members WHERE full_name ILIKE '%Priya%' LIMIT 1;
  SELECT id INTO v_mem_david FROM members WHERE full_name ILIKE '%David%' LIMIT 1;

  IF v_mem_rahul IS NULL THEN SELECT id INTO v_mem_rahul FROM members LIMIT 1; END IF;
  IF v_mem_priya IS NULL THEN SELECT id INTO v_mem_priya FROM members LIMIT 1; END IF;
  IF v_mem_david IS NULL THEN SELECT id INTO v_mem_david FROM members LIMIT 1; END IF;

  -- Lookup existing trainers
  SELECT id INTO v_trn_arjun FROM trainers WHERE full_name ILIKE '%Arjun%' LIMIT 1;
  SELECT id INTO v_trn_karan FROM trainers WHERE full_name ILIKE '%Karan%' LIMIT 1;

  IF v_trn_arjun IS NULL THEN SELECT id INTO v_trn_arjun FROM trainers LIMIT 1; END IF;
  IF v_trn_karan IS NULL THEN SELECT id INTO v_trn_karan FROM trainers LIMIT 1; END IF;

  -- 1. Seed Admission Fee Configurations
  INSERT INTO admission_fees (name, amount, description)
  VALUES 
    ('Standard Lifetime Registration Fee', 1500.00, 'One-time onboarding fee, RFID club card, biometric sync, and locker allocation.'),
    ('Student & Youth Discounted Admission', 750.00, 'Reduced enrollment fee for collegiate athletes and youth fitness members.')
  ON CONFLICT DO NOTHING;

  -- Seed Rahul & Priya Admission records
  IF v_mem_rahul IS NOT NULL THEN
    INSERT INTO member_admission_records (member_id, amount, status, receipt_code, paid_at)
    VALUES (v_mem_rahul, 1500.00, 'paid', 'REC-ADM-2026-001', NOW() - INTERVAL '30 days')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_mem_priya IS NOT NULL THEN
    INSERT INTO member_admission_records (member_id, amount, status, receipt_code, paid_at)
    VALUES (v_mem_priya, 1500.00, 'paid', 'REC-ADM-2026-002', NOW() - INTERVAL '20 days')
    ON CONFLICT DO NOTHING;
  END IF;

  -- 2. Seed Digital App Fees
  INSERT INTO digital_app_fees (title, billing_cycle, amount, description)
  VALUES 
    ('Virtex AI Mobile & Robot Portal Access', 'annual', 499.00, 'Access to kiosk AI conversational features, mobile workout tracker, and streaming VOD.')
  ON CONFLICT DO NOTHING;

  -- Seed App Subscriptions
  IF v_mem_rahul IS NOT NULL THEN
    INSERT INTO member_app_fee_subscriptions (member_id, amount_paid, valid_from, valid_until, payment_status)
    VALUES (v_mem_rahul, 499.00, CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '335 days', 'active')
    ON CONFLICT DO NOTHING;
  END IF;

  -- 3. Seed Promotional Discounts
  INSERT INTO promotional_discounts (code, description, discount_type, discount_value, min_purchase_amount, start_date, end_date, max_uses, times_used, is_active)
  VALUES 
    ('FESTIVE2026', 'New Year & Diwali Athletic Special - 15% Off All Annual Plans', 'percentage', 15.00, 10000.00, CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE + INTERVAL '45 days', 100, 14, true),
    ('PULSE1000', 'Flat ₹1,000 Off Quarterly and Semi-Annual Packages', 'flat', 1000.00, 5000.00, CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '60 days', 50, 8, true),
    ('FITBOTVIP', 'Exclusive ₹500 Discount on AI Kiosk Robot Registration', 'flat', 500.00, 2000.00, CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '30 days', 30, 5, true)
  ON CONFLICT (code) DO NOTHING;

  -- 4. Seed Financial Transactions (Reusing existing member payment records)
  IF v_mem_rahul IS NOT NULL THEN
    INSERT INTO financial_transactions (
      member_id, transaction_type, amount, tax_amount, discount_amount, net_amount,
      payment_method, payment_status, invoice_number, receipt_number, transaction_date, notes
    )
    VALUES (
      v_mem_rahul, 'membership', 18999.00, 2898.15, 0.00, 18999.00,
      'UPI / QR', 'completed', 'INV-2026-0001', 'REC-2026-0001', NOW() - INTERVAL '30 days', 'Platinum Annual membership renewal'
    )
    RETURNING id INTO v_tx_id;
  END IF;

  IF v_mem_priya IS NOT NULL THEN
    INSERT INTO financial_transactions (
      member_id, transaction_type, amount, tax_amount, discount_amount, net_amount,
      payment_method, payment_status, invoice_number, receipt_number, transaction_date, notes
    )
    VALUES (
      v_mem_priya, 'membership', 3999.00, 610.00, 0.00, 3999.00,
      'Credit Card', 'completed', 'INV-2026-0002', 'REC-2026-0002', NOW() - INTERVAL '20 days', 'Gold Quarterly partial installment (₹2,000 due)'
    );
  END IF;

  -- 5. Seed Refund Request
  IF v_mem_david IS NOT NULL THEN
    INSERT INTO refund_requests (member_id, amount, reason, status, requested_at, notes)
    VALUES (
      v_mem_david, 1200.00, 'Duplicate digital locker fee processed on card.',
      'approved', NOW() - INTERVAL '2 days', 'Approved by Operations Manager; refund processed to original payment method.'
    );
  END IF;

  -- 6. Seed Gym Operating Expenses
  INSERT INTO gym_expenses (category, title, vendor_name, amount, expense_date, payment_method, invoice_ref, status, notes)
  VALUES 
    ('Equipment Maintenance', 'Bi-Monthly Cable & Pulley System Servicing', 'Titan Gym Tech & Services', 4500.00, CURRENT_DATE - INTERVAL '12 days', 'Bank Transfer', 'BILL-TITAN-889', 'paid', 'Replaced 2 cables on 8-stack cable crossover.'),
    ('Facility Rent', 'Virtex Main Arena Monthly Premises Lease', 'Apex Prime Commercial Real Estate', 75000.00, CURRENT_DATE - INTERVAL '8 days', 'NEFT / RTGS', 'RENT-2026-NOV', 'paid', 'Monthly lease for 5,500 sq ft fitness facility.'),
    ('Electricity & Utilities', 'Commercial HVAC & Power Grid Bill', 'BESCOM Power Utility', 16800.00, CURRENT_DATE - INTERVAL '5 days', 'Net Banking', 'BESCOM-98441', 'paid', 'Covers HVAC, LED floor illumination, and robot charging stations.'),
    ('Software & Robotics', 'ESP32 Wi-Fi IoT Mesh & Cloud Server Hosting', 'Google Cloud Platform', 3200.00, CURRENT_DATE - INTERVAL '2 days', 'Corporate Card', 'GCP-INV-114', 'paid', 'Express API backend and real-time WebSocket fleet server.'),
    ('Supplements & Goods', 'Front Desk Whey Isolate & Hydration Restock', 'Optimum Sports Nutrition Dist.', 12500.00, CURRENT_DATE - INTERVAL '1 day', 'UPI Business', 'OPT-9921', 'paid', 'Chilled protein shakes and BCAAs for reception cooler.')
  ON CONFLICT DO NOTHING;

  -- 7. Seed Trainer Commission Calculation
  SELECT id INTO v_pt_assign FROM personal_trainer_assignments LIMIT 1;
  IF v_trn_karan IS NOT NULL THEN
    INSERT INTO trainer_commissions (trainer_id, assignment_id, period_month, gross_revenue, commission_rate_pct, commission_amount, payout_status, notes)
    VALUES (
      v_trn_karan, v_pt_assign, TO_CHAR(NOW(), 'YYYY-MM'), 6500.00, 25.00, 1625.00, 'calculated', 'Monthly commission on VIP personal training assignment.'
    );
  END IF;

END $$;

