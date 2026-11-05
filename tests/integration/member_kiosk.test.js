import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';
import { checkDatabaseConnection } from '../../backend/src/config/database.js';

describe('Member Reception Kiosk Integration Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    await checkDatabaseConnection();
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('POST /members/check-in allows valid member and returns welcome speech & gesture', async () => {
    const res = await fetch(`${baseUrl}/members/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'GYM003' }),
    });

    // Could be 200 (first check-in) or 409 (if tested recently within 5m cooldown)
    assert.ok(res.status === 200 || res.status === 409, `Unexpected status ${res.status}`);
    const body = await res.json();
    if (res.status === 200) {
      assert.equal(body.success, true);
      assert.equal(body.data.gesture, 'GREET_WAVE');
      assert.ok(body.data.member.full_name);
      assert.match(body.data.member.phone, /^\*\*\*\*\*\*/); // Masked PII
    } else {
      assert.equal(body.duplicate, true);
    }
  });

  test('POST /members/check-in returns 409 Conflict on duplicate check-in within cooldown', async () => {
    // Member GYM002 or GYM003
    const res = await fetch(`${baseUrl}/members/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'GYM002' }),
    });

    // If GYM002 already checked in, it returns 409 immediately
    if (res.status === 200) {
      // Immediate duplicate
      const dupRes = await fetch(`${baseUrl}/members/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'GYM002' }),
      });
      assert.equal(dupRes.status, 409);
      const dupBody = await dupRes.json();
      assert.equal(dupBody.duplicate, true);
      assert.match(dupBody.error, /already checked in/i);
    } else {
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.duplicate, true);
      assert.match(body.error, /already checked in/i);
    }
  });

  test('POST /members/check-in returns 404 for unknown member code', async () => {
    const res = await fetch(`${baseUrl}/members/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'NONEXISTENT_MEMBER_999' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /not found/i);
  });

  test('POST /members/enquiry captures lead and creates PostgreSQL record', async () => {
    const res = await fetch(`${baseUrl}/members/enquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Anita Rao',
        phone: '9845112233',
        email: 'anita.rao@example.com',
        planName: 'Annual Premium',
        preferredTiming: 'Evening 6 PM',
        notes: 'Cardio & Yoga focus',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.full_name, 'Anita Rao');
    assert.equal(body.data.phone, '9845112233');
    assert.equal(body.data.status, 'new');
  });

  test('POST /members/enquiry validates required fields (400 on missing phone)', async () => {
    const res = await fetch(`${baseUrl}/members/enquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Incomplete Lead',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /phone number/i);
  });

  test('GET /members/enquiries retrieves latest leads list', async () => {
    const res = await fetch(`${baseUrl}/members/enquiries?limit=5`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0);
  });

  test('GET /members/lookup/:identifier returns masked profile for valid member', async () => {
    const res = await fetch(`${baseUrl}/members/lookup/GYM001`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.member_code, 'GYM001');
    assert.match(body.data.phone, /^\*\*\*\*\*\*/);
  });

  test('GET /members/recent-checkins returns list of checkins', async () => {
    const res = await fetch(`${baseUrl}/members/recent-checkins?limit=5`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
  });
});
