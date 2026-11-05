import { isDatabaseConnected } from '../config/database.js';
import * as interactionRepository from '../repositories/interaction.repository.js';

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

  const validLang = ['en-IN', 'kn-IN', 'hi-IN'].includes(language)
    ? language
    : language?.toLowerCase().startsWith('kn')
    ? 'kn-IN'
    : language?.toLowerCase().startsWith('hi')
    ? 'hi-IN'
    : 'en-IN';

  const validMethod = ['voice', 'text_kiosk', 'rfid_scan'].includes(inputMethod) ? inputMethod : 'voice';

  if (isDatabaseConnected()) {
    return await interactionRepository.createLog({
      memberId,
      deviceId: deviceId || 1,
      userQuery,
      robotResponse,
      language: validLang,
      inputMethod: validMethod,
      intentDetected,
      gestureCommandId,
      latencyMs,
    });
  }

  // Fallback mock store
  const mockRecord = {
    id: mockInteractions.length + 1,
    member_id: memberId,
    device_id: deviceId,
    user_query: userQuery,
    robot_response: robotResponse,
    language,
    inputMethod,
    intentDetected,
    latencyMs,
    created_at: new Date().toISOString(),
  };

  mockInteractions.unshift(mockRecord);
  return mockRecord;
}

/**
 * Get recent interaction logs
 * @param {number} [limit=50]
 */
export async function getRecentInteractions(limit = 50) {
  if (isDatabaseConnected()) {
    return await interactionRepository.getRecentLogs(limit);
  }
  return mockInteractions.slice(0, limit);
}
