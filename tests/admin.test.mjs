import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { createStreamableHttpApp } from '../dist/http-app.js';
import { getOrCreateThumbnail, saveArchivedImage, saveImage } from '../dist/image-archive.js';
import { resolveImageInput } from '../dist/image-input.js';
import { LinkStore, parseBootstrapLinks } from '../dist/link-store.js';
import { getDisclosureMetrics } from '../dist/mcp-tools.js';
import { NovelAIClient } from '../dist/novelai-client.js';

const adminPassword = 'local-admin-test-password';
const protocolVersion = '2025-11-25';
const apiBase = '/novelai-admin/api';
const publicOrigin = new URL('https://mcp.example.test');
const imageOrigin = new URL('https://images.example.test');
const httpEntry = fileURLToPath(new URL('../dist/streamable-http-server.js', import.meta.url));
const { legacyTools: totalActions, ...disclosureMetrics } = getDisclosureMetrics();
const defaultDisclosure = { defaultMode: 'progressive', totalActions, ...disclosureMetrics };

const configuredPassword = process.env.MCP_ADMIN_PASSWORD;
delete process.env.MCP_ADMIN_PASSWORD;
test.after(() => {
  if (configuredPassword !== undefined) process.env.MCP_ADMIN_PASSWORD = configuredPassword;
});

async function tempArchive(t) {
  const directory = await mkdtemp(join(tmpdir(), 'novelai-admin-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function listen(t, handler, close = async () => {}) {
  const server = createServer({ requestTimeout: 12_000 }, handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening', { signal: AbortSignal.timeout(5_000) });
  let stopping;
  function stop() {
    stopping ??= close().finally(() => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }));
    return stopping;
  }
  t.after(stop);
  return { origin: `http://127.0.0.1:${server.address().port}`, stop };
}

function startApp(t, options = {}) {
  const client = new NovelAIClient('local-test-token', { baseUrl: 'http://127.0.0.1:1', timeoutMs: 3_000 });
  const { app, close } = createStreamableHttpApp({ client, adminPassword, ...options });
  return listen(t, app, close);
}

async function startConfiguredServer(t, archiveDir, bootstrapLinks, disclosureMode = '') {
  const child = spawn(process.execPath, [httpEntry], {
    env: {
      ...process.env, NOVELAI_API_KEY: 'local-test-token', MCP_BIND_HOST: '127.0.0.1', PORT: '0',
      MCP_ADMIN_PASSWORD: adminPassword, MCP_IMAGE_ARCHIVE_DIR: archiveDir, MCP_PUBLIC_ORIGIN: publicOrigin.origin,
      MCP_IMAGE_PUBLIC_ORIGIN: '', MCP_ALLOWED_ORIGINS: '', MCP_BOOTSTRAP_LINKS: JSON.stringify(bootstrapLinks),
      NOVELAI_MCP_DISCLOSURE_MODE: disclosureMode,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const exited = once(child, 'exit');
  const lines = createInterface({ input: child.stderr });
  t.after(async () => {
    lines.close();
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    try {
      assert.deepEqual(await exited, [0, null]);
    } finally {
      clearTimeout(deadline);
    }
  });
  const [line] = await Promise.race([
    once(lines, 'line', { signal: AbortSignal.timeout(6_000) }),
    exited.then(([code]) => { throw new Error(`HTTP 服务在启动时退出，退出码 ${code}`); }),
  ]);
  const port = line.match(/已启动，端口 (\d+)/)?.[1];
  assert.ok(port, line);
  return `http://127.0.0.1:${port}`;
}

function request(origin, path, { body, headers, cookie, ...options } = {}) {
  return fetch(new URL(path, origin), {
    ...options,
    signal: AbortSignal.timeout(6_000),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function api(origin, path, options) {
  return request(origin, apiBase + path, options);
}

async function json(responsePromise, status = 200) {
  const response = await responsePromise;
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

async function expectStatus(responsePromise, status) {
  const response = await responsePromise;
  const body = await response.text();
  assert.equal(response.status, status, body);
}

function logIn(origin, password = adminPassword, headers) {
  return api(origin, '/auth/login', { method: 'POST', body: { password }, headers });
}

async function signIn(origin, password, headers) {
  const response = await logIn(origin, password, headers);
  assert.deepEqual(await json(response), { ok: true });
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^novelai_admin_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}; /);
  return { cookie: cookie.split(';')[0], attributes: cookie };
}

const mcpPath = token => `/novelai/${token}/mcp`;
const initializeRequest = {
  id: 1, method: 'initialize',
  params: { protocolVersion, capabilities: {}, clientInfo: { name: 'novelai-admin-test', version: '1.0.0' } },
};

function postMcp(origin, path, body, headers) {
  return request(origin, path, {
    method: 'POST', body: { jsonrpc: '2.0', ...body },
    headers: { Accept: 'application/json, text/event-stream', ...headers },
  });
}

async function rpcResult(responsePromise) {
  const response = await responsePromise;
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const line = body.split(/\r?\n/).find(value => value.startsWith('data: ') && value.length > 6);
  const message = JSON.parse(line ? line.slice(6) : body);
  assert.equal(message.error, undefined, JSON.stringify(message.error));
  return message.result;
}

async function openMcp(origin, path, originHeader) {
  const response = await postMcp(origin, path, initializeRequest, originHeader ? { Origin: originHeader } : undefined);
  assert.equal((await rpcResult(response)).protocolVersion, protocolVersion);
  const sessionId = response.headers.get('mcp-session-id');
  assert.ok(sessionId);
  const headers = { 'Mcp-Session-Id': sessionId, 'Mcp-Protocol-Version': protocolVersion };
  await expectStatus(postMcp(origin, path, { method: 'notifications/initialized' }, headers), 202);
  return headers;
}

function pngComment(png, comment) {
  const text = Buffer.from(`Comment\0${JSON.stringify(comment)}`);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(text.length);
  header.write('tEXt', 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(text, crc32(header.subarray(4))));
  return Buffer.concat([png.subarray(0, -12), header, text, crc, png.subarray(-12)]);
}

function createImage(width, height) {
  return sharp({ create: { width, height, channels: 3, background: '#304870' } });
}

async function writeHistoricalLink(archiveDir) {
  const item = {
    id: 'lnk_123456789abc', label: '历史链接', token: 'old-link-disclosure', enabled: true,
    created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
    expires_at: null, last_used_at: null, call_count: 2, total_anlas_spent: 7,
  };
  const directory = join(archiveDir, '.admin');
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'links.json'), JSON.stringify([item]), { mode: 0o600 });
  return item;
}

test('管理台鉴权按 IP 限流、签发安全 Cookie 并立即吊销登出会话', { timeout: 20_000 }, async t => {
  const { origin } = await startApp(t);
  const redirect = await request(origin, '/novelai-admin', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/novelai-admin/');
  await redirect.text();
  assert.deepEqual(await json(api(origin, '/auth/status')), { authenticated: false, adminConfigured: true, publicOrigin: null });
  assert.deepEqual(await json(api(origin, '/overview'), 401), { error: '请先登录管理台' });
  assert.deepEqual(await json(api(origin, '/links', { method: 'POST' }), 401), { error: '请先登录管理台' });

  const blockedIp = { 'X-Forwarded-For': '198.51.100.10' };
  for (let attempt = 1; attempt < 10; attempt++) {
    assert.deepEqual(await json(logIn(origin, 'wrong-password', blockedIp), 401), { error: '管理员密码错误' });
  }
  const locked = await logIn(origin, 'wrong-password', blockedIp);
  const rejection = await json(locked, 429);
  assert.ok(rejection.error);
  assert.ok(Number.isInteger(rejection.retryAfterSeconds) && rejection.retryAfterSeconds > 0 && rejection.retryAfterSeconds <= 900);
  assert.equal(locked.headers.get('retry-after'), String(rejection.retryAfterSeconds));
  await json(logIn(origin, adminPassword, blockedIp), 429);

  const otherIp = { 'X-Forwarded-For': '198.51.100.11' };
  for (let attempt = 1; attempt < 10; attempt++) await json(logIn(origin, 'wrong-password', otherIp), 401);
  const local = await signIn(origin, adminPassword, otherIp);
  assert.doesNotMatch(local.attributes, /\bSecure\b/);
  await json(logIn(origin, 'wrong-password', otherIp), 401);
  const { cookie, attributes } = await signIn(origin, adminPassword, { ...otherIp, 'X-Forwarded-Proto': 'https' });
  for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Path=/novelai-admin', 'Max-Age=604800', 'Secure']) {
    assert.ok(attributes.split('; ').includes(attribute), attributes);
  }
  assert.deepEqual(await json(api(origin, '/auth/status', { cookie })), { authenticated: true, adminConfigured: true, publicOrigin: null });
  const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`;
  await json(api(origin, '/overview', { cookie: tampered }), 401);
  assert.deepEqual(await json(api(origin, '/overview', { cookie })), {
    archive: { totalCount: 0, totalBytes: 0, models: {}, links: {} },
    links: { total: 0, enabled: 0, totalCalls: 0, totalAnlasSpent: 0 }, publicOrigin: null,
    disclosure: defaultDisclosure,
  });

  const logout = await api(origin, '/auth/logout', { method: 'POST', cookie });
  assert.deepEqual(await json(logout), { ok: true });
  assert.match(logout.headers.get('set-cookie'), /^novelai_admin_session=; Max-Age=0;/);
  await json(api(origin, '/overview', { cookie }), 401);
  assert.equal((await json(api(origin, '/auth/status', { cookie: local.cookie }))).authenticated, true);

  const now = Date.now();
  const time = t.mock.method(Date, 'now', () => now + 15 * 60 * 1_000 + 1);
  await signIn(origin, adminPassword, blockedIp);
  time.mock.restore();
  t.mock.method(Date, 'now', () => now + 7 * 24 * 60 * 60 * 1_000 + 1);
  assert.equal((await json(api(origin, '/auth/status', { cookie: local.cookie }))).authenticated, false);
});

test('归档模式安全生成管理员凭据，重启保留有效会话和登出记录', { timeout: 20_000 }, async t => {
  const archiveDir = await tempArchive(t);
  const logs = [];
  t.mock.method(console, 'error', (...values) => logs.push(values.join(' ')));
  const first = await startApp(t, { archiveDir, adminPassword: undefined, publicOrigin });
  assert.deepEqual(await json(api(first.origin, '/auth/status')), {
    authenticated: false, adminConfigured: true, publicOrigin: publicOrigin.origin,
  });
  const adminDir = join(archiveDir, '.admin');
  const passwordPath = join(adminDir, 'admin-password.txt');
  const secretPath = join(adminDir, 'session-secret.key');
  const password = await readFile(passwordPath, 'utf8');
  const initialSecret = await readFile(secretPath);
  assert.match(password, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(initialSecret.length, 32);
  assert.equal(logs.filter(line => line.includes('已自动生成管理员密码')).length, 1);
  assert.ok(logs.some(line => line.includes(passwordPath)));
  assert.equal(logs.some(line => line.includes(password)), false, '日志不得包含自动生成的密码');

  const firstLogin = await signIn(first.origin, password);
  const secondLogin = await signIn(first.origin, password);
  assert.match(firstLogin.attributes, /; Secure(?:;|$)/);
  await json(api(first.origin, '/auth/logout', { method: 'POST', cookie: firstLogin.cookie }));
  await first.stop();

  const second = await startApp(t, { archiveDir, adminPassword: undefined, publicOrigin });
  assert.equal((await json(api(second.origin, '/auth/status', { cookie: secondLogin.cookie }))).authenticated, true);
  assert.equal((await json(api(second.origin, '/auth/status', { cookie: firstLogin.cookie }))).authenticated, false);
  assert.deepEqual(await readFile(secretPath), initialSecret);
  assert.equal(await readFile(passwordPath, 'utf8'), password);
  assert.equal(logs.filter(line => line.includes('已自动生成管理员密码')).length, 1);
  assert.equal((await stat(adminDir)).mode & 0o777, 0o700);
  for (const file of [passwordPath, secretPath, join(adminDir, 'sessions.json')]) {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
});

test('HTTP 入口导入预设令牌，动态链接停用、轮换、过期与删除即时生效', { timeout: 25_000 }, async t => {
  const archiveDir = await tempArchive(t);
  const bootstrap = [
    { label: '本人 Gemini', token: 'existing-gemini-link' },
    { label: '对象 Gemini', token: 'existing-partner-link', enabled: false },
  ];
  const origin = await startConfiguredServer(t, archiveDir, bootstrap);
  const { cookie, attributes } = await signIn(origin);
  assert.match(attributes, /; Secure(?:;|$)/);
  const initial = await json(api(origin, '/links', { cookie }));
  assert.equal(initial.publicOrigin, publicOrigin.origin);
  assert.deepEqual(initial.items.map(({ label, token, enabled }) => ({ label, token, enabled })), [
    { ...bootstrap[0], enabled: true }, bootstrap[1],
  ]);
  const bootPath = mcpPath(bootstrap[0].token);
  assert.equal(initial.items[0].url, publicOrigin.origin + bootPath);
  await expectStatus(postMcp(origin, mcpPath(bootstrap[1].token), initializeRequest), 404);
  await expectStatus(postMcp(origin, bootPath, initializeRequest, { Origin: 'https://untrusted.example.test' }), 403);
  const bootstrapSession = await openMcp(origin, bootPath, publicOrigin.origin);
  const legacySession = await openMcp(origin, '/mcp');

  await json(api(origin, '/links', { method: 'POST', cookie, body: { label: ' ', expires_in_hours: 1 } }), 400);
  const { item } = await json(api(origin, '/links', {
    method: 'POST', cookie, body: { label: '分享链接', expires_in_hours: 3 },
  }), 201);
  assert.match(item.id, /^lnk_[a-f0-9]{12}$/);
  assert.match(item.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(item.enabled, true);
  assert.equal(item.expired, false);
  assert.equal(item.last_used_at, null);
  assert.equal(Date.parse(item.expires_at) - Date.parse(item.created_at), 3 * 60 * 60 * 1_000);
  assert.equal(item.url, publicOrigin.origin + mcpPath(item.token));

  const linkApi = `/links/${item.id}`;
  const patch = body => json(api(origin, linkApi, { method: 'PATCH', body, cookie }));
  const { item: renamed } = await patch({ label: '新备注', expires_in_hours: null });
  assert.equal(renamed.label, '新备注');
  assert.equal(renamed.expires_at, null);
  assert.equal(renamed.token, item.token);
  const oldPath = mcpPath(item.token);
  const oldSession = await openMcp(origin, oldPath);
  const listTools = { id: 2, method: 'tools/list' };
  assert.ok((await rpcResult(postMcp(origin, oldPath, listTools, oldSession))).tools.length > 0);
  await expectStatus(postMcp(origin, bootPath, listTools, oldSession), 404);
  await expectStatus(postMcp(origin, '/mcp', listTools, oldSession), 404);
  await expectStatus(postMcp(origin, oldPath, listTools, legacySession), 404);

  const sse = await request(origin, oldPath, { headers: { ...oldSession, Accept: 'text/event-stream' } });
  assert.equal(sse.status, 200);
  assert.match(sse.headers.get('content-type'), /text\/event-stream/);
  assert.equal((await patch({ enabled: false })).item.enabled, false);
  await sse.text();
  await expectStatus(postMcp(origin, oldPath, listTools, oldSession), 404);
  await expectStatus(request(origin, oldPath, { method: 'DELETE', headers: oldSession }), 404);
  assert.equal((await patch({ enabled: true })).item.enabled, true);
  await expectStatus(postMcp(origin, oldPath, listTools, oldSession), 404);
  const beforeRotation = await openMcp(origin, oldPath);

  const { item: rotated } = await json(api(origin, `${linkApi}/rotate`, { method: 'POST', cookie }));
  assert.equal(rotated.id, item.id);
  assert.match(rotated.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(rotated.token, item.token);
  const newPath = mcpPath(rotated.token);
  await expectStatus(postMcp(origin, oldPath, initializeRequest), 404);
  await expectStatus(postMcp(origin, newPath, listTools, beforeRotation), 404);
  const newSession = await openMcp(origin, newPath);
  const { item: expired } = await json(api(origin, '/links', {
    method: 'POST', cookie, body: { label: '已到期', expires_in_hours: 0 },
  }), 201);
  assert.equal(expired.expired, true);
  await expectStatus(postMcp(origin, mcpPath(expired.token), initializeRequest), 404);
  assert.equal((await patch({ expires_in_hours: -1 })).item.expired, true);
  await expectStatus(postMcp(origin, newPath, listTools, newSession), 404);
  assert.equal((await patch({ expires_in_hours: null })).item.expired, false);
  await expectStatus(postMcp(origin, newPath, listTools, newSession), 404);
  const beforeDeletion = await openMcp(origin, newPath);

  assert.deepEqual(await json(api(origin, linkApi, { method: 'DELETE', cookie })), { ok: true, id: item.id });
  await expectStatus(postMcp(origin, newPath, listTools, beforeDeletion), 404);
  assert.equal((await json(api(origin, '/links', { cookie }))).items.some(link => link.id === item.id), false);
  assert.ok((await rpcResult(postMcp(origin, bootPath, listTools, bootstrapSession))).tools.length > 0);
  await expectStatus(request(origin, bootPath, { method: 'DELETE', headers: bootstrapSession }), 200);
  await expectStatus(postMcp(origin, bootPath, listTools, bootstrapSession), 404);
  assert.equal((await stat(join(archiveDir, '.admin', 'links.json'))).mode & 0o777, 0o600);
});

test('动态链接出图保留来源，成功调用累计用量并串行持久化', { timeout: 20_000 }, async t => {
  const archiveDir = await tempArchive(t);
  const png = pngComment(await createImage(64, 64).png().toBuffer(), { seed: 9042 });
  let balance = 120;
  let subscriptionUnavailable = false;
  const generationRequests = [];
  const upstream = await listen(t, async (req, res) => {
    if (req.method === 'GET' && req.url === '/user/subscription') {
      const body = { active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: balance, purchasedTrainingSteps: 0 } };
      res.writeHead(subscriptionUnavailable ? 503 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    } else if (req.method === 'POST' && req.url === '/ai/generate-image') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      generationRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      balance -= 37;
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
    } else {
      res.writeHead(404).end();
    }
  });
  const client = new NovelAIClient('local-test-token', { baseUrl: upstream.origin, timeoutMs: 5_000 });
  const linkStore = new LinkStore(archiveDir);
  const bootstrapped = { label: '图库来源', token: 'test-account-link' };
  await linkStore.init(parseBootstrapLinks(JSON.stringify([bootstrapped, bootstrapped])));
  const backend = await startApp(t, { archiveDir, client, linkStore });
  const { origin } = backend;
  const { cookie } = await signIn(origin);
  const { items } = await json(api(origin, '/links', { cookie }));
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.url, origin + mcpPath(bootstrapped.token));
  assert.equal((await json(api(origin, '/subscription', { cookie }))).summary.totalAnlas, 120);

  const path = mcpPath(item.token);
  const session = await openMcp(origin, path);
  const execute = (id, action, params) => rpcResult(postMcp(origin, path, {
    id, method: 'tools/call', params: { name: 'nai_execute', arguments: { action, params } },
  }, session));
  const invalid = await execute(2, 'generate_image', {});
  assert.equal(invalid.isError, true);
  assert.equal((await json(api(origin, '/links', { cookie }))).items[0].call_count, 0);
  const result = await execute(3, 'generate_image', {
    base_prompt: 'Blue stairs in the rain', width: 64, height: 64, model: 'nai-diffusion-5-curated',
  });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /37 Anlas/);
  assert.deepEqual(result.content[1], { type: 'image', mimeType: 'image/png', data: png.toString('base64') });
  assert.equal(generationRequests.length, 1);
  assert.match(generationRequests[0].input, /Blue stairs in the rain/);
  const imageId = result.content[0].text.match(/image_id ([A-Za-z0-9_-]{43})/)?.[1];
  assert.ok(imageId);
  const archived = JSON.parse(await readFile(join(archiveDir, imageId, 'metadata.json'), 'utf8'));
  assert.equal(archived.link_id, item.id);
  assert.equal(archived.link_label, item.label);
  assert.equal(archived.seed, 9042);
  assert.equal(archived.anlas_spent, 37);
  assert.deepEqual(await readFile(join(archiveDir, imageId, 'image.png')), png);

  const simultaneous = await Promise.all([4, 5, 6].map(id => execute(id, 'get_v5_stylist_guide', { topic: 'workflow' })));
  for (const outcome of simultaneous) assert.equal(outcome.isError, undefined, outcome.content[0].text);
  const current = (await json(api(origin, '/links', { cookie }))).items[0];
  assert.equal(current.call_count, 4);
  assert.equal(current.total_anlas_spent, 37);
  assert.ok(Date.parse(current.last_used_at) >= Date.parse(current.created_at));
  assert.deepEqual(await json(api(origin, '/overview', { cookie })), {
    archive: { totalCount: 1, totalBytes: png.length, models: { [archived.model]: 1 }, links: { [item.id]: 1 } },
    links: { total: 1, enabled: 1, totalCalls: 4, totalAnlasSpent: 37 }, publicOrigin: null,
    disclosure: defaultDisclosure,
  });
  assert.equal((await json(api(origin, '/subscription', { cookie }))).summary.totalAnlas, 83);
  subscriptionUnavailable = true;
  assert.deepEqual(await json(api(origin, '/subscription', { cookie }), 502), { error: '读取 NovelAI 订阅失败' });

  const linkFile = join(archiveDir, '.admin', 'links.json');
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await readFile(linkFile, 'utf8')).includes('"call_count": 4')) break;
    await delay(25);
  }
  assert.match(await readFile(linkFile, 'utf8'), /"call_count":\s*4\b/);
  await json(api(origin, `/links/${item.id}`, { method: 'PATCH', cookie, body: { enabled: false } }));
  await backend.stop();
  const reloaded = new LinkStore(archiveDir);
  await reloaded.init([{ ...bootstrapped, label: '启动配置里的旧标签', enabled: true }]);
  assert.deepEqual(reloaded.list(), [reloaded.getById(item.id)]);
  assert.equal(reloaded.getById(item.id).enabled, false);
  assert.equal(reloaded.getById(item.id).label, item.label);
  assert.equal(reloaded.getById(item.id).call_count, 4);
  assert.equal(reloaded.getById(item.id).last_used_at, current.last_used_at);
  assert.equal(reloaded.getById(item.id).total_anlas_spent, 37);
  assert.equal((await readdir(join(archiveDir, '.admin'))).some(name => name.endsWith('.tmp')), false);
});

test('独立设置链接披露模式，切换只断开该链接旧会话', { timeout: 20_000 }, async t => {
  const archiveDir = await tempArchive(t);
  const oldLink = await writeHistoricalLink(archiveDir);
  const origin = await startConfiguredServer(t, archiveDir, [], 'legacy');
  const { cookie } = await signIn(origin);
  const health = await json(request(origin, '/health'));
  assert.equal(health.disclosureMode, 'legacy');
  assert.equal(health.progressiveTools, 3);
  assert.equal(health.totalActions, 17);
  assert.deepEqual((await json(api(origin, '/overview', { cookie }))).disclosure, { ...defaultDisclosure, defaultMode: 'legacy' });

  const list = { id: 2, method: 'tools/list' };
  const names = async (path, session) => (await rpcResult(postMcp(origin, path, list, session))).tools.map(tool => tool.name);
  const localSession = await openMcp(origin, '/mcp');
  const legacyTools = await names('/mcp', localSession);
  assert.equal(legacyTools.length, 17);
  assert.ok(legacyTools.includes('generate_image'));
  assert.ok(legacyTools.includes('get_v5_stylist_guide'));
  const progressiveTools = ['nai_discover', 'nai_describe', 'nai_execute'];
  const oldPath = mcpPath(oldLink.token);
  assert.deepEqual(await names(oldPath, await openMcp(origin, oldPath)), progressiveTools);
  assert.equal((await json(api(origin, '/links', { cookie }))).items[0].disclosure_mode, 'progressive');

  const create = body => api(origin, '/links', { method: 'POST', body, cookie });
  await json(create({ label: '无效模式', disclosure_mode: 'unknown' }), 400);
  const { item: defaultLink } = await json(create({ label: '默认链接' }), 201);
  assert.equal(defaultLink.disclosure_mode, 'progressive');
  const { item } = await json(create({ label: '兼容链接', disclosure_mode: 'legacy' }), 201);
  assert.equal(item.disclosure_mode, 'legacy');
  const path = mcpPath(item.token);
  const session = await openMcp(origin, path);
  assert.deepEqual(await names(path, session), legacyTools);

  const patch = body => api(origin, `/links/${item.id}`, { method: 'PATCH', body, cookie });
  await json(patch({ disclosure_mode: null }), 400);
  assert.equal((await json(patch({ label: '更名' }))).item.disclosure_mode, 'legacy');
  await json(patch({ disclosure_mode: 'legacy' }));
  assert.deepEqual(await names(path, session), legacyTools);

  const stream = await request(origin, path, { headers: { ...session, Accept: 'text/event-stream' } });
  assert.equal(stream.status, 200);
  const { item: changed } = await json(patch({ label: '已切换', disclosure_mode: 'progressive' }));
  assert.equal(changed.token, item.token);
  assert.equal(changed.disclosure_mode, 'progressive');
  await stream.text();
  await expectStatus(postMcp(origin, path, list, session), 404);
  const newSession = await openMcp(origin, path);
  assert.deepEqual(await names(path, newSession), progressiveTools);
  assert.deepEqual(await names('/mcp', localSession), legacyTools);

  assert.equal((await json(patch({ disclosure_mode: 'legacy' }))).item.disclosure_mode, 'legacy');
  await expectStatus(postMcp(origin, path, list, newSession), 404);
  assert.deepEqual(await names(path, await openMcp(origin, path)), legacyTools);
});

test('历史链接缺省模式标准化，更新和重载保留模式及历史统计', { timeout: 12_000 }, async t => {
  const archiveDir = await tempArchive(t);
  const oldLink = await writeHistoricalLink(archiveDir);
  const store = new LinkStore(archiveDir);
  await store.init();
  assert.deepEqual(store.list(), [{ ...oldLink, disclosure_mode: 'progressive' }]);
  assert.equal(store.findActiveByToken(oldLink.token).disclosure_mode, 'progressive');

  const changed = await store.update(oldLink.id, { label: '已更名', disclosure_mode: 'legacy' });
  assert.equal(changed.disclosure_mode, 'legacy');
  assert.equal((await store.create({ label: '缺省链接' })).disclosure_mode, 'progressive');
  assert.equal((await store.create({ label: '明确回退', disclosure_mode: 'legacy' })).disclosure_mode, 'legacy');
  const reopened = new LinkStore(archiveDir);
  await reopened.init();
  assert.deepEqual(reopened.list(), store.list());
  const reloaded = reopened.getById(oldLink.id);
  assert.deepEqual([reloaded.label, reloaded.disclosure_mode, reloaded.call_count, reloaded.total_anlas_spent], ['已更名', 'legacy', 2, 7]);
});

async function setCreatedAt(directory, id, created_at) {
  const path = join(directory, id, 'metadata.json');
  const signal = AbortSignal.timeout(4_000);
  const metadata = JSON.parse(await readFile(path, { encoding: 'utf8', signal }));
  await writeFile(path, JSON.stringify({ ...metadata, created_at }), { signal });
}

test('图库接口查询旧版和新图、保护原图、缓存缩略图并安全删除', { timeout: 20_000 }, async t => {
  const archiveDir = await tempArchive(t);
  const primaryModel = 'nai-diffusion-5-curated';
  const secondaryModel = 'nai-diffusion-4-5-full';
  const primaryLink = 'lnk_123456789abc';
  const secondaryLink = 'lnk_abcdef123456';
  const comment = { seed: 164988, steps: 23 };
  const png = pngComment(await createImage(768, 384).png().toBuffer(), comment);
  const jpg = await createImage(240, 120).jpeg().toBuffer();
  const oldPng = await createImage(48, 24).png().toBuffer();
  const oldId = await saveImage(archiveDir, oldPng, {
    prompt: '早期图片', width: 48, height: 24, seed: 521, model: primaryModel,
  });
  const mainImage = await saveArchivedImage(archiveDir, png, {
    tool: 'generate_image', action: 'generate', model: primaryModel, seed: comment.seed,
    prompt_preview: 'Blue stairwell', link_id: primaryLink, link_label: 'Gemini 分享',
  });
  const otherImage = await saveArchivedImage(archiveDir, jpg, {
    tool: 'augment_image', action: 'lineart', model: secondaryModel, seed: 4518,
    prompt_preview: 'Oil portrait', link_id: secondaryLink, link_label: '另一条链接',
  });
  await Promise.all([
    setCreatedAt(archiveDir, oldId, '2025-01-01T00:00:00.000Z'),
    setCreatedAt(archiveDir, otherImage.id, '2025-01-02T00:00:00.000Z'),
    setCreatedAt(archiveDir, mainImage.id, '2025-01-03T00:00:00.000Z'),
    mkdir(join(archiveDir, '.pending-test')),
    mkdir(join(archiveDir, '.vibe-cache')),
  ]);
  const symlinkId = 'S'.repeat(43);
  await symlink(join(archiveDir, oldId), join(archiveDir, symlinkId), 'dir');
  const { origin } = await startApp(t, { archiveDir, imageOrigin });
  const { id } = mainImage;
  const imagePath = `/images/${id}`;
  for (const path of ['/images', imagePath, `${imagePath}/thumb`, `${imagePath}/raw`]) {
    assert.deepEqual(await json(api(origin, path), 401), { error: '请先登录管理台' });
  }
  await json(api(origin, imagePath, { method: 'DELETE' }), 401);
  await json(api(origin, '/images/batch-delete', { method: 'POST', body: { ids: [id] } }), 401);
  const { cookie } = await signIn(origin);
  const read = path => json(api(origin, path, { cookie }));

  const firstPage = await read('/images?limit=1');
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.hasMore, true);
  assert.deepEqual(firstPage.items.map(item => item.id), [id]);
  assert.equal(firstPage.items[0].thumb_url, `${apiBase}${imagePath}/thumb`);
  assert.equal(firstPage.items[0].image_url, `${apiBase}${imagePath}/raw`);
  assert.equal(firstPage.items[0].public_url, `${imageOrigin.origin}/novelai-images/${id}.png`);
  assert.deepEqual(firstPage.facets.models, [secondaryModel, primaryModel]);
  assert.deepEqual(firstPage.facets.tools, ['augment_image', 'generate_image']);
  assert.deepEqual(new Map(firstPage.facets.links.map(link => [link.id, link.label])), new Map([
    [primaryLink, 'Gemini 分享'], [secondaryLink, '另一条链接'],
  ]));
  const older = await read('/images?sort=oldest&offset=1&limit=2');
  assert.deepEqual(older.items.map(item => item.id), [otherImage.id, id]);
  assert.equal(older.hasMore, false);
  const filters = new URLSearchParams({ link_id: primaryLink, model: primaryModel, q: 'bLuE', tool: 'generate_image' });
  const filtered = await read(`/images?${filters}`);
  assert.deepEqual(filtered.items.map(item => item.id), [id]);
  assert.equal(filtered.total, 1);
  assert.equal(filtered.hasMore, false);
  assert.deepEqual(filtered.facets, firstPage.facets);
  assert.deepEqual((await read(`/images?model=${primaryModel}`)).items.map(item => item.id), [id, oldId]);
  for (const word of [id.toUpperCase(), String(comment.seed), 'gEMIni']) {
    assert.deepEqual((await read(`/images?q=${encodeURIComponent(word)}`)).items.map(item => item.id), [id]);
  }
  assert.deepEqual((await read('/images?q=LINEART')).items.map(item => item.id), [otherImage.id]);
  const empty = await read('/images?link_id=missing');
  assert.deepEqual(empty, { items: [], total: 0, hasMore: false, facets: firstPage.facets });
  await json(api(origin, '/images?limit=-1', { cookie }), 400);
  assert.equal((await read('/images?limit=201')).items.length, 3);
  await json(api(origin, '/images?sort=invalid', { cookie }), 400);
  assert.deepEqual((await read('/overview')).archive, {
    totalCount: 3, totalBytes: png.length + jpg.length + oldPng.length,
    models: { [primaryModel]: 2, [secondaryModel]: 1 }, links: { [primaryLink]: 1, [secondaryLink]: 1 },
  });

  const detail = await read(imagePath);
  assert.deepEqual(detail, { ...firstPage.items[0], png_metadata: { Comment: comment } });
  const legacy = await read(`/images/${oldId}`);
  assert.equal(legacy.schema_version, 1);
  assert.equal(legacy.ext, 'png');
  assert.equal((await read(`/images/${otherImage.id}`)).png_metadata, undefined);

  const [thumbnail, smallThumbnail] = await Promise.all([
    api(origin, `${imagePath}/thumb`, { cookie }), api(origin, `/images/${otherImage.id}/thumb`, { cookie }),
  ]);
  assert.equal(thumbnail.status, 200);
  assert.equal(smallThumbnail.status, 200);
  assert.equal(thumbnail.headers.get('Content-Type'), 'image/webp');
  assert.equal(thumbnail.headers.get('Cache-Control'), 'private, max-age=86400');
  const thumbnailBytes = Buffer.from(await thumbnail.arrayBuffer());
  const thumbnailInfo = await sharp(thumbnailBytes).metadata();
  assert.deepEqual([thumbnailInfo.format, thumbnailInfo.width, thumbnailInfo.height], ['webp', 480, 240]);
  assert.equal((await sharp(Buffer.from(await smallThumbnail.arrayBuffer())).metadata()).width, 240);
  const cachedPath = join(archiveDir, '.thumbs', `${id}.webp`);
  const cached = await stat(cachedPath);
  assert.equal(cached.mode & 0o777, 0o600);
  assert.equal((await stat(join(archiveDir, '.thumbs'))).mode & 0o777, 0o700);
  assert.deepEqual(await readFile(cachedPath), thumbnailBytes);
  const hit = await api(origin, `${imagePath}/thumb`, { cookie });
  assert.equal(hit.status, 200);
  assert.deepEqual(Buffer.from(await hit.arrayBuffer()), thumbnailBytes);
  const afterHit = await stat(cachedPath);
  assert.deepEqual([afterHit.ino, afterHit.mtimeMs], [cached.ino, cached.mtimeMs]);
  const smaller = await getOrCreateThumbnail(archiveDir, id, 256);
  assert.equal((await sharp(smaller).metadata()).width, 256);
  assert.deepEqual(await readFile(cachedPath), smaller);
  const defaultAgain = await api(origin, `${imagePath}/thumb`, { cookie });
  assert.deepEqual(Buffer.from(await defaultAgain.arrayBuffer()), thumbnailBytes);

  const raw = await api(origin, `${imagePath}/raw`, { cookie });
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get('Content-Type'), 'image/png');
  assert.equal(raw.headers.get('Content-Disposition'), null);
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()), png);
  const download = await api(origin, `${imagePath}/raw?download=1`, { cookie });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('Content-Disposition'), `attachment; filename="novelai-${id}.png"`);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);

  await json(api(origin, '/images/.admin', { method: 'DELETE', cookie }), 400);
  await json(api(origin, `/images/${symlinkId}`, { method: 'DELETE', cookie }), 404);
  assert.equal((await stat(join(archiveDir, oldId))).isDirectory(), true);
  assert.equal((await stat(join(archiveDir, '.admin', 'session-secret.key'))).isFile(), true);
  assert.deepEqual(await json(api(origin, imagePath, { method: 'DELETE', cookie })), { ok: true, id });
  await assert.rejects(stat(cachedPath), { code: 'ENOENT' });
  await assert.rejects(stat(join(archiveDir, id)), { code: 'ENOENT' });
  await json(api(origin, `${imagePath}/thumb`, { cookie }), 404);
  await expectStatus(request(origin, `/novelai-images/${id}.png`), 404);

  const batch = ids => api(origin, '/images/batch-delete', { method: 'POST', cookie, body: { ids } });
  await json(batch(Array(201).fill(id)), 400);
  await json(batch([false]), 400);
  const missingId = 'X'.repeat(43);
  assert.deepEqual(await json(batch([oldId, '.admin', otherImage.id, missingId, symlinkId])), {
    ok: true, deleted: [oldId, otherImage.id], failed: ['.admin', missingId, symlinkId],
  });
  assert.deepEqual(await read('/images'), { total: 0, items: [], hasMore: false, facets: { models: [], tools: [], links: [] } });
  assert.equal((await read('/overview')).archive.totalCount, 0);
});

test('管理台归档原始参考图并允许 MCP 按 ID 读取', { timeout: 20_000 }, async t => {
  const archiveDir = await tempArchive(t);
  const { origin } = await startApp(t, { archiveDir, imageOrigin });
  const jpg = await createImage(240, 120).jpeg().toBuffer();
  const upload = (bytes, cookie, contentType = 'application/octet-stream') => fetch(new URL(apiBase + '/images/upload', origin), {
    method: 'POST', signal: AbortSignal.timeout(6_000), body: bytes,
    headers: { 'Content-Type': contentType, ...(cookie ? { Cookie: cookie } : {}) },
  });
  await expectStatus(upload(jpg), 401);
  const { cookie } = await signIn(origin);
  await expectStatus(upload(jpg, cookie, 'image/jpeg'), 415);
  await expectStatus(upload(Buffer.from('不是图片'), cookie), 400);
  const brokenPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jASsAAAAASUVORK5CYII=', 'base64');
  await expectStatus(upload(brokenPng, cookie), 400);
  const { image_id: id } = await json(upload(jpg, cookie), 201);
  assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  const { items } = await json(api(origin, '/images', { cookie }));
  assert.equal(items[0].id, id);
  assert.equal(items[0].action, 'upload');
  assert.equal(items[0].private, true);
  assert.equal(items[0].public_url, null);
  assert.deepEqual(await resolveImageInput(id, { archiveDir }), jpg);
  const raw = await api(origin, '/images/' + id + '/raw', { cookie });
  assert.equal(raw.status, 200);
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()), jpg);
  await expectStatus(request(origin, '/novelai-images/' + id + '.jpg'), 404);
  const headers = await openMcp(origin, '/mcp');
  const listed = await rpcResult(postMcp(origin, '/mcp', {
    id: 2, method: 'tools/call', params: { name: 'nai_execute', arguments: { action: 'list_archived_images', params: {} } },
  }, headers));
  assert.deepEqual(JSON.parse(listed.content.at(-1).text).images, []);
  const detail = await rpcResult(postMcp(origin, '/mcp', {
    id: 3, method: 'tools/call', params: { name: 'nai_execute', arguments: { action: 'list_archived_images', params: { image_id: id } } },
  }, headers));
  const textBlock = detail.content.find(entry => entry.type === 'text');
  const imageBlock = detail.content.find(entry => entry.type === 'image');
  const metadata = JSON.parse(textBlock.text);
  assert.equal(metadata.image_id, id);
  assert.equal(metadata.image_url, undefined);
  assert.ok(imageBlock, '单张私密参考图应返回图像内容块供模型查看画面');
  assert.equal(imageBlock.mimeType, 'image/webp');
  const previewMeta = await sharp(Buffer.from(imageBlock.data, 'base64')).metadata();
  assert.equal(previewMeta.format, 'webp');
  assert.ok(previewMeta.width > 0 && previewMeta.height > 0);
});

test('禁用管理台时仅保留 MCP 及动态链接服务', { timeout: 12_000 }, async t => {
  const linkStore = new LinkStore();
  const item = await linkStore.create({ label: '仅 MCP' });
  const { origin } = await startApp(t, { adminEnabled: false, linkStore });
  await expectStatus(request(origin, '/novelai-admin', { redirect: 'manual' }), 404);
  await expectStatus(api(origin, '/auth/status'), 404);
  await openMcp(origin, mcpPath(item.token));
  await openMcp(origin, '/mcp');
});

test('预设令牌轮换或删除后重启保持撤销，统计与权限随记录保留', { timeout: 12_000 }, async t => {
  const archiveDir = await tempArchive(t);
  const bootstrap = [{ label: '需轮换', token: 'legacy-rotate' }, { label: '需删除', token: 'legacy-delete' }];
  const store = new LinkStore(archiveDir);
  await store.init(bootstrap);
  const [first, second] = store.list();
  await Promise.all([store.recordUsage(first.id, 6), store.recordUsage(first.id, -3), store.recordUsage(first.id, 2)]);
  const rotated = await store.rotate(first.id);
  assert.equal(rotated.previousToken, first.token);
  assert.deepEqual(await store.delete(second.id), second);
  await store.flush();

  const reopened = new LinkStore(archiveDir);
  await reopened.init(bootstrap);
  assert.deepEqual(reopened.list(), [rotated.item]);
  assert.equal(reopened.findActiveByToken(first.token), undefined);
  assert.equal(reopened.findActiveByToken(second.token), undefined);
  assert.equal(reopened.findActiveByToken(rotated.item.token).call_count, 3);
  assert.equal(reopened.getById(first.id).total_anlas_spent, 8);
});
