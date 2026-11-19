import { query, withTransaction } from '../config/database.js';
import bcrypt from 'bcryptjs';

/**
 * Find member by code or phone number
 * @param {string} identifier - member_code or 10-digit phone
 * @param {import('pg').PoolClient} [client]
 */
export async function findByIdentifier(identifier, client) {
  const cleanId = String(identifier).trim();
  const sql = `
    SELECT id, member_code, full_name, phone, email, plan_name, status, preferred_language, created_at
    FROM members
    WHERE member_code = $1 OR phone = $1
    LIMIT 1;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [cleanId]);
  return res.rows[0] || null;
}

/**
 * Find member by ID
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function findById(id, client) {
  const sql = `
    SELECT id, member_code, full_name, phone, email, plan_name, status, preferred_language, emergency_contact_name, emergency_contact_phone, notes,
           date_of_birth, fee_amount, fee_paid, fee_due, fee_due_date, payment_method, payment_status, created_at, gender
    FROM members
    WHERE id = $1
    LIMIT 1;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [id]);
  return res.rows[0] || null;
}

/**
 * Create a new gym member with optional user credentials provisioning
 * @param {Object} memberData
 * @param {import('pg').PoolClient} [client]
 */
export async function createMember(memberData, client) {
  const {
    memberCode,
    fullName,
    phone,
    email,
    password,
    username,
    planId,
    planName,
    status = 'active',
    preferredLanguage = 'en-IN',
    emergencyContactName,
    emergencyContactPhone,
    notes,
    dateOfBirth,
    feeAmount = 0.00,
    feePaid = 0.00,
    feeDue = 0.00,
    feeDueDate,
    paymentMethod = 'Cash',
    paymentStatus = 'paid',
    createdBy,
  } = memberData;

  const sql = `
    INSERT INTO members (
      member_code, full_name, phone, email, plan_id, plan_name, status,
      preferred_language, emergency_contact_name, emergency_contact_phone, notes,
      date_of_birth, fee_amount, fee_paid, fee_due, fee_due_date, payment_method, payment_status, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING id, member_code, full_name, phone, email, plan_name, status, preferred_language,
              date_of_birth, fee_amount, fee_paid, fee_due, fee_due_date, payment_method, payment_status, created_at;
  `;

  const executor = client || { query };
  const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;

  const res = await executor.query(sql, [
    memberCode,
    fullName,
    phone,
    cleanEmail,
    planId || null,
    planName || null,
    status,
    preferredLanguage,
    emergencyContactName || null,
    emergencyContactPhone || null,
    notes || null,
    dateOfBirth || null,
    feeAmount || 0,
    feePaid || 0,
    feeDue || 0,
    feeDueDate || null,
    paymentMethod || 'Cash',
    paymentStatus || 'paid',
    createdBy || null,
  ]);
  const newMember = res.rows[0];

  // Provision / link User login account for member if email is provided
  if (newMember && cleanEmail) {
    try {
      const userRes = await executor.query('SELECT id, username, role, member_id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1;', [cleanEmail]);
      let linkedUserId = null;
      let finalUsername = '';
      const existing = userRes.rows[0];

      if (existing && !(existing.role === 'member' && (existing.member_id === null || existing.member_id === newMember.id))) {
        // The email belongs to a staff login or to ANOTHER member's login. Never convert, re-password
        // or re-link it (that would demote staff / hijack an account); no duplicate login is created.
        newMember.user_account_note = 'This email is already used by another login, so no portal login was linked. Use a different email to give this member portal access.';
      } else if (existing) {
        linkedUserId = userRes.rows[0].id;
        finalUsername = userRes.rows[0].username;
        if (password && password.trim()) {
          const passHash = bcrypt.hashSync(password.trim(), 10);
          await executor.query(
            `UPDATE users 
             SET password_hash = $1, 
                 role = 'member', 
                 role_id = COALESCE((SELECT id FROM roles WHERE role_code = 'member'), role_id),
                 member_id = $2,
                 phone = COALESCE($3, phone),
                 full_name = COALESCE($4, full_name)
             WHERE id = $5;`,
            [passHash, newMember.id, phone || null, fullName, linkedUserId]
          );
        } else {
          await executor.query('UPDATE users SET member_id = $1 WHERE id = $2;', [newMember.id, linkedUserId]);
        }
      } else if (password && password.trim()) {
        let baseUser = (username || cleanEmail.split('@')[0] || ('mem_' + (newMember.member_code || '').toLowerCase())).toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (baseUser.length < 3) baseUser = 'mem_' + baseUser;
        let candidateUser = baseUser;
        let attempt = 0;
        while (attempt < 5) {
          const check = await executor.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1);', [candidateUser]);
          if (check.rowCount === 0) break;
          attempt++;
          candidateUser = `${baseUser}_${Math.floor(100 + Math.random() * 900)}`;
        }
        finalUsername = candidateUser;

        const passHash = bcrypt.hashSync(password.trim(), 10);
        const insUser = await executor.query(
          `INSERT INTO users (username, email, password_hash, full_name, role, role_id, phone, is_active, member_id)
           VALUES ($1, $2, $3, $4, 'member', (SELECT id FROM roles WHERE role_code = 'member'), $5, TRUE, $6)
           RETURNING id, username;`,
          [finalUsername, cleanEmail, passHash, fullName, phone || null, newMember.id]
        );
        if (insUser.rowCount > 0) {
          linkedUserId = insUser.rows[0].id;
        }
      }

      if (linkedUserId && password && password.trim()) {
        newMember.user_account = {
          username: finalUsername,
          email: cleanEmail,
          password: password.trim(),
          role: 'member',
          loginUrl: '/member-auth.html',
        };
      }
    } catch (authErr) {
      console.warn('[MemberRepo] Could not auto-provision user account for member:', authErr.message);
    }
  }

  return newMember;
}

/**
 * Record a check-in timestamp for a verified member
 * Trigger fn_check_in_duplicate_guard will enforce 5-minute cooldown
 * @param {number} memberId
 * @param {Object} [options] - { checkInMethod, deviceId, notes }
 * @param {import('pg').PoolClient} [client]
 */
export async function recordCheckIn(memberId, { checkInMethod = 'kiosk_voice', deviceId = 1, notes } = {}, client) {
  const sql = `
    INSERT INTO check_ins (member_id, check_in_time, check_in_method, device_id, notes)
    -- device_id only when that device is registered (robot_devices may be empty); never a dangling id
    VALUES ($1, NOW(), $2, (SELECT id FROM robot_devices WHERE id = $3::int), $4)
    RETURNING id, member_id, check_in_time, check_in_method, device_id;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [memberId, checkInMethod, deviceId, notes || null]);
  return res.rows[0];
}

/**
 * Retrieve recent check-in list
 * @param {number} limit
 * @param {import('pg').PoolClient} [client]
 */
export async function getRecentCheckIns(limit = 10, client) {
  const sql = `
    SELECT c.id, c.check_in_time, c.check_in_method, m.member_code, m.full_name, m.plan_name, m.preferred_language
    FROM check_ins c
    JOIN members m ON m.id = c.member_id
    ORDER BY c.check_in_time DESC
    LIMIT $1;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [limit]);
  return res.rows;
}

/**
 * Record a membership enquiry lead from the Kiosk or Web
 * @param {Object} enquiry
 * @param {import('pg').PoolClient} [client]
 */
export async function createEnquiry(enquiry, client) {
  const {
    fullName,
    phone,
    email,
    planName,
    preferredTiming,
    notes,
    assignedTrainerId,
    customizationType,
  } = enquiry;

  const sql = `
    INSERT INTO member_enquiries (
      full_name, phone, email, plan_name, preferred_timing, notes, status, assigned_trainer_id, customization_type
    ) VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $8)
    -- One open lead per phone (uq_member_enquiries_open_phone, migration 020):
    -- a repeat enquiry refreshes the existing lead instead of creating a duplicate.
    ON CONFLICT ((regexp_replace(phone, '\\D', '', 'g'))) WHERE status IN ('new', 'contacted')
    DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = COALESCE(EXCLUDED.email, member_enquiries.email),
      plan_name = COALESCE(EXCLUDED.plan_name, member_enquiries.plan_name),
      preferred_timing = COALESCE(EXCLUDED.preferred_timing, member_enquiries.preferred_timing),
      notes = COALESCE(EXCLUDED.notes, member_enquiries.notes),
      assigned_trainer_id = COALESCE(EXCLUDED.assigned_trainer_id, member_enquiries.assigned_trainer_id),
      customization_type = EXCLUDED.customization_type
    RETURNING id, full_name, phone, email, plan_name, preferred_timing, notes, status, assigned_trainer_id, customization_type, created_at;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, [
    fullName,
    phone,
    email || null,
    planName || null,
    preferredTiming || null,
    notes || null,
    assignedTrainerId || null,
    customizationType || 'Standard Gym Access',
  ]);
  return res.rows[0];
}

/**
 * Retrieve recent enquiries for the admin console
 * @param {number} limit
 * @param {import('pg').PoolClient} [client]
 */
export async function getRecentEnquiries(limit = 50, client) {
  const sql = `
    SELECT id, full_name, phone, email, plan_name, preferred_timing, notes, status, assigned_trainer_id, customization_type, created_at
    FROM member_enquiries
    ORDER BY created_at DESC
    LIMIT $1;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [limit]);
  return res.rows;
}

/**
 * List members with search, status filter, and pagination
 * @param {Object} [options] - { search, status, page, limit }
 * @param {import('pg').PoolClient} [client]
 */
// "Personal training" = the member has an active or paused personal-trainer assignment; otherwise "general training".
const HAS_PT = `EXISTS (SELECT 1 FROM personal_trainer_assignments pa WHERE pa.member_id = members.id AND pa.status IN ('active', 'paused'))`;

export async function listMembers({ search, status, page = 1, limit = 10, training } = {}, client) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (status && status !== 'all') {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }

  if (search && search.trim()) {
    conditions.push(`(full_name ILIKE $${paramIdx} OR member_code ILIKE $${paramIdx} OR phone ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`);
    params.push(`%${search.trim()}%`);
    paramIdx++;
  }

  // Personal / general split for the current search + status (before the training filter itself)
  const baseWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const executor = client || { query };
  const splitRes = await executor.query(
    `SELECT COUNT(*) FILTER (WHERE ${HAS_PT})::int AS personal, COUNT(*) FILTER (WHERE NOT ${HAS_PT})::int AS general FROM members ${baseWhere};`, params);
  const trainingCounts = splitRes.rows[0] || { personal: 0, general: 0 };

  if (training === 'personal') conditions.push(HAS_PT);
  else if (training === 'general') conditions.push(`NOT ${HAS_PT}`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*) AS total FROM members ${whereClause};`;
  const countRes = await executor.query(countSql, params);
  const total = parseInt(countRes.rows[0]?.total || 0, 10);

  const offset = (page - 1) * limit;
  const listSql = `
    SELECT id, member_code, full_name, phone, email, plan_id, plan_name, status,
           preferred_language, emergency_contact_name, emergency_contact_phone, notes,
           date_of_birth, fee_amount, fee_paid, fee_due, fee_due_date, payment_method, payment_status, created_at, gender,
           CASE WHEN ${HAS_PT} THEN 'personal' ELSE 'general' END AS training_type,
           (SELECT t.full_name FROM personal_trainer_assignments pa JOIN trainers t ON t.id = pa.trainer_id
             WHERE pa.member_id = members.id AND pa.status IN ('active', 'paused')
             ORDER BY (pa.status = 'active') DESC, pa.start_date DESC NULLS LAST LIMIT 1) AS pt_trainer_name,
           (SELECT pa.status FROM personal_trainer_assignments pa
             WHERE pa.member_id = members.id AND pa.status IN ('active', 'paused')
             ORDER BY (pa.status = 'active') DESC, pa.start_date DESC NULLS LAST LIMIT 1) AS pt_status
    FROM members
    ${whereClause}
    ORDER BY id DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++};
  `;

  const listParams = [...params, limit, offset];
  const listRes = await executor.query(listSql, listParams);

  return {
    members: listRes.rows,
    trainingCounts,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Update member details
 * @param {number} id
 * @param {Object} data
 * @param {import('pg').PoolClient} [client]
 */
export async function updateMember(id, data, client) {
  const {
    fullName,
    phone,
    email,
    planId,
    planName,
    status,
    preferredLanguage,
    emergencyContactName,
    emergencyContactPhone,
    notes,
    dateOfBirth,
    feeAmount,
    feePaid,
    feeDue,
    feeDueDate,
    paymentMethod,
    paymentStatus,
    password,
    username,
  } = data;

  const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;

  const sql = `
    UPDATE members
    SET full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        email = COALESCE($3, email),
        plan_id = COALESCE($4, plan_id),
        plan_name = COALESCE($5, plan_name),
        status = COALESCE($6, status),
        preferred_language = COALESCE($7, preferred_language),
        emergency_contact_name = COALESCE($8, emergency_contact_name),
        emergency_contact_phone = COALESCE($9, emergency_contact_phone),
        notes = COALESCE($10, notes),
        date_of_birth = COALESCE($11, date_of_birth),
        fee_amount = COALESCE($12, fee_amount),
        fee_paid = COALESCE($13, fee_paid),
        fee_due = COALESCE($14, fee_due),
        fee_due_date = COALESCE($15, fee_due_date),
        payment_method = COALESCE($16, payment_method),
        payment_status = COALESCE($17, payment_status),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $18
    RETURNING id, member_code, full_name, phone, email, plan_id, plan_name, status, preferred_language,
              date_of_birth, fee_amount, fee_paid, fee_due, fee_due_date, payment_method, payment_status, updated_at;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, [
    fullName,
    phone,
    cleanEmail,
    planId,
    planName,
    status,
    preferredLanguage,
    emergencyContactName,
    emergencyContactPhone,
    notes,
    dateOfBirth,
    feeAmount,
    feePaid,
    feeDue,
    feeDueDate,
    paymentMethod,
    paymentStatus,
    id,
  ]);
  const updated = res.rows[0] || null;

  if (updated) {
    const targetEmail = cleanEmail || (updated.email || '').trim().toLowerCase();

    // Check if password update / credentials provisioning is requested
    if (password && password.trim()) {
      const passHash = bcrypt.hashSync(password.trim(), 10);
      try {
        // Find existing linked user by member_id or targetEmail
        const existingUser = await executor.query(
          `SELECT id, username, email, role, member_id FROM users
            WHERE member_id = $1 OR (LOWER(email) = LOWER($2) AND $2 <> '')
            ORDER BY (member_id IS NOT DISTINCT FROM $1) DESC LIMIT 1;`,
          [updated.id, targetEmail || '']
        );

        let linkedUid = null;
        let finalUsername = '';
        const found = existingUser.rows[0];
        const isOwnLogin = found && (found.member_id === updated.id || (found.role === 'member' && found.member_id === null));

        if (found && !isOwnLogin) {
          // Email belongs to a staff login or another member's login: never convert / re-password it.
          updated.user_account_note = 'This email is already used by another login, so the password was not set. Use a different email for this member.';
        } else if (found) {
          linkedUid = existingUser.rows[0].id;
          finalUsername = existingUser.rows[0].username;
          await executor.query(
            `UPDATE users 
             SET password_hash = $1,
                 email = COALESCE($2, email),
                 phone = COALESCE($3, phone),
                 full_name = COALESCE($4, full_name),
                 member_id = $5,
                 role = 'member',
                 role_id = COALESCE((SELECT id FROM roles WHERE role_code = 'member'), role_id),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $6;`,
            [passHash, targetEmail || null, phone || null, fullName || updated.full_name || null, updated.id, linkedUid]
          );
        } else if (targetEmail) {
          let baseUser = (username || targetEmail.split('@')[0] || ('mem_' + (updated.member_code || '').toLowerCase())).toLowerCase().replace(/[^a-z0-9_]/g, '');
          if (baseUser.length < 3) baseUser = 'mem_' + baseUser;
          let candidateUser = baseUser;
          let attempt = 0;
          while (attempt < 5) {
            const check = await executor.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1);', [candidateUser]);
            if (check.rowCount === 0) break;
            attempt++;
            candidateUser = `${baseUser}_${Math.floor(100 + Math.random() * 900)}`;
          }
          finalUsername = candidateUser;

          const insUser = await executor.query(
            `INSERT INTO users (username, email, password_hash, full_name, role, role_id, phone, is_active, member_id)
             VALUES ($1, $2, $3, $4, 'member', (SELECT id FROM roles WHERE role_code = 'member'), $5, TRUE, $6)
             RETURNING id, username;`,
            [finalUsername, targetEmail, passHash, fullName || updated.full_name, phone || updated.phone || null, updated.id]
          );
          if (insUser.rowCount > 0) {
            linkedUid = insUser.rows[0].id;
          }
        }

        if (linkedUid) {
          updated.user_account = {
            username: finalUsername,
            email: targetEmail,
            password: password.trim(),
            role: 'member',
            updated: true,
            loginUrl: '/member-auth.html',
          };
        }
      } catch (authErr) {
        console.warn('[MemberRepo] Could not update user credentials for member:', authErr.message);
      }
    }
  }

  return updated;
}

/**
 * Delete a member
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function deleteMember(id, client) {
  // "Delete" = ARCHIVE, preserving history (same rule as trainer assignments): a hard delete
  // cascaded into ~30 tables (check-ins, memberships, payments, workout/diet/PT records…).
  // The member becomes inactive, their portal login is disabled, and active/paused trainer
  // assignments are ended so trainers lose access immediately. Nothing is removed.
  const executor = client || { query };
  const res = await executor.query(
    `WITH m AS (
       UPDATE members SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id
     ), u AS (
       UPDATE users SET is_active = FALSE WHERE member_id = $1 AND role = 'member' AND EXISTS (SELECT 1 FROM m) RETURNING id
     ), a AS (
       UPDATE personal_trainer_assignments
          SET status = 'cancelled', end_date = LEAST(end_date, CURRENT_DATE), updated_at = CURRENT_TIMESTAMP
        WHERE member_id = $1 AND status IN ('active', 'paused') AND EXISTS (SELECT 1 FROM m) RETURNING id
     )
     SELECT (SELECT id FROM m) AS id, (SELECT COUNT(*) FROM u)::int AS logins_disabled, (SELECT COUNT(*) FROM a)::int AS assignments_ended;`,
    [id]
  );
  return res.rows[0]?.id ? res.rows[0] : null;
}

/**
 * Update enquiry status and notes
 * @param {number} id
 * @param {Object} data - { status, notes, assignedTrainerId }
 * @param {import('pg').PoolClient} [client]
 */
export async function updateEnquiry(id, data, client) {
  const { status, notes, assignedTrainerId, customizationType } = data;

  const sql = `
    UPDATE member_enquiries
    SET status = COALESCE($1, status),
        notes = COALESCE($2, notes),
        assigned_trainer_id = COALESCE($3, assigned_trainer_id),
        customization_type = COALESCE($4, customization_type),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $5
    RETURNING id, full_name, phone, email, plan_name, preferred_timing, notes, status, assigned_trainer_id, customization_type, updated_at;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, [status, notes, assignedTrainerId, customizationType, id]);
  return res.rows[0] || null;
}

/**
 * Delete an enquiry lead by ID
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function deleteEnquiry(id, client) {
  const executor = client || { query };
  const res = await executor.query('DELETE FROM member_enquiries WHERE id = $1 RETURNING id;', [id]);
  return res.rows[0] || null;
}

/**
 * Record a fee payment for a member
 * @param {number} memberId
 * @param {Object} paymentData - { amountPaid, paymentMethod, notes }
 * @param {import('pg').PoolClient} [client]
 */
export async function recordFeePayment(memberId, paymentData, client) {
  const { amountPaid, paymentMethod = 'UPI / QR', notes } = paymentData;
  const numPaid = parseFloat(amountPaid) || 0;

  const member = await findById(memberId, client);
  if (!member) {
    throw new Error('Member not found');
  }

  const currentPaid = parseFloat(member.fee_paid || 0);
  const currentTotal = parseFloat(member.fee_amount || 0);
  const newPaid = currentPaid + numPaid;
  const newDue = Math.max(0, currentTotal - newPaid);
  const newStatus = newDue <= 0 ? 'paid' : 'partial';

  const sql = `
    UPDATE members
    SET fee_paid = $1,
        fee_due = $2,
        payment_status = $3,
        payment_method = $4,
        notes = CASE 
          WHEN $5::text IS NOT NULL AND $5::text != '' THEN 
            CASE WHEN notes IS NULL OR notes = '' THEN $5 ELSE notes || ' | ' || $5 END
          ELSE notes 
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $6
    RETURNING id, member_code, full_name, phone, email, plan_name, fee_amount, fee_paid, fee_due, fee_due_date, payment_method, payment_status, updated_at;
  `;

  const executor = client || { query };
  const paymentNote = `Recorded fee payment of ₹${numPaid.toLocaleString('en-IN')} via ${paymentMethod}${notes ? ` (${notes})` : ''}`;
  // One statement: update the member's fee balance AND write the payment to the existing ledger
  // (financial_transactions), so it appears on the member's Payments & Invoices pages and in Admin
  // Finance. Amount = what was received; no tax or discount is invented (both recorded as 0).
  const ledgerSql = `
    WITH u AS (${sql.trim().replace(/;$/, '')}),
    t AS (
      INSERT INTO financial_transactions (member_id, transaction_type, amount, tax_amount, discount_amount, net_amount,
                                          payment_method, payment_status, invoice_number, receipt_number, transaction_date, notes)
      SELECT u.id, 'membership', $7::numeric, 0, 0, $7::numeric, LEFT($4::text, 50), 'completed',
             'FEE-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || '-' || u.id,
             'RCT-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || '-' || u.id,
             NOW(), $8
        FROM u
      RETURNING id, invoice_number, receipt_number
    )
    SELECT u.*, t.id AS transaction_id, t.invoice_number, t.receipt_number FROM u CROSS JOIN t;`;
  const res = await executor.query(ledgerSql, [
    newPaid,
    newDue,
    newStatus,
    paymentMethod,
    paymentNote,
    memberId,
    numPaid,
    notes ? `Fee payment recorded at the desk: ${notes}` : 'Fee payment recorded at the desk',
  ]);
  return res.rows[0];
}

/**
 * Delete a member's fee: reset fee amount / paid / due and the due date, and permanently delete the member's
 * fee payments (financial_transactions of type 'membership') from the finance ledger. Refund requests that
 * pointed at those payments are unlinked by their foreign key (ON DELETE SET NULL).
 * A full copy of the old fee values and of every deleted payment is written to auth_audit_logs
 * (event FEE_RECORD_DELETED) so the action stays traceable.
 * @param {import('pg').PoolClient} client  transaction client (caller runs this inside withTransaction)
 */
export async function deleteMemberFees(client, memberId, admin = {}) {
  const m = (await client.query(
    `SELECT id, member_code, full_name, fee_amount, fee_paid, fee_due, fee_due_date, payment_status, payment_method
       FROM members WHERE id = $1 FOR UPDATE`, [memberId])).rows[0];
  if (!m) return null;
  const deleted = (await client.query(
    `DELETE FROM financial_transactions WHERE member_id = $1 AND transaction_type = 'membership'
     RETURNING id, amount, net_amount, payment_method, payment_status, invoice_number, receipt_number, transaction_date, notes`,
    [memberId])).rows;
  await client.query(
    `UPDATE members SET fee_amount = 0, fee_paid = 0, fee_due = 0, fee_due_date = NULL, fee_alert_sent_at = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`, [memberId]);
  await client.query(
    `INSERT INTO auth_audit_logs (user_id, username, event_type, role, details) VALUES ($1, $2, 'FEE_RECORD_DELETED', $3, $4)`,
    [admin.id || null, String(admin.username || 'admin').slice(0, 50), admin.role || null,
      { memberId: m.id, memberCode: m.member_code, memberName: m.full_name,
        previousFee: { amount: m.fee_amount, paid: m.fee_paid, due: m.fee_due, dueDate: m.fee_due_date, status: m.payment_status, method: m.payment_method },
        deletedPayments: deleted }]);
  return { id: m.id, memberCode: m.member_code, fullName: m.full_name, deletedPayments: deleted.length,
    deletedAmount: deleted.reduce((sum, t) => sum + Number(t.net_amount ?? t.amount ?? 0), 0) };
}

/**
 * Get Fees Alert summary and member list
 */
export async function getFeesAlertData({ status = 'all', search = '' } = {}) {
  let conditions = [];
  let params = [];
  let idx = 1;

  if (status === 'overdue') {
    conditions.push(`fee_due > 0 AND (fee_due_date < CURRENT_DATE OR payment_status = 'expired')`);
  } else if (status === 'due_soon') {
    conditions.push(`fee_due > 0 AND fee_due_date >= CURRENT_DATE AND fee_due_date <= CURRENT_DATE + INTERVAL '7 days'`);
  } else if (status === 'pending') {
    conditions.push(`fee_due > 0`);
  } else if (status === 'paid') {
    conditions.push(`fee_due <= 0`);
  }

  if (search && search.trim()) {
    conditions.push(`(
      full_name ILIKE $${idx} OR 
      member_code ILIKE $${idx} OR 
      phone ILIKE $${idx} OR 
      email ILIKE $${idx}
    )`);
    params.push(`%${search.trim()}%`);
    idx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT 
      id, member_code, full_name, phone, email, plan_name, status, gender,
      COALESCE(fee_amount, 0) AS fee_amount,
      COALESCE(fee_paid, 0) AS fee_paid,
      COALESCE(fee_due, 0) AS fee_due,
      fee_due_date,
      payment_method,
      payment_status,
      fee_alert_sent_at,
      CASE 
        WHEN fee_due > 0 AND fee_due_date < CURRENT_DATE THEN (CURRENT_DATE - fee_due_date)
        ELSE 0
      END AS days_overdue,
      CASE 
        WHEN fee_due > 0 AND fee_due_date >= CURRENT_DATE THEN (fee_due_date - CURRENT_DATE)
        ELSE NULL
      END AS days_until_due
    FROM members
    ${whereClause}
    ORDER BY 
      CASE WHEN fee_due > 0 AND fee_due_date < CURRENT_DATE THEN 1 
           WHEN fee_due > 0 THEN 2 
           ELSE 3 END,
      fee_due_date ASC NULLS LAST;
  `;

  const listRes = await query(sql, params);

  // Compute overall summary metrics across ALL members
  const summarySql = `
    SELECT 
      COUNT(*) AS total_members,
      COALESCE(SUM(fee_due), 0) AS total_fee_due,
      COALESCE(SUM(fee_paid), 0) AS total_fee_collected,
      COUNT(CASE WHEN fee_due > 0 AND (fee_due_date < CURRENT_DATE OR payment_status = 'expired') THEN 1 END) AS overdue_count,
      COUNT(CASE WHEN fee_due > 0 AND fee_due_date >= CURRENT_DATE AND fee_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 1 END) AS due_soon_count,
      COUNT(CASE WHEN fee_due <= 0 THEN 1 END) AS paid_count,
      COUNT(CASE WHEN fee_due > 0 THEN 1 END) AS pending_count
    FROM members;
  `;
  const summaryRes = await query(summarySql);
  const s = summaryRes.rows[0];

  return {
    summary: {
      totalMembers: parseInt(s.total_members, 10),
      totalFeeDue: parseFloat(s.total_fee_due),
      totalFeeCollected: parseFloat(s.total_fee_collected),
      overdueCount: parseInt(s.overdue_count, 10),
      dueSoonCount: parseInt(s.due_soon_count, 10),
      paidCount: parseInt(s.paid_count, 10),
      pendingCount: parseInt(s.pending_count, 10),
    },
    members: listRes.rows,
  };
}

/**
 * Record fee alert sent timestamp
 */
export async function recordFeeAlertSent(memberId) {
  const sql = `
    UPDATE members
    SET fee_alert_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id, member_code, full_name, phone, fee_due, fee_due_date, fee_alert_sent_at;
  `;
  const res = await query(sql, [memberId]);
  return res.rows[0] || null;
}

/**
 * Get Birthday Alert summary and members list
 */
export async function getBirthdayAlertData() {
  const sql = `
    SELECT 
      id, member_code, full_name, phone, email, plan_name, date_of_birth,
      birthday_wish_sent_at,
      EXTRACT(YEAR FROM age(CURRENT_DATE, date_of_birth))::int AS current_age,
      EXTRACT(YEAR FROM age(CURRENT_DATE, date_of_birth))::int + 
        CASE WHEN to_char(date_of_birth, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD') THEN 0 ELSE 1 END AS turning_age,
      to_char(date_of_birth, 'Mon DD') AS birthday_formatted,
      to_char(date_of_birth, 'YYYY-MM-DD') AS dob_iso,
      CASE 
        WHEN to_char(date_of_birth, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD') THEN 0
        WHEN to_char(date_of_birth, 'MM-DD') > to_char(CURRENT_DATE, 'MM-DD') THEN
          (to_date(to_char(CURRENT_DATE, 'YYYY') || '-' || to_char(date_of_birth, 'MM-DD'), 'YYYY-MM-DD') - CURRENT_DATE)
        ELSE
          (to_date((EXTRACT(YEAR FROM CURRENT_DATE) + 1)::text || '-' || to_char(date_of_birth, 'MM-DD'), 'YYYY-MM-DD') - CURRENT_DATE)
      END AS days_until_birthday
    FROM members
    ORDER BY 
      CASE WHEN date_of_birth IS NULL THEN 1 ELSE 0 END,
      days_until_birthday ASC;
  `;
  const res = await query(sql);
  const rows = res.rows;

  const today = rows.filter((m) => m.date_of_birth && m.days_until_birthday === 0);
  const thisWeek = rows.filter((m) => m.date_of_birth && m.days_until_birthday >= 0 && m.days_until_birthday <= 7);
  const thisMonth = rows.filter((m) => {
    if (!m.date_of_birth) return false;
    const dob = new Date(m.date_of_birth);
    return dob.getMonth() === new Date().getMonth();
  });

  return {
    summary: {
      todayCount: today.length,
      thisWeekCount: thisWeek.length,
      thisMonthCount: thisMonth.length,
      totalWithDob: rows.filter((m) => m.date_of_birth).length,
      totalMembers: rows.length,
    },
    today,
    thisWeek,
    thisMonth,
    all: rows,
  };
}

/**
 * Record birthday wish sent
 */
export async function recordBirthdayWishSent(memberId) {
  const sql = `
    UPDATE members
    SET birthday_wish_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id, member_code, full_name, phone, date_of_birth, birthday_wish_sent_at;
  `;
  const res = await query(sql, [memberId]);
  return res.rows[0] || null;
}

/**
 * Update member date of birth
 */
export async function updateMemberDob(memberId, dateOfBirth) {
  const sql = `
    UPDATE members
    SET date_of_birth = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING id, member_code, full_name, date_of_birth;
  `;
  const res = await query(sql, [dateOfBirth, memberId]);
  return res.rows[0] || null;
}






// ---------------------------------------------------------------- gender + account freeze (migration 031)

/** Girl / Boy: stored as 'female' / 'male'. null clears it. */
export async function setMemberGender(memberId, gender, client) {
  const executor = client || { query };
  const res = await executor.query('UPDATE members SET gender = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, gender', [gender, memberId]);
  return res.rows[0] || null;
}

/**
 * Freeze (unpaid fees) or unfreeze a member. Uses the existing members.status value 'frozen'.
 * Unfreezing returns the member to 'active'. Each change is written to auth_audit_logs.
 */
export async function setMemberFrozen(memberId, frozen, admin = {}) {
  return withTransaction(async (client) => {
    const cur = (await client.query('SELECT id, full_name, member_code, status, fee_due, fee_due_date FROM members WHERE id = $1 FOR UPDATE', [memberId])).rows[0];
    if (!cur) return null;
    const next = frozen ? 'frozen' : 'active';
    const row = (await client.query('UPDATE members SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, full_name, member_code, status, fee_due, fee_due_date', [next, memberId])).rows[0];
    await client.query(
      `INSERT INTO auth_audit_logs (user_id, username, event_type, role, details) VALUES ($1, $2, $3, $4, $5)`,
      [admin.id || null, admin.username || null, frozen ? 'MEMBER_FROZEN' : 'MEMBER_UNFROZEN', admin.role || null,
        JSON.stringify({ memberId, memberCode: cur.member_code, name: cur.full_name, previousStatus: cur.status, feeDue: cur.fee_due, feeDueDate: cur.fee_due_date, reason: frozen ? 'Unpaid fees' : 'Unfrozen by admin' })]
    );
    return row;
  });
}
