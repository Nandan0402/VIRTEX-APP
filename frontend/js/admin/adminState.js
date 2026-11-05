/**
 * adminState.js - Centralized Reactive State Store & Validation for Trainer/Admin Dashboard
 * Persists modifications to localStorage with fallback to starter defaults.
 */

const STORAGE_KEY = 'pulsecore_admin_state_v1';

const DEFAULT_STATE = {
  gymProfile: {
    name: 'PulseCore Fitness',
    tagline: 'AI-Powered Smart Fitness Reception',
    phone: '+91 98765 43210',
    email: 'reception@pulsecorefitness.in',
    address: '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
    hours: [
      { days: 'Monday – Friday', open: '06:00', close: '22:00', status: 'Open' },
      { days: 'Saturday', open: '06:00', close: '21:00', status: 'Open' },
      { days: 'Sunday', open: '07:00', close: '13:00', status: 'Half Day' },
    ],
  },
  plans: [
    {
      id: 'plan_silver',
      code: 'SILVER-01',
      name: 'Silver Monthly',
      duration: '1 Month',
      price: 2499,
      badge: 'Starter',
      featured: false,
      active: true,
      perks: [
        'Full Gym Floor & Cardio Access',
        'Locker & Shower Facilities',
        'Free Fitness Assessment',
      ],
    },
    {
      id: 'plan_gold',
      code: 'GOLD-03',
      name: 'Gold Quarterly',
      duration: '3 Months',
      price: 5999,
      badge: 'Popular',
      featured: true,
      active: true,
      perks: [
        'Everything in Silver Monthly',
        '2 Personal Trainer Consultations',
        'Nutrition & Macro Guidance',
        'Steam & Sauna Access',
      ],
    },
    {
      id: 'plan_platinum',
      code: 'PLAT-12',
      name: 'Platinum Annual',
      duration: '12 Months',
      price: 18999,
      badge: 'VIP Elite',
      featured: false,
      active: true,
      perks: [
        'Unlimited 24/7 Access',
        'Monthly 1-on-1 Trainer Session',
        'Full Recovery Lounge Access',
        'Free Locker for 1 Year',
      ],
    },
  ],
  trainers: [
    {
      id: 'trn_1',
      code: 'TRN001',
      name: 'Arjun Reddy',
      specialty: 'CrossFit & Strength Training',
      phone: '9876500001',
      email: 'arjun@pulsecorefitness.in',
      status: 'on_floor', // 'on_floor' | 'in_session' | 'off_duty'
      shift: '06:00 AM - 02:00 PM',
      certifications: 'CSCS, Crossfit L2',
    },
    {
      id: 'trn_2',
      code: 'TRN002',
      name: 'Meera Rao',
      specialty: 'Functional Mobility & Yoga',
      phone: '9876500002',
      email: 'meera@pulsecorefitness.in',
      status: 'in_session',
      shift: '08:00 AM - 04:00 PM',
      certifications: 'RYT-500, Core Rehab',
    },
    {
      id: 'trn_3',
      code: 'TRN003',
      name: 'Karan Verma',
      specialty: 'HIIT & Bodybuilding Coach',
      phone: '9876500003',
      email: 'karan@pulsecorefitness.in',
      status: 'off_duty',
      shift: '02:00 PM - 10:00 PM',
      certifications: 'ACE Certified Personal Trainer',
    },
  ],
  faqs: [
    {
      id: 'faq_1',
      question: 'What are your operating hours?',
      answer: 'We are open Mon-Sat 6:00 AM to 10:00 PM, and Sundays 7:00 AM to 1:00 PM.',
      language: 'en-IN',
      category: 'timings',
      gesture: 'NOD_YES',
    },
    {
      id: 'faq_2',
      question: 'ಜಿಮ್ ತೆರೆಯುವ ಸಮಯ ಎಷ್ಟು?',
      answer: 'ನಮ್ಮ ಜಿಮ್ ಸೋಮವಾರದಿಂದ ಶನಿವಾರ ಬೆಳಿಗ್ಗೆ 6:00 ರಿಂದ ರಾತ್ರಿ 10:00 ರವರೆಗೆ ತೆರೆದಿರುತ್ತದೆ.',
      language: 'kn-IN',
      category: 'timings',
      gesture: 'NOD_YES',
    },
    {
      id: 'faq_3',
      question: 'जिम का समय क्या है?',
      answer: 'हमारा जिम सोमवार से शनिवार सुबह 6:00 से रात 10:00 बजे तक खुला रहता है।',
      language: 'hi-IN',
      category: 'timings',
      gesture: 'NOD_YES',
    },
    {
      id: 'faq_4',
      question: 'Are certified personal trainers available?',
      answer: 'Yes! Our certified trainers are available on the workout floor. You can request a session at reception.',
      language: 'en-IN',
      category: 'trainers',
      gesture: 'LOOK_RIGHT',
    },
  ],
  announcements: [
    {
      id: 'ann_1',
      title: 'Diwali Special Fitness Challenge',
      message: 'Join our 30-Day Lean & Strong Transformation Bootcamp starting next Monday. Exciting prizes for top finishers!',
      priority: 'event', // 'normal' | 'urgent' | 'event' | 'maintenance'
      date: '2026-11-04',
      active: true,
    },
    {
      id: 'ann_2',
      title: 'Steam Room Maintenance Notice',
      message: 'The steam room will undergo routine maintenance this Thursday between 2:00 PM and 4:00 PM.',
      priority: 'maintenance',
      date: '2026-11-03',
      active: true,
    },
  ],
  settings: {
    defaultLanguage: 'en-IN',
    supportedLanguages: ['en-IN', 'kn-IN', 'hi-IN'],
    speechRate: 1.0,
    speechPitch: 1.0,
    telemetryPollingMs: 3000,
  },
  stats: {
    dailyCheckIns: 42,
    totalMembers: 310,
    queriesHandledToday: 128,
    uptimePercentage: 99.4,
    languagesCount: {
      'en-IN': 78,
      'kn-IN': 32,
      'hi-IN': 18,
    },
  },
};

export class AdminStateStore {
  constructor() {
    this.state = this.loadState();
    this.listeners = [];
  }

  loadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_STATE, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('[AdminState] Failed to read localStorage, using default state.', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.notify();
    } catch (e) {
      console.error('[AdminState] Error persisting state:', e);
    }
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

  // --- Trainer Methods ---
  updateTrainerStatus(trainerId, status) {
    const trainer = this.state.trainers.find((t) => t.id === trainerId);
    if (trainer) {
      trainer.status = status;
      this.saveState();
    }
  }

  addTrainer(trainerData) {
    const error = this.validateTrainer(trainerData);
    if (error) throw new Error(error);

    const newTrainer = {
      id: `trn_${Date.now()}`,
      code: `TRN${String(this.state.trainers.length + 1).padStart(3, '0')}`,
      ...trainerData,
    };
    this.state.trainers.push(newTrainer);
    this.saveState();
    return newTrainer;
  }

  deleteTrainer(trainerId) {
    this.state.trainers = this.state.trainers.filter((t) => t.id !== trainerId);
    this.saveState();
  }

  // --- Membership Plan Methods ---
  addPlan(planData) {
    const error = this.validatePlan(planData);
    if (error) throw new Error(error);

    const newPlan = {
      id: `plan_${Date.now()}`,
      code: `PLN-${Date.now().toString().slice(-4)}`,
      active: true,
      featured: false,
      ...planData,
    };
    this.state.plans.push(newPlan);
    this.saveState();
    return newPlan;
  }

  togglePlanStatus(planId) {
    const plan = this.state.plans.find((p) => p.id === planId);
    if (plan) {
      plan.active = !plan.active;
      this.saveState();
    }
  }

  deletePlan(planId) {
    this.state.plans = this.state.plans.filter((p) => p.id !== planId);
    this.saveState();
  }

  // --- FAQ Methods ---
  addFaq(faqData) {
    const error = this.validateFaq(faqData);
    if (error) throw new Error(error);

    const newFaq = {
      id: `faq_${Date.now()}`,
      ...faqData,
    };
    this.state.faqs.push(newFaq);
    this.saveState();
    return newFaq;
  }

  deleteFaq(faqId) {
    this.state.faqs = this.state.faqs.filter((f) => f.id !== faqId);
    this.saveState();
  }

  // --- Announcement Methods ---
  addAnnouncement(annData) {
    const error = this.validateAnnouncement(annData);
    if (error) throw new Error(error);

    const newAnnouncement = {
      id: `ann_${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      active: true,
      ...annData,
    };
    this.state.announcements.unshift(newAnnouncement);
    this.saveState();
    return newAnnouncement;
  }

  deleteAnnouncement(annId) {
    this.state.announcements = this.state.announcements.filter((a) => a.id !== annId);
    this.saveState();
  }

  // --- Profile & Settings Methods ---
  updateGymProfile(profileData) {
    const error = this.validateProfile(profileData);
    if (error) throw new Error(error);

    this.state.gymProfile = { ...this.state.gymProfile, ...profileData };
    this.saveState();
  }

  updateSettings(settingsData) {
    this.state.settings = { ...this.state.settings, ...settingsData };
    this.saveState();
  }

  // --- Validation Helpers ---
  validateTrainer(data) {
    if (!data.name || data.name.trim().length < 2) return 'Trainer name must be at least 2 characters.';
    if (!data.specialty || data.specialty.trim().length < 2) return 'Specialty is required.';
    if (!data.phone || !/^\d{10}$/.test(data.phone.trim())) return 'Phone number must be a valid 10-digit number.';
    return null;
  }

  validatePlan(data) {
    if (!data.name || data.name.trim().length < 2) return 'Plan name is required.';
    if (isNaN(data.price) || Number(data.price) <= 0) return 'Price must be a positive number in INR.';
    if (!data.duration) return 'Duration is required.';
    return null;
  }

  validateFaq(data) {
    if (!data.question || data.question.trim().length < 3) return 'Question is required.';
    if (!data.answer || data.answer.trim().length < 3) return 'Answer is required.';
    return null;
  }

  validateAnnouncement(data) {
    if (!data.title || data.title.trim().length < 3) return 'Announcement title is required.';
    if (!data.message || data.message.trim().length < 5) return 'Announcement message must be at least 5 characters.';
    return null;
  }

  validateProfile(data) {
    if (!data.name || data.name.trim().length < 2) return 'Gym name is required.';
    if (!data.phone) return 'Gym phone is required.';
    if (!data.address) return 'Gym address is required.';
    return null;
  }
}

export const adminState = new AdminStateStore();

