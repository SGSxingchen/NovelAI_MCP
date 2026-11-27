import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import sharp from 'sharp';
import { createNovelAIMcpServer } from '../dist/mcp-tools.js';

async function connectTools(t, disclosureMode = 'legacy') {
  const client = new Client({ name: 'prompt-craft-test', version: '1.0.0' });
  const server = createNovelAIMcpServer({ client: {}, disclosureMode });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return (action, params = {}) => client.callTool(disclosureMode === 'legacy'
    ? { name: action, arguments: params }
    : { name: 'nai_execute', arguments: { action, params } });
}

test('probe_image 实测 BT.709 明度三档、饱和方向、16×11 色板、局部 patch 与二十问清单', async t => {
  const invoke = await connectTools(t, 'progressive');
  // 构造上半暗色、下半高饱和亮红色的测试图
  const width = 128;
  const height = 192;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      if (y < height * 0.65) {
        raw[idx] = 18;
        raw[idx + 1] = 22;
        raw[idx + 2] = 30;
      } else {
        raw[idx] = 235;
        raw[idx + 1] = 45;
        raw[idx + 2] = 35;
      }
    }
  }
  const imgBuf = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const dataUri = `data:image/png;base64,${imgBuf.toString('base64')}`;

  const res = await invoke('probe_image', {
    source_image: dataUri,
    include_forensic_sop: true,
    patches: [
      { name: 'upper_dark', x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.4 },
      { name: 'lower_accent', x0: 0.1, y0: 0.7, x1: 0.9, y1: 0.95 },
    ],
  });
  assert.equal(res.isError, undefined, res.content[0]?.text);
  const parsed = JSON.parse(res.content[1].text);
  assert.equal(parsed.width, 128);
  assert.equal(parsed.height, 192);
  assert.deepEqual(parsed.recommended_nai_size, { width: 832, height: 1216 });
  assert.equal(parsed.dominant_band, 'dark');
  assert.equal(parsed.saturation_bias, 'lit_richer');
  assert.equal(parsed.grid_6x6.length, 6);
  assert.equal(parsed.hex_16x11.length, 11);
  assert.equal(parsed.forensic_20_questions.length, 20);
  assert.equal(parsed.patches.length, 2);
  assert.ok(parsed.patches[0].lum < 0.15);
  assert.ok(parsed.patches[1].sat > 0.7);
});

test('verify_image 对比参考图与出图，精准识别主导明度反转、过曝烧白与饱和方向反转', async t => {
  const invoke = await connectTools(t, 'legacy');
  const refBuf = await sharp({
    create: { width: 96, height: 96, channels: 3, background: '#141a24' },
  }).png().toBuffer();
  const outBuf = await sharp({
    create: { width: 96, height: 96, channels: 3, background: '#fcfcfc' },
  }).png().toBuffer();

  const res = await invoke('verify_image', {
    reference_image: `data:image/png;base64,${refBuf.toString('base64')}`,
    output_image: `data:image/png;base64,${outBuf.toString('base64')}`,
  });
  assert.equal(res.isError, undefined, res.content[0]?.text);
  const parsed = JSON.parse(res.content[1].text);
  assert.equal(parsed.passed, false);
  assert.ok(parsed.severe_count >= 1);
  assert.ok(parsed.diagnoses.some(d => d.metric === 'dominant_band' && d.severity === 'severe'));
  assert.ok(parsed.diagnoses.some(d => d.metric === 'nw'));
});

test('lint_prompt 执行纯 NAI 十三道关：放行 NAI 质量词与画师串，拦截未闭合权重壳、预设冲撞与正向 no halo 欲盖弥彰', async t => {
  const invoke = await connectTools(t, 'progressive');

  // 1. 合格的 NAI V5 提示词（含质量词、画师串、闭合权重、光影构图、副手闭环、三分位坐标）
  const cleanRes = await invoke('lint_prompt', {
    base_prompt: 'masterpiece, best quality, very aesthetic, 1.15::omutatsu::, 0.7::mochizuki kei::, 1girl, solo, cowboy_shot, from_side, sidelighting, chiaroscuro, colored_shadow, negative_space, holding sword, slashing. She pauses mid-motion in the rain as wet petals cling to the stone floor, her left hand pulled tight at her hip in a clenched counterbalance fist; sidelighting cuts like a blade across her silver hairpin with the brightest specular glint stopping one step short of blowing out while the background falls three stops under.',
    base_negative_prompt: 'lowres, bad anatomy, -2::halo, head halo::',
    characters: [{ prompt: 'silver hair, crimson eyes, black coat', center_x: 0.33, center_y: 0.5 }],
    quality_preset: 'none',
    uc_preset: 'light',
  });
  assert.equal(cleanRes.isError, undefined, cleanRes.content[0]?.text);
  const clean = JSON.parse(cleanRes.content[1].text);
  assert.equal(clean.passed, true, clean.summary_text);
  assert.equal(clean.fail_count, 0);

  // 2. 含未闭合权重壳、漂白词、正向 no halo 欲盖弥彰、单手持剑缺副手、Heavy UC 吞网点
  const badRes = await invoke('lint_prompt', {
    base_prompt: '1.3::halftone, high key, low key, overexposed, pure white, beautiful lighting, full_body, from_below, foreshortening, 1girl, angel, feathered wings, no halo, nothing hovering above her head, holding sword, slashing at enemy',
    uc_preset: 'heavy',
    characters: [{ prompt: 'pink hair, white dress', center_x: 0.5, center_y: 0.5 }],
  });
  assert.equal(badRes.isError, undefined);
  const bad = JSON.parse(badRes.content[1].text);
  assert.equal(bad.passed, false);
  assert.ok(bad.fail_count >= 3);
  const gateByNum = new Map(bad.gates.map(g => [g.gate, g]));
  assert.equal(gateByNum.get(1).status, 'FAIL'); // 未闭合 ::
  assert.equal(gateByNum.get(3).status, 'FAIL'); // high key + low key 矛盾
  assert.equal(gateByNum.get(5).status, 'WARN'); // beautiful lighting + heavy UC 吞 halftone
  assert.equal(gateByNum.get(8).status, 'FAIL'); // overexposed / pure white 漂白
  assert.equal(gateByNum.get(10).status, 'WARN'); // center_x 0.5 居中死区
  assert.equal(gateByNum.get(11).status, 'WARN'); // angel + no halo 正向欲盖弥彰
  assert.equal(gateByNum.get(12).status, 'WARN'); // 单手挥剑未锁死副手
});

test('search_nai_lexicon 离线检索 10 部 NAI 社区法典：中英模糊、精确、64 条场景串、解构负向与 NSFW 过滤', async t => {
  const invoke = await connectTools(t, 'progressive');

  const statsRes = await invoke('search_nai_lexicon', { mode: 'stats' });
  assert.equal(statsRes.isError, undefined, statsRes.content[0]?.text);
  const stats = JSON.parse(statsRes.content[0].text);
  assert.ok(stats.total_indexed >= 28000);
  assert.equal(stats.codexes.length, 10);

  const fuzzyRes = await invoke('search_nai_lexicon', { query: '逆光', limit: 5 });
  const fuzzy = JSON.parse(fuzzyRes.content[0].text);
  assert.ok(fuzzy.matched_count > 0);
  assert.ok(fuzzy.items.some(item => /backlighting/i.test(item.tags) || /逆光/.test(item.title_zh)));

  const scenesRes = await invoke('search_nai_lexicon', { mode: 'scenes', limit: 10 });
  const scenes = JSON.parse(scenesRes.content[0].text);
  assert.equal(scenes.matched_count, 64);
  assert.ok(scenes.items[0].tags.includes('::'));

  const negRes = await invoke('search_nai_lexicon', { mode: 'negatives', codex: 'jiegou', limit: 5 });
  const neg = JSON.parse(negRes.content[0].text);
  assert.ok(neg.matched_count > 0);
  assert.ok(neg.items[0].negative_prompt);

  const safeStatsRes = await invoke('search_nai_lexicon', { mode: 'stats', include_nsfw: false });
  const safeStats = JSON.parse(safeStatsRes.content[0].text);
  assert.ok(safeStats.codexes.every(c => !c.nsfw && !c.id.endsWith('_r18')));
});

test('get_v5_stylist_guide 支持新增的 seven_dimensions、tag_budget、advanced_engineering 与 reverse_and_audit 章节', async t => {
  const invoke = await connectTools(t, 'legacy');
  for (const topic of ['seven_dimensions', 'tag_budget', 'advanced_engineering', 'reverse_and_audit']) {
    const res = await invoke('get_v5_stylist_guide', { topic });
    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.length > 200);
  }
});
