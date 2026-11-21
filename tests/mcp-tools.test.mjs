import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import sharp from 'sharp';
import { createNovelAIMcpServer, getDisclosureMetrics, PROGRESSIVE_TOOL_COUNT } from '../dist/mcp-tools.js';
import { DEFAULT_MODEL, IMAGE_MODELS } from '../dist/types.js';
import { renderV5StylistGuide } from '../dist/v5-stylist.js';
import { VibeCache } from '../dist/vibe-cache.js';

const v45 = 'nai-diffusion-4-5-full';
const v3 = 'nai-diffusion-3';
const origin = new URL('https://images.example.com');
const png = await sharp({
  create: { width: 101, height: 190, channels: 3, background: '#b53022' },
}).png().toBuffer();
const encoded = Buffer.from('opaque-v4-vibe').toString('base64');
const source = `data:image/png;base64,${png.toString('base64')}`;

async function connect(t, options) {
  const client = new Client({ name: '工具测试', version: '1.0.0' });
  const server = createNovelAIMcpServer(options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return client;
}

function testBothModes(name, run) {
  for (const disclosureMode of ['legacy', 'progressive']) {
    test(`${name}（${disclosureMode}）`, t => run(t, async options => {
      const client = await connect(t, { ...options, disclosureMode });
      return (action, params) => client.callTool(disclosureMode === 'legacy'
        ? { name: action, arguments: params }
        : { name: 'nai_execute', arguments: { action, params } });
    }));
  }
}

function jsonContent(result) {
  assert.equal(result.isError, undefined, result.content[0]?.text);
  return JSON.parse(result.content[0].text);
}

function result(params, images = [{ buffer: png, ext: 'png', mimeType: 'image/png', seed: 12 }]) {
  return { images, seed: params.seed ?? 12, model: params.model, requestedModel: params.model, rawBuffer: png };
}

test('渐进式默认只列出三个工具，实际列表比平铺模式至少缩小 85%', async t => {
  const progressive = await connect(t, { client: {} });
  const legacy = await connect(t, { client: {}, disclosureMode: 'legacy' });
  const progressiveList = await progressive.listTools();
  const legacyList = await legacy.listTools();
  assert.deepEqual(progressiveList.tools.map(tool => tool.name), ['nai_discover', 'nai_describe', 'nai_execute']);
  assert.equal(PROGRESSIVE_TOOL_COUNT, 3);
  assert.equal(legacyList.tools.length, 13);
  const listJson = JSON.stringify(progressiveList);
  assert.doesNotMatch(listJson, /base_prompt|1,048,576|1\.3::halftone::/);
  const progressiveBytes = Buffer.byteLength(listJson);
  const legacyBytes = Buffer.byteLength(JSON.stringify(legacyList));
  const estimatedSavedPercent = (1 - progressiveBytes / legacyBytes) * 100;
  assert.ok(estimatedSavedPercent >= 85, `${progressiveBytes} / ${legacyBytes} 字节`);
  assert.deepEqual(getDisclosureMetrics(), {
    progressiveTools: 3, legacyTools: 13, progressiveBytes, legacyBytes, estimatedSavedPercent,
  });
  assert.equal((await progressive.callTool({ name: 'get_subscription' })).isError, true);
  assert.equal((await legacy.callTool({ name: 'nai_discover' })).isError, true);
});

test('渐进式发现、描述和执行复用动作参数、风格指南与出图回执', async t => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'nai-progressive-'));
  t.after(() => rm(archiveDir, { recursive: true, force: true }));
  const completed = [];
  const generated = [];
  let balance = 120;
  const client = {
    getSubscription: async () => ({
      raw: {}, summary: { tier: 3, tierName: 'Opus', active: true, fixedAnlas: balance, purchasedAnlas: 0, totalAnlas: balance },
    }),
    suggestTags: async ({ prompt, model, lang }) => {
      assert.deepEqual([prompt, model, lang], ['tree', DEFAULT_MODEL, 'en']);
      return { tags: [{ tag: 'tree' }, { tag: 'tree shadow' }] };
    },
    generateImage: async params => {
      generated.push(params);
      balance -= 17;
      return result({ ...params, model: params.model ?? DEFAULT_MODEL });
    },
  };
  const progressive = await connect(t, { client, archiveDir, imageOrigin: origin, onToolCompleted: event => completed.push(event) });
  const legacy = await connect(t, { client, disclosureMode: 'legacy' });
  const invoke = (name, args) => progressive.callTool({ name, arguments: args });
  const execute = (action, params) => invoke('nai_execute', { action, params });

  const { tools } = await legacy.listTools();
  const { modules } = jsonContent(await invoke('nai_discover'));
  assert.deepEqual(modules.map(entry => entry.module), ['generate', 'enhance', 'assist', 'guides', 'library']);
  assert.deepEqual(modules.flatMap(entry => entry.actions.map(action => action.name)).sort(), tools.map(tool => tool.name).sort());
  const enhance = jsonContent(await invoke('nai_discover', { module: 'enhance' }));
  assert.deepEqual(enhance.modules.map(entry => entry.module), ['enhance']);
  assert.deepEqual(enhance.modules[0].actions.map(action => action.name), ['augment_image', 'upscale_image', 'encode_vibe']);
  const match = jsonContent(await invoke('nai_discover', { module: 'generate', query: ' GENERATE_IMAGE ' }));
  assert.deepEqual(match.modules[0].actions.map(action => action.name), ['generate_image']);
  assert.deepEqual(jsonContent(await invoke('nai_discover', { module: 'assist', query: 'generate_image' })), { modules: [] });
  assert.equal(jsonContent(await invoke('nai_discover', { query: 'cost_policy' })).modules[0].guides[0].name, 'cost_policy');

  const described = jsonContent(await invoke('nai_describe', { actions: ['generate_image'] }));
  assert.deepEqual(described.actions[0].inputSchema, tools.find(tool => tool.name === 'generate_image').inputSchema);
  const stylist = { topic: 'decontaminate', blueprint: 'retro_90s_cel' };
  const stylistResult = await invoke('nai_describe', { guide: 'v5_stylist', ...stylist });
  assert.equal(stylistResult.content[0].text, renderV5StylistGuide(stylist));
  const costResult = await invoke('nai_describe', { guide: 'cost_policy' });
  assert.match(costResult.content[0].text, /Opus.*1,048,576.*V5.*Anlas/);
  const models = jsonContent(await invoke('nai_describe', { guide: 'models' }));
  assert.equal(models.defaultModel, DEFAULT_MODEL);
  assert.deepEqual(models.models.map(entry => entry.model), IMAGE_MODELS);
  assert.equal(models.models.find(entry => entry.model === 'nai-diffusion-5-full-medium').steps, 14);

  const { prompts } = await progressive.listPrompts();
  assert.equal(prompts[0].name, 'novelai-v5-stylist');
  const promptRequest = { name: prompts[0].name, arguments: { aesthetic: 'pop halftone' } };
  assert.deepEqual(await progressive.getPrompt(promptRequest), await legacy.getPrompt(promptRequest));
  const { resources } = await progressive.listResources();
  assert.equal(resources[0].uri, 'novelai://skills/v5-stylist');
  const resourceRequest = { uri: resources[0].uri };
  assert.deepEqual(await progressive.readResource(resourceRequest), await legacy.readResource(resourceRequest));
  assert.deepEqual(completed, []);

  assert.deepEqual(await execute('get_subscription'), await legacy.callTool({ name: 'get_subscription' }));
  const tagArgs = { prompt: 'tree', model: DEFAULT_MODEL, lang: 'en', limit: 1 };
  const tags = await execute('suggest_tags', tagArgs);
  assert.deepEqual(jsonContent(tags), { tags: [{ tag: 'tree' }] });
  assert.deepEqual(tags, await legacy.callTool({ name: 'suggest_tags', arguments: tagArgs }));
  assert.equal((await execute('generate_image', { base_prompt: 'test', width: '64' })).isError, true);
  assert.equal((await execute('generate_image', [])).isError, true);
  assert.equal((await execute('nai_discover')).isError, true);
  assert.equal(generated.length, 0);

  const output = await execute('generate_image', {
    input: '月下松林', width: 64, height: 64, characters: { prompt: '旅人' },
  });
  assert.equal(output.isError, undefined, output.content[0]?.text);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].prompt, '月下松林');
  assert.deepEqual(generated[0].characterPrompts[0].center, { x: 0.5, y: 0.5 });
  assert.match(output.content[0].text, /\[查看或下载图片\]\(https:\/\/images\.example\.com\/novelai-images\/[A-Za-z0-9_-]{43}\.png\)/);
  assert.match(output.content[0].text, /本次消耗：17 Anlas，当前剩余 103 Anlas/);
  assert.deepEqual(output.content[1], { type: 'image', mimeType: 'image/png', data: png.toString('base64') });
  assert.deepEqual(completed, [{ tool: 'get_subscription' }, { tool: 'suggest_tags' }, { tool: 'generate_image', anlasSpent: 17 }]);
});

testBothModes('Vibe 自动编码跨 generate、img2img、encode_vibe 和进程重启复用，V3 传标准原图', async (t, connectTools) => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'nai-tool-vibes-'));
  t.after(() => rm(archiveDir, { recursive: true, force: true }));
  const incoming = [];
  let encodes = 0;
  const novelai = {
    encodeVibe: async params => {
      encodes++;
      assert.equal(params.model, v45);
      assert.deepEqual(Buffer.from(params.image, 'base64'), png);
      return encoded;
    },
    generateImage: async params => {
      incoming.push(params);
      return result(params);
    },
  };
  const invoke = await connectTools({ client: novelai, archiveDir, imageOrigin: origin });
  const first = await invoke('generate_image', {
    base_prompt: '月下背景', model: v45, vibe_references: [{ image: source, information_extracted: 0.75 }],
  });
  assert.equal(first.isError, undefined);
  assert.equal(first.content[0].type, 'text');
  const [id] = first.content[0].text.match(/vibe_[a-f0-9]{16}/);
  assert.match(first.content[0].text, /\[查看或下载图片\]\(https:\/\/images\.example\.com\/novelai-images\//);
  assert.equal(first.content[1].type, 'image');
  assert.equal(incoming[0].vibeReferences[0].encoded_vibe, encoded);

  const restarted = await connectTools({ client: novelai, archiveDir, imageOrigin: origin });
  const cached = await restarted('img2img', {
    base_prompt: '溪流', model: v45, source_image: source,
    vibe_references: [{ image: source, information_extracted: 0.75 }, { vibe_id: id }],
  });
  assert.equal(cached.isError, undefined);
  assert.deepEqual(incoming[1].vibeReferences.map(vibe => vibe.encoded_vibe), [encoded, encoded]);
  assert.deepEqual(
    await sharp(Buffer.from(incoming[1].image, 'base64')).metadata().then(({ width, height }) => [width, height]),
    [128, 192],
  );
  const encodedTool = await restarted('encode_vibe', {
    source_image: source, model: v45, information_extracted: 0.75,
  });
  assert.deepEqual(JSON.parse(encodedTool.content[0].text), {
    vibe_id: id, model: v45, information_extracted: 0.75,
  });
  assert.equal(encodes, 1);

  const raw = await invoke('generate_image', { base_prompt: '溪流', model: v3, vibe_references: [{ image: source }] });
  assert.equal(raw.isError, undefined);
  const rawMetadata = await sharp(Buffer.from(incoming[2].vibeReferences[0].image, 'base64')).metadata();
  assert.deepEqual([rawMetadata.width, rawMetadata.height, rawMetadata.format], [448, 448, 'png']);
  assert.equal(encodes, 1);
});

testBothModes('能力校验早于参考读取与编码，兼容旧别名和单个角色对象', async (_t, connectTools) => {
  const incoming = [];
  const invoke = await connectTools({
    client: {
      encodeVibe: async () => assert.fail('不应请求 Vibe 编码'),
      generateImage: async params => {
        incoming.push(params);
        return result(params);
      },
    },
  });
  const failure = await invoke('generate_image', {
    base_prompt: 'test', model: v45,
    character_references: [{ image: '/不可读取.png', type: 'character' }],
    vibe_references: [{ image: '/不可读取.png' }],
  });
  assert.equal(failure.isError, true);
  assert.match(failure.content[0].text, /不能同时使用/);
  const missing = await invoke('inpaint_image', { source_image: source, base_prompt: 'test' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /mask_image.*mask_regions/);
  const older = await invoke('generate_image', {
    prompt: '旧客户端提示词', characters: { prompt: '独立角色' }, model: v45,
  });
  assert.equal(older.isError, undefined);
  assert.deepEqual(incoming[0].characterPrompts[0].center, { x: 0.5, y: 0.5 });
  assert.equal(incoming[0].prompt, '旧客户端提示词');
  const inpainted = await invoke('inpaint_image', {
    source_image: source, base_prompt: '修复高光', mask_regions: [{ x: 0, y: 0, width: 0.5, height: 0.5 }],
  });
  assert.equal(inpainted.isError, undefined, inpainted.content[0]?.text);
  assert.equal(incoming[1].action, 'infill');
  assert.ok(incoming[1].mask);
});

testBothModes('缩图再放大，保存回执使用实际图片尺寸，并保留归档失败降级', async (t, connectTools) => {
  const directory = await mkdtemp(join(tmpdir(), 'nai-tool-result-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archiveDir = join(directory, 'not-a-directory');
  await writeFile(archiveDir, '归档失败');
  const large = await sharp({ create: {
    width: 1900, height: 900, channels: 3, background: '#123456',
  }}).png().toBuffer();
  const invoke = await connectTools({
    archiveDir,
    client: {
      upscaleImage: async ({ image }) => {
        const { width, height } = await sharp(Buffer.from(image, 'base64')).metadata();
        assert.equal(width % 8, 0);
        assert.equal(height % 8, 0);
        assert.ok(width * height <= 1048576);
        return [{ buffer: png, ext: 'png', mimeType: 'image/png' }];
      },
    },
  });
  const output = await invoke('upscale_image', { source_image: large.toString('base64') });
  assert.equal(output.isError, undefined);
  assert.match(output.content[0].text, /101×190/);
  assert.match(output.content[0].text, /服务器保存失败.*请勿.*自动重新出图/s);
  assert.equal(output.content[1].data, png.toString('base64'));
});

testBothModes('img2img 省略角色 center_x 默认居中，非 PNG 源图在 augment/upscale/encode_vibe 自动转 PNG', async (_t, connectTools) => {
  const gif = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#2266aa' },
  }).gif().toBuffer();
  const gifInput = `data:image/gif;base64,${gif.toString('base64')}`;
  const received = { img2img: null, augment: null, upscale: null, encode: null };
  const invoke = await connectTools({
    client: {
      generateImage: async params => {
        received.img2img = params;
        return result(params);
      },
      augmentImage: async params => {
        received.augment = Buffer.from(params.image, 'base64');
        return [{ buffer: png, ext: 'png', mimeType: 'image/png' }];
      },
      upscaleImage: async params => {
        received.upscale = Buffer.from(params.image, 'base64');
        return [{ buffer: png, ext: 'png', mimeType: 'image/png' }];
      },
      encodeVibe: async params => {
        received.encode = Buffer.from(params.image, 'base64');
        return encoded;
      },
    },
  });

  const img2imgRes = await invoke('img2img', {
    base_prompt: 'forest',
    source_image: source,
    model: v45,
    characters: [{ prompt: '1girl' }],
  });
  assert.equal(img2imgRes.isError, undefined);
  assert.deepEqual(received.img2img.characterPrompts[0].center, { x: 0.5, y: 0.5 });

  const augRes = await invoke('augment_image', { source_image: gifInput, req_type: 'lineart' });
  assert.equal(augRes.isError, undefined);
  assert.equal((await sharp(received.augment).metadata()).format, 'png');

  const upRes = await invoke('upscale_image', { source_image: gifInput, auto_fit_1mp: false });
  assert.equal(upRes.isError, undefined);
  assert.equal((await sharp(received.upscale).metadata()).format, 'png');

  const encRes = await invoke('encode_vibe', { source_image: gifInput, model: v45 });
  assert.equal(encRes.isError, undefined);
  assert.equal((await sharp(received.encode).metadata()).format, 'png');
});

testBothModes('出图自动对比前后订阅余额并回报每张消耗 Anlas、V5 额度条变化与归档记录', async (t, connectTools) => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'nai-tool-cost-'));
  t.after(() => rm(archiveDir, { recursive: true, force: true }));
  const snapshots = [
    // 单张付费：5670 -> 5650（消耗 20 Anlas）
    { tier: 0, tierName: 'Paper', active: false, fixedAnlas: 0, purchasedAnlas: 5670, totalAnlas: 5670 },
    { tier: 0, tierName: 'Paper', active: false, fixedAnlas: 0, purchasedAnlas: 5650, totalAnlas: 5650 },
    // 多张（2 张）付费：5650 -> 5614（共 36，约 18 Anlas/张）
    { tier: 0, tierName: 'Paper', active: false, fixedAnlas: 0, purchasedAnlas: 5650, totalAnlas: 5650 },
    { tier: 0, tierName: 'Paper', active: false, fixedAnlas: 0, purchasedAnlas: 5614, totalAnlas: 5614 },
    // V5 额度条消耗（0 Anlas，100% -> 98%）
    { tier: 3, tierName: 'Opus', active: true, fixedAnlas: 10000, purchasedAnlas: 0, totalAnlas: 10000, v5Usage: { percent: 100, purchasedPercent: 0, isNegative: false } },
    { tier: 3, tierName: 'Opus', active: true, fixedAnlas: 10000, purchasedAnlas: 0, totalAnlas: 10000, v5Usage: { percent: 98, purchasedPercent: 0, isNegative: false } },
  ];
  let idx = 0;
  const invoke = await connectTools({
    archiveDir,
    imageOrigin: origin,
    client: {
      getSubscription: async () => ({ raw: {}, summary: snapshots[idx++] }),
      generateImage: async params => {
        const count = params.n_samples ?? 1;
        const images = Array.from({ length: count }, (_, i) => ({ buffer: png, ext: 'png', mimeType: 'image/png', seed: 100 + i }));
        return result(params, images);
      },
    },
  });

  const paidSingle = await invoke('generate_image', { base_prompt: 'single' });
  assert.equal(paidSingle.isError, undefined);
  assert.match(paidSingle.content[0].text, /消耗 20 Anlas/);
  assert.match(paidSingle.content[0].text, /本次消耗：20 Anlas，当前剩余 5650 Anlas/);
  const [singleId] = paidSingle.content[0].text.match(/[A-Za-z0-9_-]{43}/);
  const singleMeta = await invoke('list_archived_images', { image_id: singleId });
  const parsedMeta = JSON.parse(singleMeta.content[1].text);
  assert.equal(parsedMeta.anlas_spent, 20);

  const paidMulti = await invoke('generate_image', { base_prompt: 'multi', n_samples: 2 });
  assert.equal(paidMulti.isError, undefined);
  assert.match(paidMulti.content[0].text, /约 18 Anlas\/张/);
  assert.match(paidMulti.content[0].text, /共 36 Anlas（2 张，约 18 Anlas\/张），当前剩余 5614 Anlas/);

  const v5Meter = await invoke('generate_image', { base_prompt: 'v5', model: 'nai-diffusion-5-full' });
  assert.equal(v5Meter.isError, undefined);
  assert.match(v5Meter.content[0].text, /本次消耗：0 Anlas（V5 额度条 100% → 98%），当前剩余 10000 Anlas/);
});

testBothModes('get_v5_stylist_guide 返回完整指南、分章节与预设风格蓝图', async (_t, connectTools) => {
  const invoke = await connectTools({ client: {} });
  const full = await invoke('get_v5_stylist_guide', {});
  assert.equal(full.isError, undefined);
  assert.match(full.content[0].text, /novelai-v5-stylist/);
  assert.match(full.content[0].text, /1\.3::halftone::/);

  const bp = await invoke('get_v5_stylist_guide', { topic: 'decontaminate', blueprint: 'retro_90s_cel' });
  assert.equal(bp.isError, undefined);
  assert.match(bp.content[0].text, /year 1995/);
  assert.match(bp.content[0].text, /-3::glossy skin/);
});
