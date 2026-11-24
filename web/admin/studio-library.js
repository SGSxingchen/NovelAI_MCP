const MIXER_STORAGE_KEY = 'novelai_artist_mixer_v1';
const V3_WEIGHT_STEP = 1.05;

const SAMPLER_LABELS = {
  k_euler_ancestral: 'Euler Ancestral（推荐）',
  k_euler: 'Euler',
  k_dpmpp_2s_ancestral: 'DPM++ 2S Ancestral',
  k_dpmpp_2m: 'DPM++ 2M',
  k_dpmpp_sde: 'DPM++ SDE',
  k_dpmpp_2m_sde: 'DPM++ 2M SDE',
  k_dpm_2: 'DPM 2',
  k_dpm_fast: 'DPM Fast',
  k_lms: 'LMS',
  pndm: 'PNDM',
  ddim_v3: 'DDIM V3',
  ddim: 'DDIM',
};

const SCHEDULE_LABELS = {
  karras: 'Karras（推荐）',
  exponential: '指数 Exponential',
  polyexponential: '多指数 Polyexponential',
  native: '原生 Native（V3）',
};

const QUALITY_LABELS = {
  standard: '标准画质标签',
  light: '轻度画质标签',
  none: '关闭（不自动附加）',
};

const UC_LABELS = {
  heavy: '强力反污染（Heavy）',
  light: '轻度防崩（Light）',
  human: '人像特化（Human）',
  furry: '兽人特化（Furry）',
  none: '关闭（纯自定义）',
};

const FORMAT_LABELS = {
  png: 'PNG 无损（含元数据）',
  webp: 'WebP 轻量化',
};

const PRECISE_REF_LABELS = {
  character: '角色特征',
  style: '画风迁移',
  'character&style': '角色与画风',
  costume: '服装造型',
  delta: '细节增量',
};

const AUGMENT_INFO = {
  'bg-removal': { label: '一键去背景', desc: '自动分离主体透明图（扣点）' },
  lineart: { label: '提取线稿', desc: '生成干净黑白线稿' },
  sketch: { label: '铅笔草图', desc: '转为手绘素描稿' },
  colorize: { label: '自动上色', desc: '给线稿智能上色' },
  emotion: { label: '修改表情', desc: '支持 24 种精细情绪' },
  declutter: { label: '清理杂物', desc: '擦除文字气泡与杂元素' },
  'declutter-keep-bubbles': { label: '去字留气泡', desc: '仅清文字保留漫画框' },
  'pixel-snap': { label: '像素规整', desc: '校准像素画网格（免费）' },
};

const EMOTION_LABELS = {
  neutral: '平静 Neutral',
  happy: '开心 Happy',
  sad: '悲伤 Sad',
  angry: '生气 Angry',
  scared: '惊恐 Scared',
  surprised: '惊讶 Surprised',
  tired: '疲惫 Tired',
  excited: '兴奋 Excited',
  nervous: '紧张 Nervous',
  thinking: '思考 Thinking',
  confused: '困惑 Confused',
  shy: '害羞 Shy',
  disgusted: '厌恶 Disgusted',
  smug: '得意 Smug',
  bored: '无聊 Bored',
  laughing: '大笑 Laughing',
  irritated: '烦躁 Irritated',
  aroused: '魅惑 Aroused',
  embarrassed: '尴尬 Embarrassed',
  worried: '担忧 Worried',
  love: '爱意 Love',
  determined: '坚定 Determined',
  hurt: '受伤 Hurt',
  playful: '俏皮 Playful',
};

const PROMPT_KIND_LABELS = {
  template: '完整模板',
  snippet: '正面积木',
  negative: '负面预设',
};

const STUDIO_MODE_LABELS = {
  generate_image: '文生图',
  img2img: '图生图',
  inpaint_image: '局部重绘',
  augment_image: '导演增强',
  upscale_image: '4 倍超分',
};

function $(id) {
  return document.getElementById(id);
}

function splitCsv(text) {
  return String(text || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatMixEntries(entries, syntax = 'v4') {
  return entries
    .filter((entry) => entry.tag && entry.tag.trim())
    .map(({ tag, weight }) => {
      const cleanTag = tag.trim();
      const w = Number(weight) || 1;
      if (syntax === 'plain' || Math.abs(w - 1) < 0.001) return cleanTag;
      if (syntax === 'v4') return `${Number(w.toFixed(2))}::${cleanTag}::`;
      const layers = Math.round(Math.log(w) / Math.log(V3_WEIGHT_STEP));
      const [open, close] = layers >= 0 ? ['{', '}'] : ['[', ']'];
      return open.repeat(Math.abs(layers)) + cleanTag + close.repeat(Math.abs(layers));
    })
    .join(', ');
}

function appendPromptChunk(current, chunk, prepend = false) {
  const cleanChunk = String(chunk || '').trim().replace(/^,+|,+$/g, '').trim();
  const cleanCurrent = String(current || '').trim().replace(/,+$/g, '').trim();
  if (!cleanChunk) return cleanCurrent;
  if (!cleanCurrent) return cleanChunk;
  if (cleanCurrent.includes(cleanChunk)) return cleanCurrent;
  return prepend ? `${cleanChunk}, ${cleanCurrent}` : `${cleanCurrent}, ${cleanChunk}`;
}

/* ---------- 遵循 validate-input-after-interaction 的交互后延后校验 ARIA 同步 ---------- */
function setupDeferredValidationAria() {
  const supportsUserInvalid = typeof CSS !== 'undefined' && CSS.supports?.('selector(:user-invalid)');
  const dirtyMap = new WeakMap();
  const flagged = new WeakSet();
  const announced = new WeakSet();

  const announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.className = 'visually-hidden';
  document.body.append(announcer);
  let announceTimer = null;

  const linkError = (el, shown) => {
    const errorId = el.dataset?.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const announceError = (el) => {
    const errorEl = el.dataset?.error ? $(el.dataset.error) : null;
    if (!errorEl) return;
    clearTimeout(announceTimer);
    announcer.textContent = '';
    announceTimer = setTimeout(() => {
      announcer.textContent = errorEl.textContent.trim();
    }, 350);
  };

  const syncField = (el, allowAnnounce = false) => {
    if (!el?.matches?.('input, select, textarea')) return;
    let invalid = false;
    if (supportsUserInvalid) {
      invalid = el.matches(':user-invalid');
    } else {
      const st = dirtyMap.get(el);
      invalid = Boolean(st?.hasBlurred && st?.hasInteracted && !el.validity.valid);
      el.classList.toggle('user-invalid-fallback', invalid);
    }
    if (invalid) {
      if (allowAnnounce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute('aria-invalid', 'true');
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
    }
  };

  document.querySelectorAll('input, select, textarea').forEach((el) => el.setAttribute('aria-invalid', 'false'));

  document.addEventListener('blur', (e) => {
    if (!supportsUserInvalid && e.target?.matches?.('input, select, textarea')) {
      const st = dirtyMap.get(e.target) || { hasInteracted: false, hasBlurred: false };
      st.hasBlurred = true;
      dirtyMap.set(e.target, st);
    }
    syncField(e.target, true);
  }, true);

  document.addEventListener('input', (e) => {
    if (!supportsUserInvalid && e.target?.matches?.('input, select, textarea')) {
      const st = dirtyMap.get(e.target) || { hasInteracted: false, hasBlurred: false };
      st.hasInteracted = true;
      dirtyMap.set(e.target, st);
    }
    if (e.target?.hasAttribute?.('aria-invalid')) syncField(e.target, false);
  });

  document.addEventListener('invalid', (e) => {
    if (!supportsUserInvalid && e.target?.matches?.('input, select, textarea')) {
      dirtyMap.set(e.target, { hasInteracted: true, hasBlurred: true });
    }
    announced.add(e.target);
    syncField(e.target, false);
  }, true);

  document.addEventListener('reset', (e) => {
    setTimeout(() => {
      for (const el of e.target?.elements || []) {
        dirtyMap.delete(el);
        el.classList?.remove('user-invalid-fallback');
        syncField(el, false);
      }
    });
  }, true);
}

export function createStudioAndLibrary(ctx) {
  const local = {
    meta: null,
    mode: 'generate_image',
    augmentType: 'bg-removal',
    refMode: 'none',
    characters: [],
    maskRegions: [{ shape: 'rect', x: 0.25, y: 0.25, width: 0.5, height: 0.5 }],
    references: [],
    running: false,
    runHistory: [],
    activeResult: null,
    artists: [],
    prompts: [],
    libraryCategories: [],
    artistFilter: { q: '', type: 'all', category: '' },
    promptFilter: { q: '', kind: '', category: '' },
    mixerSyntax: 'v4',
    mixerSlots: [],
    pickerCallback: null,
    pickerItems: [],
  };

  function fillSelect(selectEl, items, labelMap, keepEmptyOption = false) {
    const prev = selectEl.value;
    selectEl.replaceChildren();
    if (keepEmptyOption) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = keepEmptyOption;
      selectEl.appendChild(opt);
    }
    for (const value of items) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = typeof labelMap === 'function' ? labelMap(value) : (labelMap[value] || value);
      selectEl.appendChild(opt);
    }
    if (prev && [...selectEl.options].some((o) => o.value === prev)) {
      selectEl.value = prev;
    }
  }

  function getCurrentCapability() {
    const model = $('studioModel')?.value || local.meta?.defaultModel || 'nai-diffusion-5-curated';
    return local.meta?.capabilities?.[model] || {
      defaultSteps: 23,
      defaultScale: 7,
      maxCharacters: 32,
      supportsVibe: false,
      supportsVibeInInpaint: false,
      supportsPreciseRef: false,
      supportsTransparent: true,
      supportsSmea: false,
      supportsDecrisp: false,
      supportsNativeSchedule: false,
      varietyBase: null,
      isV3: false,
      isMediumLocked: false,
    };
  }

  function updateModelDependentUI(applyDefaults = false) {
    const model = $('studioModel').value || local.meta?.defaultModel || 'nai-diffusion-5-curated';
    const cap = getCurrentCapability();

    if (applyDefaults) {
      $('studioSteps').value = String(cap.defaultSteps);
      $('studioScale').value = String(cap.defaultScale);
      if (cap.isMediumLocked) {
        $('studioCfgRescale').value = '0';
        $('studioUcPreset').value = 'heavy';
      }
    }

    $('studioSteps').disabled = Boolean(cap.isMediumLocked);
    $('studioCfgRescale').disabled = Boolean(cap.isMediumLocked);
    $('studioUcPreset').disabled = Boolean(cap.isMediumLocked);

    const isInpaint = local.mode === 'inpaint_image';
    const effectiveTransparent = cap.supportsTransparent;
    $('studioTransparentWrap').hidden = !effectiveTransparent;
    if (!effectiveTransparent) $('studioTransparent').checked = false;

    const supportsVariety = cap.varietyBase !== null;
    $('studioVarietyWrap').hidden = !supportsVariety;
    if (!supportsVariety) $('studioVariety').checked = false;

    $('studioV3Extras').hidden = !cap.isV3;
    if (!cap.isV3) {
      $('studioSmea').checked = false;
      $('studioSmeaDyn').checked = false;
      $('studioDecrisp').checked = false;
    }

    // 多角色支持
    const genLike = local.mode === 'generate_image' || local.mode === 'img2img' || local.mode === 'inpaint_image';
    const maxChars = cap.maxCharacters;
    $('studioCharactersCard').hidden = !genLike || maxChars === 0;
    if (maxChars > 0) {
      $('studioCharsDesc').textContent = `当前模型支持最多 ${maxChars} 个独立角色，可配独立负面词与 (X, Y) 画面站位。`;
    }

    // Vibe / 精确参考
    const canVibe = cap.supportsVibe && (!isInpaint || cap.supportsVibeInInpaint);
    const canPrecise = cap.supportsPreciseRef;
    $('studioRefCard').hidden = !genLike || (!canVibe && !canPrecise);
    const vibeBtn = document.querySelector('[data-ref-mode="vibe"]');
    const preciseBtn = document.querySelector('[data-ref-mode="precise"]');
    if (vibeBtn) vibeBtn.disabled = !canVibe;
    if (preciseBtn) preciseBtn.disabled = !canPrecise;
    if ((local.refMode === 'vibe' && !canVibe) || (local.refMode === 'precise' && !canPrecise)) {
      setRefMode('none');
    }

    // 模型说明
    const notices = [];
    if (cap.isMediumLocked) notices.push('V5 Medium 极速模型已锁定 14 步 / CFG Rescale 0 / 强力 UC 预设');
    else if (model.startsWith('nai-diffusion-5')) notices.push('V5 优先消耗独立 V5 额度条，支持自然语言构图与透明背景');
    else if (model.startsWith('nai-diffusion-4-5')) notices.push('V4.5 支持多角色、Vibe 氛围参考与精确角色/画风参考');
    else if (cap.isV3) notices.push('V3 经典模型：支持 SMEA / 动态阈值，不支持独立角色框');
    if (isInpaint && model === 'nai-diffusion-5-curated') {
      notices.push('局部重绘会自动使用同代 V5 Full Inpainting');
    }
    $('studioModelNotice').textContent = notices.join(' · ') || '支持完整参数微调与自动归档';

    updateOpusAndSummary();
  }

  function updateOpusAndSummary() {
    const badge = $('studioOpusBadge');
    const mode = local.mode;
    const model = $('studioModel').value || 'nai-diffusion-5-curated';
    const w = Number($('studioWidth').value) || 832;
    const h = Number($('studioHeight').value) || 1216;
    const steps = Number($('studioSteps').value) || 23;
    const n = Number($('studioSamples').value) || 1;
    const scale = $('studioScale').value || '7';
    const samplerName = SAMPLER_LABELS[$('studioSampler').value] || $('studioSampler').value || 'Euler Ancestral';

    $('studioAdvancedSummary').textContent = `步数 ${steps} · CFG ${scale} · ${samplerName}`;
    $('studioSubmitHint').textContent = `${STUDIO_MODE_LABELS[mode]} · ${mode === 'augment_image' || mode === 'upscale_image' ? (mode === 'upscale_image' ? '4× 高清超分' : (AUGMENT_INFO[local.augmentType]?.label || '导演工具')) : ctx.formatModel(model)}`;

    if (mode === 'upscale_image') {
      badge.className = 'pill pill-warning';
      badge.textContent = '4 倍超分将消耗 Anlas（约 1~4 点）';
      return;
    }
    if (mode === 'augment_image') {
      if (local.augmentType === 'pixel-snap') {
        badge.className = 'pill pill-success';
        badge.textContent = '像素规整免费（0 Anlas）';
      } else if (local.augmentType === 'bg-removal') {
        badge.className = 'pill pill-warning';
        badge.textContent = '一键去背景必扣 Anlas（返回 3 张图）';
      } else {
        badge.className = 'pill pill-success';
        badge.textContent = 'Opus ≤1MP 免费范围';
      }
      return;
    }

    const hasPrecise = local.refMode === 'precise' && local.references.length > 0;
    const hasVibe = local.refMode === 'vibe' && local.references.length > 0;
    const pixels = w * h;
    if (hasPrecise) {
      badge.className = 'pill pill-warning';
      badge.textContent = '精确参考每张约 +5 Anlas';
    } else if (model.startsWith('nai-diffusion-5')) {
      badge.className = pixels <= 1_048_576 && steps <= 28 && n === 1 ? 'pill pill-accent' : 'pill pill-warning';
      badge.textContent = pixels <= 1_048_576 && steps <= 28 && n === 1
        ? '优先走 V5 独立额度条'
        : `高规格 ${w}×${h} / ${steps}步 / ${n}张 将扣点`;
    } else if (pixels <= 1_048_576 && steps <= 28 && n === 1) {
      badge.className = 'pill pill-success';
      badge.textContent = hasVibe ? 'Opus 免费范围（首次 Vibe 编码约 2 点）' : 'Opus 免费范围（0 Anlas）';
    } else {
      badge.className = 'pill pill-warning';
      badge.textContent = `超出 Opus 免费阈值（${w}×${h} / ${steps}步 / ${n}张）`;
    }
  }

  function setStudioMode(mode) {
    local.mode = mode;
    document.querySelectorAll('[data-studio-mode]').forEach((btn) => {
      const active = btn.dataset.studioMode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    const isGen = mode === 'generate_image';
    const isI2I = mode === 'img2img';
    const isInpaint = mode === 'inpaint_image';
    const isAug = mode === 'augment_image';
    const isUpscale = mode === 'upscale_image';
    const genLike = isGen || isI2I || isInpaint;

    $('studioSourceCard').hidden = isGen;
    $('studioImg2ImgExtras').hidden = !isI2I;
    $('studioInpaintCard').hidden = !isInpaint;
    $('studioAugmentCard').hidden = !isAug;
    $('studioUpscaleCard').hidden = !isUpscale;
    $('studioModelCard').hidden = !genLike;
    $('studioPromptCard').hidden = !genLike;
    $('studioAdvancedDetails').hidden = !genLike;

    $('studioBasePrompt').required = genLike;
    $('studioRunBtn').textContent = isUpscale ? '开始 4 倍超分'
      : isAug ? '运行导演增强'
        : isInpaint ? '开始局部重绘'
          : isI2I ? '开始图生图'
            : '开始生成';

    updateModelDependentUI(false);
  }

  function updateSourceThumb(val) {
    const box = $('studioSourceThumb');
    const id = String(val || '').trim();
    if (/^[A-Za-z0-9_-]{43}$/.test(id)) {
      const img = document.createElement('img');
      img.src = `/novelai-admin/api/images/${encodeURIComponent(id)}/thumb`;
      img.alt = '源底图预览';
      box.replaceChildren(img);
    } else {
      const span = document.createElement('span');
      span.className = 'source-thumb-empty';
      span.textContent = id ? '已填外部图片' : '未选择底图';
      box.replaceChildren(span);
    }
  }

  function setRefMode(mode) {
    local.refMode = mode;
    document.querySelectorAll('[data-ref-mode]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.refMode === mode);
    });
    $('studioRefBody').hidden = mode === 'none';
    if (mode !== 'none' && local.references.length === 0) {
      local.references.push(
        mode === 'precise'
          ? { image: '', type: 'character', strength: 1, fidelity: 1 }
          : { image: '', strength: 0.6, information_extracted: 1 },
      );
    }
    renderReferences();
    updateOpusAndSummary();
  }

  function renderReferences() {
    const list = $('studioRefList');
    list.replaceChildren();
    if (local.refMode === 'none') return;

    local.references.forEach((ref, idx) => {
      const card = document.createElement('div');
      card.className = 'sub-item-card';

      const head = document.createElement('div');
      head.className = 'sub-item-head';
      const title = document.createElement('span');
      title.className = 'sub-item-title';
      title.textContent = local.refMode === 'precise' ? `精确参考 #${idx + 1}` : `Vibe 氛围参考 #${idx + 1}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-inline';
      del.textContent = '移除';
      del.addEventListener('click', () => {
        local.references.splice(idx, 1);
        renderReferences();
        updateOpusAndSummary();
      });
      head.append(title, del);
      card.appendChild(head);

      const imgRow = document.createElement('div');
      imgRow.className = 'input-with-btn';
      const imgInput = document.createElement('input');
      imgInput.type = 'text';
      imgInput.className = 'input mono-input';
      imgInput.placeholder = local.refMode === 'vibe' ? '归档 ID（或直接粘贴已缓存 vibe_id）' : '归档 ID 或图片链接';
      imgInput.value = ref.image || ref.vibe_id || '';
      imgInput.addEventListener('input', () => {
        ref.image = imgInput.value.trim();
        delete ref.vibe_id;
      });
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'btn btn-secondary btn-sm';
      pickBtn.textContent = '选画廊图';
      pickBtn.addEventListener('click', () => {
        openGalleryPicker('选择参考图', (imgItem) => {
          ref.image = imgItem.id;
          delete ref.vibe_id;
          imgInput.value = imgItem.id;
        });
      });
      imgRow.append(imgInput, pickBtn);
      card.appendChild(imgRow);

      const paramsRow = document.createElement('div');
      paramsRow.className = local.refMode === 'precise' ? 'param-grid-3' : 'param-grid-2';

      if (local.refMode === 'precise') {
        const typeField = document.createElement('label');
        typeField.className = 'field';
        typeField.innerHTML = '<span class="field-label">参考类型</span>';
        const sel = document.createElement('select');
        sel.className = 'select select-sm';
        for (const t of local.meta?.preciseReferenceTypes || Object.keys(PRECISE_REF_LABELS)) {
          const opt = document.createElement('option');
          opt.value = t;
          opt.textContent = PRECISE_REF_LABELS[t] || t;
          sel.appendChild(opt);
        }
        sel.value = ref.type || 'character';
        sel.addEventListener('change', () => { ref.type = sel.value; });
        typeField.appendChild(sel);
        paramsRow.appendChild(typeField);
      }

      const strField = document.createElement('label');
      strField.className = 'field';
      const strVal = document.createElement('strong');
      strVal.textContent = Number(ref.strength ?? 0.6).toFixed(2);
      const strLbl = document.createElement('span');
      strLbl.className = 'field-label';
      strLbl.append('参考强度 ', strVal);
      const strRange = document.createElement('input');
      strRange.type = 'range';
      strRange.className = 'range-input';
      strRange.min = '0.05';
      strRange.max = '1';
      strRange.step = '0.05';
      strRange.value = String(ref.strength ?? (local.refMode === 'precise' ? 1 : 0.6));
      strRange.addEventListener('input', () => {
        ref.strength = Number(strRange.value);
        strVal.textContent = ref.strength.toFixed(2);
      });
      strField.append(strLbl, strRange);
      paramsRow.appendChild(strField);

      const secondField = document.createElement('label');
      secondField.className = 'field';
      const isPrecise = local.refMode === 'precise';
      const secondKey = isPrecise ? 'fidelity' : 'information_extracted';
      const secondVal = document.createElement('strong');
      secondVal.textContent = Number(ref[secondKey] ?? 1).toFixed(2);
      const secondLbl = document.createElement('span');
      secondLbl.className = 'field-label';
      secondLbl.append(isPrecise ? '保真度 ' : '信息提取度 ', secondVal);
      const secondRange = document.createElement('input');
      secondRange.type = 'range';
      secondRange.className = 'range-input';
      secondRange.min = '0.05';
      secondRange.max = '1';
      secondRange.step = '0.05';
      secondRange.value = String(ref[secondKey] ?? 1);
      secondRange.addEventListener('input', () => {
        ref[secondKey] = Number(secondRange.value);
        secondVal.textContent = ref[secondKey].toFixed(2);
      });
      secondField.append(secondLbl, secondRange);
      paramsRow.appendChild(secondField);

      card.appendChild(paramsRow);
      list.appendChild(card);
    });
  }

  function renderCharacters() {
    const list = $('studioCharactersList');
    list.replaceChildren();
    $('studioCharsEmpty').hidden = local.characters.length > 0;

    local.characters.forEach((char, idx) => {
      const card = document.createElement('div');
      card.className = 'sub-item-card';

      const head = document.createElement('div');
      head.className = 'sub-item-head';
      const title = document.createElement('span');
      title.className = 'sub-item-title';
      title.textContent = `角色 #${idx + 1}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-inline';
      del.textContent = '移除角色';
      del.addEventListener('click', () => {
        local.characters.splice(idx, 1);
        renderCharacters();
      });
      head.append(title, del);
      card.appendChild(head);

      const posField = document.createElement('label');
      posField.className = 'field';
      posField.innerHTML = '<span class="field-label">角色正面提示词</span>';
      const posInput = document.createElement('textarea');
      posInput.className = 'textarea';
      posInput.rows = 2;
      posInput.placeholder = '例如：1girl, silver hair, red eyes, school uniform, looking at viewer';
      posInput.value = char.prompt || '';
      posInput.addEventListener('input', () => { char.prompt = posInput.value; });
      posField.appendChild(posInput);
      card.appendChild(posField);

      const negField = document.createElement('label');
      negField.className = 'field';
      negField.innerHTML = '<span class="field-label">角色专属负面词（可选）</span>';
      const negInput = document.createElement('input');
      negInput.type = 'text';
      negInput.className = 'input input-sm';
      negInput.placeholder = '该角色需要排除的特征';
      negInput.value = char.negative_prompt || '';
      negInput.addEventListener('input', () => { char.negative_prompt = negInput.value; });
      negField.appendChild(negInput);
      card.appendChild(negField);

      const coordRow = document.createElement('div');
      coordRow.className = 'coord-row';
      const grid = document.createElement('div');
      grid.className = 'coord-grid';
      grid.title = '点击 5×5 网格快速设置角色站位 (X, Y)';
      const steps = [0.1, 0.3, 0.5, 0.7, 0.9];
      const dots = [];
      const xInput = document.createElement('input');
      const yInput = document.createElement('input');

      const syncDots = () => {
        dots.forEach(({ dot, gx, gy }) => {
          const hit = Math.abs((char.center_x ?? 0.5) - gx) <= 0.11 && Math.abs((char.center_y ?? 0.5) - gy) <= 0.11;
          dot.classList.toggle('is-active', hit);
        });
      };

      for (const gy of steps) {
        for (const gx of steps) {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'coord-dot';
          dot.setAttribute('aria-label', `站位 X ${gx} Y ${gy}`);
          dot.addEventListener('click', () => {
            char.center_x = gx;
            char.center_y = gy;
            xInput.value = String(gx);
            yInput.value = String(gy);
            syncDots();
          });
          dots.push({ dot, gx, gy });
          grid.appendChild(dot);
        }
      }

      const nums = document.createElement('div');
      nums.className = 'coord-nums';
      const xLbl = document.createElement('label');
      xLbl.textContent = 'X ';
      xInput.type = 'number';
      xInput.className = 'input';
      xInput.min = '0';
      xInput.max = '1';
      xInput.step = '0.05';
      xInput.value = String(char.center_x ?? 0.5);
      xInput.addEventListener('input', () => {
        char.center_x = Math.max(0, Math.min(1, Number(xInput.value) || 0.5));
        syncDots();
      });
      xLbl.appendChild(xInput);

      const yLbl = document.createElement('label');
      yLbl.textContent = 'Y ';
      yInput.type = 'number';
      yInput.className = 'input';
      yInput.min = '0';
      yInput.max = '1';
      yInput.step = '0.05';
      yInput.value = String(char.center_y ?? 0.5);
      yInput.addEventListener('input', () => {
        char.center_y = Math.max(0, Math.min(1, Number(yInput.value) || 0.5));
        syncDots();
      });
      yLbl.appendChild(yInput);

      nums.append(xLbl, yLbl);
      coordRow.append(grid, nums);
      syncDots();
      card.appendChild(coordRow);
      list.appendChild(card);
    });
  }

  function renderMaskRegions() {
    const list = $('studioMaskRegionsList');
    list.replaceChildren();
    local.maskRegions.forEach((region, idx) => {
      const card = document.createElement('div');
      card.className = 'sub-item-card';

      const head = document.createElement('div');
      head.className = 'sub-item-head';
      const title = document.createElement('span');
      title.className = 'sub-item-title';
      title.textContent = `重绘区域 #${idx + 1}（0~1 归一化比例）`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-inline';
      del.textContent = '删除区域';
      del.disabled = local.maskRegions.length <= 1;
      del.addEventListener('click', () => {
        local.maskRegions.splice(idx, 1);
        renderMaskRegions();
      });
      head.append(title, del);
      card.appendChild(head);

      const row = document.createElement('div');
      row.className = 'param-grid-3';

      const shapeField = document.createElement('label');
      shapeField.className = 'field';
      shapeField.innerHTML = '<span class="field-label">形状</span>';
      const shapeSel = document.createElement('select');
      shapeSel.className = 'select select-sm';
      shapeSel.innerHTML = '<option value="rect">矩形</option><option value="ellipse">椭圆</option>';
      shapeSel.value = region.shape || 'rect';
      shapeSel.addEventListener('change', () => { region.shape = shapeSel.value; });
      shapeField.appendChild(shapeSel);
      row.appendChild(shapeField);

      for (const [fieldKey, label] of [['x', '起点 X'], ['y', '起点 Y'], ['width', '宽度 W'], ['height', '高度 H']]) {
        const f = document.createElement('label');
        f.className = 'field';
        f.innerHTML = `<span class="field-label">${label}</span>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'input input-sm';
        inp.min = fieldKey === 'x' || fieldKey === 'y' ? '0' : '0.02';
        inp.max = '1';
        inp.step = '0.05';
        inp.value = String(region[fieldKey]);
        inp.addEventListener('input', () => { region[fieldKey] = Number(inp.value) || 0; });
        f.appendChild(inp);
        row.appendChild(f);
      }

      card.appendChild(row);
      list.appendChild(card);
    });
  }

  function renderAugmentGrid() {
    const grid = $('studioAugmentGrid');
    grid.replaceChildren();
    const types = local.meta?.augmentReqTypes || Object.keys(AUGMENT_INFO);
    for (const reqType of types) {
      const info = AUGMENT_INFO[reqType] || { label: reqType, desc: '' };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `augment-tile${local.augmentType === reqType ? ' is-active' : ''}`;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(local.augmentType === reqType));
      btn.innerHTML = `<strong>${info.label}</strong><span>${info.desc}</span>`;
      btn.addEventListener('click', () => {
        local.augmentType = reqType;
        renderAugmentGrid();
        $('studioEmotionWrap').hidden = reqType !== 'emotion';
        $('studioAugmentGuideWrap').hidden = reqType !== 'emotion' && reqType !== 'colorize';
        updateOpusAndSummary();
      });
      grid.appendChild(btn);
    }
    $('studioEmotionWrap').hidden = local.augmentType !== 'emotion';
    $('studioAugmentGuideWrap').hidden = local.augmentType !== 'emotion' && local.augmentType !== 'colorize';
  }

  function buildStudioPayload() {
    const tool = local.mode;
    if (tool === 'upscale_image') {
      const source_image = $('studioSourceImage').value.trim();
      if (!source_image) throw new Error('请先选择或上传要超分的源底图');
      const params = {
        source_image,
        auto_fit_1mp: $('studioAutoFit1mp').checked,
      };
      const sigma = $('studioBlurSigma').value.trim();
      if (sigma) params.declared_blur_sigma = Number(sigma);
      return { tool, params };
    }

    if (tool === 'augment_image') {
      const source_image = $('studioSourceImage').value.trim();
      if (!source_image) throw new Error('请先选择或上传要处理的源底图');
      const params = {
        source_image,
        req_type: local.augmentType,
      };
      if (local.augmentType === 'emotion') params.emotion = $('studioEmotion').value;
      if (local.augmentType === 'emotion' || local.augmentType === 'colorize') {
        const prompt = $('studioAugmentPrompt').value.trim();
        if (prompt) params.prompt = prompt;
        params.defry = Number($('studioDefry').value) || 0;
      }
      const aw = Number($('studioAugWidth').value);
      const ah = Number($('studioAugHeight').value);
      if (aw > 0) params.width = aw;
      if (ah > 0) params.height = ah;
      return { tool, params };
    }

    const base_prompt = $('studioBasePrompt').value.trim();
    if (!base_prompt) throw new Error('请填写正面提示词');
    const cap = getCurrentCapability();
    const params = {
      base_prompt,
      model: $('studioModel').value,
      width: Number($('studioWidth').value) || 832,
      height: Number($('studioHeight').value) || 1216,
      n_samples: Number($('studioSamples').value) || 1,
      sampler: $('studioSampler').value,
      noise_schedule: $('studioSchedule').value,
      quality_preset: $('studioQualityPreset').value,
      image_format: $('studioImageFormat').value,
    };

    const neg = $('studioNegativePrompt').value.trim();
    if (neg) params.base_negative_prompt = neg;
    if (!cap.isMediumLocked) {
      params.steps = Number($('studioSteps').value) || cap.defaultSteps;
      params.scale = Number($('studioScale').value);
      params.cfg_rescale = Number($('studioCfgRescale').value) || 0;
      params.uc_preset = $('studioUcPreset').value;
    } else {
      params.scale = Number($('studioScale').value);
    }

    const seedRaw = $('studioSeed').value.trim();
    if (seedRaw && Number(seedRaw) > 0) params.seed = Math.trunc(Number(seedRaw));

    const uncondRaw = $('studioUncondScale').value.trim();
    if (uncondRaw !== '') params.uncond_scale = Number(uncondRaw);

    const skipSigmaRaw = $('studioSkipCfgSigma').value.trim();
    if (skipSigmaRaw !== '') params.skip_cfg_above_sigma = Number(skipSigmaRaw);

    if ($('studioLegacyUc').checked) params.legacy_uc = true;
    if (!$('studioTransparentWrap').hidden && $('studioTransparent').checked) params.transparent_background = true;
    if (!$('studioVarietyWrap').hidden && $('studioVariety').checked) params.variety_plus = true;
    if (cap.isV3) {
      if ($('studioSmea').checked) params.smea = true;
      if ($('studioSmeaDyn').checked) params.smea_dyn = true;
      if ($('studioDecrisp').checked) params.dynamic_thresholding = true;
    }

    if (!$('studioCharactersCard').hidden && local.characters.length > 0) {
      const validChars = local.characters
        .filter((c) => c.prompt && c.prompt.trim())
        .map((c) => ({
          prompt: c.prompt.trim(),
          ...(c.negative_prompt?.trim() ? { negative_prompt: c.negative_prompt.trim() } : {}),
          center_x: Number(c.center_x ?? 0.5),
          center_y: Number(c.center_y ?? 0.5),
        }));
      if (validChars.length > 0) {
        params.characters = validChars;
        params.use_coords = $('studioUseCoords').checked;
      }
    }

    if (!$('studioRefCard').hidden && local.refMode === 'vibe') {
      const vibes = local.references
        .filter((r) => (r.image && r.image.trim()) || r.vibe_id)
        .map((r) => ({
          ...(r.vibe_id ? { vibe_id: r.vibe_id } : { image: r.image.trim() }),
          strength: Number(r.strength ?? 0.6),
          information_extracted: Number(r.information_extracted ?? 1),
        }));
      if (vibes.length > 0) params.vibe_references = vibes;
    } else if (!$('studioRefCard').hidden && local.refMode === 'precise') {
      const refs = local.references
        .filter((r) => r.image && r.image.trim())
        .map((r) => ({
          image: r.image.trim(),
          type: r.type || 'character',
          strength: Number(r.strength ?? 1),
          fidelity: Number(r.fidelity ?? 1),
        }));
      if (refs.length > 0) params.character_references = refs;
    }

    if (tool === 'img2img') {
      const source_image = $('studioSourceImage').value.trim();
      if (!source_image) throw new Error('图生图模式请先选择或上传源底图');
      params.source_image = source_image;
      params.strength = Number($('studioStrength').value);
      params.noise = Number($('studioNoise').value);
      params.color_correct = $('studioColorCorrect').checked;
      const exSeed = $('studioExtraNoiseSeed').value.trim();
      if (exSeed && Number(exSeed) > 0) params.extra_noise_seed = Math.trunc(Number(exSeed));
    } else if (tool === 'inpaint_image') {
      const source_image = $('studioSourceImage').value.trim();
      if (!source_image) throw new Error('局部重绘模式请先选择或上传源底图');
      params.source_image = source_image;
      const maskImage = $('studioMaskImage').value.trim();
      if (maskImage) {
        params.mask_image = maskImage;
      } else {
        if (local.maskRegions.length === 0) throw new Error('请至少添加一个局部重绘区域或提供蒙版图');
        params.mask_regions = local.maskRegions.map((r) => ({
          shape: r.shape || 'rect',
          x: Number(r.x),
          y: Number(r.y),
          width: Number(r.width),
          height: Number(r.height),
        }));
      }
      params.inpaint_strength = Number($('studioInpaintStrength').value);
      params.add_original_image = $('studioAddOriginal').checked;
      params.noise = Number($('studioInpaintNoise').value);
    }

    return { tool, params };
  }

  function renderStudioResult(result) {
    local.activeResult = result;
    const canvas = $('studioCanvas');
    const receipt = $('studioReceipt');
    const actions = $('studioResultActions');
    canvas.classList.remove('is-loading');

    if (!result || !result.items?.length) {
      canvas.innerHTML = '<div class="studio-canvas-empty"><p>暂无成品预览</p></div>';
      receipt.hidden = true;
      actions.hidden = true;
      return;
    }

    canvas.replaceChildren();
    if (result.items.length === 1) {
      const item = result.items[0];
      const img = document.createElement('img');
      img.src = item.image_url;
      img.alt = '试画成品';
      img.addEventListener('click', () => window.open(item.image_url, '_blank', 'noopener'));
      canvas.appendChild(img);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'studio-canvas-multi';
      for (const item of result.items) {
        const img = document.createElement('img');
        img.src = item.image_url;
        img.alt = '试画成品';
        img.addEventListener('click', () => window.open(item.image_url, '_blank', 'noopener'));
        wrap.appendChild(img);
      }
      canvas.appendChild(wrap);
    }

    const summaryLines = result.items.map((item, idx) => {
      const parts = [result.items.length > 1 ? `第 ${idx + 1} 张` : '生成结果'];
      if (item.model) parts.push(ctx.formatModel(item.model));
      if (item.width && item.height) parts.push(`${item.width} × ${item.height}`);
      if (item.seed !== undefined) parts.push(`种子 ${item.seed}`);
      return parts.join(' · ');
    });
    if (result.costText) summaryLines.push(result.costText);
    receipt.textContent = summaryLines.join('\n');
    receipt.hidden = false;

    const first = result.items[0];
    actions.replaceChildren();
    actions.hidden = false;

    const makeBtn = (label, cls, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn ${cls} btn-sm`;
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    };

    const dl = document.createElement('a');
    dl.className = 'btn btn-primary btn-sm';
    dl.href = `${first.image_url}?download=1`;
    dl.download = `novelai-${first.id}.${first.ext || 'png'}`;
    dl.textContent = '下载原图';
    actions.appendChild(dl);

    actions.appendChild(makeBtn('设为图生图底图', 'btn-secondary', () => {
      useGalleryImageAsSource(first, 'img2img');
    }));
    actions.appendChild(makeBtn('4 倍超分', 'btn-secondary', () => {
      useGalleryImageAsSource(first, 'upscale_image');
    }));
    if (first.seed) {
      actions.appendChild(makeBtn(`锁定种子 ${first.seed}`, 'btn-ghost', () => {
        $('studioSeed').value = String(first.seed);
        ctx.showToast(`已将随机种子锁定为 ${first.seed}`);
      }));
    }
    actions.appendChild(makeBtn('绑定为画师封面', 'btn-ghost', () => {
      bindGalleryImageToArtist(first);
    }));
  }

  function renderStudioHistory() {
    const card = $('studioHistoryCard');
    const strip = $('studioHistoryStrip');
    card.hidden = local.runHistory.length === 0;
    strip.replaceChildren();
    for (const entry of local.runHistory) {
      const first = entry.items[0];
      if (!first) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `studio-history-thumb${local.activeResult === entry ? ' is-active' : ''}`;
      btn.title = `${first.width || '?'}×${first.height || '?'} · ${entry.costText || '点击预览'}`;
      const img = document.createElement('img');
      img.src = first.thumb_url;
      img.alt = '历史试画缩略图';
      btn.appendChild(img);
      btn.addEventListener('click', () => {
        renderStudioResult(entry);
        renderStudioHistory();
      });
      strip.appendChild(btn);
    }
  }

  /* ---------- 画师串混搭调音台 ---------- */
  function persistMixer() {
    try {
      localStorage.setItem(MIXER_STORAGE_KEY, JSON.stringify({
        syntax: local.mixerSyntax,
        slots: local.mixerSlots,
      }));
    } catch {}
  }

  function restoreMixer() {
    try {
      const raw = JSON.parse(localStorage.getItem(MIXER_STORAGE_KEY) || 'null');
      if (raw && Array.isArray(raw.slots)) {
        local.mixerSlots = raw.slots.filter((s) => s && typeof s.tag === 'string').slice(0, 16);
        if (['v4', 'v3', 'plain'].includes(raw.syntax)) local.mixerSyntax = raw.syntax;
      }
    } catch {}
  }

  function renderMixer() {
    document.querySelectorAll('[data-mix-syntax]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.mixSyntax === local.mixerSyntax);
    });

    const slotsEl = $('mixerSlots');
    slotsEl.replaceChildren();
    const hasSlots = local.mixerSlots.length > 0;
    $('mixerEmpty').hidden = hasSlots;

    local.mixerSlots.forEach((slot, idx) => {
      const row = document.createElement('div');
      row.className = 'mixer-slot';

      const meta = document.createElement('div');
      meta.className = 'mixer-slot-meta';
      const nameEl = document.createElement('div');
      nameEl.className = 'mixer-slot-name';
      nameEl.textContent = slot.name || slot.tag;
      const tagEl = document.createElement('div');
      tagEl.className = 'mixer-slot-tag';
      tagEl.textContent = slot.tag;
      meta.append(nameEl, tagEl);

      const weightWrap = document.createElement('div');
      weightWrap.className = 'mixer-slot-weight';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'range-input';
      slider.min = '0.2';
      slider.max = '2.0';
      slider.step = '0.05';
      slider.value = String(slot.weight ?? 1);
      slider.setAttribute('aria-label', `${slot.name || slot.tag} 权重`);
      const badge = document.createElement('span');
      badge.className = 'mixer-weight-badge';
      badge.textContent = Number(slot.weight ?? 1).toFixed(2);
      slider.addEventListener('input', () => {
        slot.weight = Number(slider.value);
        badge.textContent = slot.weight.toFixed(2);
        $('mixerOutput').value = formatMixEntries(local.mixerSlots, local.mixerSyntax);
        persistMixer();
      });
      weightWrap.append(slider, badge);

      const ops = document.createElement('div');
      ops.className = 'mixer-slot-ops';
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'icon-btn';
      upBtn.textContent = '↑';
      upBtn.title = '上移权重优先级';
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', () => {
        [local.mixerSlots[idx - 1], local.mixerSlots[idx]] = [local.mixerSlots[idx], local.mixerSlots[idx - 1]];
        persistMixer();
        renderMixer();
      });
      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'icon-btn';
      downBtn.textContent = '↓';
      downBtn.title = '下移';
      downBtn.disabled = idx === local.mixerSlots.length - 1;
      downBtn.addEventListener('click', () => {
        [local.mixerSlots[idx + 1], local.mixerSlots[idx]] = [local.mixerSlots[idx], local.mixerSlots[idx + 1]];
        persistMixer();
        renderMixer();
      });
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'icon-btn';
      delBtn.textContent = '✕';
      delBtn.title = '移出调音台';
      delBtn.addEventListener('click', () => {
        local.mixerSlots.splice(idx, 1);
        persistMixer();
        renderMixer();
      });
      ops.append(upBtn, downBtn, delBtn);

      row.append(meta, weightWrap, ops);
      slotsEl.appendChild(row);
    });

    const output = formatMixEntries(local.mixerSlots, local.mixerSyntax);
    $('mixerOutput').value = output;
    $('mixerCopyBtn').disabled = !hasSlots;
    $('mixerSaveBtn').disabled = !hasSlots;
    $('mixerApplyStudioBtn').disabled = !hasSlots;
    $('mixerClearBtn').disabled = !hasSlots;
  }

  function addArtistToMixer(artist, replaceAll = false) {
    if (replaceAll) local.mixerSlots = [];
    if (artist.isMix && artist.mixEntries?.length) {
      for (const item of artist.mixEntries) {
        if (local.mixerSlots.length >= 16) break;
        const exist = local.mixerSlots.find((s) => s.tag.toLowerCase() === item.tag.toLowerCase());
        if (exist) exist.weight = item.weight;
        else local.mixerSlots.push({ name: item.tag.replace(/^artist:\s*/i, ''), tag: item.tag, weight: item.weight });
      }
    } else {
      const exist = local.mixerSlots.find((s) => s.tag.toLowerCase() === artist.tag.toLowerCase());
      if (exist) {
        exist.weight = artist.defaultWeight ?? 1;
      } else if (local.mixerSlots.length < 16) {
        local.mixerSlots.push({ name: artist.name, tag: artist.tag, weight: artist.defaultWeight ?? 1 });
      }
    }
    persistMixer();
    renderMixer();
    ctx.showToast(replaceAll ? `已将「${artist.name}」载入混搭调音台` : `已加入调音台：${artist.name}`);
  }

  /* ---------- 画师与提示词库加载与渲染 ---------- */
  async function reloadLibrary() {
    try {
      const data = await ctx.apiFetch('/library');
      local.artists = data.artists || [];
      local.prompts = data.prompts || [];
      local.libraryCategories = data.categories || [];

      const stats = data.stats || { artists: local.artists.length, prompts: local.prompts.length, mixes: 0 };
      $('statLibraryCount').textContent = `${stats.artists + stats.prompts} 条`;
      $('statLibraryMeta').textContent = `画师 ${stats.artists}（混搭 ${stats.mixes}）· 提示词 ${stats.prompts}`;

      // 分类筛选框同步
      const artistCats = [...new Set(local.artists.flatMap((a) => a.categories || []))].sort((a, b) => a.localeCompare(b));
      const promptCats = [...new Set(local.prompts.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      fillSelect($('artistCategoryFilter'), artistCats, (c) => c, '全部分类');
      fillSelect($('promptCategoryFilter'), promptCats, (c) => c, '全部分类');

      renderArtistsGrid();
      renderPromptsGrid();
    } catch (err) {
      ctx.showToast(err.message, true);
    }
  }

  function renderArtistsGrid() {
    const grid = $('artistsGrid');
    grid.replaceChildren();
    const q = local.artistFilter.q.trim().toLowerCase();
    const type = local.artistFilter.type;
    const cat = local.artistFilter.category;

    const list = local.artists.filter((item) => {
      if (type === 'single' && item.isMix) return false;
      if (type === 'mix' && !item.isMix) return false;
      if (cat && !(item.categories || []).includes(cat)) return false;
      if (q) {
        const hay = [item.name, item.tag, item.notes, ...(item.categories || []), ...(item.models || [])]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    $('artistsEmpty').hidden = list.length > 0;

    for (const item of list) {
      const wrap = document.createElement('div');
      wrap.className = 'lib-card-wrap';
      const card = document.createElement('article');
      card.className = `lib-card${item.pinned ? ' is-pinned' : ''}`;

      const cover = document.createElement('div');
      cover.className = 'lib-cover';
      if (item.preview_thumb_url) {
        const img = document.createElement('img');
        img.src = item.preview_thumb_url;
        img.alt = `${item.name} 画风示例`;
        img.loading = 'lazy';
        cover.appendChild(img);
      } else {
        const glyph = document.createElement('span');
        glyph.className = 'lib-cover-glyph';
        glyph.textContent = (item.name || 'A').slice(0, 2).toUpperCase();
        cover.appendChild(glyph);
      }

      const coverTop = document.createElement('div');
      coverTop.className = 'lib-cover-top';
      const badges = document.createElement('div');
      badges.className = 'lib-cover-badges';
      const typePill = document.createElement('span');
      typePill.className = 'pill pill-overlay';
      typePill.textContent = item.isMix ? `混搭配方 (${item.mixEntries?.length || 0})` : `单画师 · ${Number(item.defaultWeight ?? 1).toFixed(2)}×`;
      badges.appendChild(typePill);
      for (const m of (item.models || []).slice(0, 2)) {
        const mp = document.createElement('span');
        mp.className = 'pill pill-overlay';
        mp.textContent = m;
        badges.appendChild(mp);
      }
      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = `lib-pin-btn${item.pinned ? ' is-pinned' : ''}`;
      pinBtn.title = item.pinned ? '取消置顶' : '置顶收藏';
      pinBtn.setAttribute('aria-label', pinBtn.title);
      pinBtn.textContent = item.pinned ? '★' : '☆';
      pinBtn.addEventListener('click', async () => {
        try {
          await ctx.apiFetch(`/library/artists/${encodeURIComponent(item.id)}`, {
            method: 'PATCH',
            body: { pinned: !item.pinned },
          });
          await reloadLibrary();
        } catch (err) {
          ctx.showToast(err.message, true);
        }
      });
      coverTop.append(badges, pinBtn);
      cover.appendChild(coverTop);
      card.appendChild(cover);

      const body = document.createElement('div');
      body.className = 'lib-body';
      const titleRow = document.createElement('div');
      titleRow.className = 'lib-title-row';
      const title = document.createElement('h3');
      title.className = 'lib-title';
      title.textContent = item.name;
      titleRow.appendChild(title);
      body.appendChild(titleRow);

      const formatted = formatMixEntries(
        item.isMix ? (item.mixEntries || []) : [{ tag: item.tag, weight: item.defaultWeight ?? 1 }],
        local.mixerSyntax,
      );
      const code = document.createElement('div');
      code.className = 'lib-code';
      code.title = formatted || item.tag;
      const codeText = document.createElement('span');
      codeText.className = 'lib-code-text';
      codeText.textContent = formatted || item.tag;
      code.appendChild(codeText);
      body.appendChild(code);

      if (item.notes) {
        const notes = document.createElement('p');
        notes.className = 'lib-notes';
        notes.textContent = item.notes;
        body.appendChild(notes);
      }

      if (item.categories?.length) {
        const tags = document.createElement('div');
        tags.className = 'lib-tags';
        for (const c of item.categories) {
          const pill = document.createElement('span');
          pill.className = 'pill pill-muted';
          pill.textContent = c;
          tags.appendChild(pill);
        }
        body.appendChild(tags);
      }

      const actions = document.createElement('div');
      actions.className = 'lib-actions';
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn btn-primary btn-sm';
      addBtn.textContent = item.isMix ? '载入调音台' : '+ 加入混搭';
      addBtn.addEventListener('click', () => addArtistToMixer(item, item.isMix));

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn btn-secondary btn-sm';
      applyBtn.textContent = '写入试画台';
      applyBtn.addEventListener('click', () => {
        $('studioBasePrompt').value = appendPromptChunk($('studioBasePrompt').value, formatted || item.tag, true);
        updatePromptCharCount();
        ctx.switchTab('studio');
        ctx.showToast(`已将「${item.name}」写入试画台正面词开头`);
      });

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-ghost btn-sm';
      copyBtn.textContent = '复制';
      copyBtn.addEventListener('click', () => ctx.copyText(formatted || item.tag, `已复制 ${item.name}`));

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-ghost btn-sm';
      editBtn.textContent = '编辑';
      editBtn.addEventListener('click', () => openArtistModal(item));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        ctx.askConfirm({
          title: '删除画师条目',
          message: `确定永久删除「${item.name}」吗？`,
          confirmLabel: '确认删除',
          onConfirm: async () => {
            await ctx.apiFetch(`/library/artists/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
            ctx.showToast('已删除画师条目');
            await reloadLibrary();
          },
        });
      });

      actions.append(addBtn, applyBtn, copyBtn, editBtn, delBtn);
      body.appendChild(actions);
      card.appendChild(body);
      wrap.appendChild(card);
      grid.appendChild(wrap);
    }
  }

  function renderPromptsGrid() {
    const grid = $('promptsGrid');
    grid.replaceChildren();
    const q = local.promptFilter.q.trim().toLowerCase();
    const kind = local.promptFilter.kind;
    const cat = local.promptFilter.category;

    const list = local.prompts.filter((item) => {
      if (kind && item.kind !== kind) return false;
      if (cat && item.category !== cat) return false;
      if (q) {
        const hay = [item.title, item.category, item.prompt, item.negativePrompt, ...(item.tags || [])]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    $('promptsEmpty').hidden = list.length > 0;

    for (const item of list) {
      const wrap = document.createElement('div');
      wrap.className = 'lib-card-wrap';
      const card = document.createElement('article');
      card.className = `lib-card${item.pinned ? ' is-pinned' : ''}`;

      const cover = document.createElement('div');
      cover.className = 'lib-cover';
      if (item.preview_thumb_url) {
        const img = document.createElement('img');
        img.src = item.preview_thumb_url;
        img.alt = `${item.title} 封面`;
        img.loading = 'lazy';
        cover.appendChild(img);
      } else {
        const glyph = document.createElement('span');
        glyph.className = 'lib-cover-glyph';
        glyph.textContent = item.kind === 'negative' ? 'UC' : item.kind === 'snippet' ? 'TAG' : 'TPL';
        cover.appendChild(glyph);
      }

      const coverTop = document.createElement('div');
      coverTop.className = 'lib-cover-top';
      const badges = document.createElement('div');
      badges.className = 'lib-cover-badges';
      const kindLabel = PROMPT_KIND_LABELS[item.kind] || item.kind;
      const kindPill = document.createElement('span');
      kindPill.className = 'pill pill-overlay';
      kindPill.textContent = kindLabel;
      badges.appendChild(kindPill);
      if (item.category && item.category !== kindLabel) {
        const catPill = document.createElement('span');
        catPill.className = 'pill pill-overlay';
        catPill.textContent = item.category;
        badges.appendChild(catPill);
      }
      if (item.recommendedWidth && item.recommendedHeight) {
        const sizePill = document.createElement('span');
        sizePill.className = 'pill pill-overlay';
        sizePill.textContent = `${item.recommendedWidth}×${item.recommendedHeight}`;
        badges.appendChild(sizePill);
      }

      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = `lib-pin-btn${item.pinned ? ' is-pinned' : ''}`;
      pinBtn.title = item.pinned ? '取消置顶' : '置顶收藏';
      pinBtn.textContent = item.pinned ? '★' : '☆';
      pinBtn.addEventListener('click', async () => {
        try {
          await ctx.apiFetch(`/library/prompts/${encodeURIComponent(item.id)}`, {
            method: 'PATCH',
            body: { pinned: !item.pinned },
          });
          await reloadLibrary();
        } catch (err) {
          ctx.showToast(err.message, true);
        }
      });
      coverTop.append(badges, pinBtn);
      cover.appendChild(coverTop);
      card.appendChild(cover);

      const body = document.createElement('div');
      body.className = 'lib-body';
      const title = document.createElement('h3');
      title.className = 'lib-title';
      title.textContent = item.title;
      body.appendChild(title);

      const previewText = item.kind === 'negative' ? item.negativePrompt : (item.prompt || item.negativePrompt);
      const code = document.createElement('div');
      code.className = 'lib-code';
      code.title = previewText;
      const codeText = document.createElement('span');
      codeText.className = 'lib-code-text';
      codeText.textContent = previewText || '（空内容）';
      code.appendChild(codeText);
      body.appendChild(code);

      if (item.tags?.length || item.recommendedModel || item.characters?.length) {
        const tags = document.createElement('div');
        tags.className = 'lib-tags';
        if (item.recommendedModel) {
          const mp = document.createElement('span');
          mp.className = 'pill pill-accent';
          mp.textContent = ctx.formatModel(item.recommendedModel);
          tags.appendChild(mp);
        }
        if (item.characters?.length) {
          const cp = document.createElement('span');
          cp.className = 'pill pill-success';
          cp.textContent = `${item.characters.length} 独立角色`;
          tags.appendChild(cp);
        }
        for (const t of (item.tags || []).slice(0, 4)) {
          const tp = document.createElement('span');
          tp.className = 'pill pill-muted';
          tp.textContent = t;
          tags.appendChild(tp);
        }
        body.appendChild(tags);
      }

      const actions = document.createElement('div');
      actions.className = 'lib-actions';

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'btn btn-primary btn-sm';
      loadBtn.textContent = item.kind === 'template' ? '载入试画台' : '追加到试画台';
      loadBtn.addEventListener('click', () => applyPromptToStudio(item, item.kind === 'template'));

      if (item.kind === 'template') {
        const appendBtn = document.createElement('button');
        appendBtn.type = 'button';
        appendBtn.className = 'btn btn-secondary btn-sm';
        appendBtn.textContent = '仅追加词';
        appendBtn.addEventListener('click', () => applyPromptToStudio(item, false));
        actions.append(loadBtn, appendBtn);
      } else {
        actions.append(loadBtn);
      }

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-ghost btn-sm';
      copyBtn.textContent = '复制';
      copyBtn.addEventListener('click', () => ctx.copyText(previewText, `已复制「${item.title}」`));

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-ghost btn-sm';
      editBtn.textContent = '编辑';
      editBtn.addEventListener('click', () => openPromptModal(item));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        ctx.askConfirm({
          title: '删除提示词条目',
          message: `确定永久删除「${item.title}」吗？`,
          confirmLabel: '确认删除',
          onConfirm: async () => {
            await ctx.apiFetch(`/library/prompts/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
            ctx.showToast('已删除提示词条目');
            await reloadLibrary();
          },
        });
      });

      actions.append(copyBtn, editBtn, delBtn);
      body.appendChild(actions);
      card.appendChild(body);
      wrap.appendChild(card);
      grid.appendChild(wrap);
    }
  }

  function applyPromptToStudio(item, replace = false) {
    if (local.mode === 'augment_image' || local.mode === 'upscale_image') {
      setStudioMode('generate_image');
    }
    if (item.kind === 'negative') {
      $('studioNegativePrompt').value = replace
        ? (item.negativePrompt || '')
        : appendPromptChunk($('studioNegativePrompt').value, item.negativePrompt, false);
    } else if (replace) {
      if (item.prompt) $('studioBasePrompt').value = item.prompt;
      if (item.negativePrompt) $('studioNegativePrompt').value = item.negativePrompt;
      if (item.recommendedModel && [...$('studioModel').options].some((o) => o.value === item.recommendedModel)) {
        $('studioModel').value = item.recommendedModel;
        updateModelDependentUI(true);
      }
      if (item.recommendedWidth) $('studioWidth').value = String(item.recommendedWidth);
      if (item.recommendedHeight) $('studioHeight').value = String(item.recommendedHeight);
      syncRatioPresetFromInputs();
      if (item.characters?.length) {
        local.characters = item.characters.map((c) => ({
          prompt: c.prompt || '',
          negative_prompt: c.negative_prompt || '',
          center_x: c.center_x ?? 0.5,
          center_y: c.center_y ?? 0.5,
        }));
        renderCharacters();
      }
    } else {
      if (item.prompt) $('studioBasePrompt').value = appendPromptChunk($('studioBasePrompt').value, item.prompt, false);
      if (item.negativePrompt) $('studioNegativePrompt').value = appendPromptChunk($('studioNegativePrompt').value, item.negativePrompt, false);
    }
    updatePromptCharCount();
    updateOpusAndSummary();
    ctx.switchTab('studio');
    ctx.showToast(replace ? `已载入模板「${item.title}」` : `已将「${item.title}」追加到试画台`);
  }

  /* ---------- 画师 / 提示词编辑弹窗 ---------- */
  function renderArtistMixModalRows(rows) {
    const container = $('artistMixRows');
    container.replaceChildren();
    rows.forEach((row, idx) => {
      const el = document.createElement('div');
      el.className = 'input-with-btn';
      const tagInp = document.createElement('input');
      tagInp.type = 'text';
      tagInp.className = 'input mono-input';
      tagInp.placeholder = 'artist:example';
      tagInp.value = row.tag || '';
      tagInp.addEventListener('input', () => { row.tag = tagInp.value; });

      const wInp = document.createElement('input');
      wInp.type = 'number';
      wInp.className = 'input';
      wInp.style.maxWidth = '92px';
      wInp.min = '0.05';
      wInp.max = '3';
      wInp.step = '0.05';
      wInp.value = String(row.weight ?? 1);
      wInp.addEventListener('input', () => { row.weight = Number(wInp.value) || 1; });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn';
      del.textContent = '✕';
      del.disabled = rows.length <= 1;
      del.addEventListener('click', () => {
        rows.splice(idx, 1);
        renderArtistMixModalRows(rows);
      });

      el.append(tagInp, wInp, del);
      container.appendChild(el);
    });
  }

  let modalMixRows = [];
  function openArtistModal(item = null, presetMix = null) {
    $('artistForm').reset();
    $('artistFormError').hidden = true;
    $('artistEditId').value = item?.id || '';
    $('artistModalTitle').textContent = item ? '编辑画师条目' : (presetMix ? '保存为画师混搭配方' : '新建画师条目');

    const isMix = presetMix ? true : Boolean(item?.isMix);
    $('artistIsMixSelect').value = String(isMix);
    $('artistSingleFields').hidden = isMix;
    $('artistMixFields').hidden = !isMix;

    $('artistNameInput').value = item?.name || (presetMix ? `混搭配方 (${presetMix.length}画师)` : '');
    $('artistTagInput').value = item && !item.isMix ? item.tag : '';
    $('artistDefaultWeightInput').value = String(item?.defaultWeight ?? 1);
    $('artistCategoriesInput').value = (item?.categories || []).join(', ');
    $('artistModelsInput').value = (item?.models || ['V5', 'V4.5']).join(', ');
    $('artistNotesInput').value = item?.notes || '';
    $('artistPreviewIdInput').value = item?.previewImageId || '';
    $('artistPinnedInput').checked = Boolean(item?.pinned);

    modalMixRows = presetMix
      ? presetMix.map((m) => ({ tag: m.tag, weight: m.weight }))
      : (item?.mixEntries?.length ? item.mixEntries.map((m) => ({ ...m })) : [{ tag: '', weight: 1.2 }, { tag: '', weight: 0.75 }]);
    renderArtistMixModalRows(modalMixRows);
    $('artistModal').showModal();
    $('artistNameInput').focus();
  }

  let modalPromptChars = [];
  function renderPromptModalChars() {
    const container = $('promptCharsRows');
    container.replaceChildren();
    modalPromptChars.forEach((ch, idx) => {
      const card = document.createElement('div');
      card.className = 'sub-item-card';
      const head = document.createElement('div');
      head.className = 'sub-item-head';
      head.innerHTML = `<span class="sub-item-title">角色 #${idx + 1}</span>`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-inline';
      del.textContent = '移除';
      del.addEventListener('click', () => {
        modalPromptChars.splice(idx, 1);
        renderPromptModalChars();
      });
      head.appendChild(del);
      const pInp = document.createElement('input');
      pInp.type = 'text';
      pInp.className = 'input input-sm';
      pInp.placeholder = '角色正面提示词';
      pInp.value = ch.prompt || '';
      pInp.addEventListener('input', () => { ch.prompt = pInp.value; });
      const nInp = document.createElement('input');
      nInp.type = 'text';
      nInp.className = 'input input-sm';
      nInp.placeholder = '角色负面词（可选）';
      nInp.value = ch.negative_prompt || '';
      nInp.addEventListener('input', () => { ch.negative_prompt = nInp.value; });
      card.append(head, pInp, nInp);
      container.appendChild(card);
    });
  }

  function syncPromptModalFields() {
    const kind = $('promptKindSelect').value;
    $('promptPositiveWrap').hidden = kind === 'negative';
    $('promptNegativeWrap').hidden = kind === 'snippet';
    $('promptTemplateExtras').hidden = kind !== 'template';
  }

  function openPromptModal(item = null) {
    $('promptForm').reset();
    $('promptFormError').hidden = true;
    $('promptEditId').value = item?.id || '';
    $('promptModalTitle').textContent = item?.id ? '编辑提示词条目' : '新建提示词条目';
    $('promptTitleInput').value = item?.title || '';
    $('promptKindSelect').value = item?.kind || 'template';
    $('promptCategoryInput').value = item?.category || '';
    $('promptBodyInput').value = item?.prompt || '';
    $('promptNegativeInput').value = item?.negativePrompt || '';
    $('promptModelSelect').value = item?.recommendedModel || '';
    $('promptWidthInput').value = item?.recommendedWidth ? String(item.recommendedWidth) : '';
    $('promptHeightInput').value = item?.recommendedHeight ? String(item.recommendedHeight) : '';
    $('promptTagsInput').value = (item?.tags || []).join(', ');
    $('promptPreviewIdInput').value = item?.previewImageId || '';
    $('promptPinnedInput').checked = Boolean(item?.pinned);
    modalPromptChars = (item?.characters || []).map((c) => ({ ...c }));
    renderPromptModalChars();
    syncPromptModalFields();
    $('promptModal').showModal();
    $('promptTitleInput').focus();
  }

  /* ---------- 通用可视化选择器（画廊图 / 画师 / 提示词） ---------- */
  function openPicker({ title, placeholder = '输入关键词过滤…', items, onPick }) {
    $('pickerModalTitle').textContent = title;
    $('pickerSearchInput').value = '';
    $('pickerSearchInput').placeholder = placeholder;
    local.pickerItems = items;
    local.pickerCallback = onPick;
    renderPickerGrid('');
    $('pickerModal').showModal();
    $('pickerSearchInput').focus();
  }

  function renderPickerGrid(query) {
    const grid = $('pickerGrid');
    grid.replaceChildren();
    const q = query.trim().toLowerCase();
    const list = local.pickerItems.filter((it) => !q || `${it.title} ${it.sub} ${it.search || ''}`.toLowerCase().includes(q));
    $('pickerEmpty').hidden = list.length > 0;

    for (const it of list) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'picker-tile';
      if (it.thumb) {
        const img = document.createElement('img');
        img.className = 'picker-tile-img';
        img.src = it.thumb;
        img.alt = it.title;
        img.loading = 'lazy';
        tile.appendChild(img);
      }
      const text = document.createElement('div');
      text.className = 'picker-tile-text';
      const t = document.createElement('span');
      t.className = 'picker-tile-title';
      t.textContent = it.title;
      const s = document.createElement('span');
      s.className = 'picker-tile-sub';
      s.textContent = it.sub || '';
      text.append(t, s);
      tile.appendChild(text);
      tile.addEventListener('click', () => {
        const cb = local.pickerCallback;
        ctx.closeDialog($('pickerModal'));
        if (cb) cb(it.payload);
      });
      grid.appendChild(tile);
    }
  }

  async function openGalleryPicker(title, onPick) {
    try {
      const data = await ctx.apiFetch('/images?limit=60&sort=newest');
      const items = (data.items || []).map((img) => ({
        title: img.private ? `参考图 · ${img.id.slice(0, 8)}` : `${ctx.formatModel(img.model)} · ${img.width || '?'}×${img.height || '?'}`,
        sub: img.prompt_preview || img.id,
        search: `${img.id} ${img.model || ''} ${img.prompt_preview || ''}`,
        thumb: img.thumb_url,
        payload: img,
      }));
      openPicker({ title, placeholder: '搜提示词、模型或归档 ID…', items, onPick });
    } catch (err) {
      ctx.showToast(err.message, true);
    }
  }

  function openArtistPicker(title, onPick) {
    const items = local.artists.map((a) => ({
      title: a.name,
      sub: formatMixEntries(a.isMix ? a.mixEntries : [{ tag: a.tag, weight: a.defaultWeight ?? 1 }], local.mixerSyntax),
      search: `${a.name} ${a.tag} ${(a.categories || []).join(' ')} ${a.notes || ''}`,
      thumb: a.preview_thumb_url || null,
      payload: a,
    }));
    openPicker({ title, placeholder: '搜画师名、分类或标签…', items, onPick });
  }

  function openPromptPicker(title, kindFilter, onPick) {
    const items = local.prompts
      .filter((p) => !kindFilter || p.kind === kindFilter)
      .map((p) => ({
        title: p.title,
        sub: p.kind === 'negative' ? p.negativePrompt : (p.prompt || p.negativePrompt),
        search: `${p.title} ${p.category} ${(p.tags || []).join(' ')} ${p.prompt} ${p.negativePrompt}`,
        thumb: p.preview_thumb_url || null,
        payload: p,
      }));
    openPicker({ title, placeholder: '搜提示词标题、分类或正文…', items, onPick });
  }

  function syncRatioPresetFromInputs() {
    const val = `${$('studioWidth').value}x${$('studioHeight').value}`;
    const presetSel = $('studioRatioPreset');
    presetSel.value = [...presetSel.options].some((o) => o.value === val) ? val : 'custom';
  }

  function updatePromptCharCount() {
    $('studioPromptChars').textContent = `${$('studioBasePrompt').value.length} 字符`;
  }

  /* ---------- 灯箱双向打通接口 ---------- */
  function extractPngParams(detail) {
    const c = detail?.png_metadata?.Comment;
    if (!c || typeof c !== 'object') return {};
    return c;
  }

  function reuseFromGalleryItem(item, detail) {
    const comment = extractPngParams(detail);
    const basePrompt = comment.v4_prompt?.caption?.base_caption || comment.prompt || detail?.png_metadata?.Description || item.prompt_preview || '';
    const negPrompt = comment.v4_negative_prompt?.caption?.base_caption || comment.uc || '';
    const model = item.model && [...$('studioModel').options].some((o) => o.value === item.model)
      ? item.model
      : $('studioModel').value;

    setStudioMode('generate_image');
    $('studioModel').value = model;
    updateModelDependentUI(false);
    if (basePrompt) $('studioBasePrompt').value = basePrompt;
    if (negPrompt) $('studioNegativePrompt').value = negPrompt;
    if (item.width) $('studioWidth').value = String(item.width);
    if (item.height) $('studioHeight').value = String(item.height);
    syncRatioPresetFromInputs();
    if (comment.steps) $('studioSteps').value = String(comment.steps);
    if (comment.scale !== undefined) $('studioScale').value = String(comment.scale);
    if (comment.sampler && [...$('studioSampler').options].some((o) => o.value === comment.sampler)) {
      $('studioSampler').value = comment.sampler;
    }
    if (comment.noise_schedule && [...$('studioSchedule').options].some((o) => o.value === comment.noise_schedule)) {
      $('studioSchedule').value = comment.noise_schedule;
    }
    if (item.seed || comment.seed) $('studioSeed').value = String(item.seed || comment.seed);

    const v4Chars = comment.v4_prompt?.caption?.char_captions;
    const v4NegChars = comment.v4_negative_prompt?.caption?.char_captions || [];
    if (Array.isArray(v4Chars) && v4Chars.length > 0) {
      local.characters = v4Chars.map((ch, i) => ({
        prompt: ch.char_caption || '',
        negative_prompt: v4NegChars[i]?.char_caption || '',
        center_x: ch.centers?.[0]?.x ?? 0.5,
        center_y: ch.centers?.[0]?.y ?? 0.5,
      }));
      renderCharacters();
    }
    updatePromptCharCount();
    updateOpusAndSummary();
    ctx.switchTab('studio');
    ctx.showToast('已将作品参数一键复用到试画台');
  }

  function useGalleryImageAsSource(item, targetMode = 'img2img') {
    setStudioMode(targetMode);
    $('studioSourceImage').value = item.id;
    updateSourceThumb(item.id);
    if (item.width && (targetMode === 'img2img' || targetMode === 'inpaint_image')) {
      $('studioWidth').value = String(item.width);
      $('studioHeight').value = String(item.height);
      syncRatioPresetFromInputs();
    }
    updateOpusAndSummary();
    ctx.switchTab('studio');
    ctx.showToast(`已将作品带入「${STUDIO_MODE_LABELS[targetMode]}」源底图`);
  }

  function saveGalleryItemAsPrompt(item, detail) {
    const comment = extractPngParams(detail);
    const basePrompt = comment.v4_prompt?.caption?.base_caption || comment.prompt || detail?.png_metadata?.Description || item.prompt_preview || '';
    const negPrompt = comment.v4_negative_prompt?.caption?.base_caption || comment.uc || '';
    const v4Chars = comment.v4_prompt?.caption?.char_captions || [];
    const v4NegChars = comment.v4_negative_prompt?.caption?.char_captions || [];
    openPromptModal({
      title: (basePrompt || '画廊作品模板').slice(0, 28),
      kind: 'template',
      category: '画廊精选',
      prompt: basePrompt,
      negativePrompt: negPrompt,
      recommendedModel: item.model || null,
      recommendedWidth: item.width || null,
      recommendedHeight: item.height || null,
      previewImageId: item.id,
      characters: v4Chars.map((ch, i) => ({
        prompt: ch.char_caption || '',
        negative_prompt: v4NegChars[i]?.char_caption || '',
        center_x: ch.centers?.[0]?.x ?? 0.5,
        center_y: ch.centers?.[0]?.y ?? 0.5,
      })),
      tags: [],
    });
  }

  function bindGalleryImageToArtist(item) {
    if (local.artists.length === 0) {
      ctx.showToast('画师词库为空，请先新建画师条目', true);
      return;
    }
    openArtistPicker('选择要绑定此作品封面的画师', async (artist) => {
      try {
        await ctx.apiFetch(`/library/artists/${encodeURIComponent(artist.id)}`, {
          method: 'PATCH',
          body: { previewImageId: item.id },
        });
        ctx.showToast(`已将该作品设为「${artist.name}」的画风封面`);
        await reloadLibrary();
      } catch (err) {
        ctx.showToast(err.message, true);
      }
    });
  }

  /* ---------- JSON 导出导入 ---------- */
  async function exportLibraryJson() {
    try {
      const data = await ctx.apiFetch('/library/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `novelai-library-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      ctx.showToast('已导出画师与提示词库 JSON 备份');
    } catch (err) {
      ctx.showToast(err.message, true);
    }
  }

  async function importLibraryFile(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const res = await ctx.apiFetch('/library/import', {
        method: 'POST',
        body: { ...parsed, mode: 'merge' },
      });
      ctx.showToast(`导入合并完成：画师 ${res.stats.artists} 条 · 提示词 ${res.stats.prompts} 条`);
      await reloadLibrary();
    } catch (err) {
      ctx.showToast(err.message || 'JSON 文件格式无效', true);
    }
  }

  /* ---------- 初始化与事件绑定 ---------- */
  function init() {
    [$('artistModal'), $('artistBatchModal'), $('promptModal'), $('pickerModal')].forEach(ctx.setupModalDialog);
    setupDeferredValidationAria();
    restoreMixer();
    renderMixer();
    renderCharacters();
    renderMaskRegions();

    $('jumpArtistsBtn')?.addEventListener('click', () => ctx.switchTab('artists'));

    // 试画台模式切换
    document.querySelectorAll('[data-studio-mode]').forEach((btn) => {
      btn.addEventListener('click', () => setStudioMode(btn.dataset.studioMode));
    });

    $('studioResetBtn').addEventListener('click', () => {
      $('studioForm').reset();
      $('studioError').hidden = true;
      local.characters = [];
      local.references = [];
      local.maskRegions = [{ shape: 'rect', x: 0.25, y: 0.25, width: 0.5, height: 0.5 }];
      setRefMode('none');
      renderCharacters();
      renderMaskRegions();
      updateSourceThumb('');
      if (local.meta?.defaultModel) $('studioModel').value = local.meta.defaultModel;
      updateModelDependentUI(true);
      updatePromptCharCount();
      ctx.showToast('已重置试画台参数');
    });

    $('studioModel').addEventListener('change', () => updateModelDependentUI(true));
    $('studioRatioPreset').addEventListener('change', () => {
      const v = $('studioRatioPreset').value;
      if (v !== 'custom') {
        const [w, h] = v.split('x');
        $('studioWidth').value = w;
        $('studioHeight').value = h;
      }
      updateOpusAndSummary();
    });
    ['studioWidth', 'studioHeight'].forEach((id) => {
      $(id).addEventListener('input', () => {
        syncRatioPresetFromInputs();
        updateOpusAndSummary();
      });
    });
    ['studioSamples', 'studioSteps', 'studioScale', 'studioSampler'].forEach((id) => {
      $(id).addEventListener('input', updateOpusAndSummary);
      $(id).addEventListener('change', updateOpusAndSummary);
    });

    $('studioBasePrompt').addEventListener('input', updatePromptCharCount);
    $('studioClearSeedBtn').addEventListener('click', () => { $('studioSeed').value = ''; });

    // 滑块数值同步
    const bindRangeLabel = (rangeId, labelId, digits = 2) => {
      $(rangeId).addEventListener('input', () => {
        $(labelId).textContent = digits === 0 ? $(rangeId).value : Number($(rangeId).value).toFixed(digits);
      });
    };
    bindRangeLabel('studioStrength', 'studioStrengthVal', 2);
    bindRangeLabel('studioNoise', 'studioNoiseVal', 2);
    bindRangeLabel('studioInpaintStrength', 'studioInpaintStrengthVal', 2);
    bindRangeLabel('studioInpaintNoise', 'studioInpaintNoiseVal', 2);
    bindRangeLabel('studioDefry', 'studioDefryVal', 0);

    // 源底图选取与本地直传
    $('studioSourceImage').addEventListener('input', () => updateSourceThumb($('studioSourceImage').value));
    $('studioPickSourceBtn').addEventListener('click', () => {
      openGalleryPicker('选择源底图', (img) => {
        $('studioSourceImage').value = img.id;
        updateSourceThumb(img.id);
      });
    });
    $('studioPickMaskBtn').addEventListener('click', () => {
      openGalleryPicker('选择黑白蒙版图', (img) => {
        $('studioMaskImage').value = img.id;
      });
    });
    $('studioUploadSourceInput').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const { image_id } = await ctx.apiFetch('/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
          signal: AbortSignal.timeout(90_000),
        });
        $('studioSourceImage').value = image_id;
        updateSourceThumb(image_id);
        ctx.showToast('底图已加密上传并自动填入');
        ctx.refreshGalleryAndOverview();
      } catch (err) {
        ctx.showToast(err.message, true);
      }
    });

    // 多角色 / 蒙版区域 / 参考图动态行
    $('studioAddCharBtn').addEventListener('click', () => {
      const cap = getCurrentCapability();
      if (local.characters.length >= cap.maxCharacters) {
        ctx.showToast(`当前模型最多支持 ${cap.maxCharacters} 个独立角色`, true);
        return;
      }
      local.characters.push({ prompt: '', negative_prompt: '', center_x: 0.5, center_y: 0.5 });
      renderCharacters();
    });
    $('studioAddMaskRegionBtn').addEventListener('click', () => {
      local.maskRegions.push({ shape: 'rect', x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
      renderMaskRegions();
    });
    document.querySelectorAll('[data-ref-mode]').forEach((btn) => {
      btn.addEventListener('click', () => setRefMode(btn.dataset.refMode));
    });
    $('studioAddRefBtn').addEventListener('click', () => {
      local.references.push(
        local.refMode === 'precise'
          ? { image: '', type: 'character', strength: 1, fidelity: 1 }
          : { image: '', strength: 0.6, information_extracted: 1 },
      );
      renderReferences();
      updateOpusAndSummary();
    });

    // 快捷插入画师 / 提示词 / 负面预设 / 存为模板
    $('studioInsertArtistBtn').addEventListener('click', () => {
      openArtistPicker('选择画师或混搭配方（插入正面词开头）', (artist) => {
        const chunk = formatMixEntries(
          artist.isMix ? artist.mixEntries : [{ tag: artist.tag, weight: artist.defaultWeight ?? 1 }],
          local.mixerSyntax,
        );
        $('studioBasePrompt').value = appendPromptChunk($('studioBasePrompt').value, chunk, true);
        updatePromptCharCount();
        ctx.showToast(`已插入画师「${artist.name}」`);
      });
    });
    $('studioInsertPromptBtn').addEventListener('click', () => {
      openPromptPicker('选择提示词模板或积木', null, (entry) => {
        applyPromptToStudio(entry, entry.kind === 'template');
      });
    });
    $('studioFillUcBtn').addEventListener('click', () => {
      openPromptPicker('选择负面预设（UC）', 'negative', (entry) => {
        $('studioNegativePrompt').value = entry.negativePrompt || '';
        ctx.showToast(`已填入负面预设「${entry.title}」`);
      });
    });
    $('studioSavePromptBtn').addEventListener('click', () => {
      const prompt = $('studioBasePrompt').value.trim();
      openPromptModal({
        title: prompt ? prompt.slice(0, 26) : '',
        kind: 'template',
        category: '试画台',
        prompt,
        negativePrompt: $('studioNegativePrompt').value.trim(),
        recommendedModel: $('studioModel').value,
        recommendedWidth: Number($('studioWidth').value) || null,
        recommendedHeight: Number($('studioHeight').value) || null,
        characters: local.characters.filter((c) => c.prompt.trim()),
        tags: [],
      });
    });

    // Danbooru 标签实时联想
    async function runSuggestTags() {
      const q = $('studioTagQuery').value.trim();
      if (!q) {
        ctx.showToast('请输入要联想的英文或日文前缀', true);
        return;
      }
      const btn = $('studioSuggestTagsBtn');
      btn.disabled = true;
      btn.textContent = '联想中…';
      try {
        const res = await ctx.apiFetch('/studio/suggest-tags', {
          method: 'POST',
          body: { prompt: q, model: $('studioModel').value, lang: $('studioTagLang').value, limit: 24 },
        });
        const list = $('studioTagResults');
        list.replaceChildren();
        const tags = res.tags || [];
        list.hidden = tags.length === 0;
        if (tags.length === 0) ctx.showToast('未找到匹配的联想标签');
        for (const t of tags) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'tag-chip';
          chip.innerHTML = `<span>${t.tag}</span>${t.count ? `<span class="tag-chip-count">${t.count >= 1000 ? `${Math.round(t.count / 1000)}k` : t.count}</span>` : ''}`;
          chip.addEventListener('click', () => {
            $('studioBasePrompt').value = appendPromptChunk($('studioBasePrompt').value, t.tag, false);
            updatePromptCharCount();
            ctx.showToast(`已追加标签：${t.tag}`);
          });
          list.appendChild(chip);
        }
      } catch (err) {
        ctx.showToast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = '联想标签';
      }
    }
    $('studioSuggestTagsBtn').addEventListener('click', runSuggestTags);
    $('studioTagQuery').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSuggestTags();
      }
    });

    // 试画台执行提交
    $('studioForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (local.running) return;
      $('studioError').hidden = true;
      let payload;
      try {
        payload = buildStudioPayload();
      } catch (err) {
        $('studioError').textContent = err.message;
        $('studioError').hidden = false;
        return;
      }

      local.running = true;
      const runBtn = $('studioRunBtn');
      const prevLabel = runBtn.textContent;
      runBtn.disabled = true;
      runBtn.textContent = '生成中…';
      $('studioCanvas').classList.add('is-loading');

      const started = Date.now();
      const timerBadge = $('studioRunTimer');
      timerBadge.className = 'pill pill-accent';
      const tick = setInterval(() => {
        timerBadge.textContent = `绘制中 ${((Date.now() - started) / 1000).toFixed(1)}s`;
      }, 200);

      try {
        const res = await ctx.apiFetch('/studio/run', {
          method: 'POST',
          body: payload,
          signal: AbortSignal.timeout(210_000),
        });
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        timerBadge.className = 'pill pill-success';
        timerBadge.textContent = `完成 · ${elapsed}s`;
        local.runHistory.unshift(res);
        if (local.runHistory.length > 20) local.runHistory.pop();
        renderStudioResult(res);
        renderStudioHistory();
        ctx.showToast(res.costText ? `出图完成！${res.costText}` : `出图完成（共 ${res.items?.length || 1} 张）`);
        ctx.refreshGalleryAndOverview();
        ctx.refreshSubscription();
      } catch (err) {
        $('studioCanvas').classList.remove('is-loading');
        timerBadge.className = 'pill pill-danger';
        timerBadge.textContent = '失败';
        $('studioError').textContent = err.message;
        $('studioError').hidden = false;
        ctx.showToast(err.message, true);
      } finally {
        clearInterval(tick);
        local.running = false;
        runBtn.disabled = false;
        runBtn.textContent = prevLabel;
      }
    });

    $('studioClearHistoryBtn').addEventListener('click', () => {
      local.runHistory = [];
      renderStudioHistory();
    });

    // 调音台按钮
    document.querySelectorAll('[data-mix-syntax]').forEach((btn) => {
      btn.addEventListener('click', () => {
        local.mixerSyntax = btn.dataset.mixSyntax;
        persistMixer();
        renderMixer();
        renderArtistsGrid();
      });
    });
    $('mixerCopyBtn').addEventListener('click', () => {
      const text = $('mixerOutput').value;
      if (text) ctx.copyText(text, '已复制画师串');
    });
    $('mixerSaveBtn').addEventListener('click', () => {
      if (local.mixerSlots.length === 0) return;
      openArtistModal(null, local.mixerSlots);
    });
    $('mixerApplyStudioBtn').addEventListener('click', () => {
      const text = $('mixerOutput').value;
      if (!text) return;
      $('studioBasePrompt').value = appendPromptChunk($('studioBasePrompt').value, text, true);
      updatePromptCharCount();
      ctx.switchTab('studio');
      ctx.showToast('已将混搭画师串写入试画台正面词开头');
    });
    $('mixerClearBtn').addEventListener('click', () => {
      local.mixerSlots = [];
      persistMixer();
      renderMixer();
    });

    // 画师筛选与弹窗
    $('artistSearchInput').addEventListener('input', () => {
      local.artistFilter.q = $('artistSearchInput').value;
      renderArtistsGrid();
    });
    $('artistTypeFilter').addEventListener('change', () => {
      local.artistFilter.type = $('artistTypeFilter').value;
      renderArtistsGrid();
    });
    $('artistCategoryFilter').addEventListener('change', () => {
      local.artistFilter.category = $('artistCategoryFilter').value;
      renderArtistsGrid();
    });
    $('openCreateArtistBtn').addEventListener('click', () => openArtistModal(null));
    $('artistIsMixSelect').addEventListener('change', () => {
      const isMix = $('artistIsMixSelect').value === 'true';
      $('artistSingleFields').hidden = isMix;
      $('artistMixFields').hidden = !isMix;
    });
    $('artistAddMixRowBtn').addEventListener('click', () => {
      if (modalMixRows.length >= 16) return;
      modalMixRows.push({ tag: '', weight: 0.8 });
      renderArtistMixModalRows(modalMixRows);
    });
    $('artistPickCoverBtn').addEventListener('click', () => {
      openGalleryPicker('选择画师封面图', (img) => {
        $('artistPreviewIdInput').value = img.id;
      });
    });

    $('artistForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('artistFormError').hidden = true;
      const id = $('artistEditId').value;
      const isMix = $('artistIsMixSelect').value === 'true';
      const body = {
        name: $('artistNameInput').value.trim(),
        isMix,
        categories: splitCsv($('artistCategoriesInput').value),
        models: splitCsv($('artistModelsInput').value),
        notes: $('artistNotesInput').value.trim(),
        previewImageId: $('artistPreviewIdInput').value.trim() || null,
        pinned: $('artistPinnedInput').checked,
      };
      if (isMix) {
        body.mixEntries = modalMixRows
          .filter((r) => r.tag && r.tag.trim())
          .map((r) => ({ tag: r.tag.trim(), weight: Number(r.weight) || 1 }));
      } else {
        body.tag = $('artistTagInput').value.trim();
        body.defaultWeight = Number($('artistDefaultWeightInput').value) || 1;
      }

      $('artistFormSubmit').disabled = true;
      try {
        if (id) {
          await ctx.apiFetch(`/library/artists/${encodeURIComponent(id)}`, { method: 'PATCH', body });
          ctx.showToast('已更新画师条目');
        } else {
          await ctx.apiFetch('/library/artists', { method: 'POST', body });
          ctx.showToast('已新增画师条目');
        }
        await ctx.closeDialog($('artistModal'));
        await reloadLibrary();
      } catch (err) {
        $('artistFormError').textContent = err.message;
        $('artistFormError').hidden = false;
      } finally {
        $('artistFormSubmit').disabled = false;
      }
    });

    // 批量导入画师弹窗
    $('openArtistBatchBtn').addEventListener('click', () => {
      $('artistBatchForm').reset();
      $('batchFormError').hidden = true;
      $('batchMixNameWrap').hidden = true;
      $('artistBatchModal').showModal();
      $('batchRawText').focus();
    });
    $('batchModeSelect').addEventListener('change', () => {
      $('batchMixNameWrap').hidden = $('batchModeSelect').value !== 'as_mix';
    });
    $('artistBatchForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('batchFormError').hidden = true;
      const mode = $('batchModeSelect').value;
      const body = {
        text: $('batchRawText').value,
        mode,
        categories: splitCsv($('batchCategoriesInput').value),
        models: splitCsv($('batchModelsInput').value),
        ...(mode === 'as_mix' && $('batchMixNameInput').value.trim() ? { mixName: $('batchMixNameInput').value.trim() } : {}),
      };
      $('batchFormSubmit').disabled = true;
      try {
        const res = await ctx.apiFetch('/library/artists/batch-import', { method: 'POST', body });
        await ctx.closeDialog($('artistBatchModal'));
        ctx.showToast(`批量导入成功：新增 ${res.created} 条${res.skipped ? `（跳过重复 ${res.skipped} 条）` : ''}`);
        await reloadLibrary();
      } catch (err) {
        $('batchFormError').textContent = err.message;
        $('batchFormError').hidden = false;
      } finally {
        $('batchFormSubmit').disabled = false;
      }
    });

    // 提示词筛选与弹窗
    document.querySelectorAll('[data-prompt-kind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        local.promptFilter.kind = btn.dataset.promptKind;
        document.querySelectorAll('[data-prompt-kind]').forEach((b) => b.classList.toggle('is-active', b === btn));
        renderPromptsGrid();
      });
    });
    $('promptSearchInput').addEventListener('input', () => {
      local.promptFilter.q = $('promptSearchInput').value;
      renderPromptsGrid();
    });
    $('promptCategoryFilter').addEventListener('change', () => {
      local.promptFilter.category = $('promptCategoryFilter').value;
      renderPromptsGrid();
    });
    $('openCreatePromptBtn').addEventListener('click', () => openPromptModal(null));
    $('promptKindSelect').addEventListener('change', syncPromptModalFields);
    $('promptAddCharBtn').addEventListener('click', () => {
      modalPromptChars.push({ prompt: '', negative_prompt: '', center_x: 0.5, center_y: 0.5 });
      renderPromptModalChars();
    });
    $('promptPickCoverBtn').addEventListener('click', () => {
      openGalleryPicker('选择提示词封面图', (img) => {
        $('promptPreviewIdInput').value = img.id;
      });
    });

    $('promptForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('promptFormError').hidden = true;
      const id = $('promptEditId').value;
      const kind = $('promptKindSelect').value;
      const w = Number($('promptWidthInput').value);
      const h = Number($('promptHeightInput').value);
      const body = {
        title: $('promptTitleInput').value.trim(),
        kind,
        category: $('promptCategoryInput').value.trim(),
        prompt: kind === 'negative' ? '' : $('promptBodyInput').value.trim(),
        negativePrompt: kind === 'snippet' ? '' : $('promptNegativeInput').value.trim(),
        recommendedModel: kind === 'template' ? ($('promptModelSelect').value || null) : null,
        recommendedWidth: kind === 'template' && w > 0 ? w : null,
        recommendedHeight: kind === 'template' && h > 0 ? h : null,
        characters: kind === 'template'
          ? modalPromptChars.filter((c) => c.prompt && c.prompt.trim()).map((c) => ({
            prompt: c.prompt.trim(),
            ...(c.negative_prompt?.trim() ? { negative_prompt: c.negative_prompt.trim() } : {}),
            ...(c.center_x !== undefined ? { center_x: c.center_x } : {}),
            ...(c.center_y !== undefined ? { center_y: c.center_y } : {}),
          }))
          : [],
        tags: splitCsv($('promptTagsInput').value),
        previewImageId: $('promptPreviewIdInput').value.trim() || null,
        pinned: $('promptPinnedInput').checked,
      };
      $('promptFormSubmit').disabled = true;
      try {
        if (id) {
          await ctx.apiFetch(`/library/prompts/${encodeURIComponent(id)}`, { method: 'PATCH', body });
          ctx.showToast('已更新提示词条目');
        } else {
          await ctx.apiFetch('/library/prompts', { method: 'POST', body });
          ctx.showToast('已新增提示词条目');
        }
        await ctx.closeDialog($('promptModal'));
        await reloadLibrary();
      } catch (err) {
        $('promptFormError').textContent = err.message;
        $('promptFormError').hidden = false;
      } finally {
        $('promptFormSubmit').disabled = false;
      }
    });

    // 选择器过滤
    $('pickerSearchInput').addEventListener('input', () => {
      renderPickerGrid($('pickerSearchInput').value);
    });

    // JSON 导出 / 导入按钮（两个面板共用）
    document.querySelectorAll('[data-export-library]').forEach((btn) => {
      btn.addEventListener('click', exportLibraryJson);
    });
    document.querySelectorAll('[data-import-library]').forEach((input) => {
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.value = '';
        await importLibraryFile(file);
      });
    });
  }

  async function loadInitialData() {
    try {
      const meta = await ctx.apiFetch('/studio/meta');
      local.meta = meta;
      fillSelect($('studioModel'), meta.models || [], (m) => ctx.formatModel(m));
      fillSelect($('promptModelSelect'), meta.models || [], (m) => ctx.formatModel(m), '不限定');
      fillSelect($('studioSampler'), meta.samplers || [], SAMPLER_LABELS);
      fillSelect($('studioSchedule'), meta.noiseSchedules || [], SCHEDULE_LABELS);
      fillSelect($('studioQualityPreset'), meta.qualityPresets || [], QUALITY_LABELS);
      fillSelect($('studioUcPreset'), meta.ucPresets || [], UC_LABELS);
      fillSelect($('studioImageFormat'), meta.imageFormats || [], FORMAT_LABELS);
      fillSelect($('studioEmotion'), meta.emotionMoods || [], EMOTION_LABELS);

      if (meta.defaultModel) $('studioModel').value = meta.defaultModel;
      $('studioSampler').value = 'k_euler_ancestral';
      $('studioSchedule').value = 'karras';
      $('studioQualityPreset').value = 'standard';
      $('studioUcPreset').value = 'heavy';
      $('studioImageFormat').value = 'png';
      $('studioEmotion').value = 'happy';

      renderAugmentGrid();
      setStudioMode(local.mode);
      updateModelDependentUI(true);
    } catch (err) {
      ctx.showToast(err.message, true);
    }
    await reloadLibrary();
  }

  return {
    init,
    loadInitialData,
    reloadLibrary,
    reuseFromGalleryItem,
    useGalleryImageAsSource,
    saveGalleryItemAsPrompt,
    bindGalleryImageToArtist,
  };
}
