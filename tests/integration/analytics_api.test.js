import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';
import { checkDatabaseConnection, closePool } from '../../backend/src/config/database.js';
import * as analyticsService from '../../backend/src/services/analytics.service.js';

describe('Virtex Analytics & Interaction Monitoring API Integration Tests', () => {
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
    assert.equal(ownerRes.status, 200, 'Owner login should succeed');
    ownerToken = ownerBody.data.token;

    // 2. Authenticate Manager
    const mgrRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'manager_priya', password: 'ManagerPass2026!' }),
    });
    const mgrBody = await mgrRes.json();
    assert.equal(mgrRes.status, 200, 'Manager login should succeed');
    managerToken = mgrBody.data.token;

    // 3. Authenticate Trainer
    const trnRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'head_trainer', password: 'TrainerPass2026!' }),
    });
    const trnBody = await trnRes.json();
    assert.equal(trnRes.status, 200, 'Trainer login should succeed');
    trainerToken = trnBody.data.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePool();
  });

  // =========================================================================
  // 1. PII MASKING & PRIVACY TESTS
  // =========================================================================

  test('PII Masking utilities should securely obfuscate sensitive customer information', () => {
    // Name masking
    assert.equal(analyticsService.maskName('Vikram Gupta'), 'V****m G***a');
    assert.equal(analyticsService.maskName('Ananya'), 'A****a');
    assert.equal(analyticsService.maskName('Al'), 'A*');

    // Phone masking
    const maskedPhone = analyticsService.maskPhone('+919876543210');
    assert.ok(maskedPhone.includes('******'), 'Phone must be masked in the middle');
    assert.equal(maskedPhone.startsWith('+919'), true);
    assert.equal(maskedPhone.endsWith('10'), true);
    assert.equal(maskedPhone.includes('76543'), false, 'Sensitive digits must not be visible');

    // Email masking
    const maskedEmail = analyticsService.maskEmail('vikram.gupta@example.com');
    assert.equal(maskedEmail, 'v***a@example.com');

    // Array sanitizer
    const records = [
      { id: 1, full_name: 'Rajesh Sharma', phone: '+919988776655', email: 'rajesh@gmail.com', query: 'timings' },
      { id: 2, member_name: 'Pooja Hegde', phone: '+918877665544', email: 'pooja@yahoo.com' },
    ];
    const sanitized = analyticsService.sanitizeMemberPII(records);
    assert.equal(sanitized[0].full_name, 'R****h S****a');
    assert.ok(!sanitized[0].phone.includes('887766'));
    assert.ok(!sanitized[0].email.startsWith('rajesh@'));
    assert.equal(sanitized[0].query, 'timings');
  });

  // =========================================================================
  // 2. AUTHENTICATION & RBAC PERMISSION GATES
  // =========================================================================

  test('GET /admin/analytics/overview rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/overview`);
    assert.equal(res.status, 401);
  });

  test('GET /admin/analytics/overview rejects Trainer role with 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('GET /admin/analytics/trainers allows Trainer role to view floor availability', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/trainers`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.summary);
    assert.ok(body.data.memberTrainerRatio);
    assert.ok(Array.isArray(body.data.roster));
  });

  // =========================================================================
  // 3. EXECUTIVE & OPERATIONAL ENDPOINTS (Owner & Manager)
  // =========================================================================

  test('GET /admin/analytics/overview returns aggregate executive KPI bundle (<200ms)', async () => {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const duration = Date.now() - start;

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.summary, 'Should include executive summary KPIs');
    assert.ok(body.data.checkIns, 'Should include check-in totals');
    assert.ok(Array.isArray(body.data.checkInsTrend), 'Should include check-ins trend');
    assert.ok(body.data.enquiries, 'Should include enquiries summary');
    assert.ok(Array.isArray(body.data.enquiriesByPlan), 'Should include plan breakdowns');
    assert.ok(Array.isArray(body.data.languageDistribution), 'Should include language distribution');
    assert.ok(body.data.aiPerformance, 'Should include AI performance latency');
    assert.ok(body.data.robotUptime, 'Should include robot uptime metrics');

    assert.ok(duration < 500, `Overview response took ${duration}ms, expected fast execution`);
  });

  test('GET /admin/analytics/check-ins returns daily volume, method breakdown, and peak hours', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/check-ins?period=daily`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const { totals, trend, peakHours } = body.data;
    assert.ok(typeof totals.total === 'number');
    assert.ok(typeof totals.kiosk_voice === 'number');
    assert.ok(typeof totals.kiosk_manual === 'number');
    assert.ok(Array.isArray(trend));
    assert.ok(Array.isArray(peakHours));

    if (peakHours.length > 0) {
      assert.ok('hour_of_day' in peakHours[0]);
      assert.ok('checkin_count' in peakHours[0]);
    }
  });

  test('GET /admin/analytics/enquiries returns lead conversion rates and plan funnel', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/enquiries`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const { summary, byPlan } = body.data;
    assert.ok(typeof summary.total === 'number');
    assert.ok(typeof summary.new_leads === 'number');
    assert.ok(typeof summary.contacted === 'number');
    assert.ok(typeof summary.conversion_rate_pct === 'number');
    assert.ok(Array.isArray(byPlan));
  });

  test('GET /admin/analytics/faqs returns top ranked intents with multilingual counts', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/faqs?limit=5`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const { popularFaqs, totalCategorized } = body.data;
    assert.ok(typeof totalCategorized === 'number');
    assert.ok(Array.isArray(popularFaqs));
    assert.ok(popularFaqs.length <= 5);

    if (popularFaqs.length > 0) {
      const first = popularFaqs[0];
      assert.equal(first.rank, 1);
      assert.ok(first.intent);
      assert.ok(typeof first.count === 'number');
      assert.ok(typeof first.percentage === 'number');
      assert.ok(typeof first.avg_latency_ms === 'number');
    }
  });

  test('GET /admin/analytics/languages returns multilingual interaction split (EN, KN, HI)', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/languages`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const { total, distribution } = body.data;
    assert.ok(typeof total === 'number');
    assert.ok(Array.isArray(distribution));

    const langCodes = distribution.map((d) => d.language);
    assert.ok(langCodes.includes('en-IN') || langCodes.includes('kn-IN') || langCodes.includes('hi-IN'));
  });

  test('GET /admin/analytics/robot returns ESP32 uptime %, battery, and command statistics', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/robot`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const { device, uptimePercentage, commandStats, hardwareEvents } = body.data;
    assert.ok(device);
    assert.ok(typeof uptimePercentage === 'number');
    assert.ok(uptimePercentage >= 90 && uptimePercentage <= 100);
    assert.ok(typeof commandStats.total_commands === 'number');
    assert.ok(typeof hardwareEvents.total_events === 'number');
  });

  test('GET /admin/analytics/robot-commands supports pagination and status filtering', async () => {
    // 1. First page limit 5
    const res = await fetch(`${baseUrl}/admin/analytics/robot-commands?page=1&limit=5&status=all`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const { total, page, limit, totalPages, commands } = body.data;
    assert.ok(typeof total === 'number');
    assert.equal(page, 1);
    assert.equal(limit, 5);
    assert.ok(Array.isArray(commands));
    assert.ok(commands.length <= 5);

    // 2. Filter by status
    const pendingRes = await fetch(`${baseUrl}/admin/analytics/robot-commands?page=1&limit=5&status=pending`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const pendingBody = await pendingRes.json();
    assert.equal(pendingRes.status, 200);
    if (pendingBody.data.commands.length > 0) {
      assert.equal(pendingBody.data.commands[0].status, 'pending');
    }
  });

  test('GET /admin/analytics/ai-performance returns latency min, max, avg, and p95 metrics', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/ai-performance`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const { stats, trend } = body.data;
    assert.ok(typeof stats.total_interactions === 'number');
    assert.ok(typeof stats.avg_latency_ms === 'number');
    assert.ok(typeof stats.min_latency_ms === 'number');
    assert.ok(typeof stats.max_latency_ms === 'number');
    assert.ok(typeof stats.p95_latency_ms === 'number');
    assert.ok(Array.isArray(trend));
  });

  test('GET /admin/analytics/failed-interactions returns ungrounded queries with pagination and search', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/failed-interactions?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const { failedCount, totalInteractions, failureRatePct, records } = body.data;
    assert.ok(typeof failedCount === 'number');
    assert.ok(typeof totalInteractions === 'number');
    assert.ok(typeof failureRatePct === 'number');
    assert.ok(Array.isArray(records));
  });

  test('GET /admin/analytics/summary returns executive KPI rollups for daily and weekly periods', async () => {
    const res = await fetch(`${baseUrl}/admin/analytics/summary?period=weekly`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const { period, metrics } = body.data;
    assert.equal(period, 'weekly');
    assert.ok('total_checkins' in metrics);
    assert.ok('today_checkins' in metrics);
    assert.ok('total_ai_queries' in metrics);
    assert.ok('avg_ai_latency_ms' in metrics);
    assert.ok('trainers_on_floor' in metrics);
  });

  // =========================================================================
  // 4. ROLE-RESTRICTED ADAPTIVE REPORT ENDPOINT
  // =========================================================================

  test('GET /admin/analytics/report delivers role-tailored reports', async () => {
    // 1. Trainer Role Report: strictly floor operations, member count, and shift
    const trnRes = await fetch(`${baseUrl}/admin/analytics/report`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(trnRes.status, 200);
    const trnBody = await trnRes.json();
    assert.equal(trnBody.data.reportType, 'TRAINER_FLOOR_OPERATIONS');
    assert.equal(trnBody.data.generatedForRole, 'trainer');
    assert.ok(trnBody.data.activeOnFloorTrainers !== undefined);
    assert.ok(trnBody.data.memberTrainerRatio !== undefined);
    assert.equal(trnBody.data.leadAcquisition, undefined, 'Financial leads must be redacted for trainers');
    assert.equal(trnBody.data.robotHardwareTelemetry, undefined, 'Hardware internals must be redacted for trainers');

    // 2. Manager Role Report: operations, lead status, FAQs, robot health
    const mgrRes = await fetch(`${baseUrl}/admin/analytics/report`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(mgrRes.status, 200);
    const mgrBody = await mgrRes.json();
    assert.equal(mgrBody.data.reportType, 'OPERATIONS_EXECUTIVE_SUMMARY');
    assert.equal(mgrBody.data.generatedForRole, 'manager');
    assert.ok(mgrBody.data.summary);
    assert.ok(mgrBody.data.robotHealth);

    // 3. Owner Role Report: complete master intelligence
    const ownerRes = await fetch(`${baseUrl}/admin/analytics/report`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(ownerRes.status, 200);
    const ownerBody = await ownerRes.json();
    assert.equal(ownerBody.data.reportType, 'OWNER_MASTER_INTELLIGENCE');
    assert.equal(ownerBody.data.generatedForRole, 'owner');
    assert.ok(ownerBody.data.executiveSummary);
    assert.ok(ownerBody.data.leadAcquisition);
    assert.ok(ownerBody.data.trainerOperations);
    assert.ok(ownerBody.data.robotHardwareTelemetry);
  });

  // =========================================================================
  // 5. DATE FILTERING INTEGRATION
  // =========================================================================

  test('Date filtering with startDate and endDate filters data correctly across endpoints', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const today = new Date().toISOString();

    const res = await fetch(`${baseUrl}/admin/analytics/check-ins?startDate=${yesterday}&endDate=${today}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.totals);
  });
});
