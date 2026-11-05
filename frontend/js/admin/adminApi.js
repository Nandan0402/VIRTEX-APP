/**
 * adminApi.js - Admin HTTP Client Module
 * Connects to live Express API (/api/v1) and prepares for future backend endpoints.
 */

const BASE_URL = '/api/v1';

export const adminApi = {
  /**
   * Health status of backend & PostgreSQL database
   */
  async getHealth() {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      return await res.json();
    } catch (err) {
      return { status: 'offline', database: 'offline', error: err.message };
    }
  },

  /**
   * Fetch live ESP32 status and current SG90 servo angles
   */
  async getRobotStatus() {
    try {
      const res = await fetch(`${BASE_URL}/robot/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  /**
   * Trigger a motor gesture on the physical ESP32 base
   * @param {string} gesture - 'GREET_WAVE' | 'NOD_YES' | 'SHAKE_NO' | 'LOOK_LEFT' | 'LOOK_RIGHT' | 'RESET_IDLE'
   */
  async triggerGesture(gesture) {
    try {
      const res = await fetch(`${BASE_URL}/robot/gesture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gesture }),
      });
      return await res.json();
    } catch (err) {
      console.warn('[AdminAPI] triggerGesture failed:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Set direct angles for the 3 SG90 servos
   */
  async setServos(headPan, headTilt, armWave) {
    try {
      const res = await fetch(`${BASE_URL}/robot/servos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headPan, headTilt, armWave }),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Fetch recent member check-in log
   */
  async getRecentCheckIns() {
    try {
      const res = await fetch(`${BASE_URL}/members/recent-checkins?limit=15`);
      return await res.json();
    } catch {
      return { success: true, data: [] };
    }
  },

  /**
   * Prepared Future Express Admin API Sync Hooks
   * Ready to be connected when authentication & admin database endpoints are exposed
   */
  async syncProfileToServer(profile) {
    console.log('[AdminAPI Prepared Sync] Profile:', profile);
    // Future implementation:
    // return fetch(`${BASE_URL}/admin/profile`, { method: 'PUT', body: JSON.stringify(profile) });
    return { success: true, simulated: true };
  },

  async syncTrainersToServer(trainers) {
    console.log('[AdminAPI Prepared Sync] Trainers:', trainers);
    return { success: true, simulated: true };
  },

  async syncPlansToServer(plans) {
    console.log('[AdminAPI Prepared Sync] Membership Plans:', plans);
    return { success: true, simulated: true };
  },
};

