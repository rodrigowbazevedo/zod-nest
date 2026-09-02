import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ExecutionContext } from '@nestjs/common';
import type { MulterMemoryFileLike } from '../../src/express/index.js';

import { multerMemoryFile } from '../../src/express/index.js';
import { ZodValidationException } from '../../src/index.js';
import { ZOD_MULTIPART_METADATA_KEY } from '../../src/multipart/metadata.js';
import {
  resolveMultipartBody,
  resolveUploadedFile,
  resolveUploadedFiles,
} from '../../src/multipart/param-decorators.js';
import { createZodMultipart } from '../../src/multipart/zod-multipart.decorator.js';

const ZodMultipartExpress = createZodMultipart('request');
const ZodMultipartFastify = createZodMultipart('body');

const memoryFile = (overrides: Partial<MulterMemoryFileLike> = {}): MulterMemoryFileLike => ({
  fieldname: 'avatar',
  originalname: 'avatar.png',
  encoding: '7bit',
  mimetype: 'image/png',
  size: 1024,
  buffer: Buffer.from('png'),
  ...overrides,
});

interface FakeRequest {
  file?: unknown;
  files?: unknown;
  body?: unknown;
}

const makeContext = (handler: () => void, request: FakeRequest): ExecutionContext =>
  ({
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

/** Applies a `@ZodMultipart` decorator to a bare handler and returns it. */
const decorate = (
  decorator: MethodDecorator,
  handler: () => void = () => {
    /* noop */
  },
): (() => void) => {
  const descriptor: TypedPropertyDescriptor<unknown> = { value: handler };
  decorator({}, 'upload', descriptor);
  return handler;
};

describe('multipart param decorators', () => {
  const shape = {
    avatar: multerMemoryFile({ mimeTypes: ['image/png'] }),
    name: z.string(),
    age: z.coerce.number(),
  };

  describe('@ZodUploadedFile', () => {
    it('validates req.file against the named shape property', async () => {
      const handler = decorate(ZodMultipartExpress(shape));
      const file = memoryFile();
      await expect(resolveUploadedFile('avatar', makeContext(handler, { file }))).resolves.toEqual(
        file,
      );
    });

    it('throws ZodValidationException when the file fails its checks', async () => {
      const handler = decorate(ZodMultipartExpress(shape));
      const ctx = makeContext(handler, { file: memoryFile({ mimetype: 'text/csv' }) });
      await expect(resolveUploadedFile('avatar', ctx)).rejects.toBeInstanceOf(
        ZodValidationException,
      );
    });

    it('throws when req.file is absent', async () => {
      const handler = decorate(ZodMultipartExpress(shape));
      await expect(resolveUploadedFile('avatar', makeContext(handler, {}))).rejects.toBeInstanceOf(
        ZodValidationException,
      );
    });

    it('names the declared properties when the field is unknown', async () => {
      const handler = decorate(ZodMultipartExpress(shape));
      await expect(
        resolveUploadedFile('missing', makeContext(handler, { file: memoryFile() })),
      ).rejects.toThrow(/no matching property .* Declared: avatar, name, age/);
    });

    it('requires @ZodMultipart on the handler', async () => {
      const bare = () => {
        /* noop */
      };
      await expect(
        resolveUploadedFile('avatar', makeContext(bare, { file: memoryFile() })),
      ).rejects.toThrow(/requires @ZodMultipart on the same handler/);
    });

    it('resolves undefined for an optional file field with no upload', async () => {
      const optionalShape = { avatar: multerMemoryFile().optional(), name: z.string() };
      const handler = decorate(ZodMultipartExpress(optionalShape));
      await expect(
        resolveUploadedFile('avatar', makeContext(handler, {})),
      ).resolves.toBeUndefined();
    });

    it('is unavailable under filesIn: body', async () => {
      const handler = decorate(ZodMultipartFastify(shape));
      await expect(
        resolveUploadedFile('avatar', makeContext(handler, { file: memoryFile() })),
      ).rejects.toThrow(/unavailable under filesIn: 'body'/);
    });
  });

  describe('@ZodUploadedFiles', () => {
    // FilesInterceptor / AnyFilesInterceptor hand back an array on req.files.
    it('validates an array against the named property', async () => {
      const arrayShape = { photos: z.array(multerMemoryFile()), name: z.string() };
      const handler = decorate(ZodMultipartExpress(arrayShape));
      const files = [memoryFile(), memoryFile()];
      await expect(
        resolveUploadedFiles('photos', makeContext(handler, { files })),
      ).resolves.toEqual(files);
    });

    // FileFieldsInterceptor hands back a record keyed by field name.
    it('validates the record of every file property when given no name', async () => {
      const fieldsShape = {
        avatar: z.array(multerMemoryFile()),
        banner: z.array(multerMemoryFile()),
        name: z.string(),
      };
      const handler = decorate(ZodMultipartExpress(fieldsShape));
      const files = { avatar: [memoryFile()], banner: [memoryFile({ fieldname: 'banner' })] };
      const resolved = await resolveUploadedFiles(undefined, makeContext(handler, { files }));
      expect(resolved).toEqual(files);
    });

    it('rejects a record missing a declared file field', async () => {
      const fieldsShape = {
        avatar: z.array(multerMemoryFile()),
        banner: z.array(multerMemoryFile()),
      };
      const handler = decorate(ZodMultipartExpress(fieldsShape));
      const ctx = makeContext(handler, { files: { avatar: [memoryFile()] } });
      await expect(resolveUploadedFiles(undefined, ctx)).rejects.toBeInstanceOf(
        ZodValidationException,
      );
    });
  });

  describe('@ZodMultipartBody', () => {
    it('validates only the text fields under filesIn: request', async () => {
      const handler = decorate(ZodMultipartExpress(shape));
      const ctx = makeContext(handler, { body: { name: 'Ada', age: '36' } });
      await expect(resolveMultipartBody(undefined, ctx)).resolves.toEqual({
        name: 'Ada',
        age: 36,
      });
    });

    it('validates the whole shape under filesIn: body', async () => {
      const handler = decorate(ZodMultipartFastify(shape));
      const file = memoryFile();
      const ctx = makeContext(handler, { body: { avatar: file, name: 'Ada', age: '36' } });
      await expect(resolveMultipartBody(undefined, ctx)).resolves.toEqual({
        avatar: file,
        name: 'Ada',
        age: 36,
      });
    });

    it('throws ZodValidationException on a bad text field', async () => {
      const handler = decorate(ZodMultipartExpress(shape));
      const ctx = makeContext(handler, { body: { name: 'Ada', age: 'not-a-number' } });
      await expect(resolveMultipartBody(undefined, ctx)).rejects.toBeInstanceOf(
        ZodValidationException,
      );
    });
  });

  describe('metadata', () => {
    it('partitions the shape into file and text keys', () => {
      const handler = decorate(ZodMultipartExpress(shape));
      const metadata: unknown = Reflect.getMetadata(ZOD_MULTIPART_METADATA_KEY, handler);
      expect(metadata).toMatchObject({
        fileKeys: ['avatar'],
        textKeys: ['name', 'age'],
        filesIn: 'request',
      });
    });

    it('treats optional and array file fields as file keys', () => {
      const wrapped = {
        avatar: multerMemoryFile().optional(),
        photos: z.array(multerMemoryFile()),
        name: z.string(),
      };
      const handler = decorate(ZodMultipartExpress(wrapped));
      const metadata: unknown = Reflect.getMetadata(ZOD_MULTIPART_METADATA_KEY, handler);
      expect(metadata).toMatchObject({ fileKeys: ['avatar', 'photos'], textKeys: ['name'] });
    });

    it('rejects application to a non-method', () => {
      expect(() => ZodMultipartExpress(shape)({}, 'upload', { value: 'not a function' })).toThrow(
        /can only be applied to methods/,
      );
    });
  });
});
