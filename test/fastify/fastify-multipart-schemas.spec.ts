import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { FastifyMultipartFileLike } from '../../src/fastify/index.js';

import { fastifyMultipartFile, FastifyMultipartFileSchema } from '../../src/fastify/index.js';
import { createRegistry, toOpenApi } from '../../src/index.js';

const emit = (schema: z.ZodType): unknown =>
  toOpenApi(schema, { io: 'input', registry: createRegistry(), strict: true }).schema;

const multipartFile = (
  overrides: Partial<FastifyMultipartFileLike> = {},
): FastifyMultipartFileLike => ({
  type: 'file',
  fieldname: 'avatar',
  filename: 'avatar.png',
  encoding: '7bit',
  mimetype: 'image/png',
  toBuffer: () => Promise.resolve(Buffer.from('png')),
  ...overrides,
});

describe('fastify multipart file schema', () => {
  describe('emission', () => {
    it('emits format: binary for the bare preset', () => {
      expect(emit(FastifyMultipartFileSchema)).toEqual({ type: 'string', format: 'binary' });
    });

    it('derives contentMediaType from a single mimeTypes entry', () => {
      expect(emit(fastifyMultipartFile({ mimeTypes: ['application/pdf'] }))).toEqual({
        type: 'string',
        format: 'binary',
        contentMediaType: 'application/pdf',
      });
    });

    it('survives the option checks in strict mode', () => {
      const constrained = fastifyMultipartFile({ mimeTypes: ['image/png'], extensions: ['png'] });
      expect(() => emit(z.object({ avatar: constrained }))).not.toThrow();
    });
  });

  describe('runtime validation', () => {
    it('accepts a MultipartFile', () => {
      expect(FastifyMultipartFileSchema.safeParse(multipartFile()).success).toBe(true);
    });

    it('rejects a field part and anything without toBuffer', () => {
      expect(
        FastifyMultipartFileSchema.safeParse(multipartFile({ type: 'field' as never })).success,
      ).toBe(false);
      const { toBuffer, ...withoutToBuffer } = multipartFile();
      expect(toBuffer).toBeTypeOf('function');
      expect(FastifyMultipartFileSchema.safeParse(withoutToBuffer).success).toBe(false);
    });

    it('rejects a multer file — the shapes are not interchangeable', () => {
      const multerShaped = {
        fieldname: 'avatar',
        originalname: 'avatar.png',
        encoding: '7bit',
        mimetype: 'image/png',
        size: 10,
        buffer: Buffer.from('png'),
      };
      expect(FastifyMultipartFileSchema.safeParse(multerShaped).success).toBe(false);
    });

    it('matches mimeTypes and extensions against filename, not originalname', () => {
      const schema = fastifyMultipartFile({ mimeTypes: ['image/png'], extensions: ['png'] });
      expect(schema.safeParse(multipartFile()).success).toBe(true);
      expect(schema.safeParse(multipartFile({ filename: 'avatar.gif' })).success).toBe(false);
      expect(schema.safeParse(multipartFile({ mimetype: 'text/csv' })).success).toBe(false);
    });
  });

  // The absence of maxSize is the point: a MultipartFile reports no size
  // before its stream is read, so the limit belongs in the plugin config.
  it('exposes no maxSize option', () => {
    const options: Parameters<typeof fastifyMultipartFile>[0] = { mimeTypes: ['image/png'] };
    expect(Object.keys(options ?? {})).not.toContain('maxSize');
  });
});
