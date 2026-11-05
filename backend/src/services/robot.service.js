import { query, isDatabaseConnected } from '../config/database.js';

// Pre-defined Choreographed Gestures (Only WAVE, NOD, IDLE permitted)
export const GESTURES = {
  WAVE: {
    name: 'WAVE',
    description: 'Waves right arm enthusiastically while slightly tilting head',
    steps: [
      { headPan: 90, headTilt: 80, armWave: 110, delayMs: 250 },
      { headPan: 90, headTilt: 80, armWave: 150, delayMs: 250 },
      { headPan: 90, headTilt: 80, armWave: 110, delayMs: 250 },
      { headPan: 90, headTilt: 80, armWave: 150, delayMs: 250 },
      { headPan: 90, headTilt: 90, armWave: 10, delayMs: 300 },
    ],
  },
  NOD: {
    name: 'NOD',
    description: 'Nods head up and down affirmatively',
    steps: [
      { headPan: 90, headTilt: 70, armWave: 10, delayMs: 200 },
      { headPan: 90, headTilt: 110, armWave: 10, delayMs: 200 },
      { headPan: 90, headTilt: 70, armWave: 10, delayMs: 200 },
      { headPan: 90, headTilt: 90, armWave: 10, delayMs: 200 },
    ],
  },
  IDLE: {
    name: 'IDLE',
    description: 'Returns all 3 servos to safe neutral resting positions',
    steps: [{ headPan: 90, headTilt: 90, armWave: 10, delayMs: 400 }],
  },
};

// Canonical Aliases for Backward Compatibility
GESTURES.GREET_WAVE = GESTURES.WAVE;
GESTURES.NOD_YES = GESTURES.NOD;
GESTURES.RESET_IDLE = GESTURES.IDLE;

export function normalizeGestureName(input) {
  if (!input || typeof input !== 'string') return null;
  const upper = input.trim().toUpperCase();
  if (upper === 'WAVE' || upper === 'GREET_WAVE') return 'WAVE';
  if (upper === 'NOD' || upper === 'NOD_YES') return 'NOD';
  if (upper === 'IDLE' || upper === 'RESET_IDLE') return 'IDLE';
  return null;
}

// In-memory runtime state for fast polling & mock fallback
let liveState = {
  online: false,
  deviceId: 1,
  deviceUuid: 'ESP32_RECEPTION_01',
  ipAddress: null,
  lastHeartbeat: null,
  servos: { headPan: 90, headTilt: 90, armWave: 10 },
  currentGesture: 'RESET_IDLE',
};

const memoryCommandQueue = [];

/**
 * Queue a robot motor command (gesture or direct angles)
 * Inserts into PostgreSQL robot_command_logs when connected
 */
export async function queueRobotCommand({
  deviceId = 1,
  commandType = 'GESTURE',
  gestureName = null,
  servoPayload = null,
  triggeredBy = 'system',
}) {
  let steps = [];

  if (gestureName) {
    const normalized = normalizeGestureName(gestureName);
    if (!normalized || !GESTURES[normalized]) {
      throw new Error(`Invalid gesture: '${gestureName}'. Only WAVE, NOD, and IDLE are permitted.`);
    }

    // Deduplicate rapid identical submissions within 800ms
    if (memoryCommandQueue.length > 0) {
      const lastQueued = memoryCommandQueue[memoryCommandQueue.length - 1];
      const timeSinceLast = Date.now() - new Date(lastQueued.createdAt).getTime();
      if (
        (lastQueued.gesture === gestureName || lastQueued.gesture === normalized) &&
        timeSinceLast < 800
      ) {
        return { ...lastQueued, deduplicated: true };
      }
    }

    steps = GESTURES[normalized].steps;
    liveState.currentGesture = gestureName;
  } else if (servoPayload) {
    const pan = Math.min(180, Math.max(0, servoPayload.headPan ?? liveState.servos.headPan));
    const tilt = Math.min(135, Math.max(45, servoPayload.headTilt ?? liveState.servos.headTilt));
    const arm = Math.min(160, Math.max(0, servoPayload.armWave ?? liveState.servos.armWave));
    steps = [{ headPan: pan, headTilt: tilt, armWave: arm, delayMs: servoPayload.delayMs || 200 }];
    liveState.currentGesture = 'DIRECT_ANGLES';
  }

  const command = {
    id: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    deviceId,
    type: commandType,
    gesture: gestureName,
    steps,
    createdAt: new Date().toISOString(),
  };

  // Push to memory queue for immediate polling response
  memoryCommandQueue.push(command);

  // If PostgreSQL is connected, record in robot_command_logs
  if (isDatabaseConnected()) {
    try {
      const sql = `
        INSERT INTO robot_command_logs (device_id, command_type, gesture_name, servo_payload, status, triggered_by)
        VALUES ($1, $2, $3, $4, 'pending', $5)
        RETURNING id, device_id, command_type, gesture_name, status, created_at;
      `;
      const result = await query(sql, [
        deviceId,
        commandType,
        gestureName,
        JSON.stringify(steps),
        triggeredBy,
      ]);
      command.dbId = result.rows[0].id;
    } catch (e) {
      console.warn('[RobotService] Could not persist command log to PostgreSQL:', e.message);
    }
  }

  return command;
}

/**
 * Polled by authenticated ESP32 device to retrieve the next motor command
 */
export async function popNextCommand(deviceId = 1) {
  if (memoryCommandQueue.length === 0) {
    return null;
  }

  const cmd = memoryCommandQueue.shift();

  // Update live state with target of final step
  if (cmd.steps && cmd.steps.length > 0) {
    const lastStep = cmd.steps[cmd.steps.length - 1];
    liveState.servos.headPan = lastStep.headPan;
    liveState.servos.headTilt = lastStep.headTilt;
    liveState.servos.armWave = lastStep.armWave;
  }

  // Update status in PostgreSQL if persisted
  if (cmd.dbId && isDatabaseConnected()) {
    try {
      await query(
        "UPDATE robot_command_logs SET status = 'delivered' WHERE id = $1;",
        [cmd.dbId]
      );
    } catch (e) {
      // Ignored
    }
  }

  return cmd;
}

/**
 * Update robot heartbeat telemetry
 */
export async function updateRobotTelemetry({ deviceUuid, ipAddress, servos }) {
  liveState.online = true;
  liveState.lastHeartbeat = new Date().toISOString();
  if (ipAddress) liveState.ipAddress = ipAddress;
  if (servos) {
    liveState.servos = { ...liveState.servos, ...servos };
  }

  if (isDatabaseConnected() && deviceUuid) {
    try {
      const sql = `
        UPDATE robot_devices
        SET status = 'online', ip_address = $1, last_heartbeat = CURRENT_TIMESTAMP
        WHERE device_uuid = $2;
      `;
      await query(sql, [ipAddress || liveState.ipAddress, deviceUuid]);
    } catch (e) {
      // Ignored
    }
  }

  return liveState;
}

/**
 * Get current robot snapshot with online/offline and last-seen telemetry
 */
export async function getRobotStatus() {
  const now = Date.now();
  const lastHeartbeatTime = liveState.lastHeartbeat
    ? new Date(liveState.lastHeartbeat).getTime()
    : null;
  const lastSeenSecondsAgo = lastHeartbeatTime
    ? Math.max(0, Math.round((now - lastHeartbeatTime) / 1000))
    : null;
  const isOnline = lastSeenSecondsAgo !== null && lastSeenSecondsAgo <= 15;

  return {
    ...liveState,
    status: isOnline ? 'online' : 'offline',
    online: isOnline,
    lastSeen: liveState.lastHeartbeat,
    lastSeenSecondsAgo,
    queuedCommandsCount: memoryCommandQueue.length,
  };
}

// Export legacy helper functions for compatibility
export function queueGesture(gestureName) {
  return queueRobotCommand({ gestureName, commandType: 'GESTURE' });
}

export function queueDirectAngles(angles) {
  return queueRobotCommand({ servoPayload: angles, commandType: 'DIRECT_ANGLES' });
}

export function getRobotState() {
  return getRobotStatus();
}
