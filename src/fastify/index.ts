import type { z } from 'zod';
import type { BaseFileOptions } from '../multipart/build-file-schema.js';
import type { FileAccessors } from '../multipart/file-checks.js';

import { buildFileSchema } from '../multipart/build-file-schema.js';
import { MultipartFilesIn } from '../multipart/metadata.js';
import { createZodMultipart } from '../multipart/zod-multipart.decorator.js';

/**
 * Shape `@fastify/multipart` attaches to the body under
 * `attachFieldsToBody: true`. The bytes are still a stream — `toBuffer()`
 * reads them — so there is no `size` field to validate against.
 */
export interface FastifyMultipartFileLike {
  type: 'file';
  fieldname: string;
  filename: string;
  encoding: string;
  mimetype: string;
  toBuffer: () => Promise<Buffer>;
}

/**
 * Options for the `@fastify/multipart` file helper.
 *
 * There is deliberately no `maxSize`: a `MultipartFile` reports no size
 * before its stream is read, so the size limit belongs in the plugin's
 * `limits.fileSize`.
 *
 * `mimeTypes` and `extensions` match the client-supplied values. They are not
 * content sniffing; use `@nestjs/common`'s `FileTypeValidator` when you need
 * magic-number checks.
 */
export type FastifyMultipartFileOptions = BaseFileOptions;

const isFastifyMultipartFile = (value: unknown): boolean =>
  value !== null &&
  typeof value === 'object' &&
  'type' in value &&
  value.type === 'file' &&
  'mimetype' in value &&
  'filename' in value &&
  'toBuffer' in value &&
  typeof value.toBuffer === 'function';

const accessors: FileAccessors<FastifyMultipartFileLike> = {
  mimeType: (file) => file.mimetype,
  fileName: (file) => file.filename,
};

/** `@fastify/multipart` file, constrained by `options` and emitted as `format: 'binary'`. */
export const fastifyMultipartFile = (
  options?: FastifyMultipartFileOptions,
): z.ZodType<FastifyMultipartFileLike, FastifyMultipartFileLike> =>
  buildFileSchema<FastifyMultipartFileLike>({
    predicate: isFastifyMultipartFile,
    accessors,
    options,
  });

/** Unconstrained {@link fastifyMultipartFile}, for shapes that need no per-field checks. */
export const FastifyMultipartFileSchema = fastifyMultipartFile();

/**
 * Declares an endpoint's whole `multipart/form-data` body. Defaults to
 * `filesIn: 'body'` — register `@fastify/multipart` with
 * `attachFieldsToBody: true` so files arrive there alongside the text fields.
 *
 * There is no `@ZodUploadedFile` on this entry point: with the files in the
 * body, `@ZodMultipartBody()` already covers them.
 */
export const ZodMultipart = createZodMultipart(MultipartFilesIn.Body);

export { ZodMultipartBody } from '../multipart/param-decorators.js';
export { MULTIPART_CONTENT_TYPE } from '../multipart/zod-multipart.decorator.js';
export type { ZodMultipartOptions } from '../multipart/zod-multipart.decorator.js';
export type { MultipartShape } from '../multipart/metadata.js';
