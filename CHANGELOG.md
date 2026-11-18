# Changelog

All notable changes to this project will be documented in this file.

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