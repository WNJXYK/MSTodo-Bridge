import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomToken, hashSecret, verifySecret, safeEqual } from './secrets.js';

test('hashSecret/verifySecret round-trip', () => {
  const hash = hashSecret('correct horse battery staple');
  assert.match(hash, /^scrypt\$/);
  assert.equal(verifySecret('correct horse battery staple', hash), true);
});

test('verifySecret rejects wrong plaintext and malformed stored values', () => {
  const hash = hashSecret('correct horse battery staple');
  assert.equal(verifySecret('wrong', hash), false);
  assert.equal(verifySecret('correct horse battery staple', 'not-a-hash'), false);
  assert.equal(verifySecret('correct horse battery staple', undefined), false);
  assert.equal(verifySecret('correct horse battery staple', null), false);
});

test('hashing is salted: same plaintext hashes differently each time', () => {
  assert.notEqual(hashSecret('same'), hashSecret('same'));
});

test('safeEqual compares opaque strings without leaking length', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
});

test('randomToken is url-safe and unique across draws', () => {
  const a = randomToken(32);
  const b = randomToken(32);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
  // 32 bytes → 256 bits → ~43 base64url chars
  assert.equal(a.length, 43);
});
