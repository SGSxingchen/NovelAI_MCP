import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { DEFAULT_MODEL } from './types.js';
import type { 
  ImageGenerationParams, 
  CharacterPrompt,
  V4Prompt,
  V4NegativePrompt
} from './types.js';

export class NovelAIClient {
  // 1. 必须显示声明类属性
  private apiKey: string;
  private baseUrl: string;
  private agent: any; // 这里的 agent 类型比较复杂，用 any 兼容 http/https 代理

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('NovelAI API key is required');
    }
    this.apiKey = apiKey;
    this.baseUrl = 'https://image.novelai.net'; 

    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxy) {
      this.agent = new HttpsProxyAgent(proxy);
      console.error('🔌 Using proxy:', proxy);
    }
  }

  /**
   * 构建 V4 Prompt 结构
   */
  private buildV4Prompt(prompt: string, characterPrompts: CharacterPrompt[] = []): V4Prompt {
    return {
      caption: {
        base_caption: prompt,
        char_captions: characterPrompts.map(char => ({
          char_caption: char.prompt,
          centers: [char.center],
        })),
      },
      use_coords: characterPrompts.length > 0,
      use_order: true,
    };
  }

  /**
   * 构建 V4 Negative Prompt 结构
   */
  private buildV4NegativePrompt(negativePrompt: string, characterPrompts: CharacterPrompt[] = []): V4NegativePrompt {
    return {
      caption: {
        base_caption: negativePrompt,
        char_captions: characterPrompts.map(char => ({
          char_caption: char.uc,
          centers: [char.center],
        })),
      },
      legacy_uc: false,
    };
  }

  /**
   * 生成图片
   */
  async generateImage(params: ImageGenerationParams): Promise<Buffer> {
    const model = params.model ?? DEFAULT_MODEL;
    const isV5 = model === 'nai-diffusion-5-full' || model === 'nai-diffusion-5-curated';
    const {
      prompt,
      model: _model,
      action = 'generate',
      negative_prompt = '',
      width = 832,
      height = 1216,
      steps = isV5 ? 23 : 28,
      scale = isV5 ? 7 : 6,
      sampler = 'k_euler_ancestral',
      seed,
      n_samples = 1,
      noise_schedule = 'karras',
      sm = false,
      sm_dyn = false,
      autoSmea = false,
      dynamic_thresholding = false,
      cfg_rescale = 0,
      qualityToggle = true,
      ucPreset = 0,
      skip_cfg_above_sigma = isV5 ? null : 58,
      prefer_brownian = !isV5,
      image_format = 'png',
      characterPrompts = [],
      add_original_image = true,
      inpaintImg2ImgStrength = 1,
      controlnet_strength = 1,
      normalize_reference_strength_multiple = true,
      ...rest
    } = params;

    if (!prompt) throw new Error('Prompt is required');

    const generatedSeed = seed ?? Math.floor(Math.random() * 4294967295);

    // 使用 any 来构建 payload，避免复杂的 TypeScript 嵌套类型检查
    // 因为 parameters 里的字段非常多且部分是动态的
    const payload: any = {
      input: prompt,
      model,
      action,
      parameters: {
        params_version: isV5 ? 4 : 3,
        width,
        height,
        scale,
        sampler,
        steps,
        n_samples,
        ucPreset,
        qualityToggle,
        autoSmea,
        dynamic_thresholding,
        controlnet_strength,
        legacy: false,
        add_original_image,
        cfg_rescale,
        noise_schedule,
        legacy_v3_extend: false,
        seed: generatedSeed,
        negative_prompt,
        legacy_uc: false,
        deliberate_euler_ancestral_bug: false,
        prefer_brownian,
        image_format,
        // ❌ 删除 stream 参数，强制使用 ZIP
        skip_cfg_above_sigma,
        use_coords: characterPrompts.length > 0,
        normalize_reference_strength_multiple,
        inpaintImg2ImgStrength,
        characterPrompts: characterPrompts.map(char => ({
          prompt: char.prompt,
          uc: char.uc,
          center: char.center,
          enabled: char.enabled ?? true,
        })),
        v4_prompt: this.buildV4Prompt(prompt, characterPrompts),
        v4_negative_prompt: this.buildV4NegativePrompt(negative_prompt, characterPrompts),
      },
    };

    // 手动处理 SMEA 参数
    if (!autoSmea) {
      payload.parameters.sm = sm;
      payload.parameters.sm_dyn = sm_dyn;
    }

    // 合并剩余参数
    Object.assign(payload.parameters, rest);

    try {
      console.error(`🚀 Requesting NovelAI (ZIP Mode)... Seed: ${generatedSeed}`);
      
      const fetchOptions: any = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Origin': 'https://novelai.net',
          'Referer': 'https://novelai.net/',
        },
        body: JSON.stringify(payload),
      };

      if (this.agent) {
        fetchOptions.agent = this.agent;
      }

      const response = await fetch(`${this.baseUrl}/ai/generate-image`, fetchOptions);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NovelAI API Error (${response.status}): ${errorText}`);
      }

      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);

    } catch (error) {
      console.error('💥 Client Error:', error);
      throw error;
    }
  }
}