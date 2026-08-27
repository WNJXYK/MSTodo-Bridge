import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createTaskBridgeServer } from './server.js';
import { readJson, writeJson } from './storage.js';
import { randomToken, hashSecret, verifySecret } from './secrets.js';
import { OAuthStateStore, codeChallengeS256 } from './oauth.js';
import { providerStatuses } from './registry.js';
import { proxyStatus, setProxyUrl, assertValidProxyUrl, testProxy } from './proxy.js';
import { TaskBridgeError } from './errors.js';

interface AppConfig {
  adminPasswordHash?: string;
  mcpTokenHash?: string;
  sessionSecret?: string;
  publicBaseUrl?: string;
}

const CONFIG_FILE = 'config.json';
const SESSION_COOKIE = 'tb_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface HttpOptions {
  port: number;
  host: string;
  publicBaseUrl?: string;
}

export class AdminApp {
  private config: AppConfig;
  private oauthStates = new OAuthStateStore();
  private registry = createTaskBridgeServer().registry;
  private loginFailures = new Map<string, { count: number; resetAt: number }>();
  private sessions = new Map<string, number>();
  private startedAt = Date.now();
  private lastCpu = process.cpuUsage();
  private cpuPercent = 0;

  constructor(private opts: HttpOptions) {
    this.config = readJson<AppConfig>(CONFIG_FILE) ?? {};
    this.ensureSecrets();
    // Recompute CPU usage every 5s for the status endpoint.
    setInterval(() => {
      const cur = process.cpuUsage(this.lastCpu);
      this.lastCpu = process.cpuUsage();
      const totalMs = (cur.user + cur.system) / 1000;
      this.cpuPercent = Math.min(100, (totalMs / 5000) * 100);
    }, 5000).unref();
  }

  publicBaseUrl(): string {
    return (
      this.opts.publicBaseUrl ??
      this.config.publicBaseUrl ??
      `http://localhost:${this.opts.port}`
    );
  }

  private ensureSecrets(): void {
    let dirty = false;
    if (!this.config.sessionSecret) {
      this.config.sessionSecret = randomToken(32);
      dirty = true;
    }
    if (!this.config.adminPasswordHash && !process.env.ADMIN_PASSWORD) {
      // First boot without a password: generate one, print once, store hash.
      const pw = randomToken(12);
      this.config.adminPasswordHash = hashSecret(pw);
      console.log(`\n  Admin password (shown once): ${pw}\n`);
      dirty = true;
    }
    if (!this.config.mcpTokenHash) {
      const tok = randomToken(32);
      this.config.mcpTokenHash = hashSecret(tok);
      console.log(`  MCP bearer token (shown once, rotate in GUI): ${tok}\n`);
      dirty = true;
    }
    if (dirty) this.saveConfig();
  }

  private saveConfig(): void {
    writeJson(CONFIG_FILE, this.config);
  }

  // ---------- sessions ----------

  private sign(value: string): string {
    return createHmac('sha256', this.config.sessionSecret!).update(value).digest('base64url');
  }

  private sessionCookie(sessionId: string): string {
    const secure = this.publicBaseUrl().startsWith('https') ? '; Secure' : '';
    return `${SESSION_COOKIE}=${sessionId}.${this.sign(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
  }

  private validSession(req: http.IncomingMessage): boolean {
    const cookie = req.headers.cookie ?? '';
    const m = new RegExp(`${SESSION_COOKIE}=([^.]+)\\.([A-Za-z0-9_-]+)`).exec(cookie);
    if (!m) return false;
    const [, id, sig] = m;
    const expected = this.sign(id!);
    if (sig!.length !== expected.length) return false;
    if (!timingSafeEqual(Buffer.from(sig!), Buffer.from(expected))) return false;
    const expires = this.sessions.get(id!);
    if (!expires || expires < Date.now()) return false;
    return true;
  }

  // ---------- helpers ----------

  private static originAllowed(req: http.IncomingMessage): boolean {
    // Prefer Sec-Fetch-Site (browsers always send it on cross-site requests);
    // some Chrome versions send "Origin: null" even for same-origin form posts.
    const fetchSite = req.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string') {
      return fetchSite === 'same-origin' || fetchSite === 'none';
    }
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser client
    if (origin === 'null') return false; // opaque origin, cannot verify
    try {
      const o = new URL(origin);
      const host = req.headers.host;
      return !host || o.host === host;
    } catch {
      return false;
    }
  }

  private static clientIp(req: http.IncomingMessage): string {
    return req.socket.remoteAddress ?? 'unknown';
  }

  private loginBlocked(ip: string): boolean {
    const rec = this.loginFailures.get(ip);
    if (!rec) return false;
    if (Date.now() > rec.resetAt) {
      this.loginFailures.delete(ip);
      return false;
    }
    return rec.count >= 10;
  }

  private recordLoginFailure(ip: string): void {
    const rec = this.loginFailures.get(ip) ?? { count: 0, resetAt: Date.now() + 15 * 60_000 };
    rec.count += 1;
    this.loginFailures.set(ip, rec);
  }

  private mcpTokenValid(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return false;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return false;
    return verifySecret(token, this.config.mcpTokenHash);
  }

  // ---------- request entry ----------

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // --- public endpoints ---
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    if (pathname === '/.well-known/oauth-protected-resource') {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(
          JSON.stringify({
            resource: this.publicBaseUrl(),
            bearer_methods_supported: ['header'],
          }),
        );
      return;
    }
    if (pathname === '/oauth/mstodo/callback') {
      await this.oauthCallback('mstodo', url.searchParams, res);
      return;
    }

    // --- MCP endpoint ---
    if (pathname === '/mcp') {
      await this.handleMcp(req, res);
      return;
    }

    // --- admin GUI ---
    if (pathname === '/admin/login' && req.method === 'GET') {
      this.serveStatic(res, 'admin/login.html');
      return;
    }
    if (pathname === '/admin/login' && req.method === 'POST') {
      await this.handleLogin(req, res);
      return;
    }
    if (pathname === '/admin/logout' && req.method === 'POST') {
      res.writeHead(302, { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`, Location: '/admin/login' });
      res.end();
      return;
    }
    if (pathname.startsWith('/admin/assets/')) {
      this.serveStatic(res, pathname.slice('/admin/'.length));
      return;
    }
    if (pathname.startsWith('/admin/api/')) {
      await this.handleAdminApi(req, res, pathname);
      return;
    }
    if (pathname === '/admin' || pathname === '/admin/') {
      if (!this.validSession(req)) {
        res.writeHead(302, { Location: '/admin/login' }).end();
        return;
      }
      this.serveStatic(res, 'admin/index.html');
      return;
    }
    if (pathname === '/') {
      res.writeHead(302, { Location: '/admin' }).end();
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }

  // ---------- MCP ----------

  private async handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.mcpTokenValid(req)) {
      res
        .writeHead(401, {
          'WWW-Authenticate': `Bearer realm="mstodo-bridge", resource_metadata="${this.publicBaseUrl()}/.well-known/oauth-protected-resource"`,
          'Content-Type': 'application/json',
        })
        .end(JSON.stringify({ error: 'invalid_token', error_description: 'Missing or invalid bearer token. Manage it in the admin GUI.' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    const body = await readBody(req, 4 * 1024 * 1024);
    const { server } = createTaskBridgeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body.length ? JSON.parse(body) : undefined);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null }),
        );
      }
      void err;
    }
  }

  // ---------- admin auth ----------

  private async handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!AdminApp.originAllowed(req)) {
      res.writeHead(403).end();
      return;
    }
    const ip = AdminApp.clientIp(req);
    if (this.loginBlocked(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ error: 'Too many attempts; wait 15 minutes.' }),
      );
      return;
    }
    const body = await readBody(req, 64 * 1024);
    const form = new URLSearchParams(body);
    const password = form.get('password') ?? '';
    const envPw = process.env.ADMIN_PASSWORD;
    const ok =
      envPw !== undefined
        ? password === envPw
        : verifySecret(password, this.config.adminPasswordHash);
    if (!ok) {
      this.recordLoginFailure(ip);
      res.writeHead(401, { 'Content-Type': 'text/html' }).end(
        adminMessagePage('Wrong password', '/admin/login', 'Try again'),
      );
      return;
    }
    const sessionId = randomToken(24);
    this.sessions.set(sessionId, Date.now() + SESSION_TTL_MS);
    res.writeHead(303, { 'Set-Cookie': this.sessionCookie(sessionId), Location: '/admin' });
    res.end();
  }

  // ---------- admin API ----------

  private async handleAdminApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (!this.validSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (!AdminApp.originAllowed(req)) {
      res.writeHead(403).end();
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/api/status') {
      const mem = process.memoryUsage();
      this.sweepSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          version: '0.1.0',
          uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
          publicBaseUrl: this.publicBaseUrl(),
          process: {
            pid: process.pid,
            node: process.version,
            platform: `${os.type()} ${os.arch()}`,
            rssMb: +(mem.rss / 1048576).toFixed(1),
            heapUsedMb: +(mem.heapUsed / 1048576).toFixed(1),
            heapTotalMb: +(mem.heapTotal / 1048576).toFixed(1),
            cpuPercent: +this.cpuPercent.toFixed(1),
            loadAvg1: os.loadavg()[0] ?? 0,
          },
          mcpTokenConfigured: !!this.config.mcpTokenHash,
          proxy: proxyStatus(),
          providers: providerStatuses(this.registry),
        }),
      );
      return;
    }

    if (req.method === 'POST' && pathname === '/admin/api/token/rotate') {
      const token = randomToken(32);
      this.config.mcpTokenHash = hashSecret(token);
      this.saveConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ token, note: 'Shown once. Update your MCP clients now.' }),
      );
      return;
    }

    const pasteMatch = /^\/admin\/api\/providers\/(mstodo)\/callback$/.exec(pathname);
    if (req.method === 'POST' && pasteMatch) {
      const body = await readBody(req, 64 * 1024);
      let pasted = '';
      try {
        const parsedBody = JSON.parse(body) as { url?: string };
        pasted = parsedBody.url ?? '';
      } catch {
        pasted = body; // allow sending the raw URL directly as text/plain
      }
      const params = AdminApp.parsePastedCallback(pasted);
      if (!params) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ ok: false, message: 'error: 无法识别的链接 —— 需要包含 code/state 参数的完整回调地址' }),
        );
        return;
      }
      const outcome = await this.completeOauth('mstodo', params);
      res.writeHead(outcome.ok ? 200 : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify(outcome));
      return;
    }

    const credMatch = /^\/admin\/api\/providers\/(mstodo)\/credentials$/.exec(pathname);
    if (req.method === 'POST' && credMatch) {
      const body = await readBody(req, 64 * 1024);
      const { clientId, clientSecret } = JSON.parse(body) as { clientId?: string; clientSecret?: string };
      if (!clientId) {
        res.writeHead(400).end(JSON.stringify({ error: 'clientId required' }));
        return;
      }
      const provider = this.registry.get(credMatch[1]!)!;
      provider.saveClientCredentials(clientId, clientSecret);
      res.writeHead(200).end(JSON.stringify({ ok: true }));
      return;
    }

    const disMatch = /^\/admin\/api\/providers\/(mstodo)\/disconnect$/.exec(pathname);
    if (req.method === 'POST' && disMatch) {
      this.registry.get(disMatch[1]!)!.disconnect();
      res.writeHead(200).end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/api/proxy') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(proxyStatus()));
      return;
    }

    if (req.method === 'POST' && pathname === '/admin/api/proxy') {
      const body = await readBody(req, 16 * 1024);
      let proxyUrl: string | null = null;
      try {
        proxyUrl = (JSON.parse(body) as { proxyUrl?: string | null }).proxyUrl ?? null;
      } catch {
        res.writeHead(400).end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }
      if (proxyUrl) {
        try {
          setProxyUrl(assertValidProxyUrl(proxyUrl));
        } catch (err) {
          res.writeHead(400).end(
            JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          );
          return;
        }
      } else {
        setProxyUrl(null);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ ok: true, ...proxyStatus() }),
      );
      return;
    }

    if (req.method === 'POST' && pathname === '/admin/api/proxy/test') {
      const body = await readBody(req, 16 * 1024);
      let candidate: string | undefined;
      try {
        const parsed = JSON.parse(body || '{}') as { proxyUrl?: string };
        candidate = parsed.proxyUrl?.trim() || undefined;
      } catch {
        res.writeHead(400).end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }
      if (candidate) {
        try {
          candidate = assertValidProxyUrl(candidate);
        } catch (err) {
          res.writeHead(400).end(
            JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          );
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ results: await testProxy(candidate) }),
      );
      return;
    }

    res.writeHead(404).end(JSON.stringify({ error: 'not found' }));
  }

  // ---------- OAuth start/callback ----------

  private oauthStart(providerId: string, res: http.ServerResponse): void {
    const provider = this.registry.get(providerId)!;
    const redirectUri = `${this.publicBaseUrl()}/oauth/${providerId}/callback`;
    const pending = this.oauthStates.create(providerId, redirectUri);
    const url = provider.buildAuthorizeUrl(
      redirectUri,
      pending.state,
      codeChallengeS256(pending.codeVerifier),
    );
    res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' }).end();
  }

  private async oauthCallback(
    providerId: string,
    params: URLSearchParams,
    res: http.ServerResponse,
  ): Promise<void> {
    const outcome = await this.completeOauth(providerId, params);
    res.writeHead(302, { Location: `/admin?oauth=${encodeURIComponent(outcome.message)}` }).end();
  }

  /**
   * Shared completion path for both the browser redirect and the headless
   * "paste the callback URL back" flow. Consumes the one-time state and
   * exchanges the code; never throws — the message is user-facing.
   */
  async completeOauth(providerId: string, params: URLSearchParams): Promise<{ ok: boolean; message: string }> {
    const errParam = params.get('error');
    if (errParam) return { ok: false, message: `error: ${errParam}` };
    const code = params.get('code');
    const state = params.get('state');
    const pending = this.oauthStates.take(state, providerId);
    if (!code || !pending) return { ok: false, message: 'error: invalid or expired state' };
    const provider = this.registry.get(providerId)!;
    try {
      await provider.exchangeCode(code, pending.redirectUri, pending.codeVerifier);
      return { ok: true, message: 'connected' };
    } catch (err) {
      const msg = err instanceof TaskBridgeError || err instanceof Error ? err.message : String(err);
      return { ok: false, message: `error: ${msg.slice(0, 140)}` };
    }
  }

  /** Accepts a full callback URL (or bare query) pasted by a remote/headless user. */
  static parsePastedCallback(rawInput: string): URLSearchParams | null {
    let raw = rawInput.trim().replace(/^["'<]|["'>]$/g, '');
    if (!raw) return null;
    try {
      if (raw.startsWith('?')) raw = `http://localhost${raw}`;
      else if (raw.startsWith('/')) raw = `http://localhost:46377${raw}`;
      const url = new URL(raw);
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) return null;
      return url.searchParams;
    } catch {
      return null;
    }
  }

  // NOTE: oauthStart is invoked through /admin/oauth/:id/start which requires a session.
  handleAdminRoute(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
    const m = /^\/admin\/oauth\/(mstodo)\/start$/.exec(pathname);
    if (!m || req.method !== 'GET') return false;
    if (!this.validSession(req)) {
      res.writeHead(302, { Location: '/admin/login' }).end();
      return true;
    }
    this.oauthStart(m[1]!, res);
    return true;
  }

  private sweepSessions(): void {
    const now = Date.now();
    for (const [id, exp] of this.sessions) {
      if (exp < now) this.sessions.delete(id);
    }
  }

  // ---------- static ----------

  private serveStatic(res: http.ServerResponse, relPath: string): void {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
    const file = path.join(root, relPath);
    if (!file.startsWith(root)) {
      res.writeHead(404).end();
      return;
    }
    let data: Buffer;
    try {
      data = fs.readFileSync(file);
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
    const type =
      relPath.endsWith('.html') ? 'text/html; charset=utf-8'
      : relPath.endsWith('.css') ? 'text/css; charset=utf-8'
      : relPath.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    res.end(data);
  }
}

function adminMessagePage(title: string, backHref: string, backLabel: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/admin/assets/style.css"></head><body class="msg-page"><main class="msg-card"><h1>${title}</h1><p><a href="${backHref}">${backLabel}</a></p></main></body></html>`;
}

export function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new TaskBridgeError('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function startHttpServer(opts: HttpOptions): http.Server {
  const app = new AdminApp(opts);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    // Admin OAuth start lives under /admin but needs the app, so try it first.
    if (app.handleAdminRoute(req, res, url.pathname)) return;
    app.handle(req, res).catch((err) => {
      console.error('request failed:', err);
      if (!res.headersSent) res.writeHead(500).end('internal error');
    });
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${opts.port} is already in use.\n` +
        `  Pass --port <n> (Entra ignores the port for http://localhost redirect URIs,\n` +
        `  so no app-registration change is needed for a different local port).\n`);
    } else {
      console.error(`Failed to listen on ${opts.host}:${opts.port}:`, err.message);
    }
    process.exit(1);
  });
  server.listen(opts.port, opts.host, () => {
    const base = app.publicBaseUrl();
    console.log(`\n  mstodo-bridge listening on http://${opts.host}:${opts.port}`);
    console.log(`  Admin GUI:    ${base}/admin`);
    console.log(`  MCP endpoint: ${base}/mcp  (Authorization: Bearer <token>)`);
    console.log(`  OAuth callback: ${base}/oauth/mstodo/callback`);
    console.log(`  (remote hosts: sign-in redirects to localhost on YOUR machine — copy that`);
    console.log(`   address-bar URL and paste it into the admin GUI input box)\n`);
  });
  return server;
}
