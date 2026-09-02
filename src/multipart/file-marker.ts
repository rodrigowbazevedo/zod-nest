import type { z } from 'zod';

import { singleton } from '../schema/singleton.js';

/**
 * Per-instance tag for schemas produced by the platform file factories.
 * WeakSet rather than `z.registry` because this is transient per-instance
 * annotation, not stable id-keyed metadata (CLAUDE.md).
 */
const fileSchemas = singleton('file-schemas', () => new WeakSet<z.ZodType>());

// Wrapper defs expose their inner schema as Zod's internal `$ZodType`, which
// `in` narrowing widens to `unknown`. One guard converts back to the public
// type and rejects a non-wrapper in the same step.
const isZodType = (value: unknown): value is z.ZodType =>
  value !== null && typeof value === 'object' && '_zod' in value;

const innerOf = (def: object): unknown => {
  if ('innerType' in def) {
    return def.innerType;
  }
  if ('element' in def) {
    return def.element;
  }
  return undefined;
};

const unwrapOnce = (schema: z.ZodType): z.ZodType | undefined => {
  const inner = innerOf(schema._zod.def);
  return isZodType(inner) ? inner : undefined;
};

export const markFileSchema = <T extends z.ZodType>(schema: T): T => {
  fileSchemas.add(schema);
  return schema;
};

/**
 * True for a factory-produced file schema and for `.optional()` / `.array()`
 * wrappers around one — an optional or repeated file field is still a file
 * field for the request-vs-body split.
 */
export const isFileSchema = (schema: z.ZodType): boolean => {
  if (fileSchemas.has(schema)) {
    return true;
  }
  const inner = unwrapOnce(schema);
  if (inner === undefined) {
    return false;
  }
  return isFileSchema(inner);
};
