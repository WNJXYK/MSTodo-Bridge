import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getProxyUrl,
  setProxyUrl,
  assertValidProxyUrl,
  maskProxyUrl,
  proxyStatus,
} from './proxy.js';

const ENV_KEYS = ['TASKBRIDGE_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'];
let savedEnv: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskbridge-proxy-'));
  process.env.TASKBRIDGE_CONFIG_DIR = dir;
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('no proxy configured by default', () => {
  assert.equal(getProxyUrl(), null);
  assert.deepEqual(proxyStatus(), { active: false, maskedUrl: null, source: null });
});

test('setProxyUrl/getProxyUrl round-trip via the config file', () => {
  setProxyUrl('http://127.0.0.1:7890');
  assert.deepEqual(getProxyUrl(), { url: 'http://127.0.0.1:7890', source: 'config' });
  setProxyUrl(null);
  assert.equal(getProxyUrl(), null);
});

test('GUI config wins over environment variables', () => {
  process.env.TASKBRIDGE_PROXY = 'http://from-env:1';
  setProxyUrl('http://from-gui:2');
  assert.deepEqual(getProxyUrl(), { url: 'http://from-gui:2', source: 'config' });
});

test('TASKBRIDGE_PROXY beats the standard HTTPS_PROXY', () => {
  process.env.HTTPS_PROXY = 'http://generic:3';
  process.env.TASKBRIDGE_PROXY = 'http://specific:4';
  assert.deepEqual(getProxyUrl(), { url: 'http://specific:4', source: 'env' });
});

test('falls back to HTTPS_PROXY then HTTP_PROXY', () => {
  process.env.HTTPS_PROXY = 'http://secure:5';
  assert.deepEqual(getProxyUrl(), { url: 'http://secure:5', source: 'env' });
  delete process.env.HTTPS_PROXY;
  process.env.http_proxy = 'http://plain:6';
  assert.deepEqual(getProxyUrl(), { url: 'http://plain:6', source: 'env' });
});

test('unsupported env schemes (socks5) are ignored, not fatal', () => {
  process.env.TASKBRIDGE_PROXY = 'socks5://127.0.0.1:1080';
  assert.equal(getProxyUrl(), null);
});

test('assertValidProxyUrl accepts http/https and rejects everything else', () => {
  assert.equal(assertValidProxyUrl(' http://127.0.0.1:7890 '), 'http://127.0.0.1:7890');
  assert.equal(assertValidProxyUrl('https://proxy.example.com'), 'https://proxy.example.com');
  assert.throws(() => assertValidProxyUrl('socks5://127.0.0.1:1080'), /不支持的代理协议/);
  assert.throws(() => assertValidProxyUrl('not a url'), /无法解析代理地址/);
});

test('maskProxyUrl hides the password but keeps the host', () => {
  assert.equal(
    maskProxyUrl('http://user:secret@127.0.0.1:7890'),
    'http://user:***@127.0.0.1:7890/',
  );
  assert.equal(maskProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890/');
});

test('proxyStatus reports the masked url and source', () => {
  setProxyUrl('http://user:pw@127.0.0.1:7890');
  assert.deepEqual(proxyStatus(), {
    active: true,
    maskedUrl: 'http://user:***@127.0.0.1:7890/',
    source: 'config',
  });
});
