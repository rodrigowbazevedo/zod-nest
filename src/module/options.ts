import type { ArgumentMetadata, ExecutionContext, LoggerService } from '@nestjs/common';
import type { z } from 'zod';
import type { LogValidationFailure } from '../logging/validation-logger.js';

import { createValidationLogger, noopLogValidationFailure } from '../logging/validation-logger.js';

/**
 * Module-scope factory for the exception thrown by `ZodValidationPipe` on
 * input validation failure. Mirrors the existing per-pipe option but lives
 * at module scope; per-instance constructor arg wins.
 */
export type CreateValidationException = (err: z.ZodError, argMetadata: ArgumentMetadata) => unknown;

/**
 * Module-scope factory for the exception thrown by `ZodSerializerInterceptor`
 * on output validation failure (strict mode only). Soft mode never calls
 * this factory.
 */
export type CreateSerializationException = (
  err: z.ZodError,
  executionContext: ExecutionContext,
) => unknown;

/** Public options accepted by `ZodNestModule.forRoot()`. */
export interface ZodNestModuleOptions {
  createValidationException?: CreateValidationException;
  createSerializationException?: CreateSerializationException;
  /**
   * Failure-only validation logging. `true` enables both input and output;
   * the granular form lets each side be toggled independently. Default: off.
   */
  validationLogs?: boolean | { input?: boolean; output?: boolean };
  /** Override Nest's built-in `Logger` (e.g. pino/winston adapter). */
  logger?: LoggerService;
  /**
   * Keys whose values get scrubbed from logged input/response objects.
   * Matched case-insensitively at any depth. Supplying this option
   * REPLACES the default list (no merge).
   */
  redactKeys?: readonly string[];
  /**
   * Maximum size in bytes (UTF-8) for any single logged value. Oversized
   * values become `{ _truncated: true, _originalBytes, _preview }`.
   */
  maxLoggedValueBytes?: number;
}

/**
 * Resolved options consumed by pipe + interceptor. `forRoot()` builds this
 * once and stuffs it into a provider for the `ZOD_NEST_OPTIONS` injection
 * token; downstream code never re-checks the raw `validationLogs` flag.
 */
export interface NormalizedZodNestOptions {
  createValidationException: CreateValidationException | undefined;
  createSerializationException: CreateSerializationException | undefined;
  /** No-op when `validationLogs.input` resolved to false. */
  logInputFailure: LogValidationFailure;
  /** No-op when `validationLogs.output` resolved to false. */
  logOutputFailure: LogValidationFailure;
}

export const DEFAULT_REDACT_KEYS: readonly string[] = [
  'password',
  'token',
  'authorization',
  'secret',
  'apiKey',
];

export const DEFAULT_MAX_LOGGED_VALUE_BYTES = 4096;

/** DI token for `NormalizedZodNestOptions`. */
export const ZOD_NEST_OPTIONS = Symbol('zod-nest.options');

interface ResolvedFlags {
  input: boolean;
  output: boolean;
}

const resolveLogFlags = (validationLogs: ZodNestModuleOptions['validationLogs']): ResolvedFlags => {
  if (typeof validationLogs === 'boolean') {
    return { input: validationLogs, output: validationLogs };
  }
  return {
    input: validationLogs?.input ?? false,
    output: validationLogs?.output ?? false,
  };
};

export const normalizeZodNestOptions = (opts?: ZodNestModuleOptions): NormalizedZodNestOptions => {
  const flags = resolveLogFlags(opts?.validationLogs);
  const redactKeys = opts?.redactKeys ?? DEFAULT_REDACT_KEYS;
  const maxLoggedValueBytes = opts?.maxLoggedValueBytes ?? DEFAULT_MAX_LOGGED_VALUE_BYTES;
  const loggerOpts = { logger: opts?.logger, redactKeys, maxLoggedValueBytes };

  return {
    createValidationException: opts?.createValidationException,
    createSerializationException: opts?.createSerializationException,
    logInputFailure: flags.input ? createValidationLogger(loggerOpts) : noopLogValidationFailure,
    logOutputFailure: flags.output ? createValidationLogger(loggerOpts) : noopLogValidationFailure,
  };
};
