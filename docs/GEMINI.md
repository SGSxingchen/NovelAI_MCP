# 在 Gemini App 使用 NovelAI MCP

1. 在 Gemini 网页打开「设置 → 关联的应用 → 自定义 → Cloud MCP」。
2. 粘贴 NovelAI MCP 的完整公网 HTTPS 地址，点击「下一步」并按提示完成连接。当前部署的专用链接已保存在服务器的受限文件中。高级设置的 OAuth 客户端 ID 和密钥留空，NovelAI API 密钥由 MCP 服务端管理。给服务额外配置 OAuth 时，才按服务端的注册方式填高级设置。
3. 在 Gemini 对话里输入 `@`，选择刚连上的自定义应用，再输入「请用 NovelAI 生成一张月光森林插画」。新建连接在 Gemini 网页完成，连接后的应用可在网页和手机端使用。

[Google 官方接入步骤](https://support.google.com/gemini/answer/17209137)

默认模型为 V5 Curated。可以在提示中明确指定 V5 Full 或 V4.5 Full。V5 有独立的额度规则。[NovelAI 官方模型说明](https://docs.novelai.net/en/image/models)

自行部署时，将带访问保护的公网 HTTPS 入口反代到服务的 `/mcp`，并关闭反代缓冲以支持 Streamable HTTP。专用访问链接应按访问凭据保管。支持 MCP 的其他客户端也可以使用 Streamable HTTP 接入。

[Google 开发者接入文档](https://developers.google.com/connected-apps/mcp)

## 图片回执

公网部署的工具回执同时包含原生 PNG 和「查看或下载图片」的文本链接。Gemini 若没有内嵌图片，可以打开回执中的链接。归档链接没有有效期，服务重启后仍可使用。链接应按图片访问凭据保管。

自建部署可将 `MCP_IMAGE_PUBLIC_ORIGIN` 设为公网 HTTPS 域名，将该域名的 `/novelai-images/` 原路径代理到 Streamable HTTP 服务。开放 GET 和 HEAD 即可。使用 `MCP_IMAGE_ARCHIVE_DIR` 指定持久化卷或目录。仅设置归档目录时会保存 PNG，工具回执继续返回原生图片。

## 图库读取格式

归档根目录下，每张图片对应一个随机 ID 目录，包含 `image.png` 与 `metadata.json`。元数据版本为 `schema_version: 1`，包含图片 ID、UTC 生成时间、模型、宽高、随机种子、媒体类型和字节数。忽略以点开头的未提交目录。图库可从服务器文件系统按需读取。公网无需目录索引，只有持有对应图片链接的访问方可以下载该图。归档由运维管理，无自动到期删除。

[Google 工具回执优化说明](https://developers.google.com/connected-apps/mcp/server-optimization)
