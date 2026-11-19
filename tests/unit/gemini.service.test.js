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
    assert.ok(context.includes('Virtex Fitness'), 'Contains gym name');
    assert.ok(context.includes('Operating Hours'), 'Contains operating hours');
    assert.ok(context.includes('₹2,499') || context.includes('Silver Monthly'), 'Contains membership plan prices');
    assert.ok(context.includes('Arjun Reddy'), 'Contains trainer names');
    
    // Privacy Verification: Personal trainer phone numbers and emails must NOT be in grounding context!
    assert.ok(!context.includes('9876500001'), 'Must not leak trainer phone');
    assert.ok(!context.includes('arjun@virtexfitness.in'), 'Must not leak trainer email');
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

  // 8. Grounding Context: Announcements, Facilities, Rules, Enquiries, and Workouts
  test('buildGroundingContext includes active announcements, facilities, rules, enquiries, and workouts', async () => {
    const context = await buildGroundingContext('en-IN');
    assert.ok(context.includes('Active Announcements'), 'Contains announcements header');
    assert.ok(context.includes('Facilities & Amenities'), 'Contains facilities header');
    assert.ok(context.includes('Gym Rules & Floor Etiquette'), 'Contains rules header');
    assert.ok(context.includes('Enquiries & Membership Registration'), 'Contains enquiries header');
    assert.ok(context.includes('Workout & Fitness Guidance'), 'Contains workout guidance header');
    assert.ok(context.includes('Clean indoor athletic shoes'), 'Specifies mandatory shoe policy');
  });

  // 9. Multilingual Fallback: Announcements across English, Kannada, and Hindi
  test('generateFallbackResponse handles announcements across all three languages', () => {
    const en = generateFallbackResponse({ message: 'Are there any announcements or upcoming challenges?', language: 'en-IN' });
    assert.ok(en.reply.includes('Bootcamp') || en.reply.includes('maintenance'), 'English announcement info');
    assert.equal(en.gesture, 'NOD_YES');

    const kn = generateFallbackResponse({ message: 'ಜಿಮ್‌ನಲ್ಲಿ ಯಾವುದೇ ಹೊಸ ಸೂಚನೆ ಅಥವಾ ಕಾರ್ಯಕ್ರಮವಿದೆಯೇ?', language: 'kn-IN' });
    assert.ok(kn.reply.includes('ಬೂಟ್‌ಕ್ಯಾಂಪ್') || kn.reply.includes('ನಿರ್ವಹಣೆ'), 'Kannada announcement info');
    assert.equal(kn.gesture, 'NOD_YES');

    const hi = generateFallbackResponse({ message: 'क्या कोई नया इवेंट या घोषणा है?', language: 'hi-IN' });
    assert.ok(hi.reply.includes('बूटकैंप') || hi.reply.includes('रखरखाव'), 'Hindi announcement info');
    assert.equal(hi.gesture, 'NOD_YES');
  });

  // 10. Multilingual Fallback: Enquiries and Trial Workouts across English, Kannada, and Hindi
  test('generateFallbackResponse handles enquiries and trial memberships in English, Kannada, and Hindi', () => {
    const en = generateFallbackResponse({ message: 'How do I join or get a trial pass?', language: 'en-IN' });
    assert.ok(en.reply.includes('enquiry') || en.reply.includes('trial'), 'English enquiry info');
    assert.equal(en.gesture, 'NOD_YES');

    const kn = generateFallbackResponse({ message: 'ನಾನು ಜಿಮ್‌ಗೆ ಹೇಗೆ ಸೇರಬಹುದು ಅಥವಾ ಟ್ರಯಲ್ ಪಡೆಯುವುದು ಹೇಗೆ?', language: 'kn-IN' });
    assert.ok(kn.reply.includes('ವಿಚಾರಣೆ') || kn.reply.includes('ಟ್ರಯಲ್'), 'Kannada enquiry info');
    assert.equal(kn.gesture, 'NOD_YES');

    const hi = generateFallbackResponse({ message: 'मैं जिम कैसे ज्वाइन कर सकता हूँ या ट्रायल ले सकता हूँ?', language: 'hi-IN' });
    assert.ok(hi.reply.includes('पूछताछ') || hi.reply.includes('ट्रायल'), 'Hindi enquiry info');
    assert.equal(hi.gesture, 'NOD_YES');
  });

  // 11. Multilingual Fallback: Safe Workout Principles across English, Kannada, and Hindi
  test('generateFallbackResponse handles general workout guidance across all three languages', () => {
    const en = generateFallbackResponse({ message: 'What workout routine do you recommend for muscle growth?', language: 'en-IN' });
    assert.ok(en.reply.includes('warm-up') && en.reply.includes('trainers'), 'English workout advice');
    assert.equal(en.gesture, 'NOD_YES');

    const kn = generateFallbackResponse({ message: 'ತೂಕ ಇಳಿಸಲು ಯಾವ ವ್ಯಾಯಾಮ ಮಾಡಬೇಕು?', language: 'kn-IN' });
    assert.ok(kn.reply.includes('ವ್ಯಾಯಾಮ') && kn.reply.includes('ತರಬೇತುದಾರ'), 'Kannada workout advice');
    assert.equal(kn.gesture, 'NOD_YES');

    const hi = generateFallbackResponse({ message: 'कसरत शुरू करने के लिए क्या सलाह है?', language: 'hi-IN' });
    assert.ok(hi.reply.includes('वार्म-अप') && hi.reply.includes('ट्रेनर्स'), 'Hindi workout advice');
    assert.equal(hi.gesture, 'NOD_YES');
  });

  // 12. Multilingual Fallback: Gym Rules and Dress Code across English, Kannada, and Hindi
  test('generateFallbackResponse explains gym rules and shoes/towel etiquette in all three languages', () => {
    const en = generateFallbackResponse({ message: 'What is your dress code and shoe rule?', language: 'en-IN' });
    assert.ok(en.reply.includes('indoor athletic shoes') || en.reply.includes('towels'), 'English rules');
    assert.equal(en.gesture, 'NOD_YES');

    const kn = generateFallbackResponse({ message: 'ಜಿಮ್‌ನ ನಿಯಮಗಳು ಮತ್ತು ಶೂ ಧರಿಸುವ ನೀತಿ ಏನು?', language: 'kn-IN' });
    assert.ok(kn.reply.includes('ಶೂಗಳು') || kn.reply.includes('ಟವೆಲ್'), 'Kannada rules');
    assert.equal(kn.gesture, 'NOD_YES');

    const hi = generateFallbackResponse({ message: 'जिम के क्या नियम हैं और क्या जूते अनिवार्य हैं?', language: 'hi-IN' });
    assert.ok(hi.reply.includes('जूते') || hi.reply.includes('तौलिया'), 'Hindi rules');
    assert.equal(hi.gesture, 'NOD_YES');
  });
});

