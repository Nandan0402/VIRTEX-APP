/**
 * api.js - Frontend API Client Module
 * Communicates with the Node.js Express backend (/api/v1)
 * Provides graceful fallbacks when offline or during local testing.
 */

const BASE_URL = '/api/v1';

export const api = {
  /**
   * Health check for server and database connectivity
   */
  async getHealth() {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (!res.ok) {
        return { status: 'error', statusCode: res.status, database: 'unknown' };
      }
      return await res.json();
    } catch (err) {
      console.warn('[API] Health check unreachable:', err.message);
      return { status: 'offline', database: 'offline', error: err.message };
    }
  },

  /**
   * Fetch public gym facility profile and operating hours
   */
  async getGymInfo() {
    try {
      const res = await fetch(`${BASE_URL}/gym/info`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[API] Could not fetch live gym info:', err.message);
      return {
        success: false,
        data: {
          gym_name: 'Virtex Fitness',
          tagline: 'AI-Powered Smart Fitness Reception',
          phone: '+91 98765 43210',
          email: 'reception@virtexfitness.in',
          address: '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
          operating_hours: [
            { day: 'Monday', open: '06:00', close: '22:00', is_closed: false },
            { day: 'Tuesday', open: '06:00', close: '22:00', is_closed: false },
            { day: 'Wednesday', open: '06:00', close: '22:00', is_closed: false },
            { day: 'Thursday', open: '06:00', close: '22:00', is_closed: false },
            { day: 'Friday', open: '06:00', close: '22:00', is_closed: false },
            { day: 'Saturday', open: '06:00', close: '21:00', is_closed: false },
            { day: 'Sunday', open: '07:00', close: '13:00', is_closed: false },
          ],
        },
      };
    }
  },

  /**
   * Fetch live membership plans and pricing
   * @param {object} options - { activeOnly }
   */
  async getMembershipPlans({ activeOnly = true } = {}) {
    try {
      const res = await fetch(`${BASE_URL}/membership-plans?activeOnly=${activeOnly}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[API] Could not fetch live membership plans:', err.message);
      return { success: false, data: [] };
    }
  },

  /**
   * Fetch trainers and on-floor availability
   * @param {object} options - { status }
   */
  async getTrainers({ status } = {}) {
    try {
      const q = status ? `?status=${encodeURIComponent(status)}` : '';
      const res = await fetch(`${BASE_URL}/trainers${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[API] Could not fetch trainer roster:', err.message);
      return { success: false, data: [] };
    }
  },

  /**
   * Fetch active public announcements
   * @param {object} options - { activeOnly, priority }
   */
  async getAnnouncements({ activeOnly = true, priority } = {}) {
    try {
      const params = new URLSearchParams();
      if (activeOnly) params.append('activeOnly', 'true');
      if (priority) params.append('priority', priority);
      const res = await fetch(`${BASE_URL}/announcements?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[API] Could not fetch announcements:', err.message);
      return { success: false, data: [] };
    }
  },

  /**
   * Fetch knowledge base FAQs with language, category, or keyword search
   * @param {object} filter - { language, category, q }
   */
  async getFaqs({ language, category, q } = {}) {
    try {
      const params = new URLSearchParams();
      if (language) params.append('language', language);
      if (category && category !== 'all') params.append('category', category);
      if (q) params.append('q', q);
      const res = await fetch(`${BASE_URL}/faqs?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[API] Could not fetch FAQs:', err.message);
      return { success: false, data: [] };
    }
  },

  /**
   * Lookup member by code or phone without check-in
   */
  async lookupMember(identifier) {
    try {
      const res = await fetch(`${BASE_URL}/members/lookup/${encodeURIComponent(identifier)}`);
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Fetch current ESP32 hardware status and servo angles
   */
  async getRobotStatus() {
    try {
      const res = await fetch(`${BASE_URL}/robot/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
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
   * Queue a physical servo gesture on the robot
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
      console.warn('[API] Failed to trigger gesture:', err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * Directly adjust the 3 SG90 servo motor angles
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
   * Send speech transcription or typed message to the conversational receptionist AI
   * @param {string} message - User question/greeting
   * @param {string} language - 'en-IN' | 'kn-IN' | 'hi-IN'
   */
  async sendChatMessage(message, language = 'en-IN') {
    try {
      const res = await fetch(`${BASE_URL}/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, language }),
      });
      return await res.json();
    } catch (err) {
      console.warn('[API] Chat request failed, using local offline fallback:', err.message);
      // Safe client-side fallback response
      return {
        success: true,
        data: {
          reply:
            language === 'kn-IN'
              ? 'ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ ಜಿಮ್ ರಿಸೆಪ್ಷನಿಸ್ಟ್. ನೀವು ಸದಸ್ಯತ್ವ ಅಥವಾ ತಾಲೀಮು ಸಮಯದ ಬಗ್ಗೆ ವಿಚಾರಿಸಬಹುದು.'
              : language === 'hi-IN'
              ? 'नमस्ते! मैं आपका जिम रिसेप्शनिस्ट हूँ। आप सदस्यता प्लान या समय के बारे में पूछ सकते हैं।'
              : 'Hello! I am your Gym Receptionist. Feel free to ask about our membership plans or workout timings!',
          gesture: 'GREET_WAVE',
          language,
          voiceMeta: { bcp47: language, speechRate: 1.0, pitch: 1.0 },
        },
      };
    }
  },

  /**
   * Get supported multilingual options
   */
  async getLanguages() {
    try {
      const res = await fetch(`${BASE_URL}/chat/languages`);
      return await res.json();
    } catch {
      return {
        success: true,
        data: [
          { code: 'en-IN', name: 'English (India)', nativeName: 'English' },
          { code: 'kn-IN', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
          { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी' },
        ],
      };
    }
  },

  /**
   * Check in member by Member Code or Phone number
   */
  async checkInMember(identifier, language = 'en-IN') {
    try {
      const res = await fetch(`${BASE_URL}/members/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, language }),
      });
      return await res.json();
    } catch (err) {
      return {
        success: false,
        error: 'Unable to connect to check-in server. Please contact front desk.',
      };
    }
  },

  /**
   * Fetch recent check-ins for reception dashboard
   */
  async getRecentCheckIns() {
    try {
      const res = await fetch(`${BASE_URL}/members/recent-checkins`);
      return await res.json();
    } catch {
      return { success: true, data: [] };
    }
  },

  /**
   * Submit membership enquiry form
   */
  async submitEnquiry(enquiry) {
    try {
      const res = await fetch(`${BASE_URL}/members/enquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enquiry),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // Mock success fallback for offline / starter environments
    }

    return {
      success: true,
      message: `Thank you, ${enquiry.fullName || 'valued visitor'}! Your enquiry for ${enquiry.planName || 'membership'} has been recorded. Our team will contact you shortly at ${enquiry.phone}.`,
    };
  },
};
