import { Logger } from '@nestjs/common';

import type { ArgumentMetadata, ExecutionContext, LoggerService } from '@nestjs/common';
import type { z } from 'zod';
import type { LogValidationFailure } from '../logging/validation-logger.js';
import type { StreamContentTypeMatcher } from '../response/stream.js';

import {
  createValidationLogger,
  DEFAULT_LOGGER_CONTEXT,
  noopLogValidationFailure,
} from '../logging/validation-logger.js';
import { DEFAULT_STREAM_CONTENT_TYPES, normalizeStreamMatcher } from '../response/stream.js';

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
  /**
   * Additional response content types treated as streams — written directly
   * to the response buffer and never validated by `ZodSerializerInterceptor`.
   * MERGED with the built-in `DEFAULT_STREAM_CONTENT_TYPES` (SSE, NDJSON,
   * octet-stream, pdf, `image/*`, `audio/*`, `video/*`), so the defaults are
   * always retained. A trailing `/*` entry matches a media-type family.
   */
  streamContentTypes?: readonly string[];
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
  /** Built-in defaults ∪ `streamContentTypes`, used by the interceptor's stream check. */
  streamMatcher: StreamContentTypeMatcher;
}

export const DEFAULT_REDACT_KEYS: readonly string[] = [
  // Credentials
  'password',
  'secret',
  'apiKey',
  // Auth headers + tokens
  'authorization',
  'bearer',
  'token',
  'accessToken',
  'refreshToken',
  'jwt',
  // Session cookies
  'cookie',
  'set-cookie',
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
  const logger: LoggerService = opts?.logger ?? new Logger(DEFAULT_LOGGER_CONTEXT);
  const loggerOpts = { logger, redactKeys, maxLoggedValueBytes };
  const streamMatcher = normalizeStreamMatcher([
    ...DEFAULT_STREAM_CONTENT_TYPES,
    ...(opts?.streamContentTypes ?? []),
  ]);

  return {
    createValidationException: opts?.createValidationException,
    createSerializationException: opts?.createSerializationException,
    logInputFailure: flags.input ? createValidationLogger(loggerOpts) : noopLogValidationFailure,
    logOutputFailure: flags.output ? createValidationLogger(loggerOpts) : noopLogValidationFailure,
    streamMatcher,
  };
};
