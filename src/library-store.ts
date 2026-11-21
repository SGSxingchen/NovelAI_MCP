import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import { ARCHIVE_ID_REGEX } from './image-archive.js';
import { preparePrivateDirectory, readAdminFile, writeAdminFile } from './link-store.js';
import { DEFAULT_MODEL } from './types.js';

export const ARTIST_MIX_SYNTAXES = ['v4', 'v3', 'plain'] as const;
export const PROMPT_KINDS = ['template', 'snippet', 'negative'] as const;
export const MAX_LIBRARY_BYTES = 16 * 1024 * 1024;

type MixSyntax = (typeof ARTIST_MIX_SYNTAXES)[number];
type PromptKind = (typeof PROMPT_KINDS)[number];
type ImportMode = 'merge' | 'replace';

interface EntryIdentity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtistMixEntry {
  tag: string;
  weight: number;
}

export interface ArtistEntry extends EntryIdentity {
  name: string;
  tag: string;
  isMix: boolean;
  mixEntries: ArtistMixEntry[];
  defaultWeight: number;
  categories: string[];
  models: string[];
  notes: string;
  previewImageId: string | null;
  pinned: boolean;
}

export interface PromptEntry extends EntryIdentity {
  title: string;
  kind: PromptKind;
  category: string;
  prompt: string;
  negativePrompt: string;
  characters: { prompt: string; negative_prompt?: string; center_x?: number; center_y?: number }[];
  tags: string[];
  recommendedModel: string | null;
  recommendedWidth: number | null;
  recommendedHeight: number | null;
  previewImageId: string | null;
  pinned: boolean;
}

export interface LibraryData {
  artists: ArtistEntry[];
  prompts: PromptEntry[];
}

interface SearchFilters {
  query?: string;
  category?: string;
  limit?: number;
}

export interface ArtistSearch extends SearchFilters {
  model?: string;
  mixOnly?: boolean;
}

export interface PromptSearch extends SearchFilters {
  kind?: PromptKind;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MIX_ENTRIES = 16;
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 3;
const V3_WEIGHT_STEP = 1.05;
const string = { type: 'string' };
const stringArray = { type: 'array', items: string };
const weight = { type: 'number', minimum: MIN_WEIGHT, maximum: MAX_WEIGHT };
const unit = { type: 'number', minimum: 0, maximum: 1 };
const optionalSize = { type: 'integer', nullable: true, minimum: 1, maximum: 49152 };
const commonFields = {
  previewImageId: { type: 'string', nullable: true, pattern: ARCHIVE_ID_REGEX.source },
  pinned: { type: 'boolean' },
};

export const ARTIST_ENTRY_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: {
    ...commonFields,
    name: { ...string, minLength: 1, maxLength: 120 },
    tag: { ...string, description: '单画师的标签。混搭时由 mixEntries 合成。' },
    isMix: { type: 'boolean', description: '省略时由 mixEntries 是否有值决定。' },
    mixEntries: {
      type: 'array', maxItems: MAX_MIX_ENTRIES,
      items: { type: 'object', required: ['tag', 'weight'], properties: { tag: string, weight } },
    },
    defaultWeight: weight,
    categories: stringArray,
    models: stringArray,
    notes: string,
  },
};

export const PROMPT_ENTRY_SCHEMA = {
  type: 'object',
  required: ['title'],
  properties: {
    ...commonFields,
    title: { ...string, minLength: 1 },
    kind: { type: 'string', enum: [...PROMPT_KINDS], default: 'template' },
    category: string,
    prompt: string,
    negativePrompt: string,
    characters: {
      type: 'array', maxItems: 32,
      items: {
        type: 'object', required: ['prompt'],
        properties: { prompt: { ...string, minLength: 1 }, negative_prompt: string, center_x: unit, center_y: unit },
      },
    },
    tags: stringArray,
    recommendedModel: { type: 'string', nullable: true },
    recommendedWidth: optionalSize,
    recommendedHeight: optionalSize,
  },
};

const ajv = new Ajv({ ownProperties: true });
const validateArtist = ajv.compile(ARTIST_ENTRY_SCHEMA);
const validatePrompt = ajv.compile(PROMPT_ENTRY_SCHEMA);

export class LibraryInputError extends Error {}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LibraryInputError('词库条目必须为 JSON 对象');
  return value as Record<string, unknown>;
}

function validateEntry(validate: ValidateFunction, input: unknown): void {
  if (validate(input)) return;
  const error = validate.errors?.[0];
  const field = error?.instancePath.slice(1) || error?.params.missingProperty || '条目';
  throw new LibraryInputError(`请检查词库字段 ${field} 的类型、范围或必填项`);
}

function nonempty(value: string, field: string): string {
  const text = value.trim();
  if (!text) throw new LibraryInputError(`${field} 不能为空`);
  return text;
}

function checkedWeight(value: number): number {
  if (!Number.isFinite(value) || value < MIN_WEIGHT || value > MAX_WEIGHT) {
    throw new LibraryInputError('画师权重必须在 0.05 至 3 之间');
  }
  return value;
}

function labels(values: string[] = []): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

const key = (value: string) => value.trim().toLowerCase();

export function formatArtistMix(entries: readonly ArtistMixEntry[], syntax: MixSyntax = 'v4'): string {
  return entries.map(({ tag, weight }) => {
    if (syntax === 'plain' || weight === 1) return tag;
    checkedWeight(weight);
    if (syntax === 'v4') return `${Number(weight.toFixed(2))}::${tag}::`;
    const layers = Math.round(Math.log(weight) / Math.log(V3_WEIGHT_STEP));
    const [open, close] = layers >= 0 ? ['{', '}'] : ['[', ']'];
    return open.repeat(Math.abs(layers)) + tag + close.repeat(Math.abs(layers));
  }).join(', ');
}

function parseArtistTags(text: string): ArtistMixEntry[] {
  const entries: ArtistMixEntry[] = [];
  // 先识别整段权重标记，再拆分同一权重下的逗号分隔标签。
  const tokens = /(?:^|[,，])\s*(?:([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(::|__)((?:(?!\2).)*)\2\s*(?=[,，]|$)|([^,，]+))/g;
  for (const [, number, , weightedTags, plainTag] of text.matchAll(tokens)) {
    if (number !== undefined) {
      const weight = checkedWeight(Number(number));
      for (const tag of weightedTags.split(/[,，]/)) entries.push({ tag: nonempty(tag, 'tag'), weight });
    } else {
      const raw = plainTag.trim();
      if (!raw) continue;
      let start = 0;
      let end = raw.length;
      let layers = 0;
      while (end - start >= 2) {
        if (raw[start] === '{' && raw[end - 1] === '}') layers++;
        else if (raw[start] === '[' && raw[end - 1] === ']') layers--;
        else break;
        start++;
        end--;
      }
      const tag = nonempty(raw.slice(start, end), 'tag');
      if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:::|__)/.test(tag)) {
        throw new LibraryInputError('画师权重串缺少结束符或格式无效');
      }
      const weight = checkedWeight(Number((V3_WEIGHT_STEP ** layers).toFixed(2)));
      entries.push({ tag, weight });
    }
  }
  return entries;
}

export type ArtistImportItem = Pick<ArtistEntry, 'tag' | 'name' | 'categories' | 'defaultWeight' | 'notes'>;

export function parseArtistImportText(rawText: string): ArtistImportItem[] {
  const items: ArtistImportItem[] = [];
  for (const line of rawText.split(/\r\n|[\n\r]/)) {
    const [tagText, name, categories, defaultWeight, ...notes] = line.split('|').map(value => value.trim());
    const entries = parseArtistTags(tagText);
    if (name !== undefined && entries.length !== 1) throw new LibraryInputError('画师表格的每行必须填写一个 tag');
    for (const { tag, weight } of entries) {
      items.push({
        tag,
        name: name || tag.replace(/^artist:\s*/i, '') || tag,
        categories: labels(categories?.split(/[,，]/)),
        defaultWeight: defaultWeight ? checkedWeight(Number(defaultWeight)) : weight,
        notes: notes.join(' | '),
      });
    }
  }
  return items;
}

function newIdentity(): EntryIdentity {
  const now = new Date().toISOString();
  return { id: randomUUID(), createdAt: now, updatedAt: now };
}

function makeArtist(value: unknown, identity: EntryIdentity): ArtistEntry {
  validateEntry(validateArtist, value);
  const input = value as Partial<ArtistEntry> & Pick<ArtistEntry, 'name'>;
  const isMix = input.isMix ?? Boolean(input.mixEntries?.length);
  const mixEntries = isMix ? (input.mixEntries ?? []).map(({ tag, weight }) => ({ tag: nonempty(tag, 'tag'), weight })) : [];
  if (isMix && !mixEntries.length) throw new LibraryInputError('混搭配方需要填写 1 至 16 项 mixEntries');
  return {
    ...identity,
    name: nonempty(input.name, 'name'),
    tag: isMix ? formatArtistMix(mixEntries) : nonempty(input.tag ?? '', 'tag'),
    isMix,
    mixEntries,
    defaultWeight: input.defaultWeight ?? 1,
    categories: labels(input.categories),
    models: labels(input.models),
    notes: input.notes ?? '',
    previewImageId: input.previewImageId ?? null,
    pinned: input.pinned ?? false,
  };
}

function makePrompt(value: unknown, identity: EntryIdentity): PromptEntry {
  validateEntry(validatePrompt, value);
  const input = value as Partial<PromptEntry> & Pick<PromptEntry, 'title'>;
  return {
    ...identity,
    title: nonempty(input.title, 'title'),
    kind: input.kind ?? 'template',
    category: input.category?.trim() ?? '',
    prompt: input.prompt ?? '',
    negativePrompt: input.negativePrompt ?? '',
    characters: (input.characters ?? []).map(({ prompt, negative_prompt, center_x, center_y }) => ({
      prompt: nonempty(prompt, 'characters.prompt'),
      ...(negative_prompt === undefined ? {} : { negative_prompt }),
      ...(center_x === undefined ? {} : { center_x }),
      ...(center_y === undefined ? {} : { center_y }),
    })),
    tags: labels(input.tags),
    recommendedModel: input.recommendedModel?.trim() || null,
    recommendedWidth: input.recommendedWidth ?? null,
    recommendedHeight: input.recommendedHeight ?? null,
    previewImageId: input.previewImageId ?? null,
    pinned: input.pinned ?? false,
  };
}

function starterLibrary(): LibraryData {
  const artists = [
    {
      name: '单画师示范骨架', tag: 'artist:<替换为单画师标签>', models: ['V5', 'V4.5'],
      notes: '将占位标签替换为自己的画师标签。可以填写适配模型、画风分类与搭配建议。',
    },
    {
      name: '混搭配方示范骨架', models: ['V5', 'V4.5'],
      mixEntries: [{ tag: 'artist:<主画师标签>', weight: 1.2 }, { tag: 'artist:<辅画师标签>', weight: 0.7 }],
      notes: '两处标签都是占位符。填入自己的画师标签后，再用配重调节主次。',
    },
  ].map(value => makeArtist(value, newIdentity()));
  const prompts = [
    {
      title: 'V5 日本画水彩风模板', kind: 'template', category: '水彩',
      prompt: 'A solitary figure crossing a reed marsh in morning mist. Nihonga watercolor on unbleached washi, softened mineral pigment washes, dry ink contours, pale indigo and ochre, distant mountains fading into reserved paper, quiet asymmetrical composition.',
      tags: ['日本画', '纸张肌理'], recommendedWidth: 1024, recommendedHeight: 1024,
    },
    {
      title: '90 年代赛璐璐动画风模板', kind: 'template', category: '赛璐璐',
      prompt: 'A cyclist waiting at a small town railway crossing at dusk, hand-inked cel contours, two-tone shadows, painted gouache background, muted teal and orange, soft optical bloom from streetlights, frame from a 1990s animated film.',
      tags: ['复古90s', '动画'], recommendedWidth: 1216, recommendedHeight: 832,
    },
    {
      title: '电影感逆光与体积光', kind: 'snippet', category: '光影',
      prompt: 'Low sun behind the subject, narrow amber edge light along the silhouette, volumetric light through suspended dust, dark foreground, a single soft reflected fill on the face.',
      tags: ['逆光', '体积光'],
    },
    {
      title: '去塑料感的物理媒介质感', kind: 'snippet', category: '质感',
      prompt: 'Matte dry gouache over rough cotton paper, visible bristle marks, broken edges where paint skips the grain, uneven pigment density, muted highlights that retain the texture of the paper.',
      tags: ['水粉', '哑光'],
    },
    {
      title: '低角度广角构图', kind: 'snippet', category: '构图',
      prompt: 'Camera near ground level with a 24 mm wide-angle composition, large foreground shapes, receding diagonals leading toward the central subject, distant skyline low in the frame, deliberate empty space above.',
      tags: ['低角度', '广角'],
    },
    {
      title: 'V5 通用反污染负面预设', kind: 'negative', category: '负面预设',
      negativePrompt: 'plastic sheen, waxy skin, airbrushed texture, uniform gloss, overprocessed HDR, oversharpening, excessive bloom, random lettering, watermark, duplicate subject',
      tags: ['去塑料感', '反污染'],
    },
  ].map(value => makePrompt({ recommendedModel: DEFAULT_MODEL, ...value }, newIdentity()));
  return { artists, prompts };
}

function timestamp(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new LibraryInputError('createdAt 和 updatedAt 必须是有效的日期字符串');
  }
  return new Date(value).toISOString();
}

function importedEntries<T extends EntryIdentity>(
  raw: unknown, kind: keyof LibraryData, build: (value: unknown, identity: EntryIdentity) => T,
): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new LibraryInputError(`${kind} 必须是数组`);
  const ids = new Set<string>();
  return raw.map(value => {
    const { id, createdAt, updatedAt } = readObject(value);
    const identity = newIdentity();
    if (id !== undefined) {
      if (typeof id !== 'string' || !id.trim() || (kind === 'artists' && !UUID.test(id))) {
        throw new LibraryInputError(`${kind} 条目的 id 无效`);
      }
      identity.id = kind === 'artists' ? id.toLowerCase() : id;
    }
    if (ids.has(identity.id)) throw new LibraryInputError(`${kind} 包含重复的 id`);
    ids.add(identity.id);
    identity.createdAt = timestamp(createdAt, identity.createdAt);
    identity.updatedAt = timestamp(updatedAt, identity.createdAt);
    return build(value, identity);
  });
}

function decodeLibrary(value: unknown): LibraryData {
  const { artists, prompts } = readObject(value);
  return { artists: importedEntries(artists, 'artists', makeArtist), prompts: importedEntries(prompts, 'prompts', makePrompt) };
}

function mergeById<T extends EntryIdentity>(existing: T[], incoming: T[]): T[] {
  const merged = new Map(existing.map(item => [item.id, item]));
  for (const item of incoming) merged.set(item.id, item);
  return [...merged.values()];
}

function compareEntries(a: ArtistEntry | PromptEntry, b: ArtistEntry | PromptEntry): number {
  return Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt);
}

function modelFamily(id: string): string | undefined {
  const version = id.match(/^nai-diffusion-(?:furry-)?(3|4-5|4|5)(?:-|$)/)?.[1];
  return version && `v${version.replace('-', '.')}`;
}

function matchingArtists(items: ArtistEntry[], filters: ArtistSearch): ArtistEntry[] {
  const query = key(filters.query ?? '');
  const category = key(filters.category ?? '');
  const model = key(filters.model ?? '');
  const family = modelFamily(model);
  return items.filter(item => (
    (!filters.mixOnly || item.isMix)
    && (!category || item.categories.some(value => key(value) === category))
    && (!model || item.models.some(value => {
      const candidate = key(value);
      return candidate === model || candidate === family || modelFamily(candidate) === model;
    }))
    && (!query || [item.name, item.tag, item.notes, ...item.categories, ...item.models].some(value => key(value).includes(query)))
  )).sort(compareEntries).slice(0, filters.limit);
}

function matchingPrompts(items: PromptEntry[], filters: PromptSearch): PromptEntry[] {
  const query = key(filters.query ?? '');
  const category = key(filters.category ?? '');
  return items.filter(item => (
    (!filters.kind || item.kind === filters.kind)
    && (!category || key(item.category) === category)
    && (!query || [item.title, item.category, item.prompt, item.negativePrompt, ...item.tags,
      ...item.characters.flatMap(character => [character.prompt, character.negative_prompt ?? ''])]
      .some(value => key(value).includes(query)))
  )).sort(compareEntries).slice(0, filters.limit);
}

function libraryStats({ artists, prompts }: LibraryData) {
  return { artists: artists.length, prompts: prompts.length, mixes: artists.filter(item => item.isMix).length };
}

function changeEntry<T extends EntryIdentity>(items: T[], id: string, edit?: (previous: T) => T): T | undefined {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return undefined;
  if (!edit) return items.splice(index, 1)[0];
  return items[index] = edit(items[index]);
}

function batchLabels(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new LibraryInputError(`${field} 必须是字符串数组`);
  }
  return labels(value);
}

export class LibraryStore {
  private data: LibraryData = { artists: [], prompts: [] };
  private loading?: Promise<void>;
  private writes = Promise.resolve();
  private file?: string;

  constructor(private readonly archiveDir?: string) {}

  init(): Promise<void> {
    this.loading ??= this.load().catch(error => {
      this.loading = undefined;
      throw error;
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    if (!this.archiveDir) {
      this.data = starterLibrary();
      return;
    }
    this.file = join(await preparePrivateDirectory(this.archiveDir), 'library.json');
    let bytes = await readAdminFile(this.file, MAX_LIBRARY_BYTES).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!bytes) {
      const initial = starterLibrary();
      try {
        await this.persist(initial, true);
        this.data = initial;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        bytes = await readAdminFile(this.file, MAX_LIBRARY_BYTES);
      }
    }
    try {
      const value = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(value?.artists) || !Array.isArray(value?.prompts)) throw new Error('缺少词库集合');
      this.data = decodeLibrary(value);
    } catch (error) {
      throw new Error('词库存储格式无效', { cause: error });
    }
  }

  private async persist(data: LibraryData, createOnly = false): Promise<void> {
    const contents = JSON.stringify(data) + '\n';
    if (Buffer.byteLength(contents) > MAX_LIBRARY_BYTES) throw new LibraryInputError('词库超过 16 MiB 大小限制');
    if (this.file) await writeAdminFile(this.file, contents, createOnly);
  }

  private change<T>(edit: (data: LibraryData) => T): Promise<T> {
    const pending = this.writes.then(async () => {
      await this.init();
      const draft = { artists: [...this.data.artists], prompts: [...this.data.prompts] };
      const result = edit(draft);
      if (result !== undefined) {
        await this.persist(draft);
        this.data = draft;
      }
      return structuredClone(result);
    });
    this.writes = pending.then(() => {}, () => {});
    return pending;
  }

  async flush(): Promise<void> {
    await this.writes;
    await this.loading;
  }

  async list({ type = 'all', ...filters }: PromptSearch & { type?: 'all' | 'artists' | 'prompts' } = {}) {
    await this.init();
    const { artists, prompts } = this.data;
    const categories = new Set<string>();
    for (const item of artists) for (const category of item.categories) categories.add(category);
    for (const item of prompts) if (item.category) categories.add(item.category);
    return structuredClone({
      artists: type === 'prompts' ? [] : matchingArtists(artists, filters),
      prompts: type === 'artists' ? [] : matchingPrompts(prompts, filters),
      categories: [...categories].sort((a, b) => a.localeCompare(b)),
      stats: libraryStats(this.data),
    });
  }

  async searchArtists(filters: ArtistSearch = {}): Promise<ArtistEntry[]> {
    await this.init();
    return structuredClone(matchingArtists(this.data.artists, filters));
  }

  async searchPrompts(filters: PromptSearch = {}): Promise<PromptEntry[]> {
    await this.init();
    return structuredClone(matchingPrompts(this.data.prompts, filters));
  }

  createArtist(input: unknown): Promise<ArtistEntry> {
    return this.change(data => {
      const item = makeArtist(input, newIdentity());
      data.artists.push(item);
      return item;
    });
  }

  updateArtist(id: string, patch: unknown): Promise<ArtistEntry | undefined> {
    return this.change(data => changeEntry(data.artists, id, previous => makeArtist(
      { ...previous, ...readObject(patch) },
      { id: previous.id, createdAt: previous.createdAt, updatedAt: new Date().toISOString() },
    )));
  }

  deleteArtist(id: string): Promise<ArtistEntry | undefined> {
    return this.change(data => changeEntry(data.artists, id));
  }

  createPrompt(input: unknown): Promise<PromptEntry> {
    return this.change(data => {
      const item = makePrompt(input, newIdentity());
      data.prompts.push(item);
      return item;
    });
  }

  updatePrompt(id: string, patch: unknown): Promise<PromptEntry | undefined> {
    return this.change(data => changeEntry(data.prompts, id, previous => makePrompt(
      { ...previous, ...readObject(patch) },
      { id: previous.id, createdAt: previous.createdAt, updatedAt: new Date().toISOString() },
    )));
  }

  deletePrompt(id: string): Promise<PromptEntry | undefined> {
    return this.change(data => changeEntry(data.prompts, id));
  }

  async batchImportArtists(input: unknown) {
    const { text, mode, mixName, categories, models } = readObject(input);
    if (typeof text !== 'string') throw new LibraryInputError('text 必须是字符串');
    if (mode !== 'single_entries' && mode !== 'as_mix') {
      throw new LibraryInputError('mode 必须为 single_entries 或 as_mix');
    }
    if (mixName !== undefined && typeof mixName !== 'string') throw new LibraryInputError('mixName 必须是字符串');
    const commonCategories = batchLabels(categories, 'categories');
    const commonModels = batchLabels(models, 'models');
    const rows = parseArtistImportText(text);
    if (rows.length === 0) throw new LibraryInputError('请填写至少一个画师标签');
    return this.change(data => {
      let skipped = 0;
      const items: ArtistEntry[] = [];
      if (mode === 'as_mix') {
        items.push(makeArtist({
          name: mixName?.trim() || '画师混搭',
          mixEntries: rows.map(({ tag, defaultWeight }) => ({ tag, weight: defaultWeight })),
          categories: [...commonCategories, ...rows.flatMap(row => row.categories)],
          models: commonModels,
          notes: rows.filter(row => row.notes).map(row => `${row.name} · ${row.notes}`).join('\n'),
        }, newIdentity()));
      } else {
        const seen = new Set(data.artists.filter(item => !item.isMix).map(item => key(item.tag)));
        for (const row of rows) {
          const tag = key(row.tag);
          if (seen.has(tag)) {
            skipped++;
            continue;
          }
          items.push(makeArtist({ ...row, categories: [...commonCategories, ...row.categories], models: commonModels }, newIdentity()));
          seen.add(tag);
        }
      }
      data.artists = data.artists.concat(items);
      return { created: items.length, skipped, items };
    });
  }

  async exportLibrary(): Promise<LibraryData> {
    await this.init();
    return structuredClone(this.data);
  }

  async importLibrary(value: unknown, mode: ImportMode = 'merge') {
    if (mode !== 'merge' && mode !== 'replace') throw new LibraryInputError('mode 必须为 merge 或 replace');
    const incoming = decodeLibrary(value);
    return this.change(data => {
      data.artists = mode === 'replace' ? incoming.artists : mergeById(data.artists, incoming.artists);
      data.prompts = mode === 'replace' ? incoming.prompts : mergeById(data.prompts, incoming.prompts);
      return libraryStats(data);
    });
  }
}
