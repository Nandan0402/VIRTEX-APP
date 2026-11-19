import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';
import { checkDatabaseConnection, closePool, query } from '../../backend/src/config/database.js';

describe('Virtex Authentication & RBAC Test Suite', () => {
  let server;
  let baseUrl;

  let ownerToken;
  let managerToken;
  let trainerToken;
  let memberToken;
  let legacyAdminToken;

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
    try {
      await query("DELETE FROM users WHERE username LIKE 'mem_user_%' OR username LIKE 'coach_%' OR username LIKE 'admin_exec_%';");
      await query("DELETE FROM trainers WHERE full_name ~ '[0-9]{4,}' OR email LIKE 'coach_%@%' OR trainer_code ~ 'TRN[0-9]{4,}';");
      await query("DELETE FROM members WHERE full_name LIKE 'Test Member %' OR email LIKE 'member_%@example.com';");
    } catch (err) {
      console.error('Teardown cleanup error:', err);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePool();
  });

  // --------------------------------------------------------------------------
  // 1. Authentication & Token Generation across all Roles
  // --------------------------------------------------------------------------
  test('POST /auth/login authenticates Owner role and issues JWT', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner_manju', password: 'OwnerPass2026!' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'owner');
    assert.equal(body.data.user.password_hash, undefined, 'Password hash must never be returned');
    assert.ok(body.data.token);
    ownerToken = body.data.token;
  });

  test('POST /auth/login authenticates Manager role', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'manager_priya', password: 'ManagerPass2026!' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'manager');
    managerToken = body.data.token;
  });

  test('POST /auth/login authenticates Trainer role with linked trainerId', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'head_trainer', password: 'TrainerPass2026!' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'trainer');
    assert.ok(body.data.user.trainerId);
    trainerToken = body.data.token;
  });

  test('POST /auth/login authenticates Member role with linked memberId', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'member_rahul', password: 'MemberPass2026!' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'member');
    assert.ok(body.data.user.memberId);
    memberToken = body.data.token;
  });

  test('POST /auth/login preserves backward-compatible superadmin admin account', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'AdminPass2026!' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'superadmin');
    legacyAdminToken = body.data.token;
  });

  test('POST /auth/login rejects wrong credentials with 401', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner_manju', password: 'InvalidPassword999!' }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /invalid username or password/i);
  });

  // --------------------------------------------------------------------------
  // 2. Server-Side Protection of Admin Operations Dashboard
  // --------------------------------------------------------------------------
  test('GET /admin/dashboard rejects unauthenticated guest (401)', async () => {
    const res = await fetch(`${baseUrl}/admin/dashboard`);
    assert.equal(res.status, 401);
  });

  test('GET /admin/dashboard allows Owner', async () => {
    const res = await fetch(`${baseUrl}/admin/dashboard`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok('totalMembers' in body.data);
  });

  test('GET /admin/dashboard allows backward-compatible superadmin', async () => {
    const res = await fetch(`${baseUrl}/admin/dashboard`, {
      headers: { Authorization: `Bearer ${legacyAdminToken}` },
    });
    assert.equal(res.status, 200);
  });

  test('GET /admin/dashboard allows Manager', async () => {
    const res = await fetch(`${baseUrl}/admin/dashboard`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(res.status, 200);
  });

  test('GET /admin/dashboard rejects Trainer (403)', async () => {
    const res = await fetch(`${baseUrl}/admin/dashboard`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /Access Denied/i);
  });

  test('GET /admin/dashboard rejects Member (403)', async () => {
    const res = await fetch(`${baseUrl}/admin/dashboard`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
  });

  // --------------------------------------------------------------------------
  // 3. Separation of Duties: Owner vs Manager
  // --------------------------------------------------------------------------
  test('GET /admin/users allows Owner to list staff accounts', async () => {
    const res = await fetch(`${baseUrl}/admin/users`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
  });

  test('GET /admin/users rejects Manager (403 - Only Owner can manage staff)', async () => {
    const res = await fetch(`${baseUrl}/admin/users`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('GET /admin/audit-logs allows Owner and rejects Manager', async () => {
    // Owner permitted
    const resOwner = await fetch(`${baseUrl}/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(resOwner.status, 200);
    const bodyOwner = await resOwner.json();
    assert.ok(Array.isArray(bodyOwner.data));

    // Manager denied
    const resMgr = await fetch(`${baseUrl}/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(resMgr.status, 403);
  });

  // --------------------------------------------------------------------------
  // 4. Resource-Level Authorization: Trainer and Member Ownership
  // --------------------------------------------------------------------------
  test('PATCH /trainers/:id/status allows Trainer to update OWN status', async () => {
    // Trainer Arjun has trainerId = 1
    const res = await fetch(`${baseUrl}/trainers/1/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({ status: 'in_session' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'in_session');
  });

  test('PATCH /trainers/:id/status forbids Trainer from updating ANOTHER trainer (403)', async () => {
    // Trainer Arjun attempts to update Trainer 2 (Meera)
    const res = await fetch(`${baseUrl}/trainers/2/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({ status: 'off_duty' }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /only access your own trainer/i);
  });

  test('PATCH /trainers/:id/status allows Manager to update ANY trainer', async () => {
    const res = await fetch(`${baseUrl}/trainers/2/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ status: 'on_floor' }),
    });

    assert.equal(res.status, 200);
  });

  test('GET /members/history/:id allows Member to view OWN history', async () => {
    // Member Rahul has memberId = 1
    const res = await fetch(`${baseUrl}/members/history/1`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.member);
  });

  test('GET /members/history/:id forbids Member from viewing ANOTHER member (403)', async () => {
    // Member Rahul attempts to access member 2 (Priya Patel)
    const res = await fetch(`${baseUrl}/members/history/2`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /only access your own member/i);
  });

  // --------------------------------------------------------------------------
  // 5. Token Revocation / Blacklist on Logout
  // --------------------------------------------------------------------------
  test('POST /auth/logout revokes JWT token and rejects subsequent requests', async () => {
    // 1. Authenticate temporary session
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'head_trainer', password: 'TrainerPass2026!' }),
    });
    const tempToken = (await loginRes.json()).data.token;

    // 2. Token is initially valid
    const me1 = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${tempToken}` },
    });
    assert.equal(me1.status, 200);

    // 3. User logs out
    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tempToken}` },
    });
    assert.equal(logoutRes.status, 200);

    // 4. Subsequent requests using revoked token MUST be rejected with 403
    const me2 = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${tempToken}` },
    });
    assert.equal(me2.status, 403);
    const me2Body = await me2.json();
    assert.match(me2Body.error, /revoked or logged out/i);
  });

  // --------------------------------------------------------------------------
  // 6. Tri-Role Self-Service Registration (Member, Trainer, Admin)
  // --------------------------------------------------------------------------
  test('POST /auth/register registers new Member, inserts member record, and returns JWT', async () => {
    const uniqueSuffix = Date.now().toString().slice(-5);
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'member',
        fullName: `Test Member ${uniqueSuffix}`,
        username: `mem_user_${uniqueSuffix}`,
        email: `member_${uniqueSuffix}@example.com`,
        phone: `+91 98450${uniqueSuffix}`,
        planId: 2,
        preferredLanguage: 'kn-IN',
        emergencyContactName: 'Test Emergency Contact',
        emergencyContactPhone: '+91 9900011223',
        password: 'MemberPass2026!',
      }),
    });

    assert.equal(regRes.status, 201);
    const body = await regRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'member');
    assert.ok(body.data.user.memberId, 'Must link to a new member record');
    assert.ok(body.data.token, 'Must return signed JWT token');

    // Verify member can immediately log in with their phone number
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `+91 98450${uniqueSuffix}`, password: 'MemberPass2026!' }),
    });
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.data.user.username, `mem_user_${uniqueSuffix}`);
  });

  test('POST /auth/register registers new Personal Trainer and populates floor shifts', async () => {
    const uniqueSuffix = Date.now().toString().slice(-5);
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'trainer',
        fullName: `Coach Arjun ${uniqueSuffix}`,
        username: `coach_${uniqueSuffix}`,
        email: `coach_${uniqueSuffix}@virtexfitness.in`,
        phone: `+91 99112${uniqueSuffix}`,
        specialty: 'CrossFit & Functional Fitness',
        certifications: 'ACE-CPT, CSCS',
        bio: 'Functional strength specialist.',
        password: 'TrainerPass2026!',
      }),
    });

    assert.equal(regRes.status, 201);
    const body = await regRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'trainer');
    assert.ok(body.data.user.trainerId, 'Must link to a new trainer record');
    assert.ok(body.data.token, 'Must return signed JWT token');
  });

  test('POST /auth/register provisions Admin with Owner role using valid secret invite key', async () => {
    const uniqueSuffix = Date.now().toString().slice(-5);
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'admin',
        fullName: `Executive Director ${uniqueSuffix}`,
        username: `admin_exec_${uniqueSuffix}`,
        email: `exec_${uniqueSuffix}@virtexfitness.in`,
        adminSecretKey: 'VIRTEX_ADMIN_2026',
        password: 'AdminPass2026!',
      }),
    });

    assert.equal(regRes.status, 201);
    const body = await regRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'owner');
    assert.deepEqual(body.data.user.permissions, ['*']);
    assert.ok(body.data.token);
  });

  test('POST /auth/register rejects Admin registration with invalid security key', async () => {
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'admin',
        fullName: 'Unauthorized Admin',
        username: 'intruder_admin',
        email: 'intruder@example.com',
        adminSecretKey: 'WRONG_SECRET_KEY_999',
        password: 'AdminPass2026!',
      }),
    });

    assert.equal(regRes.status, 400);
    const body = await regRes.json();
    assert.equal(body.success, false);
    assert.match(body.error, /secret invite key/i);
  });

  // --------------------------------------------------------------------------
  // 7. Public Guest Access Unaffected
  // --------------------------------------------------------------------------
  test('Guests can access public knowledge base and gym profile without token', async () => {
    const gymRes = await fetch(`${baseUrl}/gym/info`);
    assert.equal(gymRes.status, 200);

    const faqRes = await fetch(`${baseUrl}/faqs`);
    assert.equal(faqRes.status, 200);

    const plansRes = await fetch(`${baseUrl}/membership-plans`);
    assert.equal(plansRes.status, 200);
  });
});

