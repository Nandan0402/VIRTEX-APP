import * as trainerService from '../services/trainer.service.js';

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
    const { name, fullName, specialty, phone, email, bio, certifications, shiftStart, shiftEnd, shift } = req.body;
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
    });

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
    res.json({
      success: true,
      message: 'Trainer deleted successfully.',
      data: { id },
    });
  } catch (err) {
    next(err);
  }
}

