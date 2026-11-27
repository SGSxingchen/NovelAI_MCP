import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const LEXICON_MODES = ['fuzzy', 'exact', 'category', 'scenes', 'negatives', 'stats'] as const;
export type LexiconMode = (typeof LEXICON_MODES)[number];

export const NAI_CODEX_IDS = [
  'raven',
  'composition_style',
  'jiegou',
  'kisegaeningyou',
  'qianteng',
  'suozhang_nai5',
  'suozhang',
  'suozhang_nai5_r18',
  'suozhang_r18',
  'mengshen_r18',
] as const;
export type NaiCodexId = (typeof NAI_CODEX_IDS)[number];

export interface LexiconCodexMeta {
  id: string;
  rawFile?: string;
  title: string;
  author: string;
  version: string;
  count: number;
  nsfw?: boolean;
}

export interface LexiconRawEntry {
  c: string;
  t: string;
  zh: string;
  n: string;
  p: string;
  neg?: string;
  r?: string;
  wh?: [number, number];
}

export interface LexiconIndexData {
  builtAt: string;
  entryCount: number;
  codexes: LexiconCodexMeta[];
  entries: LexiconRawEntry[];
}

export interface LexiconSearchItem {
  codex: string;
  codex_title: string;
  tags: string;
  title_zh: string;
  category_path: string;
  note?: string;
  negative_prompt?: string;
  rating?: string;
  recommended_size?: { width: number; height: number; orientation: 'landscape' | 'portrait' | 'square' };
}

export interface SearchNaiLexiconOptions {
  query?: string;
  mode?: LexiconMode;
  category?: string;
  codex?: string;
  include_nsfw?: boolean;
  limit?: number;
  indexPath?: string;
}

export interface SearchNaiLexiconResult {
  mode: LexiconMode;
  query?: string;
  category?: string;
  codex?: string;
  include_nsfw: boolean;
  total_indexed: number;
  matched_count: number;
  returned_count: number;
  built_at: string;
  codexes?: (LexiconCodexMeta & { top_categories?: { category: string; count: number }[] })[];
  items?: LexiconSearchItem[];
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

let cachedIndex: { path: string; data: LexiconIndexData; titleByCodex: Map<string, string>; nsfwCodexes: Set<string> } | null = null;

function resolveLexiconIndexPath(customPath?: string): string {
  const candidates = [
    customPath,
    process.env.NAI_LEXICON_PATH,
    resolve(MODULE_DIR, '..', 'data', 'nai-lexicon.json.gz'),
    resolve(MODULE_DIR, '..', 'data', 'nai-lexicon.json'),
    resolve(process.cwd(), 'data', 'nai-lexicon.json.gz'),
    resolve(process.cwd(), 'data', 'nai-lexicon.json'),
  ].filter((item): item is string => Boolean(item && item.trim()));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('未找到本地 NovelAI 社区法典索引文件（data/nai-lexicon.json.gz）');
}

export function loadNaiLexiconIndex(customPath?: string): {
  data: LexiconIndexData;
  titleByCodex: Map<string, string>;
  nsfwCodexes: Set<string>;
} {
  const path = resolveLexiconIndexPath(customPath);
  if (cachedIndex && cachedIndex.path === path) {
    return cachedIndex;
  }
  const rawBuffer = readFileSync(path);
  const jsonBuffer = path.endsWith('.gz') || (rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b)
    ? gunzipSync(rawBuffer)
    : rawBuffer;
  const data = JSON.parse(jsonBuffer.toString('utf8')) as LexiconIndexData;
  const titleByCodex = new Map<string, string>();
  const nsfwCodexes = new Set<string>();
  for (const meta of data.codexes) {
    titleByCodex.set(meta.id, meta.title);
    if (meta.nsfw || meta.id.endsWith('_r18')) {
      nsfwCodexes.add(meta.id);
    }
  }
  cachedIndex = { path, data, titleByCodex, nsfwCodexes };
  return cachedIndex;
}

export function loadRawCodexCatalog(): unknown[] {
  const candidates = [
    resolve(MODULE_DIR, '..', 'data', 'raw-codexes', 'codexes.json'),
    join(process.cwd(), 'data', 'raw-codexes', 'codexes.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf8')) as unknown[];
      } catch {
        return [];
      }
    }
  }
  return [];
}

function isNsfwEntry(entry: LexiconRawEntry, nsfwCodexes: Set<string>): boolean {
  if (nsfwCodexes.has(entry.c)) return true;
  const rating = (entry.r ?? '').toLowerCase();
  return rating === 'nsfw' || rating === 'r18' || rating === 'r18g' || rating === 'explicit' || rating === 'questionable';
}

function formatItem(entry: LexiconRawEntry, titleByCodex: Map<string, string>): LexiconSearchItem {
  const item: LexiconSearchItem = {
    codex: entry.c,
    codex_title: titleByCodex.get(entry.c) ?? entry.c,
    tags: entry.t,
    title_zh: entry.zh,
    category_path: entry.p,
  };
  if (entry.n) item.note = entry.n;
  if (entry.neg) item.negative_prompt = entry.neg;
  if (entry.r) item.rating = entry.r;
  if (entry.wh && entry.wh.length === 2 && entry.wh[0] > 0 && entry.wh[1] > 0) {
    const [width, height] = entry.wh;
    item.recommended_size = {
      width,
      height,
      orientation: width > height ? 'landscape' : height > width ? 'portrait' : 'square',
    };
  }
  return item;
}

function buildCategoryStats(entries: LexiconRawEntry[], codexes: LexiconCodexMeta[], includeNsfw: boolean, nsfwCodexes: Set<string>) {
  return codexes
    .filter(meta => includeNsfw || (!meta.nsfw && !nsfwCodexes.has(meta.id)))
    .map(meta => {
      const counts = new Map<string, number>();
      for (const entry of entries) {
        if (entry.c !== meta.id) continue;
        if (!includeNsfw && isNsfwEntry(entry, nsfwCodexes)) continue;
        const firstSeg = (entry.p || '').split('/').find(Boolean) ?? '未分类';
        counts.set(firstSeg, (counts.get(firstSeg) ?? 0) + 1);
      }
      const top_categories = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({ category, count }));
      return { ...meta, top_categories };
    });
}

export function searchNaiLexicon(options: SearchNaiLexiconOptions = {}): SearchNaiLexiconResult {
  const {
    query = '',
    mode = 'fuzzy',
    category = '',
    codex = '',
    include_nsfw = true,
    limit = 20,
    indexPath,
  } = options;

  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit || 20)));
  const { data, titleByCodex, nsfwCodexes } = loadNaiLexiconIndex(indexPath);
  const q = query.trim();
  const qLower = q.toLowerCase();
  const catLower = category.trim().toLowerCase();
  const codexLower = codex.trim().toLowerCase();

  const baseEntries = data.entries.filter(entry => {
    if (!include_nsfw && isNsfwEntry(entry, nsfwCodexes)) return false;
    if (codexLower && entry.c.toLowerCase() !== codexLower && !(titleByCodex.get(entry.c) ?? '').toLowerCase().includes(codexLower)) {
      return false;
    }
    if (catLower && !(entry.p || '').toLowerCase().includes(catLower)) {
      return false;
    }
    return true;
  });

  if (mode === 'stats' || (mode === 'category' && !q && !catLower)) {
    const codexStats = buildCategoryStats(baseEntries, data.codexes, include_nsfw, nsfwCodexes);
    return {
      mode,
      ...(q ? { query: q } : {}),
      ...(category ? { category } : {}),
      ...(codex ? { codex } : {}),
      include_nsfw,
      total_indexed: data.entryCount,
      matched_count: baseEntries.length,
      returned_count: codexStats.length,
      built_at: data.builtAt,
      codexes: codexStats,
    };
  }

  if (mode === 'scenes') {
    const sceneEntries = baseEntries.filter(entry => {
      if (entry.c !== 'composition_style') return false;
      if (!qLower) return true;
      return (
        entry.t.toLowerCase().includes(qLower)
        || entry.zh.toLowerCase().includes(qLower)
        || entry.p.toLowerCase().includes(qLower)
        || entry.n.toLowerCase().includes(qLower)
      );
    });
    const slice = sceneEntries.slice(0, safeLimit).map(e => formatItem(e, titleByCodex));
    return {
      mode,
      ...(q ? { query: q } : {}),
      ...(category ? { category } : {}),
      codex: 'composition_style',
      include_nsfw,
      total_indexed: data.entryCount,
      matched_count: sceneEntries.length,
      returned_count: slice.length,
      built_at: data.builtAt,
      items: slice,
    };
  }

  if (mode === 'negatives') {
    const negEntries = baseEntries.filter(entry => {
      if (!entry.neg) return false;
      if (!qLower) return true;
      return (
        entry.t.toLowerCase().includes(qLower)
        || entry.zh.toLowerCase().includes(qLower)
        || entry.neg.toLowerCase().includes(qLower)
        || entry.p.toLowerCase().includes(qLower)
        || entry.n.toLowerCase().includes(qLower)
      );
    });
    const slice = negEntries.slice(0, safeLimit).map(e => formatItem(e, titleByCodex));
    return {
      mode,
      ...(q ? { query: q } : {}),
      ...(category ? { category } : {}),
      ...(codex ? { codex } : {}),
      include_nsfw,
      total_indexed: data.entryCount,
      matched_count: negEntries.length,
      returned_count: slice.length,
      built_at: data.builtAt,
      items: slice,
    };
  }

  if (mode === 'category') {
    const targetCat = catLower || qLower;
    const catEntries = baseEntries.filter(entry => (entry.p || '').toLowerCase().includes(targetCat));
    const slice = catEntries.slice(0, safeLimit).map(e => formatItem(e, titleByCodex));
    return {
      mode,
      ...(q ? { query: q } : {}),
      ...(category ? { category } : {}),
      ...(codex ? { codex } : {}),
      include_nsfw,
      total_indexed: data.entryCount,
      matched_count: catEntries.length,
      returned_count: slice.length,
      built_at: data.builtAt,
      items: slice,
    };
  }

  if (mode === 'exact') {
    const exactEntries = baseEntries.filter(entry => {
      if (!qLower) return false;
      const tagLower = entry.t.toLowerCase();
      const tagUnder = tagLower.replace(/\s+/g, '_');
      const qUnder = qLower.replace(/\s+/g, '_');
      return tagLower === qLower || tagUnder === qUnder || entry.zh.toLowerCase() === qLower;
    });
    const slice = exactEntries.slice(0, safeLimit).map(e => formatItem(e, titleByCodex));
    return {
      mode,
      ...(q ? { query: q } : {}),
      ...(category ? { category } : {}),
      ...(codex ? { codex } : {}),
      include_nsfw,
      total_indexed: data.entryCount,
      matched_count: exactEntries.length,
      returned_count: slice.length,
      built_at: data.builtAt,
      items: slice,
    };
  }

  // Default: fuzzy search
  if (!qLower) {
    const slice = baseEntries.slice(0, safeLimit).map(e => formatItem(e, titleByCodex));
    return {
      mode: 'fuzzy',
      ...(category ? { category } : {}),
      ...(codex ? { codex } : {}),
      include_nsfw,
      total_indexed: data.entryCount,
      matched_count: baseEntries.length,
      returned_count: slice.length,
      built_at: data.builtAt,
      items: slice,
    };
  }

  const terms = qLower.split(/[\s,，]+/).filter(Boolean);
  const scored: { score: number; entry: LexiconRawEntry }[] = [];

  for (const entry of baseEntries) {
    const t = entry.t.toLowerCase();
    const tSpace = t.replace(/_/g, ' ');
    const zh = entry.zh.toLowerCase();
    const p = entry.p.toLowerCase();
    const n = entry.n.toLowerCase();

    let bestScore: number | null = null;
    if (t === qLower || tSpace === qLower.replace(/_/g, ' ')) {
      bestScore = 0;
    } else if (t.startsWith(qLower) || tSpace.startsWith(qLower.replace(/_/g, ' ')) || zh === qLower) {
      bestScore = 1;
    } else if (t.includes(qLower) || tSpace.includes(qLower.replace(/_/g, ' '))) {
      bestScore = 2;
    } else if (zh.includes(qLower)) {
      bestScore = 3;
    } else if (p.includes(qLower)) {
      bestScore = 4;
    } else if (n.includes(qLower)) {
      bestScore = 5;
    } else if (terms.length > 1) {
      const haystack = `${t} ${tSpace} ${zh} ${p} ${n}`;
      if (terms.every(term => haystack.includes(term))) {
        bestScore = 6;
      }
    }

    if (bestScore !== null) {
      scored.push({ score: bestScore, entry });
    }
  }

  scored.sort((a, b) => a.score - b.score || a.entry.t.length - b.entry.t.length);
  const slice = scored.slice(0, safeLimit).map(item => formatItem(item.entry, titleByCodex));

  return {
    mode: 'fuzzy',
    query: q,
    ...(category ? { category } : {}),
    ...(codex ? { codex } : {}),
    include_nsfw,
    total_indexed: data.entryCount,
    matched_count: scored.length,
    returned_count: slice.length,
    built_at: data.builtAt,
    items: slice,
  };
}
