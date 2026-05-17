/**
 * Composition layer — emits OpenAPI `allOf` for schemas derived via `extend`.
 *
 * **EXPERIMENTAL (v0.2)**: output shape may change as edge cases surface.
 */

import { z } from 'zod';

import type { $ZodType } from 'zod/v4/core';
import type { SchemaObject } from './openapi.types.js';
import type { Override } from './override.js';
import type { ZodNestRegistry } from './registry.js';

import { DEFS_PREFIX } from './constants.js';

/**
 * Lineage record for a composition-derived schema. Read by the override to
 * emit `allOf` instead of a flat body.
 *
 * @experimental v0.2 — shape may change.
 */
export interface LineageEntry {
  readonly op: 'extend';
  readonly parent: z.ZodObject;
}

// `WeakMap` (not `z.registry`) so transient derived schemas can GC — Zod's
// own docs warn against long-running registries pinning short-lived schemas.
const lineageMap = new WeakMap<$ZodType, LineageEntry>();

// Parent flat-key cache, populated eagerly by `extend()` at registration.
// `reused: 'inline'` inlines the parent's shape into the child rather than
// firing the override on the parent as a separate node, so the override
// can't be relied on to populate this — extend() does it eagerly.
const propsMap = new WeakMap<
  $ZodType,
  { properties: readonly string[]; required: readonly string[] }
>();

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

/**
 * Wraps a derived `z.ZodObject` and records the parent → child link so
 * emission rewrites the body to `allOf: [{ $ref: <parent> }, <delta>]`.
 *
 * @experimental v0.2 — output shape may change as the surface stabilizes.
 *
 * @example
 *   const Base  = z.object({ id: z.string() }).meta({ id: 'Base' });
 *   const Child = extend(Base, (s) => s.extend({ role: z.string() }).meta({ id: 'Child' }));
 */
export const extend = <P extends z.ZodObject, S extends z.ZodObject>(
  parent: P,
  build: (p: P) => S,
): S => {
  const result = build(parent);
  lineageMap.set(result, { op: 'extend', parent });
  if (!propsMap.has(parent)) {
    propsMap.set(parent, computeShapeKeys(parent));
  }
  return result;
};

/**
 * Read the lineage entry for a composition-derived schema, or `undefined`.
 *
 * @experimental v0.2 — `LineageEntry` shape may change.
 */
export const getLineage = (schema: z.ZodType): LineageEntry | undefined => lineageMap.get(schema);

/**
 * Default ref builder for single-schema mode (`toOpenApi`) — refs land in
 * `#/$defs/<id>` and `post-process` rewrites them to `#/components/schemas/<id>`.
 * Bulk mode passes its own `uri` callback so refs land at the final location.
 */
export const DEFAULT_BUILD_REF = (id: string): string => `${DEFS_PREFIX}${id}`;

export interface CreateCompositionOverrideOptions {
  /** Shape the `$ref` string for a parent id. Defaults to `#/$defs/<id>`. */
  buildRef: (id: string) => string;
  /** Registry to resolve parent ids against. Use the same instance the engine emits with. */
  registry: ZodNestRegistry;
}

/**
 * Factory for the composition override. Returns an `Override` that rewrites
 * composition-derived schemas to `allOf` form, falling back to Zod's flat
 * emission when no lineage entry exists or the parent has no registered id.
 *
 * Mutation happens in-place — Zod's override doesn't propagate
 * `ctx.jsonSchema = newBody` reassignments; only mutations on the existing
 * object reference reach the caller.
 */
export const createCompositionOverride = (opts: CreateCompositionOverrideOptions): Override => {
  const { buildRef, registry } = opts;
  return (ctx) => {
    const { jsonSchema, zodSchema } = ctx;
    const entry = lineageMap.get(zodSchema);
    if (entry === undefined) {
      return;
    }

    const parentCache = propsMap.get(entry.parent);
    if (parentCache === undefined) {
      // Defensive: `extend()` pre-caches the parent at registration time, so
      // by the time the child's override fires this should be set.
      return;
    }

    const parentId = registry.zodRegistry.get(entry.parent)?.id;
    if (parentId === undefined) {
      // Anonymous parent — fall back to Zod's flat emission.
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

    delete jsonSchema.type;
    delete jsonSchema.properties;
    delete jsonSchema.required;
    delete jsonSchema.additionalProperties;
    jsonSchema.allOf = [{ $ref: buildRef(parentId) }, delta];
    jsonSchema.unevaluatedProperties = false;
  };
};
