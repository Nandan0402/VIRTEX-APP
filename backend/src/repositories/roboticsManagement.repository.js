import { pool } from '../config/database.js';
import bcrypt from 'bcryptjs';

export class RoboticsManagementRepository {
  // ==========================================
  // 1. DEVICE REGISTRATION & FLEET OVERVIEW
  // ==========================================
  async getDevices({ status, search } = {}) {
    let query = `
      SELECT 
        d.*,
        (SELECT COUNT(*) FROM robot_device_alerts WHERE device_id = d.id AND is_resolved = false) AS unresolved_alerts_count,
        (SELECT COUNT(*) FROM robot_safety_monitoring WHERE device_id = d.id) AS safety_events_count,
        (SELECT COUNT(*) FROM robot_commands WHERE device_id = d.id) AS total_commands_count,
        CASE 
          WHEN d.last_heartbeat >= CURRENT_TIMESTAMP - INTERVAL '5 minutes' THEN 'online'
          ELSE 'offline'
        END AS live_connection_status
      FROM robot_devices d
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND d.status = $${params.length}`;
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(d.device_name) LIKE $${params.length} OR LOWER(d.device_uuid) LIKE $${params.length} OR LOWER(COALESCE(d.ip_address, '')) LIKE $${params.length})`;
    }

    query += ` ORDER BY d.id ASC`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  async getDeviceById(id) {
    const res = await pool.query(`
      SELECT 
        d.*,
        (SELECT COUNT(*) FROM robot_device_alerts WHERE device_id = d.id AND is_resolved = false) AS unresolved_alerts_count,
        (SELECT COUNT(*) FROM robot_safety_monitoring WHERE device_id = d.id) AS safety_events_count
      FROM robot_devices d
      WHERE d.id = $1
    `, [id]);
    return res.rows[0] || null;
  }

  async registerDevice(data) {
    const {
      device_uuid,
      device_name,
      device_model,
      serial_number,
      mac_address,
      ip_address,
      api_key = 'esp32_device_default_secret_key',
      firmware_version = '1.2.0',
      head_pan_pin = 18,
      head_tilt_pin = 19,
      arm_wave_pin = 21,
      location_zone = 'Main Reception Desk Kiosk',
      is_enabled = true
    } = data;

    const salt = await bcrypt.genSalt(8);
    const apiKeyHash = await bcrypt.hash(api_key, salt);

    const res = await pool.query(`
      INSERT INTO robot_devices (
        device_uuid, device_name, device_model, serial_number,
        mac_address, ip_address, api_key_hash, firmware_version,
        head_pan_pin, head_tilt_pin, arm_wave_pin, location_zone,
        battery_level, battery_voltage, charging_status, wifi_rssi,
        is_enabled, status, last_heartbeat
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        100, 8.40, 'full', -50,
        $13, 'online', CURRENT_TIMESTAMP
      )
      RETURNING *
    `, [
      device_uuid,
      device_name,
      device_model || 'FitBot Receptionist MK-II',
      serial_number || `FB-${Math.floor(1000 + Math.random() * 9000)}`,
      mac_address || '24:6F:28:B1:00:00',
      ip_address || '192.168.1.150',
      apiKeyHash,
      firmware_version,
      head_pan_pin,
      head_tilt_pin,
      arm_wave_pin,
      location_zone,
      is_enabled
    ]);

    return res.rows[0];
  }

  async updateDevice(id, data) {
    const fields = [];
    const params = [id];

    const updatable = [
      'device_name', 'device_model', 'serial_number', 'mac_address',
      'ip_address', 'firmware_version', 'head_pan_pin', 'head_tilt_pin',
      'arm_wave_pin', 'location_zone', 'is_enabled', 'status',
      'battery_level', 'battery_voltage', 'charging_status', 'wifi_rssi'
    ];

    for (const key of updatable) {
      if (data[key] !== undefined) {
        params.push(data[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }

    if (fields.length === 0) return await this.getDeviceById(id);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    const res = await pool.query(`
      UPDATE robot_devices
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING *
    `, params);
    return res.rows[0];
  }

  // ==========================================
  // 2. DEVICE HEALTH, BATTERY & WI-FI METRICS
  // ==========================================
  async getDeviceHealthMetrics(deviceId) {
    const dev = await this.getDeviceById(deviceId);
    if (!dev) return null;

    // Calculate Wi-Fi Signal Quality
    const rssi = dev.wifi_rssi || -60;
    let wifiQuality = 'Good';
    let wifiPercent = 75;
    if (rssi >= -55) { wifiQuality = 'Excellent'; wifiPercent = 95; }
    else if (rssi >= -67) { wifiQuality = 'Good'; wifiPercent = 80; }
    else if (rssi >= -75) { wifiQuality = 'Fair'; wifiPercent = 60; }
    else { wifiQuality = 'Poor (Weak)'; wifiPercent = 35; }

    // Calculate Battery Runtime Estimate
    const battLevel = dev.battery_level || 85;
    const estHoursRemaining = (battLevel * 0.12).toFixed(1); // approx 10-12 hours per 100%

    // Calculate Overall System Health Score (0-100)
    let healthScore = 100;
    if (battLevel < 30) healthScore -= 20;
    if (rssi < -75) healthScore -= 15;
    if (dev.unresolved_alerts_count > 0) healthScore -= (dev.unresolved_alerts_count * 10);
    healthScore = Math.max(20, Math.min(100, healthScore));

    return {
      deviceId: dev.id,
      deviceUuid: dev.device_uuid,
      deviceName: dev.device_name,
      status: dev.status,
      healthScore,
      battery: {
        level: battLevel,
        voltage: parseFloat(dev.battery_voltage || 8.15),
        status: dev.charging_status || 'discharging',
        estHoursRemaining: parseFloat(estHoursRemaining)
      },
      wifi: {
        rssi,
        quality: wifiQuality,
        signalPercent: wifiPercent,
        ipAddress: dev.ip_address,
        macAddress: dev.mac_address
      },
      firmwareVersion: dev.firmware_version,
      locationZone: dev.location_zone,
      lastHeartbeat: dev.last_heartbeat
    };
  }

  // ==========================================
  // 3. SENSOR MONITORING & TELEMETRY
  // ==========================================
  async getSensorTelemetry({ device_id, sensor_type, limit = 50 } = {}) {
    let query = `
      SELECT t.*, d.device_name, d.device_uuid
      FROM robot_sensor_telemetry t
      JOIN robot_devices d ON t.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (device_id) {
      params.push(device_id);
      query += ` AND t.device_id = $${params.length}`;
    }

    if (sensor_type && sensor_type !== 'all') {
      params.push(sensor_type);
      query += ` AND t.sensor_type = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY t.recorded_at DESC LIMIT $${params.length}`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  async recordSensorReading(data) {
    const { device_id, sensor_type, sensor_name, reading_value, unit, threshold_min, threshold_max } = data;
    const val = parseFloat(reading_value);
    let status = 'normal';
    if (threshold_min !== undefined && val < parseFloat(threshold_min)) status = 'warning';
    if (threshold_max !== undefined && val > parseFloat(threshold_max)) status = 'critical';

    const res = await pool.query(`
      INSERT INTO robot_sensor_telemetry (
        device_id, sensor_type, sensor_name, reading_value, unit, threshold_min, threshold_max, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [device_id, sensor_type, sensor_name, val, unit, threshold_min || null, threshold_max || null, status]);

    return res.rows[0];
  }

  // ==========================================
  // 4. ROBOT ACTIVITY & COMMAND HISTORY
  // ==========================================
  async getRobotActivityHistory({ device_id, limit = 50 } = {}) {
    let query = `
      SELECT 
        c.id, c.device_id, c.command_type, c.gesture_name, c.status,
        c.triggered_by, c.execution_time_ms, c.error_message, c.created_at,
        d.device_name, d.device_uuid
      FROM robot_commands c
      JOIN robot_devices d ON c.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (device_id) {
      params.push(device_id);
      query += ` AND c.device_id = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY c.created_at DESC LIMIT $${params.length}`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  // ==========================================
  // 5. HARDWARE EVENT LOGS
  // ==========================================
  async getHardwareEventLogs({ device_id, log_level, limit = 100 } = {}) {
    let query = `
      SELECT l.*, d.device_name, d.device_uuid
      FROM robot_logs l
      LEFT JOIN robot_devices d ON l.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (device_id) {
      params.push(device_id);
      query += ` AND l.device_id = $${params.length}`;
    }

    if (log_level && log_level !== 'all') {
      params.push(log_level);
      query += ` AND l.log_level = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY l.created_at DESC LIMIT $${params.length}`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  // ==========================================
  // 6. DEVICE CONNECTION ALERTS
  // ==========================================
  async getDeviceAlerts({ device_id, severity, is_resolved } = {}) {
    let query = `
      SELECT a.*, d.device_name, d.device_uuid, d.location_zone
      FROM robot_device_alerts a
      JOIN robot_devices d ON a.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (device_id) {
      params.push(device_id);
      query += ` AND a.device_id = $${params.length}`;
    }

    if (severity && severity !== 'all') {
      params.push(severity);
      query += ` AND a.severity = $${params.length}`;
    }

    if (is_resolved !== undefined && is_resolved !== 'all') {
      params.push(is_resolved === 'true' || is_resolved === true);
      query += ` AND a.is_resolved = $${params.length}`;
    }

    query += ` ORDER BY a.is_resolved ASC, a.created_at DESC`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  async createDeviceAlert(data) {
    const { device_id, alert_type, severity = 'warning', message } = data;
    const res = await pool.query(`
      INSERT INTO robot_device_alerts (device_id, alert_type, severity, message, is_resolved)
      VALUES ($1, $2, $3, $4, false)
      RETURNING *
    `, [device_id, alert_type, severity, message]);
    return res.rows[0];
  }

  async resolveDeviceAlert(id, { resolved_by = 'Duty Admin' } = {}) {
    const res = await pool.query(`
      UPDATE robot_device_alerts
      SET is_resolved = true, resolved_at = CURRENT_TIMESTAMP, resolved_by = $2
      WHERE id = $1
      RETURNING *
    `, [id, resolved_by]);
    return res.rows[0];
  }

  // ==========================================
  // 7. DEVICE MAINTENANCE HISTORY
  // ==========================================
  async getMaintenanceHistory({ device_id } = {}) {
    let query = `
      SELECT m.*, d.device_name, d.device_uuid, d.location_zone
      FROM robot_device_maintenance m
      JOIN robot_devices d ON m.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (device_id) {
      params.push(device_id);
      query += ` AND m.device_id = $${params.length}`;
    }

    query += ` ORDER BY m.scheduled_date DESC, m.id DESC`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  async createMaintenanceRecord(data) {
    const { device_id, maintenance_type, scheduled_date, technician_name, cost, status, work_summary } = data;
    const res = await pool.query(`
      INSERT INTO robot_device_maintenance (
        device_id, maintenance_type, scheduled_date, technician_name, cost, status, work_summary
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      device_id,
      maintenance_type,
      scheduled_date || new Date().toISOString().split('T')[0],
      technician_name,
      cost || 0.00,
      status || 'scheduled',
      work_summary || 'Standard hardware preventive servicing'
    ]);
    return res.rows[0];
  }

  async updateMaintenanceRecordStatus(id, { status, completed_date, work_summary }) {
    const fields = ['status = $2'];
    const params = [id, status];

    if (completed_date !== undefined) {
      params.push(completed_date);
      fields.push(`completed_date = $${params.length}`);
    } else if (status === 'completed') {
      fields.push(`completed_date = CURRENT_DATE`);
    }

    if (work_summary !== undefined) {
      params.push(work_summary);
      fields.push(`work_summary = $${params.length}`);
    }

    const res = await pool.query(`
      UPDATE robot_device_maintenance
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING *
    `, params);
    return res.rows[0];
  }

  // ==========================================
  // 8. SAFETY MONITORING & SAFEGUARD EVENTS
  // ==========================================
  async getSafetyIncidents({ device_id, severity, limit = 50 } = {}) {
    let query = `
      SELECT s.*, d.device_name, d.device_uuid
      FROM robot_safety_monitoring s
      JOIN robot_devices d ON s.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (device_id) {
      params.push(device_id);
      query += ` AND s.device_id = $${params.length}`;
    }

    if (severity && severity !== 'all') {
      params.push(severity);
      query += ` AND s.severity = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY s.occurred_at DESC LIMIT $${params.length}`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  async logSafetyIncident(data) {
    const { device_id, safety_event_type, severity = 'warning', safety_action_taken, zone_location, notes } = data;
    const res = await pool.query(`
      INSERT INTO robot_safety_monitoring (
        device_id, safety_event_type, severity, safety_action_taken, zone_location, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      device_id,
      safety_event_type,
      severity,
      safety_action_taken,
      zone_location || 'Reception Kiosk Zone',
      notes || null
    ]);
    return res.rows[0];
  }

  // ==========================================
  // 9. ROBOTICS FLEET ANALYTICS
  // ==========================================
  async getRoboticsAnalytics() {
    const devStats = await pool.query(`
      SELECT 
        COUNT(*) AS total_devices,
        COUNT(*) FILTER (WHERE status = 'online') AS online_devices,
        COALESCE(AVG(battery_level), 0) AS avg_battery_level,
        COALESCE(AVG(wifi_rssi), 0) AS avg_wifi_rssi
      FROM robot_devices
      WHERE is_enabled = true
    `);

    const cmdStats = await pool.query(`
      SELECT 
        COUNT(*) AS total_commands_executed,
        COUNT(*) FILTER (WHERE status = 'completed') AS successful_commands,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_commands,
        ROUND(AVG(execution_time_ms)) AS avg_execution_time_ms
      FROM robot_commands
    `);

    const alertStats = await pool.query(`
      SELECT 
        COUNT(*) AS total_alerts,
        COUNT(*) FILTER (WHERE is_resolved = false) AS unresolved_alerts,
        COUNT(*) FILTER (WHERE severity IN ('critical', 'emergency') AND is_resolved = false) AS critical_alerts
      FROM robot_device_alerts
    `);

    const safetyStats = await pool.query(`
      SELECT 
        COUNT(*) AS total_safety_interventions,
        COUNT(*) FILTER (WHERE occurred_at >= CURRENT_DATE - INTERVAL '7 days') AS safety_events_last_7_days
      FROM robot_safety_monitoring
    `);

    const gestureBreakdown = await pool.query(`
      SELECT 
        gesture_name,
        COUNT(*) AS count
      FROM robot_commands
      WHERE gesture_name IS NOT NULL
      GROUP BY gesture_name
      ORDER BY count DESC
      LIMIT 6
    `);

    return {
      fleet: devStats.rows[0],
      commands: cmdStats.rows[0],
      alerts: alertStats.rows[0],
      safety: safetyStats.rows[0],
      topGestures: gestureBreakdown.rows
    };
  }
}

export const roboticsManagementRepository = new RoboticsManagementRepository();

