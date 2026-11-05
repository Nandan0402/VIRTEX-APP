import { query } from '../config/database.js';

/**
 * Find robot device by UUID (e.g. 'ESP32_RECEPTION_01')
 * @param {string} deviceUuid
 * @param {import('pg').PoolClient} [client]
 */
export async function findDeviceByUuid(deviceUuid, client) {
  const sql = `
    SELECT id, device_uuid, device_name, mac_address, ip_address, status,
           firmware_version, head_pan_pin, head_tilt_pin, arm_wave_pin,
           battery_level, wifi_rssi, is_enabled, api_key_hash, last_heartbeat
    FROM robot_devices
    WHERE device_uuid = $1
    LIMIT 1;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [deviceUuid]);
  return res.rows[0] || null;
}

/**
 * Update robot device telemetry heartbeat
 * @param {string} deviceUuid
 * @param {Object} telemetry - { ipAddress, status }
 * @param {import('pg').PoolClient} [client]
 */
export async function updateDeviceHeartbeat(deviceUuid, { ipAddress, status = 'online' } = {}, client) {
  const sql = `
    UPDATE robot_devices
    SET status = $1,
        ip_address = COALESCE($2, ip_address),
        last_heartbeat = CURRENT_TIMESTAMP
    WHERE device_uuid = $3
    RETURNING id, device_uuid, status, ip_address, last_heartbeat;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [status, ipAddress || null, deviceUuid]);
  return res.rows[0] || null;
}

/**
 * Queue a robot command in PostgreSQL (inserts into robot_commands and legacy robot_command_logs)
 * @param {Object} cmd
 * @param {import('pg').PoolClient} [client]
 */
export async function queueCommand(cmd, client) {
  const {
    deviceId = 1,
    commandType = 'GESTURE',
    gestureName,
    servoPayload,
    priority = 1,
    triggeredBy = 'system',
  } = cmd;

  const executor = client || { query };

  // 1. Insert into robot_commands
  const sql1 = `
    INSERT INTO robot_commands (
      device_id, command_type, gesture_name, servo_payload, status, priority, triggered_by
    ) VALUES ($1, $2, $3, $4, 'pending', $5, $6)
    RETURNING id, device_id, command_type, gesture_name, servo_payload, status, created_at;
  `;
  const res1 = await executor.query(sql1, [
    deviceId,
    commandType,
    gestureName,
    JSON.stringify(servoPayload || {}),
    priority,
    triggeredBy,
  ]);

  // 2. Insert into legacy robot_command_logs for compatibility
  try {
    const sql2 = `
      INSERT INTO robot_command_logs (device_id, command_type, gesture_name, servo_payload, status, triggered_by)
      VALUES ($1, $2, $3, $4, 'pending', $5)
      RETURNING id;
    `;
    const res2 = await executor.query(sql2, [
      deviceId,
      commandType,
      gestureName,
      JSON.stringify(servoPayload || {}),
      triggeredBy,
    ]);
    res1.rows[0].legacyId = res2.rows[0]?.id;
  } catch (e) {
    // Legacy table insert failure ignored
  }

  return res1.rows[0];
}

/**
 * Mark a robot command as delivered or executed
 * @param {number} commandId
 * @param {string} [status='delivered']
 * @param {import('pg').PoolClient} [client]
 */
export async function updateCommandStatus(commandId, status = 'delivered', client) {
  const executor = client || { query };
  await executor.query(`UPDATE robot_commands SET status = $1 WHERE id = $2;`, [status, commandId]);
  try {
    await executor.query(`UPDATE robot_command_logs SET status = $1 WHERE id = $2;`, [status, commandId]);
  } catch (e) {
    // Ignored
  }
}

/**
 * Log a hardware or runtime diagnostic event to robot_logs
 * @param {Object} logData
 * @param {import('pg').PoolClient} [client]
 */
export async function logRobotEvent(logData, client) {
  const {
    deviceId = 1,
    logLevel = 'info',
    category = 'hardware',
    message,
    metadata = {},
  } = logData;

  const sql = `
    INSERT INTO robot_logs (device_id, log_level, category, message, metadata)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, device_id, log_level, category, message, created_at;
  `;
  const executor = client || { query };
  const res = await executor.query(sql, [
    deviceId,
    logLevel,
    category,
    message,
    JSON.stringify(metadata),
  ]);
  return res.rows[0];
}
