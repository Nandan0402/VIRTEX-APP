import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';
import { config } from '../../backend/src/config/env.js';
import { query, closePool } from '../../backend/src/config/database.js';

describe('Virtex Robot REST API Integration Test Suite', () => {
  let server;
  let baseUrl;
  let adminToken;
  let trainerToken;

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
    try {
      await query("DELETE FROM interaction_logs WHERE user_query = 'Are lockers available?' AND latency_ms = 250;");
    } catch (_) {}
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePool();
  });

  // 1. Health
  test('GET /health returns online status and database link', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'online');
    assert.ok('database' in body);
  });

  // 2. Gym Info
  test('GET /gym/info returns gym profile and operating hours', async () => {
    const res = await fetch(`${baseUrl}/gym/info`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.gym_name.length > 0);
    assert.ok(Array.isArray(body.data.operating_hours));
  });

  // 3. FAQs & Search
  test('GET /faqs returns knowledge base and supports query filters', async () => {
    const res = await fetch(`${baseUrl}/faqs?language=en-IN`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.count > 0);
    body.data.forEach((f) => assert.equal(f.language, 'en-IN'));

    // Search keyword query
    const searchRes = await fetch(`${baseUrl}/faqs?q=hours`);
    const searchBody = await searchRes.json();
    assert.ok(searchBody.count > 0);
  });

  // 4. Membership Plans
  test('GET /membership-plans returns active membership pricing tiers', async () => {
    const res = await fetch(`${baseUrl}/membership-plans`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.length >= 3);
    assert.ok('price_inr' in body.data[0]);
  });

  // 5. Trainers
  test('GET /trainers returns roster and supports status filter', async () => {
    const res = await fetch(`${baseUrl}/trainers?status=on_floor`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    body.data.forEach((t) => assert.equal(t.status, 'on_floor'));
  });

  // 6. Robot Status
  test('GET /robot/status returns current telemetry and servo positions', async () => {
    const res = await fetch(`${baseUrl}/robot/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok('servos' in body.data);
    assert.ok('headPan' in body.data.servos);
  });

  // 7. POST /robot/commands
  test('POST /robot/commands queues a valid gesture', async () => {
    const res = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gesture: 'GREET_WAVE' }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.command.gesture, 'GREET_WAVE');
  });

  test('POST /robot/commands validates angle boundaries', async () => {
    const res = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headPan: 300 }), // Invalid > 180
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.includes('180'));
  });

  // 8. Device-Specific ESP32 Authentication on /robot/commands/next
  test('GET /robot/commands/next rejects requests without device headers (401)', async () => {
    const res = await fetch(`${baseUrl}/robot/commands/next`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.includes('Missing required device authentication'));
  });

  test('GET /robot/commands/next delivers command when device headers match', async () => {
    // Queue command first
    await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gesture: 'NOD_YES' }),
    });

    const res = await fetch(`${baseUrl}/robot/commands/next`, {
      headers: {
        'x-robot-device-id': config.robot.deviceUuid,
        'x-robot-api-key': config.robot.apiKey,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.command);
  });

  // 9. POST /interactions
  test('POST /interactions records speech conversation with validation', async () => {
    const res = await fetch(`${baseUrl}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userQuery: 'Are lockers available?',
        robotResponse: 'Yes, RFID lockers are in both changing rooms.',
        language: 'en-IN',
        latencyMs: 250,
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user_query, 'Are lockers available?');
  });

  // 10. Authentication & Role Authorization
  test('POST /auth/login authenticates admin and issues JWT token', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'AdminPass2026!',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.token);
    assert.equal(body.data.user.role, 'superadmin');
    assert.equal(body.data.user.password_hash, undefined); // Never expose password_hash!
    adminToken = body.data.token;
  });

  test('POST /auth/login rejects wrong credentials', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'WrongPassword!',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  test('GET /auth/me returns user details with valid Bearer token', async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.username, 'admin');
    assert.equal(body.data.password_hash, undefined); // Secret safety check
  });
});

