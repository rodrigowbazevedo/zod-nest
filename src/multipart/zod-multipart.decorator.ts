import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { z } from 'zod';

import type { ZodNestRegistry } from '../schema/registry.js';
import type { MultipartFilesIn, MultipartMetadata, MultipartShape } from './metadata.js';

import { discoverDependents } from '../schema/discover-dependents.js';
import { toOpenApi } from '../schema/engine.js';
import { defaultRegistry } from '../schema/registry.js';
import { isFileSchema } from './file-marker.js';
import { ZOD_MULTIPART_METADATA_KEY } from './metadata.js';

export const MULTIPART_CONTENT_TYPE = 'multipart/form-data';

export interface ZodMultipartOptions {
  /**
   * Where the parser puts uploaded files. Defaults to the platform entry
   * point's convention — `'request'` from `zod-nest/express`, `'body'` from
   * `zod-nest/fastify`.
   */
  readonly filesIn?: MultipartFilesIn;
  /** Registry to register named descendants into. Defaults to `defaultRegistry`. */
  readonly registry?: ZodNestRegistry;
  /** OpenAPI `description` for the request body. */
  readonly description?: string;
  /** Whether the body is required. Defaults to `true`. */
  readonly required?: boolean;
}

const partitionKeys = (shape: MultipartShape): { fileKeys: string[]; textKeys: string[] } => {
  const fileKeys: string[] = [];
  const textKeys: string[] = [];
  for (const [key, schema] of Object.entries(shape)) {
    if (isFileSchema(schema)) {
      fileKeys.push(key);
      continue;
    }
    textKeys.push(key);
  }
  return { fileKeys, textKeys };
};

/**
 * Emits the body inline rather than as a `$ref`. Swagger UI's
 * `multipart/form-data` try-it-out form generator doesn't follow `$ref`, so a
 * referenced body renders as a single stub field instead of file pickers.
 * Same trade-off `@ZodBody({ flatten: true })` documents.
 */
const emitInlineBody = (
  shape: MultipartShape,
  registry: ZodNestRegistry,
): Record<string, unknown> => {
  const object = z.object({ ...shape });
  for (const [child, childId] of discoverDependents(object)) {
    registry.register(child, childId);
  }
  const { schema } = toOpenApi(object, { io: 'input', registry });
  return schema;
};

export const createZodMultipart = (defaultFilesIn: MultipartFilesIn) => {
  /**
   * Declares an endpoint's whole `multipart/form-data` body — file fields and
   * text fields together — as the single source of truth for both the OpenAPI
   * document and the multipart param decorators.
   */
  return (shape: MultipartShape, options?: ZodMultipartOptions): MethodDecorator => {
    const registry = options?.registry ?? defaultRegistry;
    const { fileKeys, textKeys } = partitionKeys(shape);
    const metadata: MultipartMetadata = {
      shape,
      fileKeys,
      textKeys,
      filesIn: options?.filesIn ?? defaultFilesIn,
    };
    const body = emitInlineBody(shape, registry);

    return (target, propertyKey, descriptor) => {
      const handler = descriptor.value;
      if (typeof handler !== 'function') {
        throw new TypeError('[zod-nest] @ZodMultipart can only be applied to methods.');
      }
      Reflect.defineMetadata(ZOD_MULTIPART_METADATA_KEY, metadata, handler);

      // `TypedPropertyDescriptor<unknown>` matches what the swagger decorators
      // expect; `MethodDecorator`'s parameter is `TypedPropertyDescriptor<T>`
      // for the inferred return type, structurally compatible at runtime.
      const swaggerDescriptor = descriptor as TypedPropertyDescriptor<unknown>;
      ApiConsumes(MULTIPART_CONTENT_TYPE)(target, propertyKey, swaggerDescriptor);
      ApiBody({
        schema: body,
        ...(options?.description !== undefined ? { description: options.description } : {}),
        required: options?.required ?? true,
      })(target, propertyKey, swaggerDescriptor);
    };
  };
};
