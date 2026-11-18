# 使用 Gemini 调用 NovelAI MCP

个人版 Gemini 网页和手机 App 的「已连接的应用」没有添加自定义 MCP 地址的设置。[Google Gemini 帮助](https://support.google.com/gemini/answer/13695044)

## 通过 Google Antigravity 桌面端连接

1. 在运行 Antigravity 的电脑上开启 SSH 转发。把 `user@server` 换成自己平时登录服务器的地址，使用期间保持终端打开。

   ```bash
   ssh -N -L 13003:127.0.0.1:3003 user@server
   ```

2. 在 Antigravity 代理侧栏右上角依次选择 `… → MCP Servers → Manage MCP Servers → View raw config`。将下列条目合并到现有的 `mcpServers` 字段，保存后刷新服务器列表。

   ```json
   {
     "mcpServers": {
       "novelai": {
         "serverUrl": "http://127.0.0.1:13003/mcp"
       }
     }
   }
   ```

3. 确认工具列表出现 `generate_image`，然后输入「请用 NovelAI 的 generate_image 生成一张方形的月光森林插画」。要用 V5 时可以明确写「使用 NovelAI V5 Full」。工具返回 PNG，客户端的图片显示方式取决于应用。

NovelAI 密钥由 MCP 服务端管理。HTTP 入口本身没有客户端鉴权，跨机器连接请使用 SSH 转发或现有私有网络。[Antigravity MCP 文档](https://antigravity.google/docs/mcp)

Google 个人账号的旧 Gemini CLI 订阅登录已迁往 Antigravity。使用 Gemini API 密钥或 Vertex AI 的环境仍可按 Gemini CLI 文档接入。[Google 迁移公告](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli) · [Gemini CLI 的 MCP 文档](https://geminicli.com/docs/tools/mcp-server/)

## 自己开发 Gemini 应用

自己的应用可以连接 NovelAI MCP，将 `generate_image` 注册成 Gemini 函数工具，再接收与展示 PNG。若直接用 Interactions API 的远端 MCP 功能，Google 的服务端需要能访问带鉴权的 Streamable HTTP 地址。当前本机入口适合经 SSH 或私有网络由自己的应用访问。[Gemini API 工具调用文档](https://ai.google.dev/gemini-api/docs/function-calling#remote-mcp)
