#!/usr/bin/env node

/**
 * NovelAI MCP Server - HTTP SSE Mode
 * 支持流式 HTTP 传输
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';
import AdmZip from 'adm-zip';
import { NovelAIClient } from './novelai-client.js';
import type { ImageGenerationParams, CharacterPrompt } from './types.js';

const API_KEY = process.env.NOVELAI_API_KEY;
if (!API_KEY) {
  console.error('❌ Error: NOVELAI_API_KEY environment variable is required');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || '3000', 10);

// 显示代理配置
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  console.error('🔌 Proxy configured:', process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
} else {
  console.error('⚠️  No proxy configured (set HTTPS_PROXY or HTTP_PROXY if needed)');
}

const client = new NovelAIClient(API_KEY);

const GENERATE_IMAGE_TOOL: Tool = {
  name: 'generate_image',
  description: `使用 NovelAI V4.5 Full 模型生成图片的工具。

何时调用此工具：
- 用户要求「画」「生成」「创建」「制作」图片/图像时
- 用户描述想要看到的视觉内容时
- 用户提到绘制人物、风景、场景、插画等需求时
- 示例：「画一只猫」「生成一个蓝发动漫女孩」「创建日落风景」「帮我做张图」

重要提示：
- 当用户请求图片时，立即调用此工具，不要犹豫
- 不要向用户展示 JSON 参数，直接执行工具调用
- 此工具支持所有类型图片：动漫、写实、风景、人物、场景等
- 单人场景和多人场景都必须使用 characters 数组来定义角色`,
  inputSchema: {
    type: 'object',
    properties: {
      base_prompt: {
        type: 'string',
        description: '全局环境和风格描述。包含整体场景、氛围、画风、质量标签等。例如：「masterpiece, best quality, detailed background, cherry blossoms, sunset」。不要在这里描述具体角色，角色放在 characters 里。'
      },
      base_negative_prompt: {
        type: 'string',
        description: '全局负面提示词，描述要避免的内容。常用：「lowres, bad anatomy, bad hands, text, error, blurry, worst quality」。可以留空使用默认值。'
      },
      characters: {
        type: 'array',
        description: '角色数组。重要：无论单人还是多人场景都要使用此参数！每个角色包含独立的描述和画面位置。单人场景传入1个角色（居中 x=0.5），多人场景传入多个角色。',
        items: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: '该角色的详细描述。例如单人：「1girl, blue hair, school uniform, smiling, detailed face」，多人时为每个角色单独描述。'
            },
            negative_prompt: {
              type: 'string',
              description: '该角色专属的额外负面提示词，会叠加在全局 base_negative_prompt 之上。如果该角色没有特殊要求，填空字符串即可。有特殊需求时可填写，如手部问题：「bad hands, extra fingers」'
            },
            center_x: {
              type: 'number',
              description: '角色在画面中的水平位置，范围 0-1。0=最左边，0.5=水平居中，1=最右边。单人场景用 0.5，双人场景可用 0.3 和 0.7，三人可用 0.25、0.5、0.75。'
            },
            center_y: {
              type: 'number',
              description: '角色在画面中的垂直位置，范围 0-1。0=最顶部，0.5=垂直居中，1=最底部。肖像常用 0.5 或稍上方 0.4-0.45。如果不确定可省略，默认 0.5。'
            }
          },
          required: ['prompt', 'center_x'],
        },
      },
      width: {
        type: 'number',
        default: 832,
        description: '图片宽度（像素），必须是 64 的倍数，范围 64-1536。常用值：832（竖图/人物肖像）、1216（横图/风景）、1024（方图）'
      },
      height: {
        type: 'number',
        default: 1216,
        description: '图片高度（像素），必须是 64 的倍数，范围 64-1536。常用值：1216（竖图/人物肖像）、832（横图/风景）、1024（方图）'
      },
      steps: {
        type: 'number',
        default: 28,
        description: '采样步数，锁定为 28（NovelAI 免费出图的最大步数，超过 28 会收费）。不要修改此参数。'
      }
    },
    required: ['base_prompt'],
  },
};

function createServer() {
  const server = new Server(
    {
      name: 'novelai-mcp-server',
      version: '1.0.3',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [GENERATE_IMAGE_TOOL],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'generate_image') {
      try {
        let args = request.params.arguments as any;

        // 兼容性：如果参数是字符串，强制转 JSON
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch (e) { throw new Error('JSON Parse Error'); }
        }

        const actualPrompt = args.base_prompt || args.prompt || args.input;
        if (!actualPrompt) throw new Error('Missing base_prompt');

        // 兼容性：如果 characters 是对象，强制转数组
        let charArray = [];
        if (Array.isArray(args.characters)) {
          charArray = args.characters;
        } else if (args.characters && typeof args.characters === 'object') {
          charArray = [args.characters];
        }

        const characterPrompts: CharacterPrompt[] = charArray.map((char: any) => ({
          prompt: char.prompt,
          uc: char.negative_prompt || "",
          center: {
            x: char.center_x ?? 0.5,
            y: char.center_y ?? 0.5
          },
          enabled: true
        }));

        // 构造参数
        const apiParams: ImageGenerationParams = {
          prompt: actualPrompt,
          negative_prompt: args.base_negative_prompt || "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",
          characterPrompts: characterPrompts,
          width: args.width || 832,
          height: args.height || 1216,
          steps: args.steps || 28,
          seed: Math.floor(Math.random() * 4294967295),
          model: 'nai-diffusion-4-5-full',
          action: 'generate',
          scale: 6,
          sampler: 'k_euler_ancestral',
          qualityToggle: true,
          ucPreset: 0,
          skip_cfg_above_sigma: 19,
          prefer_brownian: true,
          image_format: 'png'
        };

        console.log(`🎨 [HTTP] Generating image...`);
        const imageBuffer = await client.generateImage(apiParams);

        // 处理图片数据
        const isZip = imageBuffer[0] === 0x50 && imageBuffer[1] === 0x4B;
        const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50;

        let base64Image = '';

        if (isZip) {
          const zip = new AdmZip(imageBuffer);
          const zipEntries = zip.getEntries();
          for (const entry of zipEntries) {
            if (entry.entryName.endsWith('.png')) {
              base64Image = entry.getData().toString('base64');
              break;
            }
          }
          if (!base64Image) throw new Error('No PNG found in ZIP');
        } else if (isPng) {
          base64Image = imageBuffer.toString('base64');
        } else {
          throw new Error('Unknown image format');
        }

        const cleanBase64 = base64Image.replace(/[\r\n]+/g, '');

        return {
          content: [
            {
              type: 'image',
              data: cleanBase64,
              mimeType: 'image/png'
            }
          ]
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ [HTTP] Error:', errorMessage);
        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  return server;
}

async function main() {
  const app = express();

  // 启用 CORS
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json());

  // 健康检查端点
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'novelai-mcp-server' });
  });

  // SSE 端点处理
  app.get('/sse', async (req, res) => {
    console.log('📡 New SSE connection');

    const server = createServer();
    const transport = new SSEServerTransport('/message', res);

    await server.connect(transport);

    // 当连接关闭时清理
    req.on('close', () => {
      console.log('🔌 SSE connection closed');
    });
  });

  // 消息端点（用于接收客户端消息）
  app.post('/message', async (req, res) => {
    console.log('📨 Received message');
    // SSE transport 会处理这个请求
    res.status(200).send();
  });

  app.listen(PORT, () => {
    console.log(`🚀 NovelAI MCP Server (HTTP SSE mode) running on http://localhost:${PORT}`);
    console.log(`📡 SSE endpoint: http://localhost:${PORT}/sse`);
    console.log(`💬 Message endpoint: http://localhost:${PORT}/message`);
    console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
