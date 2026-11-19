import { isDatabaseConnected, withTransaction } from '../config/database.js';
import * as memberRepository from '../repositories/member.repository.js';
import * as membershipRepository from '../repositories/membership.repository.js';

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
export async function recordEnquiry({ fullName, phone, email, planName, preferredTiming, notes, assignedTrainerId, customizationType }) {
  if (isDatabaseConnected()) {
    return await memberRepository.createEnquiry({
      fullName,
      phone,
      email,
      planName,
      preferredTiming,
      notes,
      assignedTrainerId,
      customizationType,
    });
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
    return await memberRepository.getRecentEnquiries(limit);
  }
  return mockEnquiries.slice(0, limit);
}

/**
 * List members with search, status filter, and pagination
 * @param {Object} options
 */
export async function listMembers({ search, status, page = 1, limit = 10, training } = {}) {
  if (isDatabaseConnected()) {
    return await memberRepository.listMembers({ search, status, page, limit, training: ['personal', 'general'].includes(training) ? training : undefined });
  }

  let filtered = [...mockMembers];
  if (status && status !== 'all') {
    filtered = filtered.filter((m) => m.status === status);
  }
  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    filtered = filtered.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        m.member_code.toLowerCase().includes(q) ||
        m.phone.includes(q)
    );
  }

  const total = filtered.length;
  const offset = (page - 1) * limit;
  const paged = filtered.slice(offset, offset + limit);

  return {
    members: paged,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function createMember(data) {
  if (isDatabaseConnected()) {
    return await memberRepository.createMember(data);
  }
  const id = mockMembers.length + 1;
  const newMember = {
    id,
    member_code: data.memberCode || `GYM00${id}`,
    full_name: data.fullName,
    phone: data.phone,
    email: data.email,
    plan_name: data.planName || 'Standard',
    status: data.status || 'active',
    preferred_language: data.preferredLanguage || 'en-IN',
  };
  if (data.password) {
    newMember.user_account = {
      username: (data.username || (data.email ? data.email.split('@')[0] : `mem_${id}`)).toLowerCase(),
      email: data.email,
      password: data.password,
      role: 'member',
      loginUrl: '/member-auth.html',
    };
  }
  mockMembers.push(newMember);
  return newMember;
}

export async function updateMember(id, data) {
  if (isDatabaseConnected()) {
    return await memberRepository.updateMember(id, data);
  }
  const member = mockMembers.find((m) => m.id === Number(id));
  if (member) {
    Object.assign(member, data);
    if (data.password) {
      member.user_account = {
        username: (data.username || (member.email ? member.email.split('@')[0] : `mem_${id}`)).toLowerCase(),
        email: member.email,
        password: data.password,
        role: 'member',
        updated: true,
        loginUrl: '/member-auth.html',
      };
    }
  }
  return member || null;
}

export async function deleteMember(id) {
  if (isDatabaseConnected()) {
    return await memberRepository.deleteMember(id);
  }
  const idx = mockMembers.findIndex((m) => m.id === Number(id));
  if (idx !== -1) mockMembers.splice(idx, 1);
  return { id };
}

export async function updateEnquiry(id, data) {
  if (isDatabaseConnected()) {
    return await memberRepository.updateEnquiry(id, data);
  }
  const enquiry = mockEnquiries.find((e) => e.id === Number(id));
  if (enquiry) Object.assign(enquiry, data);
  return enquiry || null;
}

export async function deleteEnquiry(id) {
  if (isDatabaseConnected()) {
    return await memberRepository.deleteEnquiry(id);
  }
  const idx = mockEnquiries.findIndex((e) => e.id === Number(id));
  if (idx !== -1) {
    mockEnquiries.splice(idx, 1);
    return { id };
  }
  return null;
}


/**
 * Find gym member by ID
 * @param {number} id
 */
export async function getMemberById(id) {
  const numericId = Number(id);
  if (isDatabaseConnected()) {
    return await memberRepository.findById(numericId);
  }
  return mockMembers.find((m) => m.id === numericId) || null;
}

/**
 * Find gym member by code or phone number
 * @param {string} identifier - Member code (e.g. GYM001) or 10-digit phone number
 */
export async function findMemberByIdentifier(identifier) {
  const cleanId = String(identifier).trim();

  if (isDatabaseConnected()) {
    return await memberRepository.findByIdentifier(cleanId);
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
    return await memberRepository.recordCheckIn(memberId);
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
    return await memberRepository.getRecentCheckIns(limit);
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

/**
 * Transactional: Register a new member and create their initial membership contract atomically
 * Demonstrates PostgreSQL transaction safety with automatic ROLLBACK on failure
 * @param {Object} data - { memberData, planId, pricePaid, startDate, endDate }
 */
export async function registerMemberWithPlan(data) {
  const { memberData, planId, pricePaid, startDate = new Date(), endDate } = data;

  if (isDatabaseConnected()) {
    return await withTransaction(async (client) => {
      // 1. Resolve membership plan details
      const plan = await membershipRepository.findPlanById(planId, client);
      if (!plan) {
        throw new Error(`Membership plan with ID ${planId} does not exist.`);
      }

      // 2. Create the member record
      const member = await memberRepository.createMember(
        {
          ...memberData,
          planId: plan.id,
          planName: plan.name,
        },
        client
      );

      // Calculate end date based on duration_months if not specified
      const computedEndDate = endDate || new Date(new Date(startDate).setMonth(new Date(startDate).getMonth() + plan.duration_months));

      // 3. Create the active membership contract
      const membership = await membershipRepository.createMembership(
        {
          memberId: member.id,
          planId: plan.id,
          startDate,
          endDate: computedEndDate,
          pricePaid: pricePaid !== undefined ? pricePaid : plan.price_inr,
          paymentStatus: 'paid',
          status: 'active',
          autoRenew: false,
        },
        client
      );

      return {
        member,
        membership,
      };
    });
  }

  // Mock in-memory registration fallback
  const mockId = mockMembers.length + 1;
  const newMember = {
    id: mockId,
    member_code: memberData.memberCode || `GYM00${mockId}`,
    full_name: memberData.fullName,
    phone: memberData.phone,
    email: memberData.email,
    plan_name: 'Custom Mock Plan',
    status: 'active',
    preferred_language: memberData.preferredLanguage || 'en-IN',
  };
  mockMembers.push(newMember);

  return {
    member: newMember,
    membership: {
      id: mockId,
      member_id: mockId,
      plan_id: planId,
      status: 'active',
    },
  };
}

/**
 * Record fee payment for a member
 * @param {number} memberId
 * @param {Object} paymentData - { amountPaid, paymentMethod, notes }
 */
/** Delete a member's fee and its payments (see memberRepository.deleteMemberFees). Database only. */
export async function deleteMemberFees(memberId, admin) {
  if (!isDatabaseConnected()) {
    const e = new Error('Deleting fees needs the database.'); e.status = 503; throw e;
  }
  return withTransaction((client) => memberRepository.deleteMemberFees(client, memberId, admin));
}

export async function recordFeePayment(memberId, paymentData) {
  if (isDatabaseConnected()) {
    return await memberRepository.recordFeePayment(memberId, paymentData);
  }

  // Fallback for mock in-memory
  const member = mockMembers.find((m) => m.id === memberId);
  if (!member) {
    throw new Error('Member not found');
  }
  const amt = parseFloat(paymentData.amountPaid) || 0;
  member.fee_paid = (parseFloat(member.fee_paid) || 0) + amt;
  member.fee_due = Math.max(0, (parseFloat(member.fee_due) || 0) - amt);
  member.payment_status = member.fee_due <= 0 ? 'paid' : 'partial';
  member.payment_method = paymentData.paymentMethod || 'UPI / QR';
  return member;
}

/**
 * Get Fees Alert summary and member list
 */
export async function getFeesAlertData(filter) {
  if (isDatabaseConnected()) {
    return await memberRepository.getFeesAlertData(filter);
  }
  return {
    summary: { totalMembers: 0, totalFeeDue: 0, totalFeeCollected: 0, overdueCount: 0, dueSoonCount: 0, paidCount: 0 },
    members: [],
  };
}

/**
 * Record fee alert sent
 */
export async function recordFeeAlertSent(memberId) {
  if (isDatabaseConnected()) {
    return await memberRepository.recordFeeAlertSent(memberId);
  }
  return { id: memberId, fee_alert_sent_at: new Date() };
}

/**
 * Get Birthday Alert summary and lists
 */
export async function getBirthdayAlertData() {
  if (isDatabaseConnected()) {
    return await memberRepository.getBirthdayAlertData();
  }
  return {
    summary: { todayCount: 0, thisWeekCount: 0, thisMonthCount: 0, totalWithDob: 0, totalMembers: 0 },
    today: [],
    thisWeek: [],
    thisMonth: [],
    all: [],
  };
}

/**
 * Record birthday wish sent
 */
export async function recordBirthdayWishSent(memberId) {
  if (isDatabaseConnected()) {
    return await memberRepository.recordBirthdayWishSent(memberId);
  }
  return { id: memberId, birthday_wish_sent_at: new Date() };
}

/**
 * Update member date of birth
 */
export async function updateMemberDob(memberId, dateOfBirth) {
  if (isDatabaseConnected()) {
    return await memberRepository.updateMemberDob(memberId, dateOfBirth);
  }
  return { id: memberId, date_of_birth: dateOfBirth };
}
