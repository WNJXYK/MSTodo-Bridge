import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTaskTools } from './tools.js';
import type { ManagedProvider } from './registry.js';

export const SERVER_NAME = 'taskbridge-mcp';
export const SERVER_VERSION = '0.2.0';

export interface TaskBridgeServer {
  server: McpServer;
  registry: Map<string, ManagedProvider>;
}

/** Fresh server per connection/request; providers re-read tokens from disk. */
export function createTaskBridgeServer(): TaskBridgeServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const registry = registerTaskTools(server);
  return { server, registry };
}
