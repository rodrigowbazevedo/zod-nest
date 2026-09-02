import type { z } from 'zod';

/**
 * Per-instance tag for schemas produced by the platform file factories.
 * WeakSet rather than `z.registry` because this is transient per-instance
 * annotation, not stable id-keyed metadata (CLAUDE.md).
 */
const fileSchemas = new WeakSet<z.ZodType>();

// Wrapper defs expose their inner schema as Zod's internal `$ZodType`, which
// the `in` narrowing widens to `unknown`. Guarding is the cast-free way back
// to the public type.
const isZodType = (value: unknown): value is z.ZodType =>
  value !== null && typeof value === 'object' && '_zod' in value;

const unwrapOnce = (schema: z.ZodType): z.ZodType | undefined => {
  const def = schema._zod.def;
  if ('innerType' in def) {
    return isZodType(def.innerType) ? def.innerType : undefined;
  }
  if ('element' in def) {
    return isZodType(def.element) ? def.element : undefined;
  }
  return undefined;
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
