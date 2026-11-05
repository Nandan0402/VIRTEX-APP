import * as announcementService from '../services/announcement.service.js';

export async function getAnnouncements(req, res, next) {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const priority = req.query.priority;
    const limit = parseInt(req.query.limit, 10) || 50;

    const list = await announcementService.getAnnouncements({ activeOnly, priority, limit });
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
    const { title, message, priority, targetLanguage, startDate, endDate } = req.body;
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
    });

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
    res.json({
      success: true,
      message: 'Announcement deleted successfully.',
      data: { id },
    });
  } catch (err) {
    next(err);
  }
}
