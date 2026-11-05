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
