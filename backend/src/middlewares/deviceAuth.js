import crypto from 'crypto';
import { config } from '../config/env.js';
import { query, isDatabaseConnected } from '../config/database.js';
import { authenticateToken } from './auth.js';

/**
 * Constant-time string comparison to prevent timing attacks on hardware API keys
 */
function safeTimingCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Device-Specific ESP32 Authentication Middleware
 * Requires headers:
 *   - 'x-robot-device-id': UUID of the registered hardware base (e.g. 'ESP32_RECEPTION_01')
 *   - 'x-robot-api-key': Pre-shared hardware secret key
 */
export async function authenticateRobotDevice(req, res, next) {
  const deviceUuid = req.headers['x-robot-device-id'] || req.headers['x-device-id'];
  const apiKey = req.headers['x-robot-api-key'];

  if (!deviceUuid || !apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing required device authentication headers (x-robot-device-id, x-robot-api-key).',
    });
  }

  try {
    if (isDatabaseConnected()) {
      // Query registered robot device from PostgreSQL
      const sql = `
        SELECT id, device_uuid, device_name, status, api_key_hash
        FROM robot_devices
        WHERE device_uuid = $1
        LIMIT 1;
      `;
      const result = await query(sql, [deviceUuid]);

      if (result.rowCount === 0) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Unregistered or invalid robot device UUID.',
        });
      }

      const device = result.rows[0];

      // Validate API key with constant-time equality
      const isValidKey = safeTimingCompare(apiKey, config.robot.apiKey);
      if (!isValidKey) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Invalid robot hardware API key.',
        });
      }

      // Attach authenticated device context to request
      req.robotDevice = device;
      return next();
    }

    // Fallback authentication for local development mock mode (constant-time verification)
    if (
      safeTimingCompare(deviceUuid, config.robot.deviceUuid) &&
      safeTimingCompare(apiKey, config.robot.apiKey)
    ) {
      req.robotDevice = {
        id: 1,
        device_uuid: deviceUuid,
        device_name: 'FitBot Dev Station (Mock)',
        status: 'online',
      };
      return next();
    }

    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Device UUID or API key mismatch.',
    });
  } catch (err) {
    console.error('[DeviceAuth Error]:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Hardware authentication service error.',
    });
  }
}

/**
 * Flexible Authenticator: Accepts either ESP32 device headers or Staff JWT Authorization Bearer
 */
export async function authenticateRobotOrStaff(req, res, next) {
  if (req.headers['x-robot-device-id'] || req.headers['x-device-id']) {
    return authenticateRobotDevice(req, res, next);
  }
  return authenticateToken(req, res, next);
}

