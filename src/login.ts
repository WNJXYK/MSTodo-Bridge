import * as http from 'node:http';
import * as net from 'node:net';
import { OAuthStateStore, codeChallengeS256 } from './oauth.js';
import type { ManagedProvider } from './registry.js';

/**
 * In-conversation login: the MCP tools `start_login` / `paste_callback` /
 * `login_status` drive this manager. It binds an EPHEMERAL loopback port
 * (Entra ignores loopback ports for public clients, RFC 8252 §7.3) to catch
 * the browser redirect; when the browser runs on another machine the redirect
 * dead-ends there and the user pastes the address-bar URL into
 * `paste_callback` instead. Both paths share the one-time state store.
 */

const LOGIN_TTL_MS = 10 * 60 * 1000;

export interface LoginStart {
  authorizeUrl: string;
  /** The loopback URI that will catch the browser redirect when local. */
  redirectUri: string;
  /** True when the redirect listener bound successfully (local flow possible). */
  localListener: boolean;
  hint: string;
}

export class LoginManager {
  private states = new OAuthStateStore();
  private server: http.Server | null = null;
  private redirectUri = '';
  private pendingState: { state: string; verifier: string } | null = null;
  private expiresAt = 0;

  constructor(private provider: ManagedProvider) {}

  async start(): Promise<LoginStart> {
    this.stopListener();
    const port = await freeLoopbackPort();
    this.redirectUri = `http://localhost:${port}/oauth/mstodo/callback`;
    const pending = this.states.create(this.provider.id, this.redirectUri);
    this.pendingState = { state: pending.state, verifier: pending.codeVerifier };
    this.expiresAt = Date.now() + LOGIN_TTL_MS;
    const authorizeUrl = this.provider.buildAuthorizeUrl(
      this.redirectUri,
      pending.state,
      codeChallengeS256(pending.codeVerifier),
    );

    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', this.redirectUri);
      if (url.pathname !== '/oauth/mstodo/callback') {
        res.writeHead(404).end();
        return;
      }
      void this.complete(url.searchParams, res);
    });
    const localListener = await new Promise<boolean>((resolve) => {
      this.server!.once('error', () => resolve(false));
      this.server!.listen(port, '127.0.0.1', () => resolve(true));
    });
    // Never keep the host process alive just for this listener (stdio hosts
    // exit when the client closes stdin; the OS reclaims the socket anyway).
    if (localListener) this.server!.unref();
    else this.stopListener();

    const hint = localListener
      ? '浏览器完成授权后会自动回连本机。完成后调用 login_status 确认。'
      : '本机端口不可用，请在完成浏览器授权后复制地址栏完整 URL，调用 paste_callback 粘贴。';
    return { authorizeUrl, redirectUri: this.redirectUri, localListener, hint };
  }

  /** Headless completion: exchange a pasted callback URL. */
  async paste(rawUrl: string): Promise<{ ok: boolean; message: string }> {
    const params = parseCallback(rawUrl);
    if (!params) {
      return { ok: false, message: '无法识别链接：需要包含 code 与 state 参数的完整回调地址。' };
    }
    return this.complete(params, null);
  }

  private async complete(
    params: URLSearchParams,
    res: http.ServerResponse | null,
  ): Promise<{ ok: boolean; message: string }> {
    const finish = (ok: boolean, message: string) => {
      if (res) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          `<meta charset="utf-8"><body style="font:15px/1.7 system-ui;max-width:30rem;margin:18vh auto;text-align:center">` +
            `<h1>${ok ? '✅ 授权成功' : '❌ 授权失败'}</h1><p>${message}</p>` +
            `<p>可以关闭此页面，回到 Claude 继续。</p></body>`,
        );
      }
      this.stopListener();
      return { ok, message };
    };

    const err = params.get('error');
    if (err) return finish(false, `Microsoft 返回错误：${err}`);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || state !== this.pendingState?.state || !this.pendingState) {
      return finish(false, 'state 不匹配或已过期，请重新调用 start_login。');
    }
    const verifier = this.pendingState.verifier;
    this.pendingState = null; // one-shot
    try {
      await this.provider.exchangeCode(code, this.redirectUri, verifier);
      return finish(true, 'Microsoft To Do 已连接，令牌已安全保存。');
    } catch (e) {
      return finish(false, `令牌交换失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  status(): { connected: boolean; loginPending: boolean; expiresInSeconds?: number } {
    return {
      connected: this.provider.isAuthenticated(),
      loginPending: !!this.pendingState && Date.now() < this.expiresAt,
      ...(this.pendingState && Date.now() < this.expiresAt
        ? { expiresInSeconds: Math.max(0, Math.floor((this.expiresAt - Date.now()) / 1000)) }
        : {}),
    };
  }

  /** Abort a pending login and release the loopback listener. */
  cancel(): void {
    this.pendingState = null;
    this.stopListener();
  }

  private stopListener(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

function parseCallback(rawInput: string): URLSearchParams | null {
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

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
    srv.on('error', reject);
  });
}
