import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import {
  ARCHIVE_ID_REGEX,
  extractArchiveId,
  getArchivedImageMetadata,
  listArchivedImages,
  loadArchivedImage,
  saveArchivedImage,
  saveImage,
} from '../dist/image-archive.js';
import {
  bucketPreciseReferenceImage,
  extractPngTextMetadata,
  fitImageToMaxPixels,
  generateMaskFromRegions,
  getImageDimensions,
  isPrivateOrReservedIp,
  prepareImg2ImgImage,
  prepareInpaintMask,
  preparePreciseReferenceImage,
  prepareV3VibeImage,
  resolveImageInput,
} from '../dist/image-input.js';
import { unpackImageResponse } from '../dist/response-unpack.js';

function image(width, height, background = '#c03c00') {
  return sharp({ create: { width, height, channels: 3, background } });
}

async function tempArchive(t) {
  const directory = await mkdtemp(join(tmpdir(), 'novelai-images-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('响应解包根据实际字节识别裸 PNG、WebP、JPEG 及带种子的 JSON', async () => {
  const png = await image(24, 16).png().toBuffer();
  const webp = await image(24, 16).webp().toBuffer();
  const jpg = await image(24, 16).jpeg().toBuffer();
  for (const [buffer, ext, mimeType] of [
    [png, 'png', 'image/png'],
    [webp, 'webp', 'image/webp'],
    [jpg, 'jpg', 'image/jpeg'],
  ]) {
    assert.deepEqual(unpackImageResponse(buffer), [{ buffer, ext, mimeType }]);
  }
  const json = Buffer.from(JSON.stringify({
    images: [{ image: webp.toString('base64'), index: 2, seed: 41 }, { image: jpg.toString('base64') }],
  }));
  assert.deepEqual(unpackImageResponse(json, 'application/json; charset=utf-8'), [
    { buffer: webp, ext: 'webp', mimeType: 'image/webp', index: 2, seed: 41 },
    { buffer: jpg, ext: 'jpg', mimeType: 'image/jpeg' },
  ]);
  assert.deepEqual(unpackImageResponse(json), unpackImageResponse(json, 'application/json'));
  assert.throws(() => unpackImageResponse(Buffer.from('oops')), /magic bytes.*6f6f7073/i);
  assert.throws(() => unpackImageResponse(Buffer.from('{"images":[{"image":"AAAA"}]}')), /magic bytes/i);
});

test('ZIP 返回全部非目录影像且以条目路径排序，媒体类型由字节决定', async () => {
  const png = await image(16, 16).png().toBuffer();
  const webp = await image(16, 16).webp().toBuffer();
  const jpg = await image(16, 16).jpeg().toBuffer();
  const zip = new AdmZip();
  zip.addFile('sub/3.png', png);
  zip.addFile('1.png', webp);
  zip.addFile('doc.txt', Buffer.from('忽略文本'));
  zip.addFile('2.JPEG', jpg);
  const images = unpackImageResponse(zip.toBuffer());
  assert.deepEqual(images.map(item => item.filename), ['1.png', '2.JPEG', 'sub/3.png']);
  assert.deepEqual(images.map(item => item.buffer), [webp, jpg, png]);
  assert.deepEqual(images.map(item => item.ext), ['webp', 'jpg', 'png']);
  const empty = new AdmZip();
  empty.addFile('readme.txt', Buffer.from('无图像'));
  assert.throws(() => unpackImageResponse(empty.toBuffer()), /图像/);
});

test('归档保留 v1 PNG，v2 WebP 和 JPEG 按真实格式读写并按时间列出', async t => {
  const directory = await tempArchive(t);
  const png = await image(32, 32).png().toBuffer();
  const webp = await image(32, 32).webp().toBuffer();
  const jpg = await image(32, 32).jpeg().toBuffer();
  const oldId = await saveImage(directory, png, {
    prompt: '旧图片', model: 'nai-diffusion-5-curated', width: 32, height: 32, seed: 42,
  });
  const v1Directory = join(directory, oldId);
  assert.deepEqual((await readdir(v1Directory)).sort(), ['image.png', 'metadata.json']);
  const oldMetadata = await getArchivedImageMetadata(directory, oldId);
  assert.equal(oldMetadata.schema_version, 1);
  assert.equal(oldMetadata.seed, 42);
  assert.deepEqual((await loadArchivedImage(directory, oldId)).buffer, png);
  await writeFile(join(v1Directory, 'metadata.json'), JSON.stringify({
    ...oldMetadata, created_at: '2000-01-01T00:00:00.000Z',
  }));

  const savedWebp = await saveArchivedImage(directory, webp, {
    tool: 'generate_image', action: 'generate', width: 32, height: 32, seed: 43, prompt_preview: '新图片',
  });
  const savedJpg = await saveArchivedImage(directory, jpg, {
    tool: 'augment_image', action: 'lineart', width: 32, height: 32,
  });
  assert.match(savedWebp.id, ARCHIVE_ID_REGEX);
  assert.equal(savedWebp.filename, `${savedWebp.id}.webp`);
  assert.equal(savedJpg.filename, `${savedJpg.id}.jpg`);
  const loaded = await loadArchivedImage(directory, savedWebp.id);
  assert.deepEqual(loaded.buffer, webp);
  assert.equal(loaded.mimeType, 'image/webp');
  assert.equal(loaded.metadata.ext, 'webp');
  assert.equal(loaded.metadata.size_bytes, webp.length);
  assert.equal(loaded.metadata.schema_version, 2);
  assert.equal(loaded.metadata.prompt_preview, '新图片');
  for (const file of ['image.webp', 'metadata.json']) {
    assert.equal((await stat(join(directory, savedWebp.id, file))).mode & 0o777, 0o600);
  }

  const metadataPath = join(directory, savedJpg.id, 'metadata.json');
  const jpgMetadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  await writeFile(metadataPath, JSON.stringify({
    ...jpgMetadata, ext: 'webp', created_at: '2099-11-21T00:00:00.000Z',
  }));
  assert.deepEqual((await loadArchivedImage(directory, savedJpg.id)).buffer, jpg);
  await mkdir(join(directory, '.pending-test'));
  await mkdir(join(directory, '.vibe-cache'));
  await symlink(v1Directory, join(directory, 'A'.repeat(43)), 'dir');
  assert.deepEqual((await listArchivedImages(directory, 2)).map(item => item.id), [savedJpg.id, savedWebp.id]);
  await assert.rejects(loadArchivedImage(directory, '../image.png'), /归档.*ID/);
  await assert.rejects(loadArchivedImage(directory, 'A'.repeat(43)), { code: 'ENOENT' });
});

test('本站链接和裸 ID 直接读磁盘，纯 Base64、数据链接、stdio 路径和 GIF 均可导入', async t => {
  const directory = await tempArchive(t);
  const png = await image(16, 16).png().toBuffer();
  const gif = await image(16, 16).gif().toBuffer();
  const saved = await saveArchivedImage(directory, png, { tool: 'generate_image', action: 'generate' });
  const origin = new URL('https://images.invalid/');
  const url = `${origin.origin}/novelai-images/${saved.filename}`;
  assert.equal(extractArchiveId(saved.id), saved.id);
  assert.equal(extractArchiveId(url, origin), saved.id);
  assert.equal(extractArchiveId(`${url}?q=1`, origin), null);
  assert.equal(extractArchiveId(url.replace('images.invalid', 'other.invalid'), origin), null);
  assert.equal(extractArchiveId(`${origin.origin}/extra/../novelai-images/${saved.filename}`, origin), null);
  assert.deepEqual(await resolveImageInput(url, { archiveDir: directory, imageOrigin: origin }), png);
  assert.deepEqual(await resolveImageInput(saved.id, { archiveDir: directory }), png);
  assert.deepEqual(await resolveImageInput(png.toString('base64'), {}), png);
  assert.deepEqual(await resolveImageInput(`data:image/gif;base64,${gif.toString('base64')}`, {}), gif);
  assert.deepEqual(await resolveImageInput(gif.toString('base64').replace(/=+$/, ''), {}), gif);
  const path = join(directory, 'source.png');
  await writeFile(path, png);
  assert.deepEqual(await resolveImageInput(path, { allowLocalFiles: true }), png);
  await assert.rejects(resolveImageInput(path, {}), /本地文件/);
  await assert.rejects(resolveImageInput(`file://${path}`, { allowLocalFiles: true }), /HTTPS/i);
  await assert.rejects(resolveImageInput('data:image/png;base64,@@@', {}), /Base64/i);
  await assert.rejects(resolveImageInput(`data:image/png;base64,${png.toString('base64')}****`, {}), /Base64/i);
});

test('HTTPS 入口拒绝私有、保留、回环及映射地址', async () => {
  const blocked = [
    '0.0.0.0', '10.20.38.2', '100.127.0.8', '127.1.2.3', '169.254.169.254', '172.31.9.9',
    '192.0.2.1', '192.168.1.2', '198.18.0.1', '198.51.100.10', '203.0.113.10', '224.0.0.1',
    '240.0.0.0', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:a00:1',
    'fc00::1', 'fd00:ec2::254', 'fe80::1', 'ff02::1', '2001:db8::2', '2002:7f00:1::', '3fff::1',
  ];
  for (const ip of blocked) assert.equal(isPrivateOrReservedIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888']) {
    assert.equal(isPrivateOrReservedIp(ip), false, ip);
  }
  for (const host of ['127.0.0.1', '127.1', '[::1]', '[::ffff:127.0.0.1]']) {
    await assert.rejects(resolveImageInput(`https://${host}/image.png`, {}), /公网|保留/);
  }
  await assert.rejects(resolveImageInput('http://8.8.8.8/a.png', {}), /HTTPS/i);
  await assert.rejects(resolveImageInput('https://person:password@8.8.8.8/a.png', {}), /凭据/);
});

test('Sharp 图像预处理输出正确像素，参考图居中并以不透明黑色填充', async () => {
  const source = await image(48, 36).webp({ lossless: true }).toBuffer();
  const png = await prepareImg2ImgImage(source, 48, 36);
  assert.deepEqual(await getImageDimensions(png), { width: 48, height: 36, format: 'png' });
  for (const [width, height, expectedWidth, expectedHeight] of [
    [40, 87, 1024, 1536], [87, 40, 1536, 1024], [48, 48, 1472, 1472],
  ]) {
    const colored = await image(width, height).png().toBuffer();
    const precise = await preparePreciseReferenceImage(colored);
    assert.deepEqual(await getImageDimensions(precise), { width: expectedWidth, height: expectedHeight, format: 'png' });
    const metadata = await sharp(precise).metadata();
    assert.equal(metadata.hasAlpha, false);
    if (width !== height) {
      const pixel = await sharp(precise).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
      assert.deepEqual([...pixel], [0, 0, 0]);
    }
  }
  const transparent = await sharp({
    create: { width: 40, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
  const vibe = await prepareV3VibeImage(transparent);
  assert.deepEqual(await getImageDimensions(vibe), { width: 448, height: 448, format: 'png' });
  assert.deepEqual(await sharp(vibe).stats().then(stats => stats.channels.map(channel => channel.max)), [0, 0, 0]);
});

test('V5 精确参考按对数宽高比选档，覆盖方图、横竖图和比例两端', async () => {
  for (const [width, height, bucketWidth, bucketHeight] of [
    [48, 48, 1024, 1024],
    [40, 80, 704, 1408],
    [80, 40, 1408, 704],
    [2, 49, 256, 4096],
    [49, 2, 4096, 256],
    [1, 8000, 256, 4096],
    [87, 1000, 320, 3264], // 线性宽高比会选 256×3328。
  ]) {
    const input = await image(width, height).webp({ lossless: true }).toBuffer();
    const output = await bucketPreciseReferenceImage(input);
    assert.deepEqual(await getImageDimensions(output), { width: bucketWidth, height: bucketHeight, format: 'png' });
  }
  // EXIF Orientation=6 的横存竖显 JPEG 应按旋转后竖图选档并剥离 EXIF
  const exifRotated = await image(80, 40).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotatedOut = await bucketPreciseReferenceImage(exifRotated);
  assert.deepEqual(await getImageDimensions(rotatedOut), { width: 704, height: 1408, format: 'png' });
  assert.equal((await sharp(rotatedOut).metadata()).orientation, undefined);
});

test('V5 精确参考等比放大后居中裁剪，奇数余量向下取整并保留透明像素', async () => {
  for (const [width, height, resizeWidth, resizeHeight, left, top] of [
    [78, 75, 1065, 1024, 20, 0],
    [75, 78, 1024, 1065, 0, 20],
  ]) {
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = x < width / 3 ? 0 : x < 2 * width / 3 ? 128 : 255;
        pixels.set([x * 3, y * 3, 120, alpha], (y * width + x) * 4);
      }
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const output = await preparePreciseReferenceImage(input, 'bucket');
    assert.deepEqual(await getImageDimensions(output), { width: 1024, height: 1024, format: 'png' });
    const expected = await sharp(input).resize(resizeWidth, resizeHeight, { fit: 'fill' })
      .extract({ left, top, width: 1024, height: 1024 }).raw().toBuffer();
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    assert.ok(data.equals(expected), `${width}×${height} 的裁剪位置应为 (${left}, ${top})`);
    assert.deepEqual([data[3], data[512 * 4 + 3], data[1023 * 4 + 3]], [0, 128, 255]);
  }
});

test('V5 精确参考尺寸命中分档时直传 PNG，其他格式只转 PNG', async () => {
  const png = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 45, g: 70, b: 90, alpha: 0.5 } },
  }).png().toBuffer();
  assert.strictEqual(await bucketPreciseReferenceImage(png), png);

  const webp = await sharp(png).webp({ lossless: true }).toBuffer();
  const output = await bucketPreciseReferenceImage(webp);
  assert.deepEqual(await getImageDimensions(output), { width: 1024, height: 1024, format: 'png' });
  const pixel = await sharp(output).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...pixel], [45, 70, 90, 128]);
});

async function assertMaskGrid(mask, width, height) {
  const data = await sharp(mask).toColourspace('b-w').raw().toBuffer();
  assert.equal(data.length, width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = data[y * width + x];
      assert.ok(color === 0 || color === 255);
      assert.equal(color, data[Math.floor(y / 8) * 8 * width + Math.floor(x / 8) * 8]);
    }
  }
  return (x, y) => data[y * width + x];
}

test('区域蒙版和原图蒙版均为二值 8×8 块，椭圆的四角保持黑色', async () => {
  const regions = await generateMaskFromRegions(64, 64, [{ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }]);
  const regionPixel = await assertMaskGrid(regions, 64, 64);
  assert.equal(regionPixel(16, 16), 255);
  assert.equal(regionPixel(15, 16), 0);
  assert.equal(regionPixel(48, 47), 0);

  const ellipse = await generateMaskFromRegions(64, 64, [{ shape: 'ellipse', x: 0, y: 0, width: 1, height: 1 }]);
  const ellipsePixel = await assertMaskGrid(ellipse, 64, 64);
  assert.equal(ellipsePixel(0, 0), 0);
  assert.equal(ellipsePixel(33, 33), 255);

  const grayscale = Buffer.alloc(30 * 34, 127);
  for (let y = 0; y < 34; y++) grayscale.fill(128, 15 + y * 30, 30 + y * 30);
  const source = await sharp(grayscale, { raw: { width: 30, height: 34, channels: 1 } }).png().toBuffer();
  const imagePixel = await assertMaskGrid(await prepareInpaintMask(source, 64, 72), 64, 72);
  assert.equal(imagePixel(0, 0), 0);
  assert.equal(imagePixel(63, 71), 255);
  await assert.rejects(generateMaskFromRegions(63, 64, []), /8/);
});

test('缩放图像满足 1 MP 上限与 8 像素对齐，阈值内维持原始宽高', async () => {
  const source = await image(2100, 1200).webp().toBuffer();
  const resized = await fitImageToMaxPixels(source);
  assert.ok(resized.width * resized.height <= 1048576);
  assert.equal(resized.width % 8, 0);
  assert.equal(resized.height % 8, 0);
  assert.ok(Math.abs(resized.width / resized.height - 1.75) < 0.03);
  assert.deepEqual(await getImageDimensions(resized.buffer), { width: resized.width, height: resized.height, format: 'png' });

  const small = await fitImageToMaxPixels(await image(13, 15).webp().toBuffer());
  assert.deepEqual(await getImageDimensions(small.buffer), { width: 13, height: 15, format: 'png' });
  const extreme = await fitImageToMaxPixels(await image(20_000, 20).png().toBuffer(), 4096);
  assert.ok(extreme.width * extreme.height <= 4096);
  assert.equal(extreme.height, 8);
});

test('PNG 文本解析支持 tEXt、UTF-8 iTXt、压缩 iTXt 和 Comment JSON', async () => {
  function chunk(type, text) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(text.length);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(text, crc32(head.subarray(4))));
    return Buffer.concat([head, text, crc]);
  }
  const png = await image(16, 16).png().toBuffer();
  const withText = Buffer.concat([
    png.subarray(0, -12),
    chunk('tEXt', Buffer.from('Software\0NovelAI')),
    chunk('iTXt', Buffer.from('Description\0\0\0\0\0蓝色的鸟')),
    chunk('iTXt', Buffer.concat([Buffer.from('Comment\0\x01\0\0\0'), deflateSync('{"seed":845,"steps":23}')])),
    png.subarray(-12),
  ]);
  assert.deepEqual(extractPngTextMetadata(withText), {
    Software: 'NovelAI', Description: '蓝色的鸟', Comment: { seed: 845, steps: 23 },
  });
  assert.deepEqual(extractPngTextMetadata(Buffer.from('a')), {});
});
