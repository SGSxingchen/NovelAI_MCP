import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_DISCLOSURE_MODE, isDisclosureMode } from './types.js';
import type { DisclosureMode } from './types.js';

const FILE_TIMEOUT = 15_000;
const USAGE_WRITE_DELAY = 250;
const MAX_LINK_FILE_BYTES = 16 * 1024 * 1024;
const LINK_ID = /^lnk_[a-f0-9]{12}$/;

export interface McpLinkRecord {
  id: string;
  label: string;
  token: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  call_count: number;
  total_anlas_spent: number;
  disclosure_mode?: DisclosureMode;
}

export type LinkSummary = McpLinkRecord & { disclosure_mode: DisclosureMode };

export interface BootstrapLink {
  label: string;
  token: string;
  enabled?: boolean;
}

interface LinkUpdate {
  label?: string;
  enabled?: boolean;
  expires_in_hours?: number | null;
  disclosure_mode?: DisclosureMode;
}

interface StoredLinks {
  items: McpLinkRecord[];
  importedBootstrapTokens: string[];
}

export async function preparePrivateDirectory(directory: string): Promise<string> {
  const signal = AbortSignal.timeout(FILE_TIMEOUT);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  signal.throwIfAborted();
  if (!info.isDirectory()) throw new Error('管理台存储路径必须是真实目录');
  if ((info.mode & 0o777) !== 0o700) await chmod(directory, 0o700);
  return directory;
}

export function prepareAdminDirectory(archiveDir: string): Promise<string> {
  return preparePrivateDirectory(join(archiveDir, '.admin'));
}

export async function readAdminFile(path: string, maxBytes: number): Promise<Buffer> {
  const signal = AbortSignal.timeout(FILE_TIMEOUT);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('管理台存储文件无效或超过大小限制');
    signal.throwIfAborted();
    if ((info.mode & 0o777) !== 0o600) await file.chmod(0o600);
    return await file.readFile({ signal });
  } finally {
    await file.close();
  }
}

export async function writeAdminFile(path: string, data: string | Buffer, createOnly = false): Promise<void> {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  const signal = AbortSignal.timeout(FILE_TIMEOUT);
  try {
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600, signal });
    signal.throwIfAborted();
    if (createOnly) await link(temporary, path);
    else await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('清理管理台临时文件失败');
    });
  }
}

function isBootstrapLink(value: unknown): value is BootstrapLink {
  if (!value || typeof value !== 'object') return false;
  const { label, token, enabled } = value as Partial<BootstrapLink>;
  return typeof label === 'string' && label.trim().length > 0
    && typeof token === 'string' && token.trim().length > 0 && token !== '.' && token !== '..'
    && (enabled === undefined || typeof enabled === 'boolean');
}

export function parseBootstrapLinks(value = process.env.MCP_BOOTSTRAP_LINKS): BootstrapLink[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('MCP_BOOTSTRAP_LINKS 必须是有效的 JSON 数组');
  }
  if (!Array.isArray(parsed) || !parsed.every(isBootstrapLink)) {
    throw new Error('MCP_BOOTSTRAP_LINKS 每项必须包含非空 label、token，可选布尔值 enabled');
  }
  return parsed;
}

const isTimestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

function isLinkRecord(value: unknown): value is McpLinkRecord {
  if (!isBootstrapLink(value)) return false;
  const item = value as Partial<McpLinkRecord>;
  return typeof item.id === 'string' && LINK_ID.test(item.id) && typeof item.enabled === 'boolean'
    && (item.disclosure_mode === undefined || isDisclosureMode(item.disclosure_mode))
    && isTimestamp(item.created_at) && isTimestamp(item.updated_at)
    && (item.expires_at === null || isTimestamp(item.expires_at))
    && (item.last_used_at === null || isTimestamp(item.last_used_at))
    && typeof item.call_count === 'number' && Number.isSafeInteger(item.call_count) && item.call_count >= 0
    && typeof item.total_anlas_spent === 'number' && Number.isFinite(item.total_anlas_spent) && item.total_anlas_spent >= 0;
}

export function isLinkExpired(item: McpLinkRecord, now = Date.now()): boolean {
  return item.expires_at !== null && Date.parse(item.expires_at) <= now;
}

function expiresAt(hours: number | null | undefined, now: number): string | null {
  if (hours === undefined || hours === null) return null;
  const date = new Date(now + hours * 3_600_000);
  if (typeof hours !== 'number' || !Number.isFinite(date.getTime())) {
    throw new RangeError('expires_in_hours 必须是有效小时数或 null');
  }
  return date.toISOString();
}

function newRecord(
  records: Map<string, LinkSummary>, input: BootstrapLink & Pick<LinkUpdate, 'disclosure_mode'>,
  now: number, expires_at: string | null = null,
): LinkSummary {
  let id: string;
  do {
    id = `lnk_${randomBytes(6).toString('hex')}`;
  } while (records.has(id));
  const timestamp = new Date(now).toISOString();
  return {
    id, label: input.label, token: input.token, enabled: input.enabled ?? true,
    created_at: timestamp, updated_at: timestamp, expires_at, last_used_at: null,
    call_count: 0, total_anlas_spent: 0, disclosure_mode: input.disclosure_mode ?? DEFAULT_DISCLOSURE_MODE,
  };
}

export class LinkStore {
  private records = new Map<string, LinkSummary>();
  private importedBootstrapTokens = new Set<string>();
  private file?: string;
  private loading?: Promise<void>;
  private writes = Promise.resolve();
  private usageTimer?: NodeJS.Timeout;
  private usageDirty = false;

  constructor(private readonly archiveDir?: string) {}

  private async load(): Promise<void> {
    if (!this.archiveDir) return;
    this.file = join(await prepareAdminDirectory(this.archiveDir), 'links.json');
    const raw = await readAdminFile(this.file, MAX_LINK_FILE_BYTES).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (!raw) return;
    let data: Partial<StoredLinks> | McpLinkRecord[] | null;
    try {
      data = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new Error('MCP 链接存储格式无效');
    }
    const items = Array.isArray(data) ? data : data?.items;
    const imported = Array.isArray(data) ? [] : data?.importedBootstrapTokens;
    if (!Array.isArray(items) || !items.every(isLinkRecord) || !Array.isArray(imported)
      || !imported.every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) {
      throw new Error('MCP 链接存储格式无效');
    }
    const records = new Map(items.map(item => [item.id, { ...item, disclosure_mode: item.disclosure_mode ?? DEFAULT_DISCLOSURE_MODE }]));
    if (records.size !== items.length || new Set(items.map(item => item.token)).size !== items.length) {
      throw new Error('MCP 链接存储包含重复记录');
    }
    this.records = records;
    this.importedBootstrapTokens = new Set(imported);
  }

  private ready(): Promise<void> {
    this.loading ??= this.load().catch(error => {
      this.loading = undefined;
      throw error;
    });
    return this.loading;
  }

  async init(bootstrapLinks: BootstrapLink[] = []): Promise<void> {
    if (bootstrapLinks.length === 0) return this.ready();
    if (!bootstrapLinks.every(isBootstrapLink)) throw new Error('预设 MCP 链接格式无效');
    await this.change((records, imported) => {
      const tokens = new Set([...records.values()].map(item => item.token));
      const now = Date.now();
      let changed = false;
      for (const input of bootstrapLinks) {
        const hash = createHash('sha256').update(input.token).digest('hex');
        if (imported.has(hash)) continue;
        // 记住已迁移的令牌，轮换或删除后重启时不会从环境变量恢复旧权限。
        imported.add(hash);
        changed = true;
        if (tokens.has(input.token)) continue;
        const { label, token, enabled } = input;
        const item = newRecord(records, { label, token, enabled }, now);
        records.set(item.id, item);
        tokens.add(item.token);
      }
      return changed ? true : undefined;
    });
  }

  list(): LinkSummary[] {
    return [...this.records.values()].map(item => ({ ...item }));
  }

  getById(id: string): LinkSummary | undefined {
    const item = this.records.get(id);
    return item && { ...item };
  }

  findActiveByToken(token: string): LinkSummary | undefined {
    const input = Buffer.from(token);
    const now = Date.now();
    let match: LinkSummary | undefined;
    for (const item of this.records.values()) {
      const expected = Buffer.from(item.token);
      if (expected.length === input.length && timingSafeEqual(expected, input) && item.enabled && !isLinkExpired(item, now)) {
        match = item;
      }
    }
    return match && { ...match };
  }

  create({ label, expires_in_hours, disclosure_mode }: { label: string } & Pick<LinkUpdate, 'expires_in_hours' | 'disclosure_mode'>): Promise<LinkSummary> {
    return this.change(records => {
      const now = Date.now();
      const item = newRecord(records, { label, token: randomBytes(32).toString('base64url'), disclosure_mode }, now, expiresAt(expires_in_hours, now));
      records.set(item.id, item);
      return { ...item };
    });
  }

  update(id: string, input: LinkUpdate): Promise<LinkSummary | undefined> {
    return this.change(records => {
      const previous = records.get(id);
      if (!previous) return undefined;
      const now = Date.now();
      const item = {
        ...previous,
        label: input.label ?? previous.label,
        enabled: input.enabled ?? previous.enabled,
        disclosure_mode: input.disclosure_mode ?? previous.disclosure_mode,
        expires_at: input.expires_in_hours === undefined ? previous.expires_at : expiresAt(input.expires_in_hours, now),
        updated_at: new Date(now).toISOString(),
      };
      records.set(id, item);
      return { ...item };
    });
  }

  rotate(id: string): Promise<{ item: LinkSummary; previousToken: string } | undefined> {
    return this.change(records => {
      const previous = records.get(id);
      if (!previous) return undefined;
      const item = { ...previous, token: randomBytes(32).toString('base64url'), updated_at: new Date().toISOString() };
      records.set(id, item);
      return { item: { ...item }, previousToken: previous.token };
    });
  }

  delete(id: string): Promise<LinkSummary | undefined> {
    return this.change(records => {
      const item = records.get(id);
      if (item) records.delete(id);
      return item && { ...item };
    });
  }

  async recordUsage(id: string, anlasSpent = 0): Promise<void> {
    await this.ready();
    await this.enqueue(() => {
      const item = this.records.get(id);
      if (!item) return;
      this.records.set(id, {
        ...item,
        last_used_at: new Date().toISOString(),
        call_count: item.call_count + 1,
        total_anlas_spent: item.total_anlas_spent + (Number.isFinite(anlasSpent) ? Math.max(0, anlasSpent) : 0),
      });
      if (!this.file) return;
      this.usageDirty = true;
      this.usageTimer ??= setTimeout(() => {
        void this.flush().catch(() => console.error('保存 MCP 链接使用统计失败'));
      }, USAGE_WRITE_DELAY).unref();
    });
  }

  flush(): Promise<void> {
    clearTimeout(this.usageTimer);
    this.usageTimer = undefined;
    return this.enqueue(async () => {
      if (!this.usageDirty) return;
      await this.persist(this.records, this.importedBootstrapTokens);
      this.usageDirty = false;
    });
  }

  private enqueue<T>(work: () => T | Promise<T>): Promise<T> {
    const pending = this.writes.then(work);
    this.writes = pending.then(() => {}, () => {});
    return pending;
  }

  private async change<T>(work: (records: Map<string, LinkSummary>, imported: Set<string>) => T): Promise<T> {
    await this.ready();
    return this.enqueue(async () => {
      const records = new Map(this.records);
      const imported = new Set(this.importedBootstrapTokens);
      const result = work(records, imported);
      if (result !== undefined) {
        await this.persist(records, imported);
        this.records = records;
        this.importedBootstrapTokens = imported;
        this.usageDirty = false;
      }
      return result;
    });
  }

  private async persist(records: Map<string, LinkSummary>, imported: Set<string>): Promise<void> {
    if (!this.file) return;
    const snapshot: StoredLinks = { items: [...records.values()], importedBootstrapTokens: [...imported] };
    const data = JSON.stringify(snapshot, null, 2) + '\n';
    if (Buffer.byteLength(data) > MAX_LINK_FILE_BYTES) throw new Error('MCP 链接存储超过大小限制');
    await writeAdminFile(this.file, data);
  }
}
