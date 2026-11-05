/**
 * adminApi.js - Centralized HTTP Client Module for PulseCore Admin Console
 * Connects directly to PostgreSQL-backed Express REST API endpoints (/api/v1/*).
 * Enforces JWT authentication, RBAC headers, error extraction, and request tracing.
 */

const BASE_URL = '/api/v1';
const TOKEN_KEY = 'pulsecore_admin_jwt_token';
const USER_KEY = 'pulsecore_admin_user_profile';

export const adminApi = {
  // =========================================================================
  // 1. AUTHENTICATION & SESSION MANAGEMENT
  // =========================================================================

  getToken() {
    return localStorage.getItem(TOKEN_KEY) || null;
  },

  setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  },

  getStoredUser() {
    try {
      const data = localStorage.getItem(USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  setStoredUser(user) {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  },

  getHeaders(includeAuth = true) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (includeAuth) {
      const token = this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return headers;
  },

  /**
   * Log in administrative / staff account and save issued JWT
   */
  async login(username, password) {
    try {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || `Login failed with status ${res.status}`);
      }
      this.setToken(body.data.token);
      this.setStoredUser(body.data.user);
      return { success: true, data: body.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Revoke active JWT on server and clear local session
   */
  async logout() {
    try {
      const token = this.getToken();
      if (token) {
        await fetch(`${BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: this.getHeaders(true),
        });
      }
    } catch (err) {
      console.warn('[AdminAPI] Server logout warning:', err);
    } finally {
      this.setToken(null);
      this.setStoredUser(null);
    }
    return { success: true };
  },

  /**
   * Retrieve active user profile and verify token validity
   */
  async getCurrentUser() {
    try {
      const token = this.getToken();
      if (!token) return { success: false, error: 'No token stored' };

      const res = await fetch(`${BASE_URL}/auth/me`, {
        headers: this.getHeaders(true),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || 'Failed to authenticate');
      }
      this.setStoredUser(body.data.user);
      return { success: true, data: body.data.user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // =========================================================================
  // 2. FACILITY PROFILE & SETTINGS
  // =========================================================================

  async getHealth() {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      return await res.json();
    } catch (err) {
      return { status: 'offline', database: 'offline', error: err.message };
    }
  },

  async getDashboardStats() {
    try {
      const res = await fetch(`${BASE_URL}/admin/dashboard`, {
        headers: this.getHeaders(true),
      });
      const body = await res.json();
      return body;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async getGymProfile() {
    try {
      const res = await fetch(`${BASE_URL}/gym/info`);
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async updateGymSettings(settings) {
    try {
      const res = await fetch(`${BASE_URL}/admin/settings`, {
        method: 'PUT',
        headers: this.getHeaders(true),
        body: JSON.stringify(settings),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // =========================================================================
  // 3. MEMBERSHIP PLANS (CRUD)
  // =========================================================================

  async getPlans(includeArchived = true) {
    try {
      const res = await fetch(`${BASE_URL}/membership-plans?all=${includeArchived}`);
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async createPlan(planData) {
    try {
      const res = await fetch(`${BASE_URL}/membership-plans`, {
        method: 'POST',
        headers: this.getHeaders(true),
        body: JSON.stringify(planData),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async updatePlan(id, planData) {
    try {
      const res = await fetch(`${BASE_URL}/membership-plans/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(true),
        body: JSON.stringify(planData),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async togglePlan(id) {
    try {
      const res = await fetch(`${BASE_URL}/membership-plans/${id}/toggle`, {
        method: 'PATCH',
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async deletePlan(id) {
    try {
      const res = await fetch(`${BASE_URL}/membership-plans/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // =========================================================================
  // 4. MEMBERS DIRECTORY (CRUD + Search + Pagination)
  // =========================================================================

  async getMembers({ search = '', status = 'all', page = 1, limit = 10 } = {}) {
    try {
      const params = new URLSearchParams({
        search,
        status,
        page: String(page),
        limit: String(limit),
      });
      const res = await fetch(`${BASE_URL}/members?${params.toString()}`, {
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async createMember(memberData) {
    try {
      const res = await fetch(`${BASE_URL}/members`, {
        method: 'POST',
        headers: this.getHeaders(true),
        body: JSON.stringify(memberData),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async updateMember(id, memberData) {
    try {
      const res = await fetch(`${BASE_URL}/members/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(true),
        body: JSON.stringify(memberData),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async deleteMember(id) {
    try {
      const res = await fetch(`${BASE_URL}/members/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async getMemberHistory(memberId) {
    try {
      const res = await fetch(`${BASE_URL}/members/history/${memberId}`, {
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // =========================================================================
  // 5. TRAINERS & FLOOR AVAILABILITY (CRUD + Status)
  // =========================================================================

  async getTrainers(status) {
    try {
      const q = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
      const res = await fetch(`${BASE_URL}/trainers${q}`);
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async createTrainer(trainerData) {
    try {
      const res = await fetch(`${BASE_URL}/trainers`, {
        method: 'POST',
        headers: this.getHeaders(true),
        body: JSON.stringify(trainerData),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async updateTrainer(id, trainerData) {
    try {
      const res = await fetch(`${BASE_URL}/trainers/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(true),
        body: JSON.stringify(trainerData),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async updateTrainerStatus(trainerId, status) {
    try {
      const res = await fetch(`${BASE_URL}/trainers/${trainerId}/status`, {
        method: 'PATCH',
        headers: this.getHeaders(true),
        body: JSON.stringify({ status }),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async deleteTrainer(id) {
    try {
      const res = await fetch(`${BASE_URL}/trainers/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // =========================================================================
  // 6. ANNOUNCEMENTS / NOTICEBOARD (CRUD)
  // =========================================================================

  async getAnnouncements(activeOnly = false) {
    try {
      const res = await fetch(`${BASE_URL}/announcements?activeOnly=${activeOnly}`);
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async createAnnouncement(data) {
    try {
      const res = await fetch(`${BASE_URL}/announcements`, {
        method: 'POST',
        headers: this.getHeaders(true),
        body: JSON.stringify(data),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async updateAnnouncement(id, data) {
    try {
      const res = await fetch(`${BASE_URL}/announcements/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(true),
        body: JSON.stringify(data),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async deleteAnnouncement(id) {
    try {
      const res = await fetch(`${BASE_URL}/announcements/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // =========================================================================
  // 7. FAQS / KNOWLEDGE BASE (CRUD)
  // =========================================================================

  async getFaqs({ language = 'all', category = '', q = '' } = {}) {
    try {
      const params = new URLSearchParams({ all: 'true' });
      if (language && language !== 'all') params.append('language', language);
      if (category) params.append('category', category);
      if (q) params.append('q', q);

      const res = await fetch(`${BASE_URL}/faqs?${params.toString()}`);
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async createFaq(data) {
    try {
      const res = await fetch(`${BASE_URL}/faqs`, {
        method: 'POST',
        headers: this.getHeaders(true),
        body: JSON.stringify(data),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async updateFaq(id, data) {
    try {
      const res = await fetch(`${BASE_URL}/faqs/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(true),
        body: JSON.stringify(data),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async deleteFaq(id) {
    try {
      const res = await fetch(`${BASE_URL}/faqs/${id}`, {
        method: 'DELETE',
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // =========================================================================
  // 8. ENQUIRIES / KIOSK LEADS
  // =========================================================================

  async getEnquiries(limit = 50) {
    try {
      const res = await fetch(`${BASE_URL}/admin/enquiries?limit=${limit}`, {
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async updateEnquiryStatus(id, { status, notes }) {
    try {
      const res = await fetch(`${BASE_URL}/admin/enquiries/${id}`, {
        method: 'PATCH',
        headers: this.getHeaders(true),
        body: JSON.stringify({ status, notes }),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // =========================================================================
  // 9. INTERACTION LOGS & AUDIT FEED
  // =========================================================================

  async getRecentInteractions(limit = 30) {
    try {
      const res = await fetch(`${BASE_URL}/interactions?limit=${limit}`);
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async getRecentCheckIns(limit = 15) {
    try {
      const res = await fetch(`${BASE_URL}/members/recent-checkins?limit=${limit}`);
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // =========================================================================
  // 10. ROBOT MOTOR CONTROL & HARDWARE DIAGNOSTICS
  // =========================================================================

  async getRobotStatus() {
    try {
      const res = await fetch(`${BASE_URL}/robot/status`);
      return await res.json();
    } catch {
      return {
        success: false,
        data: {
          online: false,
          ipAddress: 'Disconnected',
          servos: { headPan: 90, headTilt: 90, armWave: 10 },
          currentGesture: 'IDLE',
        },
      };
    }
  },

  async triggerGesture(gesture) {
    try {
      const res = await fetch(`${BASE_URL}/robot/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: 'GESTURE',
          gestureName: gesture,
          priority: 1,
          triggeredBy: 'admin_console',
        }),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async setServos(headPan, headTilt, armWave) {
    try {
      const res = await fetch(`${BASE_URL}/robot/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: 'DIRECT_ANGLES',
          servoPayload: { headPan, headTilt, armWave },
          priority: 2,
          triggeredBy: 'admin_console',
        }),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async getRobotLogs(limit = 20) {
    try {
      const res = await fetch(`${BASE_URL}/robot/logs?limit=${limit}`);
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async getRobotDiagnostics() {
    try {
      const res = await fetch(`${BASE_URL}/robot/diagnostics`, {
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async getHardwareLogs(limit = 20) {
    try {
      const res = await fetch(`${BASE_URL}/robot/hardware-logs?limit=${limit}`, {
        headers: this.getHeaders(true),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};
