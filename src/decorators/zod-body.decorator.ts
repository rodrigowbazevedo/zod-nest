import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

import { type ZodNestRegistry } from '../schema/registry.js';
import { resolveSchemaRef } from './internal/zod-schema-ref.js';

export interface ZodBodyOptions {
  /** Forces this id, overriding any `.meta({ id })` already on the schema. */
  readonly id?: string;
  /** Registry to register into. Defaults to `defaultRegistry`. */
  readonly registry?: ZodNestRegistry;
  /** OpenAPI `description` for the request body. */
  readonly description?: string;
  /** Whether the body is required. Defaults to `true`. */
  readonly required?: boolean;
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
  const resolution = resolveSchemaRef(schema, {
    id: options?.id,
    registry: options?.registry,
  });
  const apiBodySchema = resolution.kind === 'ref' ? resolution.ref : resolution.schema;
  return ApiBody({
    schema: apiBodySchema,
    ...(options?.description !== undefined ? { description: options.description } : {}),
    required: options?.required ?? true,
  });
};
