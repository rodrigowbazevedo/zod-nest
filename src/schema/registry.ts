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
      z.globalRegistry.add(schema, { id });
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
