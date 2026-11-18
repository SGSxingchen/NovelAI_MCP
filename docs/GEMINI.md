# 在 Gemini App 使用 NovelAI MCP

1. 在 Gemini 网页打开「设置 → 关联的应用 → 自定义 → Cloud MCP」。
2. 粘贴 NovelAI MCP 的完整公网 HTTPS 地址，点击「下一步」并按提示完成连接。当前部署的专用链接已保存在服务器的受限文件中。高级设置的 OAuth 客户端 ID 和密钥留空，NovelAI API 密钥由 MCP 服务端管理。给服务额外配置 OAuth 时，才按服务端的注册方式填高级设置。
3. 在 Gemini 对话里输入 `@`，选择刚连上的自定义应用，再输入「请用 NovelAI 生成一张月光森林插画」。新建连接在 Gemini 网页完成，连接后的应用可在网页和手机端使用。

[Google 官方接入步骤](https://support.google.com/gemini/answer/17209137)

默认模型为 V5 Curated。可以在提示中明确指定 V5 Full 或 V4.5 Full。V5 有独立的额度规则。[NovelAI 官方模型说明](https://docs.novelai.net/en/image/models)

自行部署时，将带访问保护的公网 HTTPS 入口反代到服务的 `/mcp`，并关闭反代缓冲以支持 Streamable HTTP。专用访问链接应按访问凭据保管。支持 MCP 的其他客户端也可以使用 Streamable HTTP 接入。

[Google 开发者接入文档](https://developers.google.com/connected-apps/mcp)
