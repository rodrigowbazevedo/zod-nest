import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { z } from 'zod';

import type { ZodNestRegistry } from '../schema/registry.js';
import type { MultipartFilesIn, MultipartMetadata, MultipartShape } from './metadata.js';

import { flattenObjectIntersection } from '../decorators/internal/flatten-intersection.js';
import { isZodObject } from '../decorators/internal/zod-param-expand.js';
import { resolveSchemaRef } from '../decorators/internal/zod-schema-ref.js';
import { isZodSchema } from '../dto/predicates.js';
import { defaultRegistry } from '../schema/registry.js';
import { singleton } from '../schema/singleton.js';
import { isFileSchema } from './file-marker.js';
import { ZOD_MULTIPART_METADATA_KEY } from './metadata.js';

export const MULTIPART_CONTENT_TYPE = 'multipart/form-data';

/**
 * Body declaration accepted by `@ZodMultipart`: a flat shape record, or any
 * Zod schema. A record is the common case; a schema covers named bodies
 * (`.meta({ id })` → `$ref`) and composites an object literal can't express.
 */
export type MultipartBody = MultipartShape | z.ZodType;

export interface ZodMultipartOptions {
  /**
   * Where the parser puts uploaded files. Defaults to the platform entry
   * point's convention — `'request'` from `zod-nest/express`, `'body'` from
   * `zod-nest/fastify`.
   */
  readonly filesIn?: MultipartFilesIn;
  /**
   * Forces this id, overriding any `.meta({ id })` on the schema. A named body
   * is emitted as a `$ref` to `components.schemas`, which keeps a stable name
   * for client generators — at the cost of Swagger UI's `try-it-out` form,
   * which doesn't follow `$ref` for `multipart/form-data`.
   */
  readonly id?: string;
  /**
   * Merge an intersection / union of `z.object` arms into one flat inline
   * object. Needed for composite bodies whose `try-it-out` form must render.
   * All merged properties become optional. See `@ZodBody`'s `flatten`.
   */
  readonly flatten?: boolean;
  /** Registry to register named descendants into. Defaults to `defaultRegistry`. */
  readonly registry?: ZodNestRegistry;
  /** OpenAPI `description` for the request body. */
  readonly description?: string;
  /** Whether the body is required. Defaults to `true`. */
  readonly required?: boolean;
}

// One `z.object` per shape record, so a shape hoisted across handlers (the
// pattern docs/recipes/multipart-uploads.md recommends) resolves to a single
// synthetic id rather than one per route.
const schemaByShape = singleton(
  'multipart-shape-schemas',
  () => new WeakMap<MultipartShape, z.ZodType>(),
);

const toSchema = (body: MultipartBody): z.ZodType => {
  if (isZodSchema(body)) {
    return body;
  }
  const cached = schemaByShape.get(body);
  if (cached !== undefined) {
    return cached;
  }
  const schema = z.object({ ...body });
  schemaByShape.set(body, schema);
  return schema;
};

/**
 * The flat shape the param decorators split on. A record is already flat and a
 * `z.object` exposes one; a composite has none, and the decorators report that
 * rather than guessing.
 */
const toShape = (body: MultipartBody): MultipartShape | undefined => {
  if (!isZodSchema(body)) {
    return body;
  }
  return isZodObject(body) ? body.shape : undefined;
};

const partitionKeys = (
  shape: MultipartShape | undefined,
): { fileKeys: string[]; textKeys: string[] } => {
  const fileKeys: string[] = [];
  const textKeys: string[] = [];
  for (const [key, schema] of Object.entries(shape ?? {})) {
    if (isFileSchema(schema)) {
      fileKeys.push(key);
      continue;
    }
    textKeys.push(key);
  }
  return { fileKeys, textKeys };
};

/**
 * Resolves the operation's body to a `$ref`. An anonymous one targets a
 * synthetic id that `applyZodNest` emits under the document's `strict` /
 * `override` and then inlines at the operation — Swagger UI's
 * `multipart/form-data` form generator doesn't follow `$ref`, so a referenced
 * body renders one stub field instead of file pickers. Naming the body (`id`
 * or `.meta({ id })`) keeps the `$ref` in the final document and opts into
 * that trade-off.
 */
const resolveBody = (
  schema: z.ZodType,
  options: ZodMultipartOptions | undefined,
  registry: ZodNestRegistry,
): { readonly $ref: string } => {
  if (options?.flatten === true) {
    const merged = flattenObjectIntersection(schema, registry, '@ZodMultipart');
    return resolveSchemaRef(merged, { registry, deferAnonInline: true }).ref;
  }
  return resolveSchemaRef(schema, {
    ...(options?.id !== undefined ? { id: options.id } : {}),
    registry,
    deferAnonInline: true,
  }).ref;
};

export const createZodMultipart = (defaultFilesIn: MultipartFilesIn) => {
  /**
   * Declares an endpoint's whole `multipart/form-data` body — file fields and
   * text fields together — as the single source of truth for both the OpenAPI
   * document and the multipart param decorators.
   */
  return (body: MultipartBody, options?: ZodMultipartOptions): MethodDecorator => {
    const registry = options?.registry ?? defaultRegistry;
    const shape = toShape(body);
    const metadata: MultipartMetadata = {
      shape,
      ...partitionKeys(shape),
      filesIn: options?.filesIn ?? defaultFilesIn,
    };
    const schema = resolveBody(toSchema(body), options, registry);

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
        schema,
        ...(options?.description !== undefined ? { description: options.description } : {}),
        required: options?.required ?? true,
      })(target, propertyKey, swaggerDescriptor);
    };
  };
};
