/**
 * Virtex Member Portal — session helpers.
 *
 * Reuses the existing login written by member-auth.html (and js/auth.js):
 *   localStorage 'virtex_admin_jwt_token', 'virtex_admin_user_profile', 'virtex_active_member'.
 * No separate member auth system — the server verifies the JWT, the 'member' role and
 * record ownership on every /api/v1/member/* request. These helpers only drive the UI.
 */
export const TOKEN_KEY = 'virtex_admin_jwt_token';
export const PROFILE_KEY = 'virtex_admin_user_profile';
export const ACTIVE_MEMBER_KEY = 'virtex_active_member';
export const PREFS_KEY = 'virtex_member_prefs';

const LOGIN_PAGE = '/member-auth.html';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || localStorage.getItem('pulsecore_admin_jwt_token') || localStorage.getItem('token'); } catch { return null; }
}

export function getStoredProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || localStorage.getItem('pulsecore_admin_user_profile') || 'null'); } catch { return null; }
}

/** Role from the stored login profile (UI hint only — the server is authoritative). */
export function getStoredRole() {
  return String(getStoredProfile()?.role || '').toLowerCase();
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(ACTIVE_MEMBER_KEY);
  } catch { /* ignore */ }
}

/** Send the visitor to sign in, returning to this portal page afterwards. `reason`: 'expired' | undefined. */
export function redirectToLogin(reason) {
  const params = new URLSearchParams({ next: location.pathname });
  if (reason) params.set(reason, '1');
  location.replace(`${LOGIN_PAGE}?${params}`);
}

/** Revokes the token server-side (existing /auth/logout), clears it locally, returns to login. */
export async function signOut() {
  const token = getToken();
  if (token) {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch { /* token may already be invalid */ }
  }
  clearSession();
  location.replace(`${LOGIN_PAGE}?signedOut=1`);
}
