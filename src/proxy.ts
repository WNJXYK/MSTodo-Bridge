import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { readJson, writeJson } from './storage.js';

/**
 * Outbound proxy for Microsoft Graph / login endpoint calls.
 *
 * Node's global fetch ignores HTTP(S)_PROXY env vars, so we route requests
 * through undici's ProxyAgent explicitly. Precedence:
 *   1. value saved via the admin GUI (proxy.json)
 *   2. TASKBRIDGE_PROXY
 *   3. HTTPS_PROXY / https_proxy, then HTTP_PROXY / http_proxy
 *
 * Only http:// and https:// proxies are supported. SOCKS users should point
 * at their proxy client's HTTP/mixed port (e.g. Clash's 7890) instead.
 */

const PROXY_FILE = 'proxy.json';

export type ProxySource = 'config' | 'env';

export interface ProxyStatus {
  active: boolean;
  /** Safe for display: the password part is masked. */
  maskedUrl: string | null;
  source: ProxySource | null;
}

function supportedScheme(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const scheme = new URL(url).protocol;
    return scheme === 'http:' || scheme === 'https:';
  } catch {
    return false;
  }
}

function envProxy(): string | undefined {
  const direct = process.env.TASKBRIDGE_PROXY;
  if (supportedScheme(direct)) return direct;
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const v = process.env[key];
    if (supportedScheme(v)) return v;
  }
  return undefined;
}

export function getProxyUrl(): { url: string; source: ProxySource } | null {
  const stored = readJson<{ url?: string }>(PROXY_FILE)?.url;
  if (supportedScheme(stored)) return { url: stored, source: 'config' };
  const fromEnv = envProxy();
  if (fromEnv) return { url: fromEnv, source: 'env' };
  return null;
}

/** Persist (or clear, with null/'') the GUI-configured proxy. */
export function setProxyUrl(url: string | null): void {
  writeJson(PROXY_FILE, url ? { url } : {});
}

/** Throws a user-actionable message for anything we cannot route through. */
export function assertValidProxyUrl(url: string): string {
  const trimmed = url.trim();
  let scheme: string;
  try {
    scheme = new URL(trimmed).protocol;
  } catch {
    throw new Error(`无法解析代理地址：“${trimmed}”`);
  }
  if (scheme !== 'http:' && scheme !== 'https:') {
    throw new Error(
      `不支持的代理协议 ${scheme}//，仅支持 http/https（SOCKS 端口不可用，请填代理软件的 HTTP/混合端口，如 Clash 的 7890）`,
    );
  }
  return trimmed;
}

export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url;
  }
}

export function proxyStatus(): ProxyStatus {
  const cur = getProxyUrl();
  if (!cur) return { active: false, maskedUrl: null, source: null };
  return { active: true, maskedUrl: maskProxyUrl(cur.url), source: cur.source };
}

// ---------- dispatcher ----------

const agents = new Map<string, ProxyAgent>();

function dispatcherFor(url: string): ProxyAgent {
  let agent = agents.get(url);
  if (!agent) {
    agent = new ProxyAgent(url);
    agents.set(url, agent);
  }
  return agent;
}

export function proxyFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const cur = getProxyUrl();
  // undici's RequestInit differs slightly from the DOM lib's; the shapes we
  // pass are compatible, so bridge the types once here.
  const bridge = (extra?: Record<string, unknown>) =>
    undiciFetch(input, { ...init, ...extra } as never) as unknown as Promise<Response>;
  if (!cur) return bridge();
  return bridge({ dispatcher: dispatcherFor(cur.url) });
}

// ---------- connectivity probe ----------

export interface ProxyTestResult {
  target: string;
  /** Any HTTP response counts as reachable, even 401/404. */
  ok: boolean;
  status?: number;
  ms?: number;
  error?: string;
}

const PROBE_TARGETS: { name: string; url: string }[] = [
  { name: 'Microsoft 登录', url: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration' },
  { name: 'Microsoft Graph', url: 'https://graph.microsoft.com/v1.0/$metadata' },
];

/**
 * Probe both provider backends. Tests `candidateUrl` when given (unsaved
 * input from the GUI), otherwise the currently active proxy.
 */
export async function testProxy(candidateUrl?: string): Promise<ProxyTestResult[]> {
  let dispatcher: ProxyAgent | undefined;
  if (candidateUrl) {
    dispatcher = new ProxyAgent(candidateUrl);
  } else {
    const cur = getProxyUrl();
    if (cur) dispatcher = dispatcherFor(cur.url);
  }

  const probe = async (name: string, url: string): Promise<ProxyTestResult> => {
    const start = Date.now();
    try {
      const res = await undiciFetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        ...(dispatcher ? ({ dispatcher } as never) : {}),
      });
      return { target: name, ok: true, status: res.status, ms: Date.now() - start };
    } catch (err) {
      return {
        target: name,
        ok: false,
        ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  return Promise.all(PROBE_TARGETS.map((t) => probe(t.name, t.url)));
}
