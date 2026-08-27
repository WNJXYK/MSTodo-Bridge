import { ProxyAgent, fetch as undiciFetch } from 'undici';

/**
 * Outbound proxy for Microsoft Graph / login endpoints, configured purely via
 * environment variables (local CLI/MCP only — no GUI).
 *
 * Precedence: TASKBRIDGE_PROXY > HTTPS_PROXY / https_proxy > HTTP_PROXY / http_proxy.
 * Only http:// and https:// proxies are honored; unsupported schemes (e.g.
 * SOCKS) are ignored silently — point at your proxy client's mixed port instead.
 */

function supportedScheme(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const scheme = new URL(url).protocol;
    return scheme === 'http:' || scheme === 'https:';
  } catch {
    return false;
  }
}

export function getProxyUrl(): string | null {
  if (supportedScheme(process.env.TASKBRIDGE_PROXY)) return process.env.TASKBRIDGE_PROXY!;
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    if (supportedScheme(process.env[key])) return process.env[key]!;
  }
  return null;
}

const agents = new Map<string, ProxyAgent>();

function dispatcherFor(url: string): ProxyAgent {
  let agent = agents.get(url);
  if (!agent) {
    agent = new ProxyAgent(url);
    agents.set(url, agent);
  }
  return agent;
}

/** fetch() replacement honoring the configured proxy. */
export function proxyFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = getProxyUrl();
  // undici's RequestInit differs slightly from the DOM lib's; bridge once.
  const bridge = (extra?: Record<string, unknown>) =>
    undiciFetch(input, { ...init, ...extra } as never) as unknown as Promise<Response>;
  if (!url) return bridge();
  return bridge({ dispatcher: dispatcherFor(url) });
}
