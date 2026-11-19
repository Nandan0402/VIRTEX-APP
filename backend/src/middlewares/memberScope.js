import { normalizeRole } from './auth.js';
import { query } from '../config/database.js';

/**
 * memberScope (use after authenticateToken).
 * Sets req.memberId = the ONLY member whose records this request may touch:
 * the caller's own member profile (JWT memberId, or users.member_id if the token
 * predates the link). Any member id in params/body is ignored by the member API.
 */
export async function memberScope(req, res, next) {
  try {
    if (normalizeRole(req.user?.role) !== 'member') {
      return res.status(403).json({ success: false, error: 'The Member API is available to member accounts only.' });
    }
    // Account status is admin-controlled: a disabled login loses access at once, even with an unexpired token.
    const acct = (await query('SELECT member_id, is_active FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (acct && acct.is_active === false) {
      return res.status(403).json({ success: false, error: 'This member account has been deactivated. Please contact the front desk.' });
    }
    let memberId = Number(req.user.memberId) || null;
    if (!memberId) memberId = acct?.member_id || null;
    if (!memberId) {
      return res.status(403).json({
        success: false,
        error: 'Your account is not linked to a member profile. Please contact the front desk.',
      });
    }
    // Frozen by the admin for unpaid fees: no Member Portal until the admin unfreezes the account.
    const st = (await query('SELECT status FROM members WHERE id = $1', [memberId])).rows[0];
    if (st && st.status === 'frozen') {
      return res.status(403).json({ success: false, code: 'ACCOUNT_FROZEN', error: 'Your account is frozen. Please pay the fees at the front desk to open your account again.' });
    }
    req.memberId = memberId;
    next();
  } catch (err) {
    next(err);
  }
}
