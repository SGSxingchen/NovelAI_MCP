import { randomInt } from 'node:crypto';
import { IMAGE_MODELS, resolveImageModel } from './types.js';
import type { Action, ImageGenerationParams, Model } from './types.js';

export interface ModelCapability {
  paramsVersion: 3 | 4;
  defaultSteps: number;
  defaultScale: number;
  maxCharacters: number;
  supportsVibe: boolean;
  supportsVibeInInpaint: boolean;
  vibeRequiresEncode: boolean;
  supportsPreciseRef: boolean;
  supportsTransparent: boolean;
  supportsSmea: boolean;
  supportsDecrisp: boolean;
  supportsNativeSchedule: boolean;
  varietyBase: number | null;
  preferBrownian: boolean;
  inpaintingModel: string;
  inpaintingFallbackNotice?: string;
  isV3: boolean;
  isMediumLocked: boolean;
  legacyUcDefault: boolean;
}

const v5 = {
  paramsVersion: 4,
  defaultSteps: 23,
  defaultScale: 7,
  maxCharacters: 32,
  supportsVibe: false,
  supportsVibeInInpaint: false,
  vibeRequiresEncode: false,
  supportsPreciseRef: false,
  supportsTransparent: true,
  supportsSmea: false,
  supportsDecrisp: false,
  supportsNativeSchedule: false,
  varietyBase: null,
  preferBrownian: false,
  isV3: false,
  isMediumLocked: false,
  legacyUcDefault: false,
} as const;

const v45 = {
  ...v5,
  paramsVersion: 3,
  defaultSteps: 28,
  defaultScale: 6,
  maxCharacters: 6,
  supportsVibe: true,
  vibeRequiresEncode: true,
  supportsPreciseRef: true,
  supportsTransparent: false,
  varietyBase: 58,
  preferBrownian: true,
} as const;

const v4 = {
  ...v45,
  defaultSteps: 23,
  defaultScale: 5.5,
  supportsVibeInInpaint: true,
  supportsPreciseRef: false,
  varietyBase: 19,
  legacyUcDefault: true,
} as const;

const v3 = {
  ...v4,
  defaultScale: 5,
  maxCharacters: 0,
  vibeRequiresEncode: false,
  isV3: true,
  supportsSmea: true,
  supportsDecrisp: true,
  supportsNativeSchedule: true,
  preferBrownian: false,
  legacyUcDefault: false,
} as const;

export const MODEL_REGISTRY: Readonly<Record<Model, ModelCapability>> = {
  'nai-diffusion-5-curated': {
    ...v5,
    inpaintingModel: 'nai-diffusion-4-5-curated-inpainting',
    inpaintingFallbackNotice: 'V5 Curated 官方无独立 inpainting 模型，已自动回退为 nai-diffusion-4-5-curated-inpainting（角色上限按 V4.5 限制为 6 个）。',
  },
  'nai-diffusion-5-full': { ...v5, inpaintingModel: 'nai-diffusion-5-full-inpainting' },
  'nai-diffusion-5-full-medium': {
    ...v5, defaultSteps: 14, isMediumLocked: true, inpaintingModel: 'nai-diffusion-5-full-medium-inpainting',
  },
  'nai-diffusion-4-5-full': { ...v45, inpaintingModel: 'nai-diffusion-4-5-full-inpainting' },
  'nai-diffusion-4-5-curated': { ...v45, defaultScale: 5, inpaintingModel: 'nai-diffusion-4-5-curated-inpainting' },
  'nai-diffusion-4-full': { ...v4, inpaintingModel: 'nai-diffusion-4-full-inpainting' },
  'nai-diffusion-4-curated-preview': { ...v4, inpaintingModel: 'nai-diffusion-4-curated-inpainting' },
  'nai-diffusion-3': { ...v3, inpaintingModel: 'nai-diffusion-3-inpainting' },
  'nai-diffusion-furry-3': { ...v3, defaultScale: 6.2, inpaintingModel: 'nai-diffusion-furry-3-inpainting' },
};

export const ENCODE_VIBE_MODELS = IMAGE_MODELS.filter(model => MODEL_REGISTRY[model].vibeRequiresEncode);
export const MAX_SEED = 4294967288;
export const MAX_VIBE_REFERENCES = 16;

export function computeVarietySigma(base: number, width: number, height: number): number {
  return Math.ceil(base * Math.sqrt((4 * Math.floor(width / 8) * Math.floor(height / 8)) / (4 * 104 * 152)));
}

export function normalizeSeed(seed?: number): number {
  if (seed === undefined || !Number.isFinite(seed) || seed <= 0) return randomInt(1, MAX_SEED + 1);
  return Math.max(1, Math.min(MAX_SEED, Math.trunc(seed)));
}

export function alignDimension(val: number, min = 64, max = 49152): number {
  const lower = Math.ceil(min / 64) * 64;
  const upper = Math.floor(max / 64) * 64;
  if (!Number.isFinite(val) || val <= 0 || !Number.isFinite(lower) || !Number.isFinite(upper) || lower < 64 || lower > upper) {
    throw new Error('图片尺寸和对齐范围必须为有效正数');
  }
  return Math.max(lower, Math.min(upper, Math.round(val / 64) * 64));
}

export function resolveGenerationModel(value?: unknown, action: Action = 'generate'): {
  requestedModel: Model;
  model: string;
  capability: ModelCapability;
  fallbackNotice?: string;
} {
  const requestedModel = resolveImageModel(value);
  const capability = MODEL_REGISTRY[requestedModel];
  if (action !== 'infill') return { requestedModel, model: requestedModel, capability };
  const fallbackNotice = capability.inpaintingFallbackNotice;
  return {
    requestedModel,
    model: capability.inpaintingModel,
    capability: fallbackNotice ? MODEL_REGISTRY['nai-diffusion-4-5-curated'] : capability,
    fallbackNotice,
  };
}

export function validateGenerationFeatures(params: ImageGenerationParams, capability: ModelCapability): void {
  if ((params.characterPrompts?.length ?? 0) > capability.maxCharacters) {
    throw new Error(capability.maxCharacters === 0
      ? 'V3 模型不支持独立角色提示词，请将角色描述写入 base_prompt'
      : `当前模型最多支持 ${capability.maxCharacters} 个独立角色提示词`);
  }
  if (params.transparent_background && !capability.supportsTransparent) {
    throw new Error('实际出图模型不支持透明背景，请选择支持该功能的 V5 模型');
  }
  const hasPrecise = Boolean(params.characterReferences?.length);
  const vibeCount = (params.vibeReferences?.length ?? 0) + (params.reference_image_multiple?.length ?? 0);
  if (hasPrecise && vibeCount > 0) throw new Error('精确参考与 Vibe Transfer 不能同时使用');
  if (hasPrecise && !capability.supportsPreciseRef) throw new Error('精确参考仅支持 V4.5 模型');
  if (vibeCount > MAX_VIBE_REFERENCES) throw new Error(`Vibe Transfer 最多支持 ${MAX_VIBE_REFERENCES} 张参考图`);
  if (vibeCount > 0 && !capability.supportsVibe) throw new Error('实际出图模型不支持 Vibe Transfer，请选择 V3、V4 或 V4.5');
  if (vibeCount > 0 && params.action === 'infill' && !capability.supportsVibeInInpaint) {
    throw new Error('V4.5 局部重绘不支持 Vibe Transfer，请选择 V4 或 V3');
  }
}
