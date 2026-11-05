import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  query,
  withTransaction,
  checkDatabaseConnection,
  getPoolStats,
  sanitizeLogParams,
  formatDatabaseError,
  closePool,
} from '../../backend/src/config/database.js';
import * as gymRepository from '../../backend/src/repositories/gym.repository.js';
import * as faqRepository from '../../backend/src/repositories/faq.repository.js';
import * as membershipRepository from '../../backend/src/repositories/membership.repository.js';
import * as memberRepository from '../../backend/src/repositories/member.repository.js';
import * as trainerRepository from '../../backend/src/repositories/trainer.repository.js';
import * as userRepository from '../../backend/src/repositories/user.repository.js';
import * as robotRepository from '../../backend/src/repositories/robot.repository.js';
import { registerMemberWithPlan } from '../../backend/src/services/member.service.js';

describe('PulseCore PostgreSQL Database Layer & Repository Suite', () => {
  before(async () => {
    const health = await checkDatabaseConnection();
    assert.equal(health.ok, true, 'Database must be reachable for database layer tests');
  });

  after(async () => {
    await closePool();
  });

  // 1. Connection Pool & Health Check
  test('checkDatabaseConnection returns active pool status, pgVersion and latency', async () => {
    const health = await checkDatabaseConnection();
    assert.equal(health.ok, true);
    assert.ok(typeof health.latencyMs === 'number');
    assert.ok(health.latencyMs >= 0);
    assert.ok(health.pgVersion.includes('PostgreSQL') || /^\d+/.test(health.pgVersion));
    assert.ok('serverTime' in health);
    assert.ok(health.pool.totalCount >= 1);
  });

  test('getPoolStats reports active, idle and waiting client metrics', () => {
    const stats = getPoolStats();
    assert.ok(typeof stats.totalCount === 'number');
    assert.ok(typeof stats.idleCount === 'number');
    assert.ok(typeof stats.waitingCount === 'number');
  });

  // 2. Parameterized SQL & Injection Safety
  test('query safely parameters SQL and prevents SQL injection', async () => {
    // Normal lookup
    const res1 = await query('SELECT id, member_code FROM members WHERE member_code = $1;', ['GYM001']);
    assert.equal(res1.rowCount, 1);
    assert.equal(res1.rows[0].member_code, 'GYM001');

    // Injection attempt must return 0 rows (treated as literal string)
    const res2 = await query('SELECT id, member_code FROM members WHERE member_code = $1;', ["' OR '1'='1"]);
    assert.equal(res2.rowCount, 0);
  });

  // 3. Safe Query Logging & Sensitive Parameter Redaction
  test('sanitizeLogParams redacts passwords, tokens and secrets from logs', () => {
    const sensitiveQuery = 'SELECT id FROM users WHERE password_hash = $1 AND token = $2;';
    const params = ['SecretPassword123!', 'jwt.token.here'];
    const sanitized = sanitizeLogParams(sensitiveQuery, params);

    assert.equal(sanitized[0], '[REDACTED]');
    assert.equal(sanitized[1], '[REDACTED]');

    // Non-sensitive query retains safe parameters
    const safeQuery = 'SELECT id FROM members WHERE member_code = $1;';
    const safeParams = ['GYM001'];
    const safeResult = sanitizeLogParams(safeQuery, safeParams);
    assert.equal(safeResult[0], 'GYM001');
  });

  // 4. Atomic Transactions (Commit and Rollback)
  test('withTransaction commits changes when execution succeeds', async () => {
    const uniquePhone = `99900${Math.floor(10000 + Math.random() * 90000)}`;
    const uniqueCode = `TEST_${Date.now().toString().slice(-6)}`;

    const created = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO members (member_code, full_name, phone, plan_name, status)
         VALUES ($1, $2, $3, 'Test Plan', 'active')
         RETURNING id, member_code, phone;`,
        [uniqueCode, 'Transaction Commit Test', uniquePhone]
      );
      return res.rows[0];
    });

    assert.ok(created.id);

    // Verify persisted
    const verify = await query('SELECT id, member_code FROM members WHERE id = $1;', [created.id]);
    assert.equal(verify.rowCount, 1);

    // Clean up
    await query('DELETE FROM members WHERE id = $1;', [created.id]);
  });

  test('withTransaction automatically rolls back changes when error is thrown', async () => {
    const uniquePhone = `88800${Math.floor(10000 + Math.random() * 90000)}`;
    const uniqueCode = `ROLL_${Date.now().toString().slice(-6)}`;

    let insertedId = null;

    await assert.rejects(async () => {
      await withTransaction(async (client) => {
        const res = await client.query(
          `INSERT INTO members (member_code, full_name, phone, plan_name, status)
           VALUES ($1, $2, $3, 'Rollback Plan', 'active')
           RETURNING id;`,
          [uniqueCode, 'Rollback Test User', uniquePhone]
        );
        insertedId = res.rows[0].id;

        // Force intentional error inside transaction block
        throw new Error('INTENTIONAL_TRANSACTION_FAILURE');
      });
    }, /INTENTIONAL_TRANSACTION_FAILURE/);

    // Verify row was NOT committed
    if (insertedId) {
      const verify = await query('SELECT id FROM members WHERE id = $1;', [insertedId]);
      assert.equal(verify.rowCount, 0, 'Row should have been rolled back');
    }
  });

  // 5. Standardized Error Formatting
  test('formatDatabaseError standardizes PostgreSQL error codes', () => {
    const uniqueErr = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const formatted1 = formatDatabaseError(uniqueErr);
    assert.equal(formatted1.statusCode, 409);
    assert.equal(formatted1.code, 'DUPLICATE_ENTRY');

    const fkErr = { code: '23503', message: 'foreign key violation' };
    const formatted2 = formatDatabaseError(fkErr);
    assert.equal(formatted2.statusCode, 400);
    assert.equal(formatted2.code, 'FOREIGN_KEY_VIOLATION');

    const checkErr = { code: '23514', message: 'check constraint violation' };
    const formatted3 = formatDatabaseError(checkErr);
    assert.equal(formatted3.statusCode, 400);
    assert.equal(formatted3.code, 'CHECK_VIOLATION');

    const connErr = { code: '08006', message: 'connection failure' };
    const formatted4 = formatDatabaseError(connErr);
    assert.equal(formatted4.statusCode, 503);
    assert.equal(formatted4.code, 'DATABASE_UNAVAILABLE');
  });

  // 6. Repository Modules Functional Verification
  test('gymRepository retrieves gym singleton profile', async () => {
    const settings = await gymRepository.getGymSettings();
    assert.ok(settings);
    assert.equal(settings.gym_name, 'PulseCore Fitness');
    assert.ok(Array.isArray(settings.supported_languages));
  });

  test('faqRepository retrieves active FAQs and supports language filtering', async () => {
    const faqs = await faqRepository.findFaqs({ language: 'en-IN' });
    assert.ok(Array.isArray(faqs));
    assert.ok(faqs.length > 0);
    faqs.forEach((f) => assert.equal(f.language, 'en-IN'));
  });

  test('membershipRepository retrieves membership tiers ordered by price', async () => {
    const plans = await membershipRepository.findPlans();
    assert.ok(plans.length >= 3);
    for (let i = 1; i < plans.length; i++) {
      assert.ok(Number(plans[i].price_inr) >= Number(plans[i - 1].price_inr));
    }
  });

  test('memberRepository finds member by code and phone identifier', async () => {
    const mByCode = await memberRepository.findByIdentifier('GYM001');
    assert.ok(mByCode);
    assert.equal(mByCode.full_name, 'Rahul Sharma');

    const mByPhone = await memberRepository.findByIdentifier(mByCode.phone);
    assert.ok(mByPhone);
    assert.equal(mByPhone.id, mByCode.id);
  });

  test('trainerRepository retrieves active roster with current shift times', async () => {
    const trainers = await trainerRepository.findTrainers();
    assert.ok(trainers.length >= 3);
    assert.ok(trainers[0].full_name);
  });

  test('userRepository finds user by username or email for auth', async () => {
    const user = await userRepository.findByUsernameOrEmail('admin');
    assert.ok(user);
    assert.equal(user.username, 'admin');
    assert.ok(user.password_hash);
  });

  test('robotRepository queues command and retrieves registered device', async () => {
    const device = await robotRepository.findDeviceByUuid('ESP32_RECEPTION_01');
    assert.ok(device);
    assert.equal(device.device_uuid, 'ESP32_RECEPTION_01');

    const queued = await robotRepository.queueCommand({
      deviceId: device.id,
      commandType: 'GESTURE',
      gestureName: 'WAVE',
      servoPayload: [{ headPan: 90, headTilt: 90, armWave: 120 }],
      triggeredBy: 'test_suite',
    });
    assert.ok(queued.id);
  });

  // 7. High-level Transactional Service Operation
  test('registerMemberWithPlan atomically creates member and active membership', async () => {
    const randomCode = `NEW_${Date.now().toString().slice(-5)}`;
    const randomPhone = `97700${Math.floor(10000 + Math.random() * 90000)}`;

    const result = await registerMemberWithPlan({
      memberData: {
        memberCode: randomCode,
        fullName: 'New Athlete',
        phone: randomPhone,
        email: `${randomCode.toLowerCase()}@test.com`,
      },
      planId: 1, // Silver Monthly
    });

    assert.ok(result.member.id);
    assert.ok(result.membership.id);
    assert.equal(result.membership.member_id, result.member.id);
    assert.equal(result.membership.plan_id, 1);

    // Clean up created test data
    await query('DELETE FROM memberships WHERE id = $1;', [result.membership.id]);
    await query('DELETE FROM members WHERE id = $1;', [result.member.id]);
  });
});
