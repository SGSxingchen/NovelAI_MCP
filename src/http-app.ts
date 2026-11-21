import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import type { ErrorRequestHandler, Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ErrorCode, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { AdminAuth } from './admin-auth.js';
import { registerAdminRoutes } from './admin-routes.js';
import { IMAGE_PATH, loadArchivedImage } from './image-archive.js';
import { LibraryStore } from './library-store.js';
import { LinkStore, parseBootstrapLinks } from './link-store.js';
import type { McpLinkRecord } from './link-store.js';
import { createNovelAIMcpServer, PROGRESSIVE_TOOL_COUNT, SERVER_NAME, SERVER_VERSION, TOOL_COUNT } from './mcp-tools.js';
import type { NovelAIMcpServerOptions } from './mcp-tools.js';
import { getRuntimeOptions, onShutdown, parseOrigin } from './runtime.js';
import { DEFAULT_DISCLOSURE_MODE } from './types.js';
import type { DisclosureMode } from './types.js';
import { VibeCache } from './vibe-cache.js';

type HttpMode = 'streamable-http' | 'sse';
export type AppOptions = Pick<NovelAIMcpServerOptions, 'client' | 'archiveDir' | 'imageOrigin' | 'vibeCache' | 'disclosureMode'> & {
  allowedOrigins?: readonly string[];
  bindHost?: string;
  publicOrigin?: URL;
  linkStore?: LinkStore;
  adminAuth?: AdminAuth;
  adminEnabled?: boolean;
  adminPassword?: string;
};

const SESSION_TIMEOUT = 30 * 60 * 1_000;
const IMAGE_FILENAME = /^([A-Za-z0-9_-]{43})\.(png|webp|jpg)$/;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const LINK_MCP_PATH = '/novelai/:token/mcp';
const parseMcpBody = express.json({ limit: '50mb' });

function rpcError(res: Response, status: number, code: number, message: string) {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

const handleHttpError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error?.type === 'entity.too.large') {
    rpcError(res, 413, ErrorCode.InvalidRequest, '请求体超过 50 MB');
  } else if (error?.type === 'entity.parse.failed') {
    rpcError(res, 400, ErrorCode.ParseError, '请求体必须是有效的 JSON');
  } else if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) {
    rpcError(res, error.status, ErrorCode.InvalidRequest, '请求格式无效');
  } else {
    console.error('MCP HTTP 请求处理失败', error instanceof Error ? error.name : '未知错误');
    rpcError(res, 500, ErrorCode.InternalError, 'MCP HTTP 请求处理失败');
  }
};

function createHttpApp(mode: HttpMode, options: AppOptions, paths: string[]) {
  const app = express();
  const { disclosureMode: defaultDisclosureMode = DEFAULT_DISCLOSURE_MODE } = options;
  app.set('trust proxy', 1);
  const allowedOrigins = new Set(options.allowedOrigins);
  const allowAnyOrigin = allowedOrigins.has('*');
  if (options.imageOrigin) allowedOrigins.add(options.imageOrigin.origin);
  if (options.publicOrigin) allowedOrigins.add(options.publicOrigin.origin);
  app.use(paths, (req, res, next) => {
    const origin = req.get('Origin');
    if (origin === undefined || allowAnyOrigin) {
      next();
      return;
    }
    const parsed = parseOrigin(origin);
    if (parsed?.origin === origin && (
      allowedOrigins.has(origin)
      || LOCAL_HOSTNAMES.has(parsed.hostname)
      || (parsed.hostname.replace(/^\[|\]$/g, '') === options.bindHost && parsed.host === req.get('Host'))
    )) {
      next();
      return;
    }
    rpcError(res, 403, ErrorCode.InvalidRequest, 'MCP 请求来源未获允许');
  });
  app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'MCP-Protocol-Version', 'Last-Event-ID'],
    exposedHeaders: ['Mcp-Session-Id', 'MCP-Protocol-Version'],
  }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok', service: SERVER_NAME, mode, version: SERVER_VERSION, tools: TOOL_COUNT,
      disclosureMode: defaultDisclosureMode, progressiveTools: PROGRESSIVE_TOOL_COUNT, totalActions: TOOL_COUNT,
    });
  });

  const { archiveDir, imageOrigin, client } = options;
  if (imageOrigin && archiveDir) {
    app.get(`${IMAGE_PATH}:filename`, async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      res.set('Referrer-Policy', 'no-referrer');
      res.set('X-Content-Type-Options', 'nosniff');
      const match = IMAGE_FILENAME.exec(req.params.filename);
      if (!match) {
        res.sendStatus(404);
        return;
      }
      try {
        const image = await loadArchivedImage(archiveDir, match[1], { publicOnly: true });
        if (image.ext !== match[2]) {
          res.sendStatus(404);
          return;
        }
        res.type(image.mimeType).send(image.buffer);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          res.sendStatus(404);
          return;
        }
        throw error;
      }
    });
  }

  const vibeCache = options.vibeCache ?? new VibeCache(archiveDir);
  const libraryStore = new LibraryStore(archiveDir);
  const createServerForSession = (linkOptions?: Pick<NovelAIMcpServerOptions, 'disclosureMode' | 'linkContext' | 'onToolCompleted'>) => createNovelAIMcpServer({
    client, archiveDir, imageOrigin, vibeCache, libraryStore, transportLabel: mode, allowLocalFiles: false,
    disclosureMode: defaultDisclosureMode, ...linkOptions,
  });
  return { app, createServerForSession, defaultDisclosureMode, vibeCache, libraryStore };
}

async function closeTransport(transport: Transport): Promise<void> {
  try {
    await transport.close();
  } catch (error) {
    console.error('关闭 MCP 会话失败', error instanceof Error ? error.name : '未知错误');
  }
}

export function createStreamableHttpApp(options: AppOptions) {
  const { app, createServerForSession, defaultDisclosureMode, vibeCache, libraryStore } =
    createHttpApp('streamable-http', options, ['/mcp', LINK_MCP_PATH]);
  const { archiveDir, client, imageOrigin, publicOrigin = imageOrigin } = options;
  const linkStore = options.linkStore ?? new LinkStore(archiveDir);
  const sessions = new Map<string, {
    transport: StreamableHTTPServerTransport; lastActivity: number; disclosureMode: DisclosureMode; linkId?: string;
  }>();
  let closing = false;

  async function removeSession(id: string) {
    const session = sessions.get(id);
    if (session) {
      sessions.delete(id);
      await closeTransport(session.transport);
    }
  }

  async function revokeLinkSessions(linkId: string, { onlyStaleMode = false } = {}): Promise<void> {
    const keepMode = onlyStaleMode ? linkStore.getById(linkId)?.disclosure_mode : undefined;
    const pending: Array<Promise<void>> = [];
    for (const [id, session] of sessions) {
      if (session.linkId === linkId && session.disclosureMode !== keepMode) pending.push(removeSession(id));
    }
    await Promise.all(pending);
  }

  async function forward(req: Request, res: Response, link?: McpLinkRecord) {
    const sessionId = req.get('Mcp-Session-Id');
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!sessionId) {
      rpcError(res, 400, ErrorCode.InvalidRequest, '缺少 MCP 会话 ID');
    } else if (!session || session.transport.sessionId !== sessionId || session.linkId !== link?.id
      || session.disclosureMode !== (link?.disclosure_mode ?? defaultDisclosureMode)) {
      rpcError(res, 404, -32001, 'MCP 会话不存在或已关闭');
    } else {
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res, req.body);
    }
  }

  async function initializeOrForward(req: Request, res: Response, link?: McpLinkRecord) {
    if (req.get('Mcp-Session-Id') || !isInitializeRequest(req.body)) {
      await forward(req, res, link);
      return;
    }
    if (closing) {
      rpcError(res, 503, ErrorCode.InternalError, 'MCP 服务正在关闭');
      return;
    }
    const sessionId = randomUUID();
    const disclosureMode = link?.disclosure_mode ?? defaultDisclosureMode;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
    transport.onclose = () => { sessions.delete(sessionId); };
    sessions.set(sessionId, { transport, lastActivity: Date.now(), disclosureMode, linkId: link?.id });
    try {
      await createServerForSession(link && {
        disclosureMode,
        linkContext: { id: link.id, label: link.label },
        onToolCompleted: ({ anlasSpent }) => {
          void linkStore.recordUsage(link.id, anlasSpent ?? 0).catch(() => console.error('记录 MCP 链接使用统计失败'));
        },
      }).connect(transport);
      if (closing) {
        rpcError(res, 503, ErrorCode.InternalError, 'MCP 服务正在关闭');
        return;
      }
      if (link) {
        const current = linkStore.findActiveByToken(link.token);
        if (!sessions.has(sessionId) || current?.id !== link.id
          || (current.disclosure_mode ?? defaultDisclosureMode) !== disclosureMode) {
          await removeSession(sessionId);
          res.sendStatus(404);
          return;
        }
      }
      await transport.handleRequest(req, res, req.body);
      if (!transport.sessionId || res.statusCode !== 200) await removeSession(sessionId);
    } catch (error) {
      await removeSession(sessionId);
      throw error;
    }
  }

  app.use('/mcp', parseMcpBody);
  app.post('/mcp', (req, res) => initializeOrForward(req, res));
  app.get('/mcp', (req, res) => forward(req, res));
  app.delete('/mcp', (req, res) => forward(req, res));

  function activeLink(req: Request, res: Response): McpLinkRecord | undefined {
    const token = req.params.token;
    const link = typeof token === 'string' ? linkStore.findActiveByToken(token) : undefined;
    if (!link) res.sendStatus(404);
    return link;
  }

  const dynamicMcp = app.route(LINK_MCP_PATH);
  dynamicMcp.all(async (req, res, next) => {
    await linkStore.init();
    if (activeLink(req, res)) next();
  });
  dynamicMcp.post(parseMcpBody, (req, res) => {
    // 请求体读取期间，链接可能被停用、轮换、到期或切换模式。
    const link = activeLink(req, res);
    if (link) return initializeOrForward(req, res, link);
  });
  const dynamicForward = (req: Request, res: Response) => {
    const link = activeLink(req, res);
    if (link) return forward(req, res, link);
  };
  dynamicMcp.get(dynamicForward);
  dynamicMcp.delete(dynamicForward);

  if (options.adminEnabled !== false) {
    const adminAuth = options.adminAuth ?? new AdminAuth({ archiveDir, adminPassword: options.adminPassword });
    registerAdminRoutes(app, {
      archiveDir, client, imageOrigin, publicOrigin, linkStore, libraryStore, vibeCache,
      adminAuth, defaultDisclosureMode, onRevokeLink: revokeLinkSessions,
    });
  }
  app.use(handleHttpError);

  const cleanupInterval = setInterval(() => {
    const expiredBefore = Date.now() - SESSION_TIMEOUT;
    for (const [id, session] of sessions) {
      if (session.lastActivity < expiredBefore) void removeSession(id);
    }
  }, 5 * 60 * 1_000).unref();

  async function close() {
    closing = true;
    clearInterval(cleanupInterval);
    await Promise.all([...sessions.keys()].map(removeSession));
    await Promise.all([linkStore.flush(), libraryStore.flush()]);
  }

  return { app, close, revokeLinkSessions };
}

export function createSseApp(options: AppOptions) {
  const { app, createServerForSession, libraryStore } = createHttpApp('sse', options, ['/sse', '/message']);
  const sessions = new Map<string, SSEServerTransport>();
  let closing = false;
  app.use(['/sse', '/message'], parseMcpBody);

  app.get('/sse', async (_req, res) => {
    if (closing) {
      res.sendStatus(503);
      return;
    }
    const transport = new SSEServerTransport('/message', res);
    transport.onclose = () => { sessions.delete(transport.sessionId); };
    sessions.set(transport.sessionId, transport);
    try {
      await createServerForSession().connect(transport);
      if (closing) await closeTransport(transport);
    } catch (error) {
      sessions.delete(transport.sessionId);
      await closeTransport(transport);
      throw error;
    }
  });

  app.post('/message', async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (!transport) {
      rpcError(res, 404, -32001, 'SSE 会话不存在或已关闭');
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });
  app.use(handleHttpError);

  async function close() {
    closing = true;
    const transports = [...sessions.values()];
    sessions.clear();
    await Promise.all(transports.map(closeTransport));
    await libraryStore.flush();
  }

  return { app, close };
}

export async function startHttpServer(mode: HttpMode): Promise<void> {
  const bindHost = process.env.MCP_BIND_HOST || (mode === 'streamable-http' ? '::' : undefined);
  const port = Number(process.env.PORT || '3000');
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('PORT 必须是有效端口');

  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)
    .map(value => {
      if (value === '*') return '*';
      const origin = parseOrigin(value);
      if (!origin) throw new Error('MCP_ALLOWED_ORIGINS 必须填写 * 或逗号分隔的 HTTP/HTTPS 源地址');
      return origin.origin;
    });
  const options: AppOptions = { ...await getRuntimeOptions(), bindHost, allowedOrigins };
  if (mode === 'streamable-http') {
    const configuredOrigin = process.env.MCP_PUBLIC_ORIGIN;
    options.publicOrigin = configuredOrigin ? parseOrigin(configuredOrigin) : options.imageOrigin;
    if (configuredOrigin && !options.publicOrigin) throw new Error('MCP_PUBLIC_ORIGIN 必须是无路径的 HTTP/HTTPS 源地址');
    options.linkStore = new LinkStore(options.archiveDir);
    options.adminAuth = new AdminAuth({ archiveDir: options.archiveDir, adminPassword: process.env.MCP_ADMIN_PASSWORD });
    await Promise.all([options.linkStore.init(parseBootstrapLinks()), options.adminAuth.init()]);
  }
  const { app, close } = mode === 'streamable-http' ? createStreamableHttpApp(options) : createSseApp(options);
  const server = createServer({ headersTimeout: 15_000, requestTimeout: 0 }, app);
  try {
    server.listen(port, bindHost);
    await once(server, 'listening');
  } catch (error) {
    await close();
    throw error;
  }

  const actualAddress = server.address();
  const actualPort = typeof actualAddress === 'object' && actualAddress ? actualAddress.port : port;
  onShutdown(async () => {
    const deadline = setTimeout(() => server.closeAllConnections(), 5_000).unref();
    const closeListener = new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    try {
      await Promise.all([closeListener, close()]);
    } finally {
      clearTimeout(deadline);
    }
  });
  console.error(`NovelAI MCP 已启动，端口 ${actualPort}，入口 ${mode === 'streamable-http' ? '/mcp' : '/sse'}`);
}
