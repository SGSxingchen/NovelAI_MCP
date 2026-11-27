import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { createSseApp, createStreamableHttpApp } from '../dist/http-app.js';
import { NovelAIClient } from '../dist/novelai-client.js';

const toolNames = [
  'augment_image', 'encode_vibe', 'generate_image', 'get_subscription', 'get_v5_stylist_guide',
  'img2img', 'inpaint_image', 'lint_prompt', 'list_archived_images', 'probe_image', 'save_library_entry',
  'search_artist_library', 'search_nai_lexicon', 'search_prompt_library', 'suggest_tags', 'upscale_image',
  'verify_image',
];
const progressiveToolNames = ['nai_discover', 'nai_describe', 'nai_execute'];
const clientInfo = { name: 'novelai-mcp-test', version: '1.0.0' };
const publicOrigin = new URL('https://images.example.test');
const protocolVersion = '2025-11-25';
const archiveId = 'h'.repeat(43);
const stdioEntry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const stdioEnv = { NOVELAI_API_KEY: 'fake-token-for-local-test' };

async function listen(t, handler, close = async () => {}) {
  const server = createServer({ requestTimeout: 15_000 }, handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await close();
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  });
  return new URL(`http://127.0.0.1:${server.address().port}`);
}

async function archiveFixture(t, png) {
  const archiveDir = await mkdtemp(join(tmpdir(), 'novelai-mcp-transport-'));
  t.after(() => rm(archiveDir, { recursive: true, force: true }));
  await mkdir(join(archiveDir, archiveId));
  await writeFile(join(archiveDir, archiveId, 'image.png'), png);
  await writeFile(join(archiveDir, archiveId, 'metadata.json'), JSON.stringify({
    schema_version: 1,
    id: archiveId,
    created_at: '2026-11-18T00:00:00.000Z',
    model: 'nai-diffusion-5-curated',
    width: 64,
    height: 64,
    seed: 1,
    mime_type: 'image/png',
    size_bytes: png.length,
  }));
  return archiveDir;
}

async function mockNovelAI(t, bytes, contentType) {
  const calls = [];
  const baseUrl = await listen(t, async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      calls.push({ method: req.method, path: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
      res.writeHead(200, { 'Content-Type': contentType }).end(bytes);
    } catch {
      res.writeHead(400).end();
    }
  });
  return { client: new NovelAIClient('fake-token-for-local-test', { baseUrl: baseUrl.origin }), calls };
}

function get(url, options) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
}

function postRpc(url, body, headers = {}) {
  return get(url, {
    method: 'POST',
    headers: { 'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', ...body }),
  });
}

async function readResult(response) {
  assert.equal(response.status, 200);
  const body = await response.text();
  const line = response.headers.get('content-type').includes('text/event-stream')
    ? body.split(/\r?\n/).find(value => value.startsWith('data:') && value.slice(5).trim())
    : undefined;
  const message = JSON.parse(line ? line.slice(5) : body);
  assert.equal(message.error, undefined);
  return message.result;
}

function oversizedRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const chunk = Buffer.alloc(1024 * 1024, ' ');
    const req = request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': 50 * chunk.length + 1, ...headers },
      signal: AbortSignal.timeout(15_000),
    }, res => {
      res.resume();
      res.once('end', () => resolve(res.statusCode));
      res.once('error', reject);
    });
    req.once('error', reject);
    let count = 0;
    function send() {
      while (count < 50) {
        count += 1;
        if (!req.write(chunk)) {
          req.once('drain', send);
          return;
        }
      }
      req.end(' ');
    }
    send();
  });
}

test('Streamable HTTP 默认渐进式披露，完成 Gemini 握手、多格式回执和短链下载', { timeout: 40_000 }, async t => {
  const source = await sharp(randomBytes(256 * 256 * 3), {
    raw: { width: 256, height: 256, channels: 3 },
  }).png().toBuffer();
  assert.ok(source.length > 100 * 1024);
  const pixels = { create: { width: 64, height: 64, channels: 3, background: '#0088ff' } };
  const png = await sharp(pixels).png().toBuffer();
  const webp = await sharp(pixels).webp().toBuffer();
  const jpg = await sharp(pixels).jpeg().toBuffer();
  const zip = new AdmZip();
  zip.addFile('02.webp', webp);
  zip.addFile('03.jpg', jpg);
  zip.addFile('01.png', png);
  const archiveDir = await archiveFixture(t, png);
  const { client, calls } = await mockNovelAI(t, zip.toBuffer(), 'application/zip');
  const { app, close } = createStreamableHttpApp({
    client, archiveDir, imageOrigin: publicOrigin, allowedOrigins: ['https://client.example.test'],
  });
  const serverUrl = await listen(t, app, close);
  const mcp = new URL('/mcp', serverUrl);

  const health = await (await get(new URL('/health', serverUrl))).json();
  assert.deepEqual(health, {
    status: 'ok', service: 'novelai-mcp-server', mode: 'streamable-http', version: '2.0.0', tools: 17,
    disclosureMode: 'progressive', progressiveTools: 3, totalActions: 17,
  });
  const requestBody = { id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo } };
  const invalidOrigin = await postRpc(mcp, requestBody, { Origin: 'https://untrusted.example.test' });
  assert.equal(invalidOrigin.status, 403);
  await invalidOrigin.body?.cancel();
  const preflight = await get(mcp, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://client.example.test',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, mcp-protocol-version, mcp-session-id',
    },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /mcp-protocol-version/i);
  const invalidAccept = await postRpc(mcp, requestBody, { Accept: 'application/json' });
  assert.equal(invalidAccept.status, 406);
  assert.equal(invalidAccept.headers.get('Mcp-Session-Id'), null);
  await invalidAccept.body?.cancel();

  const init = await postRpc(mcp, requestBody);
  const sessionId = init.headers.get('mcp-session-id');
  assert.ok(sessionId);
  assert.match(init.headers.get('access-control-expose-headers'), /mcp-session-id/i);
  const initialization = await readResult(init);
  assert.equal(initialization.protocolVersion, protocolVersion);
  assert.equal(initialization.serverInfo.version, '2.0.0');
  const headers = { 'MCP-Protocol-Version': protocolVersion, 'Mcp-Session-Id': sessionId };
  const initialized = await postRpc(mcp, { method: 'notifications/initialized' }, headers);
  assert.equal(initialized.status, 202);
  const list = await readResult(await postRpc(mcp, { id: 2, method: 'tools/list' }, {
    ...headers, Origin: publicOrigin.origin,
  }));
  assert.deepEqual(list.tools.map(tool => tool.name), progressiveToolNames);
  for (const tool of list.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.doesNotMatch(JSON.stringify(tool.inputSchema), /"(oneOf|anyOf)"\s*:/);
  }
  const promptsList = await readResult(await postRpc(mcp, { id: 21, method: 'prompts/list' }, headers));
  assert.equal(promptsList.prompts[0].name, 'novelai-v5-stylist');
  const promptResult = await readResult(await postRpc(mcp, {
    id: 22, method: 'prompts/get', params: { name: 'novelai-v5-stylist', arguments: { aesthetic: 'pop halftone' } },
  }, headers));
  assert.match(promptResult.messages[0].content.text, /1\.3::halftone::/);
  const resourcesList = await readResult(await postRpc(mcp, { id: 23, method: 'resources/list' }, headers));
  assert.equal(resourcesList.resources[0].uri, 'novelai://skills/v5-stylist');
  const resourceResult = await readResult(await postRpc(mcp, {
    id: 24, method: 'resources/read', params: { uri: 'novelai://skills/v5-stylist' },
  }, headers));
  assert.match(resourceResult.contents[0].text, /novelai-v5-stylist/);

  const result = await readResult(await postRpc(mcp, {
    id: 3,
    method: 'tools/call',
    params: {
      name: 'nai_execute',
      arguments: {
        action: 'img2img',
        params: { source_image: `data:image/png;base64,${source.toString('base64')}`, base_prompt: 'forest', n_samples: 3, seed: 123 },
      },
    },
  }, headers));
  assert.notEqual(result.isError, true, result.content[0]?.text);
  const [receipt, ...images] = result.content;
  assert.equal(receipt.type, 'text');
  assert.deepEqual(images.map(image => [image.type, image.mimeType]), [
    ['image', 'image/png'], ['image', 'image/webp'], ['image', 'image/jpeg'],
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/ai/generate-image');
  assert.equal(calls[0].body.action, 'img2img');
  assert.equal(calls[0].body.parameters.width, 256);
  assert.equal(calls[0].body.parameters.height, 256);
  assert.equal(calls[0].body.parameters.n_samples, 3);
  const links = [...receipt.text.matchAll(/\[查看或下载图片\]\((https:\/\/[^)]+)\)/g)];
  assert.equal(links.length, 3, receipt.text);
  for (const [index, [, link]] of links.entries()) {
    const url = new URL(link);
    assert.equal(url.origin, publicOrigin.origin);
    assert.match(url.pathname, /^\/novelai-images\/[A-Za-z0-9_-]{43}\.(png|webp|jpg)$/);
    const response = await get(new URL(url.pathname, serverUrl));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), images[index].mimeType);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, [png, webp, jpg][index]);
    assert.equal(bytes.toString('base64'), images[index].data);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  }
  const historicalUrl = new URL(`/novelai-images/${archiveId}.png`, serverUrl);
  const legacy = await get(historicalUrl, { headers: { Origin: 'https://untrusted.example.test' } });
  assert.equal(legacy.status, 200);
  assert.deepEqual(Buffer.from(await legacy.arrayBuffer()), png);
  const historicalHead = await get(historicalUrl, { method: 'HEAD' });
  assert.equal(historicalHead.status, 200);
  assert.equal(historicalHead.headers.get('Content-Length'), String(png.length));
  const wrongExtension = await get(new URL(`/novelai-images/${archiveId}.webp`, serverUrl));
  assert.equal(wrongExtension.status, 404);
  await wrongExtension.body?.cancel();

  assert.equal(await oversizedRequest(mcp, headers), 413);
  const localInput = await readResult(await postRpc(mcp, {
    id: 4,
    method: 'tools/call',
    params: {
      name: 'nai_execute',
      arguments: { action: 'img2img', params: { source_image: './local-only.png', base_prompt: 'forest' } },
    },
  }, headers));
  assert.equal(localInput.isError, true);
  assert.match(localInput.content[0].text, /本地/);
  assert.equal(calls.length, 1);
  assert.equal((await get(mcp, { method: 'DELETE', headers })).status, 200);
  const expired = await postRpc(mcp, { id: 5, method: 'tools/list' }, headers);
  assert.equal(expired.status, 404);
  await expired.body?.cancel();
});

test('MCP_ALLOWED_ORIGINS 支持通配符 * 放行任意客户端 Origin', { timeout: 15_000 }, async t => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#114488' } }).png().toBuffer();
  const { client } = await mockNovelAI(t, png, 'image/png');
  const { app, close } = createStreamableHttpApp({ client, allowedOrigins: ['*'] });
  const serverUrl = await listen(t, app, close);
  const mcp = new URL('/mcp', serverUrl);
  const res = await postRpc(mcp, { id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo } }, {
    Origin: 'https://any-desktop-or-web-client.example',
  });
  assert.equal(res.status, 200);
  const sid = res.headers.get('mcp-session-id');
  assert.ok(sid);
  await res.body?.cancel();
  assert.equal((await get(mcp, { method: 'DELETE', headers: { 'Mcp-Session-Id': sid } })).status, 200);
});

test('旧版 SSE 保留 /sse 和 /message，复用工具、归档及图片路由', { timeout: 15_000 }, async t => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#aa5500' } }).png().toBuffer();
  const archiveDir = await archiveFixture(t, png);
  const upstream = await mockNovelAI(t, png, 'image/png');
  const { app, close } = createSseApp({ client: upstream.client, archiveDir, imageOrigin: publicOrigin, disclosureMode: 'legacy' });
  const serverUrl = await listen(t, app, close);
  const client = new Client(clientInfo);
  const transport = new SSEClientTransport(new URL('/sse', serverUrl));
  try {
    await client.connect(transport, { timeout: 7_000 });
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), toolNames);
    const response = await client.callTool({ name: 'generate_image', arguments: { base_prompt: 'forest', width: 64, height: 64 } });
    assert.notEqual(response.isError, true, response.content[0]?.text);
    assert.deepEqual(response.content[1], { type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
    const link = response.content[0].text.match(/\[查看或下载图片\]\((https:\/\/[^)]+)\)/)[1];
    const downloaded = await get(new URL(new URL(link).pathname, serverUrl));
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
    assert.equal(upstream.calls.length, 1);
  } finally {
    await client.close();
  }
});

for (const disclosureMode of ['progressive', 'legacy']) {
  test(`stdio 入口按环境变量返回工具列表（${disclosureMode}）`, { timeout: 10_000 }, async () => {
    const client = new Client(clientInfo);
    const env = disclosureMode === 'legacy' ? { ...stdioEnv, NOVELAI_MCP_DISCLOSURE_MODE: 'legacy' } : stdioEnv;
    try {
      await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [stdioEntry],
        env,
        stderr: 'pipe',
      }), { timeout: 5_000 });
      assert.equal(client.getServerVersion().version, '2.0.0');
      const names = (await client.listTools()).tools.map(tool => tool.name);
      if (disclosureMode === 'legacy') assert.deepEqual(names.sort(), toolNames);
      else assert.deepEqual(names, progressiveToolNames);
    } finally {
      await client.close();
    }
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`stdio 在 ${signal} 后有序退出`, { skip: process.platform === 'win32', timeout: 10_000 }, async () => {
    const child = spawn(process.execPath, [stdioEntry], { env: stdioEnv, stdio: ['pipe', 'ignore', 'pipe'] });
    const waitOptions = { signal: AbortSignal.timeout(8_000) };
    const exited = once(child, 'exit', waitOptions);
    try {
      const [startup] = await Promise.race([
        once(child.stderr, 'data', waitOptions),
        exited.then(([code]) => { throw new Error(`stdio 启动时提前退出，退出码 ${code}`); }),
      ]);
      assert.match(startup.toString(), /使用标准输入输出/);
      assert.ok(child.kill(signal));
      assert.deepEqual(await exited, [0, null]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });
}
