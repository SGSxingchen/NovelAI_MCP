# Changelog

All notable changes to this project will be documented in this file.

## 2.0.0（2026-11-21）

### Added
- **9 大模型全量支持**：覆盖 V5（`nai-diffusion-5-curated`、`nai-diffusion-5-full`、`nai-diffusion-5-full-medium`）、V4.5（`nai-diffusion-4-5-full`、`nai-diffusion-4-5-curated`）、V4（`nai-diffusion-4-full`、`nai-diffusion-4-curated-preview`）与 V3（`nai-diffusion-3`、`nai-diffusion-furry-3`）及其能力矩阵（`src/model-registry.ts`）。
  - 自动处理 V5 Curated 局部重绘回退至 `nai-diffusion-4-5-curated-inpainting`（同步限制 6 角色并输出回退提示）。
  - 支持 V5 Full Medium 硬锁定参数、V5 透明背景（`straight_alpha` + `tag_hint_transparent_background`）、V4/V4.5 精确参考（Precise Reference）与 Vibe Transfer、V3 SMEA/Decrisp/native 调度以及 Variety+ 自动分辨率缩放。
- **9 个扁平化 MCP 工具**（`src/mcp-tools.ts`，严格兼容 Gemini Cloud MCP Schema 规范与旧版 `generate_image` 7 参数）：
  - `generate_image`、`img2img`、`inpaint_image`、`augment_image`（8 种导演工具 / 24 种情绪 / 去背景 3 图解包）、`upscale_image`（2026 `/ai/upscale` 协议与 1MP 自动等比缩图）、`encode_vibe`、`suggest_tags`、`get_subscription`、`list_archived_images`。
- **图库 ID 闭环与多格式归档**（`src/image-archive.ts`、`src/image-input.ts`）：
  - 生成/编辑结果统一归档并写入 v2 元数据（完全兼容历史 v1 `.png`），路由 `/novelai-images/:id.(png|webp|jpg)` 按真实格式返回；文本回执同时提供 `image_id` 与公开短链，可直接回传给图生图、局部重绘、放大、导演工具与参考图参数。
  - 新增 `list_archived_images` 支持按时间倒序列出归档或按 `image_id` 提取 PNG 内嵌参数。
- **Vibe 编码持久化缓存**（`src/vibe-cache.ts`）：按原图字节、模型、提取度与遮罩摘要计算 `vibe_id`，支持内存与 `<archiveDir>/.vibe-cache` 持久化复用及并发编码去重，减少重复 Anlas 消耗。
- **基于 `sharp` 的图像与 8×8 区域自动遮罩预处理**（`src/image-input.ts`）：支持 `mask_regions`（归一化矩形/椭圆自动生成 8×8 对齐二值蒙版）、Precise Reference 纯黑居中 letterbox、V3 Vibe 448×448 letterbox 与 1MP 等比缩图。
- **自动化测试套件**：新增 `tests/` 下 5 套单元测试（`npm test` 与 `npm run test:http`）。

### Changed
- **三入口统一架构**：Stdio（`src/index.ts`）、Streamable HTTP（`src/streamable-http-server.ts`）与 Legacy SSE（`src/http-server.ts`）全面复用 `src/mcp-tools.ts`、`src/http-app.ts` 与 `src/runtime.ts`；SSE 与 Streamable HTTP 均支持图片归档、短链与 `/health` 版本/工具数输出。
- **HTTP 容量与安全加固**：Express JSON 请求体上限提升至 `50mb`；HTTPS 远程图下载内置 SSRF 防护（拦截私有/保留/回环/IPv6 映射地址，固定解析 IP 防止 DNS 重绑定，禁止重定向与凭据）；HTTP 模式禁止读取本地文件路径；新增 `MCP_ALLOWED_ORIGINS` 来源白名单校验。

## 1.2.3（2026-11-18）

- 图片与图库元数据持久化归档，下载链接可跨服务重启使用。
- 保存失败时仍返回已生成的原生 PNG，并提示本次未生成下载链接。

## 1.2.2（2026-11-18）

- Streamable HTTP 可同时返回原生 PNG 和用于 Gemini 文本回执的短期图片链接。
- 图片缓存仅存于内存，最多 64 MiB，有效期一小时。

## 1.2.1（2026-11-18）

- 工具和底层客户端默认使用 V5 Curated，保留对 V5 Full 和 V4.5 Full 的显式选择。
- 按 Google 官方说明修正 Gemini 网页和手机 App 的 Cloud MCP 接入步骤。

## 1.2.0（2026-11-18）

- 可按请求选用 NovelAI Diffusion V5 Full 或 V5 Curated。现有调用省略模型时继续使用 V4.5 Full。
- 更新 Google Antigravity 接入步骤。

## 1.1.1（2026-11-18）

- 更新 MCP SDK、ZIP 处理和 HTTP 依赖，提交依赖锁文件，使本地与容器构建可复现。
- 修复旧版 SSE 模式下工具请求没有转发到对应会话的问题。
- 补充 Gemini 接入方式。

## [1.1.0] - 2026-01-11

### Added
- **🚀 HTTP SSE Transport Mode**: 新增 HTTP Server-Sent Events 传输模式，支持 LobeChat、Dify 等 Web 应用
  - 新增 `src/http-server.ts` - HTTP SSE 服务器实现
  - 新增 `npm run start:http` - 启动 HTTP 模式
  - 新增 `npm run start:stdio` - 显式启动 Stdio 模式
  - 新增 `npm run test:http` - HTTP 服务器测试脚本
  - HTTP 端点：`/sse` (SSE连接), `/message` (消息), `/health` (健康检查)
- **📝 工具描述优化**: 使用中文描述所有工具参数，更易理解和调整
  - 明确说明何时调用工具（「画」「生成」「创建」等关键词）
  - 详细的参数说明和示例值
  - 强调单人/多人场景都要使用 characters 数组
  - 说明 character.negative_prompt 会叠加在全局 base_negative_prompt 之上
  - 明确 steps 锁定为 28（NovelAI 免费出图限制）
- **📚 文档完善**:
  - 新增 `HTTP-MODE.md` - HTTP 模式详细文档（包含部署、Docker、PM2、Nginx等）
  - 新增 `QUICKSTART-HTTP.md` - HTTP 模式快速开始指南（5分钟上手）
  - 更新 `README.md` 添加传输模式对比和说明
- **🔧 开发依赖**:
  - 新增 `@types/express` - Express TypeScript 类型定义
  - 新增 `@types/cors` - CORS TypeScript 类型定义

### Changed
- 工具描述从英文改为中文，方便中文用户维护和调整
- 参数描述更加详细，包含范围、常用值和推荐配置
- 工具描述更加明确，帮助 AI 更准确地识别何时调用工具

### Technical Details
- 使用 Express 5.x + CORS 实现 HTTP 服务器
- 使用 MCP SDK 的 SSEServerTransport 实现流式传输
- 与 Stdio 模式保持完全相同的功能和 API
- 支持环境变量配置端口（默认 3000）
### Migration Notes
- Stdio 模式（原有功能）保持不变，完全向后兼容
- HTTP 模式是新增功能，不影响现有配置
- 可以同时运行多个实例（stdio + http）