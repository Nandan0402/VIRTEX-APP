import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';

describe('Multilingual Voice & Chat Knowledge Base Integration Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
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

  // 1. Languages endpoint
  test('GET /chat/languages returns metadata for English, Kannada, and Hindi', async () => {
    const res = await fetch(`${baseUrl}/chat/languages`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const codes = body.data.map((l) => l.code);
    assert.ok(codes.includes('en-IN'), 'Contains English India');
    assert.ok(codes.includes('kn-IN'), 'Contains Kannada');
    assert.ok(codes.includes('hi-IN'), 'Contains Hindi');
  });

  // 2. English (en-IN) Common Gym Questions
  test('POST /chat/message handles English common gym questions', async () => {
    const queries = [
      { q: 'What are your gym operating hours?', expected: '5:30 AM to 10:30 PM' },
      { q: 'What are the membership plans and fees?', expected: 'Monthly at ₹2,499' },
      { q: 'Are personal trainers available on the floor?', expected: 'Certified personal trainers' },
      { q: 'Do you have locker facilities and showers?', expected: 'secure digital lockers' },
    ];

    for (const item of queries) {
      const res = await fetch(`${baseUrl}/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: item.q, language: 'en-IN' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.language, 'en-IN');
      assert.ok(body.data.reply.includes(item.expected), `Expected reply to contain '${item.expected}'`);
      assert.ok(['WAVE', 'GREET_WAVE', 'NOD', 'NOD_YES', 'IDLE', 'RESET_IDLE'].includes(body.data.gesture));
    }
  });

  // 3. Kannada (kn-IN) Common Gym Questions
  test('POST /chat/message handles Kannada common gym questions in native script', async () => {
    const queries = [
      { q: 'ಜಿಮ್ ಸಮಯ ಎಷ್ಟು?', expected: '5:30 ರಿಂದ ರಾತ್ರಿ 10:30' },
      { q: 'ಮೆಂಬರ್‌ಶಿಪ್ ಶುಲ್ಕ ಎಷ್ಟು?', expected: '2,499' },
      { q: 'ವೈಯಕ್ತಿಕ ತರಬೇತುದಾರರು ಲಭ್ಯವಿದ್ದಾರೆಯೇ?', expected: 'ತರಬೇತುದಾರರು' },
      { q: 'ಲಾಕರ್ ಮತ್ತು ಶವರ್ ಸೌಲಭ್ಯವಿದೆಯೇ?', expected: 'ಲಾಕರ್‌ಗಳು' },
    ];

    for (const item of queries) {
      const res = await fetch(`${baseUrl}/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: item.q, language: 'kn-IN' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.language, 'kn-IN');
      assert.ok(body.data.reply.includes(item.expected), `Expected reply to contain '${item.expected}'`);
    }
  });

  // 4. Hindi (hi-IN) Common Gym Questions
  test('POST /chat/message handles Hindi common gym questions in Devanagari script', async () => {
    const queries = [
      { q: 'जिम खुलने का समय क्या है?', expected: '5:30 से रात 10:30' },
      { q: 'सदस्यता शुल्क और प्लान क्या हैं?', expected: '2,499' },
      { q: 'क्या पर्सनल ट्रेनर उपलब्ध हैं?', expected: 'ट्रेनर' },
      { q: 'क्या लॉकर और शावर की सुविधा है?', expected: 'लॉकर' },
    ];

    for (const item of queries) {
      const res = await fetch(`${baseUrl}/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: item.q, language: 'hi-IN' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.language, 'hi-IN');
      assert.ok(body.data.reply.includes(item.expected), `Expected reply to contain '${item.expected}'`);
    }
  });

  // 5. Validation and Edge Cases
  test('POST /chat/message rejects missing or empty text (400)', async () => {
    const res = await fetch(`${baseUrl}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'en-IN' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /Message string is required/);
  });

  test('POST /chat/message handles unknown questions with graceful polite fallback directing to reception', async () => {
    const res = await fetch(`${baseUrl}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Can you fly to Jupiter?', language: 'en-IN' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.reply.includes('reception desk staff') || body.data.reply.includes('+91 98765 43210'));
    assert.equal(body.data.gesture, 'IDLE');
  });
});
