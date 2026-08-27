# mstodo-bridge

[![npm](https://img.shields.io/npm/v/mstodo-bridge)](https://www.npmjs.com/package/mstodo-bridge)
[![license](https://img.shields.io/npm/l/mstodo-bridge)](./LICENSE)

**Manage your Microsoft To Do from Claude.** A local MCP server — zero-config install, sign-in happens inside the chat.

English | [简体中文](./README.zh-CN.md)


## Install

**Claude Code** — one line, all projects:

```bash
claude mcp add -s user taskbridge -- npx -y mstodo-bridge
```

**Claude Desktop** — edit the config file (Windows `%APPDATA%\Claude\claude_desktop_config.json`, macOS `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "taskbridge": {
      "command": "npx",
      "args": ["-y", "mstodo-bridge"]
    }
  }
}
```

**Cursor / other MCP clients** — add `npx -y mstodo-bridge` as a stdio command. Restart the client.

That is the whole install. Everything runs locally; the only files written are your credentials in `~/.mstodo-bridge`.

## Sign in

Just say:

> Connect my Microsoft To Do

Claude calls the `login` tool and hands you a link → open it → consent with your personal Microsoft account → done. Tokens refresh automatically. Then talk naturally:

> Show my lists · Add X to “Research”, due Friday · Find tasks mentioning “paper” · Complete #3

**Running the MCP server on a remote host?** The consent redirect lands on *your* machine's `localhost` and shows an error page — expected. Copy that address-bar URL into the chat; Claude calls `login` with it to finish. No console, no tokens to copy.

## Tools (15)

| Tool | Args | Description |
|---|---|---|
| `login` | `callbackUrl?` | **One tool, whole flow.** No args = start (returns the authorize URL plus a ready-to-relay user message; binds an ephemeral local listener). Pass the pasted address-bar URL = finish the exchange. |
| `logout` | — | Disconnect: deletes local tokens and any pending login (Microsoft-side consent is revoked at account.microsoft.com). |
| `login_status` | — | Connected? Login pending? Seconds left? |
| `list_providers` | — | Provider status and capability flags. |
| `list_task_lists` | `provider?` | List folders |
| `create_task_list` | `name` | Create a folder |
| `delete_task_list` | `listId` | Delete folder and tasks (irreversible) |
| `list_tasks` | `listId?`, `includeCompleted?`, `cursor?` | List tasks; omit `listId` to aggregate across all folders; `cursor` pages |
| `get_task` | `listId`, `taskId` | One task |
| `search_tasks` | `query` | Substring search over titles and notes |
| `create_task` | `title`, `listId?`, `notes?`, `dueDate?`, `parentTaskId?` | ISO date or RFC 3339 due; defaults to the default list |
| `update_task` | `listId`, `taskId`, `title?`, `notes?`, `dueDate?`, `status?` | Partial update; `dueDate: null` clears; `status` = `completed` / `needsAction` |
| `complete_task` | `listId`, `taskId` | Mark done |
| `delete_task` | `listId`, `taskId` | Delete |
| `move_task_between_lists` | `fromListId`, `taskId`, `toListId` | Recreate in target list, delete the original |

## Configuration

| Env | Purpose |
|---|---|
| `TASKBRIDGE_PROXY` / `HTTPS_PROXY` | Outbound http(s) proxy for Microsoft endpoints (SOCKS: use your proxy client's mixed port) |
| `TASKBRIDGE_MS_CLIENT_ID` | Override the built-in OAuth client id |
| `TASKBRIDGE_CONFIG_DIR` | Credential dir (default `~/.mstodo-bridge`; legacy `~/.taskbridge-mcp` is picked up automatically) |

## Security

Credentials stay local (`~/.mstodo-bridge`, mode 0600). The OAuth client is a public client — no secret ships in the package (same model as VS Code / Azure CLI). Sign-in uses PKCE (S256) with one-time state; expired refresh tokens are wiped and flagged for re-login. `logout` removes local tokens; Microsoft-side consent is revoked at account.microsoft.com.

## Development

```bash
git clone https://github.com/WNJXYK/MSTodo-Bridge && cd MSTodo-Bridge
npm install && npm run build && npm test
```

Issues and PRs welcome at [GitHub](https://github.com/WNJXYK/MSTodo-Bridge/issues).

## License

[MIT](./LICENSE)
