import { z } from 'zod';

import type { $ZodType } from 'zod/v4/core';

/**
 * A schema carrying an `id`, plus the id itself. The owner is the instance the
 * id is registered against — never the clone the lookup started from.
 */
export interface IdOwner {
  readonly owner: z.ZodType;
  readonly id: string;
}

type ZodMetadataRegistry = typeof z.globalRegistry;

// Metadata-only clones (`.meta()`, `.describe()`, `z.compile()`) reuse the def
// by reference. `.check()` derivatives (`.min()`, `.refine()`, …) merge a new
// def and emit a different body, so they must not inherit the ancestor's entry.
const sharesDef = (child: $ZodType, parent: $ZodType): boolean =>
  child._zod.def === parent._zod.def;

/**
 * First non-`undefined` `lookup` result walking `schema` and its annotation
 * clones. Stops at the first clone that changed the emitted body.
 */
export const resolveThroughClones = <T>(
  schema: $ZodType,
  lookup: (candidate: $ZodType) => T | undefined,
): T | undefined => {
  let current = schema;
  for (;;) {
    const hit = lookup(current);
    if (hit !== undefined) {
      return hit;
    }
    const parent = current._zod.parent;
    if (parent === undefined || !sharesDef(current, parent)) {
      return undefined;
    }
    current = parent;
  }
};

const readOwnId = (schema: $ZodType, metadata: ZodMetadataRegistry): string | undefined => {
  const id = metadata.get(schema)?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
};

// Every value reaching this module is a classic `z.ZodType`; the core
// `$ZodType` the walker is typed on can't express that.
const asZodType = (schema: $ZodType): z.ZodType => schema as z.ZodType;

/**
 * Nearest ancestor whose id the schema may legitimately claim as its own name.
 *
 * Stops at the first clone that changed the emitted body, so
 * `createZodDto(Named.min(3))` stays a distinct component instead of
 * collapsing onto `Named` and losing `minLength`.
 */
export const findIdOwner = (
  schema: z.ZodType,
  metadata: ZodMetadataRegistry = z.globalRegistry,
): IdOwner | undefined =>
  resolveThroughClones(schema, (candidate) => {
    const id = readOwnId(candidate, metadata);
    return id === undefined ? undefined : { owner: asZodType(candidate), id };
  });

/**
 * Nearest named ancestor of any kind — the instance Zod's own `toJSONSchema`
 * parent walk emits a `$ref` to. Ungated: `.refine()` and `.min()` clones also
 * emit `$ref` to their ancestor, so the ancestor is a real document dependency
 * and must be registered or the ref dangles.
 */
export const findRefTarget = (
  schema: z.ZodType,
  metadata: ZodMetadataRegistry = z.globalRegistry,
): IdOwner | undefined => {
  let current: $ZodType | undefined = schema;
  while (current !== undefined) {
    const id = readOwnId(current, metadata);
    if (id !== undefined) {
      return { owner: asZodType(current), id };
    }
    current = current._zod.parent;
  }
  return undefined;
};
