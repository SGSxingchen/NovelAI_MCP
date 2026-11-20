import { randomInt } from 'node:crypto';
import { Readable } from 'node:stream';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch, { type Response } from 'node-fetch';
import {
  alignDimension,
  computeVarietySigma,
  ENCODE_VIBE_MODELS,
  normalizeSeed,
  resolveGenerationModel,
  validateGenerationFeatures,
} from './model-registry.js';
import { unpackImageResponse } from './response-unpack.js';
import {
  AUGMENT_REQ_TYPES,
  EMOTION_MOODS,
  PRECISE_REFERENCE_TYPES,
  resolveImageModel,
  UC_PRESET_NAMES,
} from './types.js';
import type {
  Action,
  AugmentImageParams,
  EncodeVibeParams,
  GenerationResult,
  ImageGenerationParams,
  NovelAIRequestPayload,
  SubscriptionSummary,
  SuggestTagsParams,
  TagSuggestion,
  UnpackedImage,
  UpscaleImageParams,
} from './types.js';

const API_BASE_URL = 'https://image.novelai.net';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_IMAGE_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES = 1024 * 1024;
const CORRELATION_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SUBSCRIPTION_TIERS = ['Paper', 'Tablet', 'Scroll', 'Opus'];
export const DEFAULT_UPSCALE_MODEL = 'nai-diffusion-5-full';

export interface NovelAIClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTagSuggestion(value: unknown): value is TagSuggestion {
  return isRecord(value) && typeof value.tag === 'string' &&
    (value.count === undefined || (typeof value.count === 'number' && Number.isFinite(value.count)));
}

function requireImage(value: string | undefined, field = 'image'): string {
  if (typeof value !== 'string') throw new Error(`${field} 需要 Base64 数据`);
  const base64 = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s+/g, '');
  const remainder = base64.length % 4;
  if (remainder === 1 || (base64.endsWith('=') && remainder !== 0) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error(`${field} 需要有效的 Base64 数据`);
  }
  return base64;
}

function checkRange(value: number, field: string, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${field} 必须在 ${min} 到 ${max} 之间`);
  return value;
}

function checkInteger(value: number, field: string, min: number, max: number): number {
  checkRange(value, field, min, max);
  if (!Number.isInteger(value)) throw new Error(`${field} 必须是整数`);
  return value;
}

function isDdim(sampler: string): boolean {
  return sampler === 'ddim' || sampler === 'ddim_v3';
}

function buildGenerationRequest(params: ImageGenerationParams): {
  payload: NovelAIRequestPayload;
  requestedModel: GenerationResult['requestedModel'];
  fallbackNotice?: string;
} {
  const action: Action = params.action ?? 'generate';
  if (action !== 'generate' && action !== 'img2img' && action !== 'infill') throw new Error('不支持该出图操作');
  if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw new Error('出图提示词不能为空');
  const { model, requestedModel, capability, fallbackNotice } = resolveGenerationModel(params.model, action);
  validateGenerationFeatures(params, capability);

  const width = alignDimension(params.width ?? 832);
  const height = alignDimension(params.height ?? 1216);
  const input = params.transparent_background && !/\btransparent background\b/i.test(params.prompt)
    ? `transparent background, ${params.prompt}`
    : params.prompt;
  const negativePrompt = params.negative_prompt ?? '';
  const requestedSampler = params.sampler ?? 'k_euler_ancestral';
  const sampler = capability.isMediumLocked || (action === 'infill' && isDdim(requestedSampler))
    ? 'k_euler_ancestral'
    : requestedSampler;
  const noiseSchedule = params.noise_schedule ?? 'karras';
  const seed = normalizeSeed(params.seed);
  const varietyBase = capability.varietyBase;
  let varietySigma: number | null = null;
  if (varietyBase !== null) {
    if (params.skip_cfg_above_sigma !== undefined) varietySigma = params.skip_cfg_above_sigma;
    else if (params.variety_plus) varietySigma = computeVarietySigma(varietyBase, width, height);
  }

  const parameters: NovelAIRequestPayload['parameters'] = {
    params_version: capability.paramsVersion,
    width,
    height,
    scale: params.scale ?? capability.defaultScale,
    sampler,
    steps: capability.isMediumLocked ? capability.defaultSteps : checkInteger(params.steps ?? capability.defaultSteps, 'steps', 1, 50),
    n_samples: checkInteger(params.n_samples ?? 1, 'n_samples', 1, 8),
    cfg_rescale: capability.isMediumLocked ? 0 : checkRange(params.cfg_rescale ?? 0, 'cfg_rescale', 0, 1),
    skip_cfg_above_sigma: varietySigma,
    seed,
    negative_prompt: negativePrompt,
    deliberate_euler_ancestral_bug: false,
    prefer_brownian: params.prefer_brownian ?? capability.preferBrownian,
    image_format: params.image_format ?? 'png',
    legacy: false,
    legacy_v3_extend: false,
  };

  if (sampler !== 'ddim_v3') {
    parameters.noise_schedule = noiseSchedule === 'native' && !capability.supportsNativeSchedule ? 'karras' : noiseSchedule;
  }
  if (params.uncond_scale !== undefined) parameters.uncond_scale = params.uncond_scale === 0 ? 0.00001 : params.uncond_scale;

  if (capability.paramsVersion === 4) {
    parameters.ucPresetId = capability.isMediumLocked ? 'heavy' : params.ucPresetId ?? UC_PRESET_NAMES[params.ucPreset ?? 0] ?? 'heavy';
    parameters.qualityPresetId = params.qualityPresetId ?? (params.qualityToggle === false ? 'none' : 'standard');
  } else {
    parameters.ucPreset = params.ucPresetId === undefined ? params.ucPreset ?? 0 : UC_PRESET_NAMES.indexOf(params.ucPresetId);
    parameters.qualityToggle = params.qualityPresetId === undefined ? params.qualityToggle ?? true : params.qualityPresetId !== 'none';
  }

  if (!capability.isV3) {
    const characters = (params.characterPrompts ?? []).map(character => ({ ...character, enabled: character.enabled ?? true }));
    const enabled = characters.filter(character => character.enabled);
    const useCoords = params.use_coords ?? enabled.length > 0;
    const legacyUc = params.legacy_uc ?? capability.legacyUcDefault;
    parameters.characterPrompts = characters;
    parameters.use_coords = useCoords;
    parameters.legacy_uc = legacyUc;
    parameters.v4_prompt = {
      caption: { base_caption: input, char_captions: enabled.map(character => ({ char_caption: character.prompt, centers: [character.center] })) },
      use_coords: useCoords,
      use_order: true,
    };
    parameters.v4_negative_prompt = {
      caption: { base_caption: negativePrompt, char_captions: enabled.map(character => ({ char_caption: character.uc, centers: [character.center] })) },
      legacy_uc: legacyUc,
    };
  }
  if (capability.supportsSmea) {
    parameters.autoSmea = action !== 'img2img' && (params.autoSmea ?? false);
    if (!parameters.autoSmea) {
      parameters.sm = action !== 'img2img' && (params.sm ?? false);
      parameters.sm_dyn = action !== 'img2img' && (params.sm_dyn ?? false);
    }
  }
  if (capability.supportsDecrisp) parameters.dynamic_thresholding = params.dynamic_thresholding ?? false;
  if (params.transparent_background) {
    parameters.straight_alpha = true;
    parameters.tag_hint_transparent_background = true;
  }

  if (action === 'img2img') {
    parameters.image = requireImage(params.image);
    parameters.strength = checkRange(params.strength ?? 0.7, 'strength', 0, 1);
    parameters.noise = checkRange(params.noise ?? 0, 'noise', 0, 1);
    parameters.extra_noise_seed = params.extra_noise_seed === undefined ? seed : normalizeSeed(params.extra_noise_seed);
    parameters.color_correct = params.color_correct ?? true;
  }
  if (action === 'infill') {
    const strength = checkRange(params.inpaintImg2ImgStrength ?? 1, 'inpaintImg2ImgStrength', 0, 1);
    const noise = checkRange(params.noise ?? 0, 'noise', 0, 1);
    parameters.image = requireImage(params.image);
    parameters.mask = requireImage(params.mask, 'mask');
    parameters.add_original_image = params.add_original_image ?? true;
    parameters.inpaintImg2ImgStrength = strength;
    parameters.noise = noise;
    if (strength < 1) {
      parameters.img2img = { strength, color_correct: true, ...(noise > 0 ? { noise } : {}), extra_noise_seed: seed };
    }
  }

  if (params.controlnet_condition !== undefined) parameters.controlnet_condition = params.controlnet_condition;
  if (params.controlnet_model !== undefined) parameters.controlnet_model = params.controlnet_model;
  if (params.controlnet_strength !== undefined) parameters.controlnet_strength = params.controlnet_strength;

  if (params.characterReferences?.length) {
    parameters.director_reference_images = params.characterReferences.map(ref => requireImage(ref.image, 'character_references.image'));
    parameters.director_reference_descriptions = params.characterReferences.map(ref => {
      if (!PRECISE_REFERENCE_TYPES.includes(ref.type)) throw new Error('不支持该精确参考类型');
      return { caption: { base_caption: ref.type, char_captions: [] }, legacy_uc: false };
    });
    parameters.director_reference_information_extracted = params.characterReferences.map(() => 1);
    parameters.director_reference_strength_values = params.characterReferences.map(ref => checkRange(ref.strength ?? 1, '精确参考强度', 0, 1));
    parameters.director_reference_secondary_strength_values = params.characterReferences.map(ref => (
      Number((1 - checkRange(ref.fidelity ?? 1, '精确参考忠实度', 0, 1)).toFixed(4))
    ));
  }

  const vibes = [...(params.vibeReferences ?? [])];
  const legacyInfo = params.reference_information_extracted_multiple ?? params.reference_information_extracted;
  for (const [index, reference] of (params.reference_image_multiple ?? []).entries()) {
    vibes.push({
      image: capability.isV3 ? reference : undefined,
      encoded_vibe: capability.isV3 ? undefined : reference,
      information_extracted: legacyInfo?.[index],
      strength: params.reference_strength_multiple?.[index] ?? params.reference_strength,
    });
  }
  if (vibes.length) {
    parameters.reference_image_multiple = vibes.map(ref => capability.vibeRequiresEncode
      ? requireImage(ref.encoded_vibe, 'vibe_references.encoded_vibe')
      : requireImage(ref.image, 'vibe_references.image'));
    parameters.reference_strength_multiple = vibes.map(ref => checkRange(ref.strength ?? 0.6, 'Vibe 强度', 0, 1));
    parameters.normalize_reference_strength_multiple = params.normalize_reference_strength_multiple ?? true;
    if (capability.isV3) {
      parameters.reference_information_extracted_multiple = vibes.map(ref => checkRange(ref.information_extracted ?? 1, 'Vibe 提取度', 0, 1));
    }
  }

  return { payload: { input, model, action, parameters }, requestedModel, fallbackNotice };
}

function expiresAt(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric <= 0) return null;
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeSubscription(raw: Record<string, unknown>): SubscriptionSummary {
  const points = isRecord(raw.trainingStepsLeft) ? raw.trainingStepsLeft : {};
  const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const tier = numeric(raw.tier);
  const fixedAnlas = numeric(points.fixedTrainingStepsLeft);
  const purchasedAnlas = numeric(points.purchasedTrainingSteps);
  return {
    tier,
    tierName: SUBSCRIPTION_TIERS[tier] ?? '未知',
    active: raw.active === true,
    expiresAt: expiresAt(raw.expiresAt),
    fixedAnlas,
    purchasedAnlas,
    totalAnlas: fixedAnlas + purchasedAnlas,
    v5Usage: isRecord(raw.usage) ? raw.usage : null,
  };
}

export class NovelAIClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly agent?: HttpsProxyAgent<string>;

  constructor(private readonly apiKey: string, options: NovelAIClientOptions | string = {}) {
    if (!apiKey) throw new Error('缺少 NovelAI API 密钥');
    const config = typeof options === 'string' ? { baseUrl: options } : options;
    const url = new URL(config.baseUrl ?? API_BASE_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('NovelAI 接口地址必须是 HTTP 或 HTTPS 地址');
    }
    this.baseUrl = url.href.replace(/\/$/, '');
    this.timeoutMs = checkInteger(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs', 1, 2147483647);

    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (proxy && !isLoopback) this.agent = new HttpsProxyAgent(proxy);
  }

  private async request(path: string, body?: object, maxBytes = MAX_IMAGE_RESPONSE_BYTES): Promise<{ buffer: Buffer; contentType?: string }> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    const correlationId = Array.from({ length: 6 }, () => CORRELATION_ALPHABET[randomInt(CORRELATION_ALPHABET.length)]).join('');
    const route = path.split('?')[0];
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Origin: 'https://novelai.net',
      Referer: 'https://novelai.net/',
      'x-correlation-id': correlationId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        agent: this.agent,
        redirect: 'error',
        signal,
        size: maxBytes,
      });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return { buffer, contentType: response.headers.get('content-type') ?? undefined };
      }
    } catch {
      if (signal.aborted) throw new Error(`NovelAI 请求超时（${route}）`);
      throw new Error(`NovelAI 请求失败（${route}）`);
    }
    if (response.body instanceof Readable) response.body.destroy();
    throw new Error(`NovelAI API（${response.status}，${route}，请求编号 ${correlationId}）`);
  }

  private async readJson(path: string): Promise<unknown> {
    const { buffer } = await this.request(path, undefined, MAX_JSON_RESPONSE_BYTES);
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new Error(`NovelAI 返回了无法解析的 JSON（${path.split('?')[0]}）`);
    }
  }

  async generateImage(params: ImageGenerationParams): Promise<GenerationResult> {
    const { payload, requestedModel, fallbackNotice } = buildGenerationRequest(params);
    const { buffer, contentType } = await this.request('/ai/generate-image', payload);
    return {
      images: unpackImageResponse(buffer, contentType),
      seed: payload.parameters.seed,
      model: payload.model,
      requestedModel,
      ...(fallbackNotice === undefined ? {} : { fallbackNotice }),
      rawBuffer: buffer,
    };
  }

  async generateImageBuffer(params: ImageGenerationParams): Promise<Buffer> {
    const { payload } = buildGenerationRequest(params);
    return (await this.request('/ai/generate-image', payload)).buffer;
  }

  async augmentImage(params: AugmentImageParams): Promise<UnpackedImage[]> {
    const { req_type, image, width, height, emotion, prompt, defry } = params;
    if (!AUGMENT_REQ_TYPES.includes(req_type)) throw new Error('不支持该导演工具');
    if (req_type === 'emotion' && (emotion === undefined || !EMOTION_MOODS.includes(emotion))) {
      throw new Error(`emotion 必须是受支持的情绪。可选情绪为 ${EMOTION_MOODS.join('、')}`);
    }
    const supportsDefry = req_type === 'colorize' || req_type === 'emotion';
    const body = {
      image: requireImage(image), req_type, width, height,
      ...(supportsDefry ? { defry: checkInteger(defry ?? 0, 'defry', 0, 5) } : {}),
      ...(req_type === 'emotion' ? { prompt: `${emotion};;${prompt ?? ''}` } : { prompt }),
    };
    const response = await this.request('/ai/augment-image', body);
    return unpackImageResponse(response.buffer, response.contentType);
  }

  async upscaleImage(params: UpscaleImageParams): Promise<UnpackedImage[]> {
    const { image, model = DEFAULT_UPSCALE_MODEL, declared_blur_sigma } = params;
    const body = {
      image: requireImage(image), model,
      ...(declared_blur_sigma === undefined ? {} : { declared_blur_sigma }),
    };
    const response = await this.request('/ai/upscale', body);
    return unpackImageResponse(response.buffer, response.contentType);
  }

  async encodeVibe(params: EncodeVibeParams): Promise<string> {
    const { image, model, information_extracted = 1, mask, crop_to_mask } = params;
    if (!ENCODE_VIBE_MODELS.includes(model)) throw new Error('氛围编码仅支持 V4 和 V4.5 模型');
    const body = {
      image: requireImage(image), model,
      information_extracted: checkRange(information_extracted, 'information_extracted', 0, 1),
      ...(mask === undefined ? {} : { mask: requireImage(mask, 'mask') }),
      ...(crop_to_mask === undefined ? {} : { crop_to_mask }),
    };
    const { buffer } = await this.request('/ai/encode-vibe', body);
    if (!buffer.length) throw new Error('NovelAI 返回了空的氛围编码');
    return buffer.toString('base64');
  }

  async suggestTags(params: SuggestTagsParams): Promise<{ tags: TagSuggestion[] }> {
    const { prompt, lang = 'en' } = params;
    if (lang !== 'en' && lang !== 'jp') throw new Error('lang 必须为 en 或 jp');
    const query = new URLSearchParams({ model: resolveImageModel(params.model), prompt, lang });
    const raw = await this.readJson(`/ai/generate-image/suggest-tags?${query}`);
    const tags = Array.isArray(raw) ? raw : isRecord(raw) ? raw.tags : undefined;
    if (!Array.isArray(tags) || !tags.every(isTagSuggestion)) throw new Error('NovelAI 返回了无效的标签列表');
    return { tags };
  }

  async getSubscription(): Promise<{ raw: Record<string, unknown>; summary: SubscriptionSummary }> {
    const raw = await this.readJson('/user/subscription');
    if (!isRecord(raw)) throw new Error('NovelAI 返回了无效的订阅信息');
    return { raw, summary: normalizeSubscription(raw) };
  }
}
