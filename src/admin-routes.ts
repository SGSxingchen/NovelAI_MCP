import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import type { ErrorRequestHandler, Express, Request } from 'express';
import type { AdminAuth } from './admin-auth.js';
import {
  ARCHIVE_ID_REGEX, IMAGE_PATH, deleteArchivedImage, getArchiveStats, getOrCreateThumbnail,
  loadArchivedImage, queryArchivedImages,
} from './image-archive.js';
import type { ArchivedImageMetadata, ArchiveQuery } from './image-archive.js';
import { extractPngTextMetadata } from './image-input.js';
import { isLinkExpired } from './link-store.js';
import type { LinkStore, McpLinkRecord } from './link-store.js';
import type { NovelAIClient } from './novelai-client.js';
import { parseOrigin } from './runtime.js';
import type { ImageExtension } from './types.js';

const ADMIN_PATH = '/novelai-admin';
const API_PATH = `${ADMIN_PATH}/api`;
const WEB_DIRECTORY = fileURLToPath(new URL('../web/admin', import.meta.url));
const MAX_BATCH_DELETE = 200;

interface AdminRoutesOptions {
  adminAuth: AdminAuth;
  linkStore: LinkStore;
  client: Pick<NovelAIClient, 'getSubscription'>;
  archiveDir?: string;
  publicOrigin?: URL;
  imageOrigin?: URL;
  onRevokeLink: (id: string) => void | Promise<void>;
}

class AdminRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

const handleAdminError: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof AdminRequestError) {
    res.status(error.status).json({ error: error.message });
  } else if (isMissing(error)) {
    res.status(404).json({ error: '找不到归档图片' });
  } else if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: '管理台请求体过大' });
  } else if (error?.status >= 400 && error.status < 500) {
    res.status(error.status).json({ error: '管理台请求格式无效' });
  } else if (error instanceof RangeError) {
    res.status(400).json({ error: '请求参数超出有效范围' });
  } else {
    console.error('管理台请求处理失败', error instanceof Error ? error.name : '未知错误');
    res.status(500).json({ error: '管理台请求处理失败' });
  }
};

function imageDirectory(archiveDir: string | undefined, id: string): string {
  if (!ARCHIVE_ID_REGEX.test(id)) throw new AdminRequestError(400, '归档图片 ID 无效');
  if (!archiveDir) throw new AdminRequestError(404, '找不到归档图片');
  return archiveDir;
}

function imageItem(metadata: ArchivedImageMetadata, origin?: URL, ext?: ImageExtension) {
  const { id, mime_type } = metadata;
  const extension = ext ?? ({ 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' } as const)[mime_type] ?? 'png';
  return {
    ...metadata,
    ext: extension,
    thumb_url: `${API_PATH}/images/${id}/thumb`,
    image_url: `${API_PATH}/images/${id}/raw`,
    public_url: origin ? `${origin.origin}${IMAGE_PATH}${id}.${extension}` : null,
  };
}

function archiveQuery(req: Request): ArchiveQuery {
  function string(name: string): string | undefined {
    const value = req.query[name];
    if (value === undefined || typeof value === 'string') return value;
    throw new AdminRequestError(400, `查询参数 ${name} 必须为字符串`);
  }
  function number(name: string): number | undefined {
    const value = string(name);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) {
      throw new AdminRequestError(400, `查询参数 ${name} 必须为非负整数`);
    }
    return parsed;
  }
  const sort = string('sort');
  if (sort !== undefined && sort !== 'newest' && sort !== 'oldest') {
    throw new AdminRequestError(400, '查询参数 sort 必须为 newest 或 oldest');
  }
  return { limit: number('limit'), offset: number('offset'), q: string('q'), model: string('model'),
    tool: string('tool'), link_id: string('link_id'), sort };
}

function readBody(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new AdminRequestError(400, '请求体必须为 JSON 对象');
  }
  return req.body;
}

function linkLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new AdminRequestError(400, 'label 必须是非空字符串');
  return value.trim();
}

function linkExpiry(value: unknown): number | null | undefined {
  if (value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value))) return value;
  throw new AdminRequestError(400, 'expires_in_hours 必须是有效小时数或 null');
}

export function registerAdminRoutes(app: Express, options: AdminRoutesOptions): void {
  const { archiveDir, adminAuth, linkStore, client, imageOrigin, onRevokeLink, publicOrigin } = options;
  const configuredOrigin = publicOrigin?.origin ?? null;
  const api = Router();
  const parseJson = express.json({ limit: '64kb' });

  function linkItem(item: McpLinkRecord, req: Request) {
    const host = req.get('host');
    const origin = configuredOrigin ?? (host ? parseOrigin(`${req.protocol}://${host}`)?.origin : undefined);
    return { ...item, url: `${origin ?? ''}/novelai/${encodeURIComponent(item.token)}/mcp`, expired: isLinkExpired(item) };
  }

  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  api.get('/auth/status', async (req, res) => {
    res.json({ authenticated: await adminAuth.isAuthenticated(req), adminConfigured: true, publicOrigin: configuredOrigin });
  });
  api.post('/auth/login', parseJson, (req, res) => adminAuth.login(req, res, publicOrigin));
  api.post('/auth/logout', (req, res) => adminAuth.logout(req, res, publicOrigin));

  api.use(async (req, res, next) => {
    if (await adminAuth.isAuthenticated(req)) next();
    else res.status(401).json({ error: '请先登录管理台' });
  });

  api.get('/overview', async (_req, res) => {
    const [archive] = await Promise.all([getArchiveStats(archiveDir), linkStore.init()]);
    const items = linkStore.list();
    const links = { total: items.length, enabled: 0, totalCalls: 0, totalAnlasSpent: 0 };
    for (const item of items) {
      if (item.enabled && !isLinkExpired(item)) links.enabled++;
      links.totalCalls += item.call_count;
      links.totalAnlasSpent += item.total_anlas_spent;
    }
    res.json({ archive, links, publicOrigin: configuredOrigin });
  });

  api.get('/subscription', async (_req, res) => {
    try {
      const { summary } = await client.getSubscription();
      res.json({ summary });
    } catch {
      console.error('读取 NovelAI 订阅失败');
      res.status(502).json({ error: '读取 NovelAI 订阅失败' });
    }
  });

  api.get('/images', async (req, res) => {
    const result = await queryArchivedImages(archiveDir, archiveQuery(req));
    res.json({ ...result, items: result.items.map(item => imageItem(item, imageOrigin)) });
  });
  api.get('/images/:id', async (req, res) => {
    const { id } = req.params;
    const { metadata, ext, buffer } = await loadArchivedImage(imageDirectory(archiveDir, id), id);
    res.json({ ...imageItem(metadata, imageOrigin, ext), ...(ext === 'png' ? { png_metadata: extractPngTextMetadata(buffer) } : {}) });
  });
  api.get('/images/:id/thumb', async (req, res) => {
    const { id } = req.params;
    const thumbnail = await getOrCreateThumbnail(imageDirectory(archiveDir, id), id);
    res.set('Cache-Control', 'private, max-age=86400');
    res.type('image/webp').send(thumbnail);
  });
  api.get('/images/:id/raw', async (req, res) => {
    const { id } = req.params;
    const { buffer, mimeType, ext } = await loadArchivedImage(imageDirectory(archiveDir, id), id);
    if (req.query.download === '1') res.set('Content-Disposition', `attachment; filename="novelai-${id}.${ext}"`);
    res.type(mimeType).send(buffer);
  });
  api.delete('/images/:id', async (req, res) => {
    const { id } = req.params;
    await deleteArchivedImage(imageDirectory(archiveDir, id), id);
    res.json({ ok: true, id });
  });
  api.post('/images/batch-delete', parseJson, async (req, res) => {
    const { ids } = readBody(req);
    if (!Array.isArray(ids) || ids.length > MAX_BATCH_DELETE || !ids.every(id => typeof id === 'string')) {
      throw new AdminRequestError(400, 'ids 必须是最多包含 200 个 ID 的字符串数组');
    }
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const id of new Set<string>(ids)) {
      try {
        await deleteArchivedImage(imageDirectory(archiveDir, id), id);
        deleted.push(id);
      } catch (error) {
        if (!(error instanceof AdminRequestError) && !isMissing(error)) console.error('批量删除归档图片时遇到系统错误');
        failed.push(id);
      }
    }
    res.json({ ok: true, deleted, failed });
  });

  api.get('/links', async (req, res) => {
    await linkStore.init();
    res.json({ items: linkStore.list().map(item => linkItem(item, req)), publicOrigin: configuredOrigin });
  });
  api.post('/links', parseJson, async (req, res) => {
    const { label, expires_in_hours } = readBody(req);
    const item = await linkStore.create({ label: linkLabel(label), expires_in_hours: linkExpiry(expires_in_hours) });
    res.status(201).json({ item: linkItem(item, req) });
  });
  api.patch('/links/:id', parseJson, async (req, res) => {
    const { id } = req.params;
    const { label, expires_in_hours, enabled } = readBody(req);
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new AdminRequestError(400, 'enabled 必须为布尔值');
    const item = await linkStore.update(id, {
      label: label === undefined ? undefined : linkLabel(label), enabled, expires_in_hours: linkExpiry(expires_in_hours),
    });
    if (!item) throw new AdminRequestError(404, '找不到 MCP 链接');
    if (enabled === false || isLinkExpired(item)) await onRevokeLink(id);
    res.json({ item: linkItem(item, req) });
  });
  api.post('/links/:id/rotate', async (req, res) => {
    const { id } = req.params;
    const updated = await linkStore.rotate(id);
    if (!updated) throw new AdminRequestError(404, '找不到 MCP 链接');
    await onRevokeLink(id);
    res.json({ item: linkItem(updated.item, req) });
  });
  api.delete('/links/:id', async (req, res) => {
    const { id } = req.params;
    if (!await linkStore.delete(id)) throw new AdminRequestError(404, '找不到 MCP 链接');
    await onRevokeLink(id);
    res.json({ ok: true, id });
  });

  api.use((_req, res) => { res.status(404).json({ error: '找不到管理台接口' }); });
  api.use(handleAdminError);
  app.get(/^\/novelai-admin$/, (_req, res) => { res.redirect(302, `${ADMIN_PATH}/`); });
  app.use(API_PATH, api);
  app.use(ADMIN_PATH, express.static(WEB_DIRECTORY, {
    maxAge: '1h',
    setHeaders(res, path) {
      if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
}
