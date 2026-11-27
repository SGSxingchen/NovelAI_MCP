# NovelAI MCP Server

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20+-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0-purple.svg)](https://modelcontextprotocol.io/)

**一个功能完整的 Model Context Protocol (MCP) 服务器，为 NovelAI 图像生成 API 提供支持**

[English](./README.en.md) | 简体中文

</div>

---

## ✨ 特性

- 🎨 **9 大模型全覆盖** - 支持 NovelAI Diffusion V5（Curated / Full / Full Medium）、V4.5（Full / Curated）、V4（Full / Curated Preview）与 V3（Anime / Furry）
- 🧰 **17 个全功能 MCP 动作（支持 3 工具渐进式披露）** - 涵盖文生图、图生图、局部重绘、8 项导演工具、4 倍放大、Vibe 编码缓存、标签建议、订阅查询、归档看图、V5 七维风格工程指南、光学测图探针（`probe_image`）、差值验收器（`verify_image`）、纯 NAI 十三道关自检（`lint_prompt`）、画师/提示词库与 28,615 条离线社区法典检索（`search_nai_lexicon`）
- 🔬 **七维提示词工程与反推/验收闭环** - 深度融合并专为 NovelAI 定制的七维决策、35 Tag 黄金预算、先验解绑（防光环欲盖弥彰）、动作双手解剖闭环、BT.709 光学探针与出图差值单句微调处方
- 📚 **28,615 条离线社区法典词库** - 本地持久化归档 10 部 NovelAI 社区法典原始数据（含《渡鸦的构图鉴》《构图风格》64 条权重场景串、《解构原典》《更衣人偶》《千藤衣柜》《所长 NAI V5/V4.5 法典》《梦神法典》），零外部网络依赖毫秒级中英双向检索
- 🔁 **图库 ID 闭环** - 所有出图与处理结果自动归档（支持 PNG / WebP / JPEG，兼容 v1 历史归档）并返回 `image_id` 与公开短链，可直接回传作为后续编辑或参考输入
- 🚀 **三传输统一架构** - Stdio、Streamable HTTP（推荐，兼容 Gemini Cloud MCP）与 Legacy SSE 共享同一套工具与归档能力，HTTP 请求体上限提升至 50MB
- 🛡️ **安全与费用防护** - HTTPS 远端图下载内置 SSRF 防护，HTTP 模式禁读本地文件，Vibe 编码持久化缓存与并发去重减少重复 Anlas 消耗

## 📦 快速开始

### 安装

```bash
# 克隆项目
git clone https://github.com/SGSxingchen/NovelAI_MCP.git
cd NovelAI_MCP

# 安装依赖
npm ci

# 编译
npm run build
```

### 配置

#### 方式一：Stdio 模式（Claude Desktop）

在 Claude Desktop 配置文件中添加：

```json
{
  "mcpServers": {
    "novelai": {
      "command": "node",
      "args": ["项目路径/dist/index.js"],
      "env": {
        "NOVELAI_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### 方式二：Streamable HTTP 模式（LobeChat/Dify 推荐）

**Linux/Mac:**
```bash
export NOVELAI_API_KEY="your-api-key"
export HTTPS_PROXY="http://127.0.0.1:7890"  # 可选：设置代理
npm run start:http
```

**Windows PowerShell:**
```powershell
$env:NOVELAI_API_KEY="your-api-key"
$env:HTTPS_PROXY="http://127.0.0.1:7890"  # 可选：设置代理
npm run start:http
```

**Windows CMD:**
```cmd
set NOVELAI_API_KEY=your-api-key
set HTTPS_PROXY=http://127.0.0.1:7890
npm run start:http
```

在客户端配置中添加：
- **URL**: `http://localhost:3000/mcp`
- **传输**: Streamable HTTP

#### 方式三：SSE 模式（备选）

**Linux/Mac:**
```bash
export NOVELAI_API_KEY="your-api-key"
export HTTPS_PROXY="http://127.0.0.1:7890"  # 可选
npm run start:sse
```

**Windows PowerShell:**
```powershell
$env:NOVELAI_API_KEY="your-api-key"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
npm run start:sse
```

**Windows CMD:**
```cmd
set NOVELAI_API_KEY=your-api-key
set HTTPS_PROXY=http://127.0.0.1:7890
npm run start:sse
```

在客户端配置中添加：
- **URL**: `http://localhost:3000/sse`
- **传输**: Server-Sent Events (SSE)

## 🎯 支持的模型（9 个）

| 模型 ID | 说明 | 特性摘要 |
|---------|------|----------|
| `nai-diffusion-5-curated` | NovelAI Diffusion V5 Curated（**默认**） | 最多 32 角色、透明背景、精确参考（角色、画风、服装，强度 0–5）。普通局部重绘使用同代 `nai-diffusion-5-full-inpainting`（保留 32 角色与透明背景） |
| `nai-diffusion-5-full` | NovelAI Diffusion V5 Full | 最多 32 角色、透明背景、精确参考（角色、画风、服装，强度 0–5）、独立局部重绘模型 |
| `nai-diffusion-5-full-medium` | NovelAI Diffusion V5 Full Medium | 硬锁定 14 步 / `k_euler_ancestral` / `cfg_rescale=0` / `uc_preset=heavy`（不支持精确参考） |
| `nai-diffusion-4-5-full` | NovelAI Diffusion V4.5 Full | 最多 6 角色、精确参考（Precise Reference）、Vibe Transfer、Variety+ |
| `nai-diffusion-4-5-curated` | NovelAI Diffusion V4.5 Curated | 同 V4.5 Full 能力矩阵 |
| `nai-diffusion-4-full` | NovelAI Diffusion V4 Full | 最多 6 角色、Vibe Transfer（含局部重绘）、Variety+ |
| `nai-diffusion-4-curated-preview` | NovelAI Diffusion V4 Curated Preview | 同 V4 Full 能力矩阵 |
| `nai-diffusion-3` | NovelAI Diffusion V3 Anime | SMEA / SMEA DYN / Auto SMEA / Decrisp / `native` 调度、448×448 原图 Vibe |
| `nai-diffusion-furry-3` | NovelAI Diffusion V3 Furry | 同 V3 Anime 能力矩阵 |

文生图和图生图传入 `character_references` 时，省略 `model` 即可使用默认 V5 Curated。每次最多 16 张精确参考图，与 Vibe Transfer 互斥。带精确参考的局部重绘需要 V4.5，省略 `model` 时本次自动使用 `nai-diffusion-4-5-full` 并在回执中说明。

## 🧰 MCP 工具列表（17 个动作，默认 3 工具渐进式披露）

默认启用渐进式披露（`nai_discover`、`nai_describe`、`nai_execute`），将初始工具列表体积压缩 88% 以上；设为 `legacy` 模式时直接平铺以下全部 17 个工具：

| 工具名 | 模块 | 用途 | 关键特性 |
|--------|------|------|----------|
| `generate_image` | `generate` | 文生图 | 默认 V5 Curated；支持 9 模型、多角色分槽坐标、采样器/日程、V5 透明背景、精确参考（角色/画风/服装）、Vibe、多图 `n_samples` 与 PNG/WebP 输出 |
| `img2img` | `generate` | 图生图 | 支持归档 `image_id` / 短链 / HTTPS / Base64 / 数据 URI（Stdio 支持本地文件）；支持 `strength`、`noise`、`color_correct`、`extra_noise_seed` |
| `inpaint_image` | `generate` | 局部重绘 | 支持 `mask_image` 或 `mask_regions`（最多 64 个归一化矩形/椭圆自动生成 8×8 对齐二值遮罩）；支持 `inpaint_strength`、`add_original_image` |
| `augment_image` | `enhance` | 导演工具 | 支持 `lineart`、`sketch`、`colorize`、`declutter`、`declutter-keep-bubbles`、`emotion`（24 种情绪）、`bg-removal`（返回 3 图）、`pixel-snap` |
| `upscale_image` | `enhance` | 图像放大 | 2026 `/ai/upscale` 协议；默认 `auto_fit_1mp=true` 自动将超过 1,048,576 像素的源图等比缩图至上限内 |
| `encode_vibe` | `enhance` | Vibe 风格编码 | 为 V4 / V4.5 预编码参考图并返回可跨重启复用的 `vibe_id`（落盘 `<archiveDir>/.vibe-cache` 并合并并发请求） |
| `suggest_tags` | `assist` | 标签建议 | 免费只读（0 Anlas）：按提示词片段与模型返回官方 `en` / `jp` 标签补全列表 |
| `get_subscription` | `assist` | 订阅与余额查询 | 免费只读（0 Anlas）：返回订阅等级、到期时间、固定/购买 Anlas 余额与 V5 用量条信息 |
| `list_archived_images` | `assist` | 图库检索与看图 | 免费只读（0 Anlas）：倒序列出最近归档，或按 `image_id` 返回单图元数据、PNG 内嵌参数及高清 WebP 画面预览 |
| `probe_image` | `assist` | 光学与色彩探针 | 免费只读（0 Anlas）：实测参考图或出图的 ITU-R BT.709 明度三档（`dark/mid/bright/nw/p1/p99`）、亮暗部饱和度方向（`lit vs shadow`）、边缘硬度与平坦度（`strong/soft/flat`）、6×6 亮度矩阵、16×11 主色 HEX、局部 `patches`、内嵌 NAI 参数及二十问盲读取证清单 |
| `verify_image` | `assist` | 出图差值验收器 | 免费只读（0 Anlas）：对比参考图与 NovelAI 出图的光学差值与 6×6 明度差矩阵，按 `[严重]/[明显]/[轻微]` 输出单句微调处方（免整篇重写提示词） |
| `lint_prompt` | `assist` | 纯 NAI 十三道关自检 | 免费只读（0 Anlas）：出图前检查 `::` 权重壳闭合、35 Tag 预算与加权项 ≤30%、参考图明度/饱和对齐、机位吞噬与 B3/B4 陷阱、预设冲撞（Heavy UC 吞网点/色散）、防烧白、角色坐标防居中/防叠头、先验解绑与防正向 `no halo` 欲盖弥彰、单手武器副手解剖闭环、多角色 3-Tier 分槽与美学质感提示灯 |
| `get_v5_stylist_guide` | `guides` | V5 风格与七维工程指南 | 免费只读（0 Anlas）：支持 `full`、`workflow`、`seven_dimensions`、`tag_budget`、`blueprints`（5 套蓝图）、`artist_mix`、`decontaminate`、`advanced_engineering`（P1–P8）、`reverse_and_audit`、`gotchas` |
| `search_artist_library` | `library` | 画师与混搭配方查询 | 查询自定义画师与阶梯混搭配方，自动按 `v4` (`1.2::tag::`)、`v3` (`{tag}`) 或 `plain` 格式化 |
| `search_prompt_library` | `library` | 提示词模板库查询 | 查询已保存的提示词模板、积木片段与负面预设 |
| `search_nai_lexicon` | `library` | 离线社区法典词库检索 | 免费只读（0 Anlas）：检索本地离线归档的 10 部 NovelAI 社区法典（共 28,615 条），支持 `fuzzy`（中英双向模糊）、`exact`、`category`、`scenes`（64 条权重场景串）、`negatives`（解构负向范例）、`stats` 及 `include_nsfw` 过滤 |
| `save_library_entry` | `library` | 新增词库条目 | 向本地画师库或提示词模板库新增条目 |

## 🔬 七维提示词工程与反推/验收工作流（NovelAI 专属）

本项目将 [Luxvanyu/prompt-craft](https://github.com/Luxvanyu/prompt-craft) 中适用于 NovelAI 的核心工程体系原生内置为 0 Anlas 工具链（彻底剥离了非 NAI 的 MOSS BBox / 零质量词 / 零画师串限制）：

1. **先测参考图或查词定调**：
   - 有参考图时，先调用 `probe_image`（可开启 `include_forensic_sop: true`）获取 BT.709 明度主导档（`dark / mid / bright`）、亮暗部饱和度方向（`lit vs shadow`）、边缘硬度（`strong / flat`）与真实主色 HEX，坚持「肉眼看结构、探针量明度与色号」。
   - 不确定某个构图、光影或服饰概念在 NovelAI/Danbooru 中叫什么 Tag 时，调用 `search_nai_lexicon` 用中文直接查出标准 Tag 或 64 条成品权重场景串。
2. **按七维与 35 Tag 黄金预算起草（V5 3-Tier 属性分槽）**：
   - 调用 `get_v5_stylist_guide` 读取 `seven_dimensions`、`tag_budget` 或 `advanced_engineering`。
   - **35 Tag 黄金预算**：人数与画师串（4–6，前 1/4 落位）+ 外貌身份锚（6–8）+ 服装（3–5）+ 动作主轴（2–3）+ 环境（3–4）+ 光影（3–4）+ 构图景别（3–4，**光+构图必占 6–8 Tag**）+ 材质与收尾（4–6）+ **末尾 1–3 句英文自然语言空间/光影长句**（承载 0.3 秒未完成微动作、刀切光边与三档衰减、不对称留白、材质可见行为）。
   - **先验解绑与防崩**：无光环羽翼角色禁用 `angel` 统称，**严禁在正向写 `no halo`（防注意力反向激活光环）**，统一在 `base_negative_prompt` 或内联负权重中写 `-2::halo, head halo::`；单手持械必须在同一句内锁死副手位置（防多臂与断剑）；多角色拆入 `characters` 数组并拉开 `center_x`（如 `0.3` vs `0.7`）。
3. **出图前过纯 NAI 十三道关自检**：
   - 调用 `lint_prompt`（可传入 `reference_image`），自动拦截未闭合 `::` 权重壳、加权项超 30%、`full_body` 吞噬特殊机位、Heavy UC 静默吞掉 `halftone / chromatic aberration`、漂白过曝词等。
4. **出图后量差值单句微调**：
   - 出图不理想时**严禁重写整份提示词**。调用 `verify_image` 对比参考图与出图，根据返回的 `[严重]/[明显]/[轻微]` 诊断处方只修改 `base_prompt` 中对应的那一句。

## 📊 传输模式对比

| 特性 | Stdio 模式 | Streamable HTTP | SSE 模式 |
|------|-----------|----------------|----------|
| **适用场景** | Claude Desktop | Gemini Cloud MCP、LobeChat、Dify（推荐） | Legacy SSE 客户端 |
| **协议标准** | MCP Stdio | MCP Streamable HTTP | MCP SSE Transport |
| **端点** | - | `/mcp`、`/health`、`/novelai-images/:id.(png\|webp\|jpg)` | `/sse`、`/message`、`/health`、`/novelai-images/:id.(png\|webp\|jpg)` |
| **远程访问 / 50MB 请求体** | 本地文件可读 | ✅（禁读本地文件） | ✅（禁读本地文件） |
| **多客户端与归档短链** | ❌ | ✅ | ✅ |
| **启动命令** | `npm run start:stdio` | `npm run start:http` | `npm run start:sse` |

## 🌍 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `NOVELAI_API_KEY` | ✅ | - | NovelAI API 密钥 |
| `PORT` | ❌ | `3000` | HTTP 服务器端口（Streamable HTTP / SSE 模式） |
| `MCP_BIND_HOST` | ❌ | Streamable HTTP 为 `::` | HTTP 监听地址。通过本机 Nginx 提供 HTTPS 时建议设为 `127.0.0.1` |
| `MCP_IMAGE_PUBLIC_ORIGIN` | ❌ | - | 公网 HTTPS 域名（无路径）。启用时须反代 `/novelai-images/`，回执附带公开短链 |
| `MCP_IMAGE_ARCHIVE_DIR` | ❌ | 配置图片链接时为 `outputs` | 图片与 `.vibe-cache` 持久化归档目录。建议使用独立绝对路径或持久卷 |
| `MCP_ALLOWED_ORIGINS` | ❌ | - | 逗号分隔的额外允许 HTTP/HTTPS `Origin` 白名单（本机及 `MCP_IMAGE_PUBLIC_ORIGIN` 默认放行） |
| `HTTPS_PROXY` | ❌ | - | HTTPS 代理地址 |
| `HTTP_PROXY` | ❌ | - | HTTP 代理地址 |

## Gemini 接入

Gemini 网页的「关联的应用 → 自定义 → Cloud MCP」可以连接公网 HTTPS 的 Streamable HTTP 入口。连接后可在 Gemini 网页和手机 App 使用。见 [接入说明](./docs/GEMINI.md)。

## 📚 文档

- 🚀 [HTTP 快速开始](./docs/QUICKSTART-HTTP.md)
- 📋 [快速参考卡片](./docs/QUICK-REFERENCE.md)
- 📝 [完整功能总结](./SUMMARY.md)
- 📜 [更新日志](./CHANGELOG.md)

## 🛠️ 开发

```bash
# 克隆仓库
git clone https://github.com/SGSxingchen/NovelAI_MCP.git
cd NovelAI_MCP

# 安装依赖
npm ci

# 编译
npm run build

# 运行单元测试
npm test

# 开发模式
npm run dev

# 启动 HTTP 服务器
npm run start:http
```

## 🐳 Docker 部署（可选）

项目包含 Dockerfile，可以自行构建：

```bash
# 构建镜像
docker build -t novelai-mcp-server .

# 运行容器
docker run -d \
  -p 3000:3000 \
  -e NOVELAI_API_KEY="your-api-key" \
  --name novelai-mcp \
  novelai-mcp-server
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢与社区参考数据源

- [NovelAI](https://novelai.net/) - 提供强大的图像生成 API
- [Model Context Protocol](https://modelcontextprotocol.io/) & [Anthropic](https://www.anthropic.com/) - MCP 协议规范与 SDK
- **[Luxvanyu/prompt-craft](https://github.com/Luxvanyu/prompt-craft)** - 提供了「一图一主张、七维决策、先验解绑（P1–P8）、光学探针（`probe`）、十三道关自检（`lint`）、二十问盲读（`look`）与出图差值验收（`verify`）」的核心方法论，以及基于 10,958 条真实 NovelAI 提示词的统计基线（本项目仅提取并深度适配了其中适用于 NovelAI 的部分）
- **[NovelAI 社区法典站 (novelai.quicktagcloud.com)](https://novelai.quicktagcloud.com/)** - 为防止上游接口变动导致数据不可用，本项目已将公开接口（`https://novelai.quicktagcloud.com/data/`）中的 10 部核心词表与法典原始数据完整离线归档于仓库 [`data/raw-codexes/`](./data/raw-codexes) 及合并索引 [`data/nai-lexicon.json.gz`](./data/nai-lexicon.json.gz)（共 **28,615 条**，运行时 100% 本地离线读取）。谨向以下社区法典原作者与贡献者致谢：
  - **《渡鸦的构图鉴》**（7,887 条，版本 `2026.11.26`）—— 作者：**渡鸦**（服饰、姿势、表情、背景、画风、视角、光影标签图鉴与中文说明）
  - **《构图风格》**（64 条，版本 `2025.10.19`）—— 作者：**凉夏之夜**（带 `1.5::...::` 权重壳与推荐画幅的成品场景串）
  - **《解构原典》**（274 条，版本 `2025.7.18`）—— 作者：**解构原典编撰组**（NovelAI 正向与负向配套解构范例）
  - **《更衣人偶》**（430 条，版本 `2026.9.6`）—— 作者：**Sol**（[hayde0096/Kisegaeningyou](https://github.com/hayde0096/Kisegaeningyou)，服装组合提示词）
  - **《叫我千藤就好了の衣柜》**（125 条，版本 `2026.3.1`）—— 作者：**叫我千藤就好了**（服饰风格与文化说明）
  - **《所长 NAI v5 / v4.5 常规与色色个人法典》**（共 19,484 条，版本 `2026.10.27`）—— 作者：**戒红所**，配图数据提供：**拉风de茶**
  - **《梦神·涩涩法典》**（351 条）—— 作者：**梦神**，配图数据提供：**无间的种**（[prompt-vault-gallery](https://prompt-vault-gallery.pages.dev)）

## 🔗 相关链接

- [NovelAI 官网](https://novelai.net/)
- [NovelAI API 文档](https://api.novelai.net/docs/)
- [MCP 官方文档](https://modelcontextprotocol.io/)
- [问题反馈](https://github.com/SGSxingchen/NovelAI_MCP/issues)

---

<div align="center">

**如果这个项目对你有帮助，请给个 ⭐️！**

</div>
