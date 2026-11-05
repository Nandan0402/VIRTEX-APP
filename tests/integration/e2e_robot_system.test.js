import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';
import { config } from '../../backend/src/config/env.js';

describe('End-to-End System Integration: Kiosk, Backend, Database & ESP32 Hardware Lifecycle', () => {
  let server;
  let baseUrl;
  const validDeviceId = config.robot?.deviceUuid || 'ESP32_RECEPTION_01';
  const validApiKey = config.robot?.apiKey || 'gym_robot_secret_key_12345';
  let adminToken;

  before(async () => {
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        resolve();
      });
    });

    // Acquire Admin JWT token for administrative actions
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'AdminPass2026!',
      }),
    });
    if (loginRes.ok) {
      const loginBody = await loginRes.json();
      adminToken = loginBody.data?.token;
    }
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Flow Step 1: System Health & Database Connectivity Check
  test('E2E Flow 1: System health check verifies server and database link', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'online');
    assert.ok('database' in body);
  });

  // Flow Step 2: Staff Authorization Verification
  test('E2E Flow 2: Admin can authenticate and verify role access', async () => {
    assert.ok(adminToken, 'Admin token should be acquired');
    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.role, 'superadmin');
  });

  // Flow Step 3: Member speaks to Kiosk in Kannada -> Receives Grounded Response and Gesture
  test('E2E Flow 3: Kiosk speech query in Kannada triggers grounded FAQ and queues NOD gesture', async () => {
    const res = await fetch(`${baseUrl}/v1/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'ಜಿಮ್ ಸಮಯ ಎಷ್ಟು?',
        language: 'kn-IN',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.language, 'kn-IN');
    assert.ok(body.data.reply.includes('5:30'), 'Answer contains grounded morning time');
    assert.ok(['NOD', 'NOD_YES'].includes(body.data.gesture));
  });

  // Flow Step 4: ESP32 Hardware Authenticates and Polls Next Queued Command
  test('E2E Flow 4: Authenticated ESP32 polls and consumes the queued motor command', async () => {
    const res = await fetch(`${baseUrl}/robot/commands/next`, {
      headers: {
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': validApiKey,
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.command.id);
    assert.ok(['NOD', 'NOD_YES'].includes(body.command.gesture));
    assert.ok(Array.isArray(body.command.steps));

    // Verify servo steps fall strictly within safe physical boundaries
    body.command.steps.forEach((step) => {
      if (step.headPan !== undefined) {
        assert.ok(step.headPan >= 0 && step.headPan <= 180, 'Head Pan within 0-180');
      }
      if (step.headTilt !== undefined) {
        assert.ok(step.headTilt >= 45 && step.headTilt <= 135, 'Head Tilt within 45-135');
      }
      if (step.armWave !== undefined) {
        assert.ok(step.armWave >= 0 && step.armWave <= 160, 'Arm Wave within 0-160');
      }
    });
  });

  // Flow Step 5: Subsequent Poll Returns 204 No Content (FIFO queue drained)
  test('E2E Flow 5: Subsequent ESP32 poll returns 204 No Content when queue is drained', async () => {
    const res = await fetch(`${baseUrl}/robot/commands/next`, {
      headers: {
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': validApiKey,
      },
    });
    assert.equal(res.status, 204);
  });

  // Flow Step 6: ESP32 Sends Telemetry Heartbeat and Updates Public Status
  test('E2E Flow 6: ESP32 heartbeat updates telemetry and marks robot online with lastSeen', async () => {
    const hbRes = await fetch(`${baseUrl}/robot/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': validApiKey,
      },
      body: JSON.stringify({
        deviceUuid: validDeviceId,
        ipAddress: '192.168.1.188',
        servos: { head: 90, leftArm: 20, rightArm: 20 },
      }),
    });
    assert.equal(hbRes.status, 200);

    const statusRes = await fetch(`${baseUrl}/robot/status`);
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.success, true);
    assert.equal(statusBody.data.online, true);
    assert.equal(statusBody.data.status, 'online');
    assert.equal(statusBody.data.ipAddress, '192.168.1.188');
    assert.ok(statusBody.data.lastSeenSecondsAgo <= 2);
  });

  // Flow Step 7: Interaction Logging Audit
  test('E2E Flow 7: Interactions are logged with latency, intent, and speech parameters', async () => {
    const res = await fetch(`${baseUrl}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'kn-IN',
        userQuery: 'ಜಿಮ್ ಸಮಯ ಎಷ್ಟು?',
        robotResponse: 'ನಮ್ಮ ಜಿಮ್ ಬೆಳಿಗ್ಗೆ 5:30 ರಿಂದ ರಾತ್ರಿ 10:30 ರವರೆಗೆ ತೆರೆದಿರುತ್ತದೆ.',
        detectedIntent: 'gym_timings',
        latencyMs: 145,
        gesture: 'NOD_YES',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.id);
  });

  // Flow Step 8: Security & Guardrails - Rejection of Illegal Gestures
  test('E2E Flow 8: Illegal gestures are strictly rejected with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gesture: 'DO_A_FLIP' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /Only WAVE, NOD, and IDLE are permitted/);
  });

  // Flow Step 9: Rejection of Unauthorized Hardware Requests
  test('E2E Flow 9: Requests with spoofed or missing hardware credentials are rejected (401)', async () => {
    const res = await fetch(`${baseUrl}/robot/commands/next`, {
      headers: {
        'x-robot-device-id': 'SPOOFED_ROBOT_999',
        'x-robot-api-key': 'fake_password',
      },
    });
    assert.equal(res.status, 401);
  });
});
