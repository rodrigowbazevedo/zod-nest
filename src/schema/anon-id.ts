import type { z } from 'zod';

/** Synthetic-id prefix for an anonymous `@ZodResponse` body. */
export const ANON_RESPONSE_PREFIX = '_AnonResponseSchema_';
/** Synthetic-id prefix for an anonymous `@ZodBody` body. */
export const ANON_BODY_PREFIX = '_AnonBodySchema_';

/**
 * One synthetic id per schema instance, cached so the same un-named schema
 * reused across routes maps to a single id (and therefore a single registry
 * entry) rather than minting a fresh one per decoration. WeakMap so the id is
 * GC'd with the schema. Mirrors the cache pattern in `output-dto.ts` /
 * `normalize-type.ts`.
 *
 * The counter is module-global so ids are unique across both prefixes; the
 * prefix is only chosen on first sight of a schema, so a schema passed to both
 * `@ZodBody` and `@ZodResponse` keeps whichever id it got first — harmless,
 * since the id is internal and inlined away.
 */
const anonIdCache = new WeakMap<z.ZodType, string>();
let counter = 0;

export const resolveAnonId = (schema: z.ZodType, prefix: string): string => {
  const cached = anonIdCache.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  counter += 1;
  const id = `${prefix}${counter}`;
  anonIdCache.set(schema, id);
  return id;
};
