import { z } from 'zod';

import type { Override } from '../schema/override.js';
import type { ZodNestRegistry } from '../schema/registry.js';

import { buildToJsonSchemaOptions } from '../schema/engine.js';

export interface BulkEmitOptions {
  registry: ZodNestRegistry;
  override?: Override;
  /** When `true` (default), unrepresentable Zod constructs throw `ZodNestUnrepresentableError`. */
  strict?: boolean;
}

export interface BulkEmitResult {
  /** Schemas emitted with `io: 'input'`. Filtered to zod-nest-known ids only. */
  inputSchemas: Map<string, unknown>;
  /** Schemas emitted with `io: 'output'`. Filtered to zod-nest-known ids only. */
  outputSchemas: Map<string, unknown>;
}

const URI = (id: string): string => `#/components/schemas/${id}`;

/**
 * Two-pass bulk emission against the registry's underlying `z.globalRegistry`.
 * Returns one map per io. Result is filtered to the ids zod-nest itself
 * registered (via `registry.ids()`) — `z.globalRegistry` may hold third-party
 * entries we don't own.
 *
 * Uses `buildToJsonSchemaOptions` so emission semantics (override chain,
 * cycles, unrepresentable detection, metadata) match the single-schema
 * `toOpenApi` path. `reused: 'ref'` + the `uri` callback shape every
 * internal `$ref` directly to `#/components/schemas/<id>` — Phase 2e's
 * doc-level refs need no rewrite at emission time.
 */
export const bulkEmit = (opts: BulkEmitOptions): BulkEmitResult => {
  const knownIds = new Set(opts.registry.ids());
  return {
    inputSchemas: runPass(opts, 'input', knownIds),
    outputSchemas: runPass(opts, 'output', knownIds),
  };
};

const runPass = (
  opts: BulkEmitOptions,
  io: 'input' | 'output',
  knownIds: ReadonlySet<string>,
): Map<string, unknown> => {
  const built = buildToJsonSchemaOptions({
    registry: opts.registry,
    io,
    override: opts.override,
    strict: opts.strict,
    reused: 'ref',
    uri: URI,
  });
  const raw = z.toJSONSchema(opts.registry.zodRegistry, built.options) as {
    schemas?: Record<string, unknown>;
  };
  built.consumeUnrepresentable();

  const filtered = new Map<string, unknown>();
  const schemas = raw.schemas ?? {};
  for (const id of knownIds) {
    if (Object.prototype.hasOwnProperty.call(schemas, id)) {
      filtered.set(id, schemas[id]);
    }
  }
  return filtered;
};
