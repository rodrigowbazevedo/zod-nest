import { z } from 'zod';

/**
 * Lineage record stored for each composition-derived schema. Phase 2a-composition
 * v0.2 only emits this for the `extend` helper; `omit` / `pick` / `partial`
 * defer to v0.3.
 *
 * The override hook (wired in Commit 2) reads this map to discriminate
 * composition-derived schemas from plain `z.object()`s and replaces their flat
 * JSON Schema body with an `allOf` form that references the parent's `$id`.
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
const lineageMap = new WeakMap<z.ZodType, LineageEntry>();

/**
 * Wraps `parent.extend(...)` (or any builder that produces a derived
 * `z.ZodObject`) and records the parent → child link in the lineage map.
 * Subsequent `z.toJSONSchema` emission picks this up and rewrites the
 * derived schema's body to `allOf: [{ $ref: '<parent>' }, <delta>]` —
 * implemented in Commit 2.
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
export const extend = <P extends z.ZodObject, S extends z.ZodObject>(
  parent: P,
  build: (p: P) => S,
): S => {
  const result = build(parent);
  lineageMap.set(result, { op: 'extend', parent });
  return result;
};

/**
 * Public read-only accessor over the lineage table. Returns `undefined` for
 * schemas that weren't built through the composition helpers. Useful for
 * tooling that wants to walk composition trees (e.g., a doc generator
 * surfacing derived-from relationships outside the OpenAPI output).
 */
export const getLineage = (schema: z.ZodType): LineageEntry | undefined => lineageMap.get(schema);
