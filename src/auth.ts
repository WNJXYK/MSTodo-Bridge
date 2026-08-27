#!/usr/bin/env node
import * as http from 'node:http';
import { spawn } from 'node:child_process';
import { createRegistry } from './registry.js';
import { OAuthStateStore, codeChallengeS256 } from './oauth.js';

/**
 * Headless OAuth flow: `node dist/auth.js mstodo [--port 46377]`.
 *
 * Spins up a one-shot loopback server, opens the browser for consent, and
 * exchanges the authorization code (PKCE) into tokens on disk — same storage
 * the MCP server reads, so this works without the web GUI.
 */

const TIMEOUT_MS = 10 * 60 * 1000;

const HELP = `taskbridge-mcp auth — connect Microsoft To Do from the terminal

Usage:
  npm run auth:mstodo          connect Microsoft To Do
  node dist/auth.js mstodo [--port <n>]

The OAuth callback is http://localhost:<port>/oauth/mstodo/callback
(default port 46377, override with --port or PORT). The built-in Entra
public-client app already registers this URI; Entra ignores loopback ports,
so any local port works even without touching the app registration.`;

function instructions(): string {
  return (
    'Microsoft OAuth client id not available.\n' +
    '  The app ships with a built-in public client id; this error only appears when\n' +
    '  TASKBRIDGE_MS_CLIENT_ID was set to an invalid value. Unset it or provide your own\n' +
    '  Entra app id (platform "Mobile and desktop application").'
  );
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open'
    : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  } catch {
    // Best-effort; the URL is printed so the user can open it manually.
  }
}

function resultPage(title: string, detail: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="font:15px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem">` +
    `<h1>${title}</h1><p>${detail}</p></body></html>`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  const providerId = argv[0]!;
  let port = Number(process.env.PORT ?? 46377);
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--port') port = Number(argv[++i]);
    else {
      console.error(`Unknown option: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`Invalid port: ${port}`);
    process.exit(1);
  }

  const registry = createRegistry();
  const provider = registry.get(providerId);
  if (!provider) {
    console.error(`Unknown provider "${providerId}". Available: ${[...registry.keys()].join(', ')}.`);
    process.exit(1);
  }
  if (!provider.hasClientCredentials()) {
    console.error(instructions());
    process.exit(1);
  }

  const redirectUri = `http://localhost:${port}/oauth/${providerId}/callback`;
  const states = new OAuthStateStore();
  const pending = states.create(providerId, redirectUri);
  const authorizeUrl = provider.buildAuthorizeUrl(
    redirectUri,
    pending.state,
    codeChallengeS256(pending.codeVerifier),
  );

  const finish = (code: number) => server.close(() => process.exit(code));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', redirectUri);
    if (url.pathname !== `/oauth/${providerId}/callback`) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    const errParam = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = states.take(url.searchParams.get('state'), providerId);
    if (errParam || !code || !state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        resultPage('授权失败', `错误：${errParam ?? 'state 无效或已过期'}。请回到终端重新执行授权。`),
      );
      console.error(`Authorization failed: ${errParam ?? 'invalid or expired state'}.`);
      finish(1);
      return;
    }
    try {
      await provider.exchangeCode(code, state.redirectUri, state.codeVerifier);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        resultPage('授权成功', `${provider.displayName} 已连接，令牌已保存。可以关闭此页面。`),
      );
      console.log(`\n  ✓ ${provider.displayName} connected — tokens saved.\n`);
      finish(0);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        resultPage('授权失败', `令牌交换出错：${err instanceof Error ? err.message : String(err)}`),
      );
      console.error('Code exchange failed:', err instanceof Error ? err.message : err);
      finish(1);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other process or pass --port <n>.`);
    } else {
      console.error('Failed to start callback server:', err.message);
    }
    process.exit(1);
  });

  await new Promise<void>((resolve) => server.listen(port, 'localhost', resolve));
  console.log(`\n  Waiting for ${provider.displayName} consent on ${redirectUri}`);
  console.log('  Opening your browser … if nothing happens, visit:\n');
  console.log(`  ${authorizeUrl}\n`);
  openBrowser(authorizeUrl);

  setTimeout(() => {
    console.error('\nTimed out after 10 minutes without a callback. Aborting.');
    finish(1);
  }, TIMEOUT_MS).unref();
  process.on('SIGINT', () => finish(1));
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
