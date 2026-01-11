# NovelAI MCP Server - HTTP SSE 模式

这个 MCP 服务器现在支持两种传输模式：

1. **Stdio 模式**（原有）- 适合 Claude Desktop
2. **HTTP SSE 模式**（新增）- 适合 Web 应用、LobeChat、Dify 等

## HTTP SSE 模式使用

### 启动服务器

```bash
# 设置 API Key
export NOVELAI_API_KEY="your-api-key-here"

# 启动 HTTP 服务器（默认端口 3000）
npm run start:http

# 或指定端口
PORT=8080 NOVELAI_API_KEY="your-key" npm run start:http
```

### 服务器端点

启动后，服务器会提供以下端点：

- **SSE 连接**: `http://localhost:3000/sse` - 用于建立 Server-Sent Events 连接
- **消息端点**: `http://localhost:3000/message` - 用于发送 MCP 消息
- **健康检查**: `http://localhost:3000/health` - 检查服务器状态

### 环境变量

- `NOVELAI_API_KEY` (必需) - NovelAI API 密钥
- `PORT` (可选) - HTTP 服务器端口，默认 3000
- `HTTPS_PROXY` / `HTTP_PROXY` (可选) - 代理设置

### 使用示例

#### 1. 在 LobeChat 中使用

在 LobeChat 的 MCP 服务器配置中添加：

```json
{
  "mcpServers": {
    "novelai": {
      "url": "http://localhost:3000/sse",
      "transport": "sse"
    }
  }
}
```

#### 2. 在 Dify 中使用

在 Dify 的 MCP 配置中：

- **类型**: HTTP (SSE)
- **URL**: `http://localhost:3000/sse`
- **传输方式**: Server-Sent Events

#### 3. 使用 curl 测试健康检查

```bash
curl http://localhost:3000/health
# 响应: {"status":"ok","service":"novelai-mcp-server"}
```

### Docker 部署

创建 `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:http"]
```

运行容器：

```bash
docker build -t novelai-mcp-server .

docker run -d \
  -p 3000:3000 \
  -e NOVELAI_API_KEY="your-api-key" \
  --name novelai-mcp \
  novelai-mcp-server
```

### 使用 PM2 管理

安装 PM2:
```bash
npm install -g pm2
```

创建 `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'novelai-mcp-http',
    script: './dist/http-server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      NOVELAI_API_KEY: 'your-api-key-here'
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G'
  }]
};
```

启动：
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### HTTPS 支持

如果需要 HTTPS，可以使用 Nginx 反向代理：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # SSE 特殊配置
        proxy_set_header X-Accel-Buffering no;
        proxy_buffering off;
        chunked_transfer_encoding on;
    }
}
```

## Stdio 模式使用

Stdio 模式保持不变，适合 Claude Desktop：

```bash
# 直接运行
NOVELAI_API_KEY="your-key" npm run start:stdio

# 或在 Claude Desktop 配置中使用
# 参见 README.md
```

## 两种模式对比

| 特性 | Stdio 模式 | HTTP SSE 模式 |
|------|-----------|--------------|
| **适用场景** | Claude Desktop | Web 应用、LobeChat、Dify |
| **传输方式** | 标准输入输出 | HTTP + Server-Sent Events |
| **网络访问** | 本地进程 | 可远程访问 |
| **并发支持** | 单一连接 | 多连接支持 |
| **部署方式** | 本地命令 | 服务器部署 |

## 故障排查

### 连接问题

1. **检查服务器是否运行**:
   ```bash
   curl http://localhost:3000/health
   ```

2. **检查端口是否被占用**:
   ```bash
   # Windows
   netstat -ano | findstr :3000

   # Linux/Mac
   lsof -i :3000
   ```

3. **查看服务器日志**:
   服务器会输出连接日志：
   ```
   🚀 NovelAI MCP Server (HTTP SSE mode) running on http://localhost:3000
   📡 New SSE connection
   📨 Received message
   🎨 [HTTP] Generating image...
   ```

### CORS 问题

如果遇到 CORS 错误，服务器已配置允许所有来源。如需限制：

编辑 `src/http-server.ts`:
```typescript
app.use(cors({
  origin: 'https://your-frontend-domain.com', // 限制来源
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
```

### 性能优化

对于高并发场景，可以：

1. **增加 Node.js 内存限制**:
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm run start:http
   ```

2. **使用多实例（PM2）**:
   ```javascript
   // ecosystem.config.js
   instances: 'max', // 使用所有 CPU 核心
   ```

3. **添加请求限流**:
   服务器已内置 express-rate-limit，可在代码中配置

## 开发模式

边开发边测试：

```bash
# Terminal 1: 监听代码变化
npm run dev

# Terminal 2: 启动 HTTP 服务器
npm run dev:http
```

## API 使用示例

虽然这是 MCP 服务器，但你也可以直接通过 HTTP 测试工具调用（需遵循 MCP 协议）。

更推荐使用支持 MCP 的客户端，如 LobeChat、Dify 等。
