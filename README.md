# NovelAI MCP Server

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20+-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-purple.svg)](https://modelcontextprotocol.io/)

**一个功能完整的 Model Context Protocol (MCP) 服务器，为 NovelAI 图像生成 API 提供支持**

[English](./README.en.md) | 简体中文

</div>

---

## ✨ 特性

- 🎨 **9 大模型全覆盖** - 支持 NovelAI Diffusion V5（Curated / Full / Full Medium）、V4.5（Full / Curated）、V4（Full / Curated Preview）与 V3（Anime / Furry）
- 🧰 **9 个全功能 MCP 工具** - 文生图、图生图、局部重绘（支持 8×8 区域自动遮罩）、8 项导演工具、图像放大、Vibe 编码与缓存复用、标签建议、订阅/Anlas 查询与归档图库检索
- 🔁 **图库 ID 闭环** - 所有出图与处理结果自动归档（支持 PNG / WebP / JPEG，兼容 v1 历史归档）并返回 `image_id` 与公开短链，可直接回传作为后续编辑或参考输入
- 🚀 **三传输统一架构** - Stdio、Streamable HTTP（推荐，兼容 Gemini Cloud MCP）与 Legacy SSE 共享同一套工具与归档能力，HTTP 请求体上限提升至 50MB
- 🛡️ **安全与费用防护** - HTTPS 远端图下载内置 SSRF 防护，HTTP 模式禁读本地文件，Vibe 编码持久化缓存与并发去重减少重复 Anlas 消耗

## 📦 快速开始

### 安装

```bash
# 克隆项目
git clone https://github.com/SGSxingchen/NovelAI_MCP.git
cd NovelAI_MCP

# 安装依赖
npm ci

# 编译
npm run build
```

### 配置

#### 方式一：Stdio 模式（Claude Desktop）

在 Claude Desktop 配置文件中添加：

```json
{
  "mcpServers": {
    "novelai": {
      "command": "node",
      "args": ["项目路径/dist/index.js"],
      "env": {
        "NOVELAI_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### 方式二：Streamable HTTP 模式（LobeChat/Dify 推荐）

**Linux/Mac:**
```bash
export NOVELAI_API_KEY="your-api-key"
export HTTPS_PROXY="http://127.0.0.1:7890"  # 可选：设置代理
npm run start:http
```

**Windows PowerShell:**
```powershell
$env:NOVELAI_API_KEY="your-api-key"
$env:HTTPS_PROXY="http://127.0.0.1:7890"  # 可选：设置代理
npm run start:http
```

**Windows CMD:**
```cmd
set NOVELAI_API_KEY=your-api-key
set HTTPS_PROXY=http://127.0.0.1:7890
npm run start:http
```

在客户端配置中添加：
- **URL**: `http://localhost:3000/mcp`
- **传输**: Streamable HTTP

#### 方式三：SSE 模式（备选）

**Linux/Mac:**
```bash
export NOVELAI_API_KEY="your-api-key"
export HTTPS_PROXY="http://127.0.0.1:7890"  # 可选
npm run start:sse
```

**Windows PowerShell:**
```powershell
$env:NOVELAI_API_KEY="your-api-key"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
npm run start:sse
```

**Windows CMD:**
```cmd
set NOVELAI_API_KEY=your-api-key
set HTTPS_PROXY=http://127.0.0.1:7890
npm run start:sse
```

在客户端配置中添加：
- **URL**: `http://localhost:3000/sse`
- **传输**: Server-Sent Events (SSE)

## 🎯 支持的模型（9 个）

| 模型 ID | 说明 | 特性摘要 |
|---------|------|----------|
| `nai-diffusion-5-curated` | NovelAI Diffusion V5 Curated（**默认**） | 最多 32 角色、透明背景；局部重绘自动使用同代 `nai-diffusion-5-full-inpainting`（保留 32 角色与透明背景） |
| `nai-diffusion-5-full` | NovelAI Diffusion V5 Full | 最多 32 角色、透明背景、独立 inpainting |
| `nai-diffusion-5-full-medium` | NovelAI Diffusion V5 Full Medium | 硬锁定 14 步 / `k_euler_ancestral` / `cfg_rescale=0` / `uc_preset=heavy` |
| `nai-diffusion-4-5-full` | NovelAI Diffusion V4.5 Full | 最多 6 角色、精确参考（Precise Reference）、Vibe Transfer、Variety+ |
| `nai-diffusion-4-5-curated` | NovelAI Diffusion V4.5 Curated | 同 V4.5 Full 能力矩阵 |
| `nai-diffusion-4-full` | NovelAI Diffusion V4 Full | 最多 6 角色、Vibe Transfer（含局部重绘）、Variety+ |
| `nai-diffusion-4-curated-preview` | NovelAI Diffusion V4 Curated Preview | 同 V4 Full 能力矩阵 |
| `nai-diffusion-3` | NovelAI Diffusion V3 Anime | SMEA / SMEA DYN / Auto SMEA / Decrisp / `native` 调度、448×448 原图 Vibe |
| `nai-diffusion-furry-3` | NovelAI Diffusion V3 Furry | 同 V3 Anime 能力矩阵 |

## 🧰 MCP 工具列表（9 个）

| 工具名 | 用途 | 关键特性 |
|--------|------|----------|
| `generate_image` | 文生图 | 兼容旧版 7 参数；支持 9 模型、多角色、采样器/日程、Variety+、V5 透明背景、精确参考、Vibe、多图 `n_samples` 与 PNG/WebP 输出 |
| `img2img` | 图生图 | 支持归档 `image_id` / 短链 / HTTPS / Base64 / 数据 URI（Stdio 支持本地文件）；支持 `strength`、`noise`、`color_correct`、`extra_noise_seed` |
| `inpaint_image` | 局部重绘 | 支持 `mask_image` 或 `mask_regions`（最多 64 个归一化矩形/椭圆自动生成 8×8 对齐二值遮罩）；支持 `inpaint_strength`、`add_original_image` |
| `augment_image` | 导演工具 | 支持 `lineart`、`sketch`、`colorize`、`declutter`、`declutter-keep-bubbles`、`emotion`（24 种情绪）、`bg-removal`（返回 3 图）、`pixel-snap` |
| `upscale_image` | 图像放大 | 2026 `/ai/upscale` 协议；默认 `auto_fit_1mp=true` 自动将超过 1,048,576 像素的源图等比缩图至上限内 |
| `encode_vibe` | Vibe 风格编码 | 为 V4 / V4.5 预编码参考图并返回可跨重启复用的 `vibe_id`（落盘 `<archiveDir>/.vibe-cache` 并合并并发请求） |
| `suggest_tags` | 标签建议 | 按提示词片段与模型返回 `en` / `jp` 标签补全列表 |
| `get_subscription` | 订阅与余额查询 | 返回订阅等级、到期时间、固定/购买 Anlas 余额与 V5 用量条信息 |
| `list_archived_images` | 图库检索 | 倒序列出最近归档图片，或按 `image_id` / 短链读取单图元数据与 PNG 内嵌参数 |

## 📊 传输模式对比

| 特性 | Stdio 模式 | Streamable HTTP | SSE 模式 |
|------|-----------|----------------|----------|
| **适用场景** | Claude Desktop | Gemini Cloud MCP、LobeChat、Dify（推荐） | Legacy SSE 客户端 |
| **协议标准** | MCP Stdio | MCP Streamable HTTP | MCP SSE Transport |
| **端点** | - | `/mcp`、`/health`、`/novelai-images/:id.(png\|webp\|jpg)` | `/sse`、`/message`、`/health`、`/novelai-images/:id.(png\|webp\|jpg)` |
| **远程访问 / 50MB 请求体** | 本地文件可读 | ✅（禁读本地文件） | ✅（禁读本地文件） |
| **多客户端与归档短链** | ❌ | ✅ | ✅ |
| **启动命令** | `npm run start:stdio` | `npm run start:http` | `npm run start:sse` |

## 🌍 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `NOVELAI_API_KEY` | ✅ | - | NovelAI API 密钥 |
| `PORT` | ❌ | `3000` | HTTP 服务器端口（Streamable HTTP / SSE 模式） |
| `MCP_BIND_HOST` | ❌ | Streamable HTTP 为 `::` | HTTP 监听地址。通过本机 Nginx 提供 HTTPS 时建议设为 `127.0.0.1` |
| `MCP_IMAGE_PUBLIC_ORIGIN` | ❌ | - | 公网 HTTPS 域名（无路径）。启用时须反代 `/novelai-images/`，回执附带公开短链 |
| `MCP_IMAGE_ARCHIVE_DIR` | ❌ | 配置图片链接时为 `outputs` | 图片与 `.vibe-cache` 持久化归档目录。建议使用独立绝对路径或持久卷 |
| `MCP_ALLOWED_ORIGINS` | ❌ | - | 逗号分隔的额外允许 HTTP/HTTPS `Origin` 白名单（本机及 `MCP_IMAGE_PUBLIC_ORIGIN` 默认放行） |
| `HTTPS_PROXY` | ❌ | - | HTTPS 代理地址 |
| `HTTP_PROXY` | ❌ | - | HTTP 代理地址 |

## Gemini 接入

Gemini 网页的「关联的应用 → 自定义 → Cloud MCP」可以连接公网 HTTPS 的 Streamable HTTP 入口。连接后可在 Gemini 网页和手机 App 使用。见 [接入说明](./docs/GEMINI.md)。

## 📚 文档

- 🚀 [HTTP 快速开始](./docs/QUICKSTART-HTTP.md)
- 📋 [快速参考卡片](./docs/QUICK-REFERENCE.md)
- 📝 [完整功能总结](./SUMMARY.md)
- 📜 [更新日志](./CHANGELOG.md)

## 🛠️ 开发

```bash
# 克隆仓库
git clone https://github.com/SGSxingchen/NovelAI_MCP.git
cd NovelAI_MCP

# 安装依赖
npm ci

# 编译
npm run build

# 运行单元测试
npm test

# 开发模式
npm run dev

# 启动 HTTP 服务器
npm run start:http
```

## 🐳 Docker 部署（可选）

项目包含 Dockerfile，可以自行构建：

```bash
# 构建镜像
docker build -t novelai-mcp-server .

# 运行容器
docker run -d \
  -p 3000:3000 \
  -e NOVELAI_API_KEY="your-api-key" \
  --name novelai-mcp \
  novelai-mcp-server
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [NovelAI](https://novelai.net/) - 提供强大的图像生成 API
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP 协议规范
- [Anthropic](https://www.anthropic.com/) - MCP SDK 和 Claude

## 🔗 相关链接

- [NovelAI 官网](https://novelai.net/)
- [NovelAI API 文档](https://api.novelai.net/docs/)
- [MCP 官方文档](https://modelcontextprotocol.io/)
- [问题反馈](https://github.com/SGSxingchen/NovelAI_MCP/issues)

---

<div align="center">

**如果这个项目对你有帮助，请给个 ⭐️！**

</div>
