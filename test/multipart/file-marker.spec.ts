import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { multerMemoryFile } from '../../src/express/index.js';
import { fastifyMultipartFile } from '../../src/fastify/index.js';
import { isFileSchema } from '../../src/multipart/file-marker.js';

describe('file schema marker', () => {
  const file = multerMemoryFile();

  // `@ZodMultipartBody()` splits a declared shape on this predicate, so a
  // wrapper it fails to see through would misroute a file field into the
  // text-only body and fail validation at request time.
  it.each([
    ['bare', file],
    ['optional', file.optional()],
    ['nullable', file.nullable()],
    ['readonly', file.readonly()],
    ['default', file.default(undefined as never)],
    ['array', z.array(file)],
    ['array of optional', z.array(file.optional())],
    ['optional array', z.array(file).optional()],
  ])('recognises a file schema through %s', (_label, schema) => {
    expect(isFileSchema(schema)).toBe(true);
  });

  it.each([
    ['string', z.string()],
    ['number', z.number()],
    ['optional string', z.string().optional()],
    ['array of strings', z.array(z.string())],
    ['object', z.object({ a: z.string() })],
  ])('does not mistake %s for a file schema', (_label, schema) => {
    expect(isFileSchema(schema)).toBe(false);
  });

  it('recognises the fastify file shape too', () => {
    expect(isFileSchema(fastifyMultipartFile())).toBe(true);
    expect(isFileSchema(z.array(fastifyMultipartFile().optional()))).toBe(true);
  });
});
