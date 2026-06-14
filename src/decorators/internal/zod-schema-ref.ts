import { z } from 'zod';

import type { ZodNestRegistry } from '../../schema/registry.js';

import { ANON_BODY_PREFIX, resolveAnonId } from '../../schema/anon-id.js';
import { COMPONENTS_SCHEMAS_PREFIX } from '../../schema/constants.js';
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
  | { readonly kind: 'ref'; readonly ref: { readonly $ref: string } }
  | { readonly kind: 'inline'; readonly schema: Record<string, unknown> };

export interface ResolveSchemaRefOptions {
  /** Forces this id, overriding any `.meta({ id })` already on the schema. */
  readonly id?: string;
  /** Registry to register into. Defaults to `defaultRegistry`. */
  readonly registry?: ZodNestRegistry;
  /**
   * When `true`, an anonymous (un-named) schema is registered under a synthetic
   * `anonymous` id and returned as a `$ref` instead of being rendered inline
   * here. `applyZodNest`'s `inlineAnonymousBodies` pass then inlines the body
   * (emitted by bulk-emit under the document's `strict` / `override`) and
   * prunes the component. Used by `@ZodBody`, where the body is emitted as a
   * full schema; left `false` for per-property param expansion, which inlines
   * the (usually primitive) property body directly.
   */
  readonly deferAnonInline?: boolean;
}

/**
 * Resolve a schema for embedding in an OpenAPI operation. If the schema is
 * named (has `.meta({ id })` or an explicit `options.id`), it's registered
 * and a `$ref` is returned. Otherwise:
 *
 * - with `deferAnonInline`, the schema is registered under a synthetic
 *   `anonymous` id and a `$ref` to it is returned — `applyZodNest` inlines and
 *   prunes it later, so the body honors the document's `strict` / `override`;
 * - without it, the schema is rendered inline here via `toOpenApi(...)`, and
 *   any *named descendants* are registered so refs inside the inline body
 *   resolve at doc-build time.
 */
export const resolveSchemaRef = (
  schema: z.ZodType,
  options?: ResolveSchemaRefOptions,
): SchemaRefResolution => {
  const registry = options?.registry ?? defaultRegistry;
  const id = registerSchema(schema, registry, { id: options?.id });
  if (id !== undefined) {
    return { kind: 'ref', ref: { $ref: `${COMPONENTS_SCHEMAS_PREFIX}${id}` } };
  }
  if (options?.deferAnonInline === true) {
    // `registerSchema` registers the schema and (via `register`) its named
    // descendants, so nested `$ref`s inside the emitted body resolve.
    const anonId = resolveAnonId(schema, ANON_BODY_PREFIX);
    registerSchema(schema, registry, { id: anonId, anonymous: true });
    return { kind: 'ref', ref: { $ref: `${COMPONENTS_SCHEMAS_PREFIX}${anonId}` } };
  }
  for (const [child, childId] of discoverDependents(schema)) {
    registry.register(child, childId);
  }
  const { schema: body } = toOpenApi(schema, { io: 'input', registry });
  return { kind: 'inline', schema: body as Record<string, unknown> };
};
