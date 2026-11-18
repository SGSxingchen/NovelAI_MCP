# 使用 Gemini 调用 NovelAI MCP

Google 的个人版 Gemini 网页和手机 App 通过「已连接的应用」使用 Google 提供的集成，目前没有添加自定义 MCP 地址的设置。[Google Gemini 帮助](https://support.google.com/gemini/answer/13695044)

已有 Gemini CLI 且账号仍可用时，可配置 Streamable HTTP。下面以当前服务监听在远端 3003 端口为例。在第一终端开启 SSH 转发，第二终端执行后续命令。将示例中的 SSH 登录名替换成自己的。

```bash
ssh -N -L 13003:127.0.0.1:3003 user@server
```

```bash
gemini mcp add --transport http --scope user novelai http://127.0.0.1:13003/mcp
gemini mcp list
gemini
```

在 CLI 内执行 `/mcp` 查看工具列表，然后输入「请用 NovelAI 的 generate_image 生成一张方形的月光森林插画」。工具会使用 MCP 服务端配置的 NovelAI 账号出图，并返回 PNG。是否直接显示图片取决于客户端。[Gemini CLI 的 MCP 文档](https://geminicli.com/docs/tools/mcp-server/)

若使用 Gemini API，可由自己的应用连接 MCP，然后把 `generate_image` 注册为 Gemini 函数工具。应用接收工具返回的 PNG 并展示给用户。这样可以控制密钥存储、访问权限与图片界面。[Gemini API 工具调用文档](https://ai.google.dev/gemini-api/docs/function-calling#remote-mcp)

目前服务端 HTTP 入口本身没有客户端鉴权。跨机器使用时应通过 SSH 转发或已有私有网络接入。
