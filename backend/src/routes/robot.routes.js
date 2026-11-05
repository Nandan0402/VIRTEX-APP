import { Router } from 'express';
import * as robotController from '../controllers/robot.controller.js';
import { authenticateRobotDevice, authenticateRobotOrStaff } from '../middlewares/deviceAuth.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';
import { validateRobotCommand } from '../middlewares/validator.js';

const router = Router();

// GET /api/robot/status - Public status of robot and current servo positions
router.get('/status', robotController.getStatus);

// GET /api/robot/logs - Command queue history
router.get('/logs', robotController.getCommandLogs);

// GET /api/robot/diagnostics - Comprehensive hardware diagnostics (ESP32 device or Staff)
router.get('/diagnostics', authenticateRobotOrStaff, (req, res, next) => {
  if (req.robotDevice || (req.user && ['owner', 'manager'].includes(req.user.role?.toLowerCase()))) {
    return robotController.getDiagnostics(req, res, next);
  }
  return res.status(403).json({ success: false, error: 'Forbidden: Insufficient permissions for hardware diagnostics.' });
});

// GET /api/robot/hardware-logs - Error logs and hardware events (Owner & Manager only)
router.get('/hardware-logs', authenticateToken, requireRole('owner', 'manager'), robotController.getHardwareLogs);

// POST /api/robot/commands - Queue a servo motor command
router.post('/commands', validateRobotCommand, robotController.postCommand);

// Authenticated GET /api/robot/commands/next (ESP32 device-specific polling)
router.get('/commands/next', authenticateRobotDevice, robotController.pollNextCommand);

// POST /api/robot/commands/:id/ack & /status - Acknowledge execution from hardware or admin
router.post('/commands/:id/ack', authenticateRobotOrStaff, robotController.acknowledgeCommand);
router.post('/commands/:id/status', authenticateRobotOrStaff, robotController.acknowledgeCommand);

// POST /api/robot/heartbeat (ESP32 telemetry report)
router.post('/heartbeat', authenticateRobotDevice, robotController.postHeartbeat);

// POST /api/robot/errors & /logs - Hardware error reporting
router.post('/errors', authenticateRobotOrStaff, robotController.postErrorLog);
router.post('/logs', authenticateRobotOrStaff, robotController.postErrorLog);

// Legacy routes for backward compatibility
router.post('/gesture', validateRobotCommand, robotController.triggerGesture);
router.post('/servos', validateRobotCommand, robotController.setDirectAngles);

export default router;
