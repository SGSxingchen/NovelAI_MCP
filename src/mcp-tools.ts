import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema,
  ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import {
  extractArchiveId, IMAGE_PATH, listArchivedImages, loadArchivedImage, saveArchivedImage,
} from './image-archive.js';
import type { ArchiveMetadataInput } from './image-archive.js';
import {
  ensurePngBuffer, extractPngTextMetadata, fitImageToMaxPixels, generateMaskFromRegions, getImageDimensions,
  prepareImg2ImgImage, prepareInpaintMask, preparePreciseReferenceImage, prepareV3VibeImage, resolveImageInput,
} from './image-input.js';
import {
  ARTIST_ENTRY_SCHEMA, ARTIST_MIX_SYNTAXES, LibraryStore, PROMPT_ENTRY_SCHEMA, PROMPT_KINDS, formatArtistMix,
} from './library-store.js';
import type { ArtistSearch, PromptSearch } from './library-store.js';
import {
  alignDimension, ENCODE_VIBE_MODELS, MAX_SEED, MAX_VIBE_REFERENCES, MODEL_REGISTRY, resolveGenerationModel, validateGenerationFeatures,
} from './model-registry.js';
import { DEFAULT_UPSCALE_MODEL, type NovelAIClient } from './novelai-client.js';
import {
  AUGMENT_REQ_TYPES, DEFAULT_DISCLOSURE_MODE, DEFAULT_MODEL, EMOTION_MOODS, IMAGE_FORMATS, IMAGE_MODELS, NOISE_SCHEDULES,
  PRECISE_REFERENCE_TYPES, QUALITY_PRESETS, SAMPLERS, UC_PRESET_NAMES,
} from './types.js';
import type {
  Action, AugmentReqType, CharacterReferenceInput, DisclosureMode, EmotionMood, ImageExtension, ImageGenerationParams, ImageMimeType,
  MaskRegion, Model, SubscriptionSummary, SuggestTagsParams, UnpackedImage, VibeReferenceInput,
} from './types.js';
import {
  buildV5StylistPromptMessage, renderV5StylistGuide, V5_STYLE_BLUEPRINT_IDS, V5_STYLIST_FULL_GUIDE,
  V5_STYLIST_RESOURCE_URI, V5_STYLIST_TOPICS,
} from './v5-stylist.js';
import type { V5StyleBlueprintId, V5StylistTopic } from './v5-stylist.js';
import { VibeCache, vibeCacheKey } from './vibe-cache.js';

export const SERVER_NAME = 'novelai-mcp-server';
export const SERVER_VERSION = '2.0.0';

const DEFAULT_NEGATIVE_PROMPT = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry';
const DEFAULT_GENERATION_SIZE = { width: 832, height: 1216 } as const;
const MAX_DIMENSION = 49152;
const MAX_GENERATION_PIXELS = 3145728;
const UPSCALE_MAX_PIXELS = 1048576;
const MAX_REFERENCE_BYTES = 40 * 1024 * 1024;
const IMAGE_INPUT = '接受归档 ID、本站归档图片链接、公网 HTTPS 图片链接、图像 Base64 或图像数据 URI。仅标准输入输出模式支持本地文件。';
const IMAGE_RECEIPT = '展示结果中的「查看或下载图片」公网链接，每张图都保留对应链接。';
const COST_POLICY = '计费参考说明：Opus 订阅下 V3/V4/V4.5 满足总像素 ≤1,048,576（如 832×1216、1216×832、1024×1024）、steps ≤28、n_samples = 1 且未附加收费参考时免费（0 Anlas）；超像素、超过 28 步、多图或非 Opus 订阅（Paper/Tablet/Scroll）会按规格扣 Anlas。V5 系列优先消耗独立 V5 额度条，耗尽（isNegative）或超规格时转扣 Anlas。出图回执会汇报本次实际消耗的 Anlas 与余额。';
const V5_STYLIST_HINT = '设计 NovelAI V5 独特画风、去 AI 塑料感、配置阶梯画师权重、海报排版或排查风格偏移时，可先免费调用 get_v5_stylist_guide 获取 V5 风格工程指南。';

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
  model: { ...choice('出图模型。默认 V5 Curated。V3/V4/V4.5 在 Opus 下满足 ≤1,048,576 像素、≤28 步、单张免费；V5 优先消耗独立 V5 额度条，耗尽后扣 Anlas；非 Opus 订阅按规格扣 Anlas。', IMAGE_MODELS), default: DEFAULT_MODEL },
  steps: bounded('integer', '采样步数（1-50），由模型决定默认值（V4.5 默认 28，V5 默认 23，V5 Full Medium 固定 14）。Opus 免费上限为 28 步，超过 28 步开始扣 Anlas。', 1, 50),
  seed: bounded('integer', '随机种子，省略或传非正数时随机生成。', Number.MIN_SAFE_INTEGER, MAX_SEED),
  n_samples: bounded('integer', '出图数量（1-8 张）。Opus 仅 1 张在免费范围内，大于 1 张开始扣 Anlas。', 1, 8),
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
    type: 'array', description: 'V4.5 精确参考，与 vibe_references 互斥。必扣 Anlas（即使 Opus 订阅，每张参考图每张成图额外约 +5 Anlas）。',
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
    description: '最多 16 张风格参考，V5 与 V4.5 局部重绘不可用。V4/V4.5 首次编码约扣 2 Anlas，复用已缓存 vibe_id 不重复扣编码费；V3 无需编码。',
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
  tool('generate_image', `按提示词画图，默认使用 V5 Curated。${V5_STYLIST_HINT}${COST_POLICY}${IMAGE_RECEIPT}`, {
    ...generationFields,
    width: { ...dimension('图片宽度（像素），对齐到 64 的倍数，默认 832。Opus 免费上限为 width × height ≤ 1,048,576（如 832×1216、1216×832、1024×1024）。'), default: DEFAULT_GENERATION_SIZE.width },
    height: { ...dimension('图片高度（像素），对齐到 64 的倍数，默认 1216。Opus 免费上限为 width × height ≤ 1,048,576。'), default: DEFAULT_GENERATION_SIZE.height },
  }, ['base_prompt']),
  tool('img2img', `用提示词重绘源图，strength 越大改动越多。${V5_STYLIST_HINT}${COST_POLICY}${IMAGE_RECEIPT}`, {
    ...sourceFields,
    strength: unit('去噪强度，默认 0.7。'),
    color_correct: flag('校正颜色以贴近原图，默认开启。'),
    extra_noise_seed: bounded('integer', '额外噪声种子，默认沿用出图种子。', 1, MAX_SEED),
  }, ['base_prompt', 'source_image']),
  tool('inpaint_image', `重绘图中指定区域。提供 mask_image 或至少一个 mask_regions。V5 Curated 自动回退到 V4.5 Curated。${V5_STYLIST_HINT}${COST_POLICY}${IMAGE_RECEIPT}`, {
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
  tool('augment_image', `对源图抽线稿、转素描、着色、清理画面、改变表情、移除背景或调整像素。计费说明：pixel-snap 免费；bg-removal（移除背景，返回 3 张图）必扣 Anlas（即使 Opus 也收费）；其余模式在 Opus 订阅且 ≤1,048,576 像素内免费，超像素或非 Opus 扣 Anlas。${IMAGE_RECEIPT}`, {
    source_image: textField(IMAGE_INPUT),
    req_type: choice('图像处理方式。', AUGMENT_REQ_TYPES),
    emotion: choice('表情名称，req_type 为 emotion 时必须提供。', EMOTION_MOODS),
    prompt: textField('着色或表情处理的补充提示词。'),
    defry: bounded('integer', '着色降噪或表情减弱程度，只用于 colorize 和 emotion。', 0, 5),
    width: dimension('处理宽度（像素），默认沿用源图。'),
    height: dimension('处理高度（像素），默认沿用源图。'),
  }, ['source_image', 'req_type']),
  tool('upscale_image', `4 倍超分辨率放大现有图片。计费说明：必扣 Anlas（即使 Opus 订阅，按面积约消耗 1-4 Anlas）。默认把超过 1,048,576 像素的输入等比缩小到上游允许的范围。${IMAGE_RECEIPT}`, {
    source_image: textField(IMAGE_INPUT),
    model: { ...textField('放大使用的上游模型标识。'), default: DEFAULT_UPSCALE_MODEL },
    declared_blur_sigma: { type: 'number', minimum: 0, description: '显式声明的源图模糊程度。' },
    auto_fit_1mp: { ...flag('自动把超过 1,048,576 像素的图片等比缩小，默认开启。'), default: true },
  }, ['source_image']),
  tool('encode_vibe', '为 V4 或 V4.5 编码风格参考。计费说明：首次编码必扣 Anlas（即使 Opus 订阅，约 2 Anlas/次）；复用本服务缓存的 vibe_id 免费，不再重复扣编码费。把返回的 vibe_id 放入同一模型的 vibe_references 即可复用。', {
    source_image: textField(IMAGE_INPUT),
    model: { ...choice('需要与之后出图使用的模型相同，默认 V4.5 Full。', ENCODE_VIBE_MODELS), default: 'nai-diffusion-4-5-full' },
    information_extracted: { ...unit('提取比例，默认 1。'), default: 1 },
    mask_image: textField(`可选的参考遮罩。${IMAGE_INPUT}`),
    crop_to_mask: flag('编码时裁剪到遮罩区域。启用时需提供 mask_image。'),
    include_raw_base64: { ...flag('同时返回原始 Base64 编码，默认只返回可复用 ID。'), default: false },
  }, ['source_image']),
  tool('suggest_tags', '免费只读查询（0 Anlas）：按当前提示词查询可用标签，辅助编写 NovelAI 图像提示词。返回标签 JSON。', {
    prompt: { ...textField('需要补全的提示词片段。'), minLength: 1 },
    model: generationFields.model,
    lang: { ...choice('标签语言，默认 en。', ['en', 'jp']), default: 'en' },
    limit: { ...bounded('integer', '最多返回的标签数，默认 20。', 1, 100), default: 20 },
  }, ['prompt'], true),
  tool('get_subscription', '免费只读查询（0 Anlas）：查看当前 NovelAI 订阅档位（是否 Opus）、到期时间、固定及购买的 Anlas 余额和 V5 额度条状态。调用前不确定是否会扣点时可先查此工具。', {}, [], true),
  tool('list_archived_images', `免费只读查询（0 Anlas）：查询归档图片。指定 image_id 时返回单图元数据与 PNG 内嵌参数，否则按时间倒序列出最近归档。${IMAGE_RECEIPT}`, {
    image_id: textField('归档回执中的 43 位 image_id，或本站的完整图片链接。'),
    limit: { ...bounded('integer', '返回最近几张图，默认 10，最多 50。', 1, 50), default: 10 },
  }, [], true, false),
  tool('get_v5_stylist_guide', '免费只读查询（0 Anlas）：获取内置 novelai-v5-stylist 风格工程技能指南，包含 V5 Full/Curated 选型、去默认塑料滤镜、物理媒介锚点、三阶画师权重链、5 套参数化风格蓝图、自然语言构图排版、反污染负权重与 Guidance 标定规则。', {
    topic: { ...choice('按需获取的章节，默认 full 返回完整指南。', V5_STYLIST_TOPICS), default: 'full' },
    blueprint: choice('可选：直接提取某套风格蓝图及对应 MCP 推荐参数。', V5_STYLE_BLUEPRINT_IDS),
  }, [], true, false),
  tool('search_artist_library', '查询画师与混搭配方，formatted_tag 可直接用于提示词。', {
    query: textField('按名称、标签、分类或备注搜索。'),
    category: textField('按画风分类筛选。'),
    model: textField('按模型系列或模型标识筛选。'),
    mix_only: flag('仅返回混搭配方。'),
    syntax: { ...choice('权重串语法。', ARTIST_MIX_SYNTAXES), default: 'v4' },
    limit: { ...bounded('integer', '最多返回多少项。', 1, 100), default: 20 },
  }, [], true, false),
  tool('search_prompt_library', '查询提示词模板、积木和负面预设。', {
    query: textField('按标题、内容或标签搜索。'),
    kind: choice('按条目用途筛选。', PROMPT_KINDS),
    category: textField('按分类筛选。'),
    limit: { ...bounded('integer', '最多返回多少项。', 1, 100), default: 20 },
  }, [], true, false),
  tool('save_library_entry', '新增画师、混搭配方或提示词条目。', {
    target: choice('目标词库。', ['artist', 'prompt']),
    entry: { type: 'object', description: '画师填 name 和 tag 或 mixEntries，提示词填 title 和相应内容。', anyOf: [ARTIST_ENTRY_SCHEMA, PROMPT_ENTRY_SCHEMA] },
  }, ['target', 'entry'], false, false),
];

export const TOOL_COUNT = TOOLS.length;

const DISCOVERY_MODULES = [
  {
    module: 'generate', summary: '出图与编辑', actions: [
      { name: 'generate_image', summary: '按提示词生图' },
      { name: 'img2img', summary: '用提示词重绘源图' },
      { name: 'inpaint_image', summary: '局部重绘指定区域' },
    ],
  },
  {
    module: 'enhance', summary: '导演工具、放大与 Vibe 编码', actions: [
      { name: 'augment_image', summary: '导演工具，支持去背景、线稿和着色等' },
      { name: 'upscale_image', summary: '4 倍放大图片' },
      { name: 'encode_vibe', summary: '编码可复用的 Vibe 风格参考' },
    ],
  },
  {
    module: 'assist', summary: '标签联想、订阅额度与历史归档', actions: [
      { name: 'suggest_tags', summary: '联想提示词标签' },
      { name: 'get_subscription', summary: '查订阅与额度' },
      { name: 'list_archived_images', summary: '查历史归档' },
    ],
  },
  {
    module: 'guides', summary: 'V5 风格工程、计费与模型指南', actions: [
      { name: 'get_v5_stylist_guide', summary: '读取 V5 风格工程指南' },
    ],
  },
  {
    module: 'library', summary: '画师与提示词库', actions: [
      { name: 'search_artist_library', summary: '查询画师标签与混搭配方' },
      { name: 'search_prompt_library', summary: '查询模板、积木和负面预设' },
      { name: 'save_library_entry', summary: '新增画师或提示词条目' },
    ],
  },
];

const GUIDES = [
  { name: 'v5_stylist', summary: 'V5 风格工程' },
  { name: 'cost_policy', summary: 'Anlas 与 V5 额度计费' },
  { name: 'models', summary: '支持模型与默认参数' },
] as const;

const PROGRESSIVE_TOOLS = [
  tool('nai_discover', '浏览或搜索 NovelAI 动作和指南。', {
    module: choice('筛选模块。', DISCOVERY_MODULES.map(entry => entry.module)),
    query: textField('按关键词搜索。'),
  }, [], true, false),
  tool('nai_describe', '查看动作参数或读取指南。', {
    actions: { type: 'array', items: { type: 'string' }, maxItems: TOOL_COUNT },
    guide: choice('选择指南。', GUIDES.map(entry => entry.name)),
    topic: choice('V5 指南章节。', V5_STYLIST_TOPICS),
    blueprint: choice('V5 风格蓝图。', V5_STYLE_BLUEPRINT_IDS),
  }, [], true, false),
  tool('nai_execute', '执行指定动作，可能消耗 Anlas。', {
    action: { type: 'string', minLength: 1 },
    params: { type: 'object' },
  }, ['action']),
];

export const PROGRESSIVE_TOOL_COUNT = PROGRESSIVE_TOOLS.length;

export function getDisclosureMetrics() {
  const progressiveBytes = Buffer.byteLength(JSON.stringify({ tools: PROGRESSIVE_TOOLS }));
  const legacyBytes = Buffer.byteLength(JSON.stringify({ tools: TOOLS }));
  return {
    progressiveTools: PROGRESSIVE_TOOL_COUNT, legacyTools: TOOL_COUNT, progressiveBytes, legacyBytes,
    estimatedSavedPercent: (1 - progressiveBytes / legacyBytes) * 100,
  };
}

const validator = new Ajv({ ownProperties: true });
const actionsByName = new Map(TOOLS.map(definition => [definition.name, {
  definition, validate: validator.compile(definition.inputSchema),
}]));
const progressiveValidators = new Map(PROGRESSIVE_TOOLS.map(definition => [definition.name, validator.compile(definition.inputSchema)]));

interface DescribeArguments {
  actions?: string[];
  guide?: (typeof GUIDES)[number]['name'];
  topic?: V5StylistTopic;
  blueprint?: V5StyleBlueprintId;
}

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

interface ImageActionReceipt {
  items: (ArchiveMetadataInput & { id: string; ext: ImageExtension; mime_type: ImageMimeType })[];
  images: UnpackedImage[];
  text: string;
  costText: string;
  anlasSpent?: number;
}

const IMAGE_ACTIONS = ['generate_image', 'img2img', 'inpaint_image', 'augment_image', 'upscale_image'] as const;
type ImageActionName = (typeof IMAGE_ACTIONS)[number];

export function isImageAction(value: unknown): value is ImageActionName {
  return IMAGE_ACTIONS.some(action => action === value);
}

export interface ActionExecutorOptions {
  client: Pick<NovelAIClient, 'generateImage' | 'augmentImage' | 'upscaleImage' | 'encodeVibe' | 'suggestTags' | 'getSubscription'>;
  archiveDir?: string;
  imageOrigin?: URL;
  allowLocalFiles?: boolean;
  transportLabel?: string;
  vibeCache?: VibeCache;
  linkContext?: { id?: string; label: string };
}

export interface NovelAIMcpServerOptions extends ActionExecutorOptions {
  disclosureMode?: DisclosureMode;
  libraryStore?: LibraryStore;
  onToolCompleted?: (event: { tool: string; anlasSpent?: number }) => void;
}

export class ActionInputError extends Error {}

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
  if (!args.base_prompt.trim()) throw new ActionInputError('base_prompt 不能为空');
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

function validateToolArguments(validate: ValidateFunction | undefined, args: Record<string, unknown>): void {
  if (!validate) throw new ActionInputError('未知工具');
  if (!validate(args)) {
    const fields = validate.errors?.map(error => error.instancePath.replace(/^\//, '') ||
      (error.params.missingProperty as string | undefined) || '输入');
    throw new ActionInputError(`请检查工具参数 ${fields?.join('、')} 的类型、范围或必填项`);
  }
}

function discoverTools({ module, query }: { module?: string; query?: string }): CallToolResult {
  const keyword = query?.trim().toLowerCase();
  const modules = DISCOVERY_MODULES.flatMap(entry => {
    if (module && module !== entry.module) return [];
    const matches = ({ name, summary }: { name: string; summary: string }) => (
      !keyword || keyword === entry.module || keyword === entry.summary.toLowerCase()
      || `${name} ${summary}`.toLowerCase().includes(keyword)
    );
    const actions = entry.actions.filter(matches);
    const guides = entry.module === 'guides' ? GUIDES.filter(matches) : [];
    if (!actions.length && !guides.length) return [];
    return [{ module: entry.module, summary: entry.summary, actions, ...(guides.length ? { guides } : {}) }];
  });
  return asJson({ modules });
}

function describeTools({ actions = [], guide, topic, blueprint }: DescribeArguments): CallToolResult {
  const descriptions = [...new Set(actions)].map(name => {
    const action = actionsByName.get(name);
    if (!action) throw new Error('未知动作，请先调用 nai_discover');
    const { definition } = action;
    return {
      name,
      description: definition.description?.replace(V5_STYLIST_HINT, '').replace(COST_POLICY, ''),
      inputSchema: definition.inputSchema,
    };
  });
  const content: CallToolResult['content'] = [];
  if (guide === undefined || descriptions.length > 0) content.push(asText(JSON.stringify({ actions: descriptions })));
  switch (guide) {
    case 'v5_stylist':
      content.push(asText(renderV5StylistGuide({ topic, blueprint })));
      break;
    case 'cost_policy':
      content.push(asText(COST_POLICY));
      break;
    case 'models': {
      const models = IMAGE_MODELS.map(model => {
        const { defaultSteps, defaultScale, inpaintingModel } = MODEL_REGISTRY[model];
        return { model, steps: defaultSteps, scale: defaultScale, inpaintingModel };
      });
      content.push(asText(JSON.stringify({ defaultModel: DEFAULT_MODEL, generationSize: DEFAULT_GENERATION_SIZE, models })));
      break;
    }
  }
  return { content };
}

function checkGenerationSize(width: number, height: number): void {
  if (width * height > MAX_GENERATION_PIXELS) {
    throw new ActionInputError('图片最多支持 3,145,728 像素，请缩小宽度或高度');
  }
}

function checkVibeReference(ref: VibeReferenceInput, requiresEncoding: boolean): void {
  if ([ref.image, ref.encoded_vibe, ref.vibe_id].filter(Boolean).length !== 1) {
    throw new ActionInputError('每个 Vibe 参考必须提供 image、vibe_id 或 encoded_vibe 中的一项');
  }
  if (!requiresEncoding && !ref.image) throw new ActionInputError('V3 Vibe 只接受源参考图 image');
  if (ref.encoded_vibe && (
    ref.encoded_vibe.length > MAX_REFERENCE_BYTES ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(ref.encoded_vibe) || ref.encoded_vibe.length % 4 === 1
  )) {
    throw new ActionInputError('encoded_vibe 必须是有效的纯 Base64 编码');
  }
}

interface UsageCostSummary {
  totalSpent: number;
  perImage: number;
  remainingTotal: number;
  remainingFixed: number;
  remainingPurchased: number;
  v5Note?: string;
  line: string;
}

function summarizeUsageCost(
  before: SubscriptionSummary | undefined,
  after: SubscriptionSummary | undefined,
  imageCount: number,
): UsageCostSummary | undefined {
  if (!before || !after) return undefined;
  const totalSpent = Math.max(0, before.totalAnlas - after.totalAnlas);
  const perImage = imageCount > 0 ? Number((totalSpent / imageCount).toFixed(2)) : totalSpent;
  const v5Parts: string[] = [];
  if (before.v5Usage && after.v5Usage) {
    if (before.v5Usage.percent !== after.v5Usage.percent) {
      v5Parts.push(`V5 额度条 ${before.v5Usage.percent}% → ${after.v5Usage.percent}%`);
    }
    if (before.v5Usage.purchasedPercent !== after.v5Usage.purchasedPercent) {
      v5Parts.push(`V5 购买额度 ${before.v5Usage.purchasedPercent}% → ${after.v5Usage.purchasedPercent}%`);
    }
  }
  const v5Note = v5Parts.length > 0 ? `（${v5Parts.join('，')}）` : '';
  const spendText = imageCount > 1
    ? `共 ${totalSpent} Anlas（${imageCount} 张，约 ${perImage} Anlas/张）`
    : `${totalSpent} Anlas`;
  const freeBadge = totalSpent === 0 && v5Parts.length === 0 ? '（免费）' : '';
  const line = `本次消耗：${spendText}${freeBadge}${v5Note}，当前剩余 ${after.totalAnlas} Anlas（固定 ${after.fixedAnlas} + 购买 ${after.purchasedAnlas}）。`;
  return {
    totalSpent,
    perImage,
    remainingTotal: after.totalAnlas,
    remainingFixed: after.fixedAnlas,
    remainingPurchased: after.purchasedAnlas,
    v5Note: v5Parts.length > 0 ? v5Parts.join('，') : undefined,
    line,
  };
}

export function createActionExecutor(options: ActionExecutorOptions) {
  const { client, archiveDir, imageOrigin, transportLabel = 'MCP', linkContext } = options;
  const vibeCache = options.vibeCache ?? new VibeCache(archiveDir);
  const readImage = (input: string) => resolveImageInput(input, options);

  async function captureSubscription(): Promise<SubscriptionSummary | undefined> {
    if (typeof client.getSubscription !== 'function') return undefined;
    try {
      const { summary } = await client.getSubscription();
      return summary;
    } catch {
      return undefined;
    }
  }

  async function receipt(
    images: UnpackedImage[],
    meta: ReceiptMetadata,
    vibeIds: string[] = [],
    usage?: UsageCostSummary,
  ): Promise<ImageActionReceipt> {
    const lines = [`NovelAI 已返回 ${images.length} 张图片。`];
    const items: ImageActionReceipt['items'] = [];
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
        ...(usage ? { anlas_spent: usage.perImage } : {}),
        ...(linkContext ? { link_id: linkContext.id, link_label: linkContext.label } : {}),
      };
      const parts = [`图 ${index + 1}`];
      if (metadata.model) parts.push(`模型 ${metadata.model}`);
      if (metadata.width !== undefined && metadata.height !== undefined) parts.push(`${metadata.width}×${metadata.height}`);
      if (metadata.seed !== undefined) parts.push(`${outputSeed === undefined ? '请求 ' : ''}seed ${metadata.seed}`);
      if (usage) {
        parts.push(images.length > 1 ? `约 ${usage.perImage} Anlas/张` : `消耗 ${usage.totalSpent} Anlas`);
      }
      if (archiveDir) {
        try {
          const archived = await saveArchivedImage(archiveDir, image.buffer, metadata);
          items.push({ ...metadata, id: archived.id, ext: archived.ext, mime_type: archived.mimeType });
          const url = imageUrl(imageOrigin, archived.id, archived.ext);
          parts.push(`image_id ${archived.id}`);
          if (url) parts.push(`[查看或下载图片](${url})`);
        } catch {
          console.error(`[${transportLabel}] 写入图片归档失败`);
          parts.push('服务器保存失败，本张没有下载链接。请勿为同一结果自动重新出图。');
        }
      }
      lines.push(parts.join(' · '));
    }
    if (usage) lines.push(usage.line);
    if (meta.note) lines.push(meta.note);
    if (vibeIds.length > 0) lines.push(`可复用的 vibe_id：${[...new Set(vibeIds)].join('、')}。`);
    return { items, images, text: lines.join('\n'), costText: usage?.line ?? '', anlasSpent: usage?.totalSpent };
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

  async function generate(name: string, args: GenerationArguments, action: Action): Promise<ImageActionReceipt> {
    const params = generationParams(args, action);
    const { requestedModel, capability } = resolveGenerationModel(params.model, action);
    try {
      validateGenerationFeatures(params, capability);
    } catch (error) {
      if (error instanceof Error) throw new ActionInputError(error.message);
      throw error;
    }
    if (action === 'infill' && !args.mask_image && !args.mask_regions?.length) {
      throw new ActionInputError('请提供 mask_image 或至少一个 mask_regions');
    }
    for (const ref of params.vibeReferences ?? []) checkVibeReference(ref, capability.vibeRequiresEncode);

    const source = action !== 'generate' && args.source_image ? await readImage(args.source_image) : undefined;
    const sourceSize = source ? await getImageDimensions(source) : undefined;
    const width = alignDimension(args.width ?? sourceSize?.width ?? DEFAULT_GENERATION_SIZE.width);
    const height = alignDimension(args.height ?? sourceSize?.height ?? DEFAULT_GENERATION_SIZE.height);
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
      if (referenceBytes > MAX_REFERENCE_BYTES) throw new ActionInputError('参考图合计大于 40 MiB，请缩小图片或用 vibe_id 复用编码');
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
        if (!cached) throw new ActionInputError('找不到该 vibe_id，请重新提供源参考图或通过 encode_vibe 编码');
        if (cached.model !== requestedModel) throw new ActionInputError('vibe_id 的编码模型与本次模型不同，请用同一模型重新编码');
        if (ref.information_extracted !== undefined && Number(ref.information_extracted.toFixed(4)) !== cached.information_extracted) {
          throw new ActionInputError('vibe_id 已固定信息提取比例，请调整比例后重新编码源图');
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
    const beforeSub = await captureSubscription();
    // 先验证全部输入，再调用可能计费的编码接口。
    for (const ref of rawVibes) {
      const cached = await encodeReference(ref.image, requestedModel, ref.informationExtracted);
      preparedVibes[ref.index].encoded_vibe = cached.encoded_vibe;
      vibeIds.push(cached.id);
    }
    if (params.vibeReferences) params.vibeReferences = preparedVibes;

    const generated = await client.generateImage(params);
    const afterSub = beforeSub ? await captureSubscription() : undefined;
    const usage = summarizeUsageCost(beforeSub, afterSub, generated.images.length);
    return receipt(generated.images, {
      tool: name, action, model: generated.model, width, height, seed: generated.seed,
      prompt_preview: params.prompt.slice(0, 240), note: generated.fallbackNotice,
    }, vibeIds, usage);
  }

  async function augment(args: {
    source_image: string; req_type: AugmentReqType; emotion?: EmotionMood;
    prompt?: string; defry?: number; width?: number; height?: number;
  }): Promise<ImageActionReceipt> {
    if (args.req_type === 'emotion' && !args.emotion) throw new ActionInputError('req_type 为 emotion 时必须提供 emotion');
    const source = await readImage(args.source_image);
    const size = await getImageDimensions(source);
    const width = args.width ?? size.width;
    const height = args.height ?? size.height;
    const image = width !== size.width || height !== size.height
      ? await prepareImg2ImgImage(source, width, height) : await ensurePngBuffer(source);
    const beforeSub = await captureSubscription();
    const images = await client.augmentImage({
      image: image.toString('base64'), req_type: args.req_type, emotion: args.emotion,
      prompt: args.prompt, defry: args.defry, width, height,
    });
    const afterSub = beforeSub ? await captureSubscription() : undefined;
    const usage = summarizeUsageCost(beforeSub, afterSub, images.length);
    return receipt(images, { tool: 'augment_image', action: args.req_type, width, height, prompt_preview: args.prompt?.slice(0, 240) }, [], usage);
  }

  async function upscale(args: {
    source_image: string; model?: string; declared_blur_sigma?: number; auto_fit_1mp?: boolean;
  }): Promise<ImageActionReceipt> {
    const source = await readImage(args.source_image);
    const model = args.model ?? DEFAULT_UPSCALE_MODEL;
    let image = source;
    if (args.auto_fit_1mp !== false) {
      ({ buffer: image } = await fitImageToMaxPixels(source, UPSCALE_MAX_PIXELS));
    } else {
      const { width, height } = await getImageDimensions(source);
      if (width * height > UPSCALE_MAX_PIXELS) throw new ActionInputError('源图超过 1,048,576 像素，请启用 auto_fit_1mp 或缩小图片');
      image = await ensurePngBuffer(source);
    }
    const beforeSub = await captureSubscription();
    const images = await client.upscaleImage({
      image: image.toString('base64'), model, declared_blur_sigma: args.declared_blur_sigma,
    });
    const afterSub = beforeSub ? await captureSubscription() : undefined;
    const usage = summarizeUsageCost(beforeSub, afterSub, images.length);
    return receipt(images, { tool: 'upscale_image', action: 'upscale', model }, [], usage);
  }

  async function encode(args: {
    source_image: string; model?: Model; information_extracted?: number; mask_image?: string;
    crop_to_mask?: boolean; include_raw_base64?: boolean;
  }) {
    if (args.crop_to_mask && !args.mask_image) throw new ActionInputError('crop_to_mask 需要提供 mask_image');
    const source = await readImage(args.source_image);
    const mask = args.mask_image ? await readImage(args.mask_image) : undefined;
    const beforeSub = await captureSubscription();
    const cached = await encodeReference(source, args.model ?? 'nai-diffusion-4-5-full', args.information_extracted ?? 1,
      mask, args.crop_to_mask);
    const afterSub = beforeSub ? await captureSubscription() : undefined;
    const usage = summarizeUsageCost(beforeSub, afterSub, 1);
    return {
      vibe_id: cached.id, model: cached.model, information_extracted: cached.information_extracted,
      ...(args.include_raw_base64 ? { encoded_vibe: cached.encoded_vibe } : {}),
      ...(usage ? { anlas_spent: usage.totalSpent, remaining_anlas: usage.remainingTotal } : {}),
    };
  }

  function runImage(name: ImageActionName, input: Record<string, unknown>): Promise<ImageActionReceipt> {
    const args = { ...input };
    if (name === 'generate_image') normalizeLegacyGenerateArguments(args);
    validateToolArguments(actionsByName.get(name)?.validate, args);
    switch (name) {
      case 'generate_image':
        return generate(name, args as unknown as GenerationArguments, 'generate');
      case 'img2img':
        return generate(name, args as unknown as GenerationArguments, 'img2img');
      case 'inpaint_image':
        return generate(name, args as unknown as GenerationArguments, 'infill');
      case 'augment_image':
        return augment(args as Parameters<typeof augment>[0]);
      case 'upscale_image':
        return upscale(args as Parameters<typeof upscale>[0]);
    }
  }

  async function suggestTags(args: Record<string, unknown>) {
    validateToolArguments(actionsByName.get('suggest_tags')?.validate, args);
    const { prompt, model, lang, limit = 20 } = args as unknown as SuggestTagsParams & { limit?: number };
    const { tags } = await client.suggestTags({ prompt, model, lang });
    return { tags: tags.slice(0, limit) };
  }

  return { runImage, suggestTags, encodeVibe: encode };
}

export function createNovelAIMcpServer(options: NovelAIMcpServerOptions): Server {
  const {
    client, archiveDir, imageOrigin, transportLabel = 'MCP', onToolCompleted, disclosureMode = DEFAULT_DISCLOSURE_MODE,
    libraryStore = new LibraryStore(archiveDir),
  } = options;
  const executor = createActionExecutor(options);
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, {
    capabilities: { tools: {}, prompts: {}, resources: {} },
    instructions: disclosureMode === 'legacy'
      ? '使用 NovelAI 生成或编辑图片，结果回执会返回图片链接、archive image_id 与本次实际消耗的 Anlas。设计 NovelAI V5 独特画风、去 AI 塑料感、阶梯画师配权或排查风格漂移前，可先免费调用 get_v5_stylist_guide（或读取资源 novelai://skills/v5-stylist）。'
      : '用 nai_discover 找动作，nai_describe 查参数、计费或 V5 风格指南，再用 nai_execute 执行动作。出图回执包含图片链接、归档 ID 与实际 Anlas 消耗。',
  });

  function completed(tool: string, result: CallToolResult, anlasSpent?: number): CallToolResult {
    if (!result.isError && onToolCompleted) {
      try {
        onToolCompleted(anlasSpent === undefined ? { tool } : { tool, anlasSpent });
      } catch {
        console.error(`[${transportLabel}] 更新工具使用统计失败`, tool);
      }
    }
    return result;
  }

  async function archive(args: { image_id?: string; limit?: number }): Promise<CallToolResult> {
    if (!archiveDir) throw new Error('当前服务未配置图片归档目录');
    if (args.image_id !== undefined) {
      const id = extractArchiveId(args.image_id, imageOrigin);
      if (!id) throw new Error('image_id 需要是 43 位归档 ID 或本站归档图片链接');
      const { metadata, buffer, ext } = await loadArchivedImage(archiveDir, id);
      const url = metadata.private ? undefined : imageUrl(imageOrigin, id, ext);
      const result = asJson({
        ...metadata, image_id: id, image_url: url,
        ...(ext === 'png' ? { png_metadata: extractPngTextMetadata(buffer) } : {}),
      });
      if (url) result.content.unshift(asText(`[查看或下载图片](${url})`));
      return result;
    }
    const images = await listArchivedImages(archiveDir, args.limit ?? 10, { publicOnly: true });
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: disclosureMode === 'legacy' ? TOOLS : PROGRESSIVE_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    let { name } = request.params;
    try {
      let args = { ...request.params.arguments };
      if (disclosureMode !== 'legacy') {
        validateToolArguments(progressiveValidators.get(name), args);
        if (name === 'nai_discover') return discoverTools(args);
        if (name === 'nai_describe') return describeTools(args);
        const { action, params } = args as { action: string; params?: Record<string, unknown> };
        name = action;
        args = { ...params };
      }
      if (isImageAction(name)) {
        const { images, text, anlasSpent } = await executor.runImage(name, args);
        const content: CallToolResult['content'] = [asText(text), ...images.map(image => ({
          type: 'image' as const, mimeType: image.mimeType, data: image.buffer.toString('base64'),
        }))];
        return completed(name, { content }, anlasSpent);
      }
      if (name === 'suggest_tags') return completed(name, asJson(await executor.suggestTags(args)));
      validateToolArguments(actionsByName.get(name)?.validate, args);
      switch (name) {
        case 'encode_vibe': {
          const entry = await executor.encodeVibe(args as Parameters<typeof executor.encodeVibe>[0]);
          return completed(name, asJson(entry), entry.anlas_spent);
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
          return completed(name, { content: [asText(lines.join('\n')), asText(JSON.stringify(summary))] });
        }
        case 'list_archived_images':
          return completed(name, await archive(args));
        case 'get_v5_stylist_guide': {
          const input = args as { topic?: V5StylistTopic; blueprint?: V5StyleBlueprintId };
          return completed(name, { content: [asText(renderV5StylistGuide(input))] });
        }
        case 'search_artist_library': {
          const { mix_only, syntax, ...filters } = args as ArtistSearch & {
            mix_only?: boolean; syntax?: (typeof ARTIST_MIX_SYNTAXES)[number];
          };
          const artists = await libraryStore.searchArtists({ ...filters, mixOnly: mix_only, limit: filters.limit ?? 20 });
          const items = artists.map(item => ({
            ...item,
            formatted_tag: formatArtistMix(item.isMix ? item.mixEntries : [{ tag: item.tag, weight: item.defaultWeight }], syntax),
          }));
          return completed(name, asJson({ items }));
        }
        case 'search_prompt_library': {
          const filters = args as PromptSearch;
          const items = await libraryStore.searchPrompts({ ...filters, limit: filters.limit ?? 20 });
          return completed(name, asJson({ items }));
        }
        case 'save_library_entry': {
          const item = args.target === 'artist'
            ? await libraryStore.createArtist(args.entry)
            : await libraryStore.createPrompt(args.entry);
          return completed(name, asJson({ item }));
        }
        default:
          throw new Error('未知工具');
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      console.error(`[${transportLabel}] 工具执行失败`, actionsByName.has(name) || progressiveValidators.has(name) ? name : '未知工具');
      const message = code === 'ENOENT' ? '找不到指定的图片或归档记录'
        : code ? '读取图片或归档时遇到系统错误'
          : error instanceof Error ? error.message : '工具执行失败';
      return { content: [asText(`错误：${message}`)], isError: true };
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{
      name: 'novelai-v5-stylist',
      description: 'NovelAI V5 风格工程与生产级提示词专家指南（去默认滤镜、物理媒介锚点、三阶画师权重链、自然语言构图排版与反污染调优）',
      arguments: [
        { name: 'subject', description: '可选：要绘制的主题、角色或画面内容', required: false },
        { name: 'aesthetic', description: '可选：目标美学方向或风格蓝图（如 pop halftone / nihonga / 90s cel / etching / story CG）', required: false },
        { name: 'variant', description: '可选：指定 V5 模型变体（nai-diffusion-5-full 或 nai-diffusion-5-curated）', required: false },
      ],
    }],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async request => {
    if (request.params.name !== 'novelai-v5-stylist') {
      throw new Error(`未知提示词模板：${request.params.name}`);
    }
    const promptArgs = request.params.arguments ?? {};
    return {
      description: 'NovelAI V5 风格工程专家指南（novelai-v5-stylist）',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: buildV5StylistPromptMessage({
            subject: promptArgs.subject,
            aesthetic: promptArgs.aesthetic,
            variant: promptArgs.variant,
          }),
        },
      }],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: V5_STYLIST_RESOURCE_URI,
      name: 'novelai-v5-stylist',
      title: 'NovelAI V5 风格工程指南（novelai-v5-stylist）',
      description: '完整的 NovelAI Diffusion V5 风格化设计、画师权重阶梯、5 套风格蓝图、反污染与常见坑指南',
      mimeType: 'text/markdown',
    }],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== V5_STYLIST_RESOURCE_URI) {
      throw new Error(`未知资源：${request.params.uri}`);
    }
    return {
      contents: [{
        uri: V5_STYLIST_RESOURCE_URI,
        mimeType: 'text/markdown',
        text: V5_STYLIST_FULL_GUIDE,
      }],
    };
  });

  return server;
}
