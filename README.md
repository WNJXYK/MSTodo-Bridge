# mstodo-bridge

[![npm](https://img.shields.io/npm/v/mstodo-bridge)](https://www.npmjs.com/package/mstodo-bridge)
[![license](https://img.shields.io/npm/l/mstodo-bridge)](./LICENSE)

**Manage your Microsoft To Do from Claude.** One MCP server, zero-config install, sign-in happens inside the chat.

English | [简体中文](./README.zh-CN.md)

![mstodo-bridge in action](https://raw.githubusercontent.com/WNJXYK/MSTodo-Bridge/main/docs/demo.svg)

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

**Standalone web service** — no client required:

```bash
npx mstodo-bridge --http        # admin console at http://127.0.0.1:46377/admin
```

First start prints the admin password and the MCP bearer token (shown once; only scrypt hashes are stored). Remote clients connect via `http://<host>:46377/mcp`.

## Sign in

**In Claude (recommended)** — just say:

> Connect my Microsoft To Do

Claude calls the `login` tool and hands you a link → open it → consent with your personal Microsoft account → done. Tokens refresh automatically. Then talk naturally:

> Show my lists · Add X to “Research”, due Friday · Find tasks mentioning “paper” · Complete #3

**Via the web console** — run `npx mstodo-bridge --http --open`, log in with the printed password, click **Connect** on the Microsoft To Do card. On remote hosts the browser redirect lands on `localhost` and errors — that is expected; paste the full address-bar URL into the input box to finish.

Both paths store identical credentials (`~/.mstodo-bridge`) and can be mixed freely.

## Tools (15)

**Account**

| Tool | Args | Description |
|---|---|---|
| `login` | `callbackUrl?` | **One tool, whole flow.** No args = start (returns the authorize URL plus a ready-to-relay user message with local loopback listener). Pass the pasted address-bar URL = finish the exchange (remote hosts). |
| `logout` | — | Disconnect: deletes local tokens and any pending login (Microsoft-side consent is revoked at account.microsoft.com). |
| `login_status` | — | Connected? Login pending? Seconds left? |
| `list_providers` | — | Provider status and capability flags. |

<details>
<summary><strong>Lists & tasks (11 more)</strong></summary>

| Tool | Args | Description |
|---|---|---|
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

`provider?` args can be omitted in the default single-account setup.

</details>

## Deploy

```bash
PORT=7860 HOST=0.0.0.0 PUBLIC_BASE_URL=https://<user>-<space>.hf.space npx mstodo-bridge --http
```

| Env / flag | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Admin console password (auto-generated otherwise) |
| `PUBLIC_BASE_URL` | Public URL, drives the OAuth callback target |
| `TASKBRIDGE_PROXY` / `HTTPS_PROXY` | Outbound http(s) proxy |
| `TASKBRIDGE_MS_CLIENT_ID` | Override the built-in OAuth client id |
| `TASKBRIDGE_CONFIG_DIR` | Credential dir (default `~/.mstodo-bridge`) |
| `--port` / `PORT` | Listen port (default 46377; hosted platforms use `PORT`) |

## Security

Credentials stay local (`~/.mstodo-bridge`, mode 0600). Passwords and tokens are stored as scrypt hashes and compared in constant time. OAuth uses PKCE (S256) with one-time state. The admin console runs a strict CSP with login rate limiting. Expired refresh tokens are wiped and flagged for re-login.

## Development

```bash
git clone https://github.com/WNJXYK/MSTodo-Bridge && cd MSTodo-Bridge
npm install && npm run build && npm test
```

Issues and PRs welcome at [GitHub](https://github.com/WNJXYK/MSTodo-Bridge/issues).

## License

[MIT](./LICENSE)
