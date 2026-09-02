import { createParamDecorator } from '@nestjs/common';
import { z } from 'zod';

import type { ExecutionContext } from '@nestjs/common';
import type { MultipartMetadata, MultipartShape } from './metadata.js';

import { ZodValidationException } from '../exceptions/validation.exception.js';
import { MultipartFilesIn, ZOD_MULTIPART_METADATA_KEY } from './metadata.js';

type ArgType = 'body' | 'custom';

const readMetadata = (ctx: ExecutionContext, decorator: string): MultipartMetadata => {
  const metadata: unknown = Reflect.getMetadata(ZOD_MULTIPART_METADATA_KEY, ctx.getHandler());
  if (!isMultipartMetadata(metadata)) {
    throw new Error(
      `[zod-nest] ${decorator} requires @ZodMultipart on the same handler — it reads the declared shape from there.`,
    );
  }
  return metadata;
};

const isMultipartMetadata = (value: unknown): value is MultipartMetadata =>
  value !== null && typeof value === 'object' && 'shape' in value && 'filesIn' in value;

const schemaFor = (metadata: MultipartMetadata, name: string, decorator: string): z.ZodType => {
  const schema = metadata.shape[name];
  if (schema === undefined) {
    throw new Error(
      `[zod-nest] ${decorator}('${name}') has no matching property in the @ZodMultipart shape. Declared: ${Object.keys(metadata.shape).join(', ')}.`,
    );
  }
  return schema;
};

const pick = (shape: MultipartShape, keys: readonly string[]): z.ZodType => {
  const picked: Record<string, z.ZodType> = {};
  for (const key of keys) {
    const schema = shape[key];
    if (schema !== undefined) {
      picked[key] = schema;
    }
  }
  return z.object(picked);
};

const validate = async (schema: z.ZodType, value: unknown, argType: ArgType): Promise<unknown> => {
  const result = await schema.safeParseAsync(value);
  if (result.success) {
    return result.data;
  }
  throw new ZodValidationException(result.error, {
    type: argType,
    metatype: undefined,
    data: undefined,
  });
};

const assertFilesOnRequest = (metadata: MultipartMetadata, decorator: string): void => {
  if (metadata.filesIn === MultipartFilesIn.Request) {
    return;
  }
  throw new Error(
    `[zod-nest] ${decorator} is unavailable under filesIn: 'body' — the parser puts files in the request body, so read them with @ZodMultipartBody().`,
  );
};

export const resolveUploadedFile = async (
  name: string,
  ctx: ExecutionContext,
): Promise<unknown> => {
  const metadata = readMetadata(ctx, '@ZodUploadedFile');
  assertFilesOnRequest(metadata, '@ZodUploadedFile');
  const request: { file?: unknown } = ctx.switchToHttp().getRequest();
  return validate(schemaFor(metadata, name, '@ZodUploadedFile'), request.file, 'custom');
};

export const resolveUploadedFiles = async (
  name: string | undefined,
  ctx: ExecutionContext,
): Promise<unknown> => {
  const metadata = readMetadata(ctx, '@ZodUploadedFiles');
  assertFilesOnRequest(metadata, '@ZodUploadedFiles');
  const request: { files?: unknown } = ctx.switchToHttp().getRequest();
  const schema =
    name === undefined
      ? pick(metadata.shape, metadata.fileKeys)
      : schemaFor(metadata, name, '@ZodUploadedFiles');
  return validate(schema, request.files, 'custom');
};

export const resolveMultipartBody = async (
  _data: unknown,
  ctx: ExecutionContext,
): Promise<unknown> => {
  const metadata = readMetadata(ctx, '@ZodMultipartBody');
  const request: { body?: unknown } = ctx.switchToHttp().getRequest();
  const keys =
    metadata.filesIn === MultipartFilesIn.Body ? Object.keys(metadata.shape) : metadata.textKeys;
  return validate(pick(metadata.shape, keys), request.body, 'body');
};

/**
 * Validates `req.file` against the named property of the `@ZodMultipart`
 * shape. The name selects a schema; it never searches the request. Match it
 * to your `FileInterceptor('<name>')` field name, as with plain Nest.
 */
export const ZodUploadedFile = createParamDecorator(resolveUploadedFile);

/**
 * Validates `req.files` against the named property of the `@ZodMultipart`
 * shape, or against an object of every declared file property when called
 * with no name — the record shape `FileFieldsInterceptor` produces.
 */
export const ZodUploadedFiles = createParamDecorator(resolveUploadedFiles);

/**
 * Validates `req.body` against the `@ZodMultipart` shape — the text fields
 * only under `filesIn: 'request'` (multer keeps files off the body), the
 * whole shape under `filesIn: 'body'`.
 */
export const ZodMultipartBody = createParamDecorator(resolveMultipartBody);
