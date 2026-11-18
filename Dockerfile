FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

# 安装锁定的依赖，运行 prepare 编译后移除开发依赖
RUN npm ci && npm prune --omit=dev --ignore-scripts

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动 HTTP 服务器
CMD ["npm", "run", "start:http"]
