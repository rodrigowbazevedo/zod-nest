import { z } from 'zod';

import type { $ZodType } from 'zod/v4/core';
import type { SchemaObject } from './openapi.types.js';
import type { Override } from './override.js';

/**
 * Lineage record stored for each composition-derived schema. Phase 2a-composition
 * v0.2 only emits this for the `extend` helper; `omit` / `pick` / `partial`
 * defer to v0.3.
 *
 * The override hook reads this map to discriminate composition-derived schemas
 * from plain `z.object()`s and replaces their flat JSON Schema body with an
 * `allOf` form that references the parent's `$id`.
 */
export interface LineageEntry {
  readonly op: 'extend';
  readonly parent: z.ZodObject;
}

/**
 * Module-internal lineage table. `WeakMap` (not `z.registry`) so transient
 * derived schemas can GC — Zod's own docs warn against long-running
 * registries pinning short-lived schemas alive.
 */
const lineageMap = new WeakMap<$ZodType, LineageEntry>();

/**
 * Per-schema flat key cache, populated as each schema's override fires. By
 * "children-before-parents" ordering, a parent's entry is always present
 * by the time the child's override needs to subtract the parent's keys
 * to compute the delta.
 */
const propsMap = new WeakMap<
  $ZodType,
  { properties: readonly string[]; required: readonly string[] }
>();

/**
 * Wraps `parent.extend(...)` (or any builder that produces a derived
 * `z.ZodObject`) and records the parent → child link in the lineage map.
 * Subsequent `z.toJSONSchema` emission picks this up and rewrites the
 * derived schema's body to `allOf: [{ $ref: '<parent>' }, <delta>]`.
 *
 * Type inference flows through Zod's own `.extend()` machinery — `S` is
 * whatever the `build` callback returns, so `z.infer<typeof result>`
 * resolves to the full extended shape at the call site.
 *
 * @example
 *   const Base  = z.object({ id: z.string() }).meta({ id: 'Base' });
 *   const Child = extend(Base, (s) => s.extend({ role: z.string() }).meta({ id: 'Child' }));
 *   type ChildOut = z.infer<typeof Child>;  // { id: string; role: string }
 */
/** Zod's wrapper types that make a property optional in JSON Schema's `required` sense. */
const OPTIONAL_WRAPPER_TYPES: ReadonlySet<string> = new Set(['optional', 'default']);

const isOptionalProp = (propSchema: z.ZodType): boolean =>
  OPTIONAL_WRAPPER_TYPES.has(propSchema._zod.def.type);

const computeShapeKeys = (
  schema: z.ZodObject,
): { properties: readonly string[]; required: readonly string[] } => {
  const { shape } = schema;
  const properties = Object.keys(shape);
  const required = properties.filter((key) => {
    const propSchema = shape[key];
    return propSchema !== undefined && !isOptionalProp(propSchema);
  });
  return { properties, required };
};

export const extend = <P extends z.ZodObject, S extends z.ZodObject>(
  parent: P,
  build: (p: P) => S,
): S => {
  const result = build(parent);
  lineageMap.set(result, { op: 'extend', parent });
  // Pre-cache the parent's keys. `reused: 'inline'` mode doesn't fire the
  // override on the parent as a separate node (its shape is inlined into the
  // child), so we can't rely on a parent-first override visit to populate
  // `propsMap`. Compute it eagerly from Zod's shape.
  if (!propsMap.has(parent)) {
    propsMap.set(parent, computeShapeKeys(parent));
  }
  return result;
};

/**
 * Public read-only accessor over the lineage table. Returns `undefined` for
 * schemas that weren't built through the composition helpers. Useful for
 * tooling that wants to walk composition trees outside the OpenAPI output.
 */
export const getLineage = (schema: z.ZodType): LineageEntry | undefined => lineageMap.get(schema);

/**
 * Default ref builder for single-schema mode (`toOpenApi`). Refs land in
 * `#/$defs/<id>` and the engine's `post-process` rewrites them to
 * `#/components/schemas/<id>`. Bulk mode (`bulkEmit`) passes its `uri`
 * callback as the buildRef instead, so refs land at the final location
 * directly (no rewrite pass on the bulk path).
 */
export const DEFAULT_BUILD_REF = (id: string): string => `#/$defs/${id}`;

export interface CreateCompositionOverrideOptions {
  /** Shape the `$ref` string for a parent id. Defaults to `#/$defs/<id>`. */
  buildRef: (id: string) => string;
}

/**
 * Factory for the composition override. Returns an `Override` that:
 * 1. Caches the current node's flat key set in `propsMap`.
 * 2. If the node has a lineage entry AND its parent has a registered id,
 *    subtracts the parent's keys to compute the delta and replaces the
 *    body's structural keys with `{ allOf: [{ $ref: buildRef(parentId) },
 *    delta], unevaluatedProperties: false }`. Meta keys (`title`,
 *    `description`, etc.) stay on `jsonSchema` untouched.
 * 3. Otherwise (no lineage, or anonymous parent), leaves Zod's flat
 *    emission in place — that's the v0.2 fallback.
 *
 * Mutation happens in-place — Zod's override doesn't propagate
 * `ctx.jsonSchema = newBody` reassignments; only mutations on the existing
 * object reference reach the caller.
 */
export const createCompositionOverride = (opts: CreateCompositionOverrideOptions): Override => {
  const { buildRef } = opts;
  return (ctx) => {
    const { jsonSchema, zodSchema } = ctx;
    propsMap.set(zodSchema, {
      properties: jsonSchema.properties !== undefined ? Object.keys(jsonSchema.properties) : [],
      required: jsonSchema.required ?? [],
    });

    const entry = lineageMap.get(zodSchema);
    if (entry === undefined) {
      return;
    }

    const parentCache = propsMap.get(entry.parent);
    if (parentCache === undefined) {
      // Should never happen — `extend` pre-caches the parent at registration
      // time, so by the time the child's override fires, the parent's keys
      // are already in `propsMap`. Defensive bail.
      return;
    }

    const parentId = z.globalRegistry.get(entry.parent)?.id;
    if (parentId === undefined) {
      // Anonymous parent (no `.meta({ id })` registration) — v0.2 falls back
      // to Zod's flat emission. Documented limitation; users opt in to
      // `allOf` form by registering a parent id.
      return;
    }

    const childProps = jsonSchema.properties ?? {};
    const childRequired = jsonSchema.required ?? [];
    const parentPropSet = new Set(parentCache.properties);
    const parentReqSet = new Set(parentCache.required);

    const deltaProps: NonNullable<SchemaObject['properties']> = {};
    for (const [key, value] of Object.entries(childProps)) {
      if (parentPropSet.has(key)) {
        continue;
      }
      deltaProps[key] = value;
    }
    const deltaRequired = childRequired.filter((key) => !parentReqSet.has(key));

    const delta: SchemaObject = { type: 'object', properties: deltaProps };
    if (deltaRequired.length > 0) {
      delta.required = deltaRequired;
    }

    // Drop the now-replaced structural keys; leave user meta (title,
    // description, examples, x-* extensions, etc.) untouched on jsonSchema.
    delete jsonSchema.type;
    delete jsonSchema.properties;
    delete jsonSchema.required;
    delete jsonSchema.additionalProperties;
    jsonSchema.allOf = [{ $ref: buildRef(parentId) }, delta];
    jsonSchema.unevaluatedProperties = false;
  };
};
