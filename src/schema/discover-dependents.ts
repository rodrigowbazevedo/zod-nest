import { z } from 'zod';

import type { $ZodType, $ZodTypes } from 'zod/v4/core';

const INNER_TYPE_WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'catch',
  'nonoptional',
  'success',
  'readonly',
  'promise',
]);

const readId = (schema: z.ZodType): string | undefined => {
  const meta = z.globalRegistry.get(schema);
  if (meta === undefined) {
    return undefined;
  }
  const id = (meta as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
};

const collectChildren = (schema: z.ZodType): z.ZodType[] => {
  const def = (schema as unknown as $ZodTypes)._zod.def;
  if (def.type === 'object') {
    const out: z.ZodType[] = [];
    const shape = def.shape as Record<string, z.ZodType> | undefined;
    if (shape !== undefined) {
      for (const value of Object.values(shape)) {
        out.push(value);
      }
    }
    if (def.catchall !== undefined) {
      out.push(def.catchall as unknown as z.ZodType);
    }
    return out;
  }
  if (def.type === 'array') {
    return [def.element as unknown as z.ZodType];
  }
  if (def.type === 'union') {
    return (def.options as readonly $ZodType[]).map((opt) => opt as unknown as z.ZodType);
  }
  if (def.type === 'intersection') {
    return [def.left as unknown as z.ZodType, def.right as unknown as z.ZodType];
  }
  if (def.type === 'tuple') {
    const out: z.ZodType[] = (def.items as readonly $ZodType[]).map(
      (it) => it as unknown as z.ZodType,
    );
    if (def.rest !== null) {
      out.push(def.rest as unknown as z.ZodType);
    }
    return out;
  }
  if (def.type === 'record' || def.type === 'map') {
    return [def.keyType as unknown as z.ZodType, def.valueType as unknown as z.ZodType];
  }
  if (def.type === 'set') {
    return [def.valueType as unknown as z.ZodType];
  }
  if (def.type === 'pipe') {
    return [def.in as unknown as z.ZodType, def.out as unknown as z.ZodType];
  }
  if (def.type === 'lazy') {
    return [def.getter() as unknown as z.ZodType];
  }
  if (INNER_TYPE_WRAPPERS.has(def.type)) {
    return [(def as { innerType: $ZodType }).innerType as unknown as z.ZodType];
  }
  return [];
};

/**
 * Returns every named descendant of `schema` — sub-schemas carrying
 * `.meta({ id })` reachable through the Zod composition tree, at any depth.
 *
 * Cycle-safe via a visited `WeakSet` keyed by Zod schema identity; safe for
 * `z.lazy` schemas that close over themselves. Leaf types (string, number,
 * enum, literal, custom, transform, …) have no children and are skipped.
 */
export const discoverDependents = (schema: z.ZodType): ReadonlyArray<[z.ZodType, string]> => {
  const visited = new WeakSet<z.ZodType>();
  const out: [z.ZodType, string][] = [];
  const stack: z.ZodType[] = [schema];
  while (stack.length > 0) {
    const current = stack.pop() as z.ZodType;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const child of collectChildren(current)) {
      if (visited.has(child)) {
        continue;
      }
      const id = readId(child);
      if (id !== undefined) {
        out.push([child, id]);
      }
      stack.push(child);
    }
  }
  return out;
};
