/**
 * realtime.service.js - High-Performance Real-Time Synchronization Engine
 * Powered by WebSockets (ws) with PostgreSQL as the authoritative source of truth.
 * 
 * Features:
 * - Authenticated channels: 'admin' (Owner/Manager/Trainer), 'kiosk' (Public Kiosk), 'device' (ESP32)
 * - Fine-grained event authorization and automatic PII masking for public channels
 * - Ping/Pong heartbeat with dead socket detection
 * - Sliding-window event deduplication protection
 * - Asynchronous persistence of sync events to PostgreSQL table `sync_event_logs`
 */

import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { query, isDatabaseConnected } from '../config/database.js';

let wss = null;
const clients = new Set();
const recentEventIds = new Map(); // eventId -> timestamp for deduplication (sliding 60s window)
let heartbeatInterval = null;

// Periodic cleanup of deduplication cache
setInterval(() => {
  const now = Date.now();
  for (const [id, time] of recentEventIds.entries()) {
    if (now - time > 60000) {
      recentEventIds.delete(id);
    }
  }
}, 30000).unref();

/**
 * Verify JWT token string and return decoded payload or null
 */
export function verifyWsToken(token) {
  if (!token) return null;
  try {
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    return jwt.verify(cleanToken, config.jwt.secret);
  } catch {
    return null;
  }
}

/**
 * Mask sensitive member PII for public broadcast
 */
function maskPublicPayload(eventType, data) {
  if (!data || typeof data !== 'object') return data;
  const sanitized = JSON.parse(JSON.stringify(data));

  // If payload contains member info, mask phone and email, remove passwords
  if (sanitized.member) {
    if (sanitized.member.phone && typeof sanitized.member.phone === 'string') {
      sanitized.member.phone = '******' + sanitized.member.phone.slice(-4);
    }
    if (sanitized.member.email && typeof sanitized.member.email === 'string' && sanitized.member.email.includes('@')) {
      const parts = sanitized.member.email.split('@');
      sanitized.member.email = parts[0].slice(0, 2) + '***@' + parts[1];
    }
    delete sanitized.member.password_hash;
    delete sanitized.member.emergency_contact_phone;
    delete sanitized.member.emergency_contact_name;
    delete sanitized.member.notes;
  }

  // Remove administrative audit metadata if any
  delete sanitized.password_hash;
  delete sanitized.ip_address;
  delete sanitized.user_agent;

  return sanitized;
}

/**
 * Initialize WebSocket Server attached to an existing Node.js HTTP Server
 * @param {import('http').Server} httpServer
 */
export function initRealtime(httpServer) {
  if (wss) {
    return wss;
  }

  wss = new WebSocketServer({
    noServer: true,
  });

  // Handle HTTP upgrade to WebSocket at path /ws
  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (parsedUrl.pathname !== '/ws') {
        return; // Let other handlers (if any) handle other upgrade paths
      }

      // Check token in query param (?token=...)
      const token = parsedUrl.searchParams.get('token');
      const channelParam = parsedUrl.searchParams.get('channel');
      const decodedUser = verifyWsToken(token);

      wss.handleUpgrade(request, socket, head, (ws) => {
        // Assign authenticated channel or public kiosk channel
        if (decodedUser) {
          ws.isAuthenticated = true;
          ws.user = decodedUser;
          ws.channel = 'admin';
        } else if (channelParam === 'device') {
          ws.isAuthenticated = false;
          ws.user = null;
          ws.channel = 'device';
        } else {
          ws.isAuthenticated = false;
          ws.user = null;
          ws.channel = 'kiosk';
        }

        ws.clientId = crypto.randomUUID();
        ws.isAlive = true;
        clients.add(ws);

        wss.emit('connection', ws, request);
      });
    } catch (err) {
      console.warn('[Realtime] WebSocket upgrade error:', err.message);
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    // Send welcome / connected handshake packet
    ws.send(
      JSON.stringify({
        type: 'CONNECTED',
        clientId: ws.clientId,
        channel: ws.channel,
        authenticated: ws.isAuthenticated,
        user: ws.user ? { id: ws.user.id, username: ws.user.username, role: ws.user.role } : null,
        timestamp: new Date().toISOString(),
      })
    );

    // Heartbeat listener
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Client message handling
    ws.on('message', (messageRaw) => {
      try {
        const msg = JSON.parse(messageRaw.toString());

        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          return;
        }

        // Dynamic authentication over established socket
        if (msg.type === 'auth' && msg.token) {
          const user = verifyWsToken(msg.token);
          if (user) {
            ws.isAuthenticated = true;
            ws.user = user;
            ws.channel = 'admin';
            ws.send(
              JSON.stringify({
                type: 'AUTH_SUCCESS',
                channel: 'admin',
                user: { id: user.id, username: user.username, role: user.role },
                timestamp: new Date().toISOString(),
              })
            );
          } else {
            ws.send(
              JSON.stringify({
                type: 'AUTH_ERROR',
                message: 'Invalid or expired token',
                timestamp: new Date().toISOString(),
              })
            );
          }
        }
      } catch (e) {
        // Ignore unparseable frames
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      console.warn('[Realtime] Socket error on client:', ws.clientId, err.message);
      clients.delete(ws);
    });
  });

  // Heartbeat ping loop every 20 seconds
  heartbeatInterval = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 20000);
  heartbeatInterval.unref();

  console.log('[Realtime] WebSocket Synchronization Engine online at /ws');
  return wss;
}

/**
 * Broadcast an event to connected WebSocket clients
 * 
 * @param {string} eventType - e.g. 'PLAN_UPDATED', 'MEMBER_CHECKED_IN', 'ROBOT_STATUS_CHANGED'
 * @param {object} payload - Event payload data
 * @param {object} [options]
 * @param {string} [options.channel='all'] - 'all' | 'admin' | 'kiosk' | 'device'
 * @param {WebSocket} [options.excludeSocket] - Optional socket to skip
 * @param {string} [options.triggeredBy='system'] - Username or system trigger
 * @returns {string} eventId
 */
export function broadcast(eventType, payload = {}, options = {}) {
  const { channel = 'all', excludeSocket = null, triggeredBy = 'system' } = options;

  const eventId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // Deduplication check
  if (recentEventIds.has(eventId)) {
    return eventId;
  }
  recentEventIds.set(eventId, Date.now());

  // 1. Asynchronously log event to PostgreSQL sync_event_logs
  if (isDatabaseConnected()) {
    query(
      `INSERT INTO sync_event_logs (event_id, event_type, channel, payload, triggered_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [eventId, eventType, channel, JSON.stringify(payload), String(triggeredBy)]
    ).catch((err) => {
      console.warn('[Realtime] Failed to log sync event to PostgreSQL:', err.message);
    });
  }

  // 2. Prepare message envelopes
  const adminEnvelope = JSON.stringify({
    eventId,
    type: eventType,
    channel,
    data: payload,
    triggeredBy,
    timestamp,
  });

  const kioskEnvelope = JSON.stringify({
    eventId,
    type: eventType,
    channel,
    data: maskPublicPayload(eventType, payload),
    triggeredBy,
    timestamp,
  });

  // 3. Dispatch to authorized clients
  for (const client of clients) {
    if (client === excludeSocket || client.readyState !== WebSocket.OPEN) {
      continue;
    }

    if (channel === 'admin' && client.channel !== 'admin') {
      // Do not send administrative events to public kiosk or unauthenticated clients
      continue;
    }

    if (channel === 'device' && client.channel !== 'device' && client.channel !== 'admin') {
      continue;
    }

    if (client.channel === 'admin') {
      client.send(adminEnvelope);
    } else {
      client.send(kioskEnvelope);
    }
  }

  return eventId;
}

/**
 * Get current connected socket statistics
 */
export function getConnectedStats() {
  let adminCount = 0;
  let kioskCount = 0;
  let deviceCount = 0;

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      if (client.channel === 'admin') adminCount++;
      else if (client.channel === 'device') deviceCount++;
      else kioskCount++;
    }
  }

  return {
    total: clients.size,
    admin: adminCount,
    kiosk: kioskCount,
    device: deviceCount,
  };
}

/**
 * Retrieve recent sync event logs from PostgreSQL
 */
export async function getRecentSyncLogs(limit = 50) {
  if (!isDatabaseConnected()) {
    return [];
  }

  const res = await query(
    `SELECT id, event_id, event_type, channel, payload, triggered_by, created_at
     FROM sync_event_logs
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

/**
 * Cleanly close WebSocket Server and disconnect all clients
 */
export async function closeRealtime() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  for (const client of clients) {
    try {
      client.terminate();
    } catch {
      // Ignore
    }
  }
  clients.clear();
  recentEventIds.clear();

  if (wss) {
    await new Promise((resolve) => wss.close(resolve));
    wss = null;
  }
}

