import { z } from 'zod';

/**
 * How the pipe and interceptor run a schema. `'auto'` parses sync-first only
 * when `zod/compile` (or an explicit `z.compile` clone) is in play.
 */
export type ParseMode = 'auto' | 'sync-first' | 'async';

export const DEFAULT_PARSE_MODE: ParseMode = 'auto';

// Schemas that already threw `$ZodAsyncError`, so later parses skip the sync attempt.
const asyncSchemas = new WeakMap<z.ZodType, true>();

// `postProcessor` is untyped on the zod 4.4 floor, hence the `in` guard.
const isGlobalCompileActive = (): boolean => {
  const config = z.core.globalConfig;
  return (
    'postProcessor' in config &&
    typeof config.postProcessor === 'function' &&
    config.jitless !== true
  );
};

/** `bag.validator` is zod-internal, set on `z.compile` clones; best-effort detection. */
const isSchemaCompiled = (schema: z.ZodType): boolean => schema._zod.bag.validator !== undefined;

export const isCompileActive = (schema: z.ZodType): boolean =>
  isGlobalCompileActive() || isSchemaCompiled(schema);

const shouldParseSyncFirst = (schema: z.ZodType, mode: ParseMode): boolean => {
  if (mode === 'async' || asyncSchemas.has(schema)) {
    return false;
  }
  if (mode === 'sync-first') {
    return true;
  }
  return isCompileActive(schema);
};

/**
 * `safeParseAsync` bypasses zod's compiled fast path, so parse sync when it can
 * apply and fall back to async for schemas with async refinements/transforms.
 */
export const safeParseWithMode = async (
  schema: z.ZodType,
  value: unknown,
  mode: ParseMode,
): Promise<z.ZodSafeParseResult<unknown>> => {
  if (!shouldParseSyncFirst(schema, mode)) {
    return schema.safeParseAsync(value);
  }
  try {
    return schema.safeParse(value);
  } catch (err) {
    if (!(err instanceof z.core.$ZodAsyncError)) {
      throw err;
    }
    asyncSchemas.set(schema, true);
    return schema.safeParseAsync(value);
  }
};
