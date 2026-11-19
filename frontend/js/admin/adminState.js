/**
 * adminState.js - Reactive State Store & Validation for Virtex Admin Console
 * Manages active database records, pagination, filters, and role-based permissions.
 */

function getInitialStoredUser() {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('virtex_admin_user_profile');
      if (stored) {
        const u = JSON.parse(stored);
        if (u && typeof u === 'object') {
          let fullName = u.fullName || u.full_name || u.name || u.username;
          if (fullName === 'Manju Owner') fullName = 'Nandan.B';
          return {
            ...u,
            fullName,
          };
        }
      }
    }
  } catch { }
  return {
    id: 29,
    username: 'nandanb449@gmail.com',
    role: 'owner',
    fullName: 'Nandan.B',
    permissions: ['*'],
  };
}

export class AdminStateStore {
  constructor() {
    this.state = {
      user: getInitialStoredUser(),
      stats: {
        dailyCheckIns: 0,
        totalMembers: 0,
        activeMembers: 0,
        onFloorTrainers: 0,
        pendingLeads: 0,
        robotOnline: false,
        uptimePercentage: 99.8,
        languagesCount: {
          'en-IN': 0,
          'kn-IN': 0,
          'hi-IN': 0,
        },
      },
      members: [],
      memberPagination: {
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
      memberFilter: {
        search: '',
        status: 'all',
      },
      enquiries: [],
      enquiryFilter: {
        search: '',
        status: 'all',
      },
      trainers: [],
      trainerFilter: {
        search: '',
        status: 'all',
      },
      plans: [],
      faqs: [],
      faqFilter: {
        search: '',
        language: 'all',
      },
      announcements: [],
      interactions: [],
      robotLogs: [],
      robotStatus: {
        online: false,
        ipAddress: 'Disconnected',
        servos: { headPan: 90, headTilt: 90, armWave: 10 },
        currentGesture: 'IDLE',
      },
      gymProfile: {
        name: 'Virtex Fitness',
        tagline: 'AI-Powered Smart Fitness Reception',
        phone: '+91 98765 43210',
        email: 'reception@virtexfitness.in',
        address: '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
        hours: [
          { days: 'Monday – Friday', open: '06:00', close: '22:00', status: 'Open' },
          { days: 'Saturday', open: '06:00', close: '21:00', status: 'Open' },
          { days: 'Sunday', open: '07:00', close: '13:00', status: 'Half Day' },
        ],
      },
      settings: {
        defaultLanguage: 'en-IN',
        speechRate: 1.0,
        speechPitch: 1.0,
      },
      loading: {},
    };

    this.listeners = [];
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach((fn) => fn(this.state));
  }

  setUser(user) {
    this.state.user = user;
    this.notify();
  }

  setLoading(key, isLoading) {
    this.state.loading[key] = isLoading;
    this.notify();
  }

  // --- Validation Helpers ---

  validateTrainer(data) {
    const name = data.name || data.fullName;
    if (!name || name.trim().length < 2) return 'Trainer name must be at least 2 characters.';
    if (!data.specialty || data.specialty.trim().length < 2) return 'Specialty is required.';
    if (!data.phone || !/^\d{10}$/.test(data.phone.replace(/\D/g, '').slice(-10))) {
      return 'Phone number must contain at least 10 valid digits.';
    }
    return null;
  }

  validateMember(data) {
    if (!data.fullName || data.fullName.trim().length < 2) return 'Member full name is required.';
    if (!data.phone || !/^\d{10}$/.test(data.phone.replace(/\D/g, '').slice(-10))) {
      return 'Valid 10-digit phone number is required.';
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
      return 'Please provide a valid email address.';
    }
    return null;
  }

  validatePlan(data) {
    if (!data.name || data.name.trim().length < 2) return 'Plan name is required.';
    if (isNaN(data.priceInr) || Number(data.priceInr) <= 0) return 'Price must be a positive number in INR.';
    return null;
  }

  validateFaq(data) {
    if (!data.question || data.question.trim().length < 3) return 'Question must be at least 3 characters.';
    if (!data.answer || data.answer.trim().length < 3) return 'Answer must be at least 3 characters.';
    return null;
  }

  validateAnnouncement(data) {
    if (!data.title || data.title.trim().length < 3) return 'Announcement title is required.';
    if (!data.message || data.message.trim().length < 5) return 'Announcement message must be at least 5 characters.';
    return null;
  }

  validateProfile(data) {
    if (!data.gymName || data.gymName.trim().length < 2) return 'Gym name is required.';
    if (!data.phone) return 'Gym phone is required.';
    if (!data.address) return 'Gym address is required.';
    return null;
  }

  // --- Role Permission Checkers ---

  canAccess(permission) {
    const role = this.state.user?.role?.toLowerCase();
    if (!role) return false;
    if (role === 'owner' || role === 'superadmin') return true;

    if (role === 'manager') {
      const allowed = ['members', 'trainers', 'plans', 'faqs', 'announcements', 'enquiries', 'robot'];
      return allowed.includes(permission);
    }

    if (role === 'trainer') {
      const allowed = ['trainers', 'robot', 'members_view'];
      return allowed.includes(permission);
    }

    return false;
  }
}

export const adminState = new AdminStateStore();
