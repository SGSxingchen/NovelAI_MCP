export const V5_STYLIST_TOPICS = [
  'full',
  'workflow',
  'seven_dimensions',
  'tag_budget',
  'blueprints',
  'artist_mix',
  'decontaminate',
  'advanced_engineering',
  'reverse_and_audit',
  'gotchas',
] as const;
export type V5StylistTopic = (typeof V5_STYLIST_TOPICS)[number];

export const V5_STYLE_BLUEPRINT_IDS = [
  'pop_halftone_poster',
  'faux_nihonga_watercolor',
  'retro_90s_cel',
  'high_contrast_etching',
  'atmospheric_story_cg',
] as const;
export type V5StyleBlueprintId = (typeof V5_STYLE_BLUEPRINT_IDS)[number];

export interface V5StyleBlueprint {
  id: V5StyleBlueprintId;
  name: string;
  recommendedModel: 'nai-diffusion-5-full' | 'nai-diffusion-5-curated';
  recommendedSettings: {
    quality_preset: 'none' | 'light' | 'standard';
    uc_preset: 'none' | 'light' | 'heavy';
    scale_range: string;
    steps: number;
  };
  promptBaseline: string;
  notes: string;
  decontaminationTip: string;
  fineTuningKnobs: string[];
}

export const V5_STYLE_BLUEPRINTS: Record<V5StyleBlueprintId, V5StyleBlueprint> = {
  pop_halftone_poster: {
    id: 'pop_halftone_poster',
    name: 'Pop Halftone Graphic Poster (波普网点平面海报)',
    recommendedModel: 'nai-diffusion-5-curated',
    recommendedSettings: {
      quality_preset: 'none',
      uc_preset: 'light',
      scale_range: '5.0 - 6.5',
      steps: 23,
    },
    promptBaseline:
      '1.3::halftone::, 1.2::screentone::, graphic design, flat color, bold outline, limited palette, 1.15::omutatsu::, 0.8::umemaro::, 0.6::uekura eku::, 0.45::mochizuki kei::, 0.2::rolua::',
    notes:
      '适合海报、MV 主视觉、潮流平面插画；关闭质量预设并使用 Light/None 负面预设，避免 Heavy 预设悄悄吞掉 halftone 与 screentone。',
    decontaminationTip:
      '搭配 `-3::glossy skin, 3d, photorealistic, airbrush::` 抑制塑料光泽与平滑渐变。',
    fineTuningKnobs: [
      '调整 `halftone` / `screentone` 权重（±0.05~0.10）控制网点颗粒强度',
      '调整 `0.2::rolua::`（0.15~0.30，步进 0.05）控制色彩张力与锐度',
      '在自然语言构图段加入明确负空间与引号内标题文字（默认走 V5 Curated；仅在超长排版文本 >703 token 时再按需切 V5 Full）',
    ],
  },
  faux_nihonga_watercolor: {
    id: 'faux_nihonga_watercolor',
    name: 'Faux Nihonga & Mineral Watercolor (伪日本画与岩彩水彩)',
    recommendedModel: 'nai-diffusion-5-curated',
    recommendedSettings: {
      quality_preset: 'none',
      uc_preset: 'light',
      scale_range: '3.5 - 4.8',
      steps: 23,
    },
    promptBaseline:
      'faux traditional media, nihonga, watercolor (medium), ink (medium), shikishi, muted color, pale color, fine outline + 1 structural illustrator (1.0) + 1 botanical/painterly artist (0.35)',
    notes:
      '将材质与色彩克制词放在提示词最前端，配合较低 Guidance（3.5 - 4.8）保留纸纹、水痕与柔和笔触。',
    decontaminationTip:
      '关闭 Add Quality Tags；若出现塑料质感，增加 `-2.5::glossy, digital airbrush, 3d::`。',
    fineTuningKnobs: [
      'Guidance 在 3.5~4.8 间微调（越低越松弛梦幻，越高边缘越清晰）',
      '后段植物/厚涂画师权重以 0.05 步进调整（0.25~0.40）避免破坏五官结构',
      '可补充 `washi`, `gold leaf` 等材质词并限制主色调（`<color> theme`）',
    ],
  },
  retro_90s_cel: {
    id: 'retro_90s_cel',
    name: '90s Retro Cel & Production Keyframe (90 年代复古赛璐璐原画)',
    recommendedModel: 'nai-diffusion-5-curated',
    recommendedSettings: {
      quality_preset: 'none',
      uc_preset: 'light',
      scale_range: '4.8 - 6.0',
      steps: 23,
    },
    promptBaseline:
      'year 1995, anime screencap, production art, animation paper, color trace, anime coloring, chromatic aberration, retro artstyle',
    notes:
      '务必使用 `uc_preset: "light"` 或 `"none"`，因为 `heavy` 会静默压制 `chromatic aberration` 和胶片颗粒。',
    decontaminationTip:
      '避免在开头放高于 `0.4` 权重的现代厚涂画师；必要时加 `-2.5::modern digital shading, glossy skin, airbrush::`。',
    fineTuningKnobs: [
      '微调年代锚点（如 `year 1993` ~ `year 1998`）切换赛璐璐质感与发色线条',
      '若色散过重，用 `0.8::chromatic aberration::` 收敛边缘色差',
      '可用自然语言指定 `cel shadow`, `hand-painted gouache background` 强化赛璐璐分层',
    ],
  },
  high_contrast_etching: {
    id: 'high_contrast_etching',
    name: 'High-Contrast Etching & Dramatic Spot Color (高对比钢笔蚀刻与单点专色)',
    recommendedModel: 'nai-diffusion-5-curated',
    recommendedSettings: {
      quality_preset: 'none',
      uc_preset: 'light',
      scale_range: '5.0 - 6.5',
      steps: 23,
    },
    promptBaseline:
      'ink (medium), nib pen (medium), ligne claire, high contrast, partially colored, spot color, monochrome + strictly one focal accent color named in the scene description',
    notes:
      '默认首选 `nai-diffusion-5-curated`（亦可按用户指定切 `nai-diffusion-5-full`）。关键禁忌：非焦点元素的发色、瞳色、衣着颜色词必须全部移除，否则 V5 会把整张图上成全彩。',
    decontaminationTip:
      '仅保留唯一焦点色（如 crimson scarf / golden eyes），并移除所有其他颜色形容词。',
    fineTuningKnobs: [
      '用 `1.15::hatching (texture)::` 或 `1.1::ink (medium)::` 控制钢笔排线密度',
      '在自然语言构图里明确强明暗对比与光影切割方向',
      'Guidance 提高至 5.5~6.5 让黑白线条与局部专色边界更利落',
    ],
  },
  atmospheric_story_cg: {
    id: 'atmospheric_story_cg',
    name: 'Atmospheric Story & Scenic Concept CG (氛围叙事与场景概念 CG)',
    recommendedModel: 'nai-diffusion-5-curated',
    recommendedSettings: {
      quality_preset: 'light',
      uc_preset: 'light',
      scale_range: '4.0 - 5.5',
      steps: 23,
    },
    promptBaseline:
      '1 luminous scenic lead (1.2 to 1.3) + 3 to 5 soft-lighting and environmental illustrators stepped down from 0.9 to 0.5, with background architecture and lighting cues in natural language',
    notes:
      '默认首选 `nai-diffusion-5-curated`（~703 有效 token，极净商业光影与角色氛围）；把建筑空间、时间段光影和镜头关系写在自然语言段。',
    decontaminationTip:
      '若画师自带无关奇幻盔甲/光环/舰装等 IP 污染，使用 `-2.5::specific_item::` 定点剔除，不必丢弃该画师笔触。',
    fineTuningKnobs: [
      '按 0.05 步进微调领衔场景画师（1.20~1.30）与环境副画师（0.50~0.90）的梯度',
      '降低 Guidance 至 3.8~4.6 获得更柔和通透的大气透视',
      '多角色叙事场景把角色拆分进 `characters` 槽位并指定坐标，主提示词只写镜头与环境关系',
    ],
  },
};

export const V5_STYLIST_RESOURCE_URI = 'novelai://skills/v5-stylist';

const SEVEN_DIMENSIONS = `## 一图一主张与七维决策 · NAI 版

**一图一主张**。先圈定一个最高对比点、一档主导明度、一个主动作和一个色彩事件，其余画面要素降为陪衬。动笔前找一处叙事破口，例如两把椅子都拉开却只来了一人，或雨停了伞还举着。把 \`oppressive\`、\`lonely\`、\`dramatic lighting\` 留在构思阶段，落笔时换成能看见的距离、角度与光线，例如 \`the ceiling sits one hand's width above her hair\`。

1. **瞬间**。锁定事件前后 0.3 秒内的一帧。用 \`hand still hovering above the cup\` 留住未完成的动作，用 \`steam still curling\` 留住残存的物证。眼神落在现场对象上，重心压在一侧。
2. **明度结构**。让 \`dark / mid / bright\` 中一档占画面 55%–70%。阴影里最亮的亮部，必须暗于亮部里最暗的暗部。高调用两到三处具体黑色材质压住明度（G4），低调用一处接近过曝但还保留纹理的实体高光撑住亮度。
3. **光**。写 \`sidelighting / backlighting / crack_of_light\` 方位，指定光边落在两到四处结构表面，再给距离与光比，例如 \`key to fill 8:1, light dies within arm's reach, background falls three stops under\`。硬光明确写 \`each shadow edge is cut like a blade, with no gradient at all\`。交代布光时避开 \`lamp / bulb / fluorescent tube\` 等会被直接画出来的灯具名（G41）。
4. **空间与镜头**。从 \`very_wide_shot, wide_shot, full_body, cowboy_shot, upper_body, portrait, close-up\` 选一个景别，再按需搭配 \`feet_out_of_frame, head_out_of_frame, cropped_legs\` 裁切，或用 \`foreshortening, vanishing_point, atmospheric_perspective, depth_of_field, blurry_background\` 定透视。用同深度的横向结构给人体找参照，例如 \`the top of her head sits slightly below the top edge of the lockers\`。主体放在 \`0.33 / 0.67\` 三分线，避开 \`0.45–0.55\` 居中区，在另一侧写 \`negative_space\` 并指明空域内容，如一段暗墙。
5. **色彩**。把四种色彩角色的面积分成约 60（低饱和环境）/ 30（主体固有色）/ 8（唯一高饱和点缀色，上限 10%）/ 2（中性锚或暖肤色）。颜色挂在被照亮的大块表面上（G9），例如占画面一角的钴蓝门板。要留住暗部色偏，用 \`colored_shadow, hue_shifting\` 并点明阴影覆盖的材质。
6. **材质**。用特定光线下的表面行为取代 \`detailed\`。湿发可以写 \`wet hair strands clumped and stuck to cheek\`，金属可以写 \`bright scratches on raised ridges\`。用 \`sharp only on face, softening past shoulder\` 明确锐度从哪里开始下降。
7. **收尾**。按物理媒介选择 \`film grain\`、\`0.8::chromatic aberration::\`、\`bloom / halation\` 或 \`vignetting\`。用一句话指定最亮与最暗分别落在哪种材质上，例如一条金属亮边 \`stops one step short of blowing out\`，最暗处停在围巾的黑色褶缝里。`;

const TAG_BUDGET = `## 35 Tag 黄金预算与 V5 3-Tier 架构

用 10,958 条 NovelAI 社区语料标定起笔预算。V5 样本中位数为 33 Tag，第 75 百分位为 47 Tag，超过 60 Tag 进入退化尾部。约 35 Tag 是起点。V5 Curated 有效上下文约 703 tokens，V5 Full 约 1471 tokens。

| 分配 | Tag 数 | 用法 |
| --- | --- | --- |
| 人数与画师串 | 4–6 | 三阶画师链依次负责骨架、特征与表层笔触。社区常见 3–8 位画师，中位 6 位，82.3% 的画师串落在全词串前 1/4。 |
| 外貌与身份锚 | 6–8 | 优先保留能认出角色的特征。 |
| 服装与配饰 | 3–5 | 保留剪影、面料和关键配饰。 |
| 动作与姿态主轴 | 2–3 | 锁定一个主动作及其重心。 |
| 场景与环境 | 3–4 | 点明地面、空间边界与临近结构。 |
| 光影方向与效果 | 3–4 | 写方向、边缘质量与主要光效。 |
| 构图与镜头景别 | 3–4 | 写景别、机位、裁切或留白。 |
| 材质与物理状态 | 2–3 | 写受光面可见的行为。 |
| 收尾与媒介质感 | 2–3 | 留给纸纹、胶片或印刷效果。 |

- **光影与构图合计 6–8 Tag**。少于 4 Tag 容易退回均光与居中。末尾留 1–3 句英文自然语言，把 0.3 秒内未完成的动作、光路落点与三档衰减、不对称留白及尺度对位、一个能看见的材质行为写进同一场景。
- **质量词和预设按画风取舍**。常规插画可以使用 \`masterpiece, best quality, very aesthetic\`。采用 \`1.3::halftone::, 1.2::screentone::, 1.2::dithering::\` 等印刷效果时，设置 \`quality_preset: "none"\`，并选择 \`uc_preset: "light"\` 或 \`"none"\` 保存网点和颗粒。
- **权重壳纪律**。V5 样本的权重写法中 95.3% 使用 \`weight::tag::\`。使用 \`1.2::tag::\`、\`0.65::artist::\`、\`-2::unwanted::\` 这样的闭合权重壳，将 \`(word:1.2)\` 转成 \`1.2::word::\`。常规正权重为 0.5–1.5，优先只加权 3–5 处，成稿中的加权项最多占 30%。

V5 精品样本中 41.1% 使用角色子提示词，多人场景的比例超过 55%。V5 和 V4.5 都支持以下三层分工。

1. \`base_prompt\` 写全局媒介、画师串、镜头机位、环境光影与角色间的交互。
2. 每个 \`characters[i]\` 只写该角色的外貌、发色、瞳色、服装及手持物。用归一化的 \`center_x / center_y\` 把角色放到对应的画面位置。
3. \`base_negative_prompt\`（UC）收纳全局不希望出现的内容。某个角色特有的排除项放在其 \`negative_prompt\`。

V4.5 可沿用数字权重壳，提示词长度按对应模型校准。用户指定 V3 时，将角色属性和交互写进 \`base_prompt\`，通过 \`base_negative_prompt\` 管理全局负向词，强调或弱化词分别使用 \`{tag}\` 和 \`[tag]\`。`;

const ADVANCED_ENGINEERING = `## NAI 专项进阶防崩工程 P1–P8

- **P1 先验解绑，避免正向反激活**。无光环的羽翼角色用 \`1girl, wings, feathered wings\` 起笔，移除 \`angel / angelic / seraph\`。正向写实际发型、发饰，以及占住头顶空间的树枝或屋檐。删掉 \`no halo / without halo / nothing hovering above head\` 这类正向否定句，避免再次激活光环。把 \`halo, head halo, floating halo\` 移入 \`base_negative_prompt\`，或在正向单独用 \`-2::halo, head halo, floating halo::\` 压制。胸前有饮品时给双手明确动作，如 \`arms swing naturally at her sides\` 或 \`hands in pockets\`，并在 UC 排除 \`holding cup\`。非婚礼的白裙场景把 \`veil, bridal veil, wedding\` 加入 UC，或用内联 \`-2::veil, bridal veil, wedding::\`。
- **P2 大动态格斗与低机位透视**。先拆四个动作相位，再选一个画面瞬间：蓄势（-0.2s）折翼后收、击发（0.0s）\`1.2::aerial falcon dive::, shockwave\`、滞空（+0.2s）翼尖仍向前摆、收势（+0.4s）\`braking wing\` 单翼向前展开刹住。持刃姿态在同一句写清主手与副手的落位，例如 \`left hand pulled tight at her hip in a clenched counterbalance fist\` 或 \`gripping scabbard\`，减少多臂、断刃。复杂低机位先去掉 \`full_body\`，以裁切和透视物证交代景别。\`from_below, foreshortening\` 要配脸部比例保护句，例如 \`tracking along the flat plane of the blade, keeping facial proportions strictly intact\`，避免鞋底过分放大（B3）。
- **P3 双人对峙与四手全清点**。用 \`characters\` 隔离外貌，左右分别设 \`center_x: 0.3\` 和 \`center_x: 0.7\`。在全局交互句中逐一写出两人的左右手、手中物及接触点（Quad-Lock）。如果只有一人有羽翼，用对手槽位的 \`without wings\` 明确排他特征，也可以把 \`wings\` 写入对手负向槽或用 \`-2::wings::\`。将 \`bright orange sparks, shockwave ring\` 的高光和扰动集中在兵刃交汇处。
- **P4 介质成像与物理光学**。纯水洼倒影交代四项证据：镜头俯看、反射沿水面切线出现、倒像上下颠倒、涟漪或落叶打断反射。隔雨窗看人时用 \`water rivulets cover the entire glass with zero clear spots\`，点名水痕必须 \`slide directly over her face, her hair, her chest\`，再加 \`refracting and distorting contours\` 交代水膜的微透镜形变。用 \`caustics\` 写穿水光斑、\`refraction\` 写折线、\`subsurface_scattering\` 写透薄材质的暖边、\`crack_of_light\` 写窄光束的落点、\`partially_underwater_shot\` 写水线两侧不同的轮廓。
- **P5 三级战损与四层机能穿搭**。轻度写凸起边缘的擦痕与积尘，中度写破缝、卷边和局部露出的里料，重度写断开的固定件与错位的外层，交代剩余支撑点。机能穿搭由贴身底层、保温或保护中层、耐磨外壳、外置绑带或工具四层组成。给各层独立的材质、开口和受光边界，可读性集中在剪影与接缝。
- **P6 双色温暗脊**。主色温照亮约九份面积，副色温限于一份边缘或反光，形成 9:1 面积阶梯。沿身体中央的遮挡面保留暗脊（Occlusion Spine），用 \`separated by clean dark neutral mid-tones\` 把主副光断开，避免受光面被混成大片灰色。
- **P7 极端机位的排他事实**。约 60° 大俯拍写出四条证据：看得见头顶发旋，肩叠在胸上形成垂向缩短，只见鞋面而看不到鞋底，地面线条从脚边向远处退行。保留 \`from_above\` 等机位词来固定这组事实。
- **P8 单图四格分镜**。用 \`4koma, comic, multiple_views\` 开篇，在 \`base_prompt\` 依次写特写眼神、中景出招、全景交代空间、落地收势。每格只承载一个动作阶段，用全局媒介和分槽角色属性保持统一。`;

const REVERSE_AND_AUDIT = `## 参考图反推与出图差值单句微调

1. **先看结构再测光**。先用肉眼确认谁遮谁、手脚接触哪里、动作停在哪一帧。用 \`probe_image\` 测 BT.709 明度三档 \`dark / mid / bright\`、最亮与最暗区域、亮暗部饱和度 \`lit / shadow\`、边缘 \`strong / flat\`、6×6 明度位置和 16×11 真实 HEX 色号。图上可测得的数值用来定位画面差异，光源方向和叙事依然按可见物证判断。
2. **二十问盲读取证（Forensic 20 Questions）**。调用 \`probe_image\` 时启用 \`include_forensic_sop\`，逐项核对返回的 \`forensic_20_questions\`。第一问永远是“脸看得见吗”。没脸就明确写 \`from_behind / face out of frame / silhouette\`，避免模型补一张转向镜头的脸。看不清的小物件只用 \`a small pale ornament\` 等低粒度描述。
3. **色号与参照物一起写**。用 \`a dull printing blue (#3462AB), the colour of water on an old map\` 加 \`covering about a tenth of the frame\` 给出颜色、对象与面积。把竖图改成 21:9 横图时，先重算角色的手脚支撑接触链。若栏杆已经够不到，改写为手抓自己的衣领或肩带，收掉原来那只手与栏杆的联系。
4. **出图前过十三道关**。把写好的提示词和 \`reference_image\` 交给 \`lint_prompt\`，先修正语法、明度与色彩冲突，再看镜头、预设、角色槽和动作检查。
5. **出图后按差值开处方**。用 \`verify_image\` 比较参考图和出图，选择优先级最高的 \`diagnoses\` 条目，沿 \`nai_fix\` 只改 \`base_prompt\` 中那一句，再出图复测。没有参考图时也可对出图调用 \`probe_image\`，检查明度面积、色相落点及材料亮边是否达到自己的目标。`;

export const V5_STYLIST_FULL_GUIDE = `# novelai-v5-stylist

Engineer high-recognizability, bespoke visual styles and production-ready prompt packages for NovelAI Diffusion V5 (\`nai-diffusion-5-curated\` by default, plus \`nai-diffusion-5-full\`) by combining de-homogenized quality settings, stepped artist weight mixes, physical medium anchors, and natural-language composition direction.

## When to Use

- Designing a brand-new signature art style or artist mix for NovelAI V5 that avoids generic glossy AI anime output
- Writing or refining NovelAI V5 prompts for posters, MV key visuals, book covers, retro cel art, painterly concept CGs, or character illustrations
- Translating abstract aesthetic references (such as pop halftone graphic design, faux nihonga watercolor, or high-contrast etching) into executable V5 tag weights and natural-language camera/layout blocks
- Debugging style drift, artist tag clashing, or unintended source-IP costume/prop contamination in NovelAI V5
- Structuring multi-character scenes or single-shot paneled comic pages in NovelAI V5 while preserving a unified visual identity

## Steps

### 1. Select the Base Model and Strip Default Style Filters

Choose the model variant and generation settings before writing prompt tokens, because V5 default presets actively push images toward a uniform semi-painterly anime finish:

- Select \`nai-diffusion-5-curated\` (~703 effective token limit; omit \`model\` in MCP calls unless the user explicitly asks for another variant) as the default for cleaner anatomy, refined lighting, and cohesive stylized aesthetics. Switch to \`nai-diffusion-5-full\` (~1471 effective token limit) only when the user explicitly requests V5 Full, requires niche uncurated artist vocabularies, or embeds extra-long quoted text (>703 prompt tokens / up to 750 characters). Never downgrade to V4.5 unless requested by the user.
- Turn **OFF** \`Add Quality Tags\` (\`quality_preset: "none"\`, or wrap \`[[very aesthetic]]\` in double brackets if kept) whenever building a stylized or analog aesthetic, because default quality tags override subtle medium textures.
- Set \`Undesired Content\` preset to \`light\` or \`none\` (\`uc_preset: "light"\` / \`"none"\` with a custom negative list) whenever using optical or print effects such as \`chromatic aberration\`, \`halftone\`, \`dithering\`, or film grain, since the \`heavy\` preset silently suppresses those tags.

### 2. Anchor Physical Medium, Movement, and Color Palette First

Place global medium, era, and palette tags at the very start of the positive prompt so they govern the entire canvas before character or scene tokens are evaluated:

- **Medium carrier**: Pair an umbrella tag (\`traditional media\`, \`faux traditional media\`, \`mixed media\`) with 1 to 2 specific tool tags such as \`watercolor (medium)\`, \`acrylic paint (medium)\`, \`ink (medium)\`, \`nib pen (medium)\`, or \`millipen (medium)\`.
- **Movement and line treatment**: Anchor edge behavior using \`ligne claire\`, \`nihonga\`, \`ukiyo-e\`, \`art nouveau\`, \`flat color\`, \`bold outline\`, \`no lineart\`, \`oekaki\`, or cel-era \`year 1995, production art, animation paper, color trace\`.
- **Palette constraint**: Restrict color entropy using \`limited palette\`, \`spot color\`, \`partially colored\`, \`muted color\`, \`pastel colors\`, \`high contrast\`, or a dominant \`<color> theme\`.
- **Print and optical texture**: Boost tactile surface tags with numerical emphasis when central to the style, such as \`1.3::halftone::, 1.2::screentone::\` or \`1.2::dithering::\`.

### 3. Calibrate the Stepped Artist Mix (Skeleton -> Features -> Glaze)

NovelAI V5 is highly sensitive to artist weights (shifts of \`0.05\` to \`0.10\` visibly alter the output) and evaluates artist order sequentially from structural anatomy to surface coloring. Build a stepped 3-tier artist chain using \`weight::artist::\` syntax:

1. **Primary structural anchor (\`1.0\` to \`1.25\`, 1st position)**: Place an artist with clean anatomy, proportion stability, and crisp silhouette control first to establish body and facial structure.
2. **Secondary feature and drapery modulators (\`0.45\` to \`0.85\`, middle positions)**: Add 2 to 4 compatible artists that contribute eye styling, fabric folds, hair flow, or graphic framing.
3. **Micro-dosed texture or color glaze (\`0.15\` to \`0.30\`, final positions)**: Place intense, painterly, or avant-garde artists at the end with low fractional weights (\`0.15\` to \`0.30\`) so V5 borrows their color mood and brushwork accents without distorting faces or overpowering earlier tags.

#### Reference Style Blueprints

Use these parameterized blueprints as starting baselines when matching an aesthetic family, and adjust weights in \`0.05\` increments:

- **Pop Halftone Graphic Poster (\`V5 Curated\`)**: \`1.3::halftone::, 1.2::screentone::, graphic design, flat color, bold outline, limited palette, 1.15::omutatsu::, 0.8::umemaro::, 0.6::uekura eku::, 0.45::mochizuki kei::, 0.2::rolua::\`
- **Faux Nihonga & Mineral Watercolor (\`V5 Curated\`)**: \`faux traditional media, nihonga, watercolor (medium), ink (medium), shikishi, muted color, pale color, fine outline\` + 1 structural illustrator (\`1.0\`) + 1 botanical/painterly artist (\`0.35\`)
- **90s Retro Cel & Production Keyframe (\`V5 Curated\`, \`Light\` UC)**: \`year 1995, anime screencap, production art, animation paper, color trace, anime coloring, chromatic aberration, retro artstyle\`
- **High-Contrast Etching & Dramatic Spot Color (\`V5 Curated\`)**: \`ink (medium), nib pen (medium), ligne claire, high contrast, partially colored, spot color, monochrome\` + strictly one focal accent color named in the scene description
- **Atmospheric Story & Scenic Concept CG (\`V5 Curated\`)**: Combine 1 luminous scenic lead (\`1.2\` to \`1.3\`) with 3 to 5 soft-lighting and environmental illustrators stepped down from \`0.9\` to \`0.5\`, keeping background architecture and lighting cues in natural language.

### 4. Direct Composition and Typography in Natural Language

Follow the tag block with clear English or Japanese natural-language sentences to leverage V5's spatial reasoning and 32-channel VAE fidelity:

- **Graphic layout and camera**: Specify lens angle, asymmetry, silhouette interplay, framing devices (such as stained-glass arches, editorial magazine borders, or split panels), and negative space (for example: \`Stark geometric negative space on the left third, extreme low-angle perspective, crisp rim lighting cutting across the silhouette.\`).
- **Multi-character and comic pages**: For multi-character scenes (up to 22 characters) or full comic pages, describe panel layout and relative positions in the base prompt and isolate each character's appearance in separate Character Prompt slots (\`characters\`) with explicit canvas coordinates.
- **Integrated typography**: When generating posters, covers, or comics, place exact title or dialogue strings inside quotation marks (\`"..."\`, up to 750 characters in \`V5 Full\`) and describe the lettering placement and style in natural language.

### 5. De-Contaminate and Tune Guidance

Eliminate residual generic AI sheen and artist-coupled artifacts before finalizing the prompt package:

- **Targeted negative emphasis**: Use inline or negative numerical emphasis (\`-2.0::tag::\` to \`-3.0::tag::\`) to strip unwanted rendering habits or recurring artist tropes (for example: \`-3::glossy skin, 3d, photorealistic, airbrush::\` for flat graphic styles, or \`-3::armor, metal breastplate::\` when fantasy artists inject unwanted plate armor). In \`nai-diffusion-5-full-medium\` (14 steps, where custom Undesired Content is locked), put \`-3::unwanted_item::\` directly inside the positive prompt.
- **Prompt Guidance calibration**: Recommend lower Guidance (\`scale: 3.5\` to \`4.8\`) for painterly, watercolor, and dreamy analog textures, and standard-to-higher Guidance (\`scale: 5.0\` to \`6.5\`) for razor-sharp graphic posters, halftone dots, and intricate typography.
- **Output format**: Present every finished prompt package with five complete sections: \`Model & Settings\` (variant, resolution, steps/effort, guidance, quality toggle, UC preset), \`Positive Prompt\` (\`[Medium & Palette] + [Stepped Artists] + [Natural Language Scene]\`), \`Character Prompts\` (if multi-character), \`Undesired Content / Negative Emphasis\`, and 2 to 3 \`0.05\`-step \`Fine-Tuning Knobs\`.

${SEVEN_DIMENSIONS}

${TAG_BUDGET}

${ADVANCED_ENGINEERING}

${REVERSE_AND_AUDIT}

## Gotchas

- **Default painterly creep**: If an anime or flat-color prompt keeps turning semi-realistic or plasticky, check whether \`Add Quality Tags\` is still enabled (\`quality_preset\` not set to \`"none"\`) or whether a high-detail digital painter is sitting above \`0.4\` weight near the front of the prompt.
- **Color tag contradiction in monochrome/spot-color styles**: When using \`monochrome\`, \`greyscale\`, or \`spot color\`, remove routine hair/eye/clothing color adjectives for non-focal elements; otherwise V5 will color the entire image and break the limited palette.
- **Artist tag IP bleed**: Artists famous for specific gacha games or fantasy franchises often smuggle signature halos, mechanical rigging, or armor into unrelated scenes. Counter this immediately with \`-2.5::specific_item::\` rather than dropping the artist entirely if their brushwork is needed.
- **Enhance button smoothing**: Warn the user before running generic Enhance / aggressive upscaling passes on grain-, halftone-, or typography-heavy V5 outputs, as aggressive upscaling/enhancing can fuse fine screentones and small text; prefer native resolution (\`832x1216\`, \`1216x832\`, \`704x1408\`, or \`1024x1024\`) plus targeted natural-language inpainting for face fixes.

## MCP Parameter Mapping (Quick Reference)

- Default model: \`nai-diffusion-5-curated\` (omit \`model\` unless the user explicitly asks for another variant; never downgrade to V4.5 on your own)
- Disable the quality preset for delicate print and analog textures with \`quality_preset: "none"\`.
- Preserve halftone, chromatic aberration, and grain with \`uc_preset: "light"\` or \`"none"\`.
- Guidance (\`scale\`): painterly/analog \`3.5 - 4.8\`, sharp graphic/poster/typography \`5.0 - 6.5\`
- Medium Effort locked mode: \`model: "nai-diffusion-5-full-medium"\` (put \`-3::unwanted_item::\` inline in \`base_prompt\`)
- Native free-friendly aspect ratios (≤ 1,048,576 px): \`832×1216\`, \`1216×832\`, \`704×1408\`, \`1024×1024\`
`;

const TOPIC_SECTIONS: Record<Exclude<V5StylistTopic, 'full'>, string> = {
  workflow: `### V5 风格工程五步法（摘要）
1. **选型与去默认滤镜**：默认首选 \`nai-diffusion-5-curated\`（~703 token，调用出图时直接省略 \`model\` 参数即可，严禁擅自改传 V4.5 或 V5 Full）；仅在用户明确要求 \`V5 Full\` 或需超长引号文字排版（>703 token / 最多 750 字符）时再切 \`nai-diffusion-5-full\`。非写实或拟传统材质关掉质量标签（\`quality_preset: "none"\`）；含网点/色差/颗粒时用 \`uc_preset: "light"\` 或 \`"none"\`（\`heavy\` 会吞掉这些效果）。
2. **先锚定物理媒介、流派与色板**：把 \`traditional media / faux traditional media / mixed media\` + 具体工具（\`watercolor (medium)\` / \`ink (medium)\` / \`nib pen (medium)\`）+ 线条/流派 + 色板限制（\`limited palette\` / \`spot color\`）+ 印刷纹理权重（\`1.3::halftone::\`）放在 \`base_prompt\` 最前面。
3. **三阶画师权重链（骨架 -> 特征 -> 釉彩）**：\`1.0~1.25\` 首位定解剖与剪影 -> \`0.45~0.85\` 中段 2~4 位调五官与衣褶 -> \`0.15~0.30\` 末位微剂量借色感与笔触；按 \`0.05\` 步进微调。
4. **自然语言导演构图与排版**：紧跟标签段用清晰英/日自然语言描述镜头、负空间、分镜和引号内文字（\`"..."\`，V5 Full 支持最多 750 字符）；多人或漫画页把角色拆进 \`characters\` 槽位配坐标。
5. **去污染与 Guidance 标定**：用 \`-2.0::tag::\` ~ \`-3.0::tag::\` 剔除塑料感或画师自带 IP 配件（\`nai-diffusion-5-full-medium\` 下直接写进 \`base_prompt\`）；水彩/厚涂/梦幻质感 \`scale: 3.5~4.8\`，锐利海报/网点/排版 \`scale: 5.0~6.5\`。

有参考图时先用 \`probe_image\` 测光，再按七维决策和 35 Tag 预算写稿。出图前用 \`lint_prompt\` 检查十三道关，出图后用 \`verify_image\` 决定下一次只改哪一句。`,
  seven_dimensions: SEVEN_DIMENSIONS,
  tag_budget: TAG_BUDGET,
  blueprints: Object.values(V5_STYLE_BLUEPRINTS)
    .map(item => [
      `### ${item.name} (\`${item.id}\`)`,
      `- **推荐模型**：\`${item.recommendedModel}\``,
      `- **推荐参数**：\`quality_preset: "${item.recommendedSettings.quality_preset}"\`, \`uc_preset: "${item.recommendedSettings.uc_preset}"\`, \`scale: ${item.recommendedSettings.scale_range}\`, \`steps: ${item.recommendedSettings.steps}\``,
      `- **起手基线**：\`${item.promptBaseline}\``,
      `- **说明**：${item.notes}`,
      `- **去污染建议**：${item.decontaminationTip}`,
      `- **0.05 微调旋钮**：${item.fineTuningKnobs.join('；')}`,
    ].join('\n'))
    .join('\n\n'),
  artist_mix: `### 阶梯画师混合法则（Skeleton -> Features -> Glaze）
NovelAI V5 对画师权重高度敏感（\`0.05\` ~ \`0.10\` 变化即肉眼可见），并按顺序从解剖结构评估到表层上色：
1. **Primary structural anchor（首位，\`1.0\` ~ \`1.25\`）**：放解剖准确、比例稳健、剪影干脆的画师，锁定身形与头身比。
2. **Secondary feature & drapery modulators（中段，\`0.45\` ~ \`0.85\`）**：放 2~4 位相容画师，负责眉眼、发丝走势、衣褶与画面框景。
3. **Micro-dosed texture/color glaze（末位，\`0.15\` ~ \`0.30\`）**：把强烈厚涂或先锋画师压低放末尾，只借其色温与笔触点缀而不扭曲五官。
- 每次调试按 \`0.05\` 递增/递减；若画面偏油腻写实，排查是否把高细节厚涂画师以 \`>0.4\` 权重放到了前排。`,
  decontaminate: `### 反污染与 Guidance 标定
- **精准负权重剔除**：用 \`-2.0::tag::\` 至 \`-3.0::tag::\` 剥离默认渲染惯性或画师自带无关元素：
  - 扁平平面画风去油腻：\`-3::glossy skin, 3d, photorealistic, airbrush::\`
  - 剔除奇幻/手游画师混入的无关盔甲、光环、舰装：\`-2.5::armor, metal breastplate, halo, mechanical rigging::\`
  - 在 \`nai-diffusion-5-full-medium\`（14 步，自定义负面锁定）下，直接把 \`-3::unwanted_item::\` 写进正向 \`base_prompt\`。
- **Guidance (\`scale\`) 标定**：
  - 写意厚涂、水彩、复古/梦幻模拟介质：\`3.5\` ~ \`4.8\`
  - 锐利平面海报、网点、高对比线稿与复杂文字排版：\`5.0\` ~ \`6.5\`
- **交付五段式提示词包**：\`Model & Settings\` + \`Positive Prompt\`（\`[媒介色板] + [阶梯画师] + [自然语言构图]\`）+ \`Character Prompts\` + \`Undesired Content / Negative Emphasis\` + 2~3 个 \`0.05\` 步进微调旋钮。`,
  advanced_engineering: ADVANCED_ENGINEERING,
  reverse_and_audit: REVERSE_AND_AUDIT,
  gotchas: `### NovelAI V5 风格工程常见坑（Gotchas）
1. **默认厚涂塑料感回潮（Default painterly creep）**：检查 \`quality_preset\` 是否未关（需设 \`"none"\`），或高细节厚涂画师是否以 \`>0.4\` 权重排在了前段。
2. **黑白/单点专色被“破功”染成全彩**：使用 \`monochrome\` / \`greyscale\` / \`spot color\` 时，必须删除所有非焦点元素的发色、瞳色、衣着颜色词，否则 V5 会把整图重新上色。
3. **画师标签 IP 串戏（Artist tag IP bleed）**：知名二游/奇幻画师常自动塞入光环、机械舰装、盔甲；不必放弃画师，直接用 \`-2.5::specific_item::\` 定点拦截。
4. **超分/Enhance 糊掉网点与小字**：颗粒、网点、精细排版图慎用通用超分或重度 Enhance；优先用原生免费友好分辨率（\`832×1216\`、\`1216×832\`、\`704×1408\`、\`1024×1024\`）出图，再用定向局部重绘（\`inpaint_image\`）精修脸部。`,
};

export function renderV5StylistGuide(options: {
  topic?: V5StylistTopic;
  blueprint?: V5StyleBlueprintId;
} = {}): string {
  const { topic = 'full', blueprint } = options;
  if (blueprint) {
    const bp = V5_STYLE_BLUEPRINTS[blueprint];
    const blueprintBlock = [
      `## 选定 V5 风格蓝图：${bp.name}`,
      `- **Blueprint ID**：\`${bp.id}\``,
      `- **推荐模型**：\`${bp.recommendedModel}\``,
      `- **推荐 MCP 参数**：\`quality_preset: "${bp.recommendedSettings.quality_preset}"\`, \`uc_preset: "${bp.recommendedSettings.uc_preset}"\`, \`scale: ${bp.recommendedSettings.scale_range}\`, \`steps: ${bp.recommendedSettings.steps}\``,
      `- **起手提示词基线**：\n\`\`\`text\n${bp.promptBaseline}\n\`\`\``,
      `- **适用与注意事项**：${bp.notes}`,
      `- **反污染建议**：${bp.decontaminationTip}`,
      `- **0.05 步进微调旋钮**：\n${bp.fineTuningKnobs.map(k => `  - ${k}`).join('\n')}`,
    ].join('\n');
    if (topic === 'full') {
      return `${blueprintBlock}\n\n---\n\n${V5_STYLIST_FULL_GUIDE}`;
    }
    return `${blueprintBlock}\n\n---\n\n${TOPIC_SECTIONS[topic]}`;
  }

  if (topic === 'full') {
    return V5_STYLIST_FULL_GUIDE;
  }
  return TOPIC_SECTIONS[topic];
}

export function buildV5StylistPromptMessage(args: {
  subject?: string;
  aesthetic?: string;
  variant?: string;
} = {}): string {
  const requirements: string[] = [];
  if (args.subject?.trim()) requirements.push(`- 画面主题/内容：${args.subject.trim()}`);
  if (args.aesthetic?.trim()) requirements.push(`- 目标美学/风格参考：${args.aesthetic.trim()}`);
  if (args.variant?.trim()) requirements.push(`- 指定模型变体：${args.variant.trim()}`);
  else requirements.push('- 默认模型变体：`nai-diffusion-5-curated`（调用 `generate_image` 时直接省略 `model` 参数即可，勿擅自改传 V4.5 或 V5 Full）');

  const taskHeader = requirements.length > 0
    ? `请严格遵循以下 \`novelai-v5-stylist\` 风格工程规范，为当前需求设计一套去同质化、高辨识度的 NovelAI V5 提示词包（包含 5 段完整结构），并在用户要求出图时直接按该参数调用 \`generate_image\`：\n${requirements.join('\n')}`
    : '请严格遵循以下 `novelai-v5-stylist` 风格工程规范，协助用户设计高辨识度的 NovelAI V5 风格与生产级提示词包，并可直接按规范参数调用 `generate_image`。';

  return `${taskHeader}\n\n${V5_STYLIST_FULL_GUIDE}`;
}
