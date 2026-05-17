import 'reflect-metadata';

import { Reflector } from '@nestjs/core';
import { z } from 'zod';

import type { ResponseVariant } from '../../src/response/metadata.js';

import { createZodDto } from '../../src';
import { ZodSerializerInterceptor } from '../../src/interceptors/serializer.interceptor.js';
import { normalizeZodNestOptions } from '../../src/module/options.js';
import { ZOD_RESPONSES_METADATA_KEY } from '../../src/response/metadata.js';
import { collect, makeContext, makeFakeLogger, makeNext, makeThrowingNext } from './helpers.js';

class Dto extends createZodDto(z.object({ id: z.string() }), { id: 'Passthrough_Dto' }) {}

const attach = (handler: object, variants: ResponseVariant[]): void => {
  Reflect.defineMetadata(ZOD_RESPONSES_METADATA_KEY, variants, handler);
};

const variant200: ResponseVariant = {
  status: 200,
  kind: 'single',
  dto: Dto,
  validationSchema: Dto.schema,
  passthroughOnError: false,
};

describe('ZodSerializerInterceptor — no-match pass-through', () => {
  it('emits the original value when no variant matches the actual status', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({ validationLogs: true, logger });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), moduleOpts);
    const handler = function noMatch(): void {};
    attach(handler, [variant200]);
    const raw = { id: 42 };

    const result = await collect(
      interceptor.intercept(makeContext({ statusCode: 404, handler }), makeNext(raw)),
    );

    expect(result).toBe(raw);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes through unchanged when the handler has no @ZodResponse metadata', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({ validationLogs: true, logger });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), moduleOpts);
    const handler = function bare(): void {};
    const raw = { whatever: 'anything' };

    const result = await collect(
      interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext(raw)),
    );

    expect(result).toBe(raw);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('passes through when response.statusCode is undefined', async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector());
    const handler = function noStatus(): void {};
    attach(handler, [variant200]);
    const raw = { id: 42 };
    const ctx = makeContext({ handler });
    // Force undefined statusCode on the response
    (ctx.switchToHttp().getResponse() as { statusCode?: number }).statusCode = undefined;

    const result = await collect(interceptor.intercept(ctx, makeNext(raw)));

    expect(result).toBe(raw);
  });

  it('passes through empty-variant array', async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector());
    const handler = function emptyVariants(): void {};
    attach(handler, []);
    const raw = { whatever: 'x' };

    const result = await collect(
      interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext(raw)),
    );

    expect(result).toBe(raw);
  });
});

describe('ZodSerializerInterceptor — exception bypass', () => {
  it('does not intercept thrown errors; they propagate to the filter chain', async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector());
    const handler = function thrower(): void {};
    attach(handler, [variant200]);
    const handlerError = new Error('handler error');

    await expect(
      collect(
        interceptor.intercept(
          makeContext({ statusCode: 200, handler }),
          makeThrowingNext(handlerError),
        ),
      ),
    ).rejects.toBe(handlerError);
  });
});

describe('ZodSerializerInterceptor — non-HTTP contexts', () => {
  it('passes through for `rpc` context type', async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector());
    const handler = function rpc(): void {};
    attach(handler, [variant200]);
    const raw = { id: 42 };

    const result = await collect(
      interceptor.intercept(makeContext({ type: 'rpc', handler }), makeNext(raw)),
    );

    expect(result).toBe(raw);
  });

  it('passes through for `ws` context type', async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector());
    const handler = function ws(): void {};
    attach(handler, [variant200]);
    const raw = { id: 42 };

    const result = await collect(
      interceptor.intercept(makeContext({ type: 'ws', handler }), makeNext(raw)),
    );

    expect(result).toBe(raw);
  });
});
