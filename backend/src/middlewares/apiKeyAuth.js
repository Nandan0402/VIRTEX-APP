import { config } from '../config/env.js';

/**
 * Middleware to authenticate requests coming from the ESP32 robot or internal services
 * Checks 'x-robot-api-key' header against configured ROBOT_API_KEY
 */
export function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-robot-api-key'];

  if (!apiKey || apiKey !== config.robotApiKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing x-robot-api-key header.',
    });
  }

  next();
}

