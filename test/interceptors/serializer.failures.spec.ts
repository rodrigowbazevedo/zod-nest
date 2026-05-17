import 'reflect-metadata';

import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';

import type { ResponseVariant } from '../../src/response/metadata.js';

import { createZodDto, ZodSerializationException } from '../../src';
import { ZodSerializerInterceptor } from '../../src/interceptors/serializer.interceptor.js';
import { normalizeZodNestOptions } from '../../src/module/options.js';
import { ZOD_RESPONSES_METADATA_KEY } from '../../src/response/metadata.js';
import { collect, makeContext, makeNext } from './helpers.js';

class UserDto extends createZodDto(z.object({ id: z.string() }), { id: 'Failures_User' }) {}

const attach = (handler: object, variants: ResponseVariant[]): void => {
  Reflect.defineMetadata(ZOD_RESPONSES_METADATA_KEY, variants, handler);
};

const strictVariant: ResponseVariant = {
  status: 200,
  kind: 'single',
  dto: UserDto,
  validationSchema: UserDto.schema,
  passthroughOnError: false,
};

const softVariant: ResponseVariant = {
  ...strictVariant,
  passthroughOnError: true,
};

describe('ZodSerializerInterceptor — strict failure', () => {
  it('throws ZodSerializationException by default on parse failure', async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector());
    const handler = function strict(): void {};
    attach(handler, [strictVariant]);

    await expect(
      collect(
        interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext({ id: 42 })),
      ),
    ).rejects.toBeInstanceOf(ZodSerializationException);
  });

  it('honors a custom createSerializationException factory from module options', async () => {
    class CustomError extends HttpException {
      constructor() {
        super('custom-serialization', HttpStatus.BAD_GATEWAY);
      }
    }
    const factory = jest.fn(() => new CustomError());
    const moduleOpts = normalizeZodNestOptions({ createSerializationException: factory });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), moduleOpts);
    const handler = function customStrict(): void {};
    attach(handler, [strictVariant]);

    let caught: unknown;
    try {
      await collect(
        interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext({ id: 42 })),
      );
    } catch (e) {
      caught = e;
    }

    expect(factory).toHaveBeenCalledTimes(1);
    expect(caught).toBeInstanceOf(CustomError);
  });
});

describe('ZodSerializerInterceptor — soft failure (passthroughOnError: true)', () => {
  it("emits the handler's ORIGINAL value on parse failure (object identity preserved)", async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector());
    const handler = function soft(): void {};
    attach(handler, [softVariant]);
    const originalValue = { id: 42 };

    const result = await collect(
      interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext(originalValue)),
    );

    expect(result).toBe(originalValue);
  });

  it('still returns result.data on parse success (post-transform)', async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector());
    const handler = function softOk(): void {};
    attach(handler, [softVariant]);

    const result = await collect(
      interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext({ id: 'u1' })),
    );

    expect(result).toEqual({ id: 'u1' });
  });

  it('does NOT call the serialization-exception factory in soft mode', async () => {
    const factory = jest.fn();
    const moduleOpts = normalizeZodNestOptions({ createSerializationException: factory });
    const interceptor = new ZodSerializerInterceptor(new Reflector(), moduleOpts);
    const handler = function softNoFactory(): void {};
    attach(handler, [softVariant]);

    await collect(
      interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext({ id: 42 })),
    );

    expect(factory).not.toHaveBeenCalled();
  });

  it('mixes per-variant soft + strict on the same handler', async () => {
    const interceptor = new ZodSerializerInterceptor(new Reflector());
    const handler = function mixed(): void {};
    attach(handler, [
      { ...strictVariant, status: 200 },
      { ...softVariant, status: 500 },
    ]);
    const fiveHundred = { id: 42 };

    // 500 → soft → original value (object identity)
    const soft = await collect(
      interceptor.intercept(makeContext({ statusCode: 500, handler }), makeNext(fiveHundred)),
    );
    expect(soft).toBe(fiveHundred);

    // 200 → strict → throws
    await expect(
      collect(
        interceptor.intercept(makeContext({ statusCode: 200, handler }), makeNext({ id: 42 })),
      ),
    ).rejects.toBeInstanceOf(ZodSerializationException);
  });
});
