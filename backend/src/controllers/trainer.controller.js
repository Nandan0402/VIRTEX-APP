import * as trainerService from '../services/trainer.service.js';
import { broadcast } from '../services/realtime.service.js';
import { recordAdminPasswordSet } from '../repositories/passwordRequest.repository.js';

/** Realtime payloads go to every connected screen: never include login credentials. */
function publicTrainer(t) {
  if (!t || typeof t !== 'object') return t;
  const { user_account, user_account_note, ...rest } = t; // eslint-disable-line no-unused-vars
  return rest;
}

/** Record that the admin set this coach's password (resolves any open request). Best effort. */
async function auditAdminPasswordSet(req, trainer) {
  if (!trainer?.user_account || !trainer.user_id) return;
  try { await recordAdminPasswordSet(trainer.user_id, trainer.user_account.username, req.user, trainer.id); }
  catch (e) { console.warn('[Trainer] password-set audit failed:', e.message); }
}

/**
 * GET /api/v1/trainers
 * Returns personal trainers and on-floor availability (?status=on_floor)
 */
export async function getTrainers(req, res, next) {
  try {
    const { status } = req.query;
    const trainers = await trainerService.getTrainers({ status });
    res.json({
      success: true,
      count: trainers.length,
      data: trainers,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/trainers/:id/status
 * Update trainer on-floor availability
 * RBAC: Trainers can update their own status; Managers & Owners can update any trainer
 */
export async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['on_floor', 'in_session', 'off_duty'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Allowed values: 'on_floor', 'in_session', 'off_duty'",
      });
    }

    const updated = await trainerService.updateTrainerStatus(id, status);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Trainer not found.',
      });
    }

    broadcast('TRAINER_STATUS_UPDATED', updated, { channel: 'all', triggeredBy: req.user?.username || 'trainer' });
    res.json({
      success: true,
      message: `Trainer status successfully updated to '${status}'.`,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export async function createTrainer(req, res, next) {
  try {
    const { name, fullName, specialty, phone, email, bio, certifications, shiftStart, shiftEnd, shift, password, username } = req.body;
    const trainerName = fullName || name;
    if (!trainerName || !specialty || !phone) {
      return res.status(400).json({ success: false, error: 'Name, specialty, and phone are required.' });
    }

    let parsedStart = shiftStart || '06:00:00';
    let parsedEnd = shiftEnd || '14:00:00';
    if (shift && typeof shift === 'string' && shift.includes('-')) {
      const parts = shift.split('-').map((s) => s.trim());
      if (parts.length === 2) {
        // e.g. "06:00 AM - 02:00 PM"
        parsedStart = '06:00:00';
        parsedEnd = '14:00:00';
      }
    }

    const created = await trainerService.createTrainer({
      fullName: trainerName,
      specialty,
      phone,
      email,
      bio,
      certifications,
      shiftStart: parsedStart,
      shiftEnd: parsedEnd,
      status: req.body.status || 'on_floor',
      password,
      username,
    });

    await auditAdminPasswordSet(req, created);
    broadcast('TRAINER_CREATED', publicTrainer(created), { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.status(201).json({
      success: true,
      message: 'Trainer created successfully.',
      data: created,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateTrainer(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await trainerService.updateTrainer(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Trainer not found.' });
    }

    await auditAdminPasswordSet(req, updated);
    broadcast('TRAINER_UPDATED', publicTrainer(updated), { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Trainer updated successfully.',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteTrainer(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    await trainerService.deleteTrainer(id);
    broadcast('TRAINER_DELETED', { id }, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Trainer deleted successfully.',
      data: { id },
    });
  } catch (err) {
    next(err);
  }
}

