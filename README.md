# mstodo-bridge

[![npm](https://img.shields.io/npm/v/mstodo-bridge)](https://www.npmjs.com/package/mstodo-bridge)
[![license](https://img.shields.io/npm/l/mstodo-bridge)](./LICENSE)

**在 Claude 里直接管理 Microsoft To Do。** 一个 MCP 服务器,零配置安装,登录就在对话里完成。

## 安装

### 1. 安装到 Claude Code

```bash
claude mcp add -s user taskbridge -- npx -y mstodo-bridge
```

`-s user` 表示全局生效(所有项目可用)。完成后重启 Claude Code 会话。

### 2. 或写入 MCP 配置文件

**Claude Desktop**:编辑配置文件(Windows `%APPDATA%\Claude\claude_desktop_config.json`,macOS `~/Library/Application Support/Claude/claude_desktop_config.json`):

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

**Cursor / 其它 MCP 客户端**:同样以 `npx -y mstodo-bridge` 作为 stdio 命令添加。保存后重启客户端。

### 3. 或启动一个 Web 服务

不需要挂在某个客户端下,也可以独立跑成带管理台的服务:

```bash
npx mstodo-bridge --http        # 管理台 http://127.0.0.1:46377/admin
```

首次启动打印**管理密码**与 **MCP Bearer 令牌**(仅显示一次)。其它客户端即可通过 `http://<host>:46377/mcp`(Bearer 鉴权)远程接入;部署到服务器/Hugging Face Spaces 见下文「部署」。

## 登录

### 方式一:在 Claude 里(推荐)

重启客户端后,直接对 Claude 说:

> 帮我连接 Microsoft To Do

Claude 会调用 `login` 工具并给你一条授权链接 → 浏览器打开 → 用微软个人账户同意 → 自动回连完成。之后就可以自然语言操作:

> 看看我的清单 · 把 X 加到"科研学术",周五截止 · 搜含"论文"的任务 · 完成第 3 条

### 方式二:通过 Web 管理台

```bash
npx mstodo-bridge --http --open
```

1. 浏览器打开管理台,输入启动时打印的管理密码登录;
2. 在 **Microsoft To Do** 卡片点「连接账户」,浏览器完成授权后自动跳回;
3. **远程环境**(浏览器与服务器不在同一台机器)授权后会跳到 `localhost` 并报错 —— 这是预期行为,把地址栏的完整 URL 粘贴进卡片的「完成连接」输入框即可。

两种方式产生的凭据完全相同(`~/.mstodo-bridge`),混用随意。

## MCP 工具(15 个)

**账户与登录**

| 工具 | 参数 | 说明 |
|---|---|---|
| `login` | `callbackUrl?` | **一个工具走完登录**:不带参数=开始,返回授权链接与给用户的话术(含本机回调监听);带上用户粘贴的地址栏 URL=完成交换(远程场景) |
| `logout` | — | 断开账户:删除本地令牌与进行中的登录(微软侧授权需到 account.microsoft.com 撤销) |
| `login_status` | — | 是否已连接、登录是否进行中及剩余秒数 |
| `list_providers` | — | 列出 provider 及其连接状态、能力声明 |

**清单**

| 工具 | 参数 | 说明 |
|---|---|---|
| `list_task_lists` | `provider?` | 列出全部清单 |
| `create_task_list` | `name`, `provider?` | 新建清单 |
| `delete_task_list` | `listId`, `provider?` | 删除清单及其任务(不可恢复) |

**任务读取**

| 工具 | 参数 | 说明 |
|---|---|---|
| `list_tasks` | `listId?`, `includeCompleted?`, `cursor?` | 列任务;省略 `listId` 则跨全部清单聚合,`cursor` 翻页 |
| `get_task` | `listId`, `taskId` | 取单条任务详情 |
| `search_tasks` | `query`, `provider?` | 跨清单子串搜索标题与备注 |

**任务写入**

| 工具 | 参数 | 说明 |
|---|---|---|
| `create_task` | `title`, `listId?`, `notes?`, `dueDate?`, `parentTaskId?` | 新建;`dueDate` 接受 ISO 日期或 RFC 3339;省略清单则入默认清单 |
| `update_task` | `listId`, `taskId`, `title?`, `notes?`, `dueDate?`, `status?` | 局部更新;`dueDate: null` 清除截止日;`status` 为 `completed` / `needsAction` |
| `complete_task` | `listId`, `taskId` | 标记完成 |
| `delete_task` | `listId`, `taskId` | 删除任务 |
| `move_task_between_lists` | `fromListId`, `taskId`, `toListId` | 跨清单移动(目标清单重建原件后删除源任务) |

> 标注 `provider?` 的参数在单账户模式下可省略。

## 部署

```bash
PORT=7860 HOST=0.0.0.0 PUBLIC_BASE_URL=https://<user>-<space>.hf.space npx mstodo-bridge --http
```

| 环境变量 / 参数 | 说明 |
|---|---|
| `ADMIN_PASSWORD` | 管理台密码(缺省自动生成) |
| `PUBLIC_BASE_URL` | 对外地址,决定授权回调的展示与跳转 |
| `TASKBRIDGE_PROXY` / `HTTPS_PROXY` | 出站代理(仅 http/https;SOCKS 请填代理软件混合端口) |
| `TASKBRIDGE_MS_CLIENT_ID` | 覆盖内置 OAuth 客户端 ID |
| `TASKBRIDGE_CONFIG_DIR` | 凭据目录(默认 `~/.mstodo-bridge`) |
| `--port` / `PORT` | 监听端口(默认 46377;托管平台用 `PORT`) |

## 安全

凭据只落本地(`~/.mstodo-bridge`,0600 权限);密码与令牌仅存 scrypt 哈希,恒定时间比较;OAuth 全程 PKCE + 一次性 state;管理台严格 CSP、登录限速。刷新令牌失效自动清除并引导重连。

## 开发

```bash
git clone https://github.com/WNJXYK/MSTodo-Bridge && cd MSTodo-Bridge
npm install && npm run build && npm test
```

Issue 与 PR 欢迎提交至 [GitHub](https://github.com/WNJXYK/MSTodo-Bridge/issues)。

## License

[MIT](./LICENSE)
