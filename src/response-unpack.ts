import AdmZip from 'adm-zip';
import type { UnpackedImage } from './types.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b]);
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const MAX_RESPONSE_BYTES = 96 * 1024 * 1024;
const MAX_RESPONSE_IMAGES = 64;
const MAX_ZIP_ENTRIES = 1024;

export function sniffImageFormat(buffer: Buffer): Pick<UnpackedImage, 'ext' | 'mimeType'> | undefined {
  if (buffer.subarray(0, 4).equals(PNG_MAGIC)) return { ext: 'png', mimeType: 'image/png' };
  if (buffer.subarray(0, 3).equals(JPEG_MAGIC)) return { ext: 'jpg', mimeType: 'image/jpeg' };
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    return { ext: 'webp', mimeType: 'image/webp' };
  }
  return undefined;
}

export function decodeBase64(value: string, byteLimit: number): Buffer {
  if (value.length > Math.ceil(byteLimit / 3) * 4) throw new Error('Base64 图像超过大小限制');
  const firstPadding = value.indexOf('=');
  const dataLength = firstPadding < 0 ? value.length : firstPadding;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || dataLength % 4 === 1 ||
      (firstPadding >= 0 && value.length % 4 !== 0)) {
    throw new Error('图像 Base64 编码无效');
  }
  if (Math.floor(dataLength * 3 / 4) > byteLimit) throw new Error('Base64 图像超过大小限制');
  return Buffer.from(value, 'base64');
}

function magicBytes(buffer: Buffer): string {
  return buffer.subarray(0, 8).toString('hex') || 'empty';
}

function unpackImage(buffer: Buffer): UnpackedImage {
  const format = sniffImageFormat(buffer);
  if (!format) throw new Error(`无法识别图像格式（magic bytes: ${magicBytes(buffer)}）`);
  return { buffer, ...format };
}

function unpackJson(buffer: Buffer): UnpackedImage[] {
  let response: { images?: Array<{ image?: unknown; index?: unknown; seed?: unknown }> };
  try {
    response = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`NovelAI 图像响应不是有效 JSON（magic bytes: ${magicBytes(buffer)}）`, { cause: error });
  }
  if (!Array.isArray(response?.images) || response.images.length === 0) {
    throw new Error('NovelAI JSON 响应缺少图像');
  }
  if (response.images.length > MAX_RESPONSE_IMAGES) throw new Error('NovelAI JSON 响应的图像数量过多');
  let remaining = MAX_RESPONSE_BYTES;
  return response.images.map(item => {
    if (typeof item?.image !== 'string') throw new Error('NovelAI JSON 响应缺少 Base64 图像');
    const image = unpackImage(decodeBase64(item.image, remaining));
    remaining -= image.buffer.length;
    if (typeof item.index === 'number' && Number.isSafeInteger(item.index)) image.index = item.index;
    if (typeof item.seed === 'number' && Number.isSafeInteger(item.seed)) image.seed = item.seed;
    return image;
  });
}

function unpackZip(buffer: Buffer): UnpackedImage[] {
  const zip = new AdmZip(buffer);
  if (zip.getEntryCount() > MAX_ZIP_ENTRIES) throw new Error('NovelAI ZIP 响应的条目数量过多');
  const entries = zip.getEntries()
    .filter(entry => !entry.isDirectory && /\.(png|webp|jpe?g)$/i.test(entry.entryName))
    .sort((a, b) => a.entryName < b.entryName ? -1 : Number(a.entryName > b.entryName));
  if (!entries.length) throw new Error('NovelAI ZIP 响应中没有图像条目');
  if (entries.length > MAX_RESPONSE_IMAGES) throw new Error('NovelAI ZIP 响应的图像数量过多');
  let remaining = MAX_RESPONSE_BYTES;
  return entries.map(entry => {
    if (!Number.isSafeInteger(entry.header.size) || entry.header.size < 0 ||
        entry.header.size > remaining || entry.header.compressedSize > buffer.length) {
      throw new Error('NovelAI ZIP 图像超过解压大小限制');
    }
    const data = entry.getData();
    if (data.length !== entry.header.size || data.length > remaining) {
      throw new Error('NovelAI ZIP 图像的实际大小与声明不符');
    }
    remaining -= data.length;
    return { ...unpackImage(data), filename: entry.entryName };
  });
}

export function unpackImageResponse(buffer: Buffer, contentType?: string): UnpackedImage[] {
  if (buffer.length > MAX_RESPONSE_BYTES) throw new Error('NovelAI 图像响应超过大小限制');
  let first = buffer.subarray(0, 3).equals(UTF8_BOM) ? 3 : 0;
  while (first < buffer.length) {
    const byte = buffer[first];
    if (byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32) break;
    first++;
  }
  if (contentType?.toLowerCase().includes('application/json') || buffer[first] === 0x7b) return unpackJson(buffer);
  if (buffer.subarray(0, 2).equals(ZIP_MAGIC)) return unpackZip(buffer);
  return [unpackImage(buffer)];
}
