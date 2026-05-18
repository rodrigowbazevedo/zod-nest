import type { z } from 'zod';
import type { $ZodType } from 'zod/v4/core';
import type { SchemaObject } from './openapi.types.js';
import type { Override } from './override.js';

/**
 * Per-instance JSON Schema registration store. Keyed by the Zod core type
 * (`$ZodType`) because that's what the override sees on `ctx.zodSchema`;
 * `z.ZodType` widens to `$ZodType` without a cast at the public API boundary.
 * Same WeakMap pattern as `composition.ts`'s `lineageMap`
 * (CLAUDE.md: "transient, per-instance → WeakMap").
 */
const customOverrideMap = new WeakMap<$ZodType, SchemaObject>();

/**
 * Register a fixed JSON Schema fragment for a specific Zod schema instance.
 *
 * Designed for shapes JSON Schema can't model directly — `z.custom<T>()` and
 * `z.instanceof(...)` (e.g. multipart `File` fields) — which Zod emits as `{}`,
 * tripping `ZodNestUnrepresentableError` in strict mode. After registration
 * the engine writes the supplied fragment in-place wherever that schema
 * instance is emitted (single-schema `toOpenApi`, bulk emission, nested
 * inside `z.object({...})`, anywhere).
 *
 * Idempotent: subsequent calls for the same schema overwrite the prior
 * registration (last-write-wins).
 *
 * @example
 *   const FileSchema = z.instanceof(File);
 *   overrideJSONSchema(FileSchema, { type: 'string', format: 'binary' });
 *
 *   class UploadDto extends createZodDto(z.object({ file: FileSchema })) {}
 *   // OpenAPI doc emits `properties.file = { type: 'string', format: 'binary' }`
 */
export const overrideJSONSchema = (schema: z.ZodType, jsonSchema: SchemaObject): void => {
  customOverrideMap.set(schema, jsonSchema);
};

/**
 * Internal override consulted by the engine. Looks up the schema identity
 * in `customOverrideMap` and writes the registered fragment verbatim. Not
 * exported from the public surface — `overrideJSONSchema` is the only
 * consumer-facing handle.
 *
 * Mutates `ctx.jsonSchema` in-place (clears existing keys, then assigns the
 * fragment) because Zod's override pipeline doesn't propagate
 * `ctx.jsonSchema = newObj` reassignments — only mutations on the existing
 * object reach the caller (see `composition.ts` for the same constraint).
 */
export const customOverride: Override = ({ zodSchema, jsonSchema }) => {
  const fragment = customOverrideMap.get(zodSchema);
  if (fragment === undefined) {
    return;
  }
  for (const key of Object.keys(jsonSchema)) {
    Reflect.deleteProperty(jsonSchema, key);
  }
  Object.assign(jsonSchema, fragment);
};
