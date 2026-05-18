import { z } from 'zod';

import type { $ZodType, $ZodTypes } from 'zod/v4/core';
import type { SchemaObject } from './openapi.types.js';
import type { Override } from './override.js';
import type { ZodNestRegistry } from './registry.js';

import { createCompositionOverride, DEFAULT_BUILD_REF } from './composition.js';
import { ZOD_NEST_ERROR_DUPLICATE_ID, ZOD_NEST_ERROR_EXTENSION } from './constants.js';
import { createCustomOverride, peekRegistration } from './custom-override.js';
import { ZodNestUnrepresentableError } from './errors.js';
import { combine, primitiveOverride } from './override.js';
import { postProcess } from './post-process.js';

/**
 * Zod constructs that JSON Schema can't represent without an override. When
 * one of these shows up and our combined override chain didn't produce any
 * body for it, strict mode collects the hit and surfaces it as a
 * `ZodNestUnrepresentableError`. Bound to `engine.ts` since the strict-hit
 * collection lives here too.
 */
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

const isStrictlyUnrepresentable = (jsonSchema: SchemaObject, zodSchema: $ZodTypes): boolean => {
  if (!STRICT_REQUIRES_OVERRIDE.has(zodSchema._zod.def.type)) {
    return false;
  }
  return Object.keys(jsonSchema).length === 0;
};

export interface ToOpenApiOptions {
  io: 'input' | 'output';
  registry: ZodNestRegistry;
  override?: Override;
  strict?: boolean;
}

export interface ToOpenApiResult {
  schema: SchemaObject;
  refs: Map<string, SchemaObject>;
}

interface UnrepresentableHit {
  path: (string | number)[];
  zodType: string;
  /**
   * Schema instance that emitted empty. Kept so `consumeUnrepresentable`
   * can drop hits whose outer pipe later marked them covered — pipes process
   * inner before outer in reverse-seen order, so the inner's hit fires
   * before the outer pipe gets to declare coverage.
   */
  zodSchema: $ZodType;
}

/**
 * Mark a pipe's descent target as covered by an outer registration when
 * the override for the outer pipe fires. Recurses for nested
 * pipe-of-pipe chains (e.g. `pipe(pipe2, transform)`) so the deep inner
 * descent target also has its strict-mode hit suppressed.
 *
 * Mirrors Zod's `pipeProcessor` descent rules (`json-schema-processors.js`):
 *   - `io === 'output'` → cover `def.out`
 *   - `io === 'input'`  → cover `def.out` when `def.in` is a `$ZodTransform`
 *     (Zod skips preprocessing on input emission), else `def.in`.
 */
const markPipeCoverage = (
  schema: $ZodType,
  io: 'input' | 'output',
  covered: WeakSet<$ZodType>,
): void => {
  const def = schema._zod.def as { type: string; in?: $ZodType; out?: $ZodType };
  if (def.type !== 'pipe' || def.in === undefined || def.out === undefined) {
    return;
  }
  const target =
    io === 'output' ? def.out : def.in._zod.traits.has('$ZodTransform') ? def.out : def.in;
  if (covered.has(target)) {
    return;
  }
  covered.add(target);
  markPipeCoverage(target, io, covered);
};

/**
 * Parameters for `buildToJsonSchemaOptions` — the shared option-bag builder
 * used by both `toOpenApi` (single-schema mode) and `bulkEmit` (registry-mode).
 * Centralizes the override chain, unrepresentable detection,
 * metadata wiring, and target/cycles defaults so both paths emit equivalent
 * JSON Schema for the same input.
 */
export interface BuildToJsonSchemaOptionsParams {
  registry: ZodNestRegistry;
  io: 'input' | 'output';
  override?: Override;
  strict?: boolean;
  /**
   * Zod's strategy for anonymous reused sub-schemas. Both single-schema and
   * bulk modes use `'inline'` — `'ref'` extracts anonymous reused branches
   * into a virtual `__shared/$defs` table whose refs don't resolve against
   * `components.schemas`, producing dangling refs. Registered schemas
   * (`metadata.id` present) always go through the `uri` callback regardless,
   * so DTO-to-DTO `$ref`s are unaffected.
   */
  reused: 'inline' | 'ref';
  /** Bulk-mode only — shapes internal `$ref`s to `#/components/schemas/<id>`. */
  uri?: (id: string) => string;
}

export interface BuiltJsonSchemaOptions {
  options: NonNullable<Parameters<typeof z.toJSONSchema>[1]>;
  /** Throws `ZodNestUnrepresentableError` if any strict-unrepresentable hit was collected during emission. */
  consumeUnrepresentable(): void;
}

export const buildToJsonSchemaOptions = (
  params: BuildToJsonSchemaOptionsParams,
): BuiltJsonSchemaOptions => {
  const strict = params.strict ?? true;
  // Composition's `buildRef` differs between single-schema and bulk modes:
  // single-schema emits `#/$defs/<id>` (post-process rewrites to
  // `#/components/schemas/<id>`); bulk emits `#/components/schemas/<id>`
  // directly via the configured `uri` callback (post-process is skipped).
  const compositionOverride = createCompositionOverride({
    buildRef: params.uri ?? DEFAULT_BUILD_REF,
    registry: params.registry,
  });
  // Chain order matches precedence (left → right, last-write-wins mutation
  // semantics). Caller's `params.override` runs last so per-call overrides
  // remain the ultimate escape hatch; `customOverride` consults the
  // `overrideJSONSchema(...)` registration map (parameterized by `io` so it
  // can pick divergent input/output fragments) and clobbers the built-in
  // primitive/composition mappings for the registered schema instance.
  const customOverride = createCustomOverride(params.io);
  const merged = combine(primitiveOverride, compositionOverride, customOverride, params.override);
  const unrepresentableHits: UnrepresentableHit[] = [];
  // Inner descent targets shadowed by an outer pipe registration. Populated
  // JIT during traversal: Zod processes inner-before-outer in reverse-seen
  // order, but `consumeUnrepresentable` runs only after traversal completes,
  // so by then the outer pipe's coverage declaration has landed.
  const coveredByPipe = new WeakSet<$ZodType>();

  const wrapped: Override = (ctx) => {
    merged(ctx);
    if (ctx.zodSchema._zod.def.type === 'pipe') {
      const record = peekRegistration(ctx.zodSchema);
      if (record !== undefined && record[params.io] !== undefined) {
        markPipeCoverage(ctx.zodSchema, params.io, coveredByPipe);
      }
    }
    if (!strict || !isStrictlyUnrepresentable(ctx.jsonSchema, ctx.zodSchema)) {
      return;
    }
    unrepresentableHits.push({
      path: [...ctx.path],
      zodType: ctx.zodSchema._zod.def.type,
      zodSchema: ctx.zodSchema,
    });
  };

  const options: NonNullable<Parameters<typeof z.toJSONSchema>[1]> = {
    target: 'draft-2020-12',
    io: params.io,
    unrepresentable: 'any',
    metadata: params.registry.zodRegistry,
    override: wrapped,
    cycles: 'ref',
    reused: params.reused,
  };
  if (params.uri !== undefined) {
    options.uri = params.uri;
  }

  return {
    options,
    consumeUnrepresentable: () => {
      const firstHit = unrepresentableHits.find((hit) => !coveredByPipe.has(hit.zodSchema));
      if (firstHit !== undefined) {
        throw new ZodNestUnrepresentableError(firstHit.path, firstHit.zodType);
      }
    },
  };
};

export const toOpenApi = (schema: z.ZodType, opts: ToOpenApiOptions): ToOpenApiResult => {
  const built = buildToJsonSchemaOptions({
    registry: opts.registry,
    io: opts.io,
    override: opts.override,
    strict: opts.strict,
    reused: 'inline',
  });
  const raw = z.toJSONSchema(schema, built.options);
  built.consumeUnrepresentable();

  const result = postProcess(raw);

  for (const [id] of opts.registry.getCollisions()) {
    if (!result.refs.has(id)) {
      continue;
    }
    result.refs.set(id, {
      description: `ERROR: duplicate zod-nest id <${id}>`,
      [ZOD_NEST_ERROR_EXTENSION]: ZOD_NEST_ERROR_DUPLICATE_ID,
    });
  }

  return result;
};
