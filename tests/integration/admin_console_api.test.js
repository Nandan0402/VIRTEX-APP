import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';
import { checkDatabaseConnection, closePool } from '../../backend/src/config/database.js';

describe('Virtex Admin Console API Integration Suite (10 Modules)', () => {
  let server;
  let baseUrl;
  let ownerToken;
  let managerToken;
  let trainerToken;

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

    // 1. Authenticate Owner
    const ownerRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner_manju', password: 'OwnerPass2026!' }),
    });
    const ownerBody = await ownerRes.json();
    assert.equal(ownerRes.status, 200);
    ownerToken = ownerBody.data.token;

    // 2. Authenticate Manager
    const mgrRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'manager_priya', password: 'ManagerPass2026!' }),
    });
    const mgrBody = await mgrRes.json();
    assert.equal(mgrRes.status, 200);
    managerToken = mgrBody.data.token;

    // 3. Authenticate Trainer
    const trnRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'head_trainer', password: 'TrainerPass2026!' }),
    });
    const trnBody = await trnRes.json();
    assert.equal(trnRes.status, 200);
    trainerToken = trnBody.data.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePool();
  });

  // --- Module 1: Gym Profile / Hours ---
  test('Module 1: GET /gym/info returns profile and PUT /admin/settings updates profile', async () => {
    const getRes = await fetch(`${baseUrl}/gym/info`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.success, true);
    assert.ok(getBody.data.gym_name || getBody.data.name);

    // Update settings as Owner
    const putRes = await fetch(`${baseUrl}/admin/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        tagline: 'AI-Powered Smart Fitness Reception (Verified)',
        speechRate: 1.05,
      }),
    });
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.equal(putBody.success, true);
  });

  // --- Module 2: Membership Plans CRUD ---
  test('Module 2: Membership Plans full CRUD lifecycle', async () => {
    // 1. Create plan
    const createRes = await fetch(`${baseUrl}/membership-plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        name: 'Test Weekend Pass',
        priceInr: 1499,
        durationMonths: 1,
        badgeLabel: 'Weekend',
        perks: ['Saturday & Sunday Access', 'Locker Room'],
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    assert.equal(createBody.success, true);
    const planId = createBody.data.id;
    assert.ok(planId);

    // 2. Toggle plan status
    const toggleRes = await fetch(`${baseUrl}/membership-plans/${planId}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(toggleRes.status, 200);
    const toggleBody = await toggleRes.json();
    assert.equal(toggleBody.success, true);

    // 3. Update plan
    const updateRes = await fetch(`${baseUrl}/membership-plans/${planId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        name: 'Test Weekend Pass (Updated)',
        priceInr: 1699,
      }),
    });
    assert.equal(updateRes.status, 200);

    // 4. Delete plan
    const delRes = await fetch(`${baseUrl}/membership-plans/${planId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(delRes.status, 200);
  });

  // --- Module 3: Members Directory (CRUD, Search, Filter, Pagination) ---
  test('Module 3: Members Directory list, pagination, search, and CRUD', async () => {
    // 1. List members with pagination
    const listRes = await fetch(`${baseUrl}/members?page=1&limit=5&status=all`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.success, true);
    assert.ok(Array.isArray(listBody.data));
    assert.ok(listBody.pagination);
    assert.equal(listBody.pagination.page, 1);

    // 2. Register a new member
    const createRes = await fetch(`${baseUrl}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        fullName: 'Test Candidate Member',
        phone: '9988776655',
        email: 'test.candidate@example.com',
        preferredLanguage: 'kn-IN',
        status: 'active',
        notes: 'Integration test sample record',
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    assert.equal(createBody.success, true);
    const memberId = createBody.data.id;
    assert.ok(memberId);

    // 3. Search for the created member
    const searchRes = await fetch(`${baseUrl}/members?search=Candidate`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(searchRes.status, 200);
    const searchBody = await searchRes.json();
    assert.ok(searchBody.data.length >= 1);
    assert.equal(searchBody.data[0].id, memberId);

    // 4. Update member status to frozen
    const updateRes = await fetch(`${baseUrl}/members/${memberId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ status: 'frozen' }),
    });
    assert.equal(updateRes.status, 200);

    // 5. Delete test member
    const delRes = await fetch(`${baseUrl}/members/${memberId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(delRes.status, 200);
  });

  // --- Module 4 & 5: Trainers Roster & Availability ---
  test('Module 4 & 5: Trainer profiles and On Floor/In Session/Off Duty status updates', async () => {
    // 1. Create a sample trainer
    const dynamicPhone = '98' + Math.floor(10000000 + Math.random() * 90000000);
    const createRes = await fetch(`${baseUrl}/trainers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        name: 'Test Coach Rajesh',
        specialty: 'Kettlebell & Conditioning',
        phone: dynamicPhone,
        email: `rajesh_${Date.now()}@example.com`,
        status: 'on_floor',
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    const trainerId = createBody.data.id;
    assert.ok(trainerId);

    // 2. Change status to in_session
    const statusRes1 = await fetch(`${baseUrl}/trainers/${trainerId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ status: 'in_session' }),
    });
    assert.equal(statusRes1.status, 200);
    const body1 = await statusRes1.json();
    assert.equal(body1.data.status, 'in_session');

    // 3. Change status to off_duty
    const statusRes2 = await fetch(`${baseUrl}/trainers/${trainerId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ status: 'off_duty' }),
    });
    assert.equal(statusRes2.status, 200);
    const body2 = await statusRes2.json();
    assert.equal(body2.data.status, 'off_duty');

    // 4. Delete sample trainer
    const delRes = await fetch(`${baseUrl}/trainers/${trainerId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(delRes.status, 200);
  });

  // --- Module 6: Announcements Noticeboard CRUD ---
  test('Module 6: Announcements Noticeboard CRUD lifecycle', async () => {
    // 1. Create notice
    const createRes = await fetch(`${baseUrl}/announcements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        title: 'Test Power Outage Maintenance',
        message: 'Scheduled grid inspection this Sunday from 2 AM to 4 AM.',
        priority: 'maintenance',
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    const annId = createBody.data.id;
    assert.ok(annId);

    // 2. Fetch notices
    const listRes = await fetch(`${baseUrl}/announcements`);
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.ok(listBody.data.some((a) => a.id === annId));

    // 3. Update notice
    const updateRes = await fetch(`${baseUrl}/announcements/${annId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ title: 'Test Power Outage (Rescheduled)' }),
    });
    assert.equal(updateRes.status, 200);

    // 4. Delete notice
    const delRes = await fetch(`${baseUrl}/announcements/${annId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(delRes.status, 200);
  });

  // --- Module 7: FAQ Management CRUD ---
  test('Module 7: Knowledge Base FAQ management CRUD', async () => {
    // 1. Create FAQ
    const createRes = await fetch(`${baseUrl}/faqs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({
        question: 'Are showers and towels complimentary?',
        answer: 'Yes, fresh laundered towels and hot showers are included in all memberships.',
        language: 'en-IN',
        category: 'facilities',
        gesture: 'NOD_YES',
        keywords: ['shower', 'towel'],
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    const faqId = createBody.data.id;
    assert.ok(faqId);

    // 2. Fetch FAQs with search
    const listRes = await fetch(`${baseUrl}/faqs?q=towels`);
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.ok(listBody.data.some((f) => f.id === faqId));

    // 3. Delete FAQ
    const delRes = await fetch(`${baseUrl}/faqs/${faqId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(delRes.status, 200);
  });

  // --- Module 8: Enquiries / Kiosk Leads ---
  test('Module 8: Enquiries list and status update workflow', async () => {
    // 1. Fetch enquiries
    const listRes = await fetch(`${baseUrl}/admin/enquiries?limit=10`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.ok(Array.isArray(listBody.data));

    if (listBody.data.length > 0) {
      const firstId = listBody.data[0].id;
      // 2. Update status to contacted
      const patchRes = await fetch(`${baseUrl}/admin/enquiries/${firstId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({ status: 'contacted', notes: 'Contacted via telephone by Manager Priya' }),
      });
      assert.equal(patchRes.status, 200);
      const patchBody = await patchRes.json();
      assert.equal(patchBody.data.status, 'contacted');
    }
  });

  // --- Module 9: Interaction Logs Audit Feed ---
  test('Module 9: GET /interactions returns speech and audit logs', async () => {
    const res = await fetch(`${baseUrl}/interactions?limit=10`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
  });

  // --- Module 10: Robot Motor Control & Diagnostics Logs ---
  test('Module 10: Robot motor control, direct servos, and hardware logs', async () => {
    // 1. Check status
    const statusRes = await fetch(`${baseUrl}/robot/status`);
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.ok(statusBody.data);

    // 2. Queue a gesture command
    const cmdRes = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandType: 'GESTURE',
        gestureName: 'NOD_YES',
        priority: 1,
        triggeredBy: 'admin_test',
      }),
    });
    assert.equal(cmdRes.status, 201);
    const cmdBody = await cmdRes.json();
    assert.equal(cmdBody.success, true);

    // 3. Queue direct servo angles
    const servoRes = await fetch(`${baseUrl}/robot/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandType: 'DIRECT_ANGLES',
        servoPayload: { headPan: 110, headTilt: 85, armWave: 45 },
        priority: 2,
        triggeredBy: 'admin_test',
      }),
    });
    assert.equal(servoRes.status, 201);

    // 4. Retrieve hardware diagnostic logs
    const logsRes = await fetch(`${baseUrl}/robot/logs?limit=5`);
    assert.equal(logsRes.status, 200);
    const logsBody = await logsRes.json();
    assert.equal(logsBody.success, true);
    assert.ok(Array.isArray(logsBody.data));
    assert.ok(logsBody.data.length >= 1);
  });
});
