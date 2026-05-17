import { z } from 'zod';

import type { LoggerService } from '@nestjs/common';

import { noopLogValidationFailure } from '../../src/logging/validation-logger.js';
import {
  DEFAULT_MAX_LOGGED_VALUE_BYTES,
  DEFAULT_REDACT_KEYS,
  normalizeZodNestOptions,
  ZOD_NEST_OPTIONS,
} from '../../src/module/options.js';

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

describe('normalizeZodNestOptions', () => {
  it('returns no-op loggers when validationLogs is undefined', () => {
    const opts = normalizeZodNestOptions();

    expect(opts.logInputFailure).toBe(noopLogValidationFailure);
    expect(opts.logOutputFailure).toBe(noopLogValidationFailure);
    expect(opts.createValidationException).toBeUndefined();
    expect(opts.createSerializationException).toBeUndefined();
  });

  it('enables both sides when validationLogs is `true`', () => {
    const logger = makeFakeLogger();
    const opts = normalizeZodNestOptions({ validationLogs: true, logger });

    opts.logInputFailure(failingError(), {}, { side: 'input', severity: 'warn', dto: 'D' });
    opts.logOutputFailure(failingError(), {}, { side: 'output', severity: 'error', dto: 'D' });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('honors granular `{ input: true, output: false }`', () => {
    const logger = makeFakeLogger();
    const opts = normalizeZodNestOptions({
      validationLogs: { input: true, output: false },
      logger,
    });

    expect(opts.logOutputFailure).toBe(noopLogValidationFailure);
    opts.logInputFailure(failingError(), {}, { side: 'input', severity: 'warn', dto: 'D' });

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('honors granular `{ output: true }` with input omitted (defaults off)', () => {
    const logger = makeFakeLogger();
    const opts = normalizeZodNestOptions({
      validationLogs: { output: true },
      logger,
    });

    expect(opts.logInputFailure).toBe(noopLogValidationFailure);
    opts.logOutputFailure(failingError(), {}, { side: 'output', severity: 'error', dto: 'D' });

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('passes-through the exception factories untouched', () => {
    const inputFactory = jest.fn();
    const outputFactory = jest.fn();
    const opts = normalizeZodNestOptions({
      createValidationException: inputFactory,
      createSerializationException: outputFactory,
    });

    expect(opts.createValidationException).toBe(inputFactory);
    expect(opts.createSerializationException).toBe(outputFactory);
  });

  it('applies user-supplied redactKeys (replaces the default list)', () => {
    const logger = makeFakeLogger();
    const opts = normalizeZodNestOptions({
      validationLogs: { output: true },
      logger,
      redactKeys: ['onlyThisOne'],
    });

    opts.logOutputFailure(
      failingError(),
      { onlyThisOne: 'redacted', password: 'leaked' },
      { side: 'output', severity: 'error', dto: 'D' },
    );

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: unknown }).value).toEqual({
      onlyThisOne: '[REDACTED]',
      password: 'leaked',
    });
  });

  it('applies the default redact list when option omitted', () => {
    const logger = makeFakeLogger();
    const opts = normalizeZodNestOptions({ validationLogs: { output: true }, logger });

    opts.logOutputFailure(
      failingError(),
      { password: 'leaked', other: 'shown' },
      { side: 'output', severity: 'error', dto: 'D' },
    );

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: unknown }).value).toEqual({
      password: '[REDACTED]',
      other: 'shown',
    });
  });

  it('exposes DEFAULT_REDACT_KEYS and DEFAULT_MAX_LOGGED_VALUE_BYTES', () => {
    expect(DEFAULT_REDACT_KEYS).toContain('password');
    expect(DEFAULT_REDACT_KEYS).toContain('apiKey');
    expect(DEFAULT_MAX_LOGGED_VALUE_BYTES).toBe(4096);
  });

  it('redacts auth + session token patterns by default (security-sensitive keys)', () => {
    const logger = makeFakeLogger();
    const opts = normalizeZodNestOptions({ validationLogs: { output: true }, logger });

    opts.logOutputFailure(
      failingError(),
      {
        accessToken: 'a',
        refreshToken: 'r',
        Bearer: 'b',
        jwt: 'j',
        Cookie: 'c',
        'set-cookie': 's',
        keep: 'shown',
      },
      { side: 'output', severity: 'error', dto: 'D' },
    );

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: unknown }).value).toEqual({
      accessToken: '[REDACTED]',
      refreshToken: '[REDACTED]',
      Bearer: '[REDACTED]',
      jwt: '[REDACTED]',
      Cookie: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      keep: 'shown',
    });
  });

  it('instantiates a default NestJS Logger when none is supplied (no throw)', () => {
    const opts = normalizeZodNestOptions({ validationLogs: true });
    expect(() =>
      opts.logOutputFailure(
        failingError(),
        { x: 1 },
        { side: 'output', severity: 'error', dto: 'D' },
      ),
    ).not.toThrow();
  });

  it('ZOD_NEST_OPTIONS is a Symbol DI token', () => {
    expect(typeof ZOD_NEST_OPTIONS).toBe('symbol');
  });
});
