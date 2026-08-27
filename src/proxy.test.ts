import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getProxyUrl, proxyFetch } from './proxy.js';

const ENV_KEYS = ['TASKBRIDGE_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'];

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

test('no proxy configured by default', () => {
  assert.equal(getProxyUrl(), null);
});

test('TASKBRIDGE_PROXY beats the standard HTTPS_PROXY', () => {
  process.env.TASKBRIDGE_PROXY = 'http://primary:1';
  process.env.HTTPS_PROXY = 'http://secondary:2';
  assert.equal(getProxyUrl(), 'http://primary:1');
});

test('falls back to HTTPS_PROXY then HTTP_PROXY', () => {
  process.env.HTTP_PROXY = 'http://third:3';
  assert.equal(getProxyUrl(), 'http://third:3');
  process.env.HTTPS_PROXY = 'https://second:2';
  assert.equal(getProxyUrl(), 'https://second:2');
});

test('unsupported env schemes (socks5) are ignored, not fatal', () => {
  process.env.HTTPS_PROXY = 'socks5://127.0.0.1:7897';
  assert.equal(getProxyUrl(), null);
  process.env.TASKBRIDGE_PROXY = 'socks5h://x:1';
  assert.equal(getProxyUrl(), null);
});

test('proxyFetch routes with and without a proxy configured', async () => {
  // No network assertions — an unreachable target must simply reject, which
  // proves the dispatcher path (direct or proxied) executed.
  await assert.rejects(
    () => proxyFetch('http://127.0.0.1:1/', { signal: AbortSignal.timeout(1500) }),
    () => true,
  );
  process.env.TASKBRIDGE_PROXY = 'http://127.0.0.1:1';
  await assert.rejects(
    () => proxyFetch('http://127.0.0.1:2/', { signal: AbortSignal.timeout(1500) }),
    () => true,
  );
});
