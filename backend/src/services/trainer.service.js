import { isDatabaseConnected } from '../config/database.js';
import * as trainerRepository from '../repositories/trainer.repository.js';

const MOCK_TRAINERS = [
  {
    id: 1,
    trainer_code: 'TRN001',
    full_name: 'Arjun Reddy',
    specialty: 'CrossFit & Olympic Weightlifting',
    phone: '9876500001',
    email: 'arjun@pulsecorefitness.in',
    status: 'on_floor',
    shift_hours: '06:00 AM - 02:00 PM',
    certifications: ['CSCS', 'CrossFit L2', 'CPR/AED'],
  },
  {
    id: 2,
    trainer_code: 'TRN002',
    full_name: 'Meera Rao',
    specialty: 'Functional Mobility & Hatha Yoga',
    phone: '9876500002',
    email: 'meera@pulsecorefitness.in',
    status: 'in_session',
    shift_hours: '08:00 AM - 04:00 PM',
    certifications: ['RYT-500', 'Core Rehab Specialist'],
  },
  {
    id: 3,
    trainer_code: 'TRN003',
    full_name: 'Karan Verma',
    specialty: 'Hypertrophy & Physique Coach',
    phone: '9876500003',
    email: 'karan@pulsecorefitness.in',
    status: 'off_duty',
    shift_hours: '02:00 PM - 10:00 PM',
    certifications: ['ACE Personal Trainer', 'ISSN Sports Nutritionist'],
  },
];

/**
 * Fetch trainers with optional floor status filter (e.g. 'on_floor', 'in_session')
 * @param {object} filter - { status }
 */
export async function getTrainers({ status } = {}) {
  if (isDatabaseConnected()) {
    return await trainerRepository.findTrainers({ status });
  }

  // Fallback mock filtering
  return MOCK_TRAINERS.filter((t) => {
    if (status && t.status !== status) return false;
    return true;
  });
}
