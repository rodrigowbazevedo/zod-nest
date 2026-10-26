import 'reflect-metadata';

import { Reflector } from '@nestjs/core';
import { z } from 'zod';

import type { ResponseVariant } from '../../src/response/metadata.js';

import { createZodDto, ZodSerializationException } from '../../src';
import { ZodSerializerInterceptor } from '../../src/interceptors/serializer.interceptor.js';
import { normalizeZodNestOptions } from '../../src/module/options.js';
import { ZOD_RESPONSES_METADATA_KEY } from '../../src/response/metadata.js';
import { isCompiled, loadZodCompile } from '../schema/zod-compile.js';
import { collect, makeContext, makeFakeLogger, makeNext } from './helpers.js';

const hasZodCompile = await loadZodCompile();

const variantFor = (schema: z.ZodType, passthroughOnError = false): ResponseVariant => {
  const dto = createZodDto(schema);
  return {
    status: 200,
    kind: 'single',
    dto,
    validationSchema: schema,
    passthroughOnError,
  };
};

const handlerWith = (variant: ResponseVariant): (() => void) => {
  const handler = function compiled(): void {};
  Reflect.defineMetadata(ZOD_RESPONSES_METADATA_KEY, [variant], handler);
  return handler;
};

describe.skipIf(!hasZodCompile)('ZodSerializerInterceptor — zod/compile', () => {
  it("runs the compiled fast path under the default 'auto' mode", async () => {
    const schema = z.object({ id: z.string() });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), normalizeZodNestOptions());
    const variant = variantFor(schema);
    const handler = handlerWith(variant);

    const result = await collect(
      interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext({ id: 'a' })),
    );

    expect(result).toEqual({ id: 'a' });
    expect(isCompiled(schema)).toBe(true);
  });

  it("never compiles under parseMode 'async'", async () => {
    const schema = z.object({ id: z.string() });
    const interceptor = new ZodSerializerInterceptor(
      new Reflector(),
      normalizeZodNestOptions({ parseMode: 'async' }),
    );
    const handler = handlerWith(variantFor(schema));

    await collect(
      interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext({ id: 'a' })),
    );

    expect(isCompiled(schema)).toBe(false);
  });

  it('throws ZodSerializationException on invalid output in strict mode', async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector(), normalizeZodNestOptions());
    const handler = handlerWith(variantFor(z.object({ id: z.string() })));

    await expect(
      collect(
        interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext({ id: 1 })),
      ),
    ).rejects.toBeInstanceOf(ZodSerializationException);
  });

  it('passes through and logs a warning under passthroughOnError', async () => {
    const logger = makeFakeLogger();
    const interceptor = new ZodSerializerInterceptor(
      new Reflector(),
      normalizeZodNestOptions({ validationLogs: true, logger }),
    );
    const handler = handlerWith(variantFor(z.object({ id: z.string() }), true));
    const raw = { id: 1 };

    const result = await collect(
      interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext(raw)),
    );

    expect(result).toBe(raw);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('still validates a schema with an async .refine()', async () => {
    const schema = z.object({ id: z.string().refine(async (v) => v.startsWith('ok')) });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), normalizeZodNestOptions());
    const handler = handlerWith(variantFor(schema));

    const result = await collect(
      interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext({ id: 'ok-1' })),
    );

    expect(result).toEqual({ id: 'ok-1' });
  });
});
