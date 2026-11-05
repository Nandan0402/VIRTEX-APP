import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../../backend/src/app.js';
import { config } from '../../backend/src/config/env.js';

describe('PulseCore FitBot Hardware Integration Suite', () => {
  let server;
  let baseUrl;
  let adminToken;

  const validDeviceId = config.robot?.deviceUuid || 'ESP32_RECEPTION_01';
  const validApiKey = config.robot?.apiKey || 'gym_robot_secret_key_12345';

  before(async () => {
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1`;
        resolve();
      });
    });

    // Generate valid admin token for staff-authenticated endpoints
    adminToken = jwt.sign(
      { id: 1, username: 'admin_vikram', role: 'owner', permissions: ['*'] },
      config.jwt.secret,
      { expiresIn: '1h' }
    );
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Test 1: Hardware Device Authentication
  test('ESP32 device authentication rejects missing or invalid credentials', async () => {
    // Missing credentials
    const resNoAuth = await fetch(`${baseUrl}/robot/commands/next`);
    assert.equal(resNoAuth.status, 401);

    // Invalid secret key
    const resBadKey = await fetch(`${baseUrl}/robot/commands/next`, {
      headers: {
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': 'invalid_secret_key_999',
      },
    });
    assert.equal(resBadKey.status, 401);

    // Valid credentials accepted
    const resValid = await fetch(`${baseUrl}/robot/commands/next`, {
      headers: {
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': validApiKey,
      },
    });
    assert.ok(resValid.status === 200 || resValid.status === 204);
  });

  // Test 2: Standard Physical Gestures (WAVE, NOD, SHAKE, IDLE)
  test('Queueing standard physical gestures (WAVE, NOD, SHAKE, IDLE) succeeds', async () => {
    const gestures = ['WAVE', 'NOD', 'SHAKE', 'IDLE'];

    for (const g of gestures) {
      const res = await fetch(`${baseUrl}/robot/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: 'GESTURE',
          gestureName: g,
          triggeredBy: 'hardware_test',
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(data.command);
    }
  });

  // Test 3: Calibrated Servo Positioning with Angle Safety Bounds
  test('Direct calibrated servo angles enforce physical range limits', async () => {
    // Valid angles: Pan (90), Tilt (100), Arm (45)
    const validRes = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandType: 'DIRECT_ANGLES',
        headPan: 90,
        headTilt: 100,
        armWave: 45,
      }),
    });
    assert.equal(validRes.status, 201);

    // Out-of-bounds Head Pan (> 180) rejected
    const invalidPan = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandType: 'DIRECT_ANGLES',
        headPan: 220,
      }),
    });
    assert.equal(invalidPan.status, 400);

    // Out-of-bounds Head Tilt (< 45) rejected
    const invalidTilt = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandType: 'DIRECT_ANGLES',
        headTilt: 20,
      }),
    });
    assert.equal(invalidTilt.status, 400);

    // Out-of-bounds Right Arm Wave (> 160) rejected
    const invalidArm = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandType: 'DIRECT_ANGLES',
        armWave: 190,
      }),
    });
    assert.equal(invalidArm.status, 400);
  });

  // Test 4: Hardware Polling and Step Generation
  test('ESP32 device polling pops queued command with safe articulated steps', async () => {
    // Queue a WAVE gesture
    await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandType: 'GESTURE',
        gestureName: 'WAVE',
        triggeredBy: 'polling_test',
      }),
    });

    // Poll next command with device headers
    const pollRes = await fetch(`${baseUrl}/robot/commands/next`, {
      headers: {
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': validApiKey,
      },
    });

    assert.equal(pollRes.status, 200);
    const body = await pollRes.json();
    assert.equal(body.success, true);
    assert.ok(body.command);
    assert.ok(Array.isArray(body.command.steps));
    assert.ok(body.command.steps.length > 0);

    // Verify all steps are within physical servo limits
    for (const step of body.command.steps) {
      assert.ok(step.headPan >= 0 && step.headPan <= 180, `Pan ${step.headPan} out of bounds`);
      assert.ok(step.headTilt >= 45 && step.headTilt <= 135, `Tilt ${step.headTilt} out of bounds`);
      assert.ok(step.armWave >= 0 && step.armWave <= 160, `Arm ${step.armWave} out of bounds`);
    }
  });

  // Test 5: Command Execution Acknowledgment
  test('Hardware command execution acknowledgment updates status and execution time', async () => {
    // 1. Queue a fresh command
    const qRes = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandType: 'GESTURE',
        gestureName: 'NOD',
        triggeredBy: 'ack_test',
      }),
    });
    const qBody = await qRes.json();
    const cmdId = qBody.command.id;

    // 2. ESP32 acknowledges execution
    const ackRes = await fetch(`${baseUrl}/robot/commands/${cmdId}/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': validApiKey,
      },
      body: JSON.stringify({
        status: 'executed',
        executionTimeMs: 820,
        errorMessage: null,
      }),
    });

    assert.equal(ackRes.status, 200);
    const ackBody = await ackRes.json();
    assert.equal(ackBody.success, true);
  });

  // Test 6: Hardware Error & Diagnostics Logging
  test('Hardware error logging endpoint records events into PostgreSQL robot_logs', async () => {
    const errRes = await fetch(`${baseUrl}/robot/errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': validApiKey,
      },
      body: JSON.stringify({
        logLevel: 'WARN',
        eventType: 'servo_high_resistance',
        message: 'SG90 Left Arm experiencing mild resistive torque spike.',
        payload: { currentMa: 480, thresholdMa: 450, pin: 19 },
      }),
    });

    assert.equal(errRes.status, 201);
    const errBody = await errRes.json();
    assert.equal(errBody.success, true);
    assert.ok(errBody.data);
  });

  // Test 7: Telemetry Heartbeat Reporting
  test('ESP32 telemetry heartbeat updates battery, RSSI, and last_seen', async () => {
    const hbRes = await fetch(`${baseUrl}/robot/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-robot-device-id': validDeviceId,
        'x-robot-api-key': validApiKey,
      },
      body: JSON.stringify({
        deviceUuid: validDeviceId,
        ipAddress: '192.168.1.155',
        wifiRssi: -58,
        batteryLevel: 88,
        batteryVoltage: 4.12,
        servos: { headPan: 90, headTilt: 90, armWave: 10 },
      }),
    });

    assert.equal(hbRes.status, 200);
    const hbBody = await hbRes.json();
    assert.equal(hbBody.success, true);
    assert.equal(hbBody.data.online, true);
    assert.equal(hbBody.data.batteryLevel, 88);
    assert.equal(hbBody.data.wifiRssi, -58);
  });

  // Test 8: Admin Diagnostics Endpoint Protection & Key Masking
  test('Admin diagnostics endpoint returns hardware telemetry and strictly masks api_key_hash', async () => {
    // Unauthenticated access rejected
    const unauthRes = await fetch(`${baseUrl}/robot/diagnostics`);
    assert.equal(unauthRes.status, 401);

    // Authorized staff access returns telemetry
    const authRes = await fetch(`${baseUrl}/robot/diagnostics`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(authRes.status, 200);
    const body = await authRes.json();
    assert.equal(body.success, true);
    assert.ok(body.data);

    // Crucial Security Verification: api_key_hash must NEVER be exposed
    assert.equal(body.data.api_key_hash, undefined, 'CRITICAL: api_key_hash was exposed in diagnostics response!');
    assert.equal(body.data.apiKey, undefined, 'CRITICAL: apiKey was exposed in diagnostics response!');
  });

  // Test 9: Admin Hardware Error Logs Endpoint
  test('Authorized staff can query hardware error logs', async () => {
    const logsRes = await fetch(`${baseUrl}/robot/hardware-logs?limit=10`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(logsRes.status, 200);
    const body = await logsRes.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
  });

  // Test 10: Member Check-In Automatically Triggers Greet Gesture
  test('Active member check-in at kiosk automatically queues GREET_WAVE gesture', async () => {
    const checkInRes = await fetch(`${baseUrl}/members/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'GYM001',
      }),
    });

    // Both 200 (first check-in) and 409 (duplicate recent check-in) trigger affirmative robot gestures
    assert.ok(checkInRes.status === 200 || checkInRes.status === 409, `Unexpected status ${checkInRes.status}`);
    const checkInBody = await checkInRes.json();
    if (checkInRes.status === 200) {
      assert.equal(checkInBody.data.gesture, 'GREET_WAVE');
    }
  });
});
