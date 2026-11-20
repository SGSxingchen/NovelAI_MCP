import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VibeCache, vibeCacheKey } from '../dist/vibe-cache.js';

const model = 'nai-diffusion-4-5-full';
const image = Buffer.from('image bytes');
const mask = Buffer.from('mask bytes');
const encoded = Buffer.from('encoded vibe').toString('base64');

test('Vibe 键使用原始图片字节、模型、四位提取比例和遮罩摘要', () => {
  const maskHash = createHash('sha256').update(mask).digest('hex');
  const expected = createHash('sha256').update(image).update(`|${model}|0.1235|${maskHash}`).digest('hex');
  assert.equal(vibeCacheKey(image, model, 0.12346, mask), expected);
  assert.equal(vibeCacheKey(image, model, 0.12349, mask), expected);
  assert.notEqual(vibeCacheKey(image, model, 0.12346, mask, true), expected);
  assert.notEqual(vibeCacheKey(image, model, 0.12346), expected);
});

test('并发编码去重，缓存文件跨实例读取，列表省略二进制数据', async t => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'nai-vibe-test-'));
  t.after(() => rm(archiveDir, { recursive: true, force: true }));
  const cache = new VibeCache(archiveDir);
  const key = vibeCacheKey(image, model, 0.5);
  let encodes = 0;
  const encode = async () => {
    encodes++;
    return encoded;
  };
  const [first, second] = await Promise.all([
    cache.getOrEncode(key, model, 0.5, encode),
    cache.getOrEncode(key, model, 0.5, encode),
  ]);
  assert.equal(encodes, 1);
  assert.deepEqual(first, second);
  assert.equal(first.id, `vibe_${key.slice(0, 16)}`);
  assert.equal(first.encoded_vibe, encoded);
  const filename = join(archiveDir, '.vibe-cache', `${first.id}.json`);
  if (process.platform !== 'win32') assert.equal((await stat(filename)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), first);

  const restarted = new VibeCache(archiveDir);
  assert.deepEqual(await restarted.getByHashKey(key), first);
  assert.deepEqual(await restarted.getById(first.id), first);
  assert.deepEqual(await restarted.getOrEncode(key, model, 0.5, encode), first);
  assert.equal(encodes, 1);
  const { encoded_vibe, ...summary } = first;
  assert.deepEqual(await restarted.list(), [summary]);
  assert.equal(await restarted.getById('../metadata'), undefined);

  await writeFile(filename, '{"encoded_vibe": false}');
  assert.equal(await new VibeCache(archiveDir).getById(first.id), undefined);
});

test('编码失败不缓存，后续请求可以重新编码', async () => {
  const cache = new VibeCache();
  const key = vibeCacheKey(image, model, 1);
  await assert.rejects(cache.getOrEncode(key, model, 1, async () => { throw new Error('编码失败'); }), /编码失败/);
  assert.equal(await cache.getByHashKey(key), undefined);
  assert.equal((await cache.getOrEncode(key, model, 1, async () => encoded)).encoded_vibe, encoded);
});
