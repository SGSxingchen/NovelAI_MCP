# NovelAI MCP Server - 快速参考

## 🚀 启动命令

```bash
# Stdio 模式（Claude Desktop）
npm run start:stdio

# Streamable HTTP 模式（LobeChat/Dify 推荐）
npm run start:http

# SSE 模式（备选）
npm run start:sse

# 自定义端口
PORT=8080 npm run start:http

# 使用代理
HTTPS_PROXY="http://proxy:8080" npm run start:http
```

## 🔗 HTTP 端点

### Streamable HTTP 模式（推荐）
| 端点 | 用途 |
|------|------|
| `http://localhost:3000/mcp` | MCP 端点（配置到客户端） |
| `http://localhost:3000/health` | 健康检查 |

### SSE 模式（备选）
| 端点 | 用途 |
|------|------|
| `http://localhost:3000/sse` | SSE 连接（配置到客户端） |
| `http://localhost:3000/message` | 消息发送 |
| `http://localhost:3000/health` | 健康检查 |

## ⚙️ 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `NOVELAI_API_KEY` | ✅ | - | NovelAI API 密钥 |
| `PORT` | ❌ | 3000 | HTTP 服务器端口（仅 HTTP 模式） |
| `HTTPS_PROXY` | ❌ | - | HTTPS 代理地址（如 http://proxy:8080） |
| `HTTP_PROXY` | ❌ | - | HTTP 代理地址 |

## 🎨 工具参数速查

### base_prompt（必需）
全局场景和风格
```
示例: "masterpiece, best quality, cherry blossoms, sunset"
```

### base_negative_prompt（可选）
全局负面词（留空使用默认）
```
默认: "lowres, bad anatomy, bad hands, text, error..."
```

### characters（重要！）
单人多人都要用
```json
// 单人
[{
  "prompt": "1girl, blue hair, school uniform",
  "negative_prompt": "",
  "center_x": 0.5,
  "center_y": 0.5
}]

// 双人
[
  { "prompt": "1girl, blue hair", "center_x": 0.3 },
  { "prompt": "1boy, red hair", "center_x": 0.7 }
]
```

### width / height
必须是 64 的倍数
```
竖图: 832 x 1216
横图: 1216 x 832
方图: 1024 x 1024
```

### steps
锁定 28（免费限制）

## 📍 角色位置速查

```
水平 (center_x):
├─ 0.0  最左
├─ 0.3  左侧
├─ 0.5  居中 ✨
├─ 0.7  右侧
└─ 1.0  最右

垂直 (center_y):
├─ 0.0  最上
├─ 0.4  稍上（肖像推荐）
├─ 0.5  居中 ✨
├─ 0.7  稍下
└─ 1.0  最下
```

## 🧪 快速测试

```bash
# 1. 健康检查
curl http://localhost:3000/health

# 2. 自动化测试
npm install eventsource
npm run test:http

# 3. 查看日志
# 服务器会实时输出连接和生成日志
```

## 🐳 Docker 一键部署

```bash
# 创建 Dockerfile
cat > Dockerfile << 'EOF'
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start:http"]
EOF

# 构建运行
docker build -t novelai-mcp .
docker run -d -p 3000:3000 -e NOVELAI_API_KEY="your-key" novelai-mcp
```

## 🔧 常用场景配置

### LobeChat
```json
{
  "url": "http://localhost:3000/sse",
  "transport": "sse"
}
```

### Dify
- 类型: MCP Server
- 传输: HTTP (SSE)
- URL: `http://localhost:3000/sse`

### Claude Desktop（原有）
```json
{
  "mcpServers": {
    "novelai": {
      "command": "node",
      "args": ["D:/WorkSpace/ClaudeCode/NovelAI_MCP/dist/index.js"],
      "env": { "NOVELAI_API_KEY": "your-key" }
    }
  }
}
```

## 📊 模式对比

| 特性 | Stdio | HTTP SSE |
|------|-------|----------|
| Claude Desktop | ✅ | ❌ |
| LobeChat | ❌ | ✅ |
| Dify | ❌ | ✅ |
| 远程访问 | ❌ | ✅ |
| 多客户端 | ❌ | ✅ |
| Docker 部署 | ❌ | ✅ |

## 🆘 故障排查

### 端口被占用
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :3000
kill -9 <PID>

# 或使用其他端口
PORT=8080 npm run start:http
```

### API 密钥错误
```bash
# 检查环境变量
echo $NOVELAI_API_KEY  # Linux/Mac
echo %NOVELAI_API_KEY%  # Windows CMD
$env:NOVELAI_API_KEY   # Windows PowerShell
```

### 连接超时
1. 检查服务器是否运行: `curl http://localhost:3000/health`
2. 检查防火墙设置
3. 查看服务器日志

## 📖 完整文档

- 快速开始: [QUICKSTART-HTTP.md](./QUICKSTART-HTTP.md)
- HTTP 详细: [HTTP-MODE.md](./HTTP-MODE.md)
- 功能总结: [SUMMARY.md](./SUMMARY.md)
- 使用示例: [EXAMPLES.md](./EXAMPLES.md)
- 多角色: [CHARACTER-EXAMPLES.md](./CHARACTER-EXAMPLES.md)

## 💡 提示

1. ✅ 工具描述已优化为中文，AI 更准确调用
2. ✅ characters 参数单人多人都要用
3. ✅ negative_prompt 会叠加，不是替换
4. ✅ steps 锁定 28，不要修改
5. ✅ HTTP 模式支持并发，可多客户端同时使用

---

**需要帮助？** 查看对应文档或提交 Issue
