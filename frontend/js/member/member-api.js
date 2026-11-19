/**
 * Virtex Member Portal — API client for the existing /api/v1/member/* endpoints
 * (+ shared /api/v1/auth/*). The member id is never sent from the browser: the server
 * resolves it from the signed-in account, so a member can only reach their own records.
 */
import { getToken, clearSession, redirectToLogin } from './member-auth.js';

const BASE = '/api/v1/member';
const AUTH_BASE = '/api/v1/auth';

export class ApiError extends Error {
  constructor(status, message, body = {}) {
    super(message);
    this.status = status;
    this.code = body.code || null;
    this.body = body;
  }

  /** True when the feature needs database migrations that are not applied yet. */
  get migrationsPending() {
    return this.status === 503 && this.code === 'TRAINER_HUB_MIGRATIONS_PENDING';
  }
}

/**
 * The existing auth middleware answers 401 for a missing token and 403 ("…Please sign in
 * again.") for an invalid, expired or revoked token. Both mean the session has ended.
 */
export const isSessionEnded = (status, json = {}) =>
  status === 401 || (status === 403 && /sign in again/i.test(String(json.error || '')));

async function request(method, path, { query, body, base = BASE } = {}) {
  const token = getToken();
  if (!token) {
    redirectToLogin();
    throw new ApiError(401, 'Not signed in.');
  }
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  const qs = params.toString();
  const res = await fetch(`${base}${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch { /* non-JSON */ }
  // Frozen by the admin for unpaid fees: leave the portal and show "please pay the fees" on the sign-in page.
  if (res.status === 403 && json.code === 'ACCOUNT_FROZEN') {
    clearSession();
    redirectToLogin('frozen');
    throw new ApiError(403, json.error || 'Your account is frozen. Please pay the fees.', json);
  }
  if (isSessionEnded(res.status, json)) {
    clearSession();
    redirectToLogin('expired');
    throw new ApiError(401, json.error || 'Session expired.', json);
  }
  if (!res.ok || json.success === false) {
    throw new ApiError(res.status, json.error || json.message || `Request failed (${res.status}).`, json);
  }
  return json;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  del: (path) => request('DELETE', path, {}),
  /** Authenticated file download (e.g. a library book) → Blob. Files are never exposed by public URL. */
  async blob(path) {
    const token = getToken();
    if (!token) { redirectToLogin(); throw new ApiError(401, 'Not signed in.'); }
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) {
      let json = {};
      try { json = await res.json(); } catch { /* not JSON */ }
      if (isSessionEnded(res.status, json)) { clearSession(); redirectToLogin('expired'); }
      throw new ApiError(res.status, json.error || json.message || `Request failed (${res.status}).`, json);
    }
    return res.blob();
  },
  auth: {
    me: () => request('GET', '/me', { base: AUTH_BASE }),
    updateProfile: (body) => request('PUT', '/profile', { body, base: AUTH_BASE }),
  },
};
