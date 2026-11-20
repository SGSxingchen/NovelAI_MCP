import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ENCODE_VIBE_MODELS } from './model-registry.js';
import type { Model } from './types.js';

const VIBE_ID = /^vibe_[a-f0-9]{16}$/;
const HASH_KEY = /^[a-f0-9]{64}$/;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_MEMORY_BYTES = 32 * 1024 * 1024;
const MAX_MEMORY_ENTRIES = 128;
const FILE_TIMEOUT = 10_000;

export interface VibeCacheEntry {
  id: string;
  model: Model;
  information_extracted: number;
  encoded_vibe: string;
  created_at: string;
}

export function vibeCacheKey(
  image: Buffer,
  model: Model,
  informationExtracted: number,
  mask?: Buffer,
  cropToMask = false,
): string {
  const maskHash = mask ? createHash('sha256').update(mask).digest('hex') : '';
  const hash = createHash('sha256').update(image).update(`|${model}|${informationExtracted.toFixed(4)}|${maskHash}`);
  // 遮罩裁剪会改变上游编码，启用时使用独立键。
  if (cropToMask) hash.update('|crop_to_mask');
  return hash.digest('hex');
}

function vibeId(key: string): string {
  if (!HASH_KEY.test(key)) throw new Error('无效的 Vibe 缓存键');
  return `vibe_${key.slice(0, 16)}`;
}

export class VibeCache {
  private readonly directory?: string;
  private readonly memory = new Map<string, VibeCacheEntry>();
  private readonly pending = new Map<string, Promise<VibeCacheEntry>>();
  private memoryBytes = 0;

  constructor(archiveDir?: string) {
    if (archiveDir) this.directory = join(archiveDir, '.vibe-cache');
  }

  private remember(entry: VibeCacheEntry): void {
    const prior = this.memory.get(entry.id);
    if (prior) {
      this.memoryBytes -= prior.encoded_vibe.length;
      this.memory.delete(entry.id);
    }
    this.memory.set(entry.id, entry);
    this.memoryBytes += entry.encoded_vibe.length;
    for (const [id, old] of this.memory) {
      if (this.memoryBytes <= MAX_MEMORY_BYTES && this.memory.size <= MAX_MEMORY_ENTRIES) break;
      this.memory.delete(id);
      this.memoryBytes -= old.encoded_vibe.length;
    }
  }

  async getByHashKey(key: string): Promise<VibeCacheEntry | undefined> {
    return this.getById(vibeId(key));
  }

  async getById(id: string): Promise<VibeCacheEntry | undefined> {
    if (!VIBE_ID.test(id)) return undefined;
    const cached = this.memory.get(id);
    if (cached) {
      this.remember(cached);
      return cached;
    }
    if (!this.directory) return undefined;

    try {
      const filename = join(this.directory, `${id}.json`);
      const info = await stat(filename);
      if (!info.isFile() || info.size > MAX_ENTRY_BYTES + 1024) return undefined;
      const entry = JSON.parse(await readFile(filename, {
        encoding: 'utf8', signal: AbortSignal.timeout(FILE_TIMEOUT),
      })) as VibeCacheEntry | null;
      if (!entry || entry.id !== id || !ENCODE_VIBE_MODELS.includes(entry.model)
        || typeof entry.encoded_vibe !== 'string' || !entry.encoded_vibe || entry.encoded_vibe.length > MAX_ENTRY_BYTES
        || !Number.isFinite(entry.information_extracted) || entry.information_extracted < 0 || entry.information_extracted > 1
        || typeof entry.created_at !== 'string' || !Number.isFinite(Date.parse(entry.created_at))) {
        return undefined;
      }
      this.remember(entry);
      return entry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('读取 Vibe 缓存失败，将根据输入重新解析该参考。');
      }
      return undefined;
    }
  }

  async set(key: string, value: Omit<VibeCacheEntry, 'id' | 'created_at'>): Promise<VibeCacheEntry> {
    const entry = { id: vibeId(key), ...value, created_at: new Date().toISOString() };
    if (!value.encoded_vibe || value.encoded_vibe.length > MAX_ENTRY_BYTES) {
      throw new Error('上游返回的 Vibe 编码为空或超出缓存大小限制');
    }
    this.remember(entry);
    if (this.directory) {
      const temporary = join(this.directory, `.pending-${randomUUID()}`);
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await writeFile(temporary, JSON.stringify(entry), {
          flag: 'wx', mode: 0o600, signal: AbortSignal.timeout(FILE_TIMEOUT),
        });
        await rename(temporary, join(this.directory, `${entry.id}.json`));
      } catch {
        console.error('写入 Vibe 磁盘缓存失败，本次编码已存入内存。');
        await unlink(temporary).catch(() => {});
      }
    }
    return entry;
  }

  async getOrEncode(
    key: string,
    model: Model,
    informationExtracted: number,
    encode: () => Promise<string>,
  ): Promise<VibeCacheEntry> {
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = (async () => {
      const cached = await this.getByHashKey(key);
      if (cached) return cached;
      return this.set(key, {
        model, information_extracted: informationExtracted, encoded_vibe: await encode(),
      });
    })();
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }

  async list(): Promise<Omit<VibeCacheEntry, 'encoded_vibe'>[]> {
    const summaries = new Map<string, Omit<VibeCacheEntry, 'encoded_vibe'>>();
    const add = ({ encoded_vibe: _encoding, ...summary }: VibeCacheEntry) => summaries.set(summary.id, summary);
    for (const entry of this.memory.values()) add(entry);
    if (this.directory) {
      const files = await readdir(this.directory).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      });
      for (const filename of files) {
        if (!filename.endsWith('.json')) continue;
        const entry = await this.getById(filename.slice(0, -5));
        if (entry) add(entry);
      }
    }
    return [...summaries.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
