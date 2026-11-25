export type DisclosureMode = 'progressive' | 'legacy';
export const DEFAULT_DISCLOSURE_MODE: DisclosureMode = 'progressive';

export function isDisclosureMode(value: unknown): value is DisclosureMode {
  return value === 'progressive' || value === 'legacy';
}

export const DEFAULT_MODEL = 'nai-diffusion-5-curated';
export const IMAGE_MODELS = [
  DEFAULT_MODEL,
  'nai-diffusion-5-full',
  'nai-diffusion-5-full-medium',
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-curated',
  'nai-diffusion-4-full',
  'nai-diffusion-4-curated-preview',
  'nai-diffusion-3',
  'nai-diffusion-furry-3',
] as const;
export type Model = (typeof IMAGE_MODELS)[number];

export function resolveImageModel(value: unknown): Model {
  if (value === undefined) return DEFAULT_MODEL;
  const model = IMAGE_MODELS.find(candidate => candidate === value);
  if (!model) throw new Error(`不支持该模型。可选模型：${IMAGE_MODELS.join('、')}`);
  return model;
}

export const SAMPLERS = [
  'k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m',
  'k_dpmpp_sde', 'k_dpmpp_2m_sde', 'k_dpm_2', 'k_dpm_fast', 'k_lms', 'pndm', 'ddim_v3', 'ddim',
] as const;
export const NOISE_SCHEDULES = ['native', 'karras', 'exponential', 'polyexponential'] as const;
export const IMAGE_FORMATS = ['png', 'webp'] as const;
export const QUALITY_PRESETS = ['standard', 'light', 'none'] as const;
export const UC_PRESET_NAMES = ['heavy', 'light', 'furry', 'human', 'none'] as const;
export const PRECISE_REFERENCE_TYPES = ['character', 'style', 'costume', 'character&style', 'character_mainoutfit', 'character&style_anyoutfit', 'delta'] as const;
export const AUGMENT_REQ_TYPES = [
  'lineart', 'sketch', 'colorize', 'declutter', 'declutter-keep-bubbles', 'emotion', 'bg-removal', 'pixel-snap',
] as const;
export const EMOTION_MOODS = [
  'neutral', 'happy', 'sad', 'angry', 'scared', 'surprised', 'tired', 'excited',
  'nervous', 'thinking', 'confused', 'shy', 'disgusted', 'smug', 'bored', 'laughing',
  'irritated', 'aroused', 'embarrassed', 'worried', 'love', 'determined', 'hurt', 'playful',
] as const;

export type Action = 'generate' | 'img2img' | 'infill';
export type Sampler = (typeof SAMPLERS)[number];
export type NoiseSchedule = (typeof NOISE_SCHEDULES)[number];
export type ImageFormat = (typeof IMAGE_FORMATS)[number];
export type ImageExtension = ImageFormat | 'jpg';
export type ImageMimeType = 'image/png' | 'image/webp' | 'image/jpeg';
export type QualityPreset = (typeof QUALITY_PRESETS)[number];
export type UcPresetName = (typeof UC_PRESET_NAMES)[number];
export type PreciseReferenceType = (typeof PRECISE_REFERENCE_TYPES)[number];
export type PreciseReferenceTypeInput = PreciseReferenceType | 'outfit';
export type AugmentReqType = (typeof AUGMENT_REQ_TYPES)[number];
export type EmotionMood = (typeof EMOTION_MOODS)[number];
export type StreamType = 'msgpack';

export interface CharacterCenter {
  x: number;
  y: number;
}

export interface CharacterCaption {
  char_caption: string;
  centers: CharacterCenter[];
}

export interface PromptCaption {
  base_caption: string;
  char_captions: CharacterCaption[];
}

export interface V4Prompt {
  caption: PromptCaption;
  use_coords: boolean;
  use_order: boolean;
}

export interface V4NegativePrompt {
  caption: PromptCaption;
  legacy_uc: boolean;
}

export interface CharacterPrompt {
  prompt: string;
  uc: string;
  center: CharacterCenter;
  enabled: boolean;
}

export interface MaskRegion {
  shape?: 'rect' | 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CharacterReferenceInput {
  image: string;
  type: PreciseReferenceTypeInput;
  prefer_same_outfit?: boolean;
  strength?: number;
  fidelity?: number;
}

export interface VibeReferenceInput {
  image?: string;
  encoded_vibe?: string;
  vibe_id?: string;
  strength?: number;
  information_extracted?: number;
}

export interface ImageGenerationParams {
  prompt: string;
  model?: Model;
  action?: Action;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  scale?: number;
  sampler?: Sampler;
  seed?: number;
  n_samples?: number;
  uncond_scale?: number;
  noise_schedule?: NoiseSchedule;
  sm?: boolean;
  sm_dyn?: boolean;
  autoSmea?: boolean;
  dynamic_thresholding?: boolean;
  cfg_rescale?: number;
  qualityToggle?: boolean;
  qualityPresetId?: QualityPreset;
  ucPreset?: number;
  ucPresetId?: UcPresetName;
  variety_plus?: boolean;
  skip_cfg_above_sigma?: number | null;
  prefer_brownian?: boolean;
  image_format?: ImageFormat;
  transparent_background?: boolean;
  characterPrompts?: CharacterPrompt[];
  use_coords?: boolean;
  legacy_uc?: boolean;
  characterReferences?: CharacterReferenceInput[];
  vibeReferences?: VibeReferenceInput[];
  image?: string;
  strength?: number;
  noise?: number;
  extra_noise_seed?: number;
  color_correct?: boolean;
  mask?: string;
  add_original_image?: boolean;
  inpaintImg2ImgStrength?: number;
  controlnet_condition?: string;
  controlnet_model?: string;
  controlnet_strength?: number;
  reference_image_multiple?: string[];
  reference_information_extracted?: number[];
  reference_information_extracted_multiple?: number[];
  reference_strength?: number;
  reference_strength_multiple?: number[];
  normalize_reference_strength_multiple?: boolean;
}

export interface NovelAIRequestPayload {
  input: string;
  model: string;
  action: Action;
  parameters: {
    params_version: number;
    width: number;
    height: number;
    scale: number;
    sampler: Sampler;
    steps: number;
    n_samples: number;
    seed: number;
    ucPreset?: number;
    ucPresetId?: UcPresetName;
    qualityToggle?: boolean;
    qualityPresetId?: QualityPreset;
    autoSmea?: boolean;
    dynamic_thresholding?: boolean;
    controlnet_strength?: number;
    legacy?: boolean;
    add_original_image?: boolean;
    cfg_rescale: number;
    noise_schedule?: NoiseSchedule;
    legacy_v3_extend?: boolean;
    skip_cfg_above_sigma: number | null;
    use_coords?: boolean;
    normalize_reference_strength_multiple?: boolean;
    inpaintImg2ImgStrength?: number;
    v4_prompt?: V4Prompt;
    v4_negative_prompt?: V4NegativePrompt;
    legacy_uc?: boolean;
    characterPrompts?: CharacterPrompt[];
    negative_prompt: string;
    deliberate_euler_ancestral_bug: boolean;
    prefer_brownian: boolean;
    image_format: ImageFormat;
    stream?: StreamType;
    [key: string]: unknown;
  };
}

export interface UnpackedImage {
  buffer: Buffer;
  ext: ImageExtension;
  mimeType: ImageMimeType;
  index?: number;
  seed?: number;
  filename?: string;
}

export interface GenerationResult {
  images: UnpackedImage[];
  seed: number;
  model: string;
  requestedModel: Model;
  fallbackNotice?: string;
  rawBuffer: Buffer;
}

export interface AugmentImageParams {
  image: string;
  req_type: AugmentReqType;
  width: number;
  height: number;
  emotion?: EmotionMood;
  prompt?: string;
  defry?: number;
}

export interface UpscaleImageParams {
  image: string;
  model?: string;
  declared_blur_sigma?: number;
}

export interface EncodeVibeParams {
  image: string;
  model: Model;
  information_extracted?: number;
  mask?: string;
  crop_to_mask?: boolean;
}

export interface SuggestTagsParams {
  prompt: string;
  model?: Model;
  lang?: 'en' | 'jp';
}

export interface TagSuggestion {
  tag: string;
  count?: number;
  [key: string]: unknown;
}

export interface SubscriptionSummary {
  tier: number;
  tierName: string;
  active: boolean;
  expiresAt: string | null;
  fixedAnlas: number;
  purchasedAnlas: number;
  totalAnlas: number;
  v5Usage: Record<string, unknown> | null;
}

export interface ImageGenerationResponse {
  event: string;
  data: string;
}

export interface NovelAIError {
  statusCode: number;
  message: string;
}
