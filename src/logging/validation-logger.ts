import { z } from 'zod';

import type { LoggerService } from '@nestjs/common';

export const DEFAULT_LOGGER_CONTEXT = 'ZodValidation';
const REDACTED = '[REDACTED]';
const PREVIEW_RESERVE_BYTES = 100;

export interface ValidationLogContext {
  /** Which side of the request emitted the failure. */
  side: 'input' | 'output';
  /** Severity to log at; the formatter does not decide this. */
  severity: 'warn' | 'error';
  /** Pre-formatted DTO label, e.g. `'UserDto'`, `'[UserDto]'`, `'[A, B]'`. */
  dto: string;
  /** Output side only — HTTP response status code. */
  status?: number;
  /** Output side only — `Controller.method` best-effort. */
  handler?: string;
  /** Input side only — `body` / `query` / `param` / `custom`. */
  argType?: string;
}

export interface ValidationLoggerOptions {
  logger: LoggerService;
  redactKeys: readonly string[];
  maxLoggedValueBytes: number;
}

export type LogValidationFailure = (
  err: z.ZodError,
  value: unknown,
  ctx: ValidationLogContext,
) => void;

export const noopLogValidationFailure: LogValidationFailure = () => {};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const CIRCULAR = '[CIRCULAR]';

const redactValue = (
  value: unknown,
  redactSet: ReadonlySet<string>,
  seen: WeakSet<object> = new WeakSet(),
): unknown => {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR;
    }
    seen.add(value);
    return value.map((item) => redactValue(item, redactSet, seen));
  }
  if (!isPlainRecord(value)) {
    return value;
  }
  if (seen.has(value)) {
    return CIRCULAR;
  }
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (redactSet.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactValue(value[key], redactSet, seen);
  }
  return out;
};

const capLoggedValue = (value: unknown, maxBytes: number): unknown => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { _truncated: true, _originalBytes: -1, _reason: 'unserializable' };
  }
  if (serialized === undefined) {
    return value;
  }
  const byteSize = Buffer.byteLength(serialized, 'utf8');
  if (byteSize <= maxBytes) {
    return value;
  }
  const previewBudget = Math.max(0, maxBytes - PREVIEW_RESERVE_BYTES);
  return {
    _truncated: true,
    _originalBytes: byteSize,
    _preview: serialized.slice(0, previewBudget),
  };
};

const loggerContextFor = (side: 'input' | 'output'): string =>
  side === 'output' ? 'ZodSerializerInterceptor' : 'ZodValidationPipe';

const messageFor = (side: 'input' | 'output'): string =>
  side === 'output' ? 'Response validation failed' : 'Request validation failed';

export const createValidationLogger = (opts: ValidationLoggerOptions): LogValidationFailure => {
  const redactSet = new Set(opts.redactKeys.map((key) => key.toLowerCase()));
  const { logger } = opts;

  return (err, value, ctx) => {
    const redacted = redactValue(value, redactSet);
    const sized = capLoggedValue(redacted, opts.maxLoggedValueBytes);
    const payload: Record<string, unknown> = {
      message: messageFor(ctx.side),
      side: ctx.side,
      dto: ctx.dto,
      errors: z.treeifyError(err),
      value: sized,
    };
    if (ctx.status !== undefined) {
      payload.status = ctx.status;
    }
    if (ctx.handler !== undefined) {
      payload.handler = ctx.handler;
    }
    if (ctx.argType !== undefined) {
      payload.argType = ctx.argType;
    }
    const loggerContext = loggerContextFor(ctx.side);
    if (ctx.severity === 'error') {
      logger.error(payload, undefined, loggerContext);
      return;
    }
    logger.warn(payload, loggerContext);
  };
};
