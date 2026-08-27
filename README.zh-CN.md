# mstodo-bridge

[![npm](https://img.shields.io/npm/v/mstodo-bridge)](https://www.npmjs.com/package/mstodo-bridge)
[![license](https://img.shields.io/npm/l/mstodo-bridge)](./LICENSE)

**在 Claude 里直接管理 Microsoft To Do。** 一个 MCP 服务器,零配置安装,登录就在对话里完成。

[English](./README.md) | 简体中文

![mstodo-bridge 演示](https://raw.githubusercontent.com/WNJXYK/MSTodo-Bridge/main/docs/demo.svg)

## 安装

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

**独立 Web 服务** —— 不挂在任何客户端下:

```bash
npx mstodo-bridge --http        # 管理台 http://127.0.0.1:46377/admin
```

首次启动打印**管理密码**与 **MCP Bearer 令牌**(仅显示一次,均只存 scrypt 哈希)。远程客户端经 `http://<host>:46377/mcp` 接入。

## 登录

**在 Claude 里(推荐)** —— 直接说:

> 帮我连接 Microsoft To Do

Claude 调用 `login` 工具给你一条授权链接 → 浏览器打开 → 微软个人账户同意 → 自动回连完成,令牌自动续期。之后自然语言操作:

> 看看我的清单 · 把 X 加到"科研学术",周五截止 · 搜含"论文"的任务 · 完成第 3 条

**通过 Web 管理台** —— `npx mstodo-bridge --http --open`,用打印的密码登录,在 Microsoft To Do 卡片点「连接账户」。远程环境下授权后会跳到 `localhost` 并报错 —— 属预期现象,把地址栏完整 URL 粘贴进输入框即完成。

两种方式凭据完全相同(`~/.mstodo-bridge`),可混用。

## 工具(15 个)

**账户**

| 工具 | 参数 | 说明 |
|---|---|---|
| `login` | `callbackUrl?` | **一个工具走完登录**:不带参数=开始(返回授权链接与可直接转发的话术,本机自动挂回调监听);带上用户粘贴的地址栏 URL=完成交换(远程场景) |
| `logout` | — | 断开:删除本地令牌与进行中的登录(微软侧授权需到 account.microsoft.com 撤销) |
| `login_status` | — | 是否已连接、登录是否进行中及剩余秒数 |
| `list_providers` | — | provider 状态与能力声明 |

<details>
<summary><strong>清单与任务(11 个)</strong></summary>

| 工具 | 参数 | 说明 |
|---|---|---|
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

单账户模式下 `provider?` 参数可省略。

</details>

## 部署

```bash
PORT=7860 HOST=0.0.0.0 PUBLIC_BASE_URL=https://<user>-<space>.hf.space npx mstodo-bridge --http
```

| 环境变量 / 参数 | 说明 |
|---|---|
| `ADMIN_PASSWORD` | 管理台密码(缺省自动生成) |
| `PUBLIC_BASE_URL` | 对外地址,决定授权回调目标 |
| `TASKBRIDGE_PROXY` / `HTTPS_PROXY` | 出站 http(s) 代理 |
| `TASKBRIDGE_MS_CLIENT_ID` | 覆盖内置 OAuth 客户端 ID |
| `TASKBRIDGE_CONFIG_DIR` | 凭据目录(默认 `~/.mstodo-bridge`) |
| `--port` / `PORT` | 监听端口(默认 46377;托管平台用 `PORT`) |

## 安全

凭据只落本地(`~/.mstodo-bridge`,0600 权限);密码与令牌仅存 scrypt 哈希、恒定时间比较;OAuth 全程 PKCE + 一次性 state;管理台严格 CSP、登录限速;刷新令牌失效自动清除并引导重连。

## 开发

```bash
git clone https://github.com/WNJXYK/MSTodo-Bridge && cd MSTodo-Bridge
npm install && npm run build && npm test
```

Issue 与 PR 欢迎提交至 [GitHub](https://github.com/WNJXYK/MSTodo-Bridge/issues)。

## License

[MIT](./LICENSE)
