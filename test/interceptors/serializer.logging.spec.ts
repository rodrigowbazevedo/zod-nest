import 'reflect-metadata';

import { Reflector } from '@nestjs/core';
import { z } from 'zod';

import type { ResponseVariant } from '../../src/response/metadata.js';

import { createZodDto, ZodSerializationException } from '../../src';
import { ZodSerializerInterceptor } from '../../src/interceptors/serializer.interceptor.js';
import { normalizeZodNestOptions } from '../../src/module/options.js';
import { ZOD_RESPONSES_METADATA_KEY } from '../../src/response/metadata.js';
import { collect, makeContext, makeFakeLogger, makeNext } from './helpers.js';

class UserDto extends createZodDto(z.object({ id: z.string() }), { id: 'Logging_User' }) {}
class TagDto extends createZodDto(z.object({ name: z.string() }), { id: 'Logging_Tag' }) {}

const attach = (handler: object, variants: ResponseVariant[]): void => {
  Reflect.defineMetadata(ZOD_RESPONSES_METADATA_KEY, variants, handler);
};

const strictSingle: ResponseVariant = {
  status: 200,
  kind: 'single',
  dto: UserDto,
  validationSchema: UserDto.schema,
  passthroughOnError: false,
};

const softSingle: ResponseVariant = { ...strictSingle, passthroughOnError: true };

const strictArray: ResponseVariant = {
  ...strictSingle,
  kind: 'array',
  dto: [UserDto],
  validationSchema: z.array(UserDto.schema),
};

const strictTuple: ResponseVariant = {
  ...strictSingle,
  kind: 'tuple',
  dto: [UserDto, TagDto],
  validationSchema: z.tuple([UserDto.schema, TagDto.schema]),
};

class TheController {
  someHandler(): void {
    /* noop */
  }
}

describe('ZodSerializerInterceptor — logging', () => {
  it('does not log when validationLogs.output is off', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({
      validationLogs: { output: false, input: true },
      logger,
    });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), moduleOpts);
    const handler = TheController.prototype.someHandler;
    attach(handler, [strictSingle]);

    await expect(
      collect(
        interceptor.intercept(
          makeContext({ statusCode: 200, handler, classRef: TheController }),
          makeNext({ id: 42 }),
        ),
      ),
    ).rejects.toBeInstanceOf(ZodSerializationException);

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs at `error` severity for strict failure with full payload', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({ validationLogs: { output: true }, logger });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), moduleOpts);
    const handler = TheController.prototype.someHandler;
    attach(handler, [strictSingle]);

    await expect(
      collect(
        interceptor.intercept(
          makeContext({ statusCode: 200, handler, classRef: TheController }),
          makeNext({ id: 42 }),
        ),
      ),
    ).rejects.toBeInstanceOf(ZodSerializationException);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload, _stack, context] = logger.error.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      side: 'output',
      dto: 'UserDto',
      status: 200,
      handler: 'TheController.someHandler',
    });
    expect(context).toBe('ZodSerializerInterceptor');
  });

  it('logs at `warn` severity for soft failure (passthroughOnError: true)', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({ validationLogs: { output: true }, logger });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), moduleOpts);
    const handler = TheController.prototype.someHandler;
    attach(handler, [softSingle]);

    await collect(
      interceptor.intercept(
        makeContext({ statusCode: 200, handler, classRef: TheController }),
        makeNext({ id: 42 }),
      ),
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    const [payload] = logger.warn.mock.calls[0] ?? [];
    expect(payload).toMatchObject({ side: 'output', dto: 'UserDto' });
  });

  it('formats DTO label as `[UserDto]` for array kind', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({ validationLogs: true, logger });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), moduleOpts);
    const handler = TheController.prototype.someHandler;
    attach(handler, [strictArray]);

    await expect(
      collect(
        interceptor.intercept(
          makeContext({ statusCode: 200, handler, classRef: TheController }),
          makeNext('not-an-array'),
        ),
      ),
    ).rejects.toBeInstanceOf(ZodSerializationException);

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { dto: string }).dto).toBe('[UserDto]');
  });

  it('formats DTO label as `[UserDto, TagDto]` for tuple kind', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({ validationLogs: true, logger });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), moduleOpts);
    const handler = TheController.prototype.someHandler;
    attach(handler, [strictTuple]);

    await expect(
      collect(
        interceptor.intercept(
          makeContext({ statusCode: 200, handler, classRef: TheController }),
          makeNext([{ id: 'u1' }, { name: 42 }]),
        ),
      ),
    ).rejects.toBeInstanceOf(ZodSerializationException);

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { dto: string }).dto).toBe('[UserDto, TagDto]');
  });

  it('redacts default-listed keys from the logged value', async () => {
    const logger = makeFakeLogger();
    const moduleOpts = normalizeZodNestOptions({ validationLogs: true, logger });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), moduleOpts);
    const handler = TheController.prototype.someHandler;
    attach(handler, [strictSingle]);

    await expect(
      collect(
        interceptor.intercept(
          makeContext({ statusCode: 200, handler, classRef: TheController }),
          makeNext({ id: 42, password: 'leaked', token: 'leaked', other: 'ok' }),
        ),
      ),
    ).rejects.toBeInstanceOf(ZodSerializationException);

    const [payload] = logger.error.mock.calls[0] ?? [];
    expect((payload as { value: Record<string, unknown> }).value).toEqual({
      id: 42,
      password: '[REDACTED]',
      token: '[REDACTED]',
      other: 'ok',
    });
  });
});
