# mstodo-bridge

[![npm](https://img.shields.io/npm/v/mstodo-bridge)](https://www.npmjs.com/package/mstodo-bridge)
[![license](https://img.shields.io/npm/l/mstodo-bridge)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-40%20passing-brightgreen)]()

**在 Claude 里直接管理 Microsoft To Do。** 一个 MCP 服务器,零配置安装,登录就在对话里完成。

```bash
claude mcp add -s user taskbridge -- npx -y mstodo-bridge
```

## 特性

- **对话内登录** —— 无需注册 OAuth 应用、无需网页控制台:Claude 调用 `start_login` 给你一条链接,点一下同意即完成;刷新令牌自动续期
- **远程可连** —— 浏览器回不到服务器(容器/云部署)时,把地址栏 URL 粘贴回对话,`paste_callback` 完成交换
- **内置公共客户端** —— OAuth 客户端 ID 随包分发(与 VS Code、Azure CLI 同模式),个人账户开箱即用
- **双运行模式** —— stdio 供本地客户端直连;`--http` 提供 Bearer 端点与 Web 管理台,适配 Hugging Face Spaces 等托管环境
- **国内友好** —— 内置 http/https 出站代理配置(含连通性实测),`login.microsoftonline.com` 直连不稳也能用

## 使用

重启客户端后,直接说:

> 帮我连接 Microsoft To Do

然后就可以自然语言操作任务:

> 看看我的清单 · 把 X 加到"科研学术",周五截止 · 搜含"论文"的任务 · 完成第 3 条

## MCP 工具(15 个)

**账户与登录**

| 工具 | 参数 | 说明 |
|---|---|---|
| `login_status` | — | 是否已连接、登录是否进行中及剩余秒数 |
| `start_login` | — | 开始登录:返回授权链接并在本机随机端口挂回调监听 |
| `paste_callback` | `url` | 粘贴授权后地址栏完整 URL,完成令牌交换(远程/无回调场景) |
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

## Web 管理台(可选)

```bash
npx mstodo-bridge --http        # http://127.0.0.1:46377/admin
```

连接账户、轮换 MCP Bearer 令牌、配置代理、查看内存/CPU —— 首次启动打印管理密码与令牌(仅显示一次,均只存 scrypt 哈希)。

## 部署

```bash
PORT=7860 HOST=0.0.0.0 PUBLIC_BASE_URL=https://<user>-<space>.hf.space npx mstodo-bridge --http
```

| 环境变量 | 说明 |
|---|---|
| `ADMIN_PASSWORD` | 管理台密码(缺省自动生成) |
| `PUBLIC_BASE_URL` | 对外地址,决定授权回调的展示与跳转 |
| `TASKBRIDGE_PROXY` / `HTTPS_PROXY` | 出站代理(仅 http/https) |
| `TASKBRIDGE_MS_CLIENT_ID` | 覆盖内置 OAuth 客户端 ID |
| `TASKBRIDGE_CONFIG_DIR` | 凭据目录(默认 `~/.mstodo-bridge`) |

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
