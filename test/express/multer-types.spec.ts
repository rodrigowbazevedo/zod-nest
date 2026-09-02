/// <reference types="multer" />
// tsconfig pins `types` to node + vitest, so multer's global Express
// augmentation needs an explicit reference here.
import { describe, expect, it } from 'vitest';

import type { MulterDiskFileLike, MulterMemoryFileLike } from '../../src/express/index.js';

/**
 * Compile-time guard: multer's own `Express.Multer.File` must stay assignable
 * to the structural shapes this library declares. `@types/multer` is a devDep
 * for this assertion only — the runtime helpers duck-type and take no
 * dependency on it.
 *
 * A multer type change that drops or renames a field breaks `npm run typecheck`
 * here rather than in a consumer's build.
 */
describe('multer type compatibility', () => {
  it('accepts Express.Multer.File as both storage shapes', () => {
    const file: Express.Multer.File = {
      fieldname: 'avatar',
      originalname: 'avatar.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: 1024,
      stream: undefined as never,
      destination: '/tmp',
      filename: 'abc123',
      path: '/tmp/abc123',
      buffer: Buffer.from('png'),
    };

    const memory: MulterMemoryFileLike = file;
    const disk: MulterDiskFileLike = file;

    expect(memory.originalname).toBe('avatar.png');
    expect(disk.path).toBe('/tmp/abc123');
  });
});
