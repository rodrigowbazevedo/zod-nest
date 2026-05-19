import { z } from 'zod';

import { discoverDependents } from './discover-dependents.js';

export interface ZodNestRegistry {
  readonly zodRegistry: typeof z.globalRegistry;
  register(schema: z.ZodType, id: string): void;
  hasCollision(id: string): boolean;
  getCollisions(): ReadonlyMap<string, ReadonlySet<z.ZodType>>;
  /**
   * Snapshot of every id registered through this `ZodNestRegistry`. The
   * underlying Zod registry is `z.globalRegistry`, which may hold third-party
   * entries — bulk emission filters its output against this snapshot to keep
   * only zod-nest-known ids.
   *
   * Includes ids discovered transitively via `.meta({ id })` on descendants
   * of explicitly-registered schemas.
   */
  ids(): readonly string[];
}

export const createRegistry = (): ZodNestRegistry => {
  const seen = new Map<string, Set<z.ZodType>>();

  const recordOnce = (schema: z.ZodType, id: string): boolean => {
    let set = seen.get(id);
    if (set === undefined) {
      set = new Set<z.ZodType>();
      seen.set(id, set);
    }
    if (set.has(schema)) {
      return false;
    }
    set.add(schema);
    return true;
  };

  return {
    zodRegistry: z.globalRegistry,
    register: (schema, id) => {
      // `globalRegistry.add` overwrites the schema's entire meta entry; we
      // must merge so user-supplied fields (`title`, `description`,
      // anything else in `.meta({...})`) survive registration. The `has`
      // gate avoids promoting parent-inherited meta into a local entry
      // — `get()` returns parent-merged metadata when the schema has no
      // local entry, and writing that back here would freeze the
      // inherited fields against the schema.
      if (z.globalRegistry.has(schema)) {
        const existing = z.globalRegistry.get(schema);
        if (existing?.id !== id) {
          z.globalRegistry.add(schema, { ...(existing ?? {}), id });
        }
      } else {
        z.globalRegistry.add(schema, { id });
      }
      if (!recordOnce(schema, id)) {
        return;
      }
      // `discoverDependents` walks the Zod tree once and yields every named
      // descendant transitively (cycle-safe via its own visited set).
      for (const [child, childId] of discoverDependents(schema)) {
        recordOnce(child, childId);
      }
    },
    hasCollision: (id) => {
      const set = seen.get(id);
      return set !== undefined && set.size > 1;
    },
    getCollisions: () => {
      const out = new Map<string, Set<z.ZodType>>();
      for (const [id, set] of seen) {
        if (set.size <= 1) {
          continue;
        }
        out.set(id, set);
      }
      return out;
    },
    ids: () => [...seen.keys()],
  };
};

/** Process-wide default registry, used when no explicit `options.registry` is passed. */
export const defaultRegistry: ZodNestRegistry = createRegistry();

export interface RegisterSchemaOptions {
  /** Forces this id, overriding any `.meta({ id })` already on the schema. */
  readonly id?: string;
}

/**
 * Register a schema with the given registry, resolving its id from (in order):
 * an explicit `options.id`, then `.meta({ id })` on the schema. Returns the
 * resolved id, or `undefined` when neither source yields one (the call is then
 * a no-op — callers with their own fallback path handle that case).
 *
 * Shared by `createZodDto` and `extend` so a schema named via `.meta({ id })`
 * gets its body emitted into `components.schemas` even when it never flows
 * through `createZodDto` (e.g. used only as an `extend()` parent — Zod's
 * `.extend()` produces a flat object, so the parent isn't a transitive
 * descendant of the child and would otherwise be missed by `discoverDependents`).
 *
 * Idempotent — `registry.register` already deduplicates repeat calls.
 */
export const registerSchema = (
  schema: z.ZodType,
  registry: ZodNestRegistry = defaultRegistry,
  options?: RegisterSchemaOptions,
): string | undefined => {
  const explicit = options?.id;
  if (typeof explicit === 'string' && explicit !== '') {
    registry.register(schema, explicit);
    return explicit;
  }
  const meta = registry.zodRegistry.get(schema);
  const metaId = meta === undefined ? undefined : (meta as { id?: unknown }).id;
  if (typeof metaId !== 'string' || metaId === '') {
    return undefined;
  }
  registry.register(schema, metaId);
  return metaId;
};
