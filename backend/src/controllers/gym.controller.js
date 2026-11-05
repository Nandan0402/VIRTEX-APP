import * as gymService from '../services/gym.service.js';

/**
 * GET /api/gym/info
 * Returns public gym facility profile and operating hours
 */
export async function getGymInfo(req, res, next) {
  try {
    const profile = await gymService.getGymProfile();
    res.json({
      success: true,
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

