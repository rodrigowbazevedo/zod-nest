import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

import type { ZodNestRegistry } from '../schema/registry.js';

import { defaultRegistry } from '../schema/registry.js';
import { flattenObjectIntersection } from './internal/flatten-intersection.js';
import { resolveSchemaRef } from './internal/zod-schema-ref.js';

type BodySchema = { readonly $ref: string } | Record<string, unknown>;

export interface ZodBodyOptions {
  /** Forces this id, overriding any `.meta({ id })` already on the schema. */
  readonly id?: string;
  /** Registry to register into. Defaults to `defaultRegistry`. */
  readonly registry?: ZodNestRegistry;
  /** OpenAPI `description` for the request body. */
  readonly description?: string;
  /** Whether the body is required. Defaults to `true`. */
  readonly required?: boolean;
  /**
   * Merge an intersection of `z.object` arms into a single flat object body
   * emitted inline (no `$ref`, no `components.schemas` entry). Use when
   * Swagger UI's `multipart/form-data` `try-it-out` form needs to render the
   * body — the UI doesn't follow `$ref` or unwrap `allOf`. Throws
   * `ZodNestError` if the schema isn't an object or an intersection of
   * objects. No-op for a bare `z.object`. Defaults to `false`.
   */
  readonly flatten?: boolean;
}

/**
 * Method-level decorator that wires the OpenAPI `requestBody` for a handler
 * whose body schema doesn't fit a `createZodDto` class — typically a
 * `z.intersection` that contains a `z.union`, a `z.discriminatedUnion`, or
 * any schema whose `z.infer<>` is a TypeScript union (which TS refuses as a
 * class base with TS2509).
 *
 * Pair with `@Body(new ZodValidationPipe(schema))` at the parameter to keep
 * the handler arg precisely typed as `z.infer<typeof schema>`:
 *
 * ```ts
 * @Post()
 * @ZodBody(IntersectionWithUnion)
 * async post(
 *   @Body(new ZodValidationPipe(IntersectionWithUnion))
 *   body: z.infer<typeof IntersectionWithUnion>,
 * ) {}
 * ```
 *
 * The schema is registered in the registry when it has an id (via
 * `.meta({ id })` or `options.id`) so its body is emitted into
 * `components.schemas`. Anonymous schemas are inlined into the operation.
 */
export const ZodBody = (schema: z.ZodType, options?: ZodBodyOptions): MethodDecorator => {
  const apiBodySchema = resolveBodySchema(schema, options);
  return ApiBody({
    schema: apiBodySchema,
    ...(options?.description !== undefined ? { description: options.description } : {}),
    required: options?.required ?? true,
  });
};

const resolveBodySchema = (schema: z.ZodType, options: ZodBodyOptions | undefined): BodySchema => {
  if (options?.flatten === true) {
    return flattenObjectIntersection(schema, options.registry ?? defaultRegistry, '@ZodBody');
  }
  const resolution = resolveSchemaRef(schema, {
    id: options?.id,
    registry: options?.registry,
    deferAnonInline: true,
  });
  return resolution.kind === 'ref' ? resolution.ref : resolution.schema;
};
