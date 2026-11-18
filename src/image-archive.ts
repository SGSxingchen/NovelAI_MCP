import { randomBytes } from 'node:crypto';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageGenerationParams } from './types.js';

export async function saveImage(
  archiveDir: string,
  png: Buffer,
  params: ImageGenerationParams,
): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  const stagingDir = await mkdtemp(join(archiveDir, '.pending-'));
  const metadata = {
    schema_version: 1,
    id,
    created_at: new Date().toISOString(),
    model: params.model,
    width: params.width,
    height: params.height,
    seed: params.seed,
    mime_type: 'image/png',
    size_bytes: png.length,
  };

  try {
    await writeFile(join(stagingDir, 'image.png'), png, { mode: 0o600 });
    await writeFile(join(stagingDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', {
      mode: 0o600,
    });
    await rename(stagingDir, join(archiveDir, id));
    return id;
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
