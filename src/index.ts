#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNovelAIMcpServer } from './mcp-tools.js';
import { getRuntimeOptions, logFatal, onShutdown } from './runtime.js';

async function main(): Promise<void> {
  const server = createNovelAIMcpServer({
    ...await getRuntimeOptions(),
    allowLocalFiles: true,
    transportLabel: 'stdio',
  });
  await server.connect(new StdioServerTransport());
  onShutdown(() => server.close());
  console.error('NovelAI MCP 已启动，使用标准输入输出');
}

main().catch(logFatal);
