import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import sharp from 'sharp';
import { createNovelAIMcpServer } from '../dist/mcp-tools.js';
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
  return (name, args) => client.callTool({ name, arguments: args });
}

function result(params, images = [{ buffer: png, ext: 'png', mimeType: 'image/png', seed: 12 }]) {
  return { images, seed: params.seed ?? 12, model: params.model, requestedModel: params.model, rawBuffer: png };
}

test('Vibe 自动编码跨 generate、img2img、encode_vibe 和进程重启复用，V3 传标准原图', async t => {
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
  const invoke = await connect(t, { client: novelai, archiveDir, imageOrigin: origin });
  const first = await invoke('generate_image', {
    base_prompt: '月下背景', model: v45, vibe_references: [{ image: source, information_extracted: 0.75 }],
  });
  assert.equal(first.isError, undefined);
  assert.equal(first.content[0].type, 'text');
  const [id] = first.content[0].text.match(/vibe_[a-f0-9]{16}/);
  assert.match(first.content[0].text, /\[查看或下载图片\]\(https:\/\/images\.example\.com\/novelai-images\//);
  assert.equal(first.content[1].type, 'image');
  assert.equal(incoming[0].vibeReferences[0].encoded_vibe, encoded);

  const restarted = await connect(t, { client: novelai, archiveDir, imageOrigin: origin });
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

test('能力校验早于参考读取与编码，兼容旧别名和单个角色对象', async t => {
  const incoming = [];
  const invoke = await connect(t, {
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
});

test('缩图再放大，保存回执使用实际图片尺寸，并保留归档失败降级', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nai-tool-result-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archiveDir = join(directory, 'not-a-directory');
  await writeFile(archiveDir, '归档失败');
  const large = await sharp({ create: {
    width: 1900, height: 900, channels: 3, background: '#123456',
  }}).png().toBuffer();
  const invoke = await connect(t, {
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

test('img2img 省略角色 center_x 默认居中，非 PNG 源图在 augment/upscale/encode_vibe 自动转 PNG', async t => {
  const gif = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#2266aa' },
  }).gif().toBuffer();
  const gifInput = `data:image/gif;base64,${gif.toString('base64')}`;
  const received = { img2img: null, augment: null, upscale: null, encode: null };
  const invoke = await connect(t, {
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
