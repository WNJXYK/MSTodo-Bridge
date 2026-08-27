import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MsTodoProvider, BUILTIN_MS_CLIENT_ID } from './mstodo.js';

const REDIRECT = 'http://localhost:46377/oauth/mstodo/callback';

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskbridge-authurl-'));
  process.env.TASKBRIDGE_CONFIG_DIR = dir;
});

test('mstodo builds a correct authorize URL (v2 endpoint + PKCE)', () => {
  const p = new MsTodoProvider('01234567-89ab-cdef-0123-456789abcdef', 'https://login.microsoftonline.com/common');
  const url = new URL(p.buildAuthorizeUrl(REDIRECT, 'st4te', 'ch4ll'));
  assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  const q = url.searchParams;
  assert.equal(q.get('client_id'), '01234567-89ab-cdef-0123-456789abcdef');
  assert.equal(q.get('redirect_uri'), REDIRECT);
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('scope'), 'offline_access Tasks.ReadWrite User.Read');
  assert.equal(q.get('state'), 'st4te');
  assert.equal(q.get('code_challenge'), 'ch4ll');
  assert.equal(q.get('code_challenge_method'), 'S256');
});

test('an invalid TASKBRIDGE_MS_CLIENT_ID override falls back to the built-in id', () => {
  const p = new MsTodoProvider('not-a-guid', 'https://login.microsoftonline.com/common');
  const url = new URL(p.buildAuthorizeUrl(REDIRECT, 's', 'c'));
  assert.equal(url.searchParams.get('client_id'), BUILTIN_MS_CLIENT_ID);
  assert.equal(p.hasClientCredentials(), true);
});

test('a valid TASKBRIDGE_MS_CLIENT_ID override is honored', () => {
  const p = new MsTodoProvider('01234567-89ab-cdef-0123-456789abcdef', 'https://login.microsoftonline.com/common');
  const url = new URL(p.buildAuthorizeUrl(REDIRECT, 's', 'c'));
  assert.equal(url.searchParams.get('client_id'), '01234567-89ab-cdef-0123-456789abcdef');
});
