import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MsTodoProvider, BUILTIN_MS_CLIENT_ID } from './providers/mstodo.js';
import { LoginManager } from './login.js';
import { writeJson } from './storage.js';

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskbridge-login-'));
  process.env.TASKBRIDGE_CONFIG_DIR = dir;
});

test('start_login binds a loopback listener and returns an authorize URL', async () => {
  const p = new MsTodoProvider('not-a-guid'); // falls back to built-in id
  const m = new LoginManager(p);
  const start = await m.start();
  try {
    const url = new URL(start.authorizeUrl);
    assert.equal(url.host, 'login.microsoftonline.com');
    assert.equal(url.searchParams.get('client_id'), BUILTIN_MS_CLIENT_ID);
    assert.match(url.searchParams.get('redirect_uri')!, /^http:\/\/localhost:\d+\/oauth\/mstodo\/callback$/);
    assert.equal(start.localListener, true);
    // The listener actually answers.
    const res = await fetch(new URL('/whatever', start.redirectUri));
    assert.equal(res.status, 404);
  } finally {
    m.cancel();
  }
});

test('paste_callback rejects a URL whose state does not match the pending login', async () => {
  const p = new MsTodoProvider('not-a-guid');
  const m = new LoginManager(p);
  await m.start();
  try {
    const out = await m.paste('http://localhost:46377/oauth/mstodo/callback?code=abc&state=wrong');
    assert.equal(out.ok, false);
    assert.match(out.message, /state/);
  } finally {
    m.cancel();
  }
});

test('paste_callback tolerates garbage input', async () => {
  const p = new MsTodoProvider('not-a-guid');
  const m = new LoginManager(p);
  await m.start();
  try {
    for (const bad of ['', 'not a url', 'http://example.com/no-code']) {
      const out = await m.paste(bad);
      assert.equal(out.ok, false, `expected failure for: ${bad}`);
    }
  } finally {
    m.cancel();
  }
});

test('login_status reflects a token file appearing on disk', async () => {
  const p = new MsTodoProvider('not-a-guid');
  const m = new LoginManager(p);
  assert.deepEqual(m.status(), { connected: false, loginPending: false });
  writeJson('mstodo-auth.json', { refreshToken: 'r', accessToken: 'a', expiresAt: Date.now() + 3600_000 });
  const st = m.status();
  assert.equal(st.connected, true);
});
