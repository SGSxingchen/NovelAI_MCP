import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { NovelAIClient } from '../dist/novelai-client.js';
import { computeVarietySigma, normalizeSeed, alignDimension } from '../dist/model-registry.js';
import { AUGMENT_REQ_TYPES, EMOTION_MOODS, IMAGE_MODELS } from '../dist/types.js';

const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 30, g: 100, b: 120, alpha: 0.7 } } }).png().toBuffer();
const image = png.toString('base64');

async function mockNovelAI(t, respond = (_request, res) => res.writeHead(201, { 'Content-Type': 'image/png' }).end(png)) {
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      const request = { method: req.method, url: new URL(req.url, 'http://localhost'), headers: req.headers, body };
      requests.push(request);
      respond(request, res);
    } catch {
      res.writeHead(500).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { client: new NovelAIClient('test-key', { baseUrl }), baseUrl, requests };
}

test('模型顺序、默认步数与引导值及协议版本按模型族变化', async (t) => {
  const { client, requests } = await mockNovelAI(t);
  const cases = [
    ['nai-diffusion-5-curated', 4, 23, 7, false, false],
    ['nai-diffusion-5-full', 4, 23, 7, false, false],
    ['nai-diffusion-5-full-medium', 4, 14, 7, false, false],
    ['nai-diffusion-4-5-full', 3, 28, 6, true, false],
    ['nai-diffusion-4-5-curated', 3, 28, 5, true, false],
    ['nai-diffusion-4-full', 3, 23, 5.5, true, true],
    ['nai-diffusion-4-curated-preview', 3, 23, 5.5, true, true],
    ['nai-diffusion-3', 3, 23, 5, false, false],
    ['nai-diffusion-furry-3', 3, 23, 6.2, false, false],
  ];
  assert.deepEqual(IMAGE_MODELS, cases.map(([model]) => model));

  for (const [model, version, steps, scale, brownian, legacyUc] of cases) {
    const result = await client.generateImage({ prompt: 'clouds', model, seed: 123, noise_schedule: 'native' });
    const { body, headers, method, url } = requests.at(-1);
    const p = body.parameters;
    const isV3 = model.endsWith('-3');
    assert.equal(method, 'POST');
    assert.equal(url.pathname, '/ai/generate-image');
    assert.equal(headers.authorization, 'Bearer test-key');
    assert.equal(headers.origin, 'https://novelai.net');
    assert.equal(headers.referer, 'https://novelai.net/');
    assert.match(headers['x-correlation-id'], /^[0-9A-Za-z]{6}$/);
    assert.equal(body.model, model);
    assert.equal(body.action, 'generate');
    assert.equal(p.params_version, version);
    assert.equal(p.steps, steps);
    assert.equal(p.scale, scale);
    assert.equal(p.prefer_brownian, brownian);
    assert.equal(p.deliberate_euler_ancestral_bug, false);
    assert.equal(p.noise_schedule, isV3 ? 'native' : 'karras');
    assert.equal('v4_prompt' in p, !isV3);
    assert.equal('v4_negative_prompt' in p, !isV3);
    assert.equal('sm' in p, isV3);
    assert.equal('sm_dyn' in p, isV3);
    assert.equal('autoSmea' in p, isV3);
    assert.equal('dynamic_thresholding' in p, isV3);
    if (!isV3) assert.equal(p.v4_negative_prompt.legacy_uc, legacyUc);
    if (version === 4) {
      assert.equal(p.ucPresetId, 'heavy');
      assert.equal(p.qualityPresetId, 'standard');
      assert.equal('ucPreset' in p, false);
      assert.equal('qualityToggle' in p, false);
    } else {
      assert.equal(p.ucPreset, 0);
      assert.equal(p.qualityToggle, true);
      assert.equal('ucPresetId' in p, false);
      assert.equal('qualityPresetId' in p, false);
    }
    assert.equal(result.seed, 123);
    assert.equal(result.model, model);
    assert.equal(result.requestedModel, model);
    assert.deepEqual(result.rawBuffer, png);
    assert.deepEqual(result.images[0].buffer, png);
  }
});

test('V5 透明标签与角色结构、V5 Medium 硬锁定及采样边界', async (t) => {
  const { client, requests } = await mockNovelAI(t);
  const characterPrompts = [{ prompt: 'blue hair', uc: 'hat', center: { x: 0.25, y: 0.75 }, enabled: true }];
  await client.generateImage({
    prompt: 'clouds', model: 'nai-diffusion-5-full-medium', steps: 33, sampler: 'k_euler', cfg_rescale: 0.7,
    ucPresetId: 'none', qualityPresetId: 'light', image_format: 'webp', transparent_background: true,
    characterPrompts, negative_prompt: 'text', use_coords: false, variety_plus: true,
    prefer_brownian: true, uncond_scale: 0, seed: 2 ** 32,
  });
  const { input, parameters: p } = requests.at(-1).body;
  assert.match(input, /\btransparent background\b/);
  assert.equal(p.v4_prompt.caption.base_caption, input);
  assert.deepEqual(p.v4_prompt.caption.char_captions, [{ char_caption: 'blue hair', centers: [{ x: 0.25, y: 0.75 }] }]);
  assert.deepEqual(p.v4_negative_prompt.caption, { base_caption: 'text', char_captions: [{ char_caption: 'hat', centers: [{ x: 0.25, y: 0.75 }] }] });
  assert.deepEqual(p.characterPrompts, characterPrompts);
  assert.equal(p.v4_prompt.use_coords, false);
  assert.equal(p.v4_prompt.use_order, true);
  assert.equal(p.straight_alpha, true);
  assert.equal(p.tag_hint_transparent_background, true);
  assert.equal(p.image_format, 'webp');
  assert.equal(p.steps, 14);
  assert.equal(p.sampler, 'k_euler_ancestral');
  assert.equal(p.cfg_rescale, 0);
  assert.equal(p.ucPresetId, 'heavy');
  assert.equal(p.qualityPresetId, 'light');
  assert.equal(p.skip_cfg_above_sigma, null);
  assert.equal(p.prefer_brownian, true);
  assert.equal(p.uncond_scale, 0.00001);
  assert.equal(p.seed, 4294967288);

  await client.generateImage({ prompt: 'flowers, TRANSPARENT BACKGROUND', transparent_background: true });
  assert.equal(requests.at(-1).body.input, 'flowers, TRANSPARENT BACKGROUND');
  assert.equal(requests.at(-1).body.model, 'nai-diffusion-5-curated');
  await assert.rejects(client.generateImage({ prompt: 'clouds', model: 'nai-diffusion-4-full', transparent_background: true }), /透明/);
  assert.equal(requests.length, 2);
});

test('Variety+ 按有效尺寸计算，明确阈值优先，ddim_v3 省略噪声调度', async (t) => {
  const { client, requests } = await mockNovelAI(t);
  const model = 'nai-diffusion-3';
  assert.equal(computeVarietySigma(58, 832, 1216), 58);
  assert.equal(computeVarietySigma(58, 1024, 1024), 60);
  assert.equal(alignDimension(100), 128);
  for (const value of [-1, 0, undefined]) {
    const result = normalizeSeed(value);
    assert.ok(Number.isInteger(result) && result >= 1 && result <= 4294967288);
  }
  await client.generateImage({ prompt: 'clouds', model, sampler: 'ddim_v3', noise_schedule: 'native', variety_plus: true, width: 1024, height: 1024, sm: true, sm_dyn: true, dynamic_thresholding: true });
  let p = requests.at(-1).body.parameters;
  assert.equal(p.sampler, 'ddim_v3');
  assert.equal('noise_schedule' in p, false);
  assert.equal(p.skip_cfg_above_sigma, 20);
  assert.equal(p.sm, true);
  assert.equal(p.sm_dyn, true);
  assert.equal(p.dynamic_thresholding, true);
  await client.generateImage({ prompt: 'clouds', model, variety_plus: true, skip_cfg_above_sigma: 9 });
  p = requests.at(-1).body.parameters;
  assert.equal(p.skip_cfg_above_sigma, 9);
  await client.generateImage({ prompt: 'clouds', model, variety_plus: true, skip_cfg_above_sigma: null });
  assert.equal(requests.at(-1).body.parameters.skip_cfg_above_sigma, null);
});

test('保留旧的预设参数、控制图字段与原始 Buffer 调用', async (t) => {
  const { client, requests } = await mockNovelAI(t);
  const raw = await client.generateImageBuffer({
    prompt: 'rose', model: 'nai-diffusion-4-5-full', ucPreset: 1, qualityToggle: false,
    controlnet_condition: image, controlnet_model: 'canny', controlnet_strength: 0.5,
  });
  const p = requests[0].body.parameters;
  assert.deepEqual(raw, png);
  assert.equal(p.ucPreset, 1);
  assert.equal(p.qualityToggle, false);
  assert.equal(p.controlnet_condition, image);
  assert.equal(p.controlnet_model, 'canny');
  assert.equal(p.controlnet_strength, 0.5);
});

test('局部重绘按实际模型回退并校验角色上限，请求只在重绘强度小于一时带嵌套图生图', async (t) => {
  const { client, requests } = await mockNovelAI(t);
  const sevenChars = Array.from({ length: 7 }, () => ({ prompt: 'rose', uc: '', center: { x: 0.5, y: 0.5 }, enabled: true }));
  const input = { prompt: 'rose', action: 'infill', image, mask: image, sampler: 'ddim', seed: 355 };
  const result = await client.generateImage({
    ...input, inpaintImg2ImgStrength: 0.63, noise: 0.15, characterPrompts: sevenChars, transparent_background: true,
  });
  assert.equal(result.requestedModel, 'nai-diffusion-5-curated');
  assert.equal(result.model, 'nai-diffusion-5-full-inpainting');
  assert.match(result.fallbackNotice, /nai-diffusion-5-full-inpainting/);
  let p = requests.at(-1).body.parameters;
  assert.equal(p.params_version, 4);
  assert.equal(p.scale, 7);
  assert.equal(p.steps, 23);
  assert.equal(p.image, image);
  assert.equal(p.mask, image);
  assert.equal(p.add_original_image, true);
  assert.equal(p.sampler, 'k_euler_ancestral');
  assert.equal(p.straight_alpha, true);
  assert.equal(p.inpaintImg2ImgStrength, 0.63);
  assert.equal(p.noise, 0.15);
  assert.deepEqual(p.img2img, { strength: 0.63, color_correct: true, noise: 0.15, extra_noise_seed: 355 });

  await client.generateImage({ ...input, model: 'nai-diffusion-5-full', inpaintImg2ImgStrength: 0.5, sampler: 'ddim_v3' });
  p = requests.at(-1).body.parameters;
  assert.equal(requests.at(-1).body.model, 'nai-diffusion-5-full-inpainting');
  assert.equal(p.sampler, 'k_euler_ancestral');
  assert.deepEqual(p.img2img, { strength: 0.5, color_correct: true, extra_noise_seed: 355 });

  await client.generateImage({ ...input, model: 'nai-diffusion-5-full-medium', steps: 20, add_original_image: false });
  p = requests.at(-1).body.parameters;
  assert.equal(requests.at(-1).body.model, 'nai-diffusion-5-full-medium-inpainting');
  assert.equal(p.steps, 14);
  assert.equal(p.add_original_image, false);
  assert.equal(p.inpaintImg2ImgStrength, 1);
  assert.equal(p.noise, 0);
  assert.equal('img2img' in p, false);

  const tooManyV5Chars = Array.from({ length: 33 }, () => ({ prompt: 'rose', uc: '', center: { x: 0.5, y: 0.5 }, enabled: true }));
  await assert.rejects(client.generateImage({ ...input, characterPrompts: tooManyV5Chars }), /32/);
  await assert.rejects(client.generateImage({ ...input, model: 'nai-diffusion-4-5-curated', characterPrompts: sevenChars }), /6/);
  await assert.rejects(client.generateImage({ ...input, model: 'nai-diffusion-4-5-curated', transparent_background: true }), /透明/);
  assert.equal(requests.length, 3);
});

test('图生图默认去噪、色彩修正及种子，并禁用 V3 SMEA', async (t) => {
  const { client, requests } = await mockNovelAI(t);
  const input = { prompt: 'clouds', action: 'img2img', model: 'nai-diffusion-3', seed: 17, image, sm: true, sm_dyn: true, autoSmea: true };
  await client.generateImage(input);
  let p = requests.at(-1).body.parameters;
  assert.equal(p.image, image);
  assert.equal(p.strength, 0.7);
  assert.equal(p.noise, 0);
  assert.equal(p.extra_noise_seed, 17);
  assert.equal(p.color_correct, true);
  assert.equal(p.sm, false);
  assert.equal(p.sm_dyn, false);
  assert.equal(p.autoSmea, false);

  await client.generateImage({ ...input, color_correct: false, extra_noise_seed: 22, strength: 0, noise: 0.2 });
  p = requests.at(-1).body.parameters;
  assert.equal(p.strength, 0);
  assert.equal(p.noise, 0.2);
  assert.equal(p.extra_noise_seed, 22);
  assert.equal(p.color_correct, false);
});

test('精确参考五组参数等长并反转忠实度，Vibe 与精确参考互斥', async (t) => {
  const { client, requests } = await mockNovelAI(t);
  const input = {
    prompt: 'rose', model: 'nai-diffusion-4-5-full',
    characterReferences: [
      { image, type: 'character&style', strength: 0.83, fidelity: 0.28336 },
      { image, type: 'costume', strength: 0.38, fidelity: 1 },
    ],
  };
  await client.generateImage(input);
  const p = requests.at(-1).body.parameters;
  assert.deepEqual(p.director_reference_images, [image, image]);
  assert.deepEqual(p.director_reference_descriptions, ['character&style', 'costume'].map((type) => ({ caption: { base_caption: type, char_captions: [] }, legacy_uc: false })));
  assert.deepEqual(p.director_reference_information_extracted, [1, 1]);
  assert.deepEqual(p.director_reference_strength_values, [0.83, 0.38]);
  assert.deepEqual(p.director_reference_secondary_strength_values, [0.7166, 0]);

  const vibeReferences = [{ encoded_vibe: image }];
  await assert.rejects(client.generateImage({ ...input, vibeReferences }), /同时|互斥/);
  await assert.rejects(client.generateImage({ ...input, model: 'nai-diffusion-4-full' }), /参考/);
  await assert.rejects(client.generateImage({ ...input, reference_image_multiple: [image] }), /同时|互斥/);
  assert.equal(requests.length, 1);
});

test('V3 传原图和提取度，V4 与 V4.5 传编码且按局部重绘能力开关', async (t) => {
  const { client, requests } = await mockNovelAI(t);
  const vibeReferences = [{ image, information_extracted: 0.48, strength: 0.72 }];
  await client.generateImage({ prompt: 'clouds', model: 'nai-diffusion-3', vibeReferences, normalize_reference_strength_multiple: false });
  let p = requests.at(-1).body.parameters;
  assert.deepEqual(p.reference_image_multiple, [image]);
  assert.deepEqual(p.reference_information_extracted_multiple, [0.48]);
  assert.deepEqual(p.reference_strength_multiple, [0.72]);
  assert.equal(p.normalize_reference_strength_multiple, false);

  const encodeInput = [{ encoded_vibe: 'YmluYXJ5', information_extracted: 0.2, strength: 0.77 }];
  await client.generateImage({ prompt: 'clouds', model: 'nai-diffusion-4-5-full', vibeReferences: encodeInput });
  p = requests.at(-1).body.parameters;
  assert.deepEqual(p.reference_image_multiple, ['YmluYXJ5']);
  assert.deepEqual(p.reference_strength_multiple, [0.77]);
  assert.equal(p.normalize_reference_strength_multiple, true);
  assert.equal('reference_information_extracted_multiple' in p, false);

  const infill = { prompt: 'clouds', action: 'infill', image, mask: image, vibeReferences: encodeInput };
  await client.generateImage({ ...infill, model: 'nai-diffusion-4-full' });
  assert.equal(requests.at(-1).body.model, 'nai-diffusion-4-full-inpainting');
  assert.deepEqual(requests.at(-1).body.parameters.reference_image_multiple, ['YmluYXJ5']);
  await assert.rejects(client.generateImage({ ...infill, model: 'nai-diffusion-4-5-full' }), /Vibe/i);
  await assert.rejects(client.generateImage({ prompt: 'clouds', vibeReferences: encodeInput }), /Vibe/i);
  await assert.rejects(client.generateImage({ prompt: 'clouds', model: 'nai-diffusion-3', vibeReferences: Array(17).fill(vibeReferences[0]) }), /16/);
  assert.equal(requests.length, 3);
});

test('导演工具覆盖 8 个操作、24 个情绪与三张去背景图片', async (t) => {
  const { client, requests } = await mockNovelAI(t, (request, res) => {
    if (request.body.req_type === 'bg-removal') {
      const response = new AdmZip();
      for (const entry of ['mask.png', 'image.png', 'generated.png']) response.addFile(entry, png);
      res.writeHead(201, { 'Content-Type': 'application/zip' }).end(response.toBuffer());
      return;
    }
    res.writeHead(201).end(png);
  });
  assert.equal(EMOTION_MOODS.length, 24);
  assert.equal(new Set(EMOTION_MOODS).size, 24);
  for (const mood of ['laughing', 'irritated', 'worried', 'love', 'hurt', 'playful']) {
    assert.ok(EMOTION_MOODS.includes(mood), `missing official emotion: ${mood}`);
  }
  for (const invalid of ['amused', 'annoyed', 'proud', 'panicked', 'crying', 'relieved']) {
    assert.ok(!EMOTION_MOODS.includes(invalid), `unexpected invalid emotion: ${invalid}`);
  }
  assert.equal(AUGMENT_REQ_TYPES.length, 8);
  for (const req_type of AUGMENT_REQ_TYPES) {
    const images = await client.augmentImage({ image, req_type, width: 64, height: 64, emotion: 'happy', prompt: 'blue eyes', defry: 4 });
    const { url, method, body } = requests.at(-1);
    assert.equal(method, 'POST');
    assert.equal(url.pathname, '/ai/augment-image');
    assert.equal(body.image, image);
    assert.equal(body.req_type, req_type);
    assert.equal(body.width, 64);
    assert.equal(body.height, 64);
    assert.equal('defry' in body, req_type === 'emotion' || req_type === 'colorize');
    if (req_type === 'emotion') assert.equal(body.prompt, 'happy;;blue eyes');
    if (req_type === 'colorize') assert.equal(body.prompt, 'blue eyes');
    assert.equal(images.length, req_type === 'bg-removal' ? 3 : 1);
  }
  await assert.rejects(client.augmentImage({ image, req_type: 'emotion', width: 64, height: 64, emotion: 'bogus' }), /情绪|emotion/);
  await assert.rejects(client.augmentImage({ image, req_type: 'emotion', width: 64, height: 64 }), /情绪|emotion/);
  assert.equal(requests.length, 8);
});

test('放大、氛围编码、标签搜索及订阅使用同一服务地址', async (t) => {
  const rawSubscription = {
    tier: 3, active: true, expiresAt: 1796180400,
    trainingStepsLeft: { fixedTrainingStepsLeft: 500, purchasedTrainingSteps: 26 },
    usage: { percent: 31.5, isNegative: false, timeUntilNextPercent: 168 },
  };
  const tags = [{ tag: '秋', jp_tag: '秋', count: 107, confidence: 0.99 }];
  const vibe = Buffer.from([1, 0x9c, 0, 0x55]);
  const { client, requests } = await mockNovelAI(t, ({ url }, res) => {
    switch (url.pathname) {
      case '/ai/upscale': res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ images: [{ image, seed: 5 }] })); break;
      case '/ai/encode-vibe': res.writeHead(201, { 'Content-Type': 'application/octet-stream' }).end(vibe); break;
      case '/ai/generate-image/suggest-tags': res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(JSON.stringify({ tags })); break;
      case '/user/subscription': res.writeHead(200).end(JSON.stringify(rawSubscription)); break;
      default: res.writeHead(404).end();
    }
  });
  const upscaled = await client.upscaleImage({ image, declared_blur_sigma: 0 });
  assert.equal(upscaled[0].seed, 5);
  assert.deepEqual(requests[0].body, { image, model: 'nai-diffusion-5-full', declared_blur_sigma: 0 });
  assert.equal(requests[0].method, 'POST');
  const encoded = await client.encodeVibe({ image, mask: image, crop_to_mask: false, information_extracted: 0.4, model: 'nai-diffusion-4-5-curated' });
  assert.equal(encoded, vibe.toString('base64'));
  assert.deepEqual(requests[1].body, { image, mask: image, crop_to_mask: false, information_extracted: 0.4, model: 'nai-diffusion-4-5-curated' });
  assert.equal(requests[1].method, 'POST');
  await assert.rejects(client.encodeVibe({ image, model: 'nai-diffusion-5-full' }), /编码|encode-vibe/);

  assert.deepEqual(await client.suggestTags({ prompt: '秋 & 黄', model: 'nai-diffusion-5-full', lang: 'jp' }), { tags });
  assert.equal(requests[2].method, 'GET');
  assert.equal(requests[2].body, undefined);
  assert.deepEqual(Object.fromEntries(requests[2].url.searchParams), { model: 'nai-diffusion-5-full', prompt: '秋 & 黄', lang: 'jp' });

  const subscription = await client.getSubscription();
  assert.equal(requests[3].method, 'GET');
  assert.deepEqual(subscription.raw, rawSubscription);
  assert.deepEqual(subscription.summary, {
    tier: 3, tierName: 'Opus', active: true, expiresAt: new Date(rawSubscription.expiresAt * 1000).toISOString(),
    fixedAnlas: 500, purchasedAnlas: 26, totalAnlas: 526, v5Usage: rawSubscription.usage,
  });
});

test('上游超时和错误只返回安全诊断，不自动重试', async (t) => {
  const { baseUrl, client, requests } = await mockNovelAI(t, ({ url }, res) => {
    if (url.pathname === '/ai/generate-image') {
      res.writeHead(402).end('sensitive upstream response reflected password');
      return;
    }
    res.writeHead(200).write('{');
  });
  await assert.rejects(client.generateImage({ prompt: 'clouds' }), (error) => {
    assert.match(error.message, /402/);
    assert.doesNotMatch(error.message, /password|test-key/);
    return true;
  });
  const shortClient = new NovelAIClient('test-key', { baseUrl, timeoutMs: 1000 });
  await assert.rejects(shortClient.getSubscription(), /超时/);
  assert.equal(requests.length, 2);
});
