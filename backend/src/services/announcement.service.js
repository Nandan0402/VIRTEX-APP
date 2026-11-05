import { isDatabaseConnected } from '../config/database.js';
import * as announcementRepository from '../repositories/announcement.repository.js';

const mockAnnouncements = [
  {
    id: 1,
    title: 'Diwali Special Fitness Challenge',
    message: 'Join our 30-Day Lean & Strong Transformation Bootcamp starting next Monday. Exciting prizes for top finishers!',
    priority: 'event',
    target_language: 'all',
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    is_active: true,
  },
  {
    id: 2,
    title: 'Steam Room Maintenance Notice',
    message: 'The steam room will undergo routine maintenance this Thursday between 2:00 PM and 4:00 PM.',
    priority: 'maintenance',
    target_language: 'all',
    start_date: '2026-11-03',
    end_date: '2026-11-10',
    is_active: true,
  },
];

export async function getAnnouncements({ activeOnly = false, priority, limit = 50 } = {}) {
  if (isDatabaseConnected()) {
    return await announcementRepository.findAnnouncements({ activeOnly, priority, limit });
  }
  return mockAnnouncements.filter((a) => (!activeOnly || a.is_active));
}

export async function createAnnouncement(data) {
  if (isDatabaseConnected()) {
    return await announcementRepository.createAnnouncement(data);
  }
  const newAnn = {
    id: mockAnnouncements.length + 1,
    ...data,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  mockAnnouncements.unshift(newAnn);
  return newAnn;
}

export async function updateAnnouncement(id, data) {
  if (isDatabaseConnected()) {
    return await announcementRepository.updateAnnouncement(id, data);
  }
  const item = mockAnnouncements.find((a) => a.id === Number(id));
  if (item) Object.assign(item, data);
  return item || null;
}

export async function deleteAnnouncement(id) {
  if (isDatabaseConnected()) {
    return await announcementRepository.deleteAnnouncement(id);
  }
  const idx = mockAnnouncements.findIndex((a) => a.id === Number(id));
  if (idx !== -1) mockAnnouncements.splice(idx, 1);
  return { id };
}

