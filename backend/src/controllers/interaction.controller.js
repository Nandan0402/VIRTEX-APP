import * as interactionService from '../services/interaction.service.js';

/**
 * POST /api/interactions
 * Records a speech or kiosk conversation log for audit & analytics
 */
export async function createInteraction(req, res, next) {
  try {
    const interaction = await interactionService.logInteraction(req.body);
    res.status(201).json({
      success: true,
      message: 'Interaction logged successfully.',
      data: interaction,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/interactions
 * Retrieve recent speech interactions audit feed
 */
export async function getInteractions(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const records = await interactionService.getRecentInteractions(limit);
    res.json({
      success: true,
      count: records.length,
      data: records,
    });
  } catch (err) {
    next(err);
  }
}

