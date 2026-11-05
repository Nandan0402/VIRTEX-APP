import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLanguage,
  getLanguageMetadata,
  getWelcomeMessage,
  SUPPORTED_LANGUAGES,
} from '../../backend/src/services/voice.service.js';

describe('Voice Service Unit Tests', () => {
  test('should normalize supported languages correctly', () => {
    assert.equal(normalizeLanguage('en-IN'), 'en-IN');
    assert.equal(normalizeLanguage('kn-IN'), 'kn-IN');
    assert.equal(normalizeLanguage('hi-IN'), 'hi-IN');
    assert.equal(normalizeLanguage('kannada'), 'kn-IN');
    assert.equal(normalizeLanguage('hindi'), 'hi-IN');
    assert.equal(normalizeLanguage('english'), 'en-IN');
    assert.equal(normalizeLanguage('unknown-code'), 'en-IN');
  });

  test('should retrieve valid metadata for English, Kannada, and Hindi', () => {
    const enMeta = getLanguageMetadata('en-IN');
    const knMeta = getLanguageMetadata('kn-IN');
    const hiMeta = getLanguageMetadata('hi-IN');

    assert.equal(enMeta.bcp47, 'en-IN');
    assert.equal(knMeta.bcp47, 'kn-IN');
    assert.equal(hiMeta.bcp47, 'hi-IN');
    assert.ok(enMeta.sampleGreetings.length > 0);
  });

  test('should format personalized welcome messages in all three languages', () => {
    const enMsg = getWelcomeMessage('en-IN', 'Rahul');
    const knMsg = getWelcomeMessage('kn-IN', 'Rahul');
    const hiMsg = getWelcomeMessage('hi-IN', 'Rahul');

    assert.ok(enMsg.includes('Rahul'));
    assert.ok(knMsg.includes('Rahul'));
    assert.ok(hiMsg.includes('Rahul'));
  });
});

