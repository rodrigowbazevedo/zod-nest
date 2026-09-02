import type { z } from 'zod';

/**
 * Where the multipart parser puts uploaded files. Multer leaves them on the
 * request (`req.file` / `req.files`) with only text fields in `req.body`;
 * `@fastify/multipart` with `attachFieldsToBody: true` puts everything in
 * `req.body`.
 */
export const MultipartFilesIn = {
  Request: 'request',
  Body: 'body',
} as const;

export type MultipartFilesIn = (typeof MultipartFilesIn)[keyof typeof MultipartFilesIn];

/** Shape accepted by `@ZodMultipart` — one Zod schema per form field. */
export type MultipartShape = Readonly<Record<string, z.ZodType>>;

export interface MultipartMetadata {
  readonly shape: MultipartShape;
  readonly fileKeys: readonly string[];
  readonly textKeys: readonly string[];
  readonly filesIn: MultipartFilesIn;
}

/**
 * Metadata key for the shape declared by `@ZodMultipart`. `Symbol.for` so
 * consumers in other realms read the same registry (CLAUDE.md).
 */
export const ZOD_MULTIPART_METADATA_KEY = Symbol.for('zod-nest.multipart');
