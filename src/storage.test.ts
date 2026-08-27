import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { configDir, ensureConfigDir, readJson, writeJson } from './storage.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskbridge-test-'));
  process.env.TASKBRIDGE_CONFIG_DIR = dir;
});

test('configDir honors TASKBRIDGE_CONFIG_DIR', () => {
  assert.equal(configDir(), dir);
});

test('ensureConfigDir creates the directory', () => {
  const nested = path.join(dir, 'a', 'b');
  process.env.TASKBRIDGE_CONFIG_DIR = nested;
  assert.equal(ensureConfigDir(), nested);
  assert.ok(fs.statSync(nested).isDirectory());
});

test('readJson returns null for a missing file', () => {
  assert.equal(readJson('nope.json'), null);
});

test('writeJson/readJson round-trip (isolated per config dir)', () => {
  writeJson('data.json', { hello: 'world', n: 42 });
  process.env.TASKBRIDGE_CONFIG_DIR = dir;
  assert.deepEqual(readJson<{ hello: string; n: number }>('data.json'), {
    hello: 'world',
    n: 42,
  });
});

test('a corrupt file fails loudly instead of returning garbage', () => {
  fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
  assert.throws(() => readJson('broken.json'), /corrupt/);
});
