import { z } from 'zod';

import type { SchemaObject } from './openapi.types.js';
import type { Override } from './override.js';
import type { ZodNestRegistry } from './registry.js';

import { ZOD_NEST_ERROR_DUPLICATE_ID, ZOD_NEST_ERROR_EXTENSION } from './constants.js';
import { ZodNestUnrepresentableError } from './errors.js';
import { builtInOverride, combine, isStrictlyUnrepresentable } from './override.js';
import { postProcess } from './post-process.js';

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
}

/**
 * Parameters for `buildToJsonSchemaOptions` — the shared option-bag builder
 * used by both `toOpenApi` (single-schema mode) and Phase 2e's `bulkEmit`
 * (registry-mode). Centralizes the override chain, unrepresentable detection,
 * metadata wiring, and target/cycles defaults so both paths emit equivalent
 * JSON Schema for the same input.
 */
export interface BuildToJsonSchemaOptionsParams {
  registry: ZodNestRegistry;
  io: 'input' | 'output';
  override?: Override;
  strict?: boolean;
  /** Single-schema mode inlines reused branches; bulk mode prefers shared refs. */
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
  const merged = combine(builtInOverride, params.override);
  const unrepresentableHits: UnrepresentableHit[] = [];

  const wrapped: Override = (ctx) => {
    merged(ctx);
    if (!strict || !isStrictlyUnrepresentable(ctx.jsonSchema, ctx.zodSchema)) {
      return;
    }
    unrepresentableHits.push({
      path: [...ctx.path],
      zodType: ctx.zodSchema._zod.def.type,
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
      const firstHit = unrepresentableHits[0];
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
