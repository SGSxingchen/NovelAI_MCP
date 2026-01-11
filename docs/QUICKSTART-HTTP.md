# 快速开始 - HTTP SSE 模式

5分钟内启动并测试 NovelAI MCP HTTP 服务器。

## 第一步：安装依赖

```bash
npm install
```

## 第二步：设置 API Key 和代理（可选）

**Linux/Mac:**
```bash
export NOVELAI_API_KEY="your-api-key-here"
export HTTPS_PROXY="http://127.0.0.1:7890"  # 可选：如果需要代理
```

**Windows PowerShell:**
```powershell
$env:NOVELAI_API_KEY="your-api-key-here"
$env:HTTPS_PROXY="http://127.0.0.1:7890"  # 可选：如果需要代理
```

**Windows CMD:**
```cmd
set NOVELAI_API_KEY=your-api-key-here
set HTTPS_PROXY=http://127.0.0.1:7890
```

> **⚠️ 重要**:
> - PowerShell 使用 `$env:变量名`
> - CMD 使用 `set 变量名`
> - 不要混淆！在 PowerShell 里用 `set` 是不生效的

## 第三步：启动服务器

```bash
npm run start:http
```

你应该看到：
```
🚀 NovelAI MCP Server (HTTP SSE mode) running on http://localhost:3000
📡 SSE endpoint: http://localhost:3000/sse
💬 Message endpoint: http://localhost:3000/message
❤️  Health check: http://localhost:3000/health
```

## 第四步：测试服务器

打开新的终端窗口，运行：

```bash
# 安装测试依赖
npm install eventsource

# 运行测试
npm run test:http
```

如果一切正常，你会看到：
```
✅ Health check passed
✅ SSE connection established
✅ Message endpoint accessible
✅ All tests passed!
```

## 第五步：配置客户端

### LobeChat

在 LobeChat 设置中添加 MCP 服务器：

```json
{
  "url": "http://localhost:3000/sse",
  "transport": "sse"
}
```

### Dify

在 Dify 的工具配置中：
- **类型**: MCP Server
- **传输方式**: HTTP (SSE)
- **URL**: `http://localhost:3000/sse`

### 其他支持 MCP 的应用

只需配置 SSE 端点: `http://localhost:3000/sse`

## 使用示例

在连接的客户端中，你可以：

### 单人场景
```
帮我画一个蓝发动漫女孩，穿着校服，在樱花树下
```

AI 会自动调用 `generate_image` 工具，参数类似：
```json
{
  "base_prompt": "masterpiece, best quality, detailed background, cherry blossoms",
  "characters": [{
    "prompt": "1girl, blue hair, school uniform, detailed face, beautiful eyes",
    "negative_prompt": "",
    "center_x": 0.5,
    "center_y": 0.5
  }],
  "width": 832,
  "height": 1216
}
```

### 双人场景
```
画两个角色，左边是蓝发女孩，右边是红发男孩，教室场景
```

AI 会生成：
```json
{
  "base_prompt": "masterpiece, best quality, classroom background, detailed",
  "characters": [
    {
      "prompt": "1girl, blue hair, school uniform",
      "center_x": 0.3,
      "center_y": 0.5
    },
    {
      "prompt": "1boy, red hair, school uniform",
      "center_x": 0.7,
      "center_y": 0.5
    }
  ]
}
```

## 常见问题

### 端口被占用
```bash
# 使用其他端口
PORT=8080 npm run start:http
```

### 无法连接
检查防火墙设置，确保端口开放：
```bash
# Windows: 允许端口 3000
netsh advfirewall firewall add rule name="NovelAI MCP" dir=in action=allow protocol=TCP localport=3000

# Linux: 使用 ufw
sudo ufw allow 3000
```

### API Key 错误
确保你的 NovelAI 订阅是活跃的，并且 API Key 正确。

### 远程访问
如果需要从其他机器访问：

1. 确保服务器监听所有接口（已默认配置）
2. 配置防火墙允许访问
3. 使用服务器的 IP 地址：`http://your-server-ip:3000/sse`

## 生产部署

### 使用 PM2

```bash
# 安装 PM2
npm install -g pm2

# 创建配置文件 ecosystem.config.js
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'novelai-mcp',
    script: './dist/http-server.js',
    env: {
      PORT: 3000,
      NOVELAI_API_KEY: 'your-api-key'
    }
  }]
};
EOF

# 启动
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 使用 Docker

```bash
# 构建镜像
docker build -t novelai-mcp-server .

# 运行容器
docker run -d \
  -p 3000:3000 \
  -e NOVELAI_API_KEY="your-api-key" \
  --name novelai-mcp \
  --restart unless-stopped \
  novelai-mcp-server
```

### 添加 HTTPS（使用 Nginx）

```bash
# 安装 Nginx
sudo apt install nginx

# 配置反向代理（参见 HTTP-MODE.md）
```

## 下一步

- 查看 [HTTP-MODE.md](./HTTP-MODE.md) 了解详细配置
- 查看 [EXAMPLES.md](./EXAMPLES.md) 了解更多生成示例
- 查看 [CHARACTER-EXAMPLES.md](./CHARACTER-EXAMPLES.md) 了解多角色功能

## 获取帮助

- 提交 Issue: [GitHub Issues](https://github.com/yourusername/novelai-mcp-server/issues)
- 查看日志: 服务器会输出详细的运行日志
- 健康检查: `curl http://localhost:3000/health`
