import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { MulterDiskFileLike, MulterMemoryFileLike } from '../../src/express/index.js';

import {
  multerDiskFile,
  MulterDiskFileSchema,
  multerMemoryFile,
  MulterMemoryFileSchema,
} from '../../src/express/index.js';
import { createRegistry, toOpenApi } from '../../src/index.js';

const emit = (schema: z.ZodType): unknown =>
  toOpenApi(schema, { io: 'input', registry: createRegistry(), strict: true }).schema;

const memoryFile = (overrides: Partial<MulterMemoryFileLike> = {}): MulterMemoryFileLike => ({
  fieldname: 'avatar',
  originalname: 'avatar.png',
  encoding: '7bit',
  mimetype: 'image/png',
  size: 1024,
  buffer: Buffer.from('png'),
  ...overrides,
});

const diskFile = (overrides: Partial<MulterDiskFileLike> = {}): MulterDiskFileLike => ({
  fieldname: 'report',
  originalname: 'report.csv',
  encoding: '7bit',
  mimetype: 'text/csv',
  size: 2048,
  destination: '/tmp',
  filename: 'abc123',
  path: '/tmp/abc123',
  ...overrides,
});

describe('multer file schemas', () => {
  describe('emission', () => {
    it('emits format: binary for the bare presets', () => {
      expect(emit(MulterMemoryFileSchema)).toEqual({ type: 'string', format: 'binary' });
      expect(emit(MulterDiskFileSchema)).toEqual({ type: 'string', format: 'binary' });
    });

    it('derives contentMediaType from a single mimeTypes entry', () => {
      expect(emit(multerMemoryFile({ mimeTypes: ['image/png'] }))).toEqual({
        type: 'string',
        format: 'binary',
        contentMediaType: 'image/png',
      });
    });

    it('omits contentMediaType when several mimeTypes are allowed', () => {
      expect(emit(multerMemoryFile({ mimeTypes: ['image/png', 'image/jpeg'] }))).toEqual({
        type: 'string',
        format: 'binary',
      });
    });

    it('lets an explicit contentMediaType win over the derived one', () => {
      expect(
        emit(multerMemoryFile({ mimeTypes: ['image/png'], contentMediaType: 'image/*' })),
      ).toEqual({ type: 'string', format: 'binary', contentMediaType: 'image/*' });
    });

    // A named file schema gets a components.schemas entry that every field
    // $refs. Regression guard: `.meta()` clones, so the fragment has to be
    // re-registered on the renamed instance or the component emits empty.
    it('emits a reusable component when given an id', () => {
      const csv = multerMemoryFile({ mimeTypes: ['text/csv'], id: 'StoredCsv' });
      const registry = createRegistry();
      const { schema, refs } = toOpenApi(z.object({ candidate: csv, reference: csv }), {
        io: 'input',
        registry,
        strict: true,
      });
      expect(refs.get('StoredCsv')).toEqual({
        type: 'string',
        format: 'binary',
        contentMediaType: 'text/csv',
      });
      expect(schema).toMatchObject({
        properties: {
          candidate: { $ref: expect.stringContaining('StoredCsv') },
          reference: { $ref: expect.stringContaining('StoredCsv') },
        },
      });
    });

    // `overrideJSONSchema` replaces the emitted body outright, so there is no
    // `title` option — one would be silently discarded. `description` is
    // carried into the fragment and is the way to annotate a file field.
    it('inlines the fragment when no id is given', () => {
      const anonymous = multerMemoryFile({ mimeTypes: ['image/png'] });
      const { schema, refs } = toOpenApi(z.object({ avatar: anonymous }), {
        io: 'input',
        registry: createRegistry(),
        strict: true,
      });
      expect(refs.size).toBe(0);
      expect(schema.properties?.avatar).toEqual({
        type: 'string',
        format: 'binary',
        contentMediaType: 'image/png',
      });
    });

    it('still validates through the named instance', () => {
      const csv = multerMemoryFile({ mimeTypes: ['text/csv'], id: 'StoredCsvChecked' });
      expect(csv.safeParse(memoryFile({ mimetype: 'text/csv' })).success).toBe(true);
      expect(csv.safeParse(memoryFile({ mimetype: 'image/png' })).success).toBe(false);
    });

    it('carries the description onto the fragment', () => {
      expect(emit(multerMemoryFile({ description: 'Profile picture' }))).toEqual({
        type: 'string',
        format: 'binary',
        description: 'Profile picture',
      });
    });

    // Regression guard: `overrideJSONSchema` is instance-keyed and `.check()`
    // clones, so a constrained file must still emit binary rather than `{}`.
    it('survives the option checks in strict mode', () => {
      const constrained = multerMemoryFile({ maxSize: 10, mimeTypes: ['image/png'] });
      expect(() => emit(z.object({ avatar: constrained }))).not.toThrow();
    });

    it('emits inside arrays and optionals', () => {
      const file = multerMemoryFile();
      expect(emit(z.object({ photos: z.array(file) }))).toEqual({
        type: 'object',
        properties: { photos: { type: 'array', items: { type: 'string', format: 'binary' } } },
        required: ['photos'],
      });
      expect(emit(z.object({ avatar: file.optional() }))).toEqual({
        type: 'object',
        properties: { avatar: { type: 'string', format: 'binary' } },
      });
    });
  });

  describe('runtime validation', () => {
    it('accepts a memory-storage file and rejects a disk-storage one', () => {
      expect(MulterMemoryFileSchema.safeParse(memoryFile()).success).toBe(true);
      expect(MulterMemoryFileSchema.safeParse(diskFile()).success).toBe(false);
    });

    it('accepts a disk-storage file and rejects a memory-storage one', () => {
      expect(MulterDiskFileSchema.safeParse(diskFile()).success).toBe(true);
      expect(MulterDiskFileSchema.safeParse(memoryFile()).success).toBe(false);
    });

    it('applies the same option checks to disk-storage files', () => {
      const schema = multerDiskFile({
        maxSize: 4096,
        mimeTypes: ['text/csv'],
        extensions: ['csv'],
      });
      expect(schema.safeParse(diskFile()).success).toBe(true);
      expect(schema.safeParse(diskFile({ size: 4097 })).success).toBe(false);
      expect(schema.safeParse(diskFile({ mimetype: 'image/png' })).success).toBe(false);
      // The name checks read originalname, not the on-disk filename.
      expect(schema.safeParse(diskFile({ filename: 'no-extension' })).success).toBe(true);
      expect(schema.safeParse(diskFile({ originalname: 'report.txt' })).success).toBe(false);
    });

    it('enforces maxSize against multer’s reported size', () => {
      const schema = multerMemoryFile({ maxSize: 512 });
      expect(schema.safeParse(memoryFile({ size: 512 })).success).toBe(true);
      const tooBig = schema.safeParse(memoryFile({ size: 513 }));
      expect(tooBig.success).toBe(false);
      expect(tooBig.error?.issues[0]?.message).toBe('Expected at most 512 bytes, received 513');
    });

    it('enforces mimeTypes case-insensitively', () => {
      const schema = multerMemoryFile({ mimeTypes: ['image/png'] });
      expect(schema.safeParse(memoryFile({ mimetype: 'IMAGE/PNG' })).success).toBe(true);
      expect(schema.safeParse(memoryFile({ mimetype: 'text/csv' })).success).toBe(false);
    });

    it('enforces extensions with or without a leading dot', () => {
      const schema = multerMemoryFile({ extensions: ['png', '.jpeg'] });
      expect(schema.safeParse(memoryFile({ originalname: 'a.PNG' })).success).toBe(true);
      expect(schema.safeParse(memoryFile({ originalname: 'a.jpeg' })).success).toBe(true);
      expect(schema.safeParse(memoryFile({ originalname: 'a.gif' })).success).toBe(false);
    });

    // Zod stops at the first failing check, so a file breaking several
    // constraints reports only the first — mimeTypes, then extensions, then size.
    it('reports the first failing check', () => {
      const schema = multerMemoryFile({
        maxSize: 10,
        mimeTypes: ['image/png'],
        extensions: ['png'],
      });
      const result = schema.safeParse(
        memoryFile({ mimetype: 'text/csv', originalname: 'a.gif', size: 99 }),
      );
      expect(result.success).toBe(false);
      expect(result.error?.issues).toHaveLength(1);
      expect(result.error?.issues[0]?.message).toBe('Expected one of image/png, received text/csv');
    });

    it('rejects non-file values', () => {
      expect(MulterMemoryFileSchema.safeParse(undefined).success).toBe(false);
      expect(MulterMemoryFileSchema.safeParse('a string').success).toBe(false);
      expect(MulterMemoryFileSchema.safeParse({}).success).toBe(false);
    });
  });
});
