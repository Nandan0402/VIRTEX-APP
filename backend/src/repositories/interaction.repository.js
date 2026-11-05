import { query } from '../config/database.js';

/**
 * Log a member/visitor speech interaction for audit and analytics
 * @param {Object} data
 * @param {import('pg').PoolClient} [client]
 */
export async function createLog(data, client) {
  const {
    memberId = null,
    deviceId = 1,
    userQuery,
    robotResponse,
    language = 'en-IN',
    inputMethod = 'voice',
    intentDetected = 'general_query',
    gestureCommandId = null,
    latencyMs = null,
  } = data;

  const sql = `
    INSERT INTO interaction_logs (
      member_id, device_id, user_query, robot_response, language, input_method,
      intent_detected, gesture_command_id, latency_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, member_id, device_id, user_query, robot_response, language,
              input_method, intent_detected, latency_ms, created_at;
  `;

  const executor = client || { query };
  const result = await executor.query(sql, [
    memberId,
    deviceId,
    userQuery,
    robotResponse,
    language,
    inputMethod,
    intentDetected,
    gestureCommandId,
    latencyMs,
  ]);

  return result.rows[0];
}

/**
 * Retrieve recent interaction history
 * @param {number} [limit=50]
 * @param {import('pg').PoolClient} [client]
 */
export async function getRecentLogs(limit = 50, client) {
  const sql = `
    SELECT id, member_id, device_id, user_query, robot_response, language,
           input_method, intent_detected, latency_ms, created_at
    FROM interaction_logs
    ORDER BY created_at DESC
    LIMIT $1;
  `;
  const executor = client || { query };
  const result = await executor.query(sql, [limit]);
  return result.rows;
}

