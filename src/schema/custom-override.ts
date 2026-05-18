import type { z } from 'zod';
import type { $ZodType } from 'zod/v4/core';
import type { SchemaObject } from './openapi.types.js';
import type { Override } from './override.js';

/**
 * Argument shape for {@link overrideJSONSchema}. Two forms:
 *
 * - A raw `SchemaObject` — applied to both input and output emission.
 * - A `{ input?, output? }` wrapper — distinct fragments per emission side,
 *   for coercion shapes where input and output diverge (e.g.
 *   `z.union([z.array(item), item.transform((v) => [v])])` accepts
 *   `T | T[]` on input but always emits `T[]` on output).
 *
 * The wrapper form is detected by the presence of an `input` or `output`
 * key. Neither is a JSON Schema / OpenAPI 3.1 keyword, so the discriminator
 * is unambiguous in practice.
 */
export type OverrideJSONSchemaArg = SchemaObject | { input?: SchemaObject; output?: SchemaObject };

interface StoredFragments {
  input?: SchemaObject;
  output?: SchemaObject;
}

/**
 * Per-instance JSON Schema registration store. Keyed by the Zod core type
 * (`$ZodType`) because that's what the override sees on `ctx.zodSchema`;
 * `z.ZodType` widens to `$ZodType` without a cast at the public API boundary.
 * Same WeakMap pattern as `composition.ts`'s `lineageMap`
 * (CLAUDE.md: "transient, per-instance → WeakMap").
 *
 * Value holds the per-direction fragments separately so the override factory
 * can pick the right one without surfacing `io` on `OverrideContext`.
 */
const customOverrideMap = new WeakMap<$ZodType, StoredFragments>();

const isWrapper = (
  arg: OverrideJSONSchemaArg,
): arg is { input?: SchemaObject; output?: SchemaObject } => 'input' in arg || 'output' in arg;

/**
 * Register a fixed JSON Schema fragment for a specific Zod schema instance.
 *
 * Designed for shapes JSON Schema can't model directly — `z.custom<T>()` and
 * `z.instanceof(...)` (e.g. multipart `File` fields) — which Zod emits as `{}`,
 * tripping `ZodNestUnrepresentableError` in strict mode. Also useful for
 * coercion shapes where input and output diverge (`singleOrArray`-style
 * helpers).
 *
 * Two call shapes:
 *
 * ```ts
 * // 1. Single fragment — applied verbatim to both input and output emission.
 * overrideJSONSchema(FileSchema, { type: 'string', format: 'binary' });
 *
 * // 2. Divergent fragments — separate fragments per emission side. Omit a
 * //    side to leave Zod's default emission untouched on that side.
 * overrideJSONSchema(arrayOrItem, {
 *   input:  { anyOf: [arrFrag, itemFrag] },
 *   output: arrFrag,
 * });
 * ```
 *
 * Idempotent: subsequent calls for the same schema overwrite the prior
 * registration (last-write-wins).
 */
export const overrideJSONSchema = (schema: z.ZodType, arg: OverrideJSONSchemaArg): void => {
  if (isWrapper(arg)) {
    customOverrideMap.set(schema, { input: arg.input, output: arg.output });
    return;
  }
  customOverrideMap.set(schema, { input: arg, output: arg });
};

/**
 * Internal override factory consulted by the engine. Closes over the current
 * emission direction so the lookup can pick the right registered fragment
 * without surfacing `io` on the `OverrideContext` public contract. Mirrors
 * `createCompositionOverride` at `engine.ts:98`.
 *
 * Mutates `ctx.jsonSchema` in-place (clears existing keys, then assigns the
 * fragment) because Zod's override pipeline doesn't propagate
 * `ctx.jsonSchema = newObj` reassignments — only mutations on the existing
 * object reach the caller (see `composition.ts` for the same constraint).
 *
 * No-ops if the schema isn't registered, or if the registered record has no
 * fragment for the current `io` direction.
 */
export const createCustomOverride = (io: 'input' | 'output'): Override => {
  return ({ zodSchema, jsonSchema }) => {
    const record = customOverrideMap.get(zodSchema);
    if (record === undefined) {
      return;
    }
    const fragment = record[io];
    if (fragment === undefined) {
      return;
    }
    for (const key of Object.keys(jsonSchema)) {
      Reflect.deleteProperty(jsonSchema, key);
    }
    Object.assign(jsonSchema, fragment);
  };
};
