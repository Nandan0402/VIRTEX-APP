import { Router } from 'express';
import * as robotController from '../controllers/robot.controller.js';
import { authenticateRobotDevice } from '../middlewares/deviceAuth.js';
import { validateRobotCommand } from '../middlewares/validator.js';

const router = Router();

// GET /api/robot/status
router.get('/status', robotController.getStatus);

// POST /api/robot/commands
router.post('/commands', validateRobotCommand, robotController.postCommand);

// Authenticated GET /api/robot/commands/next (ESP32 device-specific polling)
router.get('/commands/next', authenticateRobotDevice, robotController.pollNextCommand);

// POST /api/robot/heartbeat (ESP32 telemetry report)
router.post('/heartbeat', authenticateRobotDevice, robotController.postHeartbeat);

// Legacy routes for backward compatibility
router.post('/gesture', validateRobotCommand, robotController.triggerGesture);
router.post('/servos', validateRobotCommand, robotController.setDirectAngles);

export default router;
