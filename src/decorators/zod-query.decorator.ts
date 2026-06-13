import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';

import type { ZodNestRegistry } from '../schema/registry.js';

import { ZodNestError } from '../schema/errors.js';
import { defaultRegistry, registerSchema } from '../schema/registry.js';
import { appendQueryMarker } from './internal/query-marker.js';
import { expandObjectSchema, isZodObject, paramSchemaBody } from './internal/zod-param-expand.js';

export interface ZodQueryOptions {
  /** Forces this id on the root schema, overriding any `.meta({ id })`. */
  readonly id?: string;
  /** Registry to register into. Defaults to `defaultRegistry`. */
  readonly registry?: ZodNestRegistry;
  /**
   * Override how this query DTO is represented in the OpenAPI doc, taking
   * precedence over `applyZodNest`'s `queryParamStyle`:
   *
   * - `true` — one single schema-based query parameter that `$ref`s the DTO's
   *   `components.schemas` entry (`style: 'form'`, `explode: true`).
   * - `false` — one parameter per top-level property.
   * - unset — follow the global `queryParamStyle` preference (default `'expand'`).
   *
   * Ref mode needs a named schema to reference: `ref: true` on an anonymous
   * schema (no `.meta({ id })` and no `id` option) throws `ZodNestError`.
   */
  readonly ref?: boolean;
}

/**
 * Method-level decorator describing a `@Query()` object schema as OpenAPI
 * query parameters.
 *
 * When the schema is named (`.meta({ id })` or the `id` option), the decorator
 * registers it and emits a single deferred marker, leaving the expand-vs-`$ref`
 * decision to `applyZodNest` — so an unset `ref` follows the global
 * `queryParamStyle` preference, `ref: true` collapses to one `$ref` query
 * parameter, and `ref: false` expands per property. This mirrors the
 * `@Query() dto` (`createZodDto`) path, which flows through the same marker.
 *
 * When the schema is anonymous, there is no component to reference, so the
 * decorator expands one `@ApiQuery` per property immediately (and rejects
 * `ref: true`).
 *
 * The user remains responsible for binding the actual query values to the
 * handler, typically via `@Query(new ZodValidationPipe(schema)) q: z.infer<typeof schema>`.
 */
export const ZodQuery = (schema: z.ZodType, options?: ZodQueryOptions): MethodDecorator => {
  if (!isZodObject(schema)) {
    throw new ZodNestError(
      `@ZodQuery requires a \`z.object({...})\` schema (got \`${schema._zod.def.type}\`). ` +
        `Each property of the object becomes one OpenAPI parameter. ` +
        `For non-object body shapes (intersections, unions, primitives), use \`@ZodBody\` instead.`,
    );
  }
  const registry = options?.registry ?? defaultRegistry;
  const id = registerSchema(schema, registry, { id: options?.id });
  if (id !== undefined) {
    return appendQueryMarker(id, options?.ref);
  }
  if (options?.ref === true) {
    throw new ZodNestError(
      `@ZodQuery({ ref: true }) requires a named schema — there is no component to \`$ref\`. ` +
        `Name the schema via \`.meta({ id: 'Foo' })\` or pass the \`id\` option, or drop \`ref\` to expand per property.`,
    );
  }
  const expanded = expandObjectSchema(schema, {
    id: options?.id,
    registry,
    decoratorName: '@ZodQuery',
  });
  return applyDecorators(
    ...expanded.map(({ name, required, resolution }) =>
      ApiQuery({ name, schema: paramSchemaBody(resolution), required }),
    ),
  );
};
