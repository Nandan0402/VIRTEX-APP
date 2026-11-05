import { query } from '../config/database.js';

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
    SELECT id, member_code, full_name, phone, email, plan_name, status, preferred_language, emergency_contact_name, emergency_contact_phone, notes, created_at
    FROM members
    WHERE id = $1
    LIMIT 1;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [id]);
  return res.rows[0] || null;
}

/**
 * Create a new gym member
 * @param {Object} memberData
 * @param {import('pg').PoolClient} [client]
 */
export async function createMember(memberData, client) {
  const {
    memberCode,
    fullName,
    phone,
    email,
    planId,
    planName,
    status = 'active',
    preferredLanguage = 'en-IN',
    emergencyContactName,
    emergencyContactPhone,
    notes,
    createdBy,
  } = memberData;

  const sql = `
    INSERT INTO members (
      member_code, full_name, phone, email, plan_id, plan_name, status,
      preferred_language, emergency_contact_name, emergency_contact_phone, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id, member_code, full_name, phone, email, plan_name, status, preferred_language, created_at;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, [
    memberCode,
    fullName,
    phone,
    email || null,
    planId || null,
    planName || null,
    status,
    preferredLanguage,
    emergencyContactName || null,
    emergencyContactPhone || null,
    notes || null,
    createdBy || null,
  ]);
  return res.rows[0];
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
    VALUES ($1, NOW(), $2, $3, $4)
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
  } = enquiry;

  const sql = `
    INSERT INTO member_enquiries (
      full_name, phone, email, plan_name, preferred_timing, notes, status, assigned_trainer_id
    ) VALUES ($1, $2, $3, $4, $5, $6, 'new', $7)
    RETURNING id, full_name, phone, email, plan_name, preferred_timing, notes, status, assigned_trainer_id, created_at;
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
  ]);
  return res.rows[0];
}

/**
 * Retrieve recent enquiries for the admin console
 * @param {number} limit
 * @param {import('pg').PoolClient} [client]
 */
export async function getRecentEnquiries(limit = 20, client) {
  const sql = `
    SELECT id, full_name, phone, email, plan_name, preferred_timing, notes, status, assigned_trainer_id, created_at
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
export async function listMembers({ search, status, page = 1, limit = 10 } = {}, client) {
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

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*) AS total FROM members ${whereClause};`;
  const executor = client || { query };
  const countRes = await executor.query(countSql, params);
  const total = parseInt(countRes.rows[0]?.total || 0, 10);

  const offset = (page - 1) * limit;
  const listSql = `
    SELECT id, member_code, full_name, phone, email, plan_id, plan_name, status,
           preferred_language, emergency_contact_name, emergency_contact_phone, notes, created_at
    FROM members
    ${whereClause}
    ORDER BY id DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++};
  `;

  const listParams = [...params, limit, offset];
  const listRes = await executor.query(listSql, listParams);

  return {
    members: listRes.rows,
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
  } = data;

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
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $11
    RETURNING id, member_code, full_name, phone, email, plan_id, plan_name, status, preferred_language, updated_at;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, [
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
    id,
  ]);
  return res.rows[0] || null;
}

/**
 * Delete a member
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function deleteMember(id, client) {
  const executor = client || { query };
  await executor.query('DELETE FROM check_ins WHERE member_id = $1;', [id]);
  await executor.query('DELETE FROM memberships WHERE member_id = $1;', [id]);
  const res = await executor.query('DELETE FROM members WHERE id = $1 RETURNING id;', [id]);
  return res.rows[0] || null;
}

/**
 * Update enquiry status and notes
 * @param {number} id
 * @param {Object} data - { status, notes, assignedTrainerId }
 * @param {import('pg').PoolClient} [client]
 */
export async function updateEnquiry(id, data, client) {
  const { status, notes, assignedTrainerId } = data;

  const sql = `
    UPDATE member_enquiries
    SET status = COALESCE($1, status),
        notes = COALESCE($2, notes),
        assigned_trainer_id = COALESCE($3, assigned_trainer_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING id, full_name, phone, email, plan_name, preferred_timing, notes, status, assigned_trainer_id, updated_at;
  `;

  const executor = client || { query };
  const res = await executor.query(sql, [status, notes, assignedTrainerId, id]);
  return res.rows[0] || null;
}


