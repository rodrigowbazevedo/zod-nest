import type { $ZodTypes } from 'zod/v4/core';
import type { SchemaObject } from './openapi.types.js';

export interface OverrideContext {
  zodSchema: $ZodTypes;
  jsonSchema: SchemaObject;
  path: (string | number)[];
}

export type Override = (ctx: OverrideContext) => void;

/**
 * Type-driven override for primitive Zod constructs that JSON Schema can't
 * represent directly (bigint → integer, date → string + date-time format).
 * Composition's `allOf`-form emission lives in `composition.ts`; the engine
 * combines both into the full override chain per call site (since composition
 * needs a uri-aware `buildRef` that differs between single-schema and bulk
 * emission).
 */
export const primitiveOverride: Override = ({ zodSchema, jsonSchema }) => {
  const type = zodSchema._zod.def.type;
  if (type === 'bigint') {
    jsonSchema.type = 'integer';
    return;
  }
  if (type === 'date') {
    jsonSchema.type = 'string';
    jsonSchema.format = 'date-time';
    return;
  }
};

export const combine = (...overrides: ReadonlyArray<Override | undefined>): Override => {
  const list: Override[] = [];
  for (const candidate of overrides) {
    if (typeof candidate !== 'function') {
      continue;
    }
    list.push(candidate);
  }
  return (ctx) => {
    for (const o of list) {
      o(ctx);
    }
  };
};
