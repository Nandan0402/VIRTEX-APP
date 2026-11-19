import { query, closePool } from '../backend/src/config/database.js';

async function cleanup() {
  console.log('--- Starting PostgreSQL Database Duplicate Cleanup ---');

  // 1. Delete all test/dummy enquiries from member_enquiries
  const delEnq = await query('DELETE FROM member_enquiries RETURNING id, full_name');
  console.log(`Deleted ${delEnq.rowCount} enquiries.`);

  // 2. Delete duplicate FAQs (keep lowest id)
  const delFaq = await query(`
    DELETE FROM faqs a
    USING faqs b
    WHERE a.id > b.id
      AND LOWER(a.question) = LOWER(b.question)
      AND a.language = b.language
    RETURNING a.id;
  `);
  console.log(`Deleted ${delFaq.rowCount} duplicate FAQs.`);

  // 3. Delete duplicate announcements (keep lowest id for each title)
  const delAnn = await query(`
    DELETE FROM announcements a
    USING announcements b
    WHERE a.id > b.id
      AND LOWER(a.title) = LOWER(b.title)
    RETURNING a.id, a.title;
  `);
  console.log(`Deleted ${delAnn.rowCount} duplicate announcements.`);

  // 3b. Delete duplicate members (keep lowest id per membership plan)
  const delMembers = await query(`
    DELETE FROM members a
    USING members b
    WHERE a.id > b.id
      AND LOWER(a.plan_name) = LOWER(b.plan_name)
    RETURNING a.id, a.member_code, a.full_name;
  `);
  console.log(`Deleted ${delMembers.rowCount} duplicate members.`);

  // 3c. Delete synthetic/test duplicate trainers
  const delTrainers = await query(`
    DELETE FROM trainers
    WHERE full_name ~ '[0-9]{4,}'
       OR email LIKE 'coach_%@%'
       OR trainer_code ~ 'TRN[0-9]{4,}'
    RETURNING id, trainer_code, full_name;
  `);
  console.log(`Deleted ${delTrainers.rowCount} duplicate/test trainers.`);

  // 3d. Delete duplicate membership plans (keep lowest id per name/plan_code)
  const delPlans = await query(`
    DELETE FROM membership_plans a
    USING membership_plans b
    WHERE a.id > b.id
      AND (LOWER(a.name) = LOWER(b.name) OR LOWER(a.plan_code) = LOWER(b.plan_code))
    RETURNING a.id, a.plan_code, a.name;
  `);
  console.log(`Deleted ${delPlans.rowCount} duplicate membership plans.`);

  // 3e. Standardize official membership plans, prices, and badges to remove duplicate "Popular" badge
  await query(`
    UPDATE membership_plans 
    SET badge_label = 'Starter', price_inr = 2499.00, is_featured = FALSE 
    WHERE plan_code = 'SILVER-01' OR LOWER(name) = 'silver monthly';

    UPDATE membership_plans 
    SET badge_label = 'Popular', price_inr = 5999.00, is_featured = TRUE 
    WHERE plan_code = 'GOLD-03' OR LOWER(name) = 'gold quarterly';

    UPDATE membership_plans 
    SET badge_label = 'VIP Elite', price_inr = 18999.00, is_featured = FALSE 
    WHERE plan_code = 'PLAT-12' OR LOWER(name) = 'platinum annual';
  `);
  console.log('Standardized plan prices and unique badges (Starter, Popular, VIP Elite).');

  // 3f. Seed baseline official trainers if empty or update their birthdays
  await query(`
    ALTER TABLE trainers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS date_of_birth DATE;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(10,2) DEFAULT 0.00;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_paid NUMERIC(10,2) DEFAULT 0.00;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_due NUMERIC(10,2) DEFAULT 0.00;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_due_date DATE;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'Cash';
    ALTER TABLE members ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'paid';

    INSERT INTO trainers (trainer_code, full_name, specialty, phone, email, bio, certifications, status, date_of_birth)
    VALUES 
      ('TRN001', 'Arjun Reddy', 'CrossFit & Olympic Weightlifting', '+91 98765 00001', 'arjun@virtexfitness.in', 'CrossFit Level 2 coach with 8+ years experience.', ARRAY['CSCS', 'CrossFit L2', 'CPR/AED'], 'on_floor', '1992-11-18'),
      ('TRN002', 'Meera Rao', 'Functional Mobility & Hatha Yoga', '+91 98765 00002', 'meera@virtexfitness.in', 'Specialist in spine rehabilitation and mobility.', ARRAY['RYT-500', 'Core Rehab Specialist'], 'in_session', '1995-11-25'),
      ('TRN003', 'Karan Verma', 'Hypertrophy & Physique Coach', '+91 98765 00003', 'karan@virtexfitness.in', 'Former competitive bodybuilder and nutrition coach.', ARRAY['ACE Personal Trainer', 'ISSN Sports Nutritionist'], 'off_duty', '1990-11-11')
    ON CONFLICT (trainer_code) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      specialty = EXCLUDED.specialty,
      phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      date_of_birth = EXCLUDED.date_of_birth;
  `);
  console.log('Synchronized official trainers with birth dates.');

  // 3g. Seed baseline official members with birth dates and fee tracking
  await query(`
    INSERT INTO members (member_code, full_name, phone, email, plan_id, plan_name, status, preferred_language, emergency_contact_name, emergency_contact_phone, notes, date_of_birth, fee_amount, fee_paid, fee_due, fee_due_date, payment_status, payment_method)
    VALUES
      ('GYM001', 'Rahul Sharma', '+91 98765 43210', 'rahul.sharma@example.com', 3, 'Platinum Annual', 'active', 'kn-IN', 'Sunita Sharma', '+91 98765 43290', 'Morning lifter; allergic to penicillin', '1996-11-15', 18999.00, 18999.00, 0.00, NULL, 'paid', 'UPI / QR'),
      ('GYM002', 'Priya Patel', '+91 98765 43211', 'priya.patel@example.com', 2, 'Gold Quarterly', 'active', 'hi-IN', 'Anand Patel', '+91 98765 43291', 'Interested in functional core training', '1998-11-22', 5999.00, 3999.00, 2000.00, '2026-11-20', 'partial', 'Credit Card'),
      ('GYM003', 'David Miller', '+91 98765 43212', 'david.miller@example.com', 1, 'Silver Monthly', 'active', 'en-IN', 'Sarah Miller', '+91 98765 43292', 'Locker keycard holder', '1994-11-09', 2499.00, 0.00, 2499.00, '2026-11-12', 'pending', 'Cash')
    ON CONFLICT (member_code) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      plan_name = EXCLUDED.plan_name,
      date_of_birth = EXCLUDED.date_of_birth,
      fee_amount = EXCLUDED.fee_amount,
      fee_paid = EXCLUDED.fee_paid,
      fee_due = EXCLUDED.fee_due,
      fee_due_date = EXCLUDED.fee_due_date,
      payment_status = EXCLUDED.payment_status,
      payment_method = EXCLUDED.payment_method;
  `);
  console.log('Synchronized official members with birth dates and fee balances.');

  // Link member_id to user rahul if exists
  await query(`
    UPDATE users u
    SET member_id = m.id
    FROM members m
    WHERE LOWER(u.email) = LOWER(m.email) AND u.member_id IS NULL;
  `);

  // 4. Delete temporary test users generated during test runs and preserve official names
  const delUsers = await query(`
    DELETE FROM users
    WHERE username LIKE 'mem_user_%'
       OR username LIKE 'coach_%'
       OR username LIKE 'admin_exec_%'
       OR username LIKE 'testadm_%'
    RETURNING id, username;
  `);
  console.log(`Deleted ${delUsers.rowCount} temporary test user accounts.`);
  await query("UPDATE users SET full_name = 'Nandan.B' WHERE username = 'owner_manju' OR id = 7");

  // 5. Delete test robot commands, hardware logs, and reset device telemetry
  const [delCmdLogs, delCmds, delLogs] = await Promise.all([
    query('DELETE FROM robot_command_logs RETURNING id'),
    query('DELETE FROM robot_commands RETURNING id'),
    query('DELETE FROM robot_logs RETURNING id'),
  ]);
  try {
    await query('ALTER SEQUENCE robot_commands_id_seq RESTART WITH 1');
    await query('ALTER SEQUENCE robot_command_logs_id_seq RESTART WITH 1');
  } catch (_) { }
  await query("UPDATE robot_devices SET status = 'offline', last_heartbeat = NULL, battery_level = NULL, wifi_rssi = NULL");
  console.log(`Deleted ${delCmds.rowCount} queued robot commands, ${delCmdLogs.rowCount} logs, and reset robot telemetry to offline.`);

  // 6. Delete test AI queries from interaction_logs
  const delInteractions = await query('DELETE FROM interaction_logs RETURNING id');
  try {
    await query('ALTER SEQUENCE interaction_logs_id_seq RESTART WITH 1');
  } catch (_) { }
  console.log(`Deleted ${delInteractions.rowCount} test AI interaction logs.`);

  // 7. Trim redundant test auth audit logs (keep last 25)
  const delAudit = await query(`
    DELETE FROM auth_audit_logs
    WHERE id NOT IN (
      SELECT id FROM auth_audit_logs ORDER BY id DESC LIMIT 25
    )
    RETURNING id;
  `);
  console.log(`Trimmed ${delAudit.rowCount} test auth audit logs.`);

  // 8. Verification summary
  const [enqRes, faqRes, annRes, trnRes, memRes, planRes, cmdRes, userRes, interRes] = await Promise.all([
    query('SELECT count(*) FROM member_enquiries'),
    query('SELECT count(*) FROM faqs'),
    query('SELECT count(*) FROM announcements'),
    query('SELECT count(*) FROM trainers'),
    query('SELECT count(*) FROM members'),
    query('SELECT count(*) FROM membership_plans'),
    query('SELECT count(*) FROM robot_commands'),
    query('SELECT id, username, email, role FROM users ORDER BY id'),
    query('SELECT count(*) FROM interaction_logs'),
  ]);

  console.log('\n--- Final PostgreSQL Database State ---');
  console.log(`member_enquiries count: ${enqRes.rows[0].count}`);
  console.log(`faqs count:             ${faqRes.rows[0].count}`);
  console.log(`announcements count:    ${annRes.rows[0].count}`);
  console.log(`trainers count:         ${trnRes.rows[0].count}`);
  console.log(`members count:          ${memRes.rows[0].count}`);
  console.log(`membership_plans count: ${planRes.rows[0].count}`);
  console.log(`robot_commands count:   ${cmdRes.rows[0].count}`);
  console.log(`ai_queries (interactions): ${interRes.rows[0].count}`);
  console.log(`official users count:   ${userRes.rows.length}`);
  userRes.rows.forEach(u => console.log(`  - [${u.role}] ${u.username} (${u.email})`));

  await closePool();
  console.log('--- Cleanup Finished Gracefully ---');
}

cleanup().catch((err) => {
  console.error('Cleanup error:', err);
  process.exit(1);
});

