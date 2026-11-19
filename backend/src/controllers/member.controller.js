import { query } from '../config/database.js';
import * as memberRepository from '../repositories/member.repository.js';
import * as memberService from '../services/member.service.js';
import * as robotService from '../services/robot.service.js';
import { getWelcomeMessage, getLanguageMetadata } from '../services/voice.service.js';
import { broadcast } from '../services/realtime.service.js';

/**
 * Mask sensitive member PII for public reception display
 */
function maskMemberPII(member) {
  if (!member) return null;
  const masked = { ...member };
  if (masked.phone && typeof masked.phone === 'string' && masked.phone.length >= 4) {
    masked.phone = '******' + masked.phone.slice(-4);
  }
  if (masked.email && typeof masked.email === 'string' && masked.email.includes('@')) {
    const parts = masked.email.split('@');
    masked.email = parts[0].slice(0, 2) + '***@' + parts[1];
  }
  delete masked.password_hash;
  delete masked.emergency_contact_name;
  delete masked.emergency_contact_phone;
  delete masked.notes;
  return masked;
}

/**
 * POST /api/v1/members/check-in
 * Check in gym member by code or phone number
 */
export async function checkIn(req, res, next) {
  try {
    const { identifier, language } = req.body;

    if (!identifier) {
      return res.status(400).json({
        success: false,
        error: 'Identifier (member code or phone) is required.',
      });
    }

    const member = await memberService.findMemberByIdentifier(identifier);

    if (!member) {
      // Robot shakes head no
      robotService.queueGesture('SHAKE_NO');
      return res.status(404).json({
        success: false,
        error: 'Member not found. Please verify your phone number or Member ID.',
      });
    }

    if (member.status !== 'active') {
      robotService.queueGesture('SHAKE_NO');
      return res.status(403).json({
        success: false,
        error: `Membership is currently ${member.status}. Please visit the front desk desk manager.`,
        member: maskMemberPII(member),
      });
    }

    // Record check-in timestamp
    const checkInRecord = await memberService.recordCheckIn(member.id);

    // Robot cheerfully waves
    robotService.queueGesture('GREET_WAVE');

    // Determine appropriate language (user override or member preference)
    const targetLang = language || member.preferred_language || 'en-IN';
    const welcomeSpeech = getWelcomeMessage(targetLang, member.full_name);
    const voiceMeta = getLanguageMetadata(targetLang);

    const maskedMember = maskMemberPII(member);
    broadcast('MEMBER_CHECKED_IN', { checkIn: checkInRecord, member: maskedMember }, { channel: 'all', triggeredBy: 'kiosk' });

    res.json({
      success: true,
      message: 'Check-in successful!',
      data: {
        member: maskedMember,
        checkIn: checkInRecord,
        welcomeSpeech,
        voiceMeta,
        gesture: 'GREET_WAVE',
      },
    });
  } catch (error) {
    if (error.code === '23505' || (error.message && error.message.includes('DUPLICATE_CHECK_IN'))) {
      robotService.queueGesture('NOD_YES');
      return res.status(409).json({
        success: false,
        error: 'You have already checked in today. Please proceed to the workout floor!',
        duplicate: true,
      });
    }
    next(error);
  }
}

/**
 * POST /api/v1/members/enquiry
 * Record membership enquiry submitted from Kiosk or Website
 */
export async function createEnquiry(req, res, next) {
  try {
    const { fullName, name, phone, email, planName, plan, preferredTiming, notes, customizationType, customization } = req.body;
    const resolvedName = fullName || name;

    if (!resolvedName || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Full name and phone number are required for membership enquiry.',
      });
    }

    const enquiry = await memberService.recordEnquiry({
      fullName: resolvedName.trim(),
      phone: String(phone).trim(),
      email: email ? String(email).trim() : null,
      planName: planName || plan || 'General Membership',
      preferredTiming: preferredTiming || null,
      notes: notes || null,
      customizationType: customizationType || customization || 'Standard Gym Access',
    });

    // Robot acknowledges enquiry with an affirmative nod
    robotService.queueGesture('NOD_YES');

    broadcast('ENQUIRY_RECEIVED', enquiry, { channel: 'admin', triggeredBy: 'kiosk' });

    res.status(201).json({
      success: true,
      message: `Thank you, ${resolvedName}! Your enquiry for ${planName || 'membership'} has been recorded. Our team will contact you shortly.`,
      data: enquiry,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/members/enquiries
 * Retrieve recent enquiries (for admin desk)
 */
export async function getEnquiries(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const enquiries = await memberService.getRecentEnquiries(limit);
    res.json({
      success: true,
      data: enquiries,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/members/recent-checkins
 * Get recent check-in list
 */
export async function getRecentCheckIns(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const records = await memberService.getRecentCheckIns(limit);
    res.json({
      success: true,
      data: records,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/members/lookup/:identifier
 * Lookup member profile
 */
export async function lookupMember(req, res, next) {
  try {
    const { identifier } = req.params;
    const member = await memberService.findMemberByIdentifier(identifier);

    if (!member) {
      return res.status(404).json({
        success: false,
        error: 'Member not found.',
      });
    }

    res.json({
      success: true,
      data: maskMemberPII(member),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/members/history/:memberId
 * Retrieve check-in and membership history for a specific member
 * RBAC: Members can only access their own history; Trainers/Managers/Owners can access any
 */
export async function getMemberHistory(req, res, next) {
  try {
    const memberId = Number(req.params.memberId);
    const member = await memberService.getMemberById(memberId);
    if (!member) {
      return res.status(404).json({ success: false, error: 'Member not found.' });
    }

    const checkIns = await memberService.getRecentCheckIns(20);
    const memberCheckIns = checkIns.filter(
      (c) => c.member_id === memberId || c.member_code === member.member_code
    );

    res.json({
      success: true,
      data: {
        member:
          req.user && ['owner', 'manager', 'trainer', 'superadmin'].includes(req.user.role)
            ? member
            : maskMemberPII(member),
        history: memberCheckIns,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/members
 * List members with search, status filter, and pagination
 * RBAC: Owner, Manager, Trainer
 */
export async function listMembers(req, res, next) {
  try {
    const { search, status, training } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    const result = await memberService.listMembers({ search, status, page, limit, training });
    res.json({
      success: true,
      data: result.members,
      pagination: result.pagination,
      trainingCounts: result.trainingCounts || null,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/members
 * Create a new member
 * RBAC: Owner, Manager
 */
// Girl / Boy (migration 031). Accepts 'female'/'male' (also 'girl'/'boy'); '' clears; anything else → 400.
function cleanGender(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const g = { female: 'female', girl: 'female', male: 'male', boy: 'male' }[String(v).toLowerCase()];
  if (!g) throw Object.assign(new Error('Gender must be Girl or Boy.'), { status: 400 });
  return g;
}

export async function createMember(req, res, next) {
  try {
    let gender;
    try { gender = cleanGender(req.body.gender); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    const { fullName, phone, email, planId, planName, status, preferredLanguage, notes, password, username } = req.body;
    if (!fullName || !phone) {
      return res.status(400).json({ success: false, error: 'Full name and 10-digit phone number are required.' });
    }

    // Fees ↔ plans: a chosen fee plan sets the member's fee to the plan price. "Paid now" is recorded in the
    // payment ledger after the member is created; the rest is due on feeDueDate (member sees a countdown).
    let plan = null;
    if (planId) {
      plan = (await query('SELECT id, name, price_inr, audience FROM membership_plans WHERE id = $1', [Number(planId)])).rows[0] || null;
      if (!plan) return res.status(400).json({ success: false, error: 'That fee plan no longer exists. Pick another plan.' });
      if (gender && plan.audience !== 'all' && ((plan.audience === 'girls') !== (gender === 'female'))) {
        return res.status(400).json({ success: false, error: `“${plan.name}” is a plan for ${plan.audience}.` });
      }
    }
    const feeAmount = plan ? Number(plan.price_inr) : 0;
    const paidNow = Math.min(Math.max(Number(req.body.paidNow) || 0, 0), feeAmount);
    let feeDueDate = null;
    if (req.body.feeDueDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.feeDueDate)) || Number.isNaN(Date.parse(req.body.feeDueDate))) {
        return res.status(400).json({ success: false, error: 'Fee due date must be a valid date.' });
      }
      feeDueDate = req.body.feeDueDate;
    }

    const created = await memberService.createMember({
      memberCode: `GYM${Date.now().toString().slice(-4)}`,
      fullName,
      phone,
      email,
      planId: plan ? plan.id : null,
      planName: plan ? plan.name : (planName || 'Standard'),
      ...(plan ? { feeAmount, feePaid: 0, feeDue: feeAmount, feeDueDate, paymentStatus: feeAmount > 0 ? 'pending' : 'paid' } : {}),
      status: status || 'active',
      preferredLanguage: preferredLanguage || 'en-IN',
      notes,
      password,
      username,
      createdBy: req.user ? req.user.id : null,
    });
    if (gender !== undefined && created?.id) {
      const g = await memberRepository.setMemberGender(created.id, gender);
      if (g) created.gender = g.gender;
    }
    if (plan && paidNow > 0 && created?.id) {
      const paid = await memberRepository.recordFeePayment(created.id, { amountPaid: paidNow, paymentMethod: req.body.paymentMethod || 'Cash', notes: 'Paid at registration' });
      if (paid) Object.assign(created, { fee_paid: paid.fee_paid, fee_due: paid.fee_due, payment_status: paid.payment_status });
    }

    res.status(201).json({
      success: true,
      message: 'Member registered successfully.',
      data: created,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/members/:id
 * Update an existing member
 * RBAC: Owner, Manager
 */
export async function updateMember(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    let gender;
    try { gender = cleanGender(req.body.gender); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    const updated = await memberService.updateMember(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Member not found.' });
    }
    if (gender !== undefined) {
      const g = await memberRepository.setMemberGender(id, gender);
      if (g) updated.gender = g.gender;
    }

    broadcast('MEMBER_UPDATED', updated, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Member updated successfully.',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/members/:id/freeze   { frozen: true | false }
 * Freeze a member who has not paid (they cannot open the Member Portal and see "please pay the fees"),
 * or unfreeze them. RBAC: Owner, Manager. Audited.
 */
export async function freezeMember(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Invalid member id.' });
    if (typeof req.body?.frozen !== 'boolean') return res.status(400).json({ success: false, error: 'Send { "frozen": true } or { "frozen": false }.' });
    const row = await memberRepository.setMemberFrozen(id, req.body.frozen, req.user || {});
    if (!row) return res.status(404).json({ success: false, error: 'Member not found.' });
    broadcast('MEMBER_UPDATED', row, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });
    res.json({ success: true, message: req.body.frozen ? 'Account frozen until the fees are paid.' : 'Account unfrozen.', data: row });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/members/:id/pay-fees
 * Settle or record fee payment for a gym member
 * RBAC: Owner, Manager
 */
export async function payMemberFees(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { amountPaid, paymentMethod, notes } = req.body;

    const amt = parseFloat(amountPaid);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ success: false, error: 'A valid payment amount greater than 0 is required.' });
    }

    const updated = await memberService.recordFeePayment(id, {
      amountPaid: amt,
      paymentMethod: paymentMethod || 'UPI / QR',
      notes: notes || '',
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Member not found.' });
    }

    broadcast('MEMBER_FEE_PAID', updated, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: `Fee payment of ₹${amt.toLocaleString('en-IN')} recorded successfully via ${paymentMethod || 'UPI / QR'}.`,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/members/:id/fees
 * Delete the member's fee (amount, paid, due, due date) and permanently delete their fee payments from the
 * finance ledger. The member account itself is kept. Logged to the audit log with a copy of what was removed.
 * RBAC: Owner, Manager
 */
export async function deleteMemberFees(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Invalid member id.' });
    const result = await memberService.deleteMemberFees(id, req.user || {});
    if (!result) return res.status(404).json({ success: false, error: 'Member not found.' });
    broadcast('MEMBER_FEE_DELETED', { id, deletedPayments: result.deletedPayments }, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: `Fee deleted for ${result.fullName}${result.deletedPayments ? ` (${result.deletedPayments} payment record${result.deletedPayments === 1 ? '' : 's'} removed)` : ''}.`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/members/:id
 * Delete a member
 * RBAC: Owner, Manager
 */
export async function deleteMember(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const archived = await memberService.deleteMember(id);
    if (!archived) return res.status(404).json({ success: false, error: 'Member not found.' });
    broadcast('MEMBER_DELETED', { id, archived: true }, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Member archived: marked inactive and portal login disabled. All history is kept.',
      data: { id, archived: true },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/members/enquiries/:id
 * Update enquiry status or notes
 * RBAC: Owner, Manager
 */
export async function updateEnquiry(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await memberService.updateEnquiry(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Enquiry not found.' });
    }

    broadcast('ENQUIRY_UPDATED', updated, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Enquiry status updated successfully.',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/members/enquiries/:id
 * Delete an enquiry lead
 * RBAC: Owner, Manager
 */
export async function deleteEnquiry(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = await memberService.deleteEnquiry(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Enquiry not found.' });
    }

    broadcast('ENQUIRY_DELETED', { id }, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Enquiry deleted successfully.',
      data: { id },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/members/fees-alert
 * Get Fees Alert summary and member dues list
 */
export async function getFeesAlerts(req, res, next) {
  try {
    const { status = 'all', search = '' } = req.query;
    const data = await memberService.getFeesAlertData({ status, search });
    res.json({
      success: true,
      data: data.members,
      summary: data.summary,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/members/:id/send-fee-alert
 * Record fee alert dispatched and return WhatsApp & SMS notification details
 */
export async function sendFeeAlert(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const member = await memberService.getMemberById(id);
    if (!member) {
      return res.status(404).json({ success: false, error: 'Member not found.' });
    }

    const updated = await memberService.recordFeeAlertSent(id);
    const feeDue = parseFloat(member.fee_due || 0);
    const dueDateStr = member.fee_due_date ? new Date(member.fee_due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Immediate';

    const alertMessage = `Dear ${member.full_name}, greeting from Virtex Fitness! This is a gentle reminder that your membership fee of ₹${feeDue.toLocaleString('en-IN')} is due on ${dueDateStr}. Please settle your dues at the front desk or via UPI to ensure uninterrupted gym floor and trainer access. Thank you!`;
    const cleanPhone = (member.phone || '').replace(/[^0-9]/g, '');
    const whatsappUrl = `https://wa.me/${cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone}?text=${encodeURIComponent(alertMessage)}`;

    broadcast('MEMBER_FEE_ALERT_SENT', { id, memberName: member.full_name, phone: member.phone }, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });

    res.json({
      success: true,
      message: `🔔 Fee reminder alert dispatched for ${member.full_name}.`,
      data: {
        member: updated,
        alertMessage,
        whatsappUrl,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/members/birthday-alert
 * Get Birthday Alert summary and birthday celebrants
 */
export async function getBirthdayAlerts(req, res, next) {
  try {
    const data = await memberService.getBirthdayAlertData();
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/members/:id/send-birthday-wish
 * Record birthday wish dispatched and return personalized wish message & WhatsApp link
 */
export async function sendBirthdayWish(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const member = await memberService.getMemberById(id);
    if (!member) {
      return res.status(404).json({ success: false, error: 'Member not found.' });
    }

    const updated = await memberService.recordBirthdayWishSent(id);
    const wishMessage = `🎉 Happy Birthday ${member.full_name}! 🎂 On your special day, the entire team and coaches at Virtex Fitness wish you abundant strength, boundless energy, and continuous PRs this year! Have a fantastic celebration! 💪🏋️`;
    const cleanPhone = (member.phone || '').replace(/[^0-9]/g, '');
    const whatsappUrl = `https://wa.me/${cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone}?text=${encodeURIComponent(wishMessage)}`;

    broadcast('MEMBER_BIRTHDAY_WISHED', { id, memberName: member.full_name, phone: member.phone }, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });

    res.json({
      success: true,
      message: `🎉 Birthday wish sent to ${member.full_name}!`,
      data: {
        member: updated,
        wishMessage,
        whatsappUrl,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/members/:id/dob
 * Update member date of birth
 */
export async function updateDob(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { dateOfBirth } = req.body;
    if (!dateOfBirth) {
      return res.status(400).json({ success: false, error: 'Valid dateOfBirth (YYYY-MM-DD) is required.' });
    }

    const updated = await memberService.updateMemberDob(id, dateOfBirth);
    res.json({
      success: true,
      message: 'Date of birth updated successfully.',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

