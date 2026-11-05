import * as trainerService from '../services/trainer.service.js';

/**
 * GET /api/trainers
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

