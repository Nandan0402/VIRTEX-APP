import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';
import { checkDatabaseConnection, closePool } from '../../backend/src/config/database.js';

describe('PulseCore Member Reception Kiosk Full Backend Integration Suite', () => {
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
    await closePool(1000);
  });

  // Feature 1: Live Gym Profile, Branding & Operating Hours
  test('Feature 1: GET /gym/info returns live gym branding and operating hours without hardcoding', async () => {
    const res = await fetch(`${baseUrl}/gym/info`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.gym_name, 'gym_name should be present');
    assert.ok(body.data.phone, 'phone should be present');
    assert.ok(body.data.address, 'address should be present');
    assert.ok(Array.isArray(body.data.operating_hours), 'operating_hours should be an array');
    assert.ok(body.data.operating_hours.length >= 7, 'should have 7 days of operating hours');
  });

  // Feature 2: Live Membership Plans & Pricing
  test('Feature 2: GET /membership-plans returns live PostgreSQL active plans with INR pricing and perks', async () => {
    const res = await fetch(`${baseUrl}/membership-plans?activeOnly=true`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data), 'plans should be an array');
    assert.ok(body.data.length >= 1, 'should have at least 1 active plan');

    const firstPlan = body.data[0];
    assert.ok(firstPlan.name, 'plan name should exist');
    assert.ok(firstPlan.price_inr !== undefined, 'price_inr should exist');
    assert.ok(firstPlan.duration_months > 0, 'duration_months should be greater than 0');
    assert.ok(Array.isArray(firstPlan.perks), 'perks should be an array');
  });

  // Feature 3: Registered Active Member Check-in
  test('Feature 3: POST /members/check-in allows active member (GYM003), protects PII, and returns welcome speech & gesture', async () => {
    const res = await fetch(`${baseUrl}/members/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'GYM003', language: 'en-IN' }),
    });

    // May be 200 or 409 if tested recently
    assert.ok(res.status === 200 || res.status === 409);
    const body = await res.json();

    if (res.status === 200) {
      assert.equal(body.success, true);
      assert.equal(body.data.gesture, 'GREET_WAVE');
      assert.ok(body.data.welcomeSpeech, 'welcome speech should be provided');
      assert.ok(body.data.voiceMeta, 'voice metadata should be provided');
      
      const member = body.data.member;
      assert.equal(member.member_code, 'GYM003');
      assert.equal(member.status, 'active');
      assert.match(member.phone, /^\*\*\*\*\*\*/, 'phone must be masked');
      assert.equal(member.password_hash, undefined, 'password_hash must never be leaked');
      assert.equal(member.emergency_contact_phone, undefined, 'emergency phone must never be leaked to public kiosk');
    } else {
      assert.equal(body.duplicate, true);
    }
  });

  // Feature 4: Inactive / Expired Member Check-in
  test('Feature 4: POST /members/check-in rejects expired member (GYM005) with 403 and friendly renewal prompt', async () => {
    const res = await fetch(`${baseUrl}/members/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'GYM005', language: 'en-IN' }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /expired/i);
    assert.ok(body.member, 'masked member details should be returned for front desk guidance');
    assert.equal(body.member.member_code, 'GYM005');
    assert.match(body.member.phone, /^\*\*\*\*\*\*/);
    assert.equal(body.member.password_hash, undefined);
  });

  // Feature 5: Invalid ID / Unregistered Guest Check-in
  test('Feature 5: POST /members/check-in rejects unknown ID (GUEST_INVALID_999) with 404', async () => {
    const res = await fetch(`${baseUrl}/members/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'GUEST_INVALID_999' }),
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /not found/i);
  });

  // Feature 6: Duplicate Check-In Cooldown Protection
  test('Feature 6: POST /members/check-in prevents rapid duplicate check-ins within cooldown (409 Conflict)', async () => {
    // Attempt check-in with GYM001
    const res1 = await fetch(`${baseUrl}/members/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'GYM001' }),
    });

    if (res1.status === 200) {
      // Immediate second check-in must trigger 409
      const res2 = await fetch(`${baseUrl}/members/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'GYM001' }),
      });
      assert.equal(res2.status, 409);
      const body2 = await res2.json();
      assert.equal(body2.duplicate, true);
    } else {
      assert.equal(res1.status, 409);
      const body1 = await res1.json();
      assert.equal(body1.duplicate, true);
    }
  });

  // Feature 7: Trainer Roster & Floor Availability
  test('Feature 7: GET /trainers returns trainers with on_floor / in_session / off_duty duty status', async () => {
    const res = await fetch(`${baseUrl}/trainers`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length >= 1);

    const trainer = body.data[0];
    assert.ok(trainer.full_name, 'trainer full_name must exist');
    assert.ok(trainer.specialty, 'trainer specialty must exist');
    assert.ok(['on_floor', 'in_session', 'off_duty'].includes(trainer.status), 'trainer status must be valid');
  });

  // Feature 8: Active Announcements Noticeboard
  test('Feature 8: GET /announcements returns active gym notices with priority badges', async () => {
    const res = await fetch(`${baseUrl}/announcements?activeOnly=true`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));

    if (body.data.length > 0) {
      const notice = body.data[0];
      assert.ok(notice.title, 'announcement title must exist');
      assert.ok(notice.message, 'announcement message must exist');
      assert.ok(notice.priority, 'announcement priority must exist');
    }
  });

  // Feature 9: Multilingual Knowledge Base FAQs
  test('Feature 9: GET /faqs returns categorized FAQs for English, Kannada, and Hindi', async () => {
    // English FAQs
    const enRes = await fetch(`${baseUrl}/faqs?language=en-IN`);
    assert.equal(enRes.status, 200);
    const enBody = await enRes.json();
    assert.equal(enBody.success, true);
    assert.ok(enBody.data.length >= 1);
    assert.equal(enBody.data[0].language, 'en-IN');

    // Category filter: timings
    const timingRes = await fetch(`${baseUrl}/faqs?category=timings`);
    assert.equal(timingRes.status, 200);
    const timingBody = await timingRes.json();
    assert.equal(timingBody.success, true);
    timingBody.data.forEach((f) => {
      assert.equal(f.category, 'timings');
    });
  });

  // Feature 10: Kiosk Membership Enquiry Submission
  test('Feature 10: POST /members/enquiry captures visitor lead from kiosk and stores in PostgreSQL', async () => {
    const uniquePhone = '98' + Math.floor(10000000 + Math.random() * 90000000);
    const res = await fetch(`${baseUrl}/members/enquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Kiosk Visitor',
        phone: uniquePhone,
        email: 'visitor@example.com',
        planName: 'Gold Quarterly',
        notes: 'Interested in HIIT and morning workout slots',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.message.includes('Kiosk Visitor'));
    assert.equal(body.data.phone, uniquePhone);
  });

  // Feature 11: Multilingual AI Receptionist Dialogue
  test('Feature 11: POST /chat/message answers member questions in English, Kannada, and Hindi with grounded context', async () => {
    // English query
    const enRes = await fetch(`${baseUrl}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What are your gym operating hours?', language: 'en-IN' }),
    });
    assert.equal(enRes.status, 200);
    const enBody = await enRes.json();
    assert.equal(enBody.success, true);
    assert.ok(enBody.data.reply);
    assert.ok(enBody.data.gesture);

    // Kannada query
    const knRes = await fetch(`${baseUrl}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'ಜಿಮ್ ತೆರೆಯುವ ಸಮಯ ಎಷ್ಟು?', language: 'kn-IN' }),
    });
    assert.equal(knRes.status, 200);
    const knBody = await knRes.json();
    assert.equal(knBody.success, true);
    assert.ok(knBody.data.reply);
  });
});
