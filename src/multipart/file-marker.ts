import type { z } from 'zod';

/**
 * Per-instance tag for schemas produced by the platform file factories.
 * WeakSet rather than `z.registry` because this is transient per-instance
 * annotation, not stable id-keyed metadata (CLAUDE.md).
 */
const fileSchemas = new WeakSet<z.ZodType>();

const WRAPPER_TYPES = new Set(['optional', 'nullable', 'default', 'array', 'readonly']);

const isZodType = (value: unknown): value is z.ZodType =>
  value !== null && typeof value === 'object' && '_zod' in value;

const unwrapOnce = (schema: z.ZodType): z.ZodType | undefined => {
  const def: unknown = schema._zod.def;
  if (def === null || typeof def !== 'object' || !('type' in def)) {
    return undefined;
  }
  if (typeof def.type !== 'string' || !WRAPPER_TYPES.has(def.type)) {
    return undefined;
  }
  if ('innerType' in def && isZodType(def.innerType)) {
    return def.innerType;
  }
  if ('element' in def && isZodType(def.element)) {
    return def.element;
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
