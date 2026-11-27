import sharp from 'sharp';
import { extractPngTextMetadata, getImageDimensions } from './image-input.js';

export const PROMPT_LINT_INTENTS = [
  'blown',
  'leak',
  'tilt',
  'soft',
  'flat_poster',
  'monochrome',
  'halo',
] as const;
export type PromptLintIntent = (typeof PROMPT_LINT_INTENTS)[number];

export const FORENSIC_20_QUESTIONS = [
  '1. 画面中任何位置看得到脸吗？（先答是/否，再标出其在画幅中的比例位置；若无脸，提示词必须写死 from_behind / face out of frame / silhouette）',
  '2. 共有几个可辨认的人形角色？（仅统计至少看得到头部或躯干的角色）',
  '3. 每个角色的两只手分别在哪里、做什么动作、握着什么？（看不清必须列为不确定并写低粒度）',
  '4. 四肢各自处于什么位置？如有肢体被遮挡，写明被什么物体遮挡。',
  '5. 共有几件武器或手持道具？各自是刀身、刀鞘还是其他器物？',
  '6. 画面中有几处独立的火光、光源或发光体？各自在画内还是画外什么方位？',
  '7. 画框是水平的还是倾斜的？估算倾斜角度（度）并指出判断依据（门框/栏杆/地平线）。',
  '8. 能否看到地面、地板或地平线？若看不到，明确记为无地面。',
  '9. 列出所有带有动态拖影或模糊的表面及其拖尾方向。',
  '10. 全图最暗的单一物体是什么？最亮的单一高光落在什么具体材质上？',
  '11. 列出能叫出名字的色相，并估算每个色相占画幅的面积分数。',
  '12. 画面的主导物理媒介感是什么（水彩纸纹、赛璐璐、网点印刷、平涂色块、厚涂画布）？',
  '13. 画面中是否有可读文字？逐字转录并标明位置与层级（背景墙体字 vs 前景标题）。',
  '14. 是否有胶片颗粒、纸张肌理或半调网点（halftone/screentone）？颗粒粗细约几个像素？',
  '15. 左上角是什么内容？右下角是什么内容？（检查是否有大块留白 negative_space）',
  '16. 按「A 遮挡 B」的格式列出前景、中景、远景的核心遮挡关系链。',
  '17. 能数出几个明确的景深层次？哪一层是唯一实焦（sharp focus）？',
  '18. 画面中最小的可辨认物件是什么？大约几像素宽？',
  '19. 只用身体部位的几何相对位置，用一句话描述主角色姿态（不准用优雅/动感等形容词）。',
  '20. 第一眼扫过去最容易被误读的地方是哪里？为什么？',
] as const;

export interface ProbePatchInput {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ProbePatchResult {
  name: string;
  rgb: [number, number, number];
  sat: number;
  lum: number;
  hex: string;
}

export interface ProbeImageOptions {
  patches?: ProbePatchInput[];
  include_forensic_sop?: boolean;
  long_side?: number;
}

export interface GridCellInfo {
  row: number;
  col: number;
  value: number;
  position_en: string;
}

export interface ProbeImageResult {
  width: number;
  height: number;
  format: string;
  recommended_nai_size: { width: number; height: number };
  mean: number;
  med: number;
  dark: number;
  mid: number;
  bright: number;
  nw: number;
  p1: number;
  p99: number;
  dominant_band: 'dark' | 'mid' | 'bright';
  rgb: [number, number, number];
  sat: number;
  lit: number;
  shadow: number;
  saturation_bias: 'lit_richer' | 'shadow_richer' | 'balanced';
  soft: number;
  strong: number;
  flat: number;
  hue: number;
  grid_6x6: number[][];
  brightest_cell: GridCellInfo;
  darkest_cell: GridCellInfo;
  hex_16x11: string[];
  dominant_hex_palette: { hex: string; ratio: number }[];
  patches?: ProbePatchResult[];
  embedded_nai_prompt?: {
    prompt?: string;
    negative_prompt?: string;
    seed?: number;
    steps?: number;
    scale?: number;
    sampler?: string;
    model?: string;
    character_prompts?: string[];
  };
  nai_prompt_guidance: string[];
  forensic_20_questions?: readonly string[];
  summary_text: string;
}

export interface VerifyDiagnosis {
  severity: 'severe' | 'moderate' | 'minor';
  metric: string;
  message: string;
  nai_fix: string;
}

export interface VerifyImageResult {
  passed: boolean;
  severe_count: number;
  reference: Omit<ProbeImageResult, 'summary_text' | 'nai_prompt_guidance' | 'forensic_20_questions'>;
  output: Omit<ProbeImageResult, 'summary_text' | 'nai_prompt_guidance' | 'forensic_20_questions'>;
  deltas: Record<string, number>;
  grid_diff_6x6: number[][];
  diagnoses: VerifyDiagnosis[];
  summary_text: string;
}

export interface LintNaiPromptInput {
  base_prompt: string;
  base_negative_prompt?: string;
  characters?: { prompt: string; negative_prompt?: string; center_x?: number; center_y?: number }[];
  model?: string;
  width?: number;
  height?: number;
  scale?: number;
  quality_preset?: 'standard' | 'light' | 'none';
  uc_preset?: 'heavy' | 'light' | 'furry' | 'human' | 'none';
  intents?: PromptLintIntent[];
}

export interface LintGateIssue {
  level: 'WARN' | 'FAIL';
  message: string;
  fix: string;
}

export interface LintGateResult {
  gate: number;
  name: string;
  status: 'ok' | 'WARN' | 'FAIL';
  issues: LintGateIssue[];
}

export interface LintNaiPromptResult {
  passed: boolean;
  fail_count: number;
  warn_count: number;
  metrics: {
    tag_count: number;
    weighted_tag_count: number;
    weighted_ratio: number;
    estimated_tokens: number;
    natural_sentence_count: number;
    character_slot_count: number;
  };
  gates: LintGateResult[];
  summary_text: string;
}

const STANDARD_NAI_SIZES = [
  { width: 832, height: 1216 },
  { width: 1216, height: 832 },
  { width: 1024, height: 1024 },
  { width: 704, height: 1408 },
  { width: 1408, height: 704 },
  { width: 640, height: 1536 },
  { width: 1536, height: 640 },
] as const;

const ROW_NAMES = ['upper', 'upper', 'upper middle', 'lower middle', 'lower', 'lower'] as const;
const COL_NAMES = ['left', 'left', 'left of centre', 'right of centre', 'right', 'right'] as const;

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function recommendNaiSize(width: number, height: number): { width: number; height: number } {
  const ratio = width / Math.max(1, height);
  return STANDARD_NAI_SIZES.reduce((best, candidate) => {
    const bestDiff = Math.abs(Math.log(ratio) - Math.log(best.width / best.height));
    const candDiff = Math.abs(Math.log(ratio) - Math.log(candidate.width / candidate.height));
    return candDiff < bestDiff ? candidate : best;
  });
}

function parseEmbeddedNaiMetadata(buffer: Buffer): ProbeImageResult['embedded_nai_prompt'] | undefined {
  const meta = extractPngTextMetadata(buffer);
  if (!meta || Object.keys(meta).length === 0) return undefined;
  const comment = meta.Comment && typeof meta.Comment === 'object' ? (meta.Comment as Record<string, unknown>) : undefined;
  const description = typeof meta.Description === 'string' ? meta.Description : undefined;
  const software = typeof meta.Software === 'string' ? meta.Software : typeof meta.Source === 'string' ? meta.Source : undefined;

  const v4Prompt = comment?.v4_prompt && typeof comment.v4_prompt === 'object'
    ? (comment.v4_prompt as { caption?: { base_caption?: string; char_captions?: { char_caption?: string }[] } })
    : undefined;
  const baseCaption = v4Prompt?.caption?.base_caption;
  const charCaptions = v4Prompt?.caption?.char_captions
    ?.map(item => item?.char_caption?.trim())
    .filter((item): item is string => Boolean(item));

  const prompt = typeof comment?.prompt === 'string' ? comment.prompt : baseCaption ?? description;
  const negative_prompt = typeof comment?.uc === 'string' ? comment.uc : undefined;
  if (!prompt && !negative_prompt && !comment?.seed) return undefined;

  return {
    ...(prompt ? { prompt } : {}),
    ...(negative_prompt ? { negative_prompt } : {}),
    ...(typeof comment?.seed === 'number' ? { seed: comment.seed } : {}),
    ...(typeof comment?.steps === 'number' ? { steps: comment.steps } : {}),
    ...(typeof comment?.scale === 'number' ? { scale: comment.scale } : {}),
    ...(typeof comment?.sampler === 'string' ? { sampler: comment.sampler } : {}),
    ...(software ? { model: software } : {}),
    ...(charCaptions && charCaptions.length > 0 ? { character_prompts: charCaptions } : {}),
  };
}

function percentileFromSorted(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function computeHueDegrees(r: number, g: number, b: number, max: number, min: number): number {
  const d = max - min;
  if (d <= 1e-6) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function buildNaiGuidance(metrics: {
  dominant_band: 'dark' | 'mid' | 'bright';
  mean: number;
  dark: number;
  mid: number;
  bright: number;
  nw: number;
  p1: number;
  p99: number;
  sat: number;
  lit: number;
  shadow: number;
  saturation_bias: 'lit_richer' | 'shadow_richer' | 'balanced';
  strong: number;
  flat: number;
  brightest_cell: GridCellInfo;
  dominant_hex_palette: { hex: string; ratio: number }[];
}): string[] {
  const tips: string[] = [];
  if (metrics.dominant_band === 'dark') {
    tips.push(
      `明度定调：暗调（Low Key）主导（暗部占 ${(metrics.dark * 100).toFixed(1)}%，mean=${metrics.mean}）。在 base_prompt 首段使用 low key, dark background, chiaroscuro，并在结尾自然语言写明单主光一臂衰减（light dies within arm's reach, background falls three stops under）与唯一实体高光锚点。`,
    );
  } else if (metrics.dominant_band === 'bright') {
    tips.push(
      `明度定调：高调（High Key）主导（亮部占 ${(metrics.bright * 100).toFixed(1)}%，mean=${metrics.mean}）。使用 high key, bright background，并按 G4 铁律点名 2–3 处接近黑的小面积暗锚（如瞳孔、发夹或领结 the darkest notes in the frame），防止画面发飘。`,
    );
  } else {
    tips.push(
      `明度定调：中调（Mid-tone）主导（中调占 ${(metrics.mid * 100).toFixed(1)}%，mean=${metrics.mean}）。将主体置于中调，明确区分受光面（最高亮格位于 ${metrics.brightest_cell.position_en}）与背光面（低 2–3 档），遵循「阴影最亮处暗于亮部最暗处」。`,
    );
  }

  if (metrics.saturation_bias === 'lit_richer') {
    tips.push(
      `色彩落点（G9 亮部更浓）：亮部饱和度（${metrics.lit}）高于暗部（${metrics.shadow}）。将主色相词直接挂在被照亮的最大面积表面上，暗部收敛为偏冷灰蓝或中性暗色。`,
    );
  } else if (metrics.saturation_bias === 'shadow_richer') {
    tips.push(
      `色彩落点（暗部藏色）：暗部饱和度（${metrics.shadow}）高于亮部（${metrics.lit}）。在 NAI 提示词中加入 colored_shadow, hue_shifting，让受光面偏清淡（pale light）而把浓郁色彩压在阴影与衣褶深处。`,
    );
  } else {
    tips.push(
      `色彩预算：整体平均饱和度 sat=${metrics.sat}。${metrics.sat < 0.14 ? '属于低饱和克制色板，建议使用 muted_colors, limited_palette，只保留 1 个焦点色相。' : '建议按 60/30/8/2 分配环境色、主体固有色与唯一高饱和点缀色（≤10%）。'}`,
    );
  }

  if (metrics.flat > 0.55) {
    tips.push(
      `边缘与质感：平坦区占比高（flat=${metrics.flat}, strong=${metrics.strong}）。若为平涂/海报风，使用 flat color, limited palette 并设 quality_preset: "none"；若为柔光氛围，使用 bloom, atmospheric_perspective, soft lighting 并把 scale 调至 3.8–4.8。`,
    );
  } else if (metrics.flat < 0.35 || metrics.strong > 0.16) {
    tips.push(
      `边缘与质感：硬边与高细节密度显著（strong=${metrics.strong}, flat=${metrics.flat}）。硬光需显式写 each shadow edge is cut like a blade, with no gradient at all，配合 bold outline / lineart 与 scale 5.0–6.2。`,
    );
  }

  if (metrics.nw < 0.01) {
    tips.push(
      `高光边界：全图近白占比仅 ${(metrics.nw * 100).toFixed(2)}%（p99=${metrics.p99}），无纯白过曝区。严禁写 pure white / overexposed，高光处应写 off-white, stopping one step short of blowing out。`,
    );
  }
  if (metrics.p1 > 0.13) {
    tips.push(
      `暗部边界：最暗 1% 分位 p1=${metrics.p1}（全图无死黑）。避免写 pitch black / pure black，暗部应写为带色相的深灰蓝或暖褐阴影。`,
    );
  }

  if (metrics.dominant_hex_palette.length > 0) {
    const topColors = metrics.dominant_hex_palette
      .slice(0, 4)
      .map(c => `${c.hex} (${Math.round(c.ratio * 100)}%)`)
      .join('、');
    tips.push(`实测主色 HEX：${topColors}。反推色彩时请使用「基础色名 + 具象参照物 + 面积占比」替代笼统色名。`);
  }

  return tips;
}

export async function probeImage(buffer: Buffer, options: ProbeImageOptions = {}): Promise<ProbeImageResult> {
  const { width, height, format } = await getImageDimensions(buffer);
  const longSide = options.long_side ?? 760;
  const scale = Math.max(width, height) > longSide ? longSide / Math.max(width, height) : 1;
  const sampleW = Math.max(6, Math.round(width * scale));
  const sampleH = Math.max(6, Math.round(height * scale));

  const { data: raw } = await sharp(buffer)
    .rotate()
    .resize(sampleW, sampleH, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const totalPixels = sampleW * sampleH;
  const lum = new Float32Array(totalPixels);
  const sat = new Float32Array(totalPixels);
  const hueBuckets = new Int32Array(12);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLum = 0;
  let sumSat = 0;
  let darkCount = 0;
  let midCount = 0;
  let brightCount = 0;
  let nwCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const r = raw[i * 3] / 255;
    const g = raw[i * 3 + 1] / 255;
    const b = raw[i * 3 + 2] / 255;
    sumR += r;
    sumG += g;
    sumB += b;

    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = l;
    sumLum += l;

    if (l < 0.15) darkCount++;
    else if (l <= 0.75) midCount++;
    else brightCount++;
    if (l > 0.95) nwCount++;

    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const s = mx > 0 ? (mx - mn) / Math.max(mx, 1e-6) : 0;
    sat[i] = s;
    sumSat += s;

    if (s > 40 / 255 && l > 26 / 255 && l < 230 / 255) {
      const hDeg = computeHueDegrees(r, g, b, mx, mn);
      const bucket = Math.min(11, Math.floor(hDeg / 30));
      hueBuckets[bucket]++;
    }
  }

  const sortedLum = Float32Array.from(lum).sort();
  const med = round(percentileFromSorted(sortedLum, 0.5));
  const p1 = round(percentileFromSorted(sortedLum, 0.01));
  const p99 = round(percentileFromSorted(sortedLum, 0.99));
  const p80 = percentileFromSorted(sortedLum, 0.8);
  const p25 = percentileFromSorted(sortedLum, 0.25);

  let litSatSum = 0;
  let litSatCount = 0;
  let shadSatSum = 0;
  let shadSatCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (lum[i] >= p80) {
      litSatSum += sat[i];
      litSatCount++;
    }
    if (lum[i] <= p25) {
      shadSatSum += sat[i];
      shadSatCount++;
    }
  }

  const lit = round(litSatCount > 0 ? litSatSum / litSatCount : 0);
  const shadow = round(shadSatCount > 0 ? shadSatSum / shadSatCount : 0);
  const saturation_bias: ProbeImageResult['saturation_bias'] = lit > shadow + 0.02
    ? 'lit_richer'
    : shadow > lit + 0.02
      ? 'shadow_richer'
      : 'balanced';

  // NumPy-compatible 2D gradient: central difference inside, 1st-order difference at borders
  let strongCount = 0;
  let flatCount = 0;
  for (let y = 0; y < sampleH; y++) {
    const yPrev = y > 0 ? y - 1 : 0;
    const yNext = y < sampleH - 1 ? y + 1 : sampleH - 1;
    const yDenom = y > 0 && y < sampleH - 1 ? 2 : 1;
    for (let x = 0; x < sampleW; x++) {
      const xPrev = x > 0 ? x - 1 : 0;
      const xNext = x < sampleW - 1 ? x + 1 : sampleW - 1;
      const xDenom = x > 0 && x < sampleW - 1 ? 2 : 1;

      const gx = (lum[y * sampleW + xNext] - lum[y * sampleW + xPrev]) / xDenom;
      const gy = (lum[yNext * sampleW + x] - lum[yPrev * sampleW + x]) / yDenom;
      const gm = Math.hypot(gx, gy);
      if (gm > 0.08) strongCount++;
      if (gm < 0.02) flatCount++;
    }
  }

  const strong = round(strongCount / totalPixels);
  const soft = round(1 - strong);
  const flat = round(flatCount / totalPixels);

  // 6x6 grid
  const grid_6x6: number[][] = [];
  let brightest_cell: GridCellInfo = { row: 1, col: 1, value: -1, position_en: 'upper left' };
  let darkest_cell: GridCellInfo = { row: 1, col: 1, value: 2, position_en: 'upper left' };

  for (let gy = 0; gy < 6; gy++) {
    const y0 = Math.floor((gy * sampleH) / 6);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * sampleH) / 6));
    const rowValues: number[] = [];
    for (let gx = 0; gx < 6; gx++) {
      const x0 = Math.floor((gx * sampleW) / 6);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * sampleW) / 6));
      let cellSum = 0;
      let cellCount = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          cellSum += lum[y * sampleW + x];
          cellCount++;
        }
      }
      const cellMean = round(cellCount > 0 ? cellSum / cellCount : 0, 2);
      rowValues.push(cellMean);
      const position_en = `${ROW_NAMES[gy]} ${COL_NAMES[gx]}`;
      if (cellMean > brightest_cell.value) {
        brightest_cell = { row: gy + 1, col: gx + 1, value: cellMean, position_en };
      }
      if (cellMean < darkest_cell.value) {
        darkest_cell = { row: gy + 1, col: gx + 1, value: cellMean, position_en };
      }
    }
    grid_6x6.push(rowValues);
  }

  // 16x11 hex grid & dominant palette
  const hexCols = 16;
  const hexRows = 11;
  const hex_16x11: string[] = [];
  const colorClusters: { r: number; g: number; b: number; count: number }[] = [];

  for (let hy = 0; hy < hexRows; hy++) {
    const y0 = Math.floor((hy * sampleH) / hexRows);
    const y1 = Math.max(y0 + 1, Math.floor(((hy + 1) * sampleH) / hexRows));
    const rowHexes: string[] = [];
    for (let hx = 0; hx < hexCols; hx++) {
      const x0 = Math.floor((hx * sampleW) / hexCols);
      const x1 = Math.max(x0 + 1, Math.floor(((hx + 1) * sampleW) / hexCols));
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * sampleW + x) * 3;
          cr += raw[idx];
          cg += raw[idx + 1];
          cb += raw[idx + 2];
          cnt++;
        }
      }
      const mr = Math.round(cr / Math.max(1, cnt));
      const mg = Math.round(cg / Math.max(1, cnt));
      const mb = Math.round(cb / Math.max(1, cnt));
      const hex = toHex(mr, mg, mb).slice(1);
      rowHexes.push(hex);

      const existing = colorClusters.find(c => Math.hypot(c.r - mr, c.g - mg, c.b - mb) < 32);
      if (existing) {
        const nextCount = existing.count + 1;
        existing.r = (existing.r * existing.count + mr) / nextCount;
        existing.g = (existing.g * existing.count + mg) / nextCount;
        existing.b = (existing.b * existing.count + mb) / nextCount;
        existing.count = nextCount;
      } else {
        colorClusters.push({ r: mr, g: mg, b: mb, count: 1 });
      }
    }
    hex_16x11.push(rowHexes.join(' '));
  }

  const totalCells = hexCols * hexRows;
  const dominant_hex_palette = colorClusters
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(c => ({ hex: toHex(c.r, c.g, c.b), ratio: round(c.count / totalCells, 3) }));

  // Hue mode
  let maxHueCount = 0;
  let hue = -1;
  for (let b = 0; b < 12; b++) {
    if (hueBuckets[b] > maxHueCount) {
      maxHueCount = hueBuckets[b];
      hue = b * 30;
    }
  }

  // Patches
  let patches: ProbePatchResult[] | undefined;
  if (options.patches && options.patches.length > 0) {
    patches = options.patches.map(patch => {
      const x0 = Math.max(0, Math.min(sampleW - 1, Math.floor(patch.x0 * sampleW)));
      const y0 = Math.max(0, Math.min(sampleH - 1, Math.floor(patch.y0 * sampleH)));
      const x1 = Math.max(x0 + 1, Math.min(sampleW, Math.ceil(patch.x1 * sampleW)));
      const y1 = Math.max(y0 + 1, Math.min(sampleH, Math.ceil(patch.y1 * sampleH)));
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let psat = 0;
      let plum = 0;
      let pcnt = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * sampleW + x;
          pr += raw[i * 3] / 255;
          pg += raw[i * 3 + 1] / 255;
          pb += raw[i * 3 + 2] / 255;
          psat += sat[i];
          plum += lum[i];
          pcnt++;
        }
      }
      const mr = pr / Math.max(1, pcnt);
      const mg = pg / Math.max(1, pcnt);
      const mb = pb / Math.max(1, pcnt);
      return {
        name: patch.name,
        rgb: [round(mr, 2), round(mg, 2), round(mb, 2)],
        sat: round(psat / Math.max(1, pcnt), 2),
        lum: round(plum / Math.max(1, pcnt), 2),
        hex: toHex(mr * 255, mg * 255, mb * 255),
      };
    });
  }

  const mean = round(sumLum / totalPixels);
  const dark = round(darkCount / totalPixels);
  const mid = round(midCount / totalPixels);
  const bright = round(brightCount / totalPixels);
  const nw = round(nwCount / totalPixels, 4);
  const satMean = round(sumSat / totalPixels);
  const rgb: [number, number, number] = [
    round(sumR / totalPixels),
    round(sumG / totalPixels),
    round(sumB / totalPixels),
  ];

  const dominant_band: ProbeImageResult['dominant_band'] = dark >= mid && dark >= bright
    ? 'dark'
    : bright >= mid && bright >= dark
      ? 'bright'
      : 'mid';

  const recommended_nai_size = recommendNaiSize(width, height);
  const embedded_nai_prompt = parseEmbeddedNaiMetadata(buffer);
  const nai_prompt_guidance = buildNaiGuidance({
    dominant_band,
    mean,
    dark,
    mid,
    bright,
    nw,
    p1,
    p99,
    sat: satMean,
    lit,
    shadow,
    saturation_bias,
    strong,
    flat,
    brightest_cell,
    dominant_hex_palette,
  });

  const summaryLines = [
    `尺寸：${width}×${height} (${format}) · 推荐 NAI 画幅：${recommended_nai_size.width}×${recommended_nai_size.height}`,
    `明度（BT.709）：主导档=${dominant_band} | mean=${mean} med=${med} | dark=${dark} mid=${mid} bright=${bright} | nw=${nw} p1=${p1} p99=${p99}`,
    `色彩与梯度：sat=${satMean} (lit=${lit} vs shadow=${shadow} -> ${saturation_bias}) | strong=${strong} soft=${soft} flat=${flat} | 主色相=${hue >= 0 ? `${hue}°` : '无明显色相'}`,
    `最亮格：第 ${brightest_cell.row} 行第 ${brightest_cell.col} 列 (${brightest_cell.position_en}, ${brightest_cell.value}) | 最暗格：第 ${darkest_cell.row} 行第 ${darkest_cell.col} 列 (${darkest_cell.position_en}, ${darkest_cell.value})`,
    `主色板：${dominant_hex_palette.map(c => `${c.hex}(${Math.round(c.ratio * 100)}%)`).join(' ')}`,
    ...nai_prompt_guidance.map(tip => `- ${tip}`),
  ];

  return {
    width,
    height,
    format,
    recommended_nai_size,
    mean,
    med,
    dark,
    mid,
    bright,
    nw,
    p1,
    p99,
    dominant_band,
    rgb,
    sat: satMean,
    lit,
    shadow,
    saturation_bias,
    soft,
    strong,
    flat,
    hue,
    grid_6x6,
    brightest_cell,
    darkest_cell,
    hex_16x11,
    dominant_hex_palette,
    ...(patches ? { patches } : {}),
    ...(embedded_nai_prompt ? { embedded_nai_prompt } : {}),
    nai_prompt_guidance,
    ...(options.include_forensic_sop ? { forensic_20_questions: FORENSIC_20_QUESTIONS } : {}),
    summary_text: summaryLines.join('\n'),
  };
}

function circularHueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export async function verifyImage(refBuffer: Buffer, outBuffer: Buffer): Promise<VerifyImageResult> {
  const [refFull, outFull] = await Promise.all([probeImage(refBuffer), probeImage(outBuffer)]);
  const { summary_text: _rs, nai_prompt_guidance: _rg, forensic_20_questions: _rf, ...reference } = refFull;
  const { summary_text: _os, nai_prompt_guidance: _og, forensic_20_questions: _of, ...output } = outFull;

  const metricKeys = [
    'mean', 'med', 'dark', 'mid', 'bright', 'nw', 'p1', 'p99', 'sat', 'lit', 'shadow', 'soft', 'strong', 'flat',
  ] as const;
  const deltas: Record<string, number> = {};
  for (const key of metricKeys) {
    deltas[key] = round(output[key] - reference[key], 4);
  }
  if (reference.hue >= 0 && output.hue >= 0) {
    deltas.hue = circularHueDistance(reference.hue, output.hue);
  }

  const grid_diff_6x6 = output.grid_6x6.map((row, rIdx) =>
    row.map((val, cIdx) => round(val - reference.grid_6x6[rIdx][cIdx], 2)),
  );

  const diagnoses: VerifyDiagnosis[] = [];

  if (reference.dominant_band !== output.dominant_band) {
    const refRatio = Math.round(reference[reference.dominant_band] * 100);
    const outRatio = Math.round(output[output.dominant_band] * 100);
    diagnoses.push({
      severity: 'severe',
      metric: 'dominant_band',
      message: `主导明度档不一致：参考图为 ${reference.dominant_band} 主导（${refRatio}%），出图为 ${output.dominant_band} 主导（${outRatio}%）`,
      nai_fix: '先改 base_prompt 首段的明度定调（low key / dark background 或 high key / bright background），高调按 G4 补 2–3 处黑色材质锚点，低调按 G69 补唯一实体高光锚点。',
    });
  }

  const refSatDiff = reference.lit - reference.shadow;
  const outSatDiff = output.lit - output.shadow;
  if (refSatDiff * outSatDiff < 0 && Math.abs(refSatDiff) > 0.015 && Math.abs(outSatDiff) > 0.015) {
    diagnoses.push({
      severity: 'severe',
      metric: 'lit_vs_shadow',
      message: `亮暗部饱和度方向反转（G9）：参考图 lit=${reference.lit} vs shadow=${reference.shadow}，出图 lit=${output.lit} vs shadow=${output.shadow}`,
      nai_fix: refSatDiff > 0
        ? '参考图为「亮部更饱和」：把主色相 Tag 与色彩描写挪到被照亮的最大面积表面（墙面/地面/受光衣面），暗部改为低饱和灰蓝。'
        : '参考图为「暗部藏色」：在 base_prompt 加入 colored_shadow, hue_shifting，让亮部受光面洗淡（pale light）而把高饱和颜色写在暗部阴影里。',
    });
  }

  if (Math.abs(deltas.mean) > 0.05) {
    diagnoses.push({
      severity: 'moderate',
      metric: 'mean',
      message: `整体明度偏移 |Δmean| = ${Math.abs(deltas.mean).toFixed(3)}（参考 ${reference.mean}，出图 ${output.mean}）`,
      nai_fix: deltas.mean > 0
        ? '出图整体偏亮：扩大暗部面积描述（如 dark shadow takes up more than half the frame），将最亮大面积降为次亮，只留一处小材质高光。'
        : '出图整体偏暗：减少 deep shadow / darkness 权重，明确点名受光主面的面积占比与色相。',
    });
  }

  if (Math.abs(deltas.soft) > 0.1 || Math.abs(deltas.flat) > 0.08) {
    diagnoses.push({
      severity: 'moderate',
      metric: 'edge_gradient',
      message: `边缘软硬与层次偏差：参考 strong=${reference.strong}/flat=${reference.flat}，出图 strong=${output.strong}/flat=${output.flat}`,
      nai_fix: output.flat > reference.flat
        ? '出图偏平偏软（光效/层次糊成一片）：①将弥散光效（a wide bloom / soft veil）改写为有硬边界与分层的句子（the bloom has a hard outer boundary, stepping down twice）；②硬光加 each shadow edge is cut like a blade, with no gradient at all；③检查是否开启了多余质量滤镜（建议 quality_preset: "none"）。'
        : '出图偏碎偏硬：补充大面积均匀留白（negative_space）或景深虚化（depth_of_field, blurry_background），并将 scale 微降至 3.8–4.8。',
    });
  }

  if (reference.nw < 0.01 && output.nw > 0.03) {
    diagnoses.push({
      severity: 'moderate',
      metric: 'nw',
      message: `出图亮部过曝烧白：近白占比 ${(output.nw * 100).toFixed(1)}%（参考仅 ${(reference.nw * 100).toFixed(1)}%）`,
      nai_fix: '删掉 pure white / overexposed / glowing white，将亮面改为 off-white, pale cream，并给最亮载体加 stopping one step short of blowing out。',
    });
  }

  if (reference.p1 > 0.13 && output.p1 < 0.08) {
    diagnoses.push({
      severity: 'moderate',
      metric: 'p1',
      message: `出图暗部死黑过重：p1=${output.p1}（参考 p1=${reference.p1} 无真黑）`,
      nai_fix: '加入 colored_shadow, muted_colors，在自然语言段写明 nothing reaches pure black, the deepest shadow stays a slate blue / warm umber。',
    });
  } else if (reference.p1 < 0.06 && output.p1 > 0.12) {
    diagnoses.push({
      severity: 'moderate',
      metric: 'p1',
      message: `出图暗部没压下去：p1=${output.p1}（参考 p1=${reference.p1} 有深黑锚点）`,
      nai_fix: '加入 high_contrast, deep_shadow，点名 2–3 处具体材质凹槽归属全图最黑（the deepest tone is the black ink in the folds）。',
    });
  }

  const manhattan = Math.abs(reference.brightest_cell.row - output.brightest_cell.row)
    + Math.abs(reference.brightest_cell.col - output.brightest_cell.col);
  if (manhattan >= 2) {
    diagnoses.push({
      severity: 'minor',
      metric: 'brightest_cell',
      message: `最亮区位置偏移：参考在第 ${reference.brightest_cell.row} 行第 ${reference.brightest_cell.col} 列 (${reference.brightest_cell.position_en})，出图在第 ${output.brightest_cell.row} 行第 ${output.brightest_cell.col} 列 (${output.brightest_cell.position_en})`,
      nai_fix: `修正光源方向与落点句：明确将主光落点锚定在 ${reference.brightest_cell.position_en}（the brightest patch sits in the ${reference.brightest_cell.position_en}）。`,
    });
  }

  if (reference.hue >= 0 && output.hue >= 0 && deltas.hue > 30) {
    diagnoses.push({
      severity: 'minor',
      metric: 'hue',
      message: `主色相偏移 ${deltas.hue}°（参考 ${reference.hue}°，出图 ${output.hue}°）`,
      nai_fix: `使用参考图实测主色 HEX（${reference.dominant_hex_palette[0]?.hex ?? ''}）对应的「基础色名 + 具象参照物」或 <color>_theme 锁定主调。`,
    });
  }

  if (Math.abs(deltas.sat) > 0.06) {
    diagnoses.push({
      severity: 'minor',
      metric: 'sat',
      message: `饱和度偏差 Δsat = ${deltas.sat > 0 ? '+' : ''}${deltas.sat.toFixed(3)}（参考 ${reference.sat}，出图 ${output.sat}）`,
      nai_fix: deltas.sat > 0
        ? '出图色彩过艳：减少色相词数量（只留一个高饱和焦点色），加入 muted_colors, limited_palette。'
        : '出图色彩偏灰：在被照亮的最大面积表面挂上明确色相词，不要只把颜色写在小饰品上。',
    });
  }

  const order = { severe: 0, moderate: 1, minor: 2 };
  diagnoses.sort((a, b) => order[a.severity] - order[b.severity]);
  const severe_count = diagnoses.filter(d => d.severity === 'severe').length;
  const passed = severe_count === 0;

  const badge = { severe: '[严重]', moderate: '[明显]', minor: '[轻微]' } as const;
  const summaryLines = [
    `验收结论：${passed ? '通过' : `不通过（${severe_count} 项严重偏差）`} · 共 ${diagnoses.length} 条诊断`,
    `参考图 (${reference.width}×${reference.height}) vs 出图 (${output.width}×${output.height})`,
    `mean: ${reference.mean} -> ${output.mean} (${deltas.mean >= 0 ? '+' : ''}${deltas.mean}) | dark/mid/bright: ${reference.dark}/${reference.mid}/${reference.bright} -> ${output.dark}/${output.mid}/${output.bright}`,
    `sat: ${reference.sat} -> ${output.sat} | lit/shadow: ${reference.lit}/${reference.shadow} -> ${output.lit}/${output.shadow} | strong/flat: ${reference.strong}/${reference.flat} -> ${output.strong}/${output.flat}`,
    ...(diagnoses.length === 0
      ? ['[通过] 所有核心光学与色彩判据均落在容差范围内。']
      : diagnoses.map(d => `${badge[d.severity]} ${d.message}\n  → NAI 单句修正：${d.nai_fix}`)),
  ];

  return {
    passed,
    severe_count,
    reference,
    output,
    deltas,
    grid_diff_6x6,
    diagnoses,
    summary_text: summaryLines.join('\n'),
  };
}

// ======================= NAI 13-Gate Prompt Linter =======================

const DARK_WORDS = [
  'low key', 'low-key', 'low_key', 'deep shadow', 'pitch-black', 'pitch black',
  'mostly dark', 'unlit', 'almost black', 'dark throughout', 'darkness', 'dim_lighting', 'dim lighting',
];
const LIGHT_WORDS = [
  'high key', 'high-key', 'high_key', 'mostly bright', 'washed out', 'blown out',
  'sunlit throughout', 'overexposed', 'bright throughout',
];
const MID_WORDS = [
  'middle value', 'mid-tone', 'midtone', 'mid value', 'middle of the tonal',
  'lower middle', 'nothing is dark', 'no true darks', 'sits in the middle',
];
const SAT_SHADOW = [
  'saturated in the shadow', 'stronger in the shadow', 'richer in the shadow',
  'deeper and more saturated', 'shadows keep', 'shadows carry',
  'shadowed side keeps', 'shadowed side carries', 'dark side carries',
  'colours live in the shadow', 'colors live in the shadow', 'colored_shadow', 'colored shadow',
];
const SAT_LIGHT = [
  'saturated in the light', 'vivid in the light', 'richest in the highlight',
  'lights carry the colour', 'lights carry the color',
  'brighter and more saturated', 'the sun makes the colours hotter', 'the sun makes the colors hotter',
];
const PALE_LIGHT = [
  'wash out', 'washes out', 'washed out', 'bleach', 'chalky', 'pale in the light', 'sun-bleached',
];
const EMPTY_FLUFF_WORDS = [
  'beautiful lighting', 'dramatic atmosphere', 'moody lighting', 'stunning composition',
  'epic lighting', 'breathtaking atmosphere', 'cinematic atmosphere', 'magical vibe',
];
const RAW_NEGATIVE_IN_POSITIVE = [
  'worst quality', 'low quality', 'bad anatomy', 'bad hands', 'missing fingers',
  'extra digit', 'fewer digits', 'jpeg artifacts', 'censored', 'mosaic censoring',
];
const BLEACH_WORDS = [
  'overexposed', 'blown out', 'blown to', 'pure white', 'white out', 'burns out to white',
];
const KEEP_COLOUR_WORDS = [
  'keeps its colour', 'keeps its color', 'still holds its colour', 'still holds its color',
  'one step lighter', 'lighter but not paler', 'the colour survives', 'the color survives',
  'holds its hue', 'saturated in the light', 'stops one step short of blowing out',
  'stopping one step short of blowing out',
];
const CHROMA_WORDS = [
  'ochre', 'amber', 'yellow', 'green', 'red', 'blue', 'pink', 'orange', 'brown',
  'gold', 'honey', 'teal', 'olive', 'violet', 'purple', 'cyan', 'magenta',
  'rust', 'terracotta', 'crimson', 'scarlet', 'indigo', 'maroon', 'turquoise', 'aqua',
];
const NEUTRAL_WORDS = [
  'grey', 'gray', 'white', 'cream', 'silver', 'pale', 'off-white', 'ivory', 'charcoal', 'ash', 'beige',
];

const NEG_BEFORE_REGEX = /(?:\bnot|\bno|\bnever|\bwithout|\bnothing|\bnone\s+of|\bnor|\brather\s+than|\binstead\s+of)\s+(?:\w+[\s,]+){0,3}$/i;

function stripInlineNegativeBlocks(text: string): string {
  return text.replace(/-\d+(?:\.\d+)?\s*(::|__)[\s\S]*?\1/g, ' ');
}

function hasPhrase(text: string, phrases: readonly string[]): boolean {
  const lower = text.toLowerCase();
  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![a-z_])${escaped}(?![a-z_])`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lower)) !== null) {
      const pre = lower.slice(Math.max(0, match.index - 52), match.index);
      if (NEG_BEFORE_REGEX.test(pre)) continue;
      return true;
    }
  }
  return false;
}

function findPositiveHits(text: string, phrases: readonly string[]): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![a-z_])${escaped}(?![a-z_])`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lower)) !== null) {
      const pre = lower.slice(Math.max(0, match.index - 56), match.index);
      if (NEG_BEFORE_REGEX.test(pre)) continue;
      hits.push(phrase);
      break;
    }
  }
  return hits;
}

function findUnclosedWeightBlocks(text: string): string[] {
  const errors: string[] = [];
  const cleaned = text.trim();
  if (!cleaned) return errors;
  const openMatches = [...cleaned.matchAll(/(?:^|[,，\s])([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*::/g)];
  const allDoubleColons = [...cleaned.matchAll(/::/g)];
  if (openMatches.length > 0 && allDoubleColons.length < openMatches.length * 2) {
    errors.push(`检测到 ${openMatches.length} 处权重起始 "weight::"，但 "::" 总数仅为 ${allDoubleColons.length}（缺少闭合 "::"）`);
  } else if (allDoubleColons.length % 2 !== 0) {
    errors.push(`检测到奇数个 "::"（共 ${allDoubleColons.length} 个），存在未闭合的 NovelAI 权重壳`);
  }
  return errors;
}

export function lintNaiPrompt(input: LintNaiPromptInput, refProfile?: ProbeImageResult): LintNaiPromptResult {
  const intents = new Set<PromptLintIntent>(input.intents ?? []);
  const model = input.model ?? 'nai-diffusion-5-curated';
  const width = input.width ?? 832;
  const height = input.height ?? 1216;
  const characters = input.characters ?? [];

  const basePosRaw = input.base_prompt ?? '';
  const charPosRaw = characters.map(c => c.prompt ?? '').join('\n');
  const allPosRaw = [basePosRaw, charPosRaw].filter(Boolean).join('\n');
  const posNoNegWeights = stripInlineNegativeBlocks(allPosRaw);
  const posLower = posNoNegWeights.toLowerCase();
  const negLower = [
    input.base_negative_prompt ?? '',
    ...characters.map(c => c.negative_prompt ?? ''),
    ...(allPosRaw.match(/-\d+(?:\.\d+)?\s*(?:::|__)([\s\S]*?)(?:::|__)/g) ?? []),
  ].join(' ').toLowerCase();

  const GATE_NAMES: Record<number, string> = {
    1: 'NAI 语法、权重壳与画幅预算',
    2: '参考图实测数值对齐',
    3: '明度/色彩/机位内部矛盾',
    4: '七维与光影构图预算覆盖',
    5: '空转废话词与 NAI 预设冲撞',
    6: '镜头景别与机位要素',
    7: '世界逻辑与专色隔离',
    8: '曝光保色与防画灯入画',
    9: '色彩落点与暗部激活',
    10: '构图落位与角色坐标防居中/防叠头',
    11: '先验解绑与防「欲盖弥彰」',
    12: '动作解剖闭环与多角色 3-Tier 分槽',
    13: '大师级美学质感巡检（提示灯）',
  };

  const gatesMap = new Map<number, LintGateIssue[]>();
  for (let g = 1; g <= 13; g++) gatesMap.set(g, []);
  const add = (gate: number, level: 'WARN' | 'FAIL', message: string, fix: string) => {
    gatesMap.get(gate)?.push({ level, message, fix });
  };

  // Metrics calculation
  const segments = allPosRaw
    .split(/[,，\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const tag_count = segments.length;
  const weightedMatches = allPosRaw.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:::|__)[\s\S]*?(?:::|__)/g) ?? [];
  const bracketWeighted = segments.filter(s => /^\{+.+\}+$|^\[+.+\]+$/.test(s));
  const weighted_tag_count = weightedMatches.length + bracketWeighted.length;
  const weighted_ratio = tag_count > 0 ? round(weighted_tag_count / tag_count, 2) : 0;
  const wordCount = allPosRaw.trim().split(/\s+/).filter(Boolean).length;
  const estimated_tokens = Math.max(tag_count * 2, Math.round(wordCount * 1.35));
  const naturalSentences = allPosRaw
    .split(/(?<!\d)\.(?!\d)|\n+/)
    .map(s => s.trim())
    .filter(s => s.split(/\s+/).length >= 7 && !s.includes('::'));
  const natural_sentence_count = naturalSentences.length;

  // ---------- 关 1：NAI 语法、权重壳与画幅预算 ----------
  for (const [label, text] of [
    ['base_prompt', basePosRaw],
    ['base_negative_prompt', input.base_negative_prompt ?? ''],
    ...characters.map((c, i) => [`characters[${i}].prompt`, c.prompt] as const),
  ]) {
    for (const err of findUnclosedWeightBlocks(text)) {
      add(1, 'FAIL', `${label} ${err}`, 'NovelAI V5/V4.5 权重壳必须成对闭合，格式为 `1.2::tag::` 或 `-2::tag::`。');
    }
  }

  if (/\([a-zA-Z0-9_\s-]+:\d+(?:\.\d+)?\)/.test(allPosRaw)) {
    add(
      1,
      'WARN',
      '检测到 Stable Diffusion 括号权重语法 `(tag:1.2)`',
      'NovelAI V5 / V4.5 主力语法（95.3% 使用率）为 `1.2::tag::`，请将 `(word:1.2)` 替换为 `1.2::word::`。',
    );
  }

  if (tag_count >= 8 && weighted_ratio > 0.35) {
    add(
      1,
      'WARN',
      `加权项占比偏高（${weighted_tag_count}/${tag_count} ≈ ${Math.round(weighted_ratio * 100)}%，超过 30% 上限）`,
      '10,958 条真实 NAI 语料表明加权项应控制在 ≤30%（约 3–5 处核心锚点，权重 0.5–1.5）；全篇加权会互相抵消导致画面崩坏。',
    );
  }

  const tokenLimit = model === 'nai-diffusion-5-full' ? 1471 : 703;
  if (estimated_tokens > tokenLimit) {
    add(
      1,
      'WARN',
      `预估 Token 数（~${estimated_tokens}）超过 ${model} 的有效上限（~${tokenLimit} tokens）`,
      model === 'nai-diffusion-5-curated'
        ? '请精简次要形容词至 35–47 Tag 预算内，或仅在需要超长排版文本时切换至 `nai-diffusion-5-full`（~1471 tokens）。'
        : '请按 word-budget 删减次要背景修辞与重复同义 Tag。',
    );
  } else if (tag_count < 5 && natural_sentence_count === 0) {
    add(
      1,
      'WARN',
      `提示词过短（仅 ${tag_count} 个片段且无自然语言空间句），信息量不足以锁定构图与光影`,
      '建议按 35 Tag 黄金预算（人数画师 4-6 + 外貌 6-8 + 服装 3-5 + 动作 2-3 + 场景 3-4 + 光影 3-4 + 构图 3-4 + 材质收尾 4-6）加 1–2 句英文自然语言补齐。',
    );
  }

  if (width % 64 !== 0 || height % 64 !== 0) {
    add(1, 'WARN', `画幅 ${width}×${height} 不是 64 的倍数`, 'NovelAI 会将宽高对齐到 64 的倍数，建议直接使用 832×1216、1216×832、1024×1024、704×1408。');
  }
  if (width * height > 3145728) {
    add(1, 'FAIL', `画幅总像素 ${width * height} 超过上限 3,145,728`, '请将分辨率缩小至 3MP 以内（标准免费友好分辨率 ≤ 1,048,576 像素）。');
  }

  // ---------- 关 2：参考图实测数值对齐 ----------
  if (refProfile) {
    const bandName = { dark: '暗调 (Low Key)', mid: '中调 (Mid-tone)', bright: '高调 (High Key)' }[refProfile.dominant_band];
    const bandWords = { dark: DARK_WORDS, mid: MID_WORDS, bright: LIGHT_WORDS }[refProfile.dominant_band];
    const oppWords = {
      dark: LIGHT_WORDS,
      bright: DARK_WORDS,
      mid: [...DARK_WORDS, ...LIGHT_WORDS],
    }[refProfile.dominant_band];

    if (hasPhrase(posNoNegWeights, oppWords) && !hasPhrase(posNoNegWeights, bandWords)) {
      add(
        2,
        'FAIL',
        `提示词声明了与参考图相反的明度档（参考图为 ${bandName}，占比 ${Math.round(refProfile[refProfile.dominant_band] * 100)}%）`,
        `删掉相反的明度词，改为匹配参考图的 ${bandName} 定调。`,
      );
    }

    const saysShadowRich = hasPhrase(posNoNegWeights, SAT_SHADOW) || hasPhrase(posNoNegWeights, PALE_LIGHT);
    const saysLightRich = hasPhrase(posNoNegWeights, SAT_LIGHT);
    if (refProfile.saturation_bias === 'lit_richer' && saysShadowRich && !saysLightRich) {
      add(
        2,
        'FAIL',
        `参考图是亮部更饱和（lit=${refProfile.lit} vs shadow=${refProfile.shadow}），提示词却写暗部更饱和/亮部洗淡`,
        '将主色相词挂在受光大面积表面上，移除暗部更浓的描述。',
      );
    } else if (refProfile.saturation_bias === 'shadow_richer' && saysLightRich && !saysShadowRich) {
      add(
        2,
        'FAIL',
        `参考图是暗部更饱和（shadow=${refProfile.shadow} vs lit=${refProfile.lit}），提示词却写亮部更饱和`,
        '加入 `colored_shadow, hue_shifting`，让受光面偏清淡而将浓郁色相留在阴影区。',
      );
    }

    if (refProfile.nw < 0.01 && hasPhrase(posNoNegWeights, ['pure white', 'blown out', 'overexposed'])) {
      add(
        2,
        'WARN',
        `参考图近白占比仅 ${(refProfile.nw * 100).toFixed(2)}%，提示词却写了 pure white / overexposed`,
        '改写为 `off-white, pale cream, stopping one step short of blowing out`。',
      );
    }
    if (refProfile.p1 > 0.13 && hasPhrase(posNoNegWeights, ['pure black', 'pitch black', 'black void'])) {
      add(
        2,
        'WARN',
        `参考图 p1=${refProfile.p1}（全图无真黑），提示词却写了 pure black / pitch black`,
        '改写为带色相的深色阴影（如 `deep slate blue shadow / warm umber shadow`）。',
      );
    }
    if (refProfile.flat < 0.35 && hasPhrase(posNoNegWeights, ['bloom', 'haze', 'fog', 'foggy'])) {
      add(
        2,
        'WARN',
        `参考图平坦度极低（flat=${refProfile.flat}，属于硬边高对比），提示词却写了 bloom / haze / fog`,
        '删掉柔化雾化词，改用 `bold outline, hard shadow, crisp edge`。',
      );
    }
  }

  // ---------- 关 3：明度/色彩/机位内部矛盾 ----------
  if (hasPhrase(posNoNegWeights, DARK_WORDS) && hasPhrase(posNoNegWeights, LIGHT_WORDS) && !intents.has('blown') && !intents.has('leak')) {
    add(3, 'FAIL', '同时出现暗调词（low key/mostly dark）与高调词（high key/mostly bright），模型会取平均变灰', '遵循「一图一主张」，只保留一个主导明度档。');
  }
  if (hasPhrase(posNoNegWeights, SAT_SHADOW) && hasPhrase(posNoNegWeights, SAT_LIGHT)) {
    add(3, 'FAIL', '同时声明「暗部更饱和」与「亮部更饱和」', '二选一：要么颜色挂受光大面积面，要么用 `colored_shadow` 走暗部藏色。');
  }

  const hasFullBody = /\b(full_body|full body)\b/i.test(posLower);
  const hasComplexAngle = /\b(from_below|from below|from_above|from above|overhead|dutch_angle|dutch angle|fisheye|wide_angle|wide angle)\b/i.test(posLower);
  if (hasFullBody && hasComplexAngle) {
    add(
      3,
      'WARN',
      '强触发组合冲突：`full_body` 与特殊机位（`from_below / from_above / dutch_angle / fisheye`）同现',
      '`full_body` 极易吞掉特殊机位并把画面拉回呆板平视全身站姿！建议删掉 `full_body`，改用 `cowboy_shot` 或具体部位裁切（如 `feet_out_of_frame`）+ 该视角才看得见的排他事实。',
    );
  }

  const hasLowAngle = /\b(from_below|from below|low_angle|low angle)\b/i.test(posLower);
  const hasForeshortening = /\b(foreshortening|wide_angle|wide angle|perspective)\b/i.test(posLower);
  const hasFaceProtect = /\b(facial proportions?|keeping facial|proportion intact|three-quarter angle)\b/i.test(posLower);
  if (hasLowAngle && hasForeshortening && !hasFaceProtect) {
    add(
      3,
      'WARN',
      '`from_below` + `foreshortening` 极易触发 B3 陷阱（脚底板巨化怼脸、五官塌陷变形）',
      '加入透视安全笼引导句（如 `camera tracks on a three-quarter angle along the plane, keeping facial proportions strictly intact`）或改用 `feet_out_of_frame`。',
    );
  }

  if (/\b(dutch_angle|dutch angle)\b/i.test(posLower) && !/\b(tilted|rotated|rolled|degrees|diagonal)\b/i.test(posLower)) {
    add(
      3,
      'WARN',
      '单独写 `dutch_angle` 容易被模型自动摆正',
      '建议在自然语言段补充倾斜度数与斜线参照物（如 `the frame is tilted about 18 degrees so the doorframe cuts diagonally across`）。',
    );
  }

  if (/\b(directly overhead|looking straight down|shot from directly above)\b/i.test(posLower)) {
    add(
      3,
      'WARN',
      '机位写成 `directly overhead` 极易退化为平视站姿（B4 陷阱）',
      '改写为 `from_above, steep 60-degree high-angle shot` 并写出四条俯拍事实（见头顶发旋、肩胸垂向叠压、只见鞋面不见鞋底、地面向后退行）。',
    );
  }

  // ---------- 关 4：七维与光影构图预算覆盖 ----------
  const lightCueCount = (posLower.match(/\b(backlighting|sidelighting|overlighting|underlighting|light_rays|sunbeam|crack_of_light|dappled_sunlight|caustics|chiaroscuro|rim light|rim_light|shadow|sunlight|moonlight|candlelight|spotlight|dim_lighting|volumetric|stops? under|dies within|cut like a blade)\b/g) ?? []).length;
  const compCueCount = (posLower.match(/\b(close-up|close_up|portrait|upper_body|upper body|cowboy_shot|cowboy shot|full_body|full body|wide_shot|wide shot|very_wide_shot|from_side|from side|from_behind|from behind|from_above|from above|from_below|from below|straight-on|profile|three-quarter view|dutch_angle|dutch angle|pov|depth_of_field|blurry_background|blurry_foreground|negative_space|negative space|foreshortening|vanishing_point|rule of thirds|left third|right third|out_of_frame)\b/g) ?? []).length;
  if (lightCueCount + compCueCount < 2) {
    add(
      4,
      'WARN',
      `光影与构图指令不足（仅命中 ${lightCueCount} 处光影、${compCueCount} 处构图）`,
      '在 35 Tag 黄金预算中，「光影（3–4 个）+ 构图镜头（3–4 个）」合计应占 6–8 个 Tag 或 1–2 句自然语言，否则模型必退回出厂均光居中。',
    );
  }

  // ---------- 关 5：空转废话词与 NAI 预设冲撞（纯 NAI 口径） ----------
  const fluffHits = findPositiveHits(posNoNegWeights, EMPTY_FLUFF_WORDS);
  if (fluffHits.length > 0) {
    add(
      5,
      'WARN',
      `出现空转形容词：${fluffHits.join(', ')}（在 10,958 条真实 NAI 精品串中出现率为 0）`,
      '删掉空转套话，换成模型能执行的标签或物理事实（如 `sidelighting, chiaroscuro, colored_shadow` 或 `each shadow edge is cut like a blade`）。',
    );
  }

  const rawNegHits = findPositiveHits(posNoNegWeights, RAW_NEGATIVE_IN_POSITIVE);
  if (rawNegHits.length > 0) {
    add(
      5,
      'FAIL',
      `正向提示词中裸露混入了负面词：${rawNegHits.join(', ')}`,
      '请将这些负面词移入 `base_negative_prompt`，或用内联负权重 `-2::tag::` 包裹。',
    );
  }

  const hasPrintOrRetroOptical = /\b(halftone|screentone|dithering|chromatic aberration|chromatic_aberration|film grain|retro artstyle|year 199\d)\b/i.test(posLower);
  if (hasPrintOrRetroOptical && input.uc_preset === 'heavy') {
    add(
      5,
      'WARN',
      '预设冲撞：正向包含网点/色散/复古颗粒（`halftone / screentone / chromatic aberration`），但 `uc_preset` 设为了 `"heavy"`',
      'NovelAI 的 Heavy 负面预设会静默吞掉网点、色差与胶片颗粒！请将 `uc_preset` 设为 `"light"` 或 `"none"`。',
    );
  }

  const hasAnalogOrFlatMedia = /\b(nihonga|watercolor \(medium\)|ink \(medium\)|nib pen \(medium\)|faux traditional media|flat color|ligne claire|gouache|woodcut)\b/i.test(posLower);
  if (hasAnalogOrFlatMedia && (input.quality_preset === 'standard' || input.quality_preset === 'light')) {
    add(
      5,
      'WARN',
      `预设冲撞：正向包含拟传统/平面媒介，但 \`quality_preset\` 设为了 "${input.quality_preset}"`,
      '默认质量词会把纸纹、水痕与平涂色块推向半厚涂 AI 塑料光泽！建议设 `quality_preset: "none"` 并配 `-3::glossy skin, 3d, airbrush::`。',
    );
  }

  // ---------- 关 6：镜头景别与机位要素 ----------
  if (compCueCount === 0 && !intents.has('flat_poster')) {
    add(
      6,
      'WARN',
      '未指定任何景别（如 `cowboy_shot / upper_body / close-up / wide_shot`）或机位视角（如 `from_side / from_above / three-quarter view`）',
      '请补充至少 1 个景别 Tag 与 1 个视角 Tag（可调用 `search_nai_lexicon` 查询「视角构图」分类）。',
    );
  }

  // ---------- 关 7：世界逻辑与专色隔离 ----------
  const isMonoOrSpot = /\b(monochrome|greyscale|spot color|spot_color)\b/i.test(posLower) && !/\b(partially_colored|partially colored)\b/i.test(posLower);
  if (isMonoOrSpot) {
    const routineColors = posLower.match(/\b(pink|blonde|blue|red|green|purple|orange|yellow|amber|aqua|cyan|magenta|crimson|golden)\s+(hair|eyes|dress|shirt|skirt|jacket|coat|ribbon|scarf|bow)\b/g) ?? [];
    const distinctColors = new Set(routineColors.map(item => item.split(/\s+/)[0]));
    if (distinctColors.size >= 2) {
      add(
        7,
        'WARN',
        `黑白/单点专色（monochrome / spot color）模式下出现了 ${distinctColors.size} 种不同部位颜色词（${[...distinctColors].join(', ')}）`,
        'V5 Gotcha：在 `monochrome / spot color` 模式下必须删除所有非焦点元素的常规发色/瞳色/衣着颜色词，只保留唯一焦点色，否则 V5 会把整张图染成全彩。',
      );
    }
  }

  if (hasPhrase(posNoNegWeights, LIGHT_WORDS) && !/\b(darkest|near-black|near black|black ink|black ribbon|black pupils|dark anchor)\b/i.test(posLower)) {
    add(
      7,
      'WARN',
      '高调（High Key）画面未指定黑锚点（G4）',
      '高调图必须点名 2–3 处小面积深黑材质锚点（如 `the darkest notes are her black hairpins and pupils`），否则画面会发白发飘。',
    );
  }

  if (hasPhrase(posNoNegWeights, ['hard light', 'hard shadow', 'hard-edged']) && !/\b(blade|no gradient|razor|crisp edge|cel shadow|bold outline)\b/i.test(posLower)) {
    add(
      7,
      'WARN',
      '声明了硬光（hard light/shadow）但未写阴影边缘硬度（G6）',
      '补充 `each shadow edge is cut like a blade, with no gradient at all` 或 `cel shadow`。',
    );
  }

  // ---------- 关 8：曝光保色与防画灯入画 ----------
  const bleachHits = findPositiveHits(posNoNegWeights, BLEACH_WORDS);
  if (bleachHits.length > 0 && !intents.has('blown') && !intents.has('leak') && !hasPhrase(posNoNegWeights, KEEP_COLOUR_WORDS)) {
    add(
      8,
      'FAIL',
      `出现漂白过曝词（${bleachHits.join(', ')}）且无保色兜底句`,
      '18 张实测表明 `overexposed / pure white` 会让亮面饱和度暴跌至 0.02！请删掉，改用 `stops one step short of blowing out, keeping its hue`。',
    );
  }

  if (/\b(fluorescent tube|light fixture|studio lamp|bare light bulb|ceiling lamp)\b/i.test(posLower)) {
    add(
      8,
      'WARN',
      '画内出现了灯具实体名词（`fluorescent tube / light fixture / studio lamp`）（G41）',
      '写出灯具名词会让模型强行把灯具画进画面顶部破坏构图！若非故意画灯，请删掉灯具名，只写光线方向、落点与衰减。',
    );
  }

  // ---------- 关 9：色彩落点与暗部激活 ----------
  if (!isMonoOrSpot && !intents.has('monochrome')) {
    const chromaHits = CHROMA_WORDS.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(posLower));
    const neutralHits = NEUTRAL_WORDS.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(posLower));
    if (neutralHits.length > chromaHits.length && chromaHits.length < 2) {
      add(
        9,
        'WARN',
        `中性色词（${neutralHits.length} 个）多于有色相词（${chromaHits.length} 个），画面容易发灰`,
        '将明确色相词挂在被照亮的大面积表面上，并可加入 `colored_shadow, hue_shifting` 激活暗部色彩。',
      );
    }
  }

  // ---------- 关 10：构图落位与 characters 坐标防居中/防叠头 ----------
  const isSymmetricIntent = /\b(symmetry|symmetrical|straight-on|centered|portrait|tachi-e|reference_sheet)\b/i.test(posLower);
  if (characters.length === 1 && !isSymmetricIntent) {
    const cx = characters[0].center_x ?? 0.5;
    if (cx >= 0.45 && cx <= 0.55) {
      add(
        10,
        'WARN',
        `单角色 \`characters[0].center_x\` 落在正中死区（${cx}）（G65）`,
        '除非刻意画对称肖像/立绘，建议将 `center_x` 设为三分位 `0.33` 或 `0.67`，并在 `base_prompt` 另一侧写明 `negative_space`。',
      );
    }
  } else if (characters.length >= 2) {
    for (let i = 0; i < characters.length; i++) {
      for (let j = i + 1; j < characters.length; j++) {
        const ax = characters[i].center_x ?? 0.5;
        const ay = characters[i].center_y ?? 0.5;
        const bx = characters[j].center_x ?? 0.5;
        const by = characters[j].center_y ?? 0.5;
        if (Math.hypot(ax - bx, ay - by) < 0.12) {
          add(
            10,
            'WARN',
            `角色槽 characters[${i}] (${ax}, ${ay}) 与 characters[${j}] (${bx}, ${by}) 坐标过于接近（距离 < 0.12）（G93）`,
            '两个角色坐标重叠会导致头部融合或服饰串色！请将 `center_x` 拉开（如 `0.3` 与 `0.7`）。',
          );
        }
      }
    }
  }

  // ---------- 关 11：先验解绑与防「欲盖弥彰」（NAI 专属） ----------
  const hasWings = /\b(wings?|feathered wings?)\b/i.test(posLower);
  const hasAngel = /\b(angel|angelic|seraph|archangel)\b/i.test(posLower);
  const hasDefensiveHaloInPos = /\b(no halo|without halo|no floating ring|nothing hovering or glowing|nothing hovering)\b/i.test(posLower);

  if (hasWings && hasAngel && !intents.has('halo')) {
    add(
      11,
      'WARN',
      '画面含羽翼且使用了 `angel / angelic` 统称，极易触发二游先验自动长出光环（halo）',
      'P1 先验解绑：删掉 `angel / angelic`，直接写 `1girl, wings, feathered wings`，并在 `base_negative_prompt`（或内联负权重）加入 `-2::halo, head halo, floating halo::`。',
    );
  }
  if (hasDefensiveHaloInPos) {
    add(
      11,
      'WARN',
      '正向提示词中出现了防光环否定句（`no halo / without halo / nothing hovering`）',
      '严禁在正向提示词中写 `no halo`（注意力机制看到 `halo` 反而会激活光环）！请从正向彻底删除，改为放进 `base_negative_prompt` 或写成 `-2::halo, head halo::`。',
    );
  }

  const hasCupOnChest = /\b(resting on|balanced on|atop|against)\s+(?:her\s+)?(?:upper\s+)?(chest|bust|breasts?)\b/i.test(posLower);
  const hasHandsAssigned = /\b(arms swing|hands at sides|hands in pockets|hands pushed|arms behind back)\b/i.test(posLower);
  if (hasCupOnChest && !hasHandsAssigned) {
    add(
      11,
      'WARN',
      '饮品置于胸前但未显式指派双手位置，模型强先验会默认画成双手抓杯',
      '在正向显式指派双手动作（如 `arms swing naturally at her sides, hands in pockets`），并在负向加入 `holding cup`。',
    );
  }

  const hasWhiteDress = /\b(white dress|white gown)\b/i.test(posLower);
  const hasWeddingHint = /\b(bridal|wedding|veil)\b/i.test(posLower);
  const hasNegVeil = /\b(veil|bridal)\b/i.test(negLower);
  if (hasWhiteDress && !hasWeddingHint && !hasNegVeil) {
    add(
      11,
      'WARN',
      '包含 `white dress / white gown` 但未在负向排除婚纱头纱（veil）先验',
      '若非婚礼题材，建议在 `base_negative_prompt` 或内联负权重中加入 `-2::veil, bridal veil, wedding dress::`。',
    );
  }

  // ---------- 关 12：动作解剖闭环与多角色 3-Tier 分槽 ----------
  const hasWeaponAction = /\b(thrust|thrusting|slash|slashing|swing|swinging|holding)\b[^.\n]*\b(blade|sword|rapier|katana|saber|weapon)\b/i.test(posLower);
  const hasFreeHandLock = /\b(left hand|right hand|other hand|free hand|counterbalance|gripping scabbard|resting on scabbard|at her hip|at her side|clenched fist)\b/i.test(posLower);
  if (hasWeaponAction && !hasFreeHandLock) {
    add(
      12,
      'WARN',
      '包含单手持械/挥刺动作，但未定义非持械手（副手）位置',
      'P2 双手解剖闭环：同一句内必须锁死副手位置（如 `left hand pulled tight at her hip in a clenched counterbalance fist` 或 `gripping scabbard`），防止多长出第三只手或悬空断剑。',
    );
  }

  const hasHighMotion = /\b(dive|diving|aerial|thrust|slash|spin|spinning|leaping)\b/i.test(posLower);
  const hasWingAero = /\b(swept|folded|flared|braking|air-brake|banked|asymmetric|asymmetrical)\b/i.test(posLower);
  if (hasHighMotion && hasWings && !hasWingAero) {
    add(
      12,
      'WARN',
      '高动态动作中包含羽翼（wings），但未描述羽翼气动受力形态',
      'P2 羽翼气动学：补充 `1.2::folded wings swept back::`（俯冲突刺）或 `asymmetrical wings, braking wing`（急停收势），避免翅膀画成僵硬背景贴纸。',
    );
  }

  const hasMultiCharInBase = /\b(2girls|2boys|3girls|1girl\s*,?\s*1boy|multiple girls|two girls|two women|rival|opponent|facing each other)\b/i.test(basePosRaw);
  if (hasMultiCharInBase && characters.length < 2 && model !== 'nai-diffusion-3' && model !== 'nai-diffusion-furry-3') {
    add(
      12,
      'WARN',
      '`base_prompt` 包含多角色场景描述，但未使用 `characters` 子提示词槽位进行属性隔离',
      'NovelAI V5 / V4.5 多角色强烈建议拆入 `characters` 数组（`base_prompt` 只管全局镜头、环境与交互，每个 `characters[i]` 管各自发色、瞳色、服装与 `center_x/center_y` 坐标），并执行四手全清点（Quad-Lock）。',
    );
  }

  // ---------- 关 13：大师级美学质感巡检（永远只出 WARN 提示灯） ----------
  const isOvercastOrFlat = hasPhrase(posNoNegWeights, ['overcast', 'fog', 'foggy', 'mist', 'flat color', 'graphic design', 'poster']);
  const hasPerson = /\b(1girl|1boy|2girls|girl|woman|boy|man|she|her|he|his|figure|character)\b/i.test(posLower) || characters.length > 0;
  const hasMicroAction = /\b(pausing|mid-motion|adjusting|reaching|touching|brushing|tilting|leaning|crouching|turning|holding|gripping|sipping|reading|resting|lingering|tucking|half-turned|hovering)\b/i.test(posLower);
  const hasTimeEvidence = /\b(steam|ripples|wet|rain|petals|leaves|footprints|condensation|worn|chipped|dust|sparks|wind|breeze|floating hair|flowing hair)\b/i.test(posLower);

  if (hasPerson && !(hasMicroAction && hasTimeEvidence)) {
    add(
      13,
      'WARN',
      '美学提示灯（13A）：可进一步丰富「0.3 秒未完成微动作」或「时间/物理物证细节」',
      '在末尾自然语言句加入未完成微动作（如手刚抬到一半、视线刚移开）与环境物证（水汽、落叶、涟漪、微风发丝），消除静态立绘摆拍感。',
    );
  }

  const hasFalloffOrContrast = /\b(key to fill|stops? under|stops? darker|dies within|fades into|chiaroscuro|high contrast|high_contrast|backlighting|sidelighting|crack_of_light|colored_shadow)\b/i.test(posLower);
  if (!isOvercastOrFlat && !hasFalloffOrContrast) {
    add(
      13,
      'WARN',
      '美学提示灯（13B）：光线缺少明确的衰减层次或光比描述',
      '可在自然语言段写出光线衰减（如 `light dies within arm\'s reach, background falls three stops under`）或加入 `sidelighting, chiaroscuro`。',
    );
  }

  const hasSpecularAnchor = /\b(brightest|specular|glint|gleam|highlight|rim light|rim_light)\b/i.test(posLower);
  if (!isOvercastOrFlat && !hasSpecularAnchor) {
    add(
      13,
      'WARN',
      '美学提示灯（13C）：未点名落在具体材质上的高光锚点',
      '可在收尾句点名全图最亮的一处反光落在什么具体材质上（如金属发夹、刀刃边缘、水珠 `carrying a pinpoint specular highlight`）。',
    );
  }

  const gates: LintGateResult[] = [];
  let fail_count = 0;
  let warn_count = 0;

  for (let g = 1; g <= 13; g++) {
    const issues = gatesMap.get(g) ?? [];
    // Gate 13 is strictly WARN only
    const normalizedIssues = g === 13
      ? issues.map(item => ({ ...item, level: 'WARN' as const }))
      : issues;
    const hasFail = normalizedIssues.some(i => i.level === 'FAIL');
    const hasWarn = normalizedIssues.some(i => i.level === 'WARN');
    for (const issue of normalizedIssues) {
      if (issue.level === 'FAIL') fail_count++;
      else warn_count++;
    }
    gates.push({
      gate: g,
      name: GATE_NAMES[g],
      status: hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'ok',
      issues: normalizedIssues,
    });
  }

  const passed = fail_count === 0;
  const summaryLines = [
    `NAI 十三道关自检结论：${passed ? '通过' : `不通过（${fail_count} 项 FAIL）`}（${fail_count} FAIL / ${warn_count} WARN）`,
    `统计：Tag 片段=${tag_count} | 加权项=${weighted_tag_count} (${Math.round(weighted_ratio * 100)}%) | 预估 Tokens=~${estimated_tokens} | 自然语言长句=${natural_sentence_count} | 角色槽=${characters.length}`,
    ...gates.flatMap(g => {
      if (g.issues.length === 0) return [`关 ${g.gate} ${g.name}：通过`];
      return [
        `关 ${g.gate} ${g.name}：`,
        ...g.issues.map(issue => `  [${issue.level}] ${issue.message}\n         → ${issue.fix}`),
      ];
    }),
  ];

  return {
    passed,
    fail_count,
    warn_count,
    metrics: {
      tag_count,
      weighted_tag_count,
      weighted_ratio,
      estimated_tokens,
      natural_sentence_count,
      character_slot_count: characters.length,
    },
    gates,
    summary_text: summaryLines.join('\n'),
  };
}
