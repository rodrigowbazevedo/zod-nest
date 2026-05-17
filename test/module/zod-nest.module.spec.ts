import 'reflect-metadata';

import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import {
  ZOD_NEST_OPTIONS,
  ZodNestModule,
  ZodSerializerInterceptor,
  ZodValidationPipe,
} from '../../src';
import { noopLogValidationFailure } from '../../src/logging/validation-logger.js';

describe('ZodNestModule.forRoot()', () => {
  it('returns a DynamicModule with APP_PIPE + APP_INTERCEPTOR + ZOD_NEST_OPTIONS providers', () => {
    const dyn = ZodNestModule.forRoot();

    expect(dyn.module).toBe(ZodNestModule);
    expect(dyn.global).toBe(true);
    const providerTokens = dyn.providers?.map((p) =>
      typeof p === 'function' ? p : (p as { provide: unknown }).provide,
    );
    expect(providerTokens).toContain(ZOD_NEST_OPTIONS);
    expect(providerTokens).toContain(APP_PIPE);
    expect(providerTokens).toContain(APP_INTERCEPTOR);
    expect(dyn.exports).toContain(ZOD_NEST_OPTIONS);
  });

  it('normalizes options into ZOD_NEST_OPTIONS (no-op loggers when validationLogs is undefined)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ZodNestModule.forRoot()],
    }).compile();

    const opts = moduleRef.get(ZOD_NEST_OPTIONS);
    expect(opts.logInputFailure).toBe(noopLogValidationFailure);
    expect(opts.logOutputFailure).toBe(noopLogValidationFailure);
  });

  it('resolves the pipe + interceptor as injectable providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ZodNestModule.forRoot()],
      providers: [ZodValidationPipe, ZodSerializerInterceptor],
    }).compile();

    expect(moduleRef.get(ZodValidationPipe)).toBeInstanceOf(ZodValidationPipe);
    expect(moduleRef.get(ZodSerializerInterceptor)).toBeInstanceOf(ZodSerializerInterceptor);
  });

  it('passes the explicit options through to ZOD_NEST_OPTIONS', async () => {
    const createSerializationException = jest.fn();
    const moduleRef = await Test.createTestingModule({
      imports: [ZodNestModule.forRoot({ createSerializationException })],
    }).compile();

    const opts = moduleRef.get(ZOD_NEST_OPTIONS);
    expect(opts.createSerializationException).toBe(createSerializationException);
  });
});
