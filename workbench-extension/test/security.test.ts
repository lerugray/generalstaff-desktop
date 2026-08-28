import assert from 'node:assert/strict';
import test from 'node:test';
import { isPathInside, requireAllowedPath } from '../src/security/paths.js';
import { redact } from '../src/security/redaction.js';

test('path checks accept descendants and reject prefix lookalikes', () => {
  assert.equal(isPathInside('/work/projects/alpha/file.md', '/work/projects/alpha'), true);
  assert.equal(isPathInside('/work/projects/alpha', '/work/projects/alpha'), true);
  assert.equal(isPathInside('/work/projects/alpha-secret/file.md', '/work/projects/alpha'), false);
  assert.throws(() => requireAllowedPath('/work/projects/beta/file.md', ['/work/projects/alpha']), /outside/);
});

test('redaction removes common credentials and home-directory identity', () => {
  const value = redact(
    'API_KEY=super-secret-value Bearer abcdefghijklmnopqrst sk-example0123456789 /Users/operator/project',
  );
  assert.equal(value.includes('super-secret-value'), false);
  assert.equal(value.includes('abcdefghijklmnopqrst'), false);
  assert.equal(value.includes('sk-example0123456789'), false);
  assert.equal(value.includes('/Users/operator/'), false);
  assert.match(value, /API_KEY=\[redacted\]/);
  assert.match(value, /~\/project/);
});

test('redaction removes provider tokens, JSON passwords, and private keys', () => {
  const value = redact([
    'ghp_abcdefghijklmnopqrstuvwxyz123456',
    'AKIAIOSFODNN7EXAMPLE',
    'xoxb-' + '123456789012-abcdefghijklmnop',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.c2lnbmF0dXJlMTIzNDU2',
    '{"password":"do-not-show"}',
    '-----BEGIN PRIVATE KEY-----\nsecretmaterial\n-----END PRIVATE KEY-----',
  ].join('\n'));
  for (const secret of ['ghp_', 'AKIAIOSFODNN7EXAMPLE', 'xoxb-', 'eyJhbGci', 'do-not-show', 'secretmaterial']) {
    assert.equal(value.includes(secret), false);
  }
});

test('redaction catches long high-entropy values without relying on a credential name', () => {
  const secret = 'u7Vh8Qp2Nz4Lx6Rm9Kd3Ws5Yc1Tf0BjA';
  const value = redact(`opaque=${secret}`);
  assert.equal(value.includes(secret), false);
  assert.match(value, /opaque=\[redacted-high-entropy-token\]/);
});

test('redaction preserves git hashes and ordinary paths', () => {
  const shortSha = '705b488';
  const fullSha = '705b4889d4e7461ce02b12c17ed1b331733767a3';
  const contentHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const normalPath = '/work/projects/generalstaff/src/security/redaction.ts';
  const value = redact([shortSha, fullSha, contentHash, normalPath].join('\n'));
  assert.equal(value, [shortSha, fullSha, contentHash, normalPath].join('\n'));
});

test('redaction bounds untrusted lane output', () => {
  assert.equal(redact('a'.repeat(30_000)).length, 20_000);
});
