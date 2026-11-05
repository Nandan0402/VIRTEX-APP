import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';
import { config } from '../../backend/src/config/env.js';

describe('ESP32 Wi-Fi & Backend Polling Integration Tests', () => {
  let server;
  let baseUrl;
  const validDeviceId = config.robot?.deviceUuid || 'ESP32_RECEPTION_01';
  const validApiKey = config.robot?.apiKey || 'gym_robot_secret_key_12345';

  before(async () => {
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 1. Device Authentication on Polling
  test('ESP32 Polling rejects requests missing device token (401)', async () => {
    const res = await fetch(`${baseUrl}/robot/commands/next`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /Unauthorized/);
  });

  test('ESP32 Polling rejects requests with wrong device token (401)', async () => {
    const res = await fetch(`${baseUrl}/robot/commands/next`, {
      headers: {
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': 'wrong_invalid_key_999',
      },
    });
    assert.equal(res.status, 401);
  });

  test('ESP32 Polling returns 204 No Content when queue is empty', async () => {
    // Drain any remaining commands
    let drainRes;
    do {
      drainRes = await fetch(`${baseUrl}/robot/commands/next`, {
        headers: {
          'x-robot-device-id': validDeviceId,
          'x-robot-api-key': validApiKey,
        },
      });
    } while (drainRes.status === 200);

    const res = await fetch(`${baseUrl}/robot/commands/next`, {
      headers: {
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': validApiKey,
      },
    });
    assert.equal(res.status, 204);
  });

  // 2. Strict Gesture Validation: WAVE, NOD, IDLE accepted; Invalid gestures rejected
  test('POST /robot/commands accepts WAVE, NOD, and IDLE', async () => {
    for (const gesture of ['WAVE', 'NOD', 'IDLE']) {
      const res = await fetch(`${baseUrl}/robot/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gesture }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(body.command.id);
      assert.equal(body.command.gesture, gesture);
    }
  });

  test('POST /robot/commands rejects invalid gestures (400)', async () => {
    const res = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gesture: 'DANCE_SALSA' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /Only WAVE, NOD, and IDLE are permitted/);
  });

  // 3. FIFO Polling and Command Deduplication
  test('ESP32 receives queued command with unique ID and steps', async () => {
    // Queue a single WAVE command
    await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gesture: 'WAVE' }),
    });

    // Poll command
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
    assert.equal(body.command.gesture, 'WAVE');
    assert.ok(Array.isArray(body.command.steps));
  });

  // 4. Heartbeat Telemetry & Online/Offline Status Tracking
  test('ESP32 Heartbeat updates live telemetry and online status', async () => {
    const heartbeatRes = await fetch(`${baseUrl}/robot/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': validApiKey,
      },
      body: JSON.stringify({
        deviceUuid: validDeviceId,
        ipAddress: '192.168.1.150',
        servos: { head: 90, leftArm: 20, rightArm: 20 },
      }),
    });
    assert.equal(heartbeatRes.status, 200);

    // Verify public status endpoint
    const statusRes = await fetch(`${baseUrl}/robot/status`);
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.success, true);
    assert.equal(statusBody.data.online, true);
    assert.equal(statusBody.data.status, 'online');
    assert.equal(statusBody.data.ipAddress, '192.168.1.150');
    assert.ok(statusBody.data.lastSeenSecondsAgo <= 2);
  });

  // 5. Security: Never expose device token in public browser API responses
  test('GET /robot/status NEVER leaks hardware secret tokens or keys', async () => {
    const res = await fetch(`${baseUrl}/robot/status`);
    const text = await res.text();
    assert.ok(!text.includes(validApiKey), 'Device secret key must not appear in response');
    assert.ok(!text.includes('password'), 'Passwords must not appear in response');
  });
});
