import { isDatabaseConnected } from '../config/database.js';
import * as trainerRepository from '../repositories/trainer.repository.js';

const MOCK_TRAINERS = [
  {
    id: 1,
    trainer_code: 'TRN001',
    full_name: 'Arjun Reddy',
    specialty: 'CrossFit & Olympic Weightlifting',
    phone: '9876500001',
    email: 'arjun@virtexfitness.in',
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
    email: 'meera@virtexfitness.in',
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
    email: 'karan@virtexfitness.in',
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

/**
 * Update a trainer's on-floor status
 * @param {number} trainerId
 * @param {string} status - 'on_floor' | 'in_session' | 'off_duty'
 */
export async function updateTrainerStatus(trainerId, status) {
  if (isDatabaseConnected()) {
    return await trainerRepository.updateTrainerStatus(trainerId, status);
  }

  const trainer = MOCK_TRAINERS.find((t) => t.id === Number(trainerId));
  if (trainer) {
    trainer.status = status;
    return trainer;
  }
  return null;
}

export async function createTrainer(data) {
  if (isDatabaseConnected()) {
    return await trainerRepository.createTrainer(data);
  }
  const newTrainer = {
    id: MOCK_TRAINERS.length + 1,
    trainer_code: `TRN00${MOCK_TRAINERS.length + 1}`,
    ...data,
  };
  if (data.password && data.email) {
    newTrainer.user_account = {
      username: data.username || data.email.split('@')[0],
      email: data.email,
      password: data.password,
      role: 'trainer',
      loginUrl: '/trainer-auth.html',
    };
  }
  MOCK_TRAINERS.push(newTrainer);
  return newTrainer;
}

export async function updateTrainer(id, data) {
  if (isDatabaseConnected()) {
    return await trainerRepository.updateTrainer(id, data);
  }
  const trainer = MOCK_TRAINERS.find((t) => t.id === Number(id));
  if (trainer) {
    Object.assign(trainer, data);
    if (data.password) {
      trainer.user_account = {
        email: data.email || trainer.email,
        password: data.password,
        updated: true,
        loginUrl: '/trainer-auth.html',
      };
    }
  }
  return trainer || null;
}

export async function deleteTrainer(id) {
  if (isDatabaseConnected()) {
    return await trainerRepository.deleteTrainer(id);
  }
  const idx = MOCK_TRAINERS.findIndex((t) => t.id === Number(id));
  if (idx !== -1) MOCK_TRAINERS.splice(idx, 1);
  return { id };
}

