import { query, isDatabaseConnected } from '../config/database.js';

// In-memory mock data store used when PostgreSQL is offline during development
const mockMembers = [
  {
    id: 1,
    member_code: 'GYM001',
    full_name: 'Rahul Sharma',
    phone: '9876543210',
    email: 'rahul.sharma@example.com',
    plan_name: 'Annual Premium',
    status: 'active',
    preferred_language: 'kn-IN',
  },
  {
    id: 2,
    member_code: 'GYM002',
    full_name: 'Priya Patel',
    phone: '9876543211',
    email: 'priya.patel@example.com',
    plan_name: 'Monthly Gold',
    status: 'active',
    preferred_language: 'hi-IN',
  },
  {
    id: 3,
    member_code: 'GYM003',
    full_name: 'David Miller',
    phone: '9876543212',
    email: 'david.miller@example.com',
    plan_name: 'Quarterly Silver',
    status: 'active',
    preferred_language: 'en-IN',
  },
];

const mockCheckIns = [];
const mockEnquiries = [];

/**
 * Record a membership enquiry / lead from the Kiosk
 * @param {Object} enquiry
 */
export async function recordEnquiry({ fullName, phone, email, planName, preferredTiming, notes }) {
  if (isDatabaseConnected()) {
    const sql = `
      INSERT INTO member_enquiries (
        full_name, phone, email, plan_name, preferred_timing, notes, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'new')
      RETURNING id, full_name, phone, email, plan_name, preferred_timing, notes, status, created_at;
    `;
    const res = await query(sql, [
      fullName,
      phone,
      email || null,
      planName || null,
      preferredTiming || null,
      notes || null,
    ]);
    return res.rows[0];
  }

  const mockRecord = {
    id: mockEnquiries.length + 1,
    full_name: fullName,
    phone,
    email: email || null,
    plan_name: planName || null,
    preferred_timing: preferredTiming || null,
    notes: notes || null,
    status: 'new',
    created_at: new Date().toISOString(),
  };
  mockEnquiries.unshift(mockRecord);
  return mockRecord;
}

/**
 * Retrieve recent enquiries
 * @param {number} limit
 */
export async function getRecentEnquiries(limit = 20) {
  if (isDatabaseConnected()) {
    const sql = `
      SELECT id, full_name, phone, email, plan_name, preferred_timing, notes, status, created_at
      FROM member_enquiries
      ORDER BY created_at DESC
      LIMIT $1;
    `;
    const res = await query(sql, [limit]);
    return res.rows;
  }
  return mockEnquiries.slice(0, limit);
}

/**
 * Find gym member by code or phone number
 * @param {string} identifier - Member code (e.g. GYM001) or 10-digit phone number
 */
export async function findMemberByIdentifier(identifier) {
  const cleanId = String(identifier).trim();

  if (isDatabaseConnected()) {
    const sql = `
      SELECT id, member_code, full_name, phone, email, plan_name, status, preferred_language, created_at
      FROM members
      WHERE member_code = $1 OR phone = $1
      LIMIT 1;
    `;
    const res = await query(sql, [cleanId]);
    return res.rows[0] || null;
  }

  // Fallback to mock data
  const member = mockMembers.find(
    (m) => m.member_code.toLowerCase() === cleanId.toLowerCase() || m.phone === cleanId
  );
  return member || null;
}

/**
 * Record a check-in timestamp for a verified member
 * @param {number} memberId
 */
export async function recordCheckIn(memberId) {
  if (isDatabaseConnected()) {
    const sql = `
      INSERT INTO check_ins (member_id, check_in_time)
      VALUES ($1, NOW())
      RETURNING id, member_id, check_in_time;
    `;
    const res = await query(sql, [memberId]);
    return res.rows[0];
  }

  // Fallback mock check-in
  const checkIn = {
    id: mockCheckIns.length + 1,
    member_id: memberId,
    check_in_time: new Date().toISOString(),
  };
  mockCheckIns.unshift(checkIn);
  return checkIn;
}

/**
 * Retrieve recent check-in list
 * @param {number} limit
 */
export async function getRecentCheckIns(limit = 10) {
  if (isDatabaseConnected()) {
    const sql = `
      SELECT c.id, c.check_in_time, m.member_code, m.full_name, m.plan_name, m.preferred_language
      FROM check_ins c
      JOIN members m ON m.id = c.member_id
      ORDER BY c.check_in_time DESC
      LIMIT $1;
    `;
    const res = await query(sql, [limit]);
    return res.rows;
  }

  return mockCheckIns.slice(0, limit).map((c) => {
    const member = mockMembers.find((m) => m.id === c.member_id);
    return {
      ...c,
      member_code: member?.member_code,
      full_name: member?.full_name,
      plan_name: member?.plan_name,
      preferred_language: member?.preferred_language,
    };
  });
}

