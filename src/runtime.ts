import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NovelAIClient } from './novelai-client.js';
import { VibeCache } from './vibe-cache.js';

export function parseOrigin(value: string, httpsOnly = false): URL | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol === 'https:' || (!httpsOnly && url.protocol === 'http:'))
      && url.href === url.origin + '/'
    ) {
      return url;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function getRuntimeOptions() {
  const apiKey = process.env.NOVELAI_API_KEY;
  if (!apiKey) throw new Error('必须设置 NOVELAI_API_KEY');

  const publicOrigin = process.env.MCP_IMAGE_PUBLIC_ORIGIN;
  const imageOrigin = publicOrigin ? parseOrigin(publicOrigin, true) : undefined;
  if (publicOrigin && !imageOrigin) throw new Error('MCP_IMAGE_PUBLIC_ORIGIN 必须是无路径的 HTTPS 源地址');
  const configuredDir = process.env.MCP_IMAGE_ARCHIVE_DIR;
  const archiveDir = configuredDir || imageOrigin ? resolve(configuredDir || 'outputs') : undefined;
  if (archiveDir) {
    const timer = new AbortController();
    try {
      await Promise.race([
        mkdir(archiveDir, { recursive: true, mode: 0o700 }),
        delay(5_000, undefined, { signal: timer.signal }).then(() => {
          throw new Error('创建图片归档目录超时');
        }),
      ]);
    } finally {
      timer.abort();
    }
  }
  return { client: new NovelAIClient(apiKey), archiveDir, imageOrigin, vibeCache: new VibeCache(archiveDir) };
}

export function logFatal(error: unknown): void {
  console.error('服务运行失败', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

export function onShutdown(close: () => Promise<void>): void {
  function stop() {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    void close().catch(logFatal);
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
