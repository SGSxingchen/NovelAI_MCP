import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { createStreamableHttpApp } from '../dist/http-app.js';
import { ARCHIVE_ID_REGEX, getArchivedImageMetadata } from '../dist/image-archive.js';
import { LibraryStore, formatArtistMix, parseArtistImportText } from '../dist/library-store.js';
import { MODEL_REGISTRY } from '../dist/model-registry.js';
import {
  AUGMENT_REQ_TYPES, DEFAULT_MODEL, EMOTION_MOODS, IMAGE_FORMATS, IMAGE_MODELS, NOISE_SCHEDULES,
  PRECISE_REFERENCE_TYPES, QUALITY_PRESETS, SAMPLERS, UC_PRESET_NAMES,
} from '../dist/types.js';

const apiBase = '/novelai-admin/api';
const adminPassword = 'studio-test-fixture';
const configuredPassword = process.env.MCP_ADMIN_PASSWORD;
delete process.env.MCP_ADMIN_PASSWORD;
after(() => {
  if (configuredPassword !== undefined) process.env.MCP_ADMIN_PASSWORD = configuredPassword;
});

async function tempDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nai-library-studio-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function httpPeer(other) {
  return new Duplex({
    read() {},
    write(chunk, _encoding, done) { other().push(chunk); done(); },
    final(done) { other().push(null); done(); },
  });
}

function startApp(t, options = {}) {
  const { app, close } = createStreamableHttpApp({ client: {}, adminPassword, ...options });
  const server = createServer(app);
  t.after(close);
  // 使用 Node 的 HTTP 解析器和实际路由，通过进程内流传输请求。
  return async (path, { method = 'GET', body, headers } = {}) => {
    const incoming = httpPeer(() => outgoing);
    const outgoing = httpPeer(() => incoming);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    server.emit('connection', incoming);
    try {
      return await new Promise((resolve, reject) => {
        const req = request({
          path, method, createConnection: () => outgoing, signal: AbortSignal.timeout(5_000),
          headers: {
            ...headers,
            ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
          },
        }, async response => {
          try {
            const chunks = [];
            for await (const chunk of response) chunks.push(chunk);
            resolve({ status: response.statusCode, headers: response.headers, buffer: Buffer.concat(chunks) });
          } catch (error) {
            reject(error);
          }
        });
        req.on('error', reject);
        req.end(payload);
      });
    } finally {
      incoming.destroy();
      outgoing.destroy();
    }
  };
}

async function json(pending, status = 200) {
  const response = await pending;
  const text = response.buffer.toString();
  assert.equal(response.status, status, text);
  return JSON.parse(text);
}

async function signIn(send) {
  const response = await send(apiBase + '/auth/login', { method: 'POST', body: { password: adminPassword } });
  assert.deepEqual(await json(response), { ok: true });
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  return (path, method = 'GET', body) => send(apiBase + path, { method, body, headers: { Cookie: cookie } });
}

async function openMcp(send) {
  const headers = { Accept: 'application/json, text/event-stream' };
  const protocolVersion = '2025-11-25';
  const post = (method, params, id) => send('/mcp', { method: 'POST', headers, body: { jsonrpc: '2.0', method, params, id } });
  const unwrap = ({ status, buffer }) => {
    const text = buffer.toString();
    assert.equal(status, 200, text);
    const line = text.split(/\r?\n/).find(value => value.startsWith('data: '));
    const message = JSON.parse(line ? line.slice(6) : text);
    assert.equal(message.error, undefined, JSON.stringify(message.error));
    return message.result;
  };
  const init = await post('initialize', {
    protocolVersion, capabilities: {}, clientInfo: { name: 'library-test', version: '1.0.0' },
  }, 1);
  assert.equal(unwrap(init).protocolVersion, protocolVersion);
  headers['Mcp-Session-Id'] = init.headers['mcp-session-id'];
  headers['MCP-Protocol-Version'] = protocolVersion;
  assert.ok(headers['Mcp-Session-Id']);
  assert.equal((await post('notifications/initialized')).status, 202);
  let id = 1;
  return async (method, params) => unwrap(await post(method, params, ++id));
}

function mcpData(result) {
  assert.equal(result.isError, undefined, result.content[0]?.text);
  return JSON.parse(result.content[0].text);
}

test('词库首次写入预置，串行提交画师和提示词 CRUD，重启保留删除与文件权限', { timeout: 10_000 }, async t => {
  const archiveDir = join(await tempDirectory(t), 'archive');
  const filename = join(archiveDir, 'library.json');
  const store = new LibraryStore(archiveDir);
  const [initial, alsoInitial] = await Promise.all([store.exportLibrary(), new LibraryStore(archiveDir).exportLibrary()]);
  assert.deepEqual(initial, alsoInitial);
  assert.equal(initial.artists.length, 2);
  assert.ok(initial.artists.every(item => item.name.includes('示范骨架')));
  assert.equal(initial.prompts.length, 6);
  assert.deepEqual([...new Set(initial.prompts.map(item => item.kind))].sort(), ['negative', 'snippet', 'template']);
  assert.equal((await stat(archiveDir)).mode & 0o777, 0o700);
  assert.equal((await stat(filename)).mode & 0o777, 0o600);

  const previewImageId = 'A'.repeat(43);
  const [artist, prompt] = await Promise.all([
    store.createArtist({ name: '水彩示例', tag: 'artist:sample', categories: ['水彩'], models: ['V5'], previewImageId }),
    store.createPrompt({
      title: '水彩双人场景', category: '水彩', prompt: 'watercolor', negativePrompt: 'plastic sheen',
      characters: [{ prompt: 'first figure', center_x: 0, center_y: 0.5 }, { prompt: 'second figure', negative_prompt: 'hat' }],
      recommendedModel: DEFAULT_MODEL, recommendedWidth: 832, recommendedHeight: 1216, previewImageId,
    }),
  ]);
  assert.match(artist.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(artist.id, prompt.id);
  assert.equal(artist.defaultWeight, 1);
  assert.equal(prompt.kind, 'template');
  await assert.rejects(store.updateArtist(artist.id, { defaultWeight: 0.04 }), /defaultWeight/);
  await assert.rejects(store.updatePrompt(prompt.id, { previewImageId: '../unsafe' }), /previewImageId/);

  const [artistEdit, promptEdit] = await Promise.all([
    store.updateArtist(artist.id, { notes: '纸张纹理', pinned: true, previewImageId: null }),
    store.updatePrompt(prompt.id, { kind: 'snippet', tags: ['纸张'], title: '水彩笔触' }),
  ]);
  assert.equal(artistEdit.createdAt, artist.createdAt);
  assert.equal(artistEdit.previewImageId, null);
  assert.equal(promptEdit.createdAt, prompt.createdAt);
  assert.deepEqual(promptEdit.characters, prompt.characters);
  assert.equal((await store.searchArtists({ category: '水彩', model: DEFAULT_MODEL }))[0].id, artist.id);
  assert.equal((await store.searchPrompts({ query: 'SECOND FIGURE', kind: 'snippet' }))[0].id, prompt.id);
  artistEdit.categories.push('临时修改');
  assert.deepEqual((await store.searchArtists({ query: 'artist:sample' }))[0].categories, ['水彩']);

  const saved = await store.exportLibrary();
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), saved);
  const backup = filename + '.bak';
  await rename(filename, backup);
  await mkdir(filename);
  await assert.rejects(store.createPrompt({ title: '落盘失败' }));
  assert.deepEqual(await store.exportLibrary(), saved);
  await rm(filename, { recursive: true });
  await rename(backup, filename);
  const recovered = await store.createPrompt({ title: '写入恢复' });
  assert.equal((await store.deletePrompt(recovered.id)).id, recovered.id);

  const restarted = new LibraryStore(archiveDir);
  assert.deepEqual(await restarted.exportLibrary(), saved);
  assert.equal((await restarted.deleteArtist(artist.id)).id, artist.id);
  assert.equal((await restarted.deletePrompt(prompt.id)).id, prompt.id);
  assert.equal(await restarted.deleteArtist(artist.id), undefined);
  await restarted.importLibrary({}, 'replace');
  assert.deepEqual(await new LibraryStore(archiveDir).exportLibrary(), { artists: [], prompts: [] });
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
});

test('导入解析 V4.5/V5、V3 和竖线表格，按指定语法格式化权重', () => {
  const parsed = parseArtistImportText([
    '1.2::artist:a::, 0.7::artist:b::',
    '{{{foo}}}, [bar], 1.1__artist:c__',
    'artist:d | 示例 D | 水彩, 厚涂 | 0.85 | 保留 | 竖线',
    '1.3::artist:e, artist:f::',
  ].join('\r\n'));
  assert.deepEqual(parsed.map(({ tag, defaultWeight }) => [tag, defaultWeight]), [
    ['artist:a', 1.2], ['artist:b', 0.7], ['foo', 1.16], ['bar', 0.95], ['artist:c', 1.1],
    ['artist:d', 0.85], ['artist:e', 1.3], ['artist:f', 1.3],
  ]);
  assert.deepEqual(parsed[5], {
    tag: 'artist:d', name: '示例 D', categories: ['水彩', '厚涂'], defaultWeight: 0.85, notes: '保留 | 竖线',
  });
  const mix = [
    { tag: 'artist:a', weight: 1.1576 }, { tag: 'artist:b', weight: 0.95 }, { tag: 'artist:c', weight: 1 },
  ];
  assert.equal(formatArtistMix(mix), '1.16::artist:a::, 0.95::artist:b::, artist:c');
  assert.equal(formatArtistMix(mix, 'v3'), '{{{artist:a}}}, [artist:b], artist:c');
  assert.equal(formatArtistMix(mix, 'plain'), 'artist:a, artist:b, artist:c');
  assert.throws(() => parseArtistImportText('3.1::artist:a::'), /0.05 至 3/);
});

test('批量导入去重与混搭，整库合并、覆盖和失败回滚', async () => {
  const store = new LibraryStore('');
  const batch = await store.batchImportArtists({
    text: '1.2::artist:a::, 0.7::artist:b::\nARTIST:A | 重复条目',
    mode: 'single_entries', categories: ['厚涂'], models: ['V4.5'],
  });
  assert.deepEqual([batch.created, batch.skipped], [2, 1]);
  assert.deepEqual(batch.items.map(item => item.defaultWeight), [1.2, 0.7]);
  const duplicate = await store.batchImportArtists({ text: 'artist:b', mode: 'single_entries' });
  assert.deepEqual(duplicate, { created: 0, skipped: 1, items: [] });
  const mixBatch = await store.batchImportArtists({
    text: '1.2::artist:a::, 0.7::artist:b::', mode: 'as_mix', mixName: '双画师配方', models: ['V5'],
  });
  const [mix] = mixBatch.items;
  assert.equal(mix.isMix, true);
  assert.equal(mix.tag, '1.2::artist:a::, 0.7::artist:b::');
  assert.equal((await store.searchArtists({ query: 'artist:b', mixOnly: true, model: 'nai-diffusion-5-full' }))[0].id, mix.id);
  await assert.rejects(store.batchImportArtists({
    text: Array.from({ length: 17 }, (_, index) => 'artist:sample' + index).join(', '), mode: 'as_mix',
  }), /mixEntries/);

  const exported = await store.exportLibrary();
  const copy = new LibraryStore();
  await copy.importLibrary(exported, 'replace');
  assert.deepEqual(await copy.exportLibrary(), exported);
  await copy.importLibrary({ artists: [{ ...mix, name: '新版配方' }] }, 'merge');
  const merged = await copy.exportLibrary();
  assert.equal(merged.artists.length, exported.artists.length);
  assert.equal(merged.artists.find(item => item.id === mix.id).name, '新版配方');
  assert.deepEqual(merged.prompts, exported.prompts);
  await assert.rejects(copy.importLibrary({ artists: [{ ...mix }], prompts: [{ title: '错误', kind: 'other' }] }, 'replace'), /kind/);
  assert.deepEqual(await copy.exportLibrary(), merged);
  await copy.importLibrary({ artists: [mix] }, 'replace');
  assert.deepEqual(await copy.exportLibrary(), { artists: [mix], prompts: [] });
});

test('Web 试画复用模型参数、参考和 Anlas 回执，解析大图并自动归档所有输出', { timeout: 15_000 }, async t => {
  const archiveDir = await tempDirectory(t);
  const imageOrigin = new URL('https://gallery.invalid');
  const model = 'nai-diffusion-4-5-full';
  const dimensions = { width: 64, height: 64, channels: 3, background: '#4587ab' };
  const png = await sharp({ create: dimensions }).png().toBuffer();
  const webp = await sharp({ create: dimensions }).webp().toBuffer();
  const jpeg = await sharp({ create: dimensions }).jpeg().toBuffer();
  const images = [
    { buffer: png, ext: 'png', mimeType: 'image/png', seed: 42 },
    { buffer: webp, ext: 'webp', mimeType: 'image/webp' },
    { buffer: jpeg, ext: 'jpg', mimeType: 'image/jpeg' },
  ];
  const large = await sharp(randomBytes(192 * 192 * 3), { raw: { width: 192, height: 192, channels: 3 } }).png().toBuffer();
  const dataUri = 'data:image/png;base64,' + large.toString('base64');
  assert.ok(dataUri.length > 64 * 1024);
  const encodedVibe = Buffer.from('vibe-test-fixture').toString('base64');
  const calls = [];
  let balance = 100;
  const send = startApp(t, {
    archiveDir, imageOrigin,
    client: {
      getSubscription: async () => ({ summary: { totalAnlas: balance, fixedAnlas: balance, purchasedAnlas: 0 } }),
      encodeVibe: async params => { calls.push(['encode', params]); balance -= 2; return encodedVibe; },
      generateImage: async params => {
        calls.push([params.action, params]);
        balance -= 7;
        return { model: params.model ?? DEFAULT_MODEL, seed: 40, images: images.slice(0, params.n_samples ?? 1) };
      },
      augmentImage: async params => { calls.push(['augment', params]); return images; },
      upscaleImage: async params => { calls.push(['upscale', params]); balance--; return [images[0]]; },
      suggestTags: async params => { calls.push(['tags', params]); return { tags: [{ tag: 'cloud' }, { tag: 'cloudy sky' }] }; },
    },
  });
  await json(send(apiBase + '/studio/meta'), 401);
  const admin = await signIn(send);
  assert.deepEqual(await json(admin('/studio/meta')), {
    models: IMAGE_MODELS, defaultModel: DEFAULT_MODEL, capabilities: MODEL_REGISTRY, samplers: SAMPLERS, noiseSchedules: NOISE_SCHEDULES,
    qualityPresets: QUALITY_PRESETS, ucPresets: UC_PRESET_NAMES, augmentReqTypes: AUGMENT_REQ_TYPES,
    emotionMoods: EMOTION_MOODS, preciseReferenceTypes: PRECISE_REFERENCE_TYPES, imageFormats: IMAGE_FORMATS,
  });
  const run = (tool, params, status) => json(admin('/studio/run', 'POST', { tool, params }), status);
  await run('generate_image', { base_prompt: 'invalid size', width: '64' }, 400);
  await run('inpaint_image', { base_prompt: 'missing mask', source_image: dataUri }, 400);
  assert.equal(calls.length, 0);

  const first = await run('generate_image', {
    prompt: 'misty forest', model, width: 64, height: 64, n_samples: 2, steps: 28, quality_preset: 'light',
    characters: { prompt: 'traveler' }, vibe_references: [{ image: dataUri }],
  });
  assert.match(first.costText, /共 9 Anlas/);
  assert.match(first.text, /vibe_id/);
  const [encode, generation] = calls;
  assert.equal(encode[0], 'encode');
  assert.equal(generation[1].prompt, 'misty forest');
  assert.equal(generation[1].qualityPresetId, 'light');
  assert.deepEqual(generation[1].characterPrompts[0].center, { x: 0.5, y: 0.5 });
  assert.equal(generation[1].vibeReferences[0].encoded_vibe, encodedVibe);

  const mcp = await openMcp(send);
  const encoded = mcpData(await mcp('tools/call', {
    name: 'nai_execute', arguments: { action: 'encode_vibe', params: { model, source_image: dataUri } },
  }));
  assert.equal(encoded.anlas_spent, 0);
  assert.ok(first.text.includes(encoded.vibe_id));
  assert.equal(calls.filter(([name]) => name === 'encode').length, 1);

  const redrawn = await run('img2img', {
    base_prompt: 'foggy river', model, source_image: dataUri, strength: 0.37, width: 97, height: 65,
    vibe_references: [{ vibe_id: encoded.vibe_id }],
  });
  const [, img2imgParams] = calls.at(-1);
  assert.deepEqual([img2imgParams.width, img2imgParams.height, img2imgParams.strength], [128, 64, 0.37]);
  assert.equal(img2imgParams.vibeReferences[0].encoded_vibe, encodedVibe);
  const source_image = redrawn.items[0].id;
  const inpainted = await run('inpaint_image', {
    base_prompt: 'cloud reflections', source_image, model, mask_regions: [{ x: 0, y: 0, width: 0.5, height: 0.5 }],
  });
  assert.ok(calls.at(-1)[1].mask.length > 0);
  const directed = await run('augment_image', { source_image, req_type: 'bg-removal' });
  const upscaled = await run('upscale_image', { source_image });
  for (const [receipt, outputs] of [[first, images.slice(0, 2)], [redrawn, images.slice(0, 1)],
    [inpainted, images.slice(0, 1)], [directed, images], [upscaled, images.slice(0, 1)]]) {
    assert.equal(receipt.ok, true, receipt.text);
    assert.equal(receipt.items.length, outputs.length);
    for (const [index, item] of receipt.items.entries()) {
      assert.match(item.id, ARCHIVE_ID_REGEX);
      assert.equal(item.ext, outputs[index].ext);
      assert.equal(item.thumb_url, apiBase + '/images/' + item.id + '/thumb');
      assert.equal(item.image_url, apiBase + '/images/' + item.id + '/raw');
      assert.equal(item.public_url, imageOrigin.origin + '/novelai-images/' + item.id + '.' + item.ext);
      const stored = await getArchivedImageMetadata(archiveDir, item.id);
      assert.equal(stored.link_label, 'Web 在线试画台');
      assert.equal(stored.link_id, undefined);
      assert.equal(stored.tool, item.tool);
      const original = await admin(item.image_url.slice(apiBase.length));
      assert.equal(original.status, 200);
      assert.deepEqual(original.buffer, outputs[index].buffer);
      const thumb = await admin(item.thumb_url.slice(apiBase.length));
      assert.equal(thumb.status, 200);
      assert.equal(thumb.headers['content-type'], 'image/webp');
    }
  }
  const publicImage = await send(new URL(first.items[0].public_url).pathname);
  assert.equal(publicImage.status, 200);
  assert.deepEqual(publicImage.buffer, png);
  const tags = await json(admin('/studio/suggest-tags', 'POST', { prompt: 'clo', model, lang: 'jp', limit: 1 }));
  assert.deepEqual(tags, { tags: [{ tag: 'cloud' }] });
  assert.deepEqual(calls.at(-1), ['tags', { prompt: 'clo', model, lang: 'jp' }]);
  await json(admin('/studio/suggest-tags', 'POST', { prompt: 'clo', limit: 0 }), 400);

  // V5 精确参考 Studio 路由提交与 V4.5 强度越界前置 400 校验
  const v5Precise = await run('generate_image', {
    base_prompt: 'coat test',
    character_references: [{ image: source_image, type: 'costume', strength: 2.5 }],
  });
  assert.equal(v5Precise.ok, true);
  assert.equal(calls.at(-1)[1].characterReferences[0].type, 'costume');
  assert.equal(calls.at(-1)[1].characterReferences[0].strength, 2.5);
  await json(admin('/studio/run', 'POST', {
    tool: 'generate_image',
    params: { base_prompt: 'overflow', model, character_references: [{ image: source_image, type: 'character', strength: 1.5 }] },
  }), 400);
});

test('无归档配置的试画请求在调用上游前返回 503', { timeout: 10_000 }, async t => {
  let calls = 0;
  const admin = await signIn(startApp(t, { client: { generateImage: async () => { calls++; } } }));
  await json(admin('/studio/run', 'POST', { tool: 'generate_image', params: { base_prompt: 'plum blossoms' } }), 503);
  assert.equal(calls, 0);
});

test('管理台与渐进式 MCP 共用内存词库，发现、描述、执行与整库备份均可用', { timeout: 15_000 }, async t => {
  const send = startApp(t);
  await json(send(apiBase + '/library'), 401);
  await json(send(apiBase + '/library/import', { method: 'POST', body: { mode: 'replace' } }), 401);
  const admin = await signIn(send);
  const mcp = await openMcp(send);
  const legacy = await openMcp(startApp(t, { disclosureMode: 'legacy', adminEnabled: false }));
  const progressiveList = await mcp('tools/list');
  const legacyList = await legacy('tools/list');
  assert.deepEqual(progressiveList.tools.map(tool => tool.name), ['nai_discover', 'nai_describe', 'nai_execute']);
  assert.equal(legacyList.tools.length, 17);
  const savedPercent = 1 - Buffer.byteLength(JSON.stringify(progressiveList)) / Buffer.byteLength(JSON.stringify(legacyList));
  assert.ok(savedPercent >= 0.85, '工具列表缩小 ' + savedPercent * 100 + '%');

  const tool = (name, args) => mcp('tools/call', { name, arguments: args });
  const execute = (action, params) => tool('nai_execute', { action, params });
  const { modules } = mcpData(await tool('nai_discover', { module: 'library' }));
  assert.deepEqual(modules.map(item => item.module), ['library']);
  const actions = modules[0].actions.map(item => item.name);
  assert.deepEqual(actions, ['search_artist_library', 'search_prompt_library', 'search_nai_lexicon', 'save_library_entry']);
  const described = mcpData(await tool('nai_describe', { actions })).actions;
  assert.deepEqual(described.map(item => item.name), actions);
  assert.deepEqual(described[3].inputSchema.required, ['target', 'entry']);

  const previewImageId = 'B'.repeat(43);
  const artistBody = { name: '水彩笔法', tag: 'artist:sample', categories: ['水彩'], models: ['V5'], defaultWeight: 1.2, previewImageId };
  const artist = (await json(admin('/library/artists', 'POST', artistBody), 201)).item;
  assert.equal(artist.preview_thumb_url, apiBase + '/images/' + previewImageId + '/thumb');
  const updated = (await json(admin('/library/artists/' + artist.id, 'PATCH', { pinned: true, notes: '纸纹明显' }))).item;
  assert.equal(updated.pinned, true);
  await json(admin('/library/artists/' + artist.id, 'PATCH', { previewImageId: '/unsafe' }), 400);
  const batch = await json(admin('/library/artists/batch-import', 'POST', {
    text: '1.2::artist:sample::, 0.7::artist:other::', mode: 'as_mix', mixName: '水彩混搭', categories: ['水彩'], models: ['V5'],
  }));
  assert.equal(batch.created, 1);
  const artists = mcpData(await execute('search_artist_library', { category: '水彩', query: 'sample', model: 'V5', limit: 2 })).items;
  assert.deepEqual(artists.map(item => item.id), [artist.id, batch.items[0].id]);
  assert.equal(artists[0].formatted_tag, '1.2::artist:sample::');
  const plain = mcpData(await execute('search_artist_library', { query: 'sample', mix_only: true, syntax: 'plain' })).items;
  assert.deepEqual(plain.map(item => item.formatted_tag), ['artist:sample, artist:other']);

  const saved = mcpData(await execute('save_library_entry', {
    target: 'prompt', entry: { title: '云与薄雾', kind: 'snippet', category: '光影', prompt: 'rolling mist', previewImageId },
  })).item;
  assert.equal(mcpData(await execute('search_prompt_library', { query: 'rolling mist', kind: 'snippet', category: '光影' })).items[0].id, saved.id);
  const artistFromMcp = mcpData(await execute('save_library_entry', {
    target: 'artist', entry: { name: '油画示例', tag: 'artist:oil-sample', categories: ['油画'] },
  })).item;
  assert.equal((await execute('save_library_entry', { target: 'artist', entry: { name: '缺少画师标签' } })).isError, true);
  const createPrompt = (await json(admin('/library/prompts', 'POST', {
    title: '构图草稿', kind: 'template', category: '构图', prompt: 'scenery', previewImageId,
  }), 201)).item;
  const editPrompt = (await json(admin('/library/prompts/' + createPrompt.id, 'PATCH', { previewImageId: null }))).item;
  assert.equal(editPrompt.preview_thumb_url, undefined);

  const query = new URLSearchParams({ type: 'prompts', q: 'mist', category: '光影', kind: 'snippet' });
  const view = await json(admin('/library?' + query));
  assert.deepEqual(view.artists, []);
  assert.deepEqual(view.prompts.map(item => item.id), [saved.id]);
  assert.equal(view.prompts[0].preview_thumb_url, apiBase + '/images/' + previewImageId + '/thumb');
  assert.ok(view.categories.includes('油画'));
  assert.equal(view.stats.mixes, 2);

  const exportData = await json(admin('/library/export'));
  assert.ok(exportData.artists.some(item => item.id === artistFromMcp.id));
  assert.equal(exportData.prompts.find(item => item.id === saved.id).preview_thumb_url, undefined);
  await json(admin('/library/prompts/' + createPrompt.id, 'DELETE'));
  await json(admin('/library/artists/' + artist.id, 'DELETE'));
  await json(admin('/library/artists/' + artist.id, 'DELETE'), 404);
  const imported = await json(admin('/library/import', 'POST', { mode: 'replace', ...exportData }));
  assert.deepEqual(imported.stats, view.stats);
  assert.deepEqual(await json(admin('/library/export')), exportData);
  const largePrompt = 'mist '.repeat(15_000);
  await json(admin('/library/import', 'POST', { prompts: [{ title: '长模板', prompt: largePrompt }] }));
  assert.equal((await json(admin('/library/export'))).prompts.find(item => item.title === '长模板').prompt, largePrompt);
});
