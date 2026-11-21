import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, opendir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { sniffImageFormat } from './response-unpack.js';
import type { ImageExtension, ImageGenerationParams, ImageMimeType } from './types.js';

export const IMAGE_PATH = '/novelai-images/';
export const ARCHIVE_ID_REGEX = /^[A-Za-z0-9_-]{43}$/;
const IMAGE_EXTENSIONS = ['png', 'webp', 'jpg'] as const;
const FS_TIMEOUT = 15_000;
const MAX_ARCHIVED_IMAGE_BYTES = 96 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_MAX_PIXELS = 64 * 1024 * 1024;
const archiveOperations = new Map<string, Promise<unknown>>();

export interface ArchiveMetadataInput {
  tool: string;
  action: string;
  private?: boolean;
  model?: string;
  width?: number;
  height?: number;
  seed?: number;
  prompt_preview?: string;
  note?: string;
  anlas_spent?: number;
  link_id?: string;
  link_label?: string;
}

export interface ArchivedImageMetadata extends Partial<ArchiveMetadataInput> {
  schema_version: 1 | 2;
  id: string;
  created_at: string;
  mime_type: ImageMimeType;
  ext?: ImageExtension;
  size_bytes: number;
}

export interface SavedArchivedImage {
  id: string;
  ext: ImageExtension;
  mimeType: ImageMimeType;
  filename: `${string}.${ImageExtension}`;
}

export function extractArchiveId(input: string, publicOrigin?: URL): string | null {
  if (ARCHIVE_ID_REGEX.test(input)) return input;
  if (!publicOrigin) return null;
  const prefix = publicOrigin.origin + IMAGE_PATH;
  return input.startsWith(prefix)
    ? /^([A-Za-z0-9_-]{43})\.(png|webp|jpg)$/.exec(input.slice(prefix.length))?.[1] ?? null
    : null;
}

async function writeArchive(
  archiveDir: string, image: Buffer, ext: ImageExtension, metadata: ArchivedImageMetadata,
): Promise<void> {
  if (image.length > MAX_ARCHIVED_IMAGE_BYTES) throw new Error('归档图像超过大小限制');
  const signal = AbortSignal.timeout(FS_TIMEOUT);
  const stagingDir = await mkdtemp(join(archiveDir, '.pending-'));
  try {
    const options = { mode: 0o600, flag: 'wx', signal } as const;
    await writeFile(join(stagingDir, `image.${ext}`), image, options);
    await writeFile(join(stagingDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', options);
    signal.throwIfAborted();
    await rename(stagingDir, join(archiveDir, metadata.id));
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function saveImage(archiveDir: string, png: Buffer, params: ImageGenerationParams): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await writeArchive(archiveDir, png, 'png', {
    schema_version: 1,
    id,
    created_at: new Date().toISOString(),
    model: params.model,
    width: params.width,
    height: params.height,
    seed: params.seed,
    mime_type: 'image/png',
    size_bytes: png.length,
  });
  return id;
}

export async function saveArchivedImage(
  archiveDir: string, image: Buffer, input: ArchiveMetadataInput,
): Promise<SavedArchivedImage> {
  const format = sniffImageFormat(image);
  if (!format) throw new Error('无法归档未知格式的图像');
  const { ext, mimeType } = format;
  const id = randomBytes(32).toString('base64url');
  await writeArchive(archiveDir, image, ext, {
    ...input,
    schema_version: 2,
    id,
    created_at: new Date().toISOString(),
    mime_type: mimeType,
    ext,
    size_bytes: image.length,
  });
  return { id, ext, mimeType, filename: `${id}.${ext}` };
}

function missingArchive(): NodeJS.ErrnoException {
  return Object.assign(new Error('找不到归档图像'), { code: 'ENOENT' });
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(error.code));
}

async function archivePath(archiveDir: string, id: string, signal: AbortSignal): Promise<string> {
  if (!ARCHIVE_ID_REGEX.test(id)) throw new Error('归档图片 ID 无效');
  const path = join(archiveDir, id);
  const entry = await lstat(path);
  signal.throwIfAborted();
  if (!entry.isDirectory()) throw missingArchive();
  return path;
}

async function readArchiveFile(path: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw missingArchive();
    if (stat.size > limit) throw new Error('归档文件超过大小限制');
    return await file.readFile({ signal });
  } finally {
    await file.close();
  }
}

async function readMetadata(path: string, id: string, signal: AbortSignal): Promise<ArchivedImageMetadata> {
  const raw = await readArchiveFile(join(path, 'metadata.json'), MAX_METADATA_BYTES, signal);
  const metadata: ArchivedImageMetadata | null = JSON.parse(raw.toString('utf8'));
  if (!metadata || (metadata.schema_version !== 1 && metadata.schema_version !== 2) || metadata.id !== id ||
      typeof metadata.created_at !== 'string' || !Number.isFinite(Date.parse(metadata.created_at))) {
    throw new SyntaxError('归档元数据版本、ID 或创建时间无效');
  }
  return metadata;
}

export async function getArchivedImageMetadata(archiveDir: string, id: string): Promise<ArchivedImageMetadata> {
  const signal = AbortSignal.timeout(FS_TIMEOUT);
  return readMetadata(await archivePath(archiveDir, id, signal), id, signal);
}

export async function loadArchivedImage(
  archiveDir: string, id: string, { publicOnly = false } = {},
): Promise<{
  buffer: Buffer;
  mimeType: ImageMimeType;
  ext: ImageExtension;
  metadata: ArchivedImageMetadata;
}> {
  const signal = AbortSignal.timeout(FS_TIMEOUT);
  const path = await archivePath(archiveDir, id, signal);
  const metadata = await readMetadata(path, id, signal);
  if (publicOnly && metadata.private) throw missingArchive();
  const preferredExt = metadata.ext;
  const extensions = preferredExt && IMAGE_EXTENSIONS.includes(preferredExt)
    ? [preferredExt, ...IMAGE_EXTENSIONS.filter(ext => ext !== preferredExt)]
    : IMAGE_EXTENSIONS;
  for (const ext of extensions) {
    let buffer: Buffer;
    try {
      buffer = await readArchiveFile(join(path, `image.${ext}`), MAX_ARCHIVED_IMAGE_BYTES, signal);
    } catch (error) {
      if (!isMissing(error)) throw error;
      continue;
    }
    const format = sniffImageFormat(buffer);
    if (!format) throw new Error('归档文件不是可识别的图像');
    return { buffer, ...format, metadata };
  }
  throw missingArchive();
}

async function* scanArchivedImages(archiveDir: string, signal: AbortSignal): AsyncGenerator<ArchivedImageMetadata> {
  const directory = await opendir(archiveDir);
  for await (const entry of directory) {
    signal.throwIfAborted();
    if (!entry.isDirectory() || !ARCHIVE_ID_REGEX.test(entry.name)) continue;
    try {
      yield await readMetadata(join(archiveDir, entry.name), entry.name, signal);
    } catch (error) {
      if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
    }
  }
}

export async function listArchivedImages(
  archiveDir: string, limit = 20, { publicOnly = false } = {},
): Promise<ArchivedImageMetadata[]> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('归档查询数量必须为非负整数');
  if (limit === 0) return [];
  const signal = AbortSignal.timeout(FS_TIMEOUT);
  const records: Array<{ metadata: ArchivedImageMetadata; timestamp: number }> = [];
  for await (const metadata of scanArchivedImages(archiveDir, signal)) {
    if (publicOnly && metadata.private) continue;
    const timestamp = Date.parse(metadata.created_at);
    const index = records.findIndex(item => item.timestamp < timestamp ||
      (item.timestamp === timestamp && item.metadata.id < metadata.id));
    if (index >= 0) records.splice(index, 0, { metadata, timestamp });
    else if (records.length < limit) records.push({ metadata, timestamp });
    if (records.length > limit) records.pop();
  }
  return records.map(record => record.metadata);
}

export interface ArchiveQuery {
  limit?: number;
  offset?: number;
  q?: string;
  model?: string;
  tool?: string;
  link_id?: string;
  sort?: 'newest' | 'oldest';
}

export async function queryArchivedImages(archiveDir: string | undefined, query: ArchiveQuery = {}) {
  const { limit = 50, offset = 0, q, model, tool, link_id, sort = 'newest' } = query;
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('归档查询的 limit 和 offset 必须为非负整数');
  }

  const models = new Set<string>();
  const tools = new Set<string>();
  const links = new Map<string, { label: string; timestamp: number }>();
  const hits: Array<{ id: string; timestamp: number }> = [];
  const items: ArchivedImageMetadata[] = [];
  let cursor = offset;
  if (archiveDir) {
    const signal = AbortSignal.timeout(FS_TIMEOUT);
    const needle = q?.trim().toLowerCase();
    for await (const item of scanArchivedImages(archiveDir, signal)) {
      const timestamp = Date.parse(item.created_at);
      if (typeof item.model === 'string' && item.model) models.add(item.model);
      if (typeof item.tool === 'string' && item.tool) tools.add(item.tool);
      if (typeof item.link_id === 'string' && item.link_id) {
        const existing = links.get(item.link_id);
        const label = typeof item.link_label === 'string' && item.link_label ? item.link_label : undefined;
        if (!existing || (label && timestamp >= existing.timestamp)) {
          links.set(item.link_id, { label: label ?? item.link_id, timestamp: label ? timestamp : -Infinity });
        }
      }
      if ((model && item.model !== model) || (tool && item.tool !== tool) || (link_id && item.link_id !== link_id)) continue;
      if (needle && ![item.id, item.seed, item.prompt_preview, item.model, item.link_label, item.tool, item.action]
        .some(value => (typeof value === 'string' || typeof value === 'number') && String(value).toLowerCase().includes(needle))) {
        continue;
      }
      hits.push({ id: item.id, timestamp });
    }
    // 排序只保留 ID 与时间，读取当前页时才保留完整元数据。
    const direction = sort === 'oldest' ? 1 : -1;
    hits.sort((a, b) => direction * (a.timestamp - b.timestamp || a.id.localeCompare(b.id)));
    for (; cursor < hits.length && items.length < limit; cursor++) {
      const { id } = hits[cursor];
      try {
        items.push(await readMetadata(await archivePath(archiveDir, id, signal), id, signal));
      } catch (error) {
        if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
      }
    }
  }

  return {
    items, total: hits.length, hasMore: cursor < hits.length,
    facets: {
      models: [...models].sort(), tools: [...tools].sort(),
      links: [...links].map(([id, { label }]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
    },
  };
}

export async function getArchiveStats(archiveDir?: string) {
  let totalCount = 0;
  let totalBytes = 0;
  const models = new Map<string, number>();
  const links = new Map<string, number>();
  if (archiveDir) {
    const signal = AbortSignal.timeout(FS_TIMEOUT);
    for await (const item of scanArchivedImages(archiveDir, signal)) {
      totalCount++;
      if (Number.isSafeInteger(item.size_bytes) && item.size_bytes >= 0) totalBytes += item.size_bytes;
      if (typeof item.model === 'string' && item.model) models.set(item.model, (models.get(item.model) ?? 0) + 1);
      if (typeof item.link_id === 'string' && item.link_id) links.set(item.link_id, (links.get(item.link_id) ?? 0) + 1);
    }
  }
  return { totalCount, totalBytes, models: Object.fromEntries(models), links: Object.fromEntries(links) };
}

async function withArchiveOperation<T>(archiveDir: string, id: string, operation: () => Promise<T>): Promise<T> {
  if (!ARCHIVE_ID_REGEX.test(id)) throw new Error('归档图片 ID 无效');
  const key = resolve(archiveDir, id);
  const previous = archiveOperations.get(key) ?? Promise.resolve();
  const pending = previous.then(operation, operation);
  archiveOperations.set(key, pending);
  try {
    return await pending;
  } finally {
    if (archiveOperations.get(key) === pending) archiveOperations.delete(key);
  }
}

async function thumbDirectory(archiveDir: string, signal: AbortSignal, create = false): Promise<string | undefined> {
  const directory = join(archiveDir, '.thumbs');
  signal.throwIfAborted();
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const info = await lstat(directory);
    signal.throwIfAborted();
    if (!info.isDirectory()) throw new Error('缩略图缓存路径必须是真实目录');
    if ((info.mode & 0o777) !== 0o700) await chmod(directory, 0o700);
    return directory;
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function deleteArchivedImage(archiveDir: string, id: string): Promise<void> {
  return withArchiveOperation(archiveDir, id, async () => {
    const signal = AbortSignal.timeout(FS_TIMEOUT);
    const path = await archivePath(archiveDir, id, signal);
    const directory = await thumbDirectory(archiveDir, signal);
    if (directory) await rm(join(directory, `${id}.webp`), { force: true });
    signal.throwIfAborted();
    await rm(path, { recursive: true });
  });
}

export function getOrCreateThumbnail(archiveDir: string, id: string, maxWidth = THUMBNAIL_WIDTH): Promise<Buffer> {
  return withArchiveOperation(archiveDir, id, async () => {
    if (!Number.isSafeInteger(maxWidth) || maxWidth <= 0) throw new RangeError('缩略图宽度必须为正整数');
    const signal = AbortSignal.timeout(FS_TIMEOUT);
    await archivePath(archiveDir, id, signal);
    const directory = await thumbDirectory(archiveDir, signal);
    let cached: Buffer | undefined;
    let cachedWidth: number | undefined;
    if (directory) {
      try {
        const bytes = await readArchiveFile(join(directory, `${id}.webp`), MAX_ARCHIVED_IMAGE_BYTES, signal);
        if (sniffImageFormat(bytes)?.ext === 'webp') {
          cached = bytes;
          cachedWidth = (await sharp(bytes).metadata().catch(() => undefined))?.width;
          if (cachedWidth === maxWidth) return cached;
        }
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }

    const { buffer } = await loadArchivedImage(archiveDir, id);
    const image = sharp(buffer, { limitInputPixels: THUMBNAIL_MAX_PIXELS }).timeout({ seconds: FS_TIMEOUT / 1_000 });
    if (cached && cachedWidth && cachedWidth < maxWidth && (await image.metadata()).width === cachedWidth) return cached;
    const thumbnail = await image.resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    const target = join(archiveDir, '.thumbs', `${id}.webp`);
    const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
    const cacheSignal = AbortSignal.timeout(FS_TIMEOUT);
    if (!directory) await thumbDirectory(archiveDir, cacheSignal, true);
    try {
      await writeFile(temporary, thumbnail, { flag: 'wx', mode: 0o600, signal: cacheSignal });
      cacheSignal.throwIfAborted();
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => console.error('清理缩略图临时文件失败'));
      throw error;
    }
    return thumbnail;
  });
}
