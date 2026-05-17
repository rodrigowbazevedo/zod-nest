import { z } from 'zod';

export interface ZodNestRegistry {
  readonly zodRegistry: typeof z.globalRegistry;
  register(schema: z.ZodType, id: string): void;
  hasCollision(id: string): boolean;
  getCollisions(): ReadonlyMap<string, ReadonlySet<z.ZodType>>;
}

export const createRegistry = (): ZodNestRegistry => {
  const seen = new Map<string, Set<z.ZodType>>();

  return {
    zodRegistry: z.globalRegistry,
    register: (schema, id) => {
      z.globalRegistry.add(schema, { id });
      let set = seen.get(id);
      if (set === undefined) {
        set = new Set<z.ZodType>();
        seen.set(id, set);
      }
      set.add(schema);
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
  };
};
