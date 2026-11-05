import { isDatabaseConnected } from '../config/database.js';
import * as gymRepository from '../repositories/gym.repository.js';

const MOCK_GYM_INFO = {
  gym_name: 'PulseCore Fitness',
  tagline: 'AI-Powered Smart Fitness Reception',
  phone: '+91 98765 43210',
  email: 'reception@pulsecorefitness.in',
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
  default_language: 'en-IN',
  supported_languages: ['en-IN', 'kn-IN', 'hi-IN'],
  speech_rate: 1.0,
  speech_pitch: 1.0,
};

/**
 * Fetch gym facility profile & operating hours
 */
export async function getGymProfile() {
  if (isDatabaseConnected()) {
    const profile = await gymRepository.getGymSettings();
    if (profile) {
      return profile;
    }
  }

  // Fallback mock
  return MOCK_GYM_INFO;
}
