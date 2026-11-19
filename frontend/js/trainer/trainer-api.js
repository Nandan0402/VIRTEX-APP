/**
 * Virtex Trainer Portal — API client for /api/v1/trainer/* (+ shared /api/v1/auth/*).
 * All security is enforced server-side; this client only surfaces the result.
 */
import { getToken, clearSession, redirectToLogin, supervisedTrainerId } from './trainer-auth.js';

const BASE = '/api/v1/trainer';
const AUTH_BASE = '/api/v1/auth';
const ROUTINE_BASE = '/api/v1/routine';
const ANNOUNCEMENT_BASE = '/api/v1/announcements';

export class ApiError extends Error {
  constructor(status, message, body = {}) {
    super(message);
    this.status = status;
    this.code = body.code || null;
    this.body = body;
  }

  /** True when the feature needs Trainer Hub DB migrations that are not applied yet. */
  get migrationsPending() {
    return this.status === 503 && this.code === 'TRAINER_HUB_MIGRATIONS_PENDING';
  }
}

async function request(method, path, { query, body, base = BASE } = {}) {
  const token = getToken();
  if (!token) {
    redirectToLogin();
    throw new ApiError(401, 'Not signed in.');
  }
  const params = new URLSearchParams();
  const tid = supervisedTrainerId();
  if (tid && base === BASE) params.set('trainerId', tid);
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
  if (res.status === 401) {
    clearSession();
    redirectToLogin();
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
  patch: (path, body) => request('PATCH', path, { body: body || {} }),
  del: (path) => request('DELETE', path, {}),
  /** Existing shared auth endpoints (/api/v1/auth/*) — same session token. */
  auth: {
    me: () => request('GET', '/me', { base: AUTH_BASE }),
    updateProfile: (body) => request('PUT', '/profile', { body, base: AUTH_BASE }),
  },
  /** Existing gym announcements published by Admin (active only). */
  announcements: (limit = 5) => request('GET', '', { query: { activeOnly: 'true', limit }, base: ANNOUNCEMENT_BASE }),
  /** Existing staff routine tracker (/api/v1/routine/*) — punches for the signed-in user. */
  routine: {
    current: () => request('GET', '/current', { base: ROUTINE_BASE }),
    punchIn: (notes) => request('POST', '/punch-in', { body: { notes }, base: ROUTINE_BASE }),
    startBreak: (reason) => request('POST', '/break-start', { body: { reason }, base: ROUTINE_BASE }),
    endBreak: () => request('POST', '/break-end', { body: {}, base: ROUTINE_BASE }),
    punchOut: (notes) => request('POST', '/punch-out', { body: { notes }, base: ROUTINE_BASE }),
  },
};
