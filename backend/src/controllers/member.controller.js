import * as memberService from '../services/member.service.js';
import * as robotService from '../services/robot.service.js';
import { getWelcomeMessage, getLanguageMetadata } from '../services/voice.service.js';

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

    res.json({
      success: true,
      message: 'Check-in successful!',
      data: {
        member: maskMemberPII(member),
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
        error: 'You have already checked in recently. Please proceed to the workout floor!',
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
    const { fullName, name, phone, email, planName, plan, preferredTiming, notes } = req.body;
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
    });

    // Robot acknowledges enquiry with an affirmative nod
    robotService.queueGesture('NOD_YES');

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
