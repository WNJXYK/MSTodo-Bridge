#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTaskBridgeServer } from './server.js';
import { startHttpServer } from './httpserver.js';
import { VERSION } from './version.js';
import { providerStatuses } from './registry.js';
import { spawn } from 'node:child_process';

interface CliArgs {
  http: boolean;
  port: number;
  host: string;
  publicUrl?: string;
  open: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    http: false,
    port: Number(process.env.PORT ?? 46377),
    host: process.env.HOST ?? (process.env.PORT || process.env.PUBLIC_BASE_URL ? '0.0.0.0' : '127.0.0.1'),
    publicUrl: process.env.PUBLIC_BASE_URL,
    open: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--http') args.http = true;
    else if (a === '--open') args.open = true;
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--host') args.host = argv[++i]!;
    else if (a === '--public-url') args.publicUrl = argv[++i]!;
    else if (a === '--version' || a === '-v') {
      console.log(`mstodo-bridge ${VERSION}`);
      process.exit(0);
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown option: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`mstodo-bridge — MCP server for Microsoft To Do

Usage:
  mstodo-bridge                 stdio MCP server (for Claude Desktop, Cursor, ...)
  mstodo-bridge --http          HTTP server with admin web GUI
                                (first run prints the admin password and MCP token)

Options:
  --http                 serve MCP over streamable HTTP + web GUI
  --port <n>             HTTP port (default: PORT env or 46377)
  --host <addr>          bind address (default: 127.0.0.1; 0.0.0.0 when PORT is set)
  --public-url <url>     external base URL (needed for OAuth callbacks behind a proxy,
                         e.g. Hugging Face Spaces: https://<user>-<space>.hf.space).
                         OAuth callback stays registered as http://localhost:<p>/oauth/mstodo/callback;
                         Entra ignores loopback ports and remote users paste the bar URL back.
  --open                 open the admin GUI in the default browser
  --version, --help

Environment:
  ADMIN_PASSWORD                  admin GUI password (otherwise generated on first run)
  TASKBRIDGE_MS_CLIENT_ID         override the built-in Entra public-client app id
  TASKBRIDGE_CONFIG_DIR           config/token storage dir (default ~/.mstodo-bridge)
  TASKBRIDGE_PROXY / HTTPS_PROXY  outbound proxy for Graph/login endpoints`);
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open'
    : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  } catch {
    // Opening a browser is best-effort only.
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.http) {
    const server = startHttpServer({
      port: args.port,
      host: args.host,
      publicBaseUrl: args.publicUrl,
    });
    if (args.open) {
      const base = args.publicUrl ?? `http://localhost:${args.port}`;
      openBrowser(`${base}/admin`);
    }
    const shutdown = () => server.close(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  // stdio mode — stdout belongs to the MCP protocol, so keep it silent.
  const { server, registry } = createTaskBridgeServer();
  const connected = providerStatuses(registry).filter((p) => p.connected);
  if (connected.length === 0) {
    console.error(
      'mstodo-bridge: Microsoft To Do not connected yet — no setup needed. In your chat, ask the assistant to connect it; it will call the login tool and give you a link.',
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
