import type { $ZodTypes } from 'zod/v4/core';
import type { SchemaObject } from './openapi.types.js';

export interface OverrideContext {
  zodSchema: $ZodTypes;
  jsonSchema: SchemaObject;
  path: (string | number)[];
}

export type Override = (ctx: OverrideContext) => void;

export const builtInOverride: Override = ({ zodSchema, jsonSchema }) => {
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

const STRICT_REQUIRES_OVERRIDE: ReadonlySet<string> = new Set([
  'bigint',
  'date',
  'symbol',
  'undefined',
  'void',
  'map',
  'set',
  'transform',
  'nan',
  'custom',
]);

export const isStrictlyUnrepresentable = (
  jsonSchema: SchemaObject,
  zodSchema: $ZodTypes,
): boolean => {
  if (!STRICT_REQUIRES_OVERRIDE.has(zodSchema._zod.def.type)) {
    return false;
  }
  return Object.keys(jsonSchema).length === 0;
};

export const combine = (...overrides: ReadonlyArray<Override | undefined>): Override => {
  const list: Override[] = [];
  for (const candidate of overrides) {
    if (typeof candidate !== 'function') {
      continue;
    }
    list.push(candidate);
  }
  if (list.length === 0) {
    return () => undefined;
  }
  return (ctx) => {
    for (const o of list) {
      o(ctx);
    }
  };
};
