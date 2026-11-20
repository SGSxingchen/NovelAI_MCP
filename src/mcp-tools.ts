import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { Ajv } from 'ajv';
import {
  extractArchiveId, IMAGE_PATH, listArchivedImages, loadArchivedImage, saveArchivedImage,
} from './image-archive.js';
import {
  ensurePngBuffer, extractPngTextMetadata, fitImageToMaxPixels, generateMaskFromRegions, getImageDimensions,
  prepareImg2ImgImage, prepareInpaintMask, preparePreciseReferenceImage, prepareV3VibeImage, resolveImageInput,
} from './image-input.js';
import {
  alignDimension, ENCODE_VIBE_MODELS, MAX_SEED, MAX_VIBE_REFERENCES, resolveGenerationModel, validateGenerationFeatures,
} from './model-registry.js';
import { DEFAULT_UPSCALE_MODEL, type NovelAIClient } from './novelai-client.js';
import {
  AUGMENT_REQ_TYPES, DEFAULT_MODEL, EMOTION_MOODS, IMAGE_FORMATS, IMAGE_MODELS, NOISE_SCHEDULES,
  PRECISE_REFERENCE_TYPES, QUALITY_PRESETS, SAMPLERS, UC_PRESET_NAMES,
} from './types.js';
import type {
  Action, AugmentReqType, CharacterReferenceInput, EmotionMood, ImageExtension, ImageGenerationParams, MaskRegion,
  Model, SuggestTagsParams, UnpackedImage, VibeReferenceInput,
} from './types.js';
import { VibeCache, vibeCacheKey } from './vibe-cache.js';

export const SERVER_NAME = 'novelai-mcp-server';
export const SERVER_VERSION = '2.0.0';

const DEFAULT_NEGATIVE_PROMPT = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry';
const MAX_DIMENSION = 49152;
const MAX_GENERATION_PIXELS = 3145728;
const UPSCALE_MAX_PIXELS = 1048576;
const MAX_REFERENCE_BYTES = 40 * 1024 * 1024;
const IMAGE_INPUT = '接受归档 ID、本站归档图片链接、公网 HTTPS 图片链接、图像 Base64 或图像数据 URI。仅标准输入输出模式支持本地文件。';
const IMAGE_RECEIPT = '展示结果中的「查看或下载图片」公网链接，每张图都保留对应链接。';

const bounded = (type: 'number' | 'integer', description: string, minimum: number, maximum: number) => (
  { type, description, minimum, maximum }
);
const choice = (description: string, values: readonly string[]) => (
  { type: 'string', description, enum: [...values] }
);
const flag = (description: string) => ({ type: 'boolean', description });
const textField = (description: string) => ({ type: 'string', description });
const unit = (description: string) => bounded('number', description, 0, 1);
const dimension = (description: string) => bounded('integer', description, 1, MAX_DIMENSION);

const generationFields = {
  base_prompt: { ...textField('全局场景与风格提示词。V3 的角色描述也写在这里。'), minLength: 1 },
  base_negative_prompt: textField('全局负面提示词，空字符串沿用旧版默认值。'),
  characters: {
    type: 'array', description: '独立角色提示词。V4 和 V4.5 最多 6 个，V5 最多 32 个，V3 不使用此项。',
    maxItems: 32,
    items: {
      type: 'object',
      properties: {
        prompt: { ...textField('该角色的提示词。'), minLength: 1 },
        negative_prompt: textField('该角色的负面提示词。'),
        center_x: unit('归一化水平坐标，默认为 0.5。'),
        center_y: unit('归一化垂直坐标，默认为 0.5。'),
      },
      required: ['prompt'],
    },
  },
  model: { ...choice('出图模型。默认 V5 Curated。V5 的额度与 Anlas 按账号计费。', IMAGE_MODELS), default: DEFAULT_MODEL },
  steps: bounded('integer', '采样步数，由模型决定默认值。V5 Full Medium 固定为 14。', 1, 50),
  seed: bounded('integer', '随机种子，省略或传非正数时随机生成。', Number.MIN_SAFE_INTEGER, MAX_SEED),
  n_samples: bounded('integer', '出图数量，1 至 8 张。多张可能增加 Anlas 消耗。', 1, 8),
  scale: bounded('number', '提示词引导强度，范围 0 至 10。', 0, 10),
  cfg_rescale: unit('引导强度重缩放，V5 Full Medium 固定为 0。'),
  sampler: choice('采样器，默认 k_euler_ancestral。局部重绘会自动改用兼容采样器。', SAMPLERS),
  noise_schedule: choice('噪声日程。V4 及以上将 native 转为 karras。', NOISE_SCHEDULES),
  variety_plus: flag('启用模型的 Variety+。V5 忽略此项。'),
  skip_cfg_above_sigma: { type: 'number', minimum: 0, description: '手动设置跳过引导的噪声阈值。V5 忽略此项。' },
  use_coords: flag('采用角色坐标。省略时，有独立角色则自动启用。'),
  quality_preset: choice('质量预设。旧模型使用质量开关，none 关闭。', QUALITY_PRESETS),
  uc_preset: choice('负面提示词预设。V5 Full Medium 固定为 heavy。', UC_PRESET_NAMES),
  transparent_background: flag('V5 透明背景。V5 Curated 局部重绘回退到 V4.5 时不可用。'),
  image_format: choice('出图格式，默认 PNG。', IMAGE_FORMATS),
  smea: flag('启用 V3 的 SMEA。'),
  smea_dyn: flag('启用 V3 的动态 SMEA。'),
  auto_smea: flag('自动选择 V3 的 SMEA。'),
  dynamic_thresholding: flag('启用 V3 的降锐处理。'),
  uncond_scale: bounded('number', '负面提示词强度，范围 0 至 1.5。', 0, 1.5),
  legacy_uc: flag('使用旧版负面提示词处理。V4 默认开启。'),
  character_references: {
    type: 'array', description: 'V4.5 精确参考，与 vibe_references 互斥。参考图可能增加 Anlas 消耗。',
    items: {
      type: 'object',
      properties: {
        image: textField(IMAGE_INPUT),
        type: choice('参考类型。', PRECISE_REFERENCE_TYPES),
        strength: unit('参考影响强度，默认 1。'),
        fidelity: unit('对参考图的保真度，默认 1。'),
      },
      required: ['image', 'type'],
    },
  },
  vibe_references: {
    type: 'array', maxItems: MAX_VIBE_REFERENCES,
    description: '最多 16 张风格参考，V5 与 V4.5 局部重绘不可用。V4 系列首次编码可能消耗 Anlas。',
    items: {
      type: 'object',
      properties: {
        image: textField(`源参考图。${IMAGE_INPUT} 每项在 image、vibe_id、encoded_vibe 中选一项。V3 只接受 image。`),
        vibe_id: textField('同一模型此前返回的 vibe_id，用于复用编码。'),
        encoded_vibe: textField('已编码的 V4 或 V4.5 Vibe，使用纯 Base64。'),
        strength: unit('参考影响强度，默认 0.6。'),
        information_extracted: unit('原图的信息提取比例，默认 1。已编码的 Vibe 固定使用编码时的比例。'),
      },
    },
  },
  normalize_vibe_strength: flag('自动归一化 Vibe 参考强度，默认开启。'),
};

const sourceFields = {
  ...generationFields,
  source_image: { ...textField(IMAGE_INPUT), minLength: 1 },
  width: dimension('输出宽度（像素），对齐到 64 的倍数，省略时按原图。'),
  height: dimension('输出高度（像素），对齐到 64 的倍数，省略时按原图。'),
  noise: unit('添加的噪声，默认 0。'),
};

function tool(
  name: string,
  description: string,
  properties: NonNullable<Tool['inputSchema']['properties']>,
  required: string[] = [],
  readOnly = false,
  openWorld = true,
): Tool {
  return {
    name, description,
    inputSchema: { type: 'object', properties, required },
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: openWorld },
  };
}

const TOOLS = [
  tool('generate_image', `按提示词画图，默认使用 V5 Curated。按模型、尺寸、步数和图片张数可能消耗额度或 Anlas。${IMAGE_RECEIPT}`, {
    ...generationFields,
    width: { ...dimension('图片宽度（像素），对齐到 64 的倍数，默认 832。'), default: 832 },
    height: { ...dimension('图片高度（像素），对齐到 64 的倍数，默认 1216。'), default: 1216 },
  }, ['base_prompt']),
  tool('img2img', `用提示词重绘源图，strength 越大改动越多。可能消耗额度或 Anlas。${IMAGE_RECEIPT}`, {
    ...sourceFields,
    strength: unit('去噪强度，默认 0.7。'),
    color_correct: flag('校正颜色以贴近原图，默认开启。'),
    extra_noise_seed: bounded('integer', '额外噪声种子，默认沿用出图种子。', 1, MAX_SEED),
  }, ['base_prompt', 'source_image']),
  tool('inpaint_image', `重绘图中指定区域。提供 mask_image 或至少一个 mask_regions。V5 Curated 自动回退到 V4.5 Curated。可能消耗额度或 Anlas。${IMAGE_RECEIPT}`, {
    ...sourceFields,
    mask_image: textField(`黑色保留，白色重绘。与 mask_regions 同时提供时使用此遮罩。${IMAGE_INPUT}`),
    mask_regions: {
      type: 'array', minItems: 1, maxItems: 64, description: '重绘区域，至多 64 个矩形或椭圆。以画面左上角为原点，坐标和宽高均按比例归一化。',
      items: {
        type: 'object',
        properties: {
          shape: choice('区域形状，默认矩形。', ['rect', 'ellipse']),
          x: unit('区域左侧位置。'),
          y: unit('区域上侧位置。'),
          width: unit('区域宽度，须大于 0。'),
          height: unit('区域高度，须大于 0。'),
        },
        required: ['x', 'y', 'width', 'height'],
      },
    },
    inpaint_strength: unit('遮罩内重绘强度，默认 1。低于 1 时在遮罩内按指定强度重绘。'),
    add_original_image: flag('用原图合成遮罩外的区域，默认开启。'),
  }, ['base_prompt', 'source_image']),
  tool('augment_image', `对源图抽线稿、转素描、着色、清理画面、改变表情、移除背景或调整像素。移除背景返回三张图，调用可能消耗 Anlas。${IMAGE_RECEIPT}`, {
    source_image: textField(IMAGE_INPUT),
    req_type: choice('图像处理方式。', AUGMENT_REQ_TYPES),
    emotion: choice('表情名称，req_type 为 emotion 时必须提供。', EMOTION_MOODS),
    prompt: textField('着色或表情处理的补充提示词。'),
    defry: bounded('integer', '着色降噪或表情减弱程度，只用于 colorize 和 emotion。', 0, 5),
    width: dimension('处理宽度（像素），默认沿用源图。'),
    height: dimension('处理高度（像素），默认沿用源图。'),
  }, ['source_image', 'req_type']),
  tool('upscale_image', `放大现有图片。默认把超过 1,048,576 像素的输入等比缩小到上游允许的范围。可能消耗 Anlas。${IMAGE_RECEIPT}`, {
    source_image: textField(IMAGE_INPUT),
    model: { ...textField('放大使用的上游模型标识。'), default: DEFAULT_UPSCALE_MODEL },
    declared_blur_sigma: { type: 'number', minimum: 0, description: '显式声明的源图模糊程度。' },
    auto_fit_1mp: { ...flag('自动把超过 1,048,576 像素的图片等比缩小，默认开启。'), default: true },
  }, ['source_image']),
  tool('encode_vibe', '为 V4 或 V4.5 编码风格参考。新编码可能消耗 Anlas。把返回的 vibe_id 放入同一模型的 vibe_references，即可复用。', {
    source_image: textField(IMAGE_INPUT),
    model: { ...choice('需要与之后出图使用的模型相同，默认 V4.5 Full。', ENCODE_VIBE_MODELS), default: 'nai-diffusion-4-5-full' },
    information_extracted: { ...unit('提取比例，默认 1。'), default: 1 },
    mask_image: textField(`可选的参考遮罩。${IMAGE_INPUT}`),
    crop_to_mask: flag('编码时裁剪到遮罩区域。启用时需提供 mask_image。'),
    include_raw_base64: { ...flag('同时返回原始 Base64 编码，默认只返回可复用 ID。'), default: false },
  }, ['source_image']),
  tool('suggest_tags', '按当前提示词查询可用标签，辅助编写 NovelAI 图像提示词。返回标签 JSON。', {
    prompt: { ...textField('需要补全的提示词片段。'), minLength: 1 },
    model: generationFields.model,
    lang: { ...choice('标签语言，默认 en。', ['en', 'jp']), default: 'en' },
    limit: { ...bounded('integer', '最多返回的标签数，默认 20。', 1, 100), default: 20 },
  }, ['prompt'], true),
  tool('get_subscription', '查看当前 NovelAI 订阅、到期时间、固定及购买的 Anlas 余额和 V5 额度使用情况。', {}, [], true),
  tool('list_archived_images', `查询归档图片。指定 image_id 时返回单图元数据与 PNG 内嵌参数，否则按时间倒序列出最近归档。${IMAGE_RECEIPT}`, {
    image_id: textField('归档回执中的 43 位 image_id，或本站的完整图片链接。'),
    limit: { ...bounded('integer', '返回最近几张图，默认 10，最多 50。', 1, 50), default: 10 },
  }, [], true, false),
];

export const TOOL_COUNT = TOOLS.length;

const validator = new Ajv({ ownProperties: true });
const toolValidators = new Map(TOOLS.map(definition => [definition.name, validator.compile(definition.inputSchema)]));

interface GenerationArguments {
  base_prompt: string;
  base_negative_prompt?: string;
  characters?: { prompt: string; negative_prompt?: string; center_x?: number; center_y?: number }[];
  model?: Model;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  n_samples?: number;
  scale?: number;
  cfg_rescale?: number;
  sampler?: ImageGenerationParams['sampler'];
  noise_schedule?: ImageGenerationParams['noise_schedule'];
  variety_plus?: boolean;
  skip_cfg_above_sigma?: number;
  use_coords?: boolean;
  quality_preset?: ImageGenerationParams['qualityPresetId'];
  uc_preset?: ImageGenerationParams['ucPresetId'];
  transparent_background?: boolean;
  image_format?: ImageGenerationParams['image_format'];
  smea?: boolean;
  smea_dyn?: boolean;
  auto_smea?: boolean;
  dynamic_thresholding?: boolean;
  uncond_scale?: number;
  legacy_uc?: boolean;
  character_references?: CharacterReferenceInput[];
  vibe_references?: VibeReferenceInput[];
  normalize_vibe_strength?: boolean;
  source_image?: string;
  strength?: number;
  noise?: number;
  color_correct?: boolean;
  extra_noise_seed?: number;
  mask_image?: string;
  mask_regions?: MaskRegion[];
  inpaint_strength?: number;
  add_original_image?: boolean;
}

interface ReceiptMetadata {
  tool: string;
  action: string;
  model?: string;
  width?: number;
  height?: number;
  seed?: number;
  prompt_preview?: string;
  note?: string;
}

export interface NovelAIMcpServerOptions {
  client: Pick<NovelAIClient, 'generateImage' | 'augmentImage' | 'upscaleImage' | 'encodeVibe' | 'suggestTags' | 'getSubscription'>;
  archiveDir?: string;
  imageOrigin?: URL;
  allowLocalFiles?: boolean;
  transportLabel?: string;
  vibeCache?: VibeCache;
}

function normalizeLegacyGenerateArguments(args: Record<string, unknown>): void {
  args.base_prompt ||= args.prompt || args.input;
  if (args.characters && typeof args.characters === 'object' && !Array.isArray(args.characters)) {
    args.characters = [args.characters];
  }
  if (Array.isArray(args.characters)) {
    args.characters = args.characters.map((character: unknown) => {
      if (!character || typeof character !== 'object' || Array.isArray(character)) return character;
      const input = character as Record<string, unknown>;
      return { ...input, center_x: input.center_x ?? 0.5, center_y: input.center_y ?? 0.5 };
    });
  }
}

function generationParams(args: GenerationArguments, action: Action): ImageGenerationParams {
  if (!args.base_prompt.trim()) throw new Error('base_prompt 不能为空');
  return {
    prompt: args.base_prompt,
    negative_prompt: args.base_negative_prompt || DEFAULT_NEGATIVE_PROMPT,
    action,
    model: args.model,
    steps: args.steps,
    seed: args.seed,
    n_samples: args.n_samples,
    scale: args.scale,
    cfg_rescale: args.cfg_rescale,
    sampler: args.sampler,
    noise_schedule: args.noise_schedule,
    variety_plus: args.variety_plus,
    skip_cfg_above_sigma: args.skip_cfg_above_sigma,
    use_coords: args.use_coords,
    qualityPresetId: args.quality_preset,
    ucPresetId: args.uc_preset,
    transparent_background: args.transparent_background,
    image_format: args.image_format,
    sm: args.smea,
    sm_dyn: args.smea_dyn,
    autoSmea: args.auto_smea,
    dynamic_thresholding: args.dynamic_thresholding,
    uncond_scale: args.uncond_scale,
    legacy_uc: args.legacy_uc,
    characterPrompts: args.characters?.map(character => ({
      prompt: character.prompt,
      uc: character.negative_prompt ?? '',
      center: { x: character.center_x ?? 0.5, y: character.center_y ?? 0.5 },
      enabled: true,
    })),
    characterReferences: args.character_references,
    vibeReferences: args.vibe_references,
    normalize_reference_strength_multiple: args.normalize_vibe_strength,
  };
}

function imageUrl(origin: URL | undefined, id: string, ext: ImageExtension): string | undefined {
  return origin ? new URL(`${IMAGE_PATH}${id}.${ext}`, origin).href : undefined;
}

function asText(text: string) {
  return { type: 'text' as const, text };
}

function asJson(value: object): CallToolResult {
  return { content: [asText(JSON.stringify(value))] };
}

function checkGenerationSize(width: number, height: number): void {
  if (width * height > MAX_GENERATION_PIXELS) {
    throw new Error('图片最多支持 3,145,728 像素，请缩小宽度或高度');
  }
}

function checkVibeReference(ref: VibeReferenceInput, requiresEncoding: boolean): void {
  if ([ref.image, ref.encoded_vibe, ref.vibe_id].filter(Boolean).length !== 1) {
    throw new Error('每个 Vibe 参考必须提供 image、vibe_id 或 encoded_vibe 中的一项');
  }
  if (!requiresEncoding && !ref.image) throw new Error('V3 Vibe 只接受源参考图 image');
  if (ref.encoded_vibe && (
    ref.encoded_vibe.length > MAX_REFERENCE_BYTES ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(ref.encoded_vibe) || ref.encoded_vibe.length % 4 === 1
  )) {
    throw new Error('encoded_vibe 必须是有效的纯 Base64 编码');
  }
}

export function createNovelAIMcpServer(options: NovelAIMcpServerOptions): Server {
  const { client, archiveDir, imageOrigin, transportLabel = 'MCP' } = options;
  const vibeCache = options.vibeCache ?? new VibeCache(archiveDir);
  const readImage = (input: string) => resolveImageInput(input, options);

  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, {
    capabilities: { tools: {} },
    instructions: '使用 NovelAI 将文字转成图片或编辑已有图片。最近的结果可通过归档 ID 再次用于绘图。',
  });

  async function receipt(images: UnpackedImage[], meta: ReceiptMetadata, vibeIds: string[] = []): Promise<CallToolResult> {
    const lines = [`NovelAI 已返回 ${images.length} 张图片。`];
    const content: CallToolResult['content'] = [];
    for (const [index, image] of images.entries()) {
      const dimensions = await getImageDimensions(image.buffer).catch(() => undefined);
      const comment = image.ext === 'png' ? extractPngTextMetadata(image.buffer).Comment : undefined;
      const embeddedSeed = comment && typeof comment === 'object' && 'seed' in comment && typeof comment.seed === 'number'
        ? comment.seed
        : undefined;
      const outputSeed = image.seed ?? embeddedSeed;
      const metadata = {
        ...meta,
        width: dimensions?.width ?? meta.width,
        height: dimensions?.height ?? meta.height,
        seed: outputSeed ?? meta.seed,
      };
      const parts = [`图 ${index + 1}`];
      if (metadata.model) parts.push(`模型 ${metadata.model}`);
      if (metadata.width !== undefined && metadata.height !== undefined) parts.push(`${metadata.width}×${metadata.height}`);
      if (metadata.seed !== undefined) parts.push(`${outputSeed === undefined ? '请求 ' : ''}seed ${metadata.seed}`);
      if (archiveDir) {
        try {
          const archived = await saveArchivedImage(archiveDir, image.buffer, metadata);
          const url = imageUrl(imageOrigin, archived.id, archived.ext);
          parts.push(`image_id ${archived.id}`);
          if (url) parts.push(`[查看或下载图片](${url})`);
        } catch {
          console.error(`[${transportLabel}] 写入图片归档失败`);
          parts.push('服务器保存失败，本张没有下载链接。原始图像已随该回执返回，请勿为同一结果自动重新出图。');
        }
      }
      lines.push(parts.join(' · '));
      content.push({ type: 'image', mimeType: image.mimeType, data: image.buffer.toString('base64') });
    }
    if (meta.note) lines.push(meta.note);
    if (vibeIds.length > 0) lines.push(`可复用的 vibe_id：${[...new Set(vibeIds)].join('、')}。`);
    return { content: [asText(lines.join('\n')), ...content] };
  }

  async function encodeReference(
    image: Buffer, model: Model, informationExtracted: number, mask?: Buffer, cropToMask?: boolean,
  ) {
    const normalizedImage = await ensurePngBuffer(image);
    const normalizedMask = mask ? await ensurePngBuffer(mask) : undefined;
    const info = Number(informationExtracted.toFixed(4));
    const key = vibeCacheKey(normalizedImage, model, info, normalizedMask, cropToMask);
    return vibeCache.getOrEncode(key, model, info, () => client.encodeVibe({
      image: normalizedImage.toString('base64'), model, information_extracted: info,
      mask: normalizedMask?.toString('base64'), crop_to_mask: cropToMask,
    }));
  }

  async function generate(name: string, args: GenerationArguments, action: Action): Promise<CallToolResult> {
    const params = generationParams(args, action);
    const { requestedModel, capability } = resolveGenerationModel(params.model, action);
    validateGenerationFeatures(params, capability);
    if (action === 'infill' && !args.mask_image && !args.mask_regions?.length) {
      throw new Error('请提供 mask_image 或至少一个 mask_regions');
    }
    for (const ref of params.vibeReferences ?? []) checkVibeReference(ref, capability.vibeRequiresEncode);

    const source = action !== 'generate' && args.source_image ? await readImage(args.source_image) : undefined;
    const sourceSize = source ? await getImageDimensions(source) : undefined;
    const width = alignDimension(args.width ?? sourceSize?.width ?? 832);
    const height = alignDimension(args.height ?? sourceSize?.height ?? 1216);
    checkGenerationSize(width, height);
    params.width = width;
    params.height = height;
    if (source) params.image = (await prepareImg2ImgImage(source, width, height)).toString('base64');
    if (action === 'img2img') {
      params.strength = args.strength;
      params.noise = args.noise;
      params.color_correct = args.color_correct;
      params.extra_noise_seed = args.extra_noise_seed;
    } else if (action === 'infill') {
      const mask = args.mask_image
        ? await prepareInpaintMask(await readImage(args.mask_image), width, height)
        : await generateMaskFromRegions(width, height, args.mask_regions ?? []);
      params.mask = mask.toString('base64');
      params.add_original_image = args.add_original_image;
      params.inpaintImg2ImgStrength = args.inpaint_strength;
      params.noise = args.noise;
    }

    let referenceBytes = 0;
    const reserve = (bytes: number) => {
      referenceBytes += bytes;
      if (referenceBytes > MAX_REFERENCE_BYTES) throw new Error('参考图合计大于 40 MiB，请缩小图片或用 vibe_id 复用编码');
    };

    const precise: CharacterReferenceInput[] = [];
    for (const ref of params.characterReferences ?? []) {
      const image = await preparePreciseReferenceImage(await readImage(ref.image));
      reserve(image.length);
      precise.push({ ...ref, image: image.toString('base64') });
    }
    if (params.characterReferences) params.characterReferences = precise;

    const vibeIds: string[] = [];
    const preparedVibes: VibeReferenceInput[] = [];
    const rawVibes: { index: number; image: Buffer; informationExtracted: number }[] = [];
    for (const [index, ref] of (params.vibeReferences ?? []).entries()) {
      if (ref.vibe_id) {
        const cached = await vibeCache.getById(ref.vibe_id);
        if (!cached) throw new Error('找不到该 vibe_id，请重新提供源参考图或通过 encode_vibe 编码');
        if (cached.model !== requestedModel) throw new Error('vibe_id 的编码模型与本次模型不同，请用同一模型重新编码');
        if (ref.information_extracted !== undefined && Number(ref.information_extracted.toFixed(4)) !== cached.information_extracted) {
          throw new Error('vibe_id 已固定信息提取比例，请调整比例后重新编码源图');
        }
        reserve(cached.encoded_vibe.length);
        vibeIds.push(cached.id);
        preparedVibes.push({ strength: ref.strength, encoded_vibe: cached.encoded_vibe });
      } else if (ref.encoded_vibe) {
        reserve(ref.encoded_vibe.length);
        preparedVibes.push({ strength: ref.strength, encoded_vibe: ref.encoded_vibe });
      } else if (ref.image) {
        const image = await readImage(ref.image);
        if (capability.vibeRequiresEncode) {
          reserve(image.length);
          rawVibes.push({ index, image, informationExtracted: ref.information_extracted ?? 1 });
          preparedVibes.push({ strength: ref.strength });
        } else {
          const prepared = await prepareV3VibeImage(image);
          reserve(prepared.length);
          preparedVibes.push({ ...ref, image: prepared.toString('base64') });
        }
      }
    }
    // 先验证全部输入，再调用可能计费的编码接口。
    for (const ref of rawVibes) {
      const cached = await encodeReference(ref.image, requestedModel, ref.informationExtracted);
      preparedVibes[ref.index].encoded_vibe = cached.encoded_vibe;
      vibeIds.push(cached.id);
    }
    if (params.vibeReferences) params.vibeReferences = preparedVibes;

    const generated = await client.generateImage(params);
    return receipt(generated.images, {
      tool: name, action, model: generated.model, width, height, seed: generated.seed,
      prompt_preview: params.prompt.slice(0, 240), note: generated.fallbackNotice,
    }, vibeIds);
  }

  async function augment(args: {
    source_image: string; req_type: AugmentReqType; emotion?: EmotionMood;
    prompt?: string; defry?: number; width?: number; height?: number;
  }): Promise<CallToolResult> {
    if (args.req_type === 'emotion' && !args.emotion) throw new Error('req_type 为 emotion 时必须提供 emotion');
    const source = await readImage(args.source_image);
    const size = await getImageDimensions(source);
    const width = args.width ?? size.width;
    const height = args.height ?? size.height;
    const image = width !== size.width || height !== size.height
      ? await prepareImg2ImgImage(source, width, height) : await ensurePngBuffer(source);
    const images = await client.augmentImage({
      image: image.toString('base64'), req_type: args.req_type, emotion: args.emotion,
      prompt: args.prompt, defry: args.defry, width, height,
    });
    return receipt(images, { tool: 'augment_image', action: args.req_type, width, height, prompt_preview: args.prompt?.slice(0, 240) });
  }

  async function upscale(args: {
    source_image: string; model?: string; declared_blur_sigma?: number; auto_fit_1mp?: boolean;
  }): Promise<CallToolResult> {
    const source = await readImage(args.source_image);
    const model = args.model ?? DEFAULT_UPSCALE_MODEL;
    let image = source;
    if (args.auto_fit_1mp !== false) {
      ({ buffer: image } = await fitImageToMaxPixels(source, UPSCALE_MAX_PIXELS));
    } else {
      const { width, height } = await getImageDimensions(source);
      if (width * height > UPSCALE_MAX_PIXELS) throw new Error('源图超过 1,048,576 像素，请启用 auto_fit_1mp 或缩小图片');
      image = await ensurePngBuffer(source);
    }
    const images = await client.upscaleImage({
      image: image.toString('base64'), model, declared_blur_sigma: args.declared_blur_sigma,
    });
    return receipt(images, { tool: 'upscale_image', action: 'upscale', model });
  }

  async function encode(args: {
    source_image: string; model?: Model; information_extracted?: number; mask_image?: string;
    crop_to_mask?: boolean; include_raw_base64?: boolean;
  }): Promise<CallToolResult> {
    if (args.crop_to_mask && !args.mask_image) throw new Error('crop_to_mask 需要提供 mask_image');
    const source = await readImage(args.source_image);
    const mask = args.mask_image ? await readImage(args.mask_image) : undefined;
    const cached = await encodeReference(source, args.model ?? 'nai-diffusion-4-5-full', args.information_extracted ?? 1,
      mask, args.crop_to_mask);
    return asJson({
      vibe_id: cached.id, model: cached.model, information_extracted: cached.information_extracted,
      ...(args.include_raw_base64 ? { encoded_vibe: cached.encoded_vibe } : {}),
    });
  }

  async function archive(args: { image_id?: string; limit?: number }): Promise<CallToolResult> {
    if (!archiveDir) throw new Error('当前服务未配置图片归档目录');
    if (args.image_id !== undefined) {
      const id = extractArchiveId(args.image_id, imageOrigin);
      if (!id) throw new Error('image_id 需要是 43 位归档 ID 或本站归档图片链接');
      const { metadata, buffer, ext } = await loadArchivedImage(archiveDir, id);
      const url = imageUrl(imageOrigin, id, ext);
      const result = asJson({
        ...metadata, image_id: id, image_url: url,
        ...(ext === 'png' ? { png_metadata: extractPngTextMetadata(buffer) } : {}),
      });
      if (url) result.content.unshift(asText(`[查看或下载图片](${url})`));
      return result;
    }
    const images = await listArchivedImages(archiveDir, args.limit ?? 10);
    const entries = images.map(metadata => ({
      ...metadata, image_id: metadata.id, image_url: imageUrl(imageOrigin, metadata.id, metadata.ext ?? 'png'),
    }));
    const result = asJson({ images: entries });
    const links = entries.flatMap(entry => entry.image_url
      ? [`${entry.image_id} [查看或下载图片](${entry.image_url})`]
      : []);
    if (links.length > 0) result.content.unshift(asText(links.join('\n')));
    return result;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name } = request.params;
    try {
      const args = { ...request.params.arguments };
      if (name === 'generate_image') normalizeLegacyGenerateArguments(args);
      const validate = toolValidators.get(name);
      if (!validate) throw new Error('未知工具');
      if (!validate(args)) {
        const fields = validate.errors?.map(error => error.instancePath.replace(/^\//, '') ||
          (error.params.missingProperty as string | undefined) || '输入');
        throw new Error(`请检查工具参数 ${fields?.join('、')} 的类型、范围或必填项`);
      }
      switch (name) {
        case 'generate_image':
          return await generate(name, args as unknown as GenerationArguments, 'generate');
        case 'img2img':
          return await generate(name, args as unknown as GenerationArguments, 'img2img');
        case 'inpaint_image':
          return await generate(name, args as unknown as GenerationArguments, 'infill');
        case 'augment_image':
          return await augment(args as Parameters<typeof augment>[0]);
        case 'upscale_image':
          return await upscale(args as Parameters<typeof upscale>[0]);
        case 'encode_vibe':
          return await encode(args as Parameters<typeof encode>[0]);
        case 'suggest_tags': {
          const input = args as unknown as SuggestTagsParams & { limit?: number };
          const { tags } = await client.suggestTags({ prompt: input.prompt, model: input.model, lang: input.lang });
          return asJson({ tags: tags.slice(0, input.limit ?? 20) });
        }
        case 'get_subscription': {
          const { summary } = await client.getSubscription();
          const lines = [
            `订阅等级 ${summary.tierName}（${summary.active ? '有效' : '未生效'}）`,
            `到期时间 ${summary.expiresAt ?? '未提供'}`,
            `Anlas 共 ${summary.totalAnlas}，其中固定 ${summary.fixedAnlas}，购买 ${summary.purchasedAnlas}。`,
            summary.v5Usage
              ? `V5 额度信息 ${JSON.stringify(summary.v5Usage)}`
              : '当前订阅未提供 V5 额度使用数据。',
          ];
          return { content: [asText(lines.join('\n')), asText(JSON.stringify(summary))] };
        }
        case 'list_archived_images':
          return await archive(args);
        default:
          throw new Error('未知工具');
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      console.error(`[${transportLabel}] 工具执行失败`, TOOLS.some(definition => definition.name === name) ? name : '未知工具');
      const message = code === 'ENOENT' ? '找不到指定的图片或归档记录'
        : code ? '读取图片或归档时遇到系统错误'
          : error instanceof Error ? error.message : '工具执行失败';
      return { content: [asText(`错误：${message}`)], isError: true };
    }
  });
  return server;
}
