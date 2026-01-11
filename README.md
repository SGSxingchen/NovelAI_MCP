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

- 🎨 **最新模型支持** - 完整支持 NAI Diffusion V4.5 Full 及所有历史版本
- 🚀 **双传输模式** - Stdio（Claude Desktop）和 HTTP SSE（LobeChat/Dify）
- 🎭 **多角色支持** - V4+ 角色定位和独立提示词系统
- ⚡ **高级采样** - 7 种采样器、4 种噪声调度、布朗噪声
- 🎛️ **完整参数控制** - 所有 NovelAI API 参数均可配置
- 📝 **中文优化** - 工具描述使用中文，AI 更准确识别调用时机
- 🔧 **灵活部署** - 支持本地运行或 Docker 容器化
- 📚 **文档完善** - 详细的使用示例和最佳实践

## 📦 快速开始

### 安装

```bash
# 克隆项目
git clone https://github.com/SGSxingchen/NovelAI_MCP.git
cd NovelAI_MCP

# 安装依赖
npm install

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

```bash
# 设置 API Key
export NOVELAI_API_KEY="your-api-key"

# 可选：设置代理（如需要）
export HTTPS_PROXY="http://proxy.example.com:8080"
export HTTP_PROXY="http://proxy.example.com:8080"

# 启动服务器
npm install
npm run start:http
```

在客户端配置中添加：
- **URL**: `http://localhost:3000/mcp`
- **传输**: Streamable HTTP

#### 方式三：SSE 模式（备选）

```bash
# 启动 SSE 服务器
npm run start:sse
```

在客户端配置中添加：
- **URL**: `http://localhost:3000/sse`
- **传输**: Server-Sent Events (SSE)

## 🎯 支持的模型

当前版本专注于最新的 NovelAI V4.5 模型：

| 模型 | 说明 |
|------|------|
| `nai-diffusion-4-5-full` | NAI Diffusion V4.5 Full（唯一支持的模型） |

> **注意**: 本项目专门为 V4.5 Full 优化，包含完整的 V4.5 特性支持（Auto SMEA、Brownian 噪声、多角色定位等）。如需使用其他模型，请参考早期版本或提交 Issue。

## 💡 使用示例

### 基础文生图

```typescript
// AI 会自动调用工具，你只需要自然描述
"帮我画一个蓝发动漫女孩，穿着校服，在樱花树下"
```

AI 会生成类似的参数：
```json
{
  "base_prompt": "masterpiece, best quality, cherry blossoms, detailed",
  "characters": [{
    "prompt": "1girl, blue hair, school uniform, beautiful eyes",
    "negative_prompt": "",
    "center_x": 0.5,
    "center_y": 0.5
  }],
  "width": 832,
  "height": 1216
}
```

### 多角色场景

```typescript
"画两个角色对话，左边是蓝发女孩坐着看书，右边是红发男孩站着"
```

更多示例请查看 [使用示例文档](./docs/EXAMPLES.md)。

## 🔧 核心参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `base_prompt` | string | 全局场景和风格描述 |
| `base_negative_prompt` | string | 全局负面提示词 |
| `characters` | array | 角色数组（单人/多人都要用） |
| `width` / `height` | number | 图片尺寸（必须是 64 的倍数） |
| `steps` | number | 采样步数（锁定 28，免费限制） |

完整参数列表请查看 [快速参考](./docs/QUICK-REFERENCE.md)。

## 📊 传输模式对比

| 特性 | Stdio 模式 | Streamable HTTP | SSE 模式 |
|------|-----------|----------------|----------|
| **适用场景** | Claude Desktop | LobeChat、Dify（推荐） | SSE 客户端 |
| **协议标准** | MCP Stdio | MCP Streamable HTTP | MCP SSE Transport |
| **端点** | - | `/mcp` | `/sse` + `/message` |
| **远程访问** | ❌ | ✅ | ✅ |
| **多客户端** | ❌ | ✅ | ✅ |
| **代理支持** | ❌ | ✅ | ✅ |
| **启动命令** | `npm run start:stdio` | `npm run start:http` | `npm run start:sse` |

## 🌍 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `NOVELAI_API_KEY` | ✅ | - | NovelAI API 密钥 |
| `PORT` | ❌ | 3000 | HTTP 服务器端口（仅 HTTP 模式） |
| `HTTPS_PROXY` | ❌ | - | HTTPS 代理地址 |
| `HTTP_PROXY` | ❌ | - | HTTP 代理地址 |

## 📚 文档

- 📖 [HTTP 模式详细指南](./docs/HTTP-MODE.md)
- 🚀 [HTTP 快速开始](./docs/QUICKSTART-HTTP.md)
- 🎨 [使用示例](./docs/EXAMPLES.md)
- 🎭 [多角色功能](./docs/CHARACTER-EXAMPLES.md)
- 📋 [快速参考卡片](./docs/QUICK-REFERENCE.md)
- 📝 [完整功能总结](./SUMMARY.md)
- 📜 [更新日志](./CHANGELOG.md)

## 🛠️ 开发

```bash
# 克隆仓库
git clone https://github.com/SGSxingchen/NovelAI_MCP.git
cd NovelAI_MCP

# 安装依赖
npm install

# 编译
npm run build

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

Made with ❤️ by the community

</div>
