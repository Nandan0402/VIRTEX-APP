import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../backend/src/app.js';

describe('Backend API Integration Tests', () => {
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

  test('GET /health returns online status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, 'online');
    assert.ok(body.uptimeSeconds >= 0);
  });

  test('GET /chat/languages returns 3 supported languages', async () => {
    const res = await fetch(`${baseUrl}/chat/languages`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 3);

    const codes = body.data.map((l) => l.code);
    assert.ok(codes.includes('en-IN'));
    assert.ok(codes.includes('kn-IN'));
    assert.ok(codes.includes('hi-IN'));
  });

  test('POST /chat/message handles dialogue and queues gesture', async () => {
    const res = await fetch(`${baseUrl}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello robot!', language: 'en-IN' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.reply.length > 0);
    assert.equal(body.data.gesture, 'GREET_WAVE');
  });
});

