#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTaskBridgeServer } from './server.js';
import { providerStatuses } from './registry.js';
import { VERSION } from './version.js';

/**
 * mstodo-bridge — local stdio MCP server for Microsoft To Do.
 *
 * Everything is local: tools are driven from the chat, login binds an
 * ephemeral loopback listener on demand, and the paste-back flow covers
 * hosts where the browser runs elsewhere. No HTTP mode, no GUI.
 */

function printHelp(): void {
  console.log(`mstodo-bridge ${VERSION} — MCP server for Microsoft To Do (local stdio)

Usage:
  mstodo-bridge            start the stdio MCP server (Claude Desktop, Claude Code, Cursor, ...)
  mstodo-bridge --version  print the version

Environment:
  TASKBRIDGE_PROXY / HTTPS_PROXY   outbound proxy for Microsoft endpoints (http/https)
  TASKBRIDGE_MS_CLIENT_ID          override the built-in OAuth client id
  TASKBRIDGE_CONFIG_DIR            credential dir (default ~/.mstodo-bridge,
                                   falls back to legacy ~/.taskbridge-mcp)

Login is done from the chat: ask Claude to connect Microsoft To Do and it
calls the login tool. On hosts where the browser redirect cannot come back,
paste the final address-bar URL and Claude finishes with the same tool.`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(`mstodo-bridge ${VERSION}`);
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }
  if (argv.length > 0) {
    console.error(`Unknown option: ${argv[0]} — this build is a local stdio server only.`);
    printHelp();
    process.exit(1);
  }

  const { server, registry } = createTaskBridgeServer();
  const connected = providerStatuses(registry).some((p) => p.connected);
  if (!connected) {
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
