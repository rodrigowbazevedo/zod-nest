import { z } from 'zod';

import type { ZodNestRegistry } from '../../schema/registry.js';

import { discoverDependents } from '../../schema/discover-dependents.js';
import { toOpenApi } from '../../schema/engine.js';
import { defaultRegistry, registerSchema } from '../../schema/registry.js';

/**
 * Resolution of a schema used by `@ZodBody` / `@ZodQuery` / `@ZodParam` /
 * `@ZodHeaders` / `@ZodCookies`.
 *
 * - `ref` — the schema (or property's schema) has an id via `.meta({ id })`
 *   or via the explicit `id` option. It's registered in the registry so
 *   `applyZodNest`'s bulk-emit pass writes its body to `components.schemas`,
 *   and the decorator references it as `{ $ref: '#/components/schemas/<id>' }`.
 * - `inline` — no id was resolvable; the JSON Schema body is embedded
 *   directly into the operation. Named descendants are still registered so
 *   any nested `$ref`s inside the inline body resolve at doc-build time.
 */
export type SchemaRefResolution =
  | { readonly kind: 'ref'; readonly id: string; readonly ref: { readonly $ref: string } }
  | { readonly kind: 'inline'; readonly schema: Record<string, unknown> };

export interface ResolveSchemaRefOptions {
  /** Forces this id, overriding any `.meta({ id })` already on the schema. */
  readonly id?: string;
  /** Registry to register into. Defaults to `defaultRegistry`. */
  readonly registry?: ZodNestRegistry;
}

/**
 * Resolve a schema for embedding in an OpenAPI operation. If the schema is
 * named (has `.meta({ id })` or an explicit `options.id`), it's registered
 * and a `$ref` is returned. Otherwise the schema is rendered inline via
 * `toOpenApi(...)`, and any *named descendants* are registered so refs
 * inside the inline body still resolve.
 */
export const resolveSchemaRef = (
  schema: z.ZodType,
  options?: ResolveSchemaRefOptions,
): SchemaRefResolution => {
  const registry = options?.registry ?? defaultRegistry;
  const id = registerSchema(schema, registry, { id: options?.id });
  if (id !== undefined) {
    return { kind: 'ref', id, ref: { $ref: `#/components/schemas/${id}` } };
  }
  for (const [child, childId] of discoverDependents(schema)) {
    registry.register(child, childId);
  }
  const { schema: body } = toOpenApi(schema, { io: 'input', registry });
  return { kind: 'inline', schema: body as Record<string, unknown> };
};
