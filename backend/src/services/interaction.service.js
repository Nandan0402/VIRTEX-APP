import { query, isDatabaseConnected } from '../config/database.js';

const mockInteractions = [];

/**
 * Log a member/visitor speech interaction for audit and analytics
 * @param {object} data
 */
export async function logInteraction(data) {
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

  if (isDatabaseConnected()) {
    const sql = `
      INSERT INTO interaction_logs (
        member_id, device_id, user_query, robot_response, language, input_method, intent_detected, gesture_command_id, latency_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, member_id, device_id, user_query, robot_response, language, input_method, intent_detected, latency_ms, created_at;
    `;

    const result = await query(sql, [
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

  // Fallback mock store
  const mockRecord = {
    id: mockInteractions.length + 1,
    member_id: memberId,
    device_id: deviceId,
    user_query: userQuery,
    robot_response: robotResponse,
    language,
    input_method: inputMethod,
    intent_detected: intentDetected,
    latency_ms: latencyMs,
    created_at: new Date().toISOString(),
  };

  mockInteractions.unshift(mockRecord);
  return mockRecord;
}

/**
 * Get recent interaction logs
 */
export async function getRecentInteractions(limit = 20) {
  if (isDatabaseConnected()) {
    const sql = `
      SELECT 
        i.id, i.created_at, i.user_query, i.robot_response, i.language, i.input_method, 
        i.intent_detected, i.latency_ms, m.full_name AS member_name, m.member_code
      FROM interaction_logs i
      LEFT JOIN members m ON m.id = i.member_id
      ORDER BY i.created_at DESC
      LIMIT $1;
    `;
    const result = await query(sql, [limit]);
    return result.rows;
  }

  return mockInteractions.slice(0, limit);
}

