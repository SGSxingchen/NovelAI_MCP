import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, opendir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sniffImageFormat } from './response-unpack.js';
import type { ImageExtension, ImageGenerationParams, ImageMimeType } from './types.js';

export const IMAGE_PATH = '/novelai-images/';
export const ARCHIVE_ID_REGEX = /^[A-Za-z0-9_-]{43}$/;
const IMAGE_EXTENSIONS = ['png', 'webp', 'jpg'] as const;
const FS_TIMEOUT = 15_000;
const MAX_ARCHIVED_IMAGE_BYTES = 96 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;

export interface ArchiveMetadataInput {
  tool: string;
  action: string;
  model?: string;
  width?: number;
  height?: number;
  seed?: number;
  prompt_preview?: string;
  note?: string;
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

export async function loadArchivedImage(archiveDir: string, id: string): Promise<{
  buffer: Buffer;
  mimeType: ImageMimeType;
  ext: ImageExtension;
  metadata: ArchivedImageMetadata;
}> {
  const signal = AbortSignal.timeout(FS_TIMEOUT);
  const path = await archivePath(archiveDir, id, signal);
  const metadata = await readMetadata(path, id, signal);
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

export async function listArchivedImages(archiveDir: string, limit = 20): Promise<ArchivedImageMetadata[]> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('归档查询数量必须为非负整数');
  if (limit === 0) return [];
  const signal = AbortSignal.timeout(FS_TIMEOUT);
  const directory = await opendir(archiveDir);
  const records: Array<{ metadata: ArchivedImageMetadata; timestamp: number }> = [];
  for await (const entry of directory) {
    signal.throwIfAborted();
    if (!entry.isDirectory() || !ARCHIVE_ID_REGEX.test(entry.name)) continue;
    try {
      const metadata = await readMetadata(join(archiveDir, entry.name), entry.name, signal);
      const timestamp = Date.parse(metadata.created_at);
      const index = records.findIndex(item => item.timestamp < timestamp ||
        (item.timestamp === timestamp && item.metadata.id < metadata.id));
      if (index >= 0) records.splice(index, 0, { metadata, timestamp });
      else if (records.length < limit) records.push({ metadata, timestamp });
      if (records.length > limit) records.pop();
    } catch (error) {
      if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
    }
  }
  return records.map(record => record.metadata);
}
