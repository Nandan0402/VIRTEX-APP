import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { createApp } from '../../backend/src/app.js';
import { config } from '../../backend/src/config/env.js';
import { checkDatabaseConnection, closePool, query } from '../../backend/src/config/database.js';
import { initRealtime, closeRealtime, broadcast } from '../../backend/src/services/realtime.service.js';

describe('PulseCore Real-Time Synchronization Suite (Admin & Kiosk WebSockets)', () => {
  let server;
  let port;
  let baseUrl;
  let wsUrl;
  let ownerToken;

  before(async () => {
    await checkDatabaseConnection();
    const app = createApp();

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1`;
        wsUrl = `ws://127.0.0.1:${port}/ws`;
        resolve();
      });
    });

    initRealtime(server);

    // Authenticate as owner to obtain JWT
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner_manju', password: 'OwnerPass2026!' }),
    });
    const loginBody = await loginRes.json();
    ownerToken = loginBody.data.token;
  });

  after(async () => {
    await closeRealtime();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePool(1000);
  });

  // Helper to create and connect a WebSocket client with message buffering
  function createWsClient(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws._msgQueue = [];
      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          ws._msgQueue.push(parsed);
          ws.emit('_parsedMessage', parsed);
        } catch {
          // Ignore
        }
      });
      ws.on('open', () => resolve(ws));
      ws.on('error', (err) => reject(err));
    });
  }

  // Helper to wait for a specific WebSocket message
  function waitForEvent(ws, expectedType, timeoutMs = 4000) {
    if (ws._msgQueue) {
      const foundIdx = ws._msgQueue.findIndex((m) => m.type === expectedType);
      if (foundIdx !== -1) {
        const [found] = ws._msgQueue.splice(foundIdx, 1);
        const p = Promise.resolve(found);
        p.cancel = () => {};
        return p;
      }
    }

    let timer;
    let handler;
    const promise = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        ws.off('_parsedMessage', handler);
        reject(new Error(`Timed out waiting for WebSocket event '${expectedType}' after ${timeoutMs}ms`));
      }, timeoutMs);

      handler = (envelope) => {
        if (envelope.type === expectedType) {
          clearTimeout(timer);
          ws.off('_parsedMessage', handler);
          resolve(envelope);
        }
      };

      ws.on('_parsedMessage', handler);
    });

    promise.cancel = () => {
      clearTimeout(timer);
      if (handler) ws.off('_parsedMessage', handler);
    };

    return promise;
  }

  // ---------------------------------------------------------------------------
  // Scenario 1: Authenticated vs Public Channel Assignment
  // ---------------------------------------------------------------------------
  test('Scenario 1: Authenticated Staff vs Public Kiosk Channel Assignment', async () => {
    // 1. Staff Client with valid JWT
    const adminWs = await createWsClient(`${wsUrl}?token=${ownerToken}`);
    const adminHandshake = await waitForEvent(adminWs, 'CONNECTED');
    assert.equal(adminHandshake.channel, 'admin');
    assert.equal(adminHandshake.authenticated, true);
    assert.equal(adminHandshake.user.username, 'owner_manju');

    // 2. Public Kiosk Client without JWT
    const kioskWs = await createWsClient(`${wsUrl}?channel=kiosk`);
    const kioskHandshake = await waitForEvent(kioskWs, 'CONNECTED');
    assert.equal(kioskHandshake.channel, 'kiosk');
    assert.equal(kioskHandshake.authenticated, false);

    adminWs.close();
    kioskWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Admin Updates Plan & Price -> Kiosk Receives Real-time Broadcast
  // ---------------------------------------------------------------------------
  test('Scenario 2: Admin updates plan pricing -> Kiosk receives PLAN_UPDATED event', async () => {
    const kioskWs = await createWsClient(`${wsUrl}?channel=kiosk`);
    await waitForEvent(kioskWs, 'CONNECTED');

    const eventPromise = waitForEvent(kioskWs, 'PLAN_UPDATED');

    // Admin updates plan price via REST API
    const updateRes = await fetch(`${baseUrl}/membership-plans/1`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        priceInr: 2799,
        badgeLabel: 'Most Popular',
      }),
    });
    assert.equal(updateRes.status, 200);

    const receivedEvent = await eventPromise;
    assert.equal(receivedEvent.type, 'PLAN_UPDATED');
    assert.equal(receivedEvent.data.id, 1);
    assert.equal(Number(receivedEvent.data.price_inr), 2799);
    assert.ok(receivedEvent.eventId, 'Event must contain unique eventId');

    kioskWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Admin Updates Gym Operating Hours -> Kiosk Receives Real-time Broadcast
  // ---------------------------------------------------------------------------
  test('Scenario 3: Admin updates gym settings/hours -> Kiosk receives GYM_INFO_UPDATED event', async () => {
    const kioskWs = await createWsClient(`${wsUrl}?channel=kiosk`);
    await waitForEvent(kioskWs, 'CONNECTED');

    const eventPromise = waitForEvent(kioskWs, 'GYM_INFO_UPDATED');

    // Admin updates gym settings
    const updateRes = await fetch(`${baseUrl}/admin/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        tagline: 'Next-Gen AI Fitness Experience',
        phone: '+91 98765 00000',
      }),
    });
    assert.equal(updateRes.status, 200);

    const receivedEvent = await eventPromise;
    assert.equal(receivedEvent.type, 'GYM_INFO_UPDATED');
    assert.equal(receivedEvent.data.tagline, 'Next-Gen AI Fitness Experience');

    kioskWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Trainer Updates Floor Duty Status -> Kiosk Receives Real-time Broadcast
  // ---------------------------------------------------------------------------
  test('Scenario 4: Trainer updates floor status -> Kiosk receives TRAINER_STATUS_UPDATED event', async () => {
    const kioskWs = await createWsClient(`${wsUrl}?channel=kiosk`);
    await waitForEvent(kioskWs, 'CONNECTED');

    const eventPromise = waitForEvent(kioskWs, 'TRAINER_STATUS_UPDATED');

    // Trainer updates status to in_session
    const updateRes = await fetch(`${baseUrl}/trainers/1/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ status: 'in_session' }),
    });
    assert.equal(updateRes.status, 200);

    const receivedEvent = await eventPromise;
    assert.equal(receivedEvent.type, 'TRAINER_STATUS_UPDATED');
    assert.equal(receivedEvent.data.status, 'in_session');
    assert.equal(receivedEvent.data.id, 1);

    kioskWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Admin Publishes Announcement -> Kiosk Receives Real-time Broadcast
  // ---------------------------------------------------------------------------
  test('Scenario 5: Admin publishes announcement -> Kiosk receives ANNOUNCEMENT_CREATED event', async () => {
    const kioskWs = await createWsClient(`${wsUrl}?channel=kiosk`);
    await waitForEvent(kioskWs, 'CONNECTED');

    const eventPromise = waitForEvent(kioskWs, 'ANNOUNCEMENT_CREATED');

    // Admin creates announcement
    const createRes = await fetch(`${baseUrl}/announcements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        title: 'Realtime Sync Launch',
        message: 'High-speed real-time synchronization online across all stations.',
        priority: 'event',
      }),
    });
    assert.equal(createRes.status, 201);

    const receivedEvent = await eventPromise;
    assert.equal(receivedEvent.type, 'ANNOUNCEMENT_CREATED');
    assert.equal(receivedEvent.data.title, 'Realtime Sync Launch');

    kioskWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Admin Adds FAQ -> Kiosk Receives Real-time Broadcast
  // ---------------------------------------------------------------------------
  test('Scenario 6: Admin creates FAQ -> Kiosk receives FAQ_CREATED event', async () => {
    const kioskWs = await createWsClient(`${wsUrl}?channel=kiosk`);
    await waitForEvent(kioskWs, 'CONNECTED');

    const eventPromise = waitForEvent(kioskWs, 'FAQ_CREATED');

    // Admin creates FAQ
    const createRes = await fetch(`${baseUrl}/faqs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        question: 'Are lockers provided free for members?',
        answer: 'Yes, secure digital lockers are provided free of charge for all active pass holders.',
        category: 'facilities',
      }),
    });
    assert.equal(createRes.status, 201);

    const receivedEvent = await eventPromise;
    assert.equal(receivedEvent.type, 'FAQ_CREATED');
    assert.equal(receivedEvent.data.question, 'Are lockers provided free for members?');

    kioskWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: Member Check-in at Kiosk -> Admin Receives Live Event with Masked PII
  // ---------------------------------------------------------------------------
  test('Scenario 7: Member checks in at kiosk -> Admin receives live MEMBER_CHECKED_IN with masked PII', async () => {
    // Clear recent check-ins for GYM004 to ensure 200 OK
    await query(`DELETE FROM check_ins WHERE member_id = (SELECT id FROM members WHERE member_code = 'GYM004')`);

    const adminWs = await createWsClient(`${wsUrl}?token=${ownerToken}`);
    await waitForEvent(adminWs, 'CONNECTED');

    const eventPromise = waitForEvent(adminWs, 'MEMBER_CHECKED_IN');

    // Kiosk checks in member GYM004
    const checkinRes = await fetch(`${baseUrl}/members/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'GYM004', language: 'kn-IN' }),
    });

    assert.equal(checkinRes.status, 200);
    const receivedEvent = await eventPromise;
    assert.equal(receivedEvent.type, 'MEMBER_CHECKED_IN');
    assert.ok(receivedEvent.data.member);
    assert.equal(receivedEvent.data.member.member_code, 'GYM004');
    assert.match(receivedEvent.data.member.phone, /^\*\*\*\*\*\*/, 'Phone must be masked');
    assert.equal(receivedEvent.data.member.password_hash, undefined, 'Password hash must never be broadcast');
    assert.equal(receivedEvent.data.member.emergency_contact_phone, undefined, 'Emergency contact must not be leaked');

    adminWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: Member Submits Enquiry at Kiosk -> Admin Receives Live Event
  // ---------------------------------------------------------------------------
  test('Scenario 8: Visitor submits enquiry -> Admin receives live ENQUIRY_RECEIVED notification', async () => {
    const adminWs = await createWsClient(`${wsUrl}?token=${ownerToken}`);
    await waitForEvent(adminWs, 'CONNECTED');

    const eventPromise = waitForEvent(adminWs, 'ENQUIRY_RECEIVED');

    const uniquePhone = '98' + Math.floor(10000000 + Math.random() * 90000000);
    const enquiryRes = await fetch(`${baseUrl}/members/enquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Realtime Lead',
        phone: uniquePhone,
        planName: 'Platinum Annual',
        notes: 'Requested personal trainer tour',
      }),
    });
    assert.equal(enquiryRes.status, 201);

    const receivedEvent = await eventPromise;
    assert.equal(receivedEvent.type, 'ENQUIRY_RECEIVED');
    assert.equal(receivedEvent.data.full_name, 'Realtime Lead');
    assert.equal(receivedEvent.data.phone, uniquePhone);

    adminWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 9: ESP32 Hardware Status / Telemetry Live Broadcast
  // ---------------------------------------------------------------------------
  test('Scenario 9: ESP32 sends heartbeat -> Connected clients receive ROBOT_STATUS_CHANGED', async () => {
    const kioskWs = await createWsClient(`${wsUrl}?channel=kiosk`);
    await waitForEvent(kioskWs, 'CONNECTED');

    const eventPromise = waitForEvent(kioskWs, 'ROBOT_STATUS_CHANGED');

    // ESP32 sends heartbeat
    const hbRes = await fetch(`${baseUrl}/robot/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-robot-device-id': 'ESP32_RECEPTION_01',
        'x-robot-api-key': 'gym_robot_secret_key_12345',
      },
      body: JSON.stringify({
        deviceUuid: 'ESP32_RECEPTION_01',
        ipAddress: '192.168.1.155',
        servos: { headPan: 92, headTilt: 88, armWave: 15 },
      }),
    });
    assert.equal(hbRes.status, 200);

    const receivedEvent = await eventPromise;
    assert.equal(receivedEvent.type, 'ROBOT_STATUS_CHANGED');
    assert.equal(receivedEvent.data.ipAddress, '192.168.1.155');

    kioskWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 10: Event Authorization & Channel Isolation
  // ---------------------------------------------------------------------------
  test('Scenario 10: Administrative events are NOT sent to public kiosk channel', async () => {
    const kioskWs = await createWsClient(`${wsUrl}?channel=kiosk`);
    await waitForEvent(kioskWs, 'CONNECTED');

    let leakedToKiosk = false;
    kioskWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ENQUIRY_RECEIVED' || msg.type === 'ADMIN_AUDIT_LOG') {
          leakedToKiosk = true;
        }
      } catch {}
    });

    // Broadcast strictly to admin channel
    broadcast('ENQUIRY_RECEIVED', { secretStaffInfo: true }, { channel: 'admin' });

    // Wait 300ms to verify kiosk receives nothing
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(leakedToKiosk, false, 'Administrative event must never be broadcast to public kiosk');

    kioskWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 11: Ping-Pong Keepalive & Heartbeat
  // ---------------------------------------------------------------------------
  test('Scenario 11: Client ping frame receives pong response with timestamp', async () => {
    const kioskWs = await createWsClient(`${wsUrl}?channel=kiosk`);
    await waitForEvent(kioskWs, 'CONNECTED');

    const pongPromise = waitForEvent(kioskWs, 'pong');
    kioskWs.send(JSON.stringify({ type: 'ping' }));

    const pong = await pongPromise;
    assert.equal(pong.type, 'pong');
    assert.ok(pong.timestamp);

    kioskWs.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 12: PostgreSQL Sync Event Audit Logs Persistence
  // ---------------------------------------------------------------------------
  test('Scenario 12: GET /admin/sync-logs retrieves persisted sync events from PostgreSQL', async () => {
    // Fetch sync event logs via authenticated admin endpoint
    const res = await fetch(`${baseUrl}/admin/sync-logs?limit=10`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length >= 1, 'sync_event_logs should have recorded events');

    const logEntry = body.data[0];
    assert.ok(logEntry.event_id, 'event_id must exist');
    assert.ok(logEntry.event_type, 'event_type must exist');
    assert.ok(logEntry.channel, 'channel must exist');
    assert.ok(logEntry.created_at, 'created_at must exist');
  });
});
