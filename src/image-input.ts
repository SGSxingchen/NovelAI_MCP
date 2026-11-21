import { lookup } from 'node:dns/promises';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { get } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { extractArchiveId, loadArchivedImage } from './image-archive.js';
import { decodeBase64, sniffImageFormat } from './response-unpack.js';
import type { MaskRegion } from './types.js';

const TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const MAX_PNG_TEXT_BYTES = 1024 * 1024;
const MAX_PNG_TEXT_CHUNKS = 64;
const BLACK = { r: 0, g: 0, b: 0, alpha: 1 };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// IANA 特殊用途、组播及保留网段。IPv6 同时要求属于公网单播，拒绝映射与转换前缀。
const blockedIps = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedIps.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) blockedIps.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPrivateOrReservedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedIps.check(address, 'ipv4');
  if (family === 6) {
    return address.includes('%') || !globalV6.check(address, 'ipv6') || blockedIps.check(address, 'ipv6');
  }
  return true;
}

async function lookupAll(hostname: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([lookup(hostname, { all: true }), deadline]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function readDownload(response: IncomingMessage): Promise<Buffer> {
  const status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    response.destroy();
    throw new Error(`图像下载失败（HTTP ${status}），仅接受直接返回图像的地址`);
  }
  if (Number(response.headers['content-length']) > MAX_DOWNLOAD_BYTES) {
    response.destroy();
    throw new Error('下载图像超过 20 MB');
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_DOWNLOAD_BYTES) throw new Error('下载图像超过 20 MB');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length);
}

async function downloadImage(url: URL): Promise<Buffer> {
  if (url.username || url.password) throw new Error('图像链接不得包含登录凭据');
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookupAll(hostname, signal);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateOrReservedIp(address))) {
    throw new Error('图像链接须解析到公网地址，不能访问私有或保留地址');
  }
  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
  return new Promise((resolve, reject) => {
    // 保持 URL 主机名用于 TLS 验证，固定连接到已校验的地址，避免第二次 DNS 解析。
    const request = get(url, {
      agent: false,
      signal,
      family: selected.family,
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
      headers: { Accept: 'image/png, image/webp, image/jpeg, image/gif', 'Accept-Encoding': 'identity' },
    }, response => {
      readDownload(response).then(resolve, reject);
    });
    request.once('error', reject);
  });
}

function isInputImage(buffer: Buffer): boolean {
  const gif = buffer.toString('latin1', 0, 6);
  return gif === 'GIF87a' || gif === 'GIF89a' || sniffImageFormat(buffer) !== undefined;
}

function verifyInputImage(buffer: Buffer): Buffer {
  if (!isInputImage(buffer)) throw new Error('输入不是 PNG、WebP、JPEG 或 GIF 图像');
  return buffer;
}

export interface ResolveImageInputOptions {
  archiveDir?: string;
  imageOrigin?: URL;
  allowLocalFiles?: boolean;
}

export async function resolveImageInput(input: string, options: ResolveImageInputOptions): Promise<Buffer> {
  if (typeof input !== 'string' || !input.trim()) throw new Error('图像输入不能为空');
  const value = input.trim();
  const archiveId = extractArchiveId(value, options.imageOrigin);
  if (archiveId) {
    if (!options.archiveDir) throw new Error('当前服务没有配置图像归档目录');
    return (await loadArchivedImage(options.archiveDir, archiveId)).buffer;
  }
  if (/^data:/i.test(value)) {
    const comma = value.indexOf(',');
    if (comma < 0 || !/^data:image\/[a-z0-9.+-]+;base64$/i.test(value.slice(0, comma))) {
      throw new Error('图像数据链接须使用 data:image/...;base64 格式');
    }
    return verifyInputImage(decodeBase64(value.slice(comma + 1), MAX_IMAGE_INPUT_BYTES));
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[/\\]/i.test(value)) {
    if (!/^https:\/\//i.test(value)) throw new Error('远程图像仅支持 HTTPS 地址');
    return verifyInputImage(await downloadImage(new URL(value)));
  }
  if (value.length % 4 !== 1 && (value.length % 4 === 0 || !value.endsWith('=')) &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    const buffer = decodeBase64(value, MAX_IMAGE_INPUT_BYTES);
    if (isInputImage(buffer)) return buffer;
  }
  if (!options.allowLocalFiles) throw new Error('HTTP 模式禁止读取本地文件。请传入归档 ID、HTTPS 链接或图像 Base64');
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const file = await open(value, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('图像路径须指向普通文件');
    if (stat.size > MAX_IMAGE_INPUT_BYTES) throw new Error('本地图像超过大小限制');
    return verifyInputImage(await file.readFile({ signal }));
  } finally {
    await file.close();
  }
}

function pipeline(input: Buffer) {
  return sharp(verifyInputImage(input), { limitInputPixels: MAX_IMAGE_PIXELS }).timeout({ seconds: TIMEOUT_MS / 1000 });
}

function validateSize(width: number, height: number, alignment = 1): void {
  if (![width, height].every(value => Number.isSafeInteger(value) && value >= alignment && value % alignment === 0)) {
    throw new Error(alignment === 1 ? '图像宽高须为正整数' : `图像宽高须为 ${alignment} 的正整数倍`);
  }
  if (width * height > MAX_IMAGE_PIXELS) throw new Error('图像像素数超过处理上限');
}

export async function getImageDimensions(
  buffer: Buffer, { verifyDecode = false } = {},
): Promise<{ width: number; height: number; format: string }> {
  const image = pipeline(buffer);
  const { width, height, format } = await image.metadata();
  if (!width || !height || !format) throw new Error('无法读取图像的宽高和格式');
  validateSize(width, height);
  if (verifyDecode) await image.resize(1, 1, { fit: 'inside' }).raw().toBuffer();
  return { width, height, format };
}

export async function ensurePngBuffer(buffer: Buffer): Promise<Buffer> {
  const verified = verifyInputImage(buffer);
  if (sniffImageFormat(verified)?.ext === 'png') return verified;
  return pipeline(verified).png().toBuffer();
}

export async function prepareImg2ImgImage(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  validateSize(width, height);
  return pipeline(buffer).resize(width, height, { fit: 'fill' }).png().toBuffer();
}

function blackLetterbox(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  return pipeline(buffer).resize(width, height, { fit: 'contain', position: 'centre', background: BLACK })
    .flatten({ background: BLACK }).png().toBuffer();
}

export async function preparePreciseReferenceImage(buffer: Buffer): Promise<Buffer> {
  const { width, height } = await getImageDimensions(buffer);
  const ratio = width / height;
  const candidates = [{ w: 1024, h: 1536 }, { w: 1536, h: 1024 }, { w: 1472, h: 1472 }];
  const closest = candidates.reduce((best, candidate) =>
    Math.abs(ratio - candidate.w / candidate.h) < Math.abs(ratio - best.w / best.h) ? candidate : best);
  return blackLetterbox(buffer, closest.w, closest.h);
}

export function prepareV3VibeImage(buffer: Buffer): Promise<Buffer> {
  return blackLetterbox(buffer, 448, 448);
}

function expandMaskGrid(grid: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(grid, { raw: { width: width / 8, height: height / 8, channels: 1 } })
    .timeout({ seconds: TIMEOUT_MS / 1000 })
    .resize(width, height, { fit: 'fill', kernel: 'nearest' }).toColourspace('b-w').png().toBuffer();
}

export async function prepareInpaintMask(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  validateSize(width, height, 8);
  const binary = await pipeline(buffer).flatten({ background: BLACK }).greyscale().threshold(128).png().toBuffer();
  const grid = await pipeline(binary).resize(width / 8, height / 8, { fit: 'fill', kernel: 'nearest' })
    .threshold(128).toColourspace('b-w').raw().toBuffer();
  return expandMaskGrid(grid, width, height);
}

export async function generateMaskFromRegions(width: number, height: number, regions: MaskRegion[]): Promise<Buffer> {
  validateSize(width, height, 8);
  if (regions.length > 256) throw new Error('蒙版区域最多支持 256 个');
  const columns = width / 8;
  const rows = height / 8;
  const grid = Buffer.alloc(columns * rows);
  for (const { shape = 'rect', x, y, width: spanX, height: spanY } of regions) {
    if ((shape !== 'rect' && shape !== 'ellipse') ||
        ![x, y, spanX, spanY].every(value => Number.isFinite(value) && value >= 0 && value <= 1) ||
        spanX === 0 || spanY === 0) throw new Error('蒙版区域需使用 0 到 1 的归一化坐标和正宽高');
    const left = Math.floor(x * columns);
    const top = Math.floor(y * rows);
    const right = Math.min(columns, Math.ceil((x + spanX) * columns));
    const bottom = Math.min(rows, Math.ceil((y + spanY) * rows));
    const radiusX = spanX * columns / 2;
    const radiusY = spanY * rows / 2;
    const centerX = x * columns + radiusX;
    const centerY = y * rows + radiusY;
    for (let row = top; row < bottom; row++) {
      if (shape === 'rect') {
        grid.fill(255, row * columns + left, row * columns + right);
        continue;
      }
      const dy = (row + 0.5 - centerY) / radiusY;
      for (let column = left; column < right; column++) {
        const dx = (column + 0.5 - centerX) / radiusX;
        if (dx * dx + dy * dy <= 1) grid[row * columns + column] = 255;
      }
    }
  }
  return expandMaskGrid(grid, width, height);
}

export async function fitImageToMaxPixels(buffer: Buffer, maxPixels = 1048576): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0) throw new Error('最大像素数须为正整数');
  const { width, height } = await getImageDimensions(buffer);
  if (width * height <= maxPixels) return { buffer: await pipeline(buffer).png().toBuffer(), width, height };
  if (maxPixels < 64) throw new Error('最大像素数不足以对齐 8×8 像素');
  const scale = Math.sqrt(maxPixels / (width * height));
  let targetWidth = Math.max(8, Math.floor(width * scale / 8) * 8);
  let targetHeight = Math.max(8, Math.floor(height * scale / 8) * 8);
  if (targetWidth * targetHeight > maxPixels) {
    if (targetWidth > targetHeight) targetWidth = Math.floor(maxPixels / targetHeight / 8) * 8;
    else targetHeight = Math.floor(maxPixels / targetWidth / 8) * 8;
  }
  return { buffer: await prepareImg2ImgImage(buffer, targetWidth, targetHeight), width: targetWidth, height: targetHeight };
}

function readInternationalText(chunk: Buffer, separator: number, budget: number): Buffer | undefined {
  const compressionFlag = chunk[separator + 1];
  const compressionMethod = chunk[separator + 2];
  if ((compressionFlag !== 0 && compressionFlag !== 1) || compressionMethod !== 0) return undefined;
  const languageEnd = chunk.indexOf(0, separator + 3);
  if (languageEnd < 0) return undefined;
  const keyEnd = chunk.indexOf(0, languageEnd + 1);
  if (keyEnd < 0) return undefined;
  const text = chunk.subarray(keyEnd + 1);
  if (!compressionFlag) return text;
  try {
    return inflateSync(text, { maxOutputLength: budget });
  } catch {
    return undefined;
  }
}

export function extractPngTextMetadata(buffer: Buffer): Record<string, unknown> {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return {};
  const entries = new Map<string, unknown>();
  let remaining = MAX_PNG_TEXT_BYTES;
  let textChunks = 0;
  let offset = 8;
  while (offset + 12 <= buffer.length && remaining > 0 && textChunks < MAX_PNG_TEXT_CHUNKS) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const end = offset + 8 + size;
    if (end + 4 > buffer.length || type === 'IEND') break;
    const chunk = buffer.subarray(offset + 8, end);
    offset = end + 4;
    if ((type !== 'tEXt' && type !== 'iTXt') || size > remaining) continue;
    textChunks++;
    const separator = chunk.indexOf(0);
    if (separator < 1 || separator > 79) continue;
    const key = chunk.toString('latin1', 0, separator);
    const value = type === 'tEXt' ? chunk.subarray(separator + 1) : readInternationalText(chunk, separator, remaining);
    if (!value || value.length + separator + 1 > remaining) continue;
    remaining -= value.length + separator + 1;
    const text = value.toString(type === 'tEXt' ? 'latin1' : 'utf8');
    if (key === 'Comment') {
      try {
        entries.set(key, JSON.parse(text));
        continue;
      } catch {
        // 某些 PNG 使用普通文本注释。
      }
    }
    entries.set(key, text);
  }
  return Object.fromEntries(entries);
}
