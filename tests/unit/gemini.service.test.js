import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGroundingContext,
  sanitizeMemberContext,
  callGeminiAPI,
  generateReceptionistResponse,
  generateFallbackResponse,
} from '../../backend/src/services/gemini.service.js';
import { config } from '../../backend/src/config/env.js';

describe('Gemini AI Service Unit & Mock-Based Tests', () => {
  let originalFetch;
  let originalApiKey;

  before(() => {
    originalFetch = global.fetch;
    originalApiKey = config.ai.geminiApiKey;
  });

  after(() => {
    global.fetch = originalFetch;
    config.ai.geminiApiKey = originalApiKey;
  });

  // 1. Grounding Context & PII Stripping
  test('buildGroundingContext retrieves authoritative data from PostgreSQL without leaking trainer PII', async () => {
    const context = await buildGroundingContext('en-IN');
    assert.ok(context.includes('PulseCore Fitness'), 'Contains gym name');
    assert.ok(context.includes('Operating Hours'), 'Contains operating hours');
    assert.ok(context.includes('₹2,499') || context.includes('Silver Monthly'), 'Contains membership plan prices');
    assert.ok(context.includes('Arjun Reddy'), 'Contains trainer names');
    
    // Privacy Verification: Personal trainer phone numbers and emails must NOT be in grounding context!
    assert.ok(!context.includes('9876500001'), 'Must not leak trainer phone');
    assert.ok(!context.includes('arjun@pulsecorefitness.in'), 'Must not leak trainer email');
  });

  test('sanitizeMemberContext strips sensitive PII (passwords, phone numbers, payment details)', () => {
    const rawContext = {
      firstName: 'Rahul',
      membershipPlan: 'Gold',
      phoneNumber: '+91 9988776655',
      passwordHash: '$2a$10$supersecret',
      creditCard: '4111-2222-3333-4444',
    };

    const sanitized = sanitizeMemberContext(rawContext);
    assert.equal(sanitized.firstName, 'Rahul');
    assert.equal(sanitized.membershipPlan, 'Gold');
    assert.equal(sanitized.phoneNumber, undefined);
    assert.equal(sanitized.passwordHash, undefined);
    assert.equal(sanitized.creditCard, undefined);
  });

  // 2. Mocking Successful Gemini API Calls
  test('callGeminiAPI parses structured JSON and separates reply and gesture', async () => {
    config.ai.geminiApiKey = 'test_mock_api_key_12345';

    // Mock global.fetch with a valid Gemini structured JSON response
    global.fetch = async (url, options) => {
      assert.ok(url.includes('generateContent'), 'Calls generateContent endpoint');
      assert.ok(url.includes('key=test_mock_api_key_12345'), 'Includes API key in backend query parameter');
      
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.generationConfig.responseMimeType, 'application/json');

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reply: 'We are open Monday to Saturday from 5:30 AM to 10:30 PM.',
                      gesture: 'NOD',
                    }),
                  },
                ],
              },
            },
          ],
        }),
      };
    };

    const result = await callGeminiAPI({
      message: 'What are your gym hours?',
      language: 'en-IN',
      groundingContext: 'Hours: Mon-Sat 5:30 AM - 10:30 PM',
    });

    assert.equal(result.reply, 'We are open Monday to Saturday from 5:30 AM to 10:30 PM.');
    assert.equal(result.gesture, 'NOD_YES');
  });

  // 3. Mocking Gemini Rate Limits (HTTP 429) & Error Handling
  test('callGeminiAPI throws error on rate limits (HTTP 429)', async () => {
    config.ai.geminiApiKey = 'test_mock_api_key_12345';

    global.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => 'Resource has been exhausted (e.g. check quota).',
    });

    await assert.rejects(
      async () => {
        await callGeminiAPI({
          message: 'What are the plans?',
          language: 'en-IN',
          groundingContext: 'Plans info',
        });
      },
      /rate limit exceeded/i
    );
  });

  // 4. Mocking Gemini Timeout Handling
  test('callGeminiAPI aborts and throws on timeout', async () => {
    config.ai.geminiApiKey = 'test_mock_api_key_12345';
    config.ai.timeoutMs = 50; // Set low timeout for test

    global.fetch = async (url, options) => {
      // Simulate delay exceeding timeout
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (options.signal.aborted) {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      }
      return { ok: true, json: async () => ({}) };
    };

    await assert.rejects(
      async () => {
        await callGeminiAPI({
          message: 'Hello',
          language: 'en-IN',
          groundingContext: 'Grounding',
        });
      },
      /timed out/i
    );

    config.ai.timeoutMs = 8000; // Reset
  });

  // 5. Resilient Fallback to Grounded Rules on Gemini Failure
  test('generateReceptionistResponse falls back gracefully to PostgreSQL grounded rules when Gemini fails', async () => {
    config.ai.geminiApiKey = 'test_mock_api_key_12345';

    // Mock fetch to simulate an unexpected server crash (HTTP 503)
    global.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Backend service overloaded',
    });

    const response = await generateReceptionistResponse({
      message: 'What are the gym hours?',
      language: 'en-IN',
    });

    assert.ok(response.reply.includes('5:30 AM to 10:30 PM'), 'Delivers grounded hours even when API is down');
    assert.equal(response.source, 'grounded_rules');
    assert.ok(['NOD', 'NOD_YES'].includes(response.gesture));
  });

  // 6. Anti-Hallucination & Missing Data Directive (Directs to Reception)
  test('generateFallbackResponse directs user to reception for ungrounded/missing questions', () => {
    // English
    const resEn = generateFallbackResponse({ message: 'Can I buy a motorcycle here?', language: 'en-IN' });
    assert.ok(resEn.reply.includes('reception desk staff') || resEn.reply.includes('+91 98765 43210'));
    assert.equal(resEn.gesture, 'IDLE');

    // Kannada
    const resKn = generateFallbackResponse({ message: 'ನೀವು ಕಾರು ಮಾರಾಟ ಮಾಡುತ್ತೀರಾ?', language: 'kn-IN' });
    assert.ok(resKn.reply.includes('ರಿಸೆಪ್ಷನ್') || resKn.reply.includes('+91 98765 43210'));
    assert.equal(resKn.gesture, 'IDLE');

    // Hindi
    const resHi = generateFallbackResponse({ message: 'क्या आप लैपटॉप बेचते हैं?', language: 'hi-IN' });
    assert.ok(resHi.reply.includes('रिसेप्शन') || resHi.reply.includes('+91 98765 43210'));
    assert.equal(resHi.gesture, 'IDLE');
  });

  // 7. Contact Information Queries
  test('generateFallbackResponse provides phone, email, and address for contact queries', () => {
    const res = generateFallbackResponse({ message: 'What is your contact phone and address?', language: 'en-IN' });
    assert.ok(res.reply.includes('+91 98765 43210'));
    assert.ok(res.reply.includes('Indiranagar, Bengaluru'));
    assert.ok(['NOD', 'NOD_YES'].includes(res.gesture));
  });
});

