/**
 * Virtex Admin - FitBot Robotics & AI Management Controller
 * Handles 11 Core Robotics Management Features:
 * 1. Robot Device Registration
 * 2. Device Health Monitoring
 * 3. Battery Monitoring
 * 4. Wi-Fi Monitoring
 * 5. Sensor Monitoring & Telemetry
 * 6. Robot Activity History (Gestures & Routine Actions)
 * 7. Hardware Event Logs
 * 8. Device Connection & Fault Alerts
 * 9. Robotics Fleet Analytics
 * 10. Device Maintenance History & Servicing
 * 11. Safety Monitoring & Collision Safeguards
 * 
 * SAFETY MANDATE:
 * This controller manages administrative telemetry, registration, diagnostics,
 * and safety records. It never issues unvetted physical hardware commands
 * to live ESP32 actuators without explicit authorization.
 */

import { roboticsManagementRepository } from '../repositories/roboticsManagement.repository.js';

// ==========================================
// 1. DEVICE REGISTRATION & FLEET OVERVIEW
// ==========================================
export async function getDevices(req, res) {
  try {
    const { status, search } = req.query;
    const devices = await roboticsManagementRepository.getDevices({ status, search });
    res.json({ success: true, data: devices });
  } catch (err) {
    console.error('Error fetching robot devices:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve robot devices' });
  }
}

export async function getDeviceById(req, res) {
  try {
    const { id } = req.params;
    const device = await roboticsManagementRepository.getDeviceById(id);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Robot device not found' });
    }
    res.json({ success: true, data: device });
  } catch (err) {
    console.error('Error fetching robot device by id:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve robot device' });
  }
}

export async function registerDevice(req, res) {
  try {
    const { device_uuid, device_name } = req.body;
    if (!device_uuid || !device_name) {
      return res.status(400).json({ success: false, message: 'Device UUID and Device Name are required' });
    }
    const created = await roboticsManagementRepository.registerDevice(req.body);
    res.status(201).json({ success: true, data: created, message: 'Robot device registered successfully' });
  } catch (err) {
    console.error('Error registering robot device:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'A robot device with this UUID already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to register robot device' });
  }
}

export async function updateDevice(req, res) {
  try {
    const { id } = req.params;
    const updated = await roboticsManagementRepository.updateDevice(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Robot device not found' });
    }
    res.json({ success: true, data: updated, message: 'Robot device updated successfully' });
  } catch (err) {
    console.error('Error updating robot device:', err);
    res.status(500).json({ success: false, message: 'Failed to update robot device' });
  }
}

// ==========================================
// 2. DEVICE HEALTH, BATTERY & WI-FI METRICS
// ==========================================
export async function getDeviceHealth(req, res) {
  try {
    const { id } = req.params;
    const health = await roboticsManagementRepository.getDeviceHealthMetrics(id);
    if (!health) {
      return res.status(404).json({ success: false, message: 'Robot device not found' });
    }
    res.json({ success: true, data: health });
  } catch (err) {
    console.error('Error fetching device health metrics:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve device health metrics' });
  }
}

// ==========================================
// 3. SENSOR MONITORING & TELEMETRY
// ==========================================
export async function getSensorTelemetry(req, res) {
  try {
    const { device_id, sensor_type, limit } = req.query;
    const telemetry = await roboticsManagementRepository.getSensorTelemetry({
      device_id: device_id ? parseInt(device_id, 10) : undefined,
      sensor_type,
      limit: limit ? parseInt(limit, 10) : 50
    });
    res.json({ success: true, data: telemetry });
  } catch (err) {
    console.error('Error fetching sensor telemetry:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve sensor telemetry' });
  }
}

export async function recordSensorReading(req, res) {
  try {
    const { device_id, sensor_type, sensor_name, reading_value, unit } = req.body;
    if (!device_id || !sensor_type || !sensor_name || reading_value === undefined || !unit) {
      return res.status(400).json({ 
        success: false, 
        message: 'device_id, sensor_type, sensor_name, reading_value, and unit are required' 
      });
    }
    const reading = await roboticsManagementRepository.recordSensorReading(req.body);
    res.status(201).json({ success: true, data: reading, message: 'Sensor reading recorded successfully' });
  } catch (err) {
    console.error('Error recording sensor reading:', err);
    res.status(500).json({ success: false, message: 'Failed to record sensor reading' });
  }
}

// ==========================================
// 4. ROBOT ACTIVITY & COMMAND HISTORY
// ==========================================
export async function getRobotActivityHistory(req, res) {
  try {
    const { device_id, limit } = req.query;
    const activity = await roboticsManagementRepository.getRobotActivityHistory({
      device_id: device_id ? parseInt(device_id, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 50
    });
    res.json({ success: true, data: activity });
  } catch (err) {
    console.error('Error fetching robot activity history:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve robot activity history' });
  }
}

// ==========================================
// 5. HARDWARE EVENT LOGS
// ==========================================
export async function getHardwareEventLogs(req, res) {
  try {
    const { device_id, log_level, limit } = req.query;
    const logs = await roboticsManagementRepository.getHardwareEventLogs({
      device_id: device_id ? parseInt(device_id, 10) : undefined,
      log_level,
      limit: limit ? parseInt(limit, 10) : 100
    });
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('Error fetching hardware event logs:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve hardware event logs' });
  }
}

// ==========================================
// 6. DEVICE CONNECTION & FAULT ALERTS
// ==========================================
export async function getDeviceAlerts(req, res) {
  try {
    const { device_id, severity, is_resolved } = req.query;
    const alerts = await roboticsManagementRepository.getDeviceAlerts({
      device_id: device_id ? parseInt(device_id, 10) : undefined,
      severity,
      is_resolved
    });
    res.json({ success: true, data: alerts });
  } catch (err) {
    console.error('Error fetching device alerts:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve device alerts' });
  }
}

export async function createDeviceAlert(req, res) {
  try {
    const { device_id, alert_type, message } = req.body;
    if (!device_id || !alert_type || !message) {
      return res.status(400).json({ success: false, message: 'device_id, alert_type, and message are required' });
    }
    const alert = await roboticsManagementRepository.createDeviceAlert(req.body);
    res.status(201).json({ success: true, data: alert, message: 'Device alert triggered successfully' });
  } catch (err) {
    console.error('Error creating device alert:', err);
    res.status(500).json({ success: false, message: 'Failed to create device alert' });
  }
}

export async function resolveDeviceAlert(req, res) {
  try {
    const { id } = req.params;
    const resolved_by = req.user?.username || req.body?.resolved_by || 'Duty Administrator';
    const resolved = await roboticsManagementRepository.resolveDeviceAlert(id, { resolved_by });
    if (!resolved) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }
    res.json({ success: true, data: resolved, message: 'Device alert resolved successfully' });
  } catch (err) {
    console.error('Error resolving device alert:', err);
    res.status(500).json({ success: false, message: 'Failed to resolve device alert' });
  }
}

// ==========================================
// 7. DEVICE MAINTENANCE HISTORY
// ==========================================
export async function getMaintenanceHistory(req, res) {
  try {
    const { device_id } = req.query;
    const history = await roboticsManagementRepository.getMaintenanceHistory({
      device_id: device_id ? parseInt(device_id, 10) : undefined
    });
    res.json({ success: true, data: history });
  } catch (err) {
    console.error('Error fetching maintenance history:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve maintenance history' });
  }
}

export async function createMaintenanceRecord(req, res) {
  try {
    const { device_id, maintenance_type, technician_name } = req.body;
    if (!device_id || !maintenance_type || !technician_name) {
      return res.status(400).json({ 
        success: false, 
        message: 'device_id, maintenance_type, and technician_name are required' 
      });
    }
    const record = await roboticsManagementRepository.createMaintenanceRecord(req.body);
    res.status(201).json({ success: true, data: record, message: 'Maintenance record scheduled successfully' });
  } catch (err) {
    console.error('Error creating maintenance record:', err);
    res.status(500).json({ success: false, message: 'Failed to schedule maintenance' });
  }
}

export async function updateMaintenanceRecordStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, completed_date, work_summary } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }
    const updated = await roboticsManagementRepository.updateMaintenanceRecordStatus(id, {
      status,
      completed_date,
      work_summary
    });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Maintenance record not found' });
    }
    res.json({ success: true, data: updated, message: 'Maintenance record status updated' });
  } catch (err) {
    console.error('Error updating maintenance record status:', err);
    res.status(500).json({ success: false, message: 'Failed to update maintenance record' });
  }
}

// ==========================================
// 8. SAFETY MONITORING & SAFEGUARD EVENTS
// ==========================================
export async function getSafetyIncidents(req, res) {
  try {
    const { device_id, severity, limit } = req.query;
    const incidents = await roboticsManagementRepository.getSafetyIncidents({
      device_id: device_id ? parseInt(device_id, 10) : undefined,
      severity,
      limit: limit ? parseInt(limit, 10) : 50
    });
    res.json({ success: true, data: incidents });
  } catch (err) {
    console.error('Error fetching safety incidents:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve safety incidents' });
  }
}

export async function logSafetyIncident(req, res) {
  try {
    const { device_id, safety_event_type, safety_action_taken } = req.body;
    if (!device_id || !safety_event_type || !safety_action_taken) {
      return res.status(400).json({ 
        success: false, 
        message: 'device_id, safety_event_type, and safety_action_taken are required' 
      });
    }
    const incident = await roboticsManagementRepository.logSafetyIncident(req.body);
    res.status(201).json({ success: true, data: incident, message: 'Safety incident logged successfully' });
  } catch (err) {
    console.error('Error logging safety incident:', err);
    res.status(500).json({ success: false, message: 'Failed to log safety incident' });
  }
}

// ==========================================
// 9. ROBOTICS FLEET ANALYTICS
// ==========================================
export async function getRoboticsAnalytics(req, res) {
  try {
    const analytics = await roboticsManagementRepository.getRoboticsAnalytics();
    res.json({ success: true, data: analytics });
  } catch (err) {
    console.error('Error fetching robotics analytics:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve robotics analytics' });
  }
}

