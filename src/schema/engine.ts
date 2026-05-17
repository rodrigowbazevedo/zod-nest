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

export const toOpenApi = (schema: z.ZodType, opts: ToOpenApiOptions): ToOpenApiResult => {
  const strict = opts.strict ?? true;
  const merged = combine(builtInOverride, opts.override);
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

  const raw = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: opts.io,
    unrepresentable: 'any',
    metadata: opts.registry.zodRegistry,
    override: wrapped,
    cycles: 'ref',
    reused: 'inline',
  });

  const firstHit = unrepresentableHits[0];
  if (firstHit !== undefined) {
    throw new ZodNestUnrepresentableError(firstHit.path, firstHit.zodType);
  }

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
