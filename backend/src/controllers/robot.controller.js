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
    const {
      commandType = 'GESTURE',
      gesture,
      gestureName,
      angles,
      headPan,
      headTilt,
      armWave,
      head,
      leftArm,
      rightArm,
    } = req.body;

    const targetGesture = gesture || gestureName || null;
    let servoPayload = req.body.servoPayload || null;

    if (!servoPayload) {
      if (headPan !== undefined || headTilt !== undefined || armWave !== undefined) {
        servoPayload = { headPan, headTilt, armWave };
      } else if (head !== undefined || leftArm !== undefined || rightArm !== undefined) {
        servoPayload = { head, leftArm, rightArm };
      } else if (angles) {
        servoPayload = angles;
      }
    }

    const command = await robotService.queueRobotCommand({
      deviceId: req.body.deviceId || 1,
      commandType: targetGesture ? 'GESTURE' : (commandType || 'DIRECT_ANGLES'),
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
      wifiRssi: req.body.wifiRssi ?? req.body.rssi ?? null,
      batteryLevel: req.body.batteryLevel ?? req.body.battery ?? null,
      batteryVoltage: req.body.batteryVoltage ?? req.body.voltage ?? null,
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

/**
 * POST /api/v1/robot/commands/:id/ack
 * Acknowledge command completion from hardware
 */
export async function acknowledgeCommand(req, res, next) {
  try {
    const commandId = req.params.id;
    const { status = 'executed', executionTimeMs, errorMessage } = req.body;

    const result = await robotService.acknowledgeCommand(commandId, {
      status,
      executionTimeMs: executionTimeMs !== undefined ? Number(executionTimeMs) : null,
      errorMessage: errorMessage || null,
    });

    broadcast('ROBOT_COMMAND_UPDATED', result, { channel: 'all' });

    res.json({
      success: true,
      message: 'Command execution acknowledged.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/robot/errors or /logs
 * Record hardware error or telemetry anomaly from ESP32
 */
export async function postErrorLog(req, res, next) {
  try {
    const deviceId = req.robotDevice?.id || req.body.deviceId || 1;
    const { logLevel = 'INFO', eventType = 'hardware', message, payload } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message string is required for hardware log.',
      });
    }

    const logRecord = await robotService.logHardwareEvent({
      deviceId,
      logLevel,
      eventType,
      message,
      payload,
    });

    if (['ERROR', 'WARN', 'FATAL'].includes(String(logLevel).toUpperCase())) {
      broadcast('ROBOT_ALERT', { logLevel, eventType, message }, { channel: 'admin' });
    }

    res.status(201).json({
      success: true,
      message: 'Hardware log recorded successfully.',
      data: logRecord,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/robot/diagnostics
 * Return comprehensive hardware diagnostic report for Admin Console
 */
export async function getDiagnostics(req, res, next) {
  try {
    const data = await robotService.getDiagnostics();
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/robot/hardware-logs
 * Retrieve raw hardware diagnostic/error logs
 */
export async function getHardwareLogs(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const logs = await robotService.getHardwareLogs(limit);
    res.json({
      success: true,
      count: logs.length,
      data: logs,
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

