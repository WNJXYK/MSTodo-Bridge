# Microsoft TODO Bridge

[![npm](https://img.shields.io/npm/v/mstodo-bridge)](https://www.npmjs.com/package/mstodo-bridge)
[![license](https://img.shields.io/npm/l/mstodo-bridge)](./LICENSE)

**在 Claude 里直接管理 Microsoft To Do。** 本地 MCP 服务器，登录就在对话里完成。

[English](./README.md) | 简体中文


## 📦 安装

**Claude Code** —— 一行命令,全局生效:

```bash
claude mcp add -s user taskbridge -- npx -y mstodo-bridge
```

**Claude Desktop** —— 编辑配置文件(Windows `%APPDATA%\Claude\claude_desktop_config.json`,macOS `~/Library/Application Support/Claude/claude_desktop_config.json`):

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

**Cursor / 其它 MCP 客户端** —— 以 `npx -y mstodo-bridge` 作为 stdio 命令添加。保存后重启客户端。

安装到此为止。所有东西都在本地运行,唯一写入磁盘的是 `~/.mstodo-bridge` 里的凭据。

## 🔑 登录

直接说:

> 帮我连接 Microsoft To Do

Claude 调用 `login` 工具给你一条授权链接 → 浏览器打开 → 微软个人账户同意 → 自动回连完成,令牌自动续期。之后自然语言操作:

> 看看我的清单 · 把 X 加到"科研学术",周五截止 · 搜含"论文"的任务 · 完成第 3 条

**MCP 服务器跑在远程主机上?** 授权完成后浏览器会跳到*你本机*的 `localhost` 并显示错误页 —— 这是预期行为。把地址栏完整 URL 复制回对话,Claude 调用 `login` 完成连接。无需控制台,无需手动拷贝令牌。

## 🧰 工具（15 个）

| 工具 | 参数 | 说明 |
|---|---|---|
| `login` | `callbackUrl?` | **一个工具走完登录**:不带参数=开始(返回授权链接与可直接转发的话术,并绑定临时本机回调监听);带上用户粘贴的地址栏 URL=完成交换 |
| `logout` | — | 断开:删除本地令牌与进行中的登录(微软侧授权需到 account.microsoft.com 撤销) |
| `login_status` | — | 是否已连接、登录是否进行中及剩余秒数 |
| `list_providers` | — | provider 状态与能力声明 |
| `list_task_lists` | `provider?` | 列出全部清单 |
| `create_task_list` | `name` | 新建清单 |
| `delete_task_list` | `listId` | 删除清单及其任务(不可恢复) |
| `list_tasks` | `listId?`, `includeCompleted?`, `cursor?` | 列任务;省略 `listId` 跨清单聚合;`cursor` 翻页 |
| `get_task` | `listId`, `taskId` | 单条详情 |
| `search_tasks` | `query` | 标题与备注子串搜索 |
| `create_task` | `title`, `listId?`, `notes?`, `dueDate?`, `parentTaskId?` | `dueDate` 接受 ISO 日期或 RFC 3339;省略清单入默认清单 |
| `update_task` | `listId`, `taskId`, `title?`, `notes?`, `dueDate?`, `status?` | 局部更新;`dueDate: null` 清除;`status` 为 `completed` / `needsAction` |
| `complete_task` | `listId`, `taskId` | 标记完成 |
| `delete_task` | `listId`, `taskId` | 删除 |
| `move_task_between_lists` | `fromListId`, `taskId`, `toListId` | 跨清单移动(目标清单重建后删除原件) |

## ⚙️ 配置

| 环境变量 | 说明 |
|---|---|
| `TASKBRIDGE_PROXY` / `HTTPS_PROXY` | 访问 Microsoft 端点的出站 http(s) 代理(SOCKS 请填代理软件混合端口) |
| `TASKBRIDGE_MS_CLIENT_ID` | 覆盖内置 OAuth 客户端 ID |
| `TASKBRIDGE_CONFIG_DIR` | 凭据目录(默认 `~/.mstodo-bridge`;旧版 `~/.taskbridge-mcp` 自动兼容) |

## 🔒 安全

凭据只落本地(`~/.mstodo-bridge`,0600 权限)。内置 OAuth 客户端为公共客户端,包内不含任何密钥(与 VS Code、Azure CLI 同模式)。登录全程 PKCE(S256)+ 一次性 state;刷新令牌失效自动清除并引导重连。`logout` 删除本地令牌，微软侧授权需到 account.microsoft.com 撤销。

## License

[MIT](./LICENSE)
