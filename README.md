# taskbridge-mcp

[![npm](https://img.shields.io/npm/v/taskbridge-mcp)](https://www.npmjs.com/package/taskbridge-mcp)
[![license](https://img.shields.io/npm/l/taskbridge-mcp)](./LICENSE)

一个 MCP(Model Context Protocol)服务器,把 **Microsoft To Do** 接进 Claude Desktop、Claude Code、Cursor 等任意 MCP 客户端。

最大特色:**登录在对话里完成** —— 装好就问 Claude「连接我的 To Do」,它调用 `start_login` 给你一条授权链接,点一下同意即可;浏览器回不到本机(远程/容器部署)时,把地址栏最终 URL 粘贴回对话,由 `paste_callback` 完成令牌交换。

```
Claude / Cursor / 任意 MCP 客户端
        │
        │  stdio 或 Streamable HTTP (Bearer)
        ▼
┌──────────────────────────────────────────┐
│              taskbridge-mcp              │
│                                          │
│  login_status · start_login · paste_…    │
│  list_tasks · create_task · search_tasks │
│                                          │
│        ┌─────────────────────────┐       │
│        │ Microsoft To Do (Graph) │       │
│        └─────────────────────────┘       │
└──────────────────────────────────────────┘
```

## 30 秒上手

### Claude Desktop

编辑 `%APPDATA%\Claude\claude_desktop_config.json`(Windows)或
`~/Library/Application Support/Claude/claude_desktop_config.json`(macOS):

```json
{
  "mcpServers": {
    "taskbridge": {
      "command": "npx",
      "args": ["-y", "taskbridge-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add -s user taskbridge -- npx -y taskbridge-mcp
```

重启客户端,然后直接说:

> 帮我连接 Microsoft To Do

Claude 会调用 `start_login` 并给你一条链接 → 浏览器打开 → 用你的微软个人账户同意 → 完成。全部权限:`Tasks.ReadWrite offline_access User.Read`,不需要管理员参与。

## 工具一览

| 工具 | 作用 |
|---|---|
| `login_status` | 是否已连接 |
| `start_login` | 开始登录,返回授权链接(自动绑定临时本机端口接收回调) |
| `paste_callback` | 远程场景:粘贴授权后地址栏的完整 URL 完成连接 |
| `list_task_lists` / `create_task_list` / `delete_task_list` | 清单管理 |
| `list_tasks` / `get_task` / `search_tasks` | 读任务(支持跨清单聚合与子串搜索) |
| `create_task` / `update_task` / `complete_task` / `delete_task` | 写任务(标题、备注、截止日) |
| `move_task_between_lists` | 跨清单移动(复制到目标清单后删除原件) |

## 可选:Web 管理台

```bash
npx taskbridge-mcp --http        # 默认 http://127.0.0.1:46377/admin
```

- 首次启动打印**管理密码**与 **MCP Bearer 令牌**(仅显示一次,均只存 scrypt 哈希)
- 浏览器里可连接/断开账户、轮换令牌、查看内存/CPU/运行时长
- **网络代理面板**:国内直连 `login.microsoftonline.com` 不稳时可配置 http/https 代理(也读 `HTTPS_PROXY` 等环境变量),对令牌交换同样生效;带连通性实测
- HTTP 模式的 MCP 端点:`http://<host>:46377/mcp`,`Authorization: Bearer <令牌>`

```bash
claude mcp add -s user --transport http taskbridge http://127.0.0.1:46377/mcp --header "Authorization: Bearer <令牌>"
```

## 部署到服务器 / Hugging Face Spaces

```bash
PORT=7860 HOST=0.0.0.0 PUBLIC_BASE_URL=https://<user>-<space>.hf.space npx taskbridge-mcp --http
```

- `PUBLIC_BASE_URL` 决定管理台里展示的回调地址;浏览器授权后会跳到**用户本机**的 localhost —— 页面打不开是预期的,把地址栏 URL 粘进管理台(或让 Claude 调 `paste_callback`)即可
- 数据目录默认 `~/.taskbridge-mcp`,HF 等临时磁盘请挂持久卷或用环境变量保存状态
- `ADMIN_PASSWORD` 可预设管理密码;`PORT`/`HOST` 与 CLI 参数等价

## 环境变量

| 变量 | 说明 |
|---|---|
| `ADMIN_PASSWORD` | Web 管理台密码(缺省首次启动生成并打印) |
| `TASKBRIDGE_MS_CLIENT_ID` | 覆盖内置的 Entra 公共客户端应用 ID |
| `TASKBRIDGE_MS_AUTHORITY` | 授权端点租户(默认 `/common`,个人账户专用可设 `/consumers`) |
| `TASKBRIDGE_PROXY` / `HTTPS_PROXY` | 出站代理(仅 http/https;SOCKS 请填代理软件的混合端口) |
| `TASKBRIDGE_CONFIG_DIR` | 凭据存储目录(默认 `~/.taskbridge-mcp`) |
| `PORT` / `HOST` / `PUBLIC_BASE_URL` | 部署端口、绑定地址与对外地址 |

## 安全设计

- **内置应用 ID 是公共客户端**,不含任何密钥 —— 这与 VS Code、Azure CLI 同一模式,可放心随开源包分发;你在自己机器上产生的刷新令牌只落在本地 `~/.taskbridge-mcp`,权限仅为你的待办读写
- 管理密码与 MCP 令牌仅存 scrypt 哈希,校验恒定时间比较;登录按 IP 限速;会话 Cookie HMAC 签名;管理台带严格 CSP,无第三方资源
- OAuth 使用 PKCE(S256)+ 一次性 state(10 分钟 TTL),刷新令牌过期/吊销时自动清除并提示重连

## 故障排查

- **授权页报 "…tenant 'Microsoft Services'…"**:应用受众与账户不匹配(老版注册);用内置应用 ID 时不会出现,若自定义应用请把 `signInAudience` 设为 `AzureADandPersonalMicrosoftAccount`
- **用 Gmail 别名的微软账户无法在 Entra 建应用**:个人账户没有目录;加入免费的 [M365 开发者计划](https://developer.microsoft.com/microsoft-365/dev-program)获取沙盒目录即可(应用可注册在任意目录,数据仍是你的个人账户)
- **`invalid_grant`**:改过密码 / 90 天未用 / 撤销授权 → 重新 `start_login`
- **企业组织账户提示需管理员批准**:未验证发布者的多租户应用属正常现象,个人账户不受影响

## 开发

```bash
git clone https://github.com/wnjxyk/taskbridge-mcp && cd taskbridge-mcp
npm install
npm run build && npm test   # 40+ 单元测试
npm start -- --http --open  # 本地起管理台
```

## License

[MIT](./LICENSE)
