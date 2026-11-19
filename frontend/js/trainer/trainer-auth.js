/**
 * Virtex Trainer Portal — session & access helpers.
 *
 * Reuses the existing login session written by trainer-auth.html / admin-auth.html
 * (localStorage 'virtex_admin_jwt_token' + 'virtex_admin_user_profile').
 * There is no separate trainer auth system: the server verifies the JWT and role
 * on every /api/trainer/* request; these helpers only drive the UI.
 */
export const TOKEN_KEY = 'virtex_admin_jwt_token';
export const PROFILE_KEY = 'virtex_admin_user_profile';
export const PREFS_KEY = 'virtex_trainer_prefs';

const LOGIN_PAGE = '/trainer-auth.html';
const SUPERVISOR_ROLES = ['owner', 'superadmin', 'manager'];

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

export const isSupervisor = (role) => SUPERVISOR_ROLES.includes(role);

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
  } catch { /* ignore */ }
}

/** Send the visitor to the trainer sign-in page, returning here afterwards. `extra`: e.g. { wrongRole: 'member' }. */
export function redirectToLogin(extra = {}) {
  const params = new URLSearchParams({ next: location.pathname + location.search, ...extra });
  location.replace(`${LOGIN_PAGE}?${params}`);
}

/** Owners/managers browse a trainer's hub in supervisory mode via ?trainerId= on the page URL. */
export function supervisedTrainerId() {
  const v = new URLSearchParams(location.search).get('trainerId');
  return v && /^\d+$/.test(v) ? v : null;
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
  location.href = LOGIN_PAGE;
}

/**
 * Where to go after a successful sign-in on trainer-auth.html: a safe ?next= portal
 * page, the trainer's saved start page, or the Trainer Portal dashboard.
 */
export function trainerDestination(user) {
  const role = String(user?.role || '').toLowerCase();
  if (isSupervisor(role)) return '/admin?role=owner#tab-overview';
  const next = new URLSearchParams(location.search).get('next') || '';
  if (/^\/trainer-[a-z-]+\.html(\?[\w=&%-]*)?$/.test(next)) return next;
  try {
    const start = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}').startPage || '';
    if (/^trainer-[a-z-]+\.html$/.test(start)) return `/${start}`;
  } catch { /* ignore */ }
  return '/trainer-dashboard.html';
}
