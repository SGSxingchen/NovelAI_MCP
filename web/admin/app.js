import { createStudioAndLibrary } from './studio-library.js?v=studio-library-2';

const API_BASE = '/novelai-admin/api';
const PAGE_SIZE = 30;

const MODEL_LABELS = {
  'nai-diffusion-5-curated': 'V5 精选版',
  'nai-diffusion-5-full': 'V5 完整版',
  'nai-diffusion-5-full-medium': 'V5 极速版',
  'nai-diffusion-5-full-inpainting': 'V5 完整局部重绘',
  'nai-diffusion-5-full-medium-inpainting': 'V5 极速局部重绘',
  'nai-diffusion-4-5-full': 'V4.5 完整版',
  'nai-diffusion-4-5-curated': 'V4.5 精选版',
  'nai-diffusion-4-5-full-inpainting': 'V4.5 完整局部重绘',
  'nai-diffusion-4-5-curated-inpainting': 'V4.5 精选局部重绘',
  'nai-diffusion-4-full': 'V4 完整版',
  'nai-diffusion-4-curated-preview': 'V4 精选预览',
  'nai-diffusion-4-full-inpainting': 'V4 完整局部重绘',
  'nai-diffusion-4-curated-inpainting': 'V4 精选局部重绘',
  'nai-diffusion-3': 'V3 动漫版',
  'nai-diffusion-furry-3': 'V3 兽人版',
  'nai-diffusion-3-inpainting': 'V3 局部重绘',
  'nai-diffusion-furry-3-inpainting': 'V3 兽人局部重绘',
};

const TOOL_LABELS = {
  generate_image: '文生图',
  img2img: '图生图',
  inpaint_image: '局部重绘',
  augment_image: '导演增强',
  upscale_image: '4 倍超分',
};

const ACTION_LABELS = {
  generate: '文生图',
  upload: '参考图',
  img2img: '图生图',
  infill: '局部重绘',
  upscale: '4 倍超分',
  lineart: '提取线稿',
  sketch: '转素描',
  colorize: '智能上色',
  declutter: '清理画面',
  'declutter-keep-bubbles': '清理（留气泡）',
  emotion: '表情变换',
  'bg-removal': '移除背景',
  'pixel-snap': '像素对齐',
};

const TIER_LABELS = {
  Paper: '免费档',
  Tablet: '平板档',
  Scroll: '卷轴档',
  Opus: '至尊 Opus',
};

const state = {
  authenticated: false,
  publicOrigin: null,
  activeTab: 'gallery',
  images: [],
  totalImages: 0,
  hasMore: false,
  loadingImages: false,
  filters: {
    q: '',
    link_id: '',
    model: '',
    sort: 'newest',
  },
  facets: { models: [], tools: [], links: [] },
  selectedIds: new Set(),
  lightboxIndex: -1,
  links: [],
  suppressClickUntil: 0,
};

const $ = (id) => document.getElementById(id);

const els = {
  toastRegion: $('toastRegion'),
  loginView: $('loginView'),
  appView: $('appView'),
  loginForm: $('loginForm'),
  passwordInput: $('passwordInput'),
  loginError: $('loginError'),
  loginSubmit: $('loginSubmit'),
  tabGallery: $('tabGallery'),
  tabStudio: $('tabStudio'),
  tabArtists: $('tabArtists'),
  tabPrompts: $('tabPrompts'),
  tabLinks: $('tabLinks'),
  panelGallery: $('panelGallery'),
  panelStudio: $('panelStudio'),
  panelArtists: $('panelArtists'),
  panelPrompts: $('panelPrompts'),
  panelLinks: $('panelLinks'),
  themeToggleBtn: $('themeToggleBtn'),
  logoutBtn: $('logoutBtn'),
  statImageCount: $('statImageCount'),
  statImageSize: $('statImageSize'),
  statLinkActive: $('statLinkActive'),
  statLinkCalls: $('statLinkCalls'),
  statAnlas: $('statAnlas'),
  statSubMeta: $('statSubMeta'),
  refreshSubBtn: $('refreshSubBtn'),
  searchInput: $('searchInput'),
  filterLink: $('filterLink'),
  filterModel: $('filterModel'),
  filterSort: $('filterSort'),
  refreshGalleryBtn: $('refreshGalleryBtn'),
  uploadReferenceBtn: $('uploadReferenceBtn'),
  referenceUploadDialog: $('referenceUploadDialog'),
  referenceUploadForm: $('referenceUploadForm'),
  referenceFile: $('referenceFile'),
  referenceFileStatus: $('referenceFileStatus'),
  referenceUploadError: $('referenceUploadError'),
  referenceUploadSubmit: $('referenceUploadSubmit'),
  referenceIdField: $('referenceIdField'),
  referenceImageId: $('referenceImageId'),
  copyReferenceIdBtn: $('copyReferenceIdBtn'),
  galleryStage: $('galleryStage'),
  marqueeBox: $('marqueeBox'),
  galleryGrid: $('galleryGrid'),
  galleryEmpty: $('galleryEmpty'),
  galleryFooter: $('galleryFooter'),
  loadMoreBtn: $('loadMoreBtn'),
  galleryProgress: $('galleryProgress'),
  linksList: $('linksList'),
  linksEmpty: $('linksEmpty'),
  openCreateLinkBtn: $('openCreateLinkBtn'),
  batchBar: $('batchBar'),
  batchCountText: $('batchCountText'),
  batchSelectAllBtn: $('batchSelectAllBtn'),
  batchCopyLinksBtn: $('batchCopyLinksBtn'),
  batchDeleteBtn: $('batchDeleteBtn'),
  batchClearBtn: $('batchClearBtn'),
  lightboxDialog: $('lightboxDialog'),
  lightboxImg: $('lightboxImg'),
  lightboxBody: $('lightboxBody'),
  lightboxPrevBtn: $('lightboxPrevBtn'),
  lightboxNextBtn: $('lightboxNextBtn'),
  createLinkDialog: $('createLinkDialog'),
  createLinkForm: $('createLinkForm'),
  newLinkLabel: $('newLinkLabel'),
  newLinkExpiry: $('newLinkExpiry'),
  newLinkDisclosure: $('newLinkDisclosure'),
  createLinkSubmit: $('createLinkSubmit'),
  guideDialog: $('guideDialog'),
  guideBody: $('guideBody'),
  confirmDialog: $('confirmDialog'),
  confirmTitle: $('confirmTitle'),
  confirmMessage: $('confirmMessage'),
  confirmOkBtn: $('confirmOkBtn'),
};

/* ---------- 工具函数 ---------- */

function formatModel(model) {
  if (!model) return '未知模型';
  return MODEL_LABELS[model] || '其他模型';
}

function formatAction(item) {
  if (item.action && ACTION_LABELS[item.action]) return ACTION_LABELS[item.action];
  if (item.tool && TOOL_LABELS[item.tool]) return TOOL_LABELS[item.tool];
  return '作品';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

function formatTime(iso) {
  if (!iso) return '从未';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function showToast(message, isError = false) {
  const node = document.createElement('div');
  node.className = `toast${isError ? ' is-error' : ''}`;
  node.textContent = message;
  els.toastRegion.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 0.2s ease';
    setTimeout(() => node.remove(), 220);
  }, isError ? 4200 : 2600);
}

async function copyText(text, successMsg = '已复制到剪贴板') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    showToast(successMsg);
  }
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined && typeof options.body !== 'string' && !(options.body instanceof Blob)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers,
  });
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  }
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/status') {
    enterLoginView();
    throw new Error(data?.error || '登录状态已失效，请重新登录');
  }
  if (!res.ok) {
    throw new Error(data?.error || `请求失败（状态 ${res.status}）`);
  }
  return data;
}

/* ---------- 现代主题切换（遵循 dark-mode-toggle 规范） ---------- */

function getMetaScheme() {
  return document.querySelector('meta[name="color-scheme"]');
}

function getSystemScheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredScheme() {
  try {
    const v = localStorage.getItem('color-scheme');
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function applySchemeToMeta(scheme) {
  const meta = getMetaScheme();
  if (meta) meta.content = scheme || 'light dark';
}

function toggleColorScheme() {
  const currentRendered = getStoredScheme() || getSystemScheme();
  const target = currentRendered === 'dark' ? 'light' : 'dark';
  const system = getSystemScheme();
  const nextStored = target === system ? null : target;
  try {
    if (nextStored) localStorage.setItem('color-scheme', nextStored);
    else localStorage.removeItem('color-scheme');
  } catch {}
  applySchemeToMeta(nextStored);
}

window.addEventListener('storage', (event) => {
  if (event.key === 'color-scheme') {
    applySchemeToMeta(getStoredScheme());
  }
});

/* ---------- 原生 Dialog 顶层退场与 Safari 轻触遮罩关闭兜底 ---------- */

let supportsDisplayTransitionCache;
function canTransitionDisplay() {
  if (supportsDisplayTransitionCache !== undefined) return supportsDisplayTransitionCache;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransitionCache = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransitionCache;
}

function supportsTopLayerExit() {
  return Boolean(window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay());
}

async function closeDialog(dialog) {
  if (!dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  dialog.close();
}

function setupModalDialog(dialog) {
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog(dialog);
  });
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside = rect.top <= event.clientY && event.clientY <= rect.top + rect.height
        && rect.left <= event.clientX && event.clientX <= rect.left + rect.width;
      if (!inside) closeDialog(dialog);
    });
  }
}

let pendingConfirmAction = null;
function askConfirm({ title, message, confirmLabel = '确认', onConfirm }) {
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmOkBtn.textContent = confirmLabel;
  pendingConfirmAction = onConfirm;
  els.confirmDialog.showModal();
}

/* ---------- 视图切换与登录 ---------- */

function enterLoginView() {
  state.authenticated = false;
  els.appView.hidden = true;
  els.loginView.hidden = false;
  els.passwordInput.value = '';
  els.passwordInput.focus();
}

let studioLib = null;

async function enterAppView() {
  state.authenticated = true;
  els.loginView.hidden = true;
  els.appView.hidden = false;
  await Promise.all([
    loadOverview(),
    loadImages({ reset: true }),
    loadLinks(),
    loadSubscription(),
    studioLib ? studioLib.loadInitialData() : Promise.resolve(),
  ]);
}

function switchTab(tab) {
  state.activeTab = tab;
  const tabs = [
    ['gallery', els.tabGallery, els.panelGallery],
    ['studio', els.tabStudio, els.panelStudio],
    ['artists', els.tabArtists, els.panelArtists],
    ['prompts', els.tabPrompts, els.panelPrompts],
    ['links', els.tabLinks, els.panelLinks],
  ];
  for (const [key, btn, panel] of tabs) {
    const active = key === tab;
    if (btn) btn.setAttribute('aria-selected', String(active));
    if (panel) panel.hidden = !active;
  }
  updateBatchBar();
  if (tab === 'links') loadLinks();
  if ((tab === 'artists' || tab === 'prompts') && studioLib) studioLib.reloadLibrary();
}

/* ---------- 概览与订阅点数 ---------- */

async function loadOverview() {
  try {
    const data = await apiFetch('/overview');
    state.publicOrigin = data.publicOrigin || state.publicOrigin;
    els.statImageCount.textContent = `${data.archive.totalCount} 张`;
    els.statImageSize.textContent = `共占用 ${formatBytes(data.archive.totalBytes)}`;
    els.statLinkActive.textContent = `${data.links.enabled} / ${data.links.total}`;
    els.statLinkCalls.textContent = `累计调用 ${data.links.totalCalls} 次 · 耗点 ${data.links.totalAnlasSpent}`;
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadSubscription(manual = false) {
  els.refreshSubBtn.disabled = true;
  try {
    const { summary } = await apiFetch('/subscription');
    const tierCn = TIER_LABELS[summary.tierName] || summary.tierName;
    els.statAnlas.textContent = `${summary.totalAnlas} 点`;
    const parts = [`${tierCn}${summary.active ? '（生效中）' : ''}`];
    parts.push(`固定 ${summary.fixedAnlas} + 购买 ${summary.purchasedAnlas}`);
    if (summary.v5Usage) {
      parts.push(`V5 额度条 ${summary.v5Usage.percent}%`);
    }
    els.statSubMeta.textContent = parts.join(' · ');
    if (manual) showToast('已更新实时余额');
  } catch (err) {
    els.statAnlas.textContent = '获取失败';
    els.statSubMeta.textContent = err.message;
  } finally {
    els.refreshSubBtn.disabled = false;
  }
}

/* ---------- 图库加载与渲染 ---------- */

function syncFilterSelect(selectEl, defaultLabel, entries, currentValue) {
  selectEl.replaceChildren();
  const def = document.createElement('option');
  def.value = '';
  def.textContent = defaultLabel;
  selectEl.appendChild(def);
  for (const entry of entries) {
    const opt = document.createElement('option');
    opt.value = entry.value;
    opt.textContent = entry.label;
    selectEl.appendChild(opt);
  }
  selectEl.value = currentValue;
}

function updateFacetSelects(facets) {
  state.facets = facets;
  const linkOptions = (facets.links || []).map((l) => ({ value: l.id, label: l.label || '未命名链接' }));
  const modelOptions = (facets.models || []).map((m) => ({ value: m, label: formatModel(m) }));
  syncFilterSelect(els.filterLink, '全部来源', linkOptions, state.filters.link_id);
  syncFilterSelect(els.filterModel, '全部模型', modelOptions, state.filters.model);
}

async function loadImages({ reset = false } = {}) {
  if (state.loadingImages) return;
  state.loadingImages = true;
  els.loadMoreBtn.disabled = true;
  try {
    const offset = reset ? 0 : state.images.length;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      sort: state.filters.sort,
    });
    if (state.filters.q.trim()) params.set('q', state.filters.q.trim());
    if (state.filters.link_id) params.set('link_id', state.filters.link_id);
    if (state.filters.model) params.set('model', state.filters.model);

    const data = await apiFetch(`/images?${params.toString()}`);
    if (reset) {
      state.images = data.items || [];
      state.selectedIds.clear();
      els.galleryGrid.replaceChildren();
    } else {
      state.images = state.images.concat(data.items || []);
    }
    state.totalImages = data.total ?? state.images.length;
    state.hasMore = Boolean(data.hasMore);
    if (data.facets) updateFacetSelects(data.facets);

    renderGalleryItems(data.items || [], reset ? 0 : offset);
    updateGalleryChrome();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loadingImages = false;
    els.loadMoreBtn.disabled = false;
  }
}

function createArtCard(item, absoluteIndex) {
  const card = document.createElement('article');
  card.className = 'art-card';
  card.dataset.id = item.id;
  if (state.selectedIds.has(item.id)) card.classList.add('is-selected');

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'art-thumb-wrap';

  const img = document.createElement('img');
  img.className = 'art-thumb';
  img.src = item.thumb_url;
  img.alt = item.prompt_preview ? item.prompt_preview.slice(0, 60) : `作品 ${item.id.slice(0, 8)}`;
  img.decoding = 'async';
  // 遵循 optimize-image-priority：前 2 张作为 LCP 候选使用 fetchpriority="high" 且不加 loading="lazy"，其余仅用 loading="lazy"
  if (absoluteIndex < 2) {
    img.setAttribute('fetchpriority', 'high');
  } else {
    img.loading = 'lazy';
  }
  thumbWrap.appendChild(img);

  const selectBtn = document.createElement('button');
  selectBtn.type = 'button';
  selectBtn.className = 'art-select-hit';
  selectBtn.setAttribute('aria-label', '选择此作品');
  selectBtn.innerHTML = '<span class="art-select-box" aria-hidden="true">✓</span>';
  selectBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleSelect(item.id);
  });
  thumbWrap.appendChild(selectBtn);

  const badges = document.createElement('div');
  badges.className = 'art-badges';
  const modelPill = document.createElement('span');
  modelPill.className = 'pill pill-overlay';
  modelPill.textContent = item.private ? '参考图' : formatModel(item.model);
  badges.appendChild(modelPill);

  if (typeof item.anlas_spent === 'number') {
    const costPill = document.createElement('span');
    costPill.className = 'pill pill-overlay';
    costPill.textContent = item.anlas_spent === 0 ? '免费' : `${item.anlas_spent} 点`;
    badges.appendChild(costPill);
  }
  thumbWrap.appendChild(badges);
  card.appendChild(thumbWrap);

  const meta = document.createElement('div');
  meta.className = 'art-meta';

  const promptEl = document.createElement('p');
  promptEl.className = 'art-prompt';
  promptEl.textContent = item.prompt_preview || `${formatAction(item)} · ${item.width || '?'}×${item.height || '?'}`;
  meta.appendChild(promptEl);

  const foot = document.createElement('div');
  foot.className = 'art-foot';
  const timeSpan = document.createElement('span');
  timeSpan.textContent = formatShortTime(item.created_at);
  foot.appendChild(timeSpan);

  const sourceSpan = document.createElement('span');
  sourceSpan.className = 'art-source-tag';
  sourceSpan.textContent = item.link_label || (item.width && item.height ? `${item.width}×${item.height}` : '历史归档');
  foot.appendChild(sourceSpan);

  meta.appendChild(foot);
  card.appendChild(meta);

  card.addEventListener('click', (event) => {
    if (Date.now() < state.suppressClickUntil) return;
    if (event.metaKey || event.ctrlKey) {
      toggleSelect(item.id);
      return;
    }
    const idx = state.images.findIndex((x) => x.id === item.id);
    if (idx >= 0) openLightbox(idx);
  });

  return card;
}

function renderGalleryItems(items, startIndex) {
  const frag = document.createDocumentFragment();
  items.forEach((item, i) => {
    frag.appendChild(createArtCard(item, startIndex + i));
  });
  els.galleryGrid.appendChild(frag);
}

function updateGalleryChrome() {
  const hasAny = state.images.length > 0;
  els.galleryEmpty.hidden = hasAny;
  els.galleryFooter.hidden = !hasAny;
  els.loadMoreBtn.hidden = !state.hasMore;
  els.galleryProgress.textContent = `已加载 ${state.images.length} / 共 ${state.totalImages} 张`;
  updateBatchBar();
}

function toggleSelect(id, forceState) {
  const shouldSelect = forceState !== undefined ? forceState : !state.selectedIds.has(id);
  if (shouldSelect) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  const card = els.galleryGrid.querySelector(`.art-card[data-id="${CSS.escape(id)}"]`);
  if (card) card.classList.toggle('is-selected', shouldSelect);
  updateBatchBar();
}

function updateBatchBar() {
  const count = state.selectedIds.size;
  els.batchBar.hidden = count === 0 || state.activeTab !== 'gallery';
  els.batchCountText.textContent = `已选 ${count} 张作品`;
}

/* ---------- 桌面端左键拖框批量选择（触屏零干扰 + 松手抑误触） ---------- */

function initMarqueeSelection() {
  let active = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let additive = false;
  let initialSelected = new Set();

  els.galleryStage.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if (event.target.closest('button, input, select, a, .art-select-hit')) return;
    active = true;
    dragging = false;
    startX = event.clientX;
    startY = event.clientY;
    additive = event.shiftKey || event.metaKey || event.ctrlKey;
    initialSelected = new Set(state.selectedIds);
  });

  window.addEventListener('pointermove', (event) => {
    if (!active) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) < 8) return;
    if (!dragging) {
      dragging = true;
      els.galleryStage.classList.add('is-marquee-selecting');
      els.marqueeBox.hidden = false;
    }
    const left = Math.min(startX, event.clientX);
    const top = Math.min(startY, event.clientY);
    const width = Math.abs(dx);
    const height = Math.abs(dy);
    els.marqueeBox.style.left = `${left}px`;
    els.marqueeBox.style.top = `${top}px`;
    els.marqueeBox.style.width = `${width}px`;
    els.marqueeBox.style.height = `${height}px`;

    const boxRect = { left, top, right: left + width, bottom: top + height };
    const cards = els.galleryGrid.querySelectorAll('.art-card');
    const next = additive ? new Set(initialSelected) : new Set();
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      const hit = !(r.right < boxRect.left || r.left > boxRect.right || r.bottom < boxRect.top || r.top > boxRect.bottom);
      const id = card.dataset.id;
      if (hit && id) next.add(id);
    }
    state.selectedIds = next;
    for (const card of cards) {
      card.classList.toggle('is-selected', state.selectedIds.has(card.dataset.id));
    }
    updateBatchBar();
  });

  window.addEventListener('pointerup', () => {
    if (!active) return;
    active = false;
    if (dragging) {
      dragging = false;
      els.marqueeBox.hidden = true;
      els.galleryStage.classList.remove('is-marquee-selecting');
      state.suppressClickUntil = Date.now() + 120;
    }
  });
}

/* ---------- 沉浸式灯箱详情 ---------- */

async function openLightbox(index) {
  if (index < 0 || index >= state.images.length) return;
  state.lightboxIndex = index;
  const item = state.images[index];
  els.lightboxImg.src = item.image_url;
  els.lightboxImg.alt = item.prompt_preview || '作品预览';
  els.lightboxPrevBtn.disabled = index <= 0;
  els.lightboxNextBtn.disabled = index >= state.images.length - 1;
  renderLightboxBody(item, null);
  if (!els.lightboxDialog.open) els.lightboxDialog.showModal();

  try {
    const detail = await apiFetch(`/images/${encodeURIComponent(item.id)}`);
    if (state.images[state.lightboxIndex]?.id === item.id) {
      renderLightboxBody(detail, detail.png_metadata || null);
    }
  } catch {
    // 基础摘要已展示，不阻断浏览
  }
}

function renderLightboxBody(item, pngMeta) {
  els.lightboxBody.replaceChildren();

  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const downloadLink = document.createElement('a');
  downloadLink.className = 'btn btn-primary btn-sm';
  downloadLink.href = `${item.image_url}?download=1`;
  downloadLink.download = `novelai-${item.id}.${item.ext || 'png'}`;
  downloadLink.textContent = '下载原图';
  actions.appendChild(downloadLink);

  const copyIdBtn = document.createElement('button');
  copyIdBtn.type = 'button';
  copyIdBtn.className = 'btn btn-secondary btn-sm';
  copyIdBtn.textContent = '复制归档 ID';
  copyIdBtn.addEventListener('click', () => copyText(item.id, '已复制归档 ID（可直接传给 MCP 二次编辑）'));
  actions.appendChild(copyIdBtn);

  if (item.public_url) {
    const copyUrlBtn = document.createElement('button');
    copyUrlBtn.type = 'button';
    copyUrlBtn.className = 'btn btn-secondary btn-sm';
    copyUrlBtn.textContent = '复制公网短链';
    copyUrlBtn.addEventListener('click', () => copyText(item.public_url, '已复制公开图片链接'));
    actions.appendChild(copyUrlBtn);
  }

  if (studioLib) {
    const reuseBtn = document.createElement('button');
    reuseBtn.type = 'button';
    reuseBtn.className = 'btn btn-secondary btn-sm';
    reuseBtn.textContent = '复用到试画台';
    reuseBtn.addEventListener('click', async () => {
      await closeDialog(els.lightboxDialog);
      studioLib.reuseFromGalleryItem(item, { ...item, png_metadata: pngMeta });
    });
    actions.appendChild(reuseBtn);

    const sourceBtn = document.createElement('button');
    sourceBtn.type = 'button';
    sourceBtn.className = 'btn btn-secondary btn-sm';
    sourceBtn.textContent = '作图生图底图';
    sourceBtn.addEventListener('click', async () => {
      await closeDialog(els.lightboxDialog);
      studioLib.useGalleryImageAsSource(item, 'img2img');
    });
    actions.appendChild(sourceBtn);

    const saveTplBtn = document.createElement('button');
    saveTplBtn.type = 'button';
    saveTplBtn.className = 'btn btn-ghost btn-sm';
    saveTplBtn.textContent = '存为提示词模板';
    saveTplBtn.addEventListener('click', async () => {
      await closeDialog(els.lightboxDialog);
      studioLib.saveGalleryItemAsPrompt(item, { ...item, png_metadata: pngMeta });
    });
    actions.appendChild(saveTplBtn);

    const bindArtistBtn = document.createElement('button');
    bindArtistBtn.type = 'button';
    bindArtistBtn.className = 'btn btn-ghost btn-sm';
    bindArtistBtn.textContent = '绑定画师封面';
    bindArtistBtn.addEventListener('click', async () => {
      await closeDialog(els.lightboxDialog);
      studioLib.bindGalleryImageToArtist(item);
    });
    actions.appendChild(bindArtistBtn);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-danger btn-sm';
  deleteBtn.textContent = '删除作品';
  deleteBtn.addEventListener('click', () => {
    askConfirm({
      title: '删除归档作品',
      message: '删除后原图与缩略图都会从服务器永久移除，公网短链也会立即失效，确定删除吗？',
      confirmLabel: '确认删除',
      onConfirm: async () => {
        await apiFetch(`/images/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        showToast('已删除作品');
        await closeDialog(els.lightboxDialog);
        await Promise.all([loadImages({ reset: true }), loadOverview()]);
      },
    });
  });
  actions.appendChild(deleteBtn);
  els.lightboxBody.appendChild(actions);

  const comment = pngMeta?.Comment && typeof pngMeta.Comment === 'object' ? pngMeta.Comment : null;
  const kvItems = [
    ['生成模型', formatModel(item.model)],
    ['操作类型', formatAction(item)],
    ['分辨率', item.width && item.height ? `${item.width} × ${item.height}` : '未知'],
    ['随机种子', item.seed !== undefined ? String(item.seed) : (comment?.seed ? String(comment.seed) : '未知')],
    ['点数消耗', typeof item.anlas_spent === 'number' ? (item.anlas_spent === 0 ? '0 点（免费）' : `${item.anlas_spent} 点`) : '未记录'],
    ['来源', item.private ? '画廊上传' : item.link_label || '历史归档 / 本机入口'],
    ['文件体积', formatBytes(item.size_bytes)],
    ['创建时间', formatTime(item.created_at)],
  ];
  if (comment?.steps) kvItems.push(['步数 / 引导', `${comment.steps} 步 · CFG ${comment.scale ?? '—'}`]);
  if (comment?.sampler) kvItems.push(['采样器', String(comment.sampler)]);

  const kvGrid = document.createElement('div');
  kvGrid.className = 'detail-kv-grid';
  for (const [k, v] of kvItems) {
    const cell = document.createElement('div');
    cell.className = 'detail-kv';
    const kEl = document.createElement('span');
    kEl.className = 'detail-k';
    kEl.textContent = k;
    const vEl = document.createElement('span');
    vEl.className = 'detail-v';
    vEl.textContent = v;
    cell.append(kEl, vEl);
    kvGrid.appendChild(cell);
  }
  els.lightboxBody.appendChild(kvGrid);

  const fullPrompt = comment?.prompt || pngMeta?.Description || item.prompt_preview;
  if (fullPrompt) {
    els.lightboxBody.appendChild(createCopyableBlock('正向提示词', String(fullPrompt)));
  }

  const charCaptions = comment?.v4_prompt?.caption?.char_captions;
  if (Array.isArray(charCaptions) && charCaptions.length > 0) {
    const formattedChars = charCaptions
      .map((c, idx) => {
        const pos = c.centers?.[0] ? ` (${c.centers[0].x}, ${c.centers[0].y})` : '';
        return `角色 ${idx + 1}${pos}：${c.char_caption || ''}`;
      })
      .join('\n');
    els.lightboxBody.appendChild(createCopyableBlock('多角色提示词', formattedChars));
  }

  const negPrompt = comment?.uc || comment?.v4_negative_prompt?.caption?.base_caption;
  if (negPrompt) {
    els.lightboxBody.appendChild(createCopyableBlock('负面提示词', String(negPrompt)));
  }

  if (item.note) {
    const noteEl = document.createElement('p');
    noteEl.className = 'stat-meta';
    noteEl.textContent = `备注：${item.note}`;
    els.lightboxBody.appendChild(noteEl);
  }

  els.lightboxBody.appendChild(createCopyableBlock('归档编号', item.id));
}

function createCopyableBlock(title, content) {
  const wrap = document.createElement('div');
  wrap.className = 'code-block-wrap';
  const head = document.createElement('div');
  head.className = 'code-block-head';
  const label = document.createElement('span');
  label.textContent = title;
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn-inline';
  copyBtn.textContent = '复制';
  copyBtn.addEventListener('click', () => copyText(content, `已复制${title}`));
  head.append(label, copyBtn);

  const pre = document.createElement('pre');
  pre.className = 'code-block';
  pre.textContent = content;
  wrap.append(head, pre);
  return wrap;
}

/* ---------- MCP 链接分发管理 ---------- */

async function loadLinks() {
  try {
    const data = await apiFetch('/links');
    state.links = data.items || [];
    state.publicOrigin = data.publicOrigin || state.publicOrigin;
    renderLinksList();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderLinksList() {
  els.linksList.replaceChildren();
  els.linksEmpty.hidden = state.links.length > 0;
  for (const link of state.links) {
    els.linksList.appendChild(createLinkCard(link));
  }
}

function createLinkCard(link) {
  const card = document.createElement('article');
  card.className = `link-card${!link.enabled || link.expired ? ' is-disabled' : ''}`;

  const head = document.createElement('div');
  head.className = 'link-head';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'link-title-wrap';
  const nameEl = document.createElement('h3');
  nameEl.className = 'link-name';
  nameEl.textContent = link.label;

  const badge = document.createElement('span');
  if (link.expired) {
    badge.className = 'pill pill-warning';
    badge.textContent = '已过期';
  } else if (link.enabled) {
    badge.className = 'pill pill-success';
    badge.textContent = '启用中';
  } else {
    badge.className = 'pill pill-muted';
    badge.textContent = '已停用';
  }
  const modeBadge = document.createElement('span');
  const isLegacy = link.disclosure_mode === 'legacy';
  modeBadge.className = isLegacy ? 'pill pill-muted' : 'pill pill-success';
  modeBadge.textContent = isLegacy ? '平铺兼容（13 工具）' : '渐进式 3 元工具';
  titleWrap.append(nameEl, badge, modeBadge);

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'btn-inline';
  renameBtn.textContent = '改备注';
  renameBtn.addEventListener('click', async () => {
    const next = window.prompt('请输入新的链接备注名称', link.label);
    if (!next || !next.trim() || next.trim() === link.label) return;
    try {
      await apiFetch(`/links/${encodeURIComponent(link.id)}`, {
        method: 'PATCH',
        body: { label: next.trim() },
      });
      showToast('已更新备注');
      await Promise.all([loadLinks(), loadOverview()]);
    } catch (err) {
      showToast(err.message, true);
    }
  });
  head.append(titleWrap, renameBtn);
  card.appendChild(head);

  const urlBox = document.createElement('div');
  urlBox.className = 'link-url-box';
  const urlCode = document.createElement('code');
  urlCode.className = 'link-url-code';
  urlCode.textContent = link.url;
  urlCode.title = link.url;
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn btn-primary btn-sm';
  copyBtn.textContent = '复制链接';
  copyBtn.addEventListener('click', () => copyText(link.url, '已复制 MCP 专用链接'));
  urlBox.append(urlCode, copyBtn);
  card.appendChild(urlBox);

  const metrics = document.createElement('div');
  metrics.className = 'link-metrics';
  const metricPairs = [
    ['累计调用', `${link.call_count} 次`],
    ['累计消耗', `${link.total_anlas_spent} 点`],
    ['最后活跃', link.last_used_at ? formatShortTime(link.last_used_at) : '未使用'],
  ];
  for (const [k, v] of metricPairs) {
    const cell = document.createElement('div');
    cell.className = 'metric-cell';
    const kEl = document.createElement('span');
    kEl.className = 'metric-k';
    kEl.textContent = k;
    const vEl = document.createElement('span');
    vEl.className = 'metric-v';
    vEl.textContent = v;
    cell.append(kEl, vEl);
    metrics.appendChild(cell);
  }
  card.appendChild(metrics);

  const footMeta = document.createElement('div');
  footMeta.className = 'link-foot-meta';
  const createdSpan = document.createElement('span');
  createdSpan.textContent = `创建于 ${formatTime(link.created_at)}`;
  const expSpan = document.createElement('span');
  expSpan.textContent = link.expires_at ? `到期：${formatTime(link.expires_at)}` : '有效期：永久';
  footMeta.append(createdSpan, expSpan);
  card.appendChild(footMeta);

  const actions = document.createElement('div');
  actions.className = 'link-actions';

  const guideBtn = document.createElement('button');
  guideBtn.type = 'button';
  guideBtn.className = 'btn btn-secondary btn-sm';
  guideBtn.textContent = '接入指南';
  guideBtn.addEventListener('click', () => openGuideDialog(link));
  actions.appendChild(guideBtn);

  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'btn btn-secondary btn-sm';
  modeBtn.textContent = isLegacy ? '切渐进式' : '切平铺兼容';
  modeBtn.addEventListener('click', async () => {
    const nextMode = isLegacy ? 'progressive' : 'legacy';
    try {
      await apiFetch(`/links/${encodeURIComponent(link.id)}`, {
        method: 'PATCH',
        body: { disclosure_mode: nextMode },
      });
      showToast(nextMode === 'progressive' ? '已切换为渐进式 3 元工具并刷新会话' : '已切换为传统平铺兼容模式并刷新会话');
      await Promise.all([loadLinks(), loadOverview()]);
    } catch (err) {
      showToast(err.message, true);
    }
  });
  actions.appendChild(modeBtn);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn btn-secondary btn-sm';
  toggleBtn.textContent = link.enabled ? '停用链接' : '重新启用';
  toggleBtn.addEventListener('click', async () => {
    try {
      await apiFetch(`/links/${encodeURIComponent(link.id)}`, {
        method: 'PATCH',
        body: { enabled: !link.enabled },
      });
      showToast(link.enabled ? '已停用链接并断开活跃会话' : '已重新启用链接');
      await Promise.all([loadLinks(), loadOverview()]);
    } catch (err) {
      showToast(err.message, true);
    }
  });
  actions.appendChild(toggleBtn);

  const rotateBtn = document.createElement('button');
  rotateBtn.type = 'button';
  rotateBtn.className = 'btn btn-secondary btn-sm';
  rotateBtn.textContent = '轮换密钥';
  rotateBtn.addEventListener('click', () => {
    askConfirm({
      title: '轮换 MCP 链接密钥',
      message: `轮换后「${link.label}」的原链接将立刻失效并踢断现有会话，需要把新链接发给对应客户端重新填写，确定继续吗？`,
      confirmLabel: '确认轮换',
      onConfirm: async () => {
        const { item } = await apiFetch(`/links/${encodeURIComponent(link.id)}/rotate`, { method: 'POST' });
        showToast('密钥已轮换，旧链接已失效');
        await Promise.all([loadLinks(), loadOverview()]);
        openGuideDialog(item);
      },
    });
  });
  actions.appendChild(rotateBtn);

  const filterArtBtn = document.createElement('button');
  filterArtBtn.type = 'button';
  filterArtBtn.className = 'btn btn-ghost btn-sm';
  filterArtBtn.textContent = '查看作品';
  filterArtBtn.addEventListener('click', () => {
    state.filters.link_id = link.id;
    switchTab('gallery');
    loadImages({ reset: true });
  });
  actions.appendChild(filterArtBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger btn-sm';
  delBtn.textContent = '删除';
  delBtn.addEventListener('click', () => {
    askConfirm({
      title: '删除分发链接',
      message: `删除「${link.label}」后该地址将永久返回 404 且立即断开活跃会话（历史生成的图库作品会保留），确定删除吗？`,
      confirmLabel: '确认删除',
      onConfirm: async () => {
        await apiFetch(`/links/${encodeURIComponent(link.id)}`, { method: 'DELETE' });
        showToast('已删除分发链接');
        await Promise.all([loadLinks(), loadOverview()]);
      },
    });
  });
  actions.appendChild(delBtn);

  card.appendChild(actions);
  return card;
}

function openGuideDialog(link) {
  els.guideBody.replaceChildren();
  els.guideBody.appendChild(createCopyableBlock(`专属 MCP 链接（${link.label}）`, link.url));

  const cherry = document.createElement('div');
  cherry.className = 'guide-step';
  cherry.innerHTML = '<h3>Cherry Studio / 桌面端客户端</h3><p>打开「设置 → MCP → 添加」，类型务必选择 <strong>可流式的 HTTP (streamableHttp)</strong>，将上方完整链接粘贴进地址栏即可（请求头留空）。</p>';
  els.guideBody.appendChild(cherry);

  const gemini = document.createElement('div');
  gemini.className = 'guide-step';
  gemini.innerHTML = '<h3>Gemini App（Cloud MCP）</h3><p>进入「设置 → 关联的应用 → 自定义 → Cloud MCP」，粘贴上方完整链接，OAuth 客户端 ID 和密钥留空，点击下一步保存。</p>';
  els.guideBody.appendChild(gemini);

  const jsonSnippet = JSON.stringify({
    mcpServers: {
      novelai: {
        type: 'streamable-http',
        url: link.url,
      },
    },
  }, null, 2);
  els.guideBody.appendChild(createCopyableBlock('Antigravity / Claude / 通用 JSON 配置参考', jsonSnippet));

  els.guideDialog.showModal();
}

function bindReferenceUpload() {
  let selectedFile = null;
  let uploading = false;

  function selectFile(file) {
    els.referenceUploadError.hidden = true;
    els.referenceIdField.hidden = true;
    els.referenceImageId.value = '';
    els.copyReferenceIdBtn.hidden = true;
    els.referenceUploadSubmit.hidden = false;
    selectedFile = file && file.size > 0 && file.size <= 20 * 1024 * 1024 ? file : null;
    els.referenceUploadSubmit.disabled = !selectedFile;
    els.referenceFileStatus.hidden = !selectedFile;
    if (selectedFile) els.referenceFileStatus.textContent = '已选图片 · ' + formatBytes(selectedFile.size);
    if (file && !selectedFile) {
      els.referenceUploadError.textContent = '请选择一张不超过 20 MiB 的图片';
      els.referenceUploadError.hidden = false;
    }
  }

  els.uploadReferenceBtn.addEventListener('click', () => {
    if (!uploading) {
      els.referenceUploadForm.reset();
      selectFile(null);
    }
    els.referenceUploadDialog.showModal();
  });
  els.referenceFile.addEventListener('change', () => selectFile(els.referenceFile.files[0]));
  els.referenceUploadDialog.addEventListener('paste', (event) => {
    if (uploading) return;
    const file = Array.from(event.clipboardData?.files ?? []).find(item => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    els.referenceFile.value = '';
    selectFile(file);
  });
  els.copyReferenceIdBtn.addEventListener('click', () => {
    copyText(els.referenceImageId.value, '已复制归档 ID，可直接粘贴到 Gemini');
  });

  els.referenceUploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedFile || uploading) return;
    uploading = true;
    els.referenceFile.disabled = true;
    els.referenceUploadSubmit.disabled = true;
    els.referenceUploadError.hidden = true;
    try {
      const { image_id } = await apiFetch('/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: selectedFile,
        signal: AbortSignal.timeout(90_000),
      });
      selectedFile = null;
      els.referenceFile.value = '';
      els.referenceFileStatus.textContent = '已上传到画廊';
      els.referenceFileStatus.hidden = false;
      els.referenceImageId.value = image_id;
      els.referenceIdField.hidden = false;
      els.copyReferenceIdBtn.hidden = false;
      els.referenceUploadSubmit.hidden = true;
      showToast('已上传参考图');
      await Promise.all([loadImages({ reset: true }), loadOverview()]);
    } catch (error) {
      if (!state.authenticated) await closeDialog(els.referenceUploadDialog);
      els.referenceUploadError.textContent = error.message;
      els.referenceUploadError.hidden = false;
    } finally {
      uploading = false;
      els.referenceFile.disabled = false;
      els.referenceUploadSubmit.disabled = !selectedFile;
    }
  });
}

/* ---------- 事件绑定与启动 ---------- */

function bindEvents() {
  [els.lightboxDialog, els.createLinkDialog, els.guideDialog, els.confirmDialog, els.referenceUploadDialog].forEach(setupModalDialog);
  bindReferenceUpload();

  document.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('[data-close-dialog]');
    if (!closeBtn) return;
    const target = $(closeBtn.getAttribute('data-close-dialog'));
    if (target) closeDialog(target);
  });

  els.themeToggleBtn.addEventListener('click', toggleColorScheme);

  els.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = els.passwordInput.value;
    if (!password) {
      els.loginError.textContent = '请输入管理口令';
      els.loginError.hidden = false;
      return;
    }
    els.loginError.hidden = true;
    els.loginSubmit.disabled = true;
    try {
      await apiFetch('/auth/login', { method: 'POST', body: { password } });
      await enterAppView();
    } catch (err) {
      els.loginError.textContent = err.message;
      els.loginError.hidden = false;
    } finally {
      els.loginSubmit.disabled = false;
    }
  });

  els.logoutBtn.addEventListener('click', async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {}
    enterLoginView();
    showToast('已退出登录');
  });

  els.tabGallery.addEventListener('click', () => switchTab('gallery'));
  els.tabStudio.addEventListener('click', () => switchTab('studio'));
  els.tabArtists.addEventListener('click', () => switchTab('artists'));
  els.tabPrompts.addEventListener('click', () => switchTab('prompts'));
  els.tabLinks.addEventListener('click', () => switchTab('links'));

  studioLib = createStudioAndLibrary({
    apiFetch,
    showToast,
    copyText,
    askConfirm,
    setupModalDialog,
    closeDialog,
    switchTab,
    formatModel,
    refreshGalleryAndOverview: () => Promise.all([loadImages({ reset: true }), loadOverview()]),
    refreshSubscription: () => loadSubscription(false),
  });
  studioLib.init();
  els.refreshSubBtn.addEventListener('click', () => loadSubscription(true));

  let searchTimer = null;
  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filters.q = els.searchInput.value;
      loadImages({ reset: true });
    }, 260);
  });

  els.filterLink.addEventListener('change', () => {
    state.filters.link_id = els.filterLink.value;
    loadImages({ reset: true });
  });
  els.filterModel.addEventListener('change', () => {
    state.filters.model = els.filterModel.value;
    loadImages({ reset: true });
  });
  els.filterSort.addEventListener('change', () => {
    state.filters.sort = els.filterSort.value;
    loadImages({ reset: true });
  });
  els.refreshGalleryBtn.addEventListener('click', () => {
    loadOverview();
    loadImages({ reset: true });
  });
  els.loadMoreBtn.addEventListener('click', () => loadImages({ reset: false }));

  els.lightboxPrevBtn.addEventListener('click', () => openLightbox(state.lightboxIndex - 1));
  els.lightboxNextBtn.addEventListener('click', () => openLightbox(state.lightboxIndex + 1));
  document.addEventListener('keydown', (event) => {
    if (!els.lightboxDialog.open) return;
    if (event.key === 'ArrowLeft') openLightbox(state.lightboxIndex - 1);
    else if (event.key === 'ArrowRight') openLightbox(state.lightboxIndex + 1);
  });

  els.batchSelectAllBtn.addEventListener('click', () => {
    for (const item of state.images) state.selectedIds.add(item.id);
    els.galleryGrid.querySelectorAll('.art-card').forEach((card) => card.classList.add('is-selected'));
    updateBatchBar();
  });
  els.batchClearBtn.addEventListener('click', () => {
    state.selectedIds.clear();
    els.galleryGrid.querySelectorAll('.art-card.is-selected').forEach((card) => card.classList.remove('is-selected'));
    updateBatchBar();
  });
  els.batchCopyLinksBtn.addEventListener('click', () => {
    const urls = state.images
      .filter((item) => state.selectedIds.has(item.id))
      .map((item) => item.public_url || new URL(item.image_url, location.origin).href);
    if (urls.length === 0) return;
    copyText(urls.join('\n'), `已复制 ${urls.length} 条图片链接`);
  });
  els.batchDeleteBtn.addEventListener('click', () => {
    const ids = [...state.selectedIds];
    if (ids.length === 0) return;
    askConfirm({
      title: `批量删除 ${ids.length} 张作品`,
      message: `确定永久删除已选中的 ${ids.length} 张归档图片吗？原图、缩略图及对应公网短链都将立即失效。`,
      confirmLabel: '确认批量删除',
      onConfirm: async () => {
        const res = await apiFetch('/images/batch-delete', { method: 'POST', body: { ids } });
        showToast(`已删除 ${res.deleted.length} 张作品${res.failed.length ? `（${res.failed.length} 张失败）` : ''}`);
        await Promise.all([loadImages({ reset: true }), loadOverview()]);
      },
    });
  });

  els.openCreateLinkBtn.addEventListener('click', () => {
    els.newLinkLabel.value = '';
    els.newLinkExpiry.value = '';
    if (els.newLinkDisclosure) els.newLinkDisclosure.value = 'progressive';
    els.createLinkDialog.showModal();
    els.newLinkLabel.focus();
  });

  els.createLinkForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const label = els.newLinkLabel.value.trim();
    if (!label) return;
    const expiresRaw = els.newLinkExpiry.value;
    const expires_in_hours = expiresRaw ? Number(expiresRaw) : null;
    const disclosure_mode = els.newLinkDisclosure?.value || 'progressive';
    els.createLinkSubmit.disabled = true;
    try {
      const { item } = await apiFetch('/links', {
        method: 'POST',
        body: { label, expires_in_hours, disclosure_mode },
      });
      await closeDialog(els.createLinkDialog);
      showToast(`已签发链接：${item.label}`);
      await Promise.all([loadLinks(), loadOverview()]);
      openGuideDialog(item);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      els.createLinkSubmit.disabled = false;
    }
  });

  els.confirmOkBtn.addEventListener('click', async () => {
    const fn = pendingConfirmAction;
    pendingConfirmAction = null;
    if (!fn) return;
    els.confirmOkBtn.disabled = true;
    try {
      await fn();
      await closeDialog(els.confirmDialog);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      els.confirmOkBtn.disabled = false;
    }
  });

  initMarqueeSelection();
}

async function bootstrap() {
  bindEvents();
  try {
    const status = await apiFetch('/auth/status');
    state.publicOrigin = status.publicOrigin || null;
    if (status.authenticated) {
      await enterAppView();
    } else {
      enterLoginView();
    }
  } catch (err) {
    enterLoginView();
    showToast(err.message, true);
  }
}

bootstrap();
