import * as announcementService from '../services/announcement.service.js';
import { broadcast } from '../services/realtime.service.js';

export async function getAnnouncements(req, res, next) {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const priority = req.query.priority;
    const limit = parseInt(req.query.limit, 10) || 50;

    // The public / kiosk list (activeOnly) never shows trainers-only announcements.
    const list = await announcementService.getAnnouncements({ activeOnly, priority, limit, audience: activeOnly ? 'members' : undefined });
    res.json({
      success: true,
      data: list,
    });
  } catch (err) {
    next(err);
  }
}

export async function createAnnouncement(req, res, next) {
  try {
    const { title, message, priority, targetLanguage, startDate, endDate, poll, targetAudience, audience, category } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, error: 'Title and message are required.' });
    }

    const createdBy = req.user ? req.user.id : null;
    const created = await announcementService.createAnnouncement({
      title,
      message,
      priority,
      targetLanguage,
      startDate,
      endDate,
      createdBy,
      poll,
      targetAudience: targetAudience ?? audience,
      category,
    });

    broadcast('ANNOUNCEMENT_CREATED', created, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.status(201).json({
      success: true,
      message: 'Announcement published successfully.',
      data: created,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateAnnouncement(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await announcementService.updateAnnouncement(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Announcement not found.' });
    }

    broadcast('ANNOUNCEMENT_UPDATED', updated, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Announcement updated successfully.',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteAnnouncement(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    await announcementService.deleteAnnouncement(id);
    broadcast('ANNOUNCEMENT_DELETED', { id }, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Announcement deleted successfully.',
      data: { id },
    });
  } catch (err) {
    next(err);
  }
}


/** GET /api/v1/announcements/:id/poll — who voted for what (owner / manager). */
export async function getPollVoters(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Invalid announcement id.' });
    res.json({ success: true, data: await announcementService.getPollVoters(id) });
  } catch (err) {
    next(err);
  }
}
