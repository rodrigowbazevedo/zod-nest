import type { z } from 'zod';
import type { BaseFileOptions } from '../multipart/build-file-schema.js';
import type { FileAccessors } from '../multipart/file-checks.js';

import { buildFileSchema } from '../multipart/build-file-schema.js';
import { MultipartFilesIn } from '../multipart/metadata.js';
import { createZodMultipart } from '../multipart/zod-multipart.decorator.js';

/**
 * Shape multer hands you under **memory storage** (`FileInterceptor`'s
 * default). `buffer` holds the whole file; there is no `path`.
 */
export interface MulterMemoryFileLike {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Shape multer hands you under **disk storage**. The bytes are on disk at
 * `path`; there is no `buffer`, so byte-level validation isn't possible.
 */
export interface MulterDiskFileLike {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
}

/**
 * Options for the multer file helpers. `maxSize` is checked against multer's
 * reported `size` **after** the file has been read — it documents the limit
 * and adds defence in depth, but the guard that actually stops a large upload
 * is multer's own `limits.fileSize`.
 *
 * `mimeTypes` and `extensions` match the client-supplied values. They are not
 * content sniffing; use `@nestjs/common`'s `FileTypeValidator` when you need
 * magic-number checks.
 */
export interface MulterFileOptions extends BaseFileOptions {
  readonly maxSize?: number;
}

const hasCommonFields = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  'mimetype' in value &&
  'originalname' in value &&
  'size' in value;

const isMulterMemoryFile = (value: unknown): boolean =>
  hasCommonFields(value) && Buffer.isBuffer(value.buffer);

const isMulterDiskFile = (value: unknown): boolean =>
  hasCommonFields(value) && typeof value.path === 'string';

const memoryAccessors: FileAccessors<MulterMemoryFileLike> = {
  mimeType: (file) => file.mimetype,
  fileName: (file) => file.originalname,
  size: (file) => file.size,
};

const diskAccessors: FileAccessors<MulterDiskFileLike> = {
  mimeType: (file) => file.mimetype,
  fileName: (file) => file.originalname,
  size: (file) => file.size,
};

/** Multer memory-storage file, constrained by `options` and emitted as `format: 'binary'`. */
export const multerMemoryFile = (
  options?: MulterFileOptions,
): z.ZodType<MulterMemoryFileLike, MulterMemoryFileLike> =>
  buildFileSchema<MulterMemoryFileLike>({
    predicate: isMulterMemoryFile,
    accessors: memoryAccessors,
    options,
    ...(options?.maxSize !== undefined ? { maxSize: options.maxSize } : {}),
  });

/** Multer disk-storage file, constrained by `options` and emitted as `format: 'binary'`. */
export const multerDiskFile = (
  options?: MulterFileOptions,
): z.ZodType<MulterDiskFileLike, MulterDiskFileLike> =>
  buildFileSchema<MulterDiskFileLike>({
    predicate: isMulterDiskFile,
    accessors: diskAccessors,
    options,
    ...(options?.maxSize !== undefined ? { maxSize: options.maxSize } : {}),
  });

/** Unconstrained {@link multerMemoryFile}, for shapes that need no per-field checks. */
export const MulterMemoryFileSchema = multerMemoryFile();

/** Unconstrained {@link multerDiskFile}, for shapes that need no per-field checks. */
export const MulterDiskFileSchema = multerDiskFile();

/**
 * Declares an endpoint's whole `multipart/form-data` body. Emits the flat
 * inline `requestBody` Swagger UI's try-it-out form needs, sets
 * `multipart/form-data` as the consumed type, and is the schema source for
 * `@ZodUploadedFile` / `@ZodUploadedFiles` / `@ZodMultipartBody`.
 */
export const ZodMultipart = createZodMultipart(MultipartFilesIn.Request);

export {
  ZodMultipartBody,
  ZodUploadedFile,
  ZodUploadedFiles,
} from '../multipart/param-decorators.js';
export { MULTIPART_CONTENT_TYPE } from '../multipart/zod-multipart.decorator.js';
export type { ZodMultipartOptions } from '../multipart/zod-multipart.decorator.js';
export type { MultipartShape } from '../multipart/metadata.js';
