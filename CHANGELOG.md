# Changelog

All notable changes to this project will be documented in this file.

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
  - 新增 `test-http-server.js` - HTTP 服务器自动化测试工具
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
- 支持多客户端并发连接
- 与 Stdio 模式保持完全相同的功能和 API
- 支持环境变量配置端口（默认 3000）
- 完整的错误处理和连接管理

### Migration Notes
- Stdio 模式（原有功能）保持不变，完全向后兼容
- HTTP 模式是新增功能，不影响现有配置
- 可以同时运行多个实例（stdio + http）

## [1.0.0] - 2026-01-10

### Added
- Initial release of NovelAI MCP Server
- Full support for NovelAI image generation API with complete V4.5 implementation
- Support for all NovelAI models:
  - V1/V2 (Legacy)
  - V3 Anime and V3 Furry
  - V4 Curated and V4 Full
  - **V4.5 Full (Latest, with full feature support)**
- Generation modes:
  - Text-to-image generation
  - Image-to-image generation
  - Inpainting support
- Comprehensive parameter support:
  - Basic parameters (prompt, size, steps, CFG scale, sampler, seed)
  - Advanced sampling (7 samplers, 4 noise schedules)
  - Quality options (SMEA, Auto SMEA, SMEA DYN, dynamic thresholding)
  - CFG rescale for preventing oversaturation
  - Quality toggles and negative prompt presets
- **V4.5-specific features**:
  - V4 prompt structure with character positioning support
  - Auto SMEA for automatic high-resolution optimization
  - Brownian noise preference
  - Skip CFG above sigma control
  - Image format selection (PNG, JPG, WebP)
  - Artist style mixing with weights
  - Multi-character positioning and individual prompts
- Complete TypeScript implementation with full type safety
- Detailed documentation with V4.5 best practices
- Comprehensive examples in both English and Chinese
- Environment variable configuration
- API key validation on startup
- Robust error handling and parameter validation

### Technical Details
- Automatically detects V4+ models and applies correct request format
- Properly constructs v4_prompt and v4_negative_prompt structures
- Supports both simple single-subject and complex multi-character scenes
- Full compatibility with NovelAI's latest API specifications
