import * as robotService from '../services/robot.service.js';
import { broadcast } from '../services/realtime.service.js';

/**
 * GET /api/robot/status
 * Public status of the robot base and servo positions
 */
export async function getStatus(req, res, next) {
  try {
    const state = await robotService.getRobotStatus();
    res.json({
      success: true,
      data: state,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/robot/commands
 * Create/queue a servo motor command (gesture or direct angles)
 */
export async function postCommand(req, res, next) {
  try {
    const { commandType = 'GESTURE', gesture, gestureName, angles, headPan, headTilt, armWave } = req.body;

    const targetGesture = gesture || gestureName || null;
    let servoPayload = null;

    if (headPan !== undefined || headTilt !== undefined || armWave !== undefined) {
      servoPayload = { headPan, headTilt, armWave };
    } else if (angles) {
      servoPayload = angles;
    }

    const command = await robotService.queueRobotCommand({
      deviceId: req.body.deviceId || 1,
      commandType: targetGesture ? 'GESTURE' : 'DIRECT_ANGLES',
      gestureName: targetGesture,
      servoPayload,
      triggeredBy: req.user ? `${req.user.role}:${req.user.username}` : (req.body.triggeredBy || 'api_client'),
    });

    broadcast('ROBOT_COMMAND_QUEUED', { command, gesture: targetGesture, servoPayload }, { channel: 'all', triggeredBy: command.triggered_by || 'system' });

    res.status(201).json({
      success: true,
      message: 'Robot command successfully queued for execution.',
      command,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/robot/commands/next
 * Polled by authenticated ESP32 device using device-specific headers
 */
export async function pollNextCommand(req, res, next) {
  try {
    const deviceId = req.robotDevice?.id || 1;
    const command = await robotService.popNextCommand(deviceId);

    if (!command) {
      return res.status(204).end(); // No content - empty queue
    }

    res.json({
      success: true,
      command,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/robot/heartbeat
 * Sent periodically by ESP32 to report telemetry
 */
export async function postHeartbeat(req, res, next) {
  try {
    const telemetry = {
      deviceUuid: req.robotDevice?.device_uuid || req.body.deviceUuid,
      ipAddress: req.body.ipAddress || req.ip,
      servos: req.body.servos,
    };

    const state = await robotService.updateRobotTelemetry(telemetry);
    broadcast('ROBOT_STATUS_CHANGED', state, { channel: 'all' });
    res.json({
      success: true,
      data: state,
    });
  } catch (err) {
    next(err);
  }
}

// Backward-compatible handlers
export async function triggerGesture(req, res, next) {
  return postCommand(req, res, next);
}

export async function setDirectAngles(req, res, next) {
  return postCommand(req, res, next);
}

/**
 * GET /api/v1/robot/logs
 * Retrieve recent robot command and diagnostics logs
 */
export async function getCommandLogs(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const logs = await robotService.getRecentCommands(limit);
    res.json({
      success: true,
      data: logs,
    });
  } catch (err) {
    next(err);
  }
}

