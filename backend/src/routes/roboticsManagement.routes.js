/**
 * Virtex Admin - FitBot Robotics & AI Management Routes
 * Endpoints for:
 * 1. Robot Device Registration & Fleet Management
 * 2. Device Health, Battery & Wi-Fi Metrics
 * 3. Sensor Monitoring & Telemetry (Ultrasonic, PIR, Thermal, RFID, Lux)
 * 4. Robot Activity & Command History
 * 5. Hardware Event Logs
 * 6. Device Connection & Fault Alerts
 * 7. Robotics Fleet Analytics
 * 8. Device Maintenance History & Service Records
 * 9. Safety Monitoring & Safeguard Events
 */

import { Router } from 'express';
import * as robotCtrl from '../controllers/roboticsManagement.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(authenticateToken);

// Device Fleet & Registration
router.get('/devices', requireRole('owner', 'manager', 'trainer'), robotCtrl.getDevices);
router.post('/devices', requireRole('owner', 'manager'), robotCtrl.registerDevice);
router.get('/devices/:id', requireRole('owner', 'manager', 'trainer'), robotCtrl.getDeviceById);
router.put('/devices/:id', requireRole('owner', 'manager'), robotCtrl.updateDevice);
router.get('/devices/:id/health', requireRole('owner', 'manager', 'trainer'), robotCtrl.getDeviceHealth);

// Sensor Monitoring & Telemetry
router.get('/telemetry', requireRole('owner', 'manager', 'trainer'), robotCtrl.getSensorTelemetry);
router.post('/telemetry', requireRole('owner', 'manager', 'trainer'), robotCtrl.recordSensorReading);

// Robot Activity & Gesture History
router.get('/activity', requireRole('owner', 'manager', 'trainer'), robotCtrl.getRobotActivityHistory);

// Hardware Event Logs
router.get('/logs', requireRole('owner', 'manager', 'trainer'), robotCtrl.getHardwareEventLogs);

// Device Connection Alerts
router.get('/alerts', requireRole('owner', 'manager', 'trainer'), robotCtrl.getDeviceAlerts);
router.post('/alerts', requireRole('owner', 'manager'), robotCtrl.createDeviceAlert);
router.patch('/alerts/:id/resolve', requireRole('owner', 'manager', 'trainer'), robotCtrl.resolveDeviceAlert);

// Device Maintenance History
router.get('/maintenance', requireRole('owner', 'manager', 'trainer'), robotCtrl.getMaintenanceHistory);
router.post('/maintenance', requireRole('owner', 'manager'), robotCtrl.createMaintenanceRecord);
router.patch('/maintenance/:id/status', requireRole('owner', 'manager'), robotCtrl.updateMaintenanceRecordStatus);

// Safety Monitoring & Collision Safeguards
router.get('/safety', requireRole('owner', 'manager', 'trainer'), robotCtrl.getSafetyIncidents);
router.post('/safety', requireRole('owner', 'manager', 'trainer'), robotCtrl.logSafetyIncident);

// Robotics Fleet Analytics
router.get('/analytics', requireRole('owner', 'manager', 'trainer'), robotCtrl.getRoboticsAnalytics);

export default router;

