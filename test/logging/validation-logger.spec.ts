import { z } from 'zod';

import type { LoggerService } from '@nestjs/common';

import {
  createValidationLogger,
  noopLogValidationFailure,
} from '../../src/logging/validation-logger.js';

const failingError = (): z.ZodError => {
  const schema = z.object({ name: z.string() });
  const result = schema.safeParse({ name: 42 });
  if (result.success) {
    throw new Error('fixture parsed unexpectedly');
  }
  return result.error;
};

const makeFakeLogger = (): jest.Mocked<LoggerService> => ({
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
});

describe('createValidationLogger', () => {
  it('routes output severity=error through logger.error with ZodSerializerInterceptor context', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({ logger, redactKeys: [], maxLoggedValueBytes: 4096 });

    log(failingError(), { name: 42 }, { side: 'output', severity: 'error', dto: 'UserDto' });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    const [payload, stack, context] = logger.error.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      message: 'Response validation failed',
      side: 'output',
      dto: 'UserDto',
    });
    expect(stack).toBeUndefined();
    expect(context).toBe('ZodSerializerInterceptor');
  });

  it('routes input severity=warn through logger.warn with ZodValidationPipe context', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({ logger, redactKeys: [], maxLoggedValueBytes: 4096 });

    log(
      failingError(),
      { name: 42 },
      { side: 'input', severity: 'warn', dto: 'UserDto', argType: 'body' },
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    const [payload, context] = logger.warn.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      message: 'Request validation failed',
      side: 'input',
      dto: 'UserDto',
      argType: 'body',
    });
    expect(context).toBe('ZodValidationPipe');
  });

  it('includes status + handler on output payload, argType on input payload', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({ logger, redactKeys: [], maxLoggedValueBytes: 4096 });

    log(
      failingError(),
      {},
      {
        side: 'output',
        severity: 'error',
        dto: 'UserDto',
        status: 500,
        handler: 'UsersController.get',
      },
    );

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect(payload).toMatchObject({ status: 500, handler: 'UsersController.get' });
    expect(payload).not.toHaveProperty('argType');
  });

  it('treeifies the zod error into the payload', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({ logger, redactKeys: [], maxLoggedValueBytes: 4096 });
    const err = failingError();

    log(err, { name: 42 }, { side: 'output', severity: 'error', dto: 'UserDto' });

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { errors: unknown }).errors).toEqual(z.treeifyError(err));
  });

  it('redacts default-listed keys case-insensitively at any depth', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({
      logger,
      redactKeys: ['password', 'apiKey', 'authorization'],
      maxLoggedValueBytes: 4096,
    });

    log(
      failingError(),
      {
        Password: 'p',
        nested: { APIKEY: 'k', user: { Authorization: 'Bearer x', name: 'ok' } },
        list: [{ password: 'q' }],
      },
      { side: 'output', severity: 'error', dto: 'UserDto' },
    );

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: unknown }).value).toEqual({
      Password: '[REDACTED]',
      nested: { APIKEY: '[REDACTED]', user: { Authorization: '[REDACTED]', name: 'ok' } },
      list: [{ password: '[REDACTED]' }],
    });
  });

  it('replaces (does not merge) the redact list when overridden', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({
      logger,
      redactKeys: ['onlyThisOne'],
      maxLoggedValueBytes: 4096,
    });

    log(
      failingError(),
      { onlyThisOne: 'redacted', password: 'leaked' },
      { side: 'output', severity: 'error', dto: 'UserDto' },
    );

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: unknown }).value).toEqual({
      onlyThisOne: '[REDACTED]',
      password: 'leaked',
    });
  });

  it('caps oversized values with a truncation envelope', () => {
    const logger = makeFakeLogger();
    const maxLoggedValueBytes = 256;
    const log = createValidationLogger({ logger, redactKeys: [], maxLoggedValueBytes });

    const giant = { blob: 'x'.repeat(5000) };
    log(failingError(), giant, { side: 'output', severity: 'error', dto: 'UserDto' });

    const [payload] = logger.error.mock.calls[0] ?? [];
    const value = (payload as { value: unknown }).value;
    expect(value).toMatchObject({ _truncated: true });
    expect((value as { _originalBytes: number })._originalBytes).toBeGreaterThan(
      maxLoggedValueBytes,
    );
    expect(typeof (value as { _preview: unknown })._preview).toBe('string');
  });

  it('replaces circular refs with a [CIRCULAR] marker (no stack overflow)', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({ logger, redactKeys: [], maxLoggedValueBytes: 4096 });

    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    log(failingError(), cyclic, { side: 'output', severity: 'error', dto: 'UserDto' });

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: unknown }).value).toEqual({ name: 'root', self: '[CIRCULAR]' });
  });

  it('handles cycles inside arrays', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({ logger, redactKeys: [], maxLoggedValueBytes: 4096 });

    const arr: unknown[] = [1];
    arr.push(arr);
    log(failingError(), { items: arr }, { side: 'output', severity: 'error', dto: 'UserDto' });

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: unknown }).value).toEqual({ items: [1, '[CIRCULAR]'] });
  });

  it('returns the unserializable envelope when JSON.stringify throws (e.g. BigInt)', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({ logger, redactKeys: [], maxLoggedValueBytes: 4096 });

    log(failingError(), { big: 10n }, { side: 'output', severity: 'error', dto: 'UserDto' });

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: unknown }).value).toEqual({
      _truncated: true,
      _originalBytes: -1,
      _reason: 'unserializable',
    });
  });

  it('passes-through unmodified when JSON.stringify returns undefined', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({ logger, redactKeys: [], maxLoggedValueBytes: 4096 });

    log(failingError(), undefined, { side: 'output', severity: 'error', dto: 'UserDto' });

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: unknown }).value).toBeUndefined();
  });

  it('passes the under-cap value through structurally', () => {
    const logger = makeFakeLogger();
    const log = createValidationLogger({ logger, redactKeys: [], maxLoggedValueBytes: 4096 });
    const small = { tiny: true };

    log(failingError(), small, { side: 'output', severity: 'error', dto: 'UserDto' });

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: unknown }).value).toEqual({ tiny: true });
  });

  it('falls back to NestJS Logger when no logger is supplied', () => {
    const log = createValidationLogger({ redactKeys: [], maxLoggedValueBytes: 4096 });
    expect(() =>
      log(failingError(), { x: 1 }, { side: 'output', severity: 'error', dto: 'UserDto' }),
    ).not.toThrow();
  });
});

describe('noopLogValidationFailure', () => {
  it('returns undefined and is safely callable', () => {
    expect(
      noopLogValidationFailure(
        failingError(),
        { x: 1 },
        {
          side: 'output',
          severity: 'error',
          dto: 'UserDto',
        },
      ),
    ).toBeUndefined();
  });
});
