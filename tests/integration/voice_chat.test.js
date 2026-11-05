import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';
import { getRecentInteractions } from '../../backend/src/services/interaction.service.js';

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

  // 2. English (en-IN) Common Gym Questions across all approved categories
  test('POST /chat/message handles English common gym questions across all categories', async () => {
    const queries = [
      { q: 'What are your gym operating hours?', expected: '5:30 AM to 10:30 PM' },
      { q: 'What are the membership plans and fees?', expected: 'Monthly at ₹2,499' },
      { q: 'Are personal trainers available on the floor?', expected: 'Certified personal trainers' },
      { q: 'Do you have locker facilities and showers?', expected: 'secure digital lockers' },
      { q: 'Are there any announcements or upcoming challenge events?', expected: 'Bootcamp' },
      { q: 'How can I submit an enquiry or book a trial workout?', expected: 'trial' },
      { q: 'What is your general workout and fitness advice?', expected: 'warm-up' },
      { q: 'What are the gym rules regarding athletic shoes and towels?', expected: 'Clean indoor athletic shoes' },
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

  // 3. Kannada (kn-IN) Common Gym Questions across all approved categories
  test('POST /chat/message handles Kannada gym questions in native script across categories', async () => {
    const queries = [
      { q: 'ಜಿಮ್ ಸಮಯ ಎಷ್ಟು?', expected: '5:30 ರಿಂದ ರಾತ್ರಿ 10:30' },
      { q: 'ಮೆಂಬರ್‌ಶಿಪ್ ಶುಲ್ಕ ಎಷ್ಟು?', expected: '2,499' },
      { q: 'ವೈಯಕ್ತಿಕ ತರಬೇತುದಾರರು ಲಭ್ಯವಿದ್ದಾರೆಯೇ?', expected: 'ತರಬೇತುದಾರರು' },
      { q: 'ಲಾಕರ್ ಮತ್ತು ಶವರ್ ಸೌಲಭ್ಯವಿದೆಯೇ?', expected: 'ಲಾಕರ್‌ಗಳು' },
      { q: 'ಜಿಮ್‌ನಲ್ಲಿ ಯಾವುದೇ ಹೊಸ ಸೂಚನೆ ಅಥವಾ ಬೂಟ್‌ಕ್ಯಾಂಪ್ ಇದೆಯೇ?', expected: 'ಬೂಟ್‌ಕ್ಯಾಂಪ್' },
      { q: 'ನಾನು ಜಿಮ್‌ಗೆ ಹೇಗೆ ಸೇರಬಹುದು ಅಥವಾ ಟ್ರಯಲ್ ಪಡೆಯುವುದು ಹೇಗೆ?', expected: 'ಟ್ರಯಲ್' },
      { q: 'ಸುರಕ್ಷಿತ ವ್ಯಾಯಾಮಕ್ಕಾಗಿ ಏನು ಸಲಹೆ ನೀಡುತ್ತೀರಿ?', expected: 'ವಾರ್ಮ್-ಅಪ್' },
      { q: 'ಜಿಮ್‌ನ ಶೂ ಮತ್ತು ಟವೆಲ್ ನಿಯಮ ಏನು?', expected: 'ಶೂಗಳು' },
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

  // 4. Hindi (hi-IN) Common Gym Questions across all approved categories
  test('POST /chat/message handles Hindi gym questions in Devanagari script across categories', async () => {
    const queries = [
      { q: 'जिम खुलने का समय क्या है?', expected: '5:30 से रात 10:30' },
      { q: 'सदस्यता शुल्क और प्लान क्या हैं?', expected: '2,499' },
      { q: 'क्या पर्सनल ट्रेनर उपलब्ध हैं?', expected: 'ट्रेनर' },
      { q: 'क्या लॉकर और शावर की सुविधा है?', expected: 'लॉकर' },
      { q: 'क्या कोई नया इवेंट या बूटकैंप घोषणा है?', expected: 'बूटकैंप' },
      { q: 'क्या मैं 1-दिन का ट्रायल वर्कआउट ले सकता हूँ?', expected: 'ट्रायल' },
      { q: 'कसरत शुरू करने के लिए क्या सुरक्षित सलाह है?', expected: 'वार्म-अप' },
      { q: 'जिम में जूते और तौलिया के क्या नियम हैं?', expected: 'जूते' },
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

  // 6. Separation of AI Response and Robot Movement Command
  test('POST /chat/message cleanly decouples spoken AI reply from physical robot command', async () => {
    const res = await fetch(`${baseUrl}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello FitBot, welcome me!', language: 'en-IN' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    // Decoupled AI reply for audio TTS
    assert.ok(typeof body.data.reply === 'string' && body.data.reply.length > 5);
    assert.equal(body.data.gesture, 'GREET_WAVE');

    // Decoupled robot command payload for ESP32 servos
    assert.ok(body.data.robotCommand, 'Includes separate robotCommand structure');
    assert.equal(body.data.robotCommand.commandType, 'GESTURE');
    assert.equal(body.data.robotCommand.gestureName, 'GREET_WAVE');
    assert.equal(body.data.robotCommand.status, 'pending');
  });

  // 7. Data Minimization in Interaction Logging
  test('POST /chat/message sanitizes and redacts sensitive PII before persisting interaction logs', async () => {
    const sensitiveQuery = 'Hello! My phone number is 9876543210 and card is 4111-2222-3333-4444, what are the gym hours?';
    
    const res = await fetch(`${baseUrl}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: sensitiveQuery, language: 'en-IN' }),
    });
    assert.equal(res.status, 200);

    // Wait a brief tick for async non-blocking log write
    await new Promise((resolve) => setTimeout(resolve, 80));

    const recentLogs = await getRecentInteractions(10);
    const matchingLog = recentLogs.find((l) => l.user_query.includes('[PHONE_REDACTED]') || l.user_query.includes('[CARD_REDACTED]'));

    assert.ok(matchingLog, 'Found logged interaction with redacted PII');
    assert.ok(!matchingLog.user_query.includes('9876543210'), 'Raw phone number must NOT be in audit log');
    assert.ok(!matchingLog.user_query.includes('4111-2222-3333-4444'), 'Raw credit card must NOT be in audit log');
    assert.ok(matchingLog.user_query.includes('[PHONE_REDACTED]'), 'Phone redacted tag present');
    assert.ok(matchingLog.user_query.includes('[CARD_REDACTED]'), 'Card redacted tag present');
  });

  // 8. Payload validation: Rejects message exceeding 500 characters
  test('POST /chat/message rejects messages exceeding 500 characters (400)', async () => {
    const longMessage = 'A'.repeat(501);
    const res = await fetch(`${baseUrl}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: longMessage, language: 'en-IN' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /exceeds maximum length of 500 characters/i);
  });

  // 9. AI Rate Limiting & Usage Guard: Rejects excessive bursts with HTTP 429
  test('POST /chat/message enforces rate limiting and usage controls under burst requests', async () => {
    // Send rapid requests to exceed the per-minute threshold
    let rateLimited = false;
    for (let i = 0; i < 75; i++) {
      const res = await fetch(`${baseUrl}/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'What are the hours?', language: 'en-IN' }),
      });
      if (res.status === 429) {
        rateLimited = true;
        const body = await res.json();
        assert.equal(body.success, false);
        assert.match(body.error, /rate limit exceeded/i);
        break;
      }
    }
    assert.ok(rateLimited, 'Expected rate limiter to trigger HTTP 429 under rapid query burst');
  });
});
