import 'reflect-metadata';

import { Reflector } from '@nestjs/core';
import { z } from 'zod';

import type { ResponseVariant } from '../../src/response/metadata.js';

import { createZodDto } from '../../src';
import { ZodSerializerInterceptor } from '../../src/interceptors/serializer.interceptor.js';
import { ZOD_RESPONSES_METADATA_KEY } from '../../src/response/metadata.js';
import { collect, makeContext, makeNext } from './helpers.js';

class UserDto extends createZodDto(
  z.object({ id: z.string(), email: z.email().transform((v) => v.toLowerCase()) }),
  { id: 'Kinds_User' },
) {}
class TagDto extends createZodDto(z.object({ name: z.string() }), { id: 'Kinds_Tag' }) {}

const attach = (handler: object, variants: ResponseVariant[]): void => {
  Reflect.defineMetadata(ZOD_RESPONSES_METADATA_KEY, variants, handler);
};

const makeSingleVariant = (status: number): ResponseVariant => ({
  status,
  kind: 'single',
  dto: UserDto,
  validationSchema: UserDto.schema,
  passthroughOnError: false,
});

const makeArrayVariant = (status: number): ResponseVariant => ({
  status,
  kind: 'array',
  dto: [UserDto],
  validationSchema: z.array(UserDto.schema),
  passthroughOnError: false,
});

const makeTupleVariant = (status: number): ResponseVariant => ({
  status,
  kind: 'tuple',
  dto: [UserDto, TagDto],
  validationSchema: z.tuple([UserDto.schema, TagDto.schema]),
  passthroughOnError: false,
});

describe('ZodSerializerInterceptor — happy paths per kind', () => {
  const interceptor = new ZodSerializerInterceptor(new Reflector());

  it('single: validates and emits transformed value (email lowercased)', async () => {
    const handler = function single(): void {};
    attach(handler, [makeSingleVariant(200)]);
    const ctx = makeContext({ statusCode: 200, handler });

    const result = await collect(
      interceptor.intercept(ctx, makeNext({ id: 'u1', email: 'A@B.COM' })),
    );

    expect(result).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('array: validates and emits each element transformed', async () => {
    const handler = function list(): void {};
    attach(handler, [makeArrayVariant(200)]);
    const ctx = makeContext({ statusCode: 200, handler });

    const result = await collect(
      interceptor.intercept(
        ctx,
        makeNext([
          { id: 'u1', email: 'A@B.COM' },
          { id: 'u2', email: 'C@D.COM' },
        ]),
      ),
    );

    expect(result).toEqual([
      { id: 'u1', email: 'a@b.com' },
      { id: 'u2', email: 'c@d.com' },
    ]);
  });

  it('tuple: validates positionally', async () => {
    const handler = function pair(): void {};
    attach(handler, [makeTupleVariant(200)]);
    const ctx = makeContext({ statusCode: 200, handler });

    const result = await collect(
      interceptor.intercept(ctx, makeNext([{ id: 'u1', email: 'A@B.COM' }, { name: 'admin' }])),
    );

    expect(result).toEqual([{ id: 'u1', email: 'a@b.com' }, { name: 'admin' }]);
  });

  it('selects the variant whose status matches response.statusCode', async () => {
    const handler = function multi(): void {};
    attach(handler, [makeSingleVariant(200), makeSingleVariant(404)]);
    const ctx = makeContext({ statusCode: 404, handler });

    const result = await collect(
      interceptor.intercept(ctx, makeNext({ id: 'u404', email: 'X@Y.COM' })),
    );

    expect(result).toEqual({ id: 'u404', email: 'x@y.com' });
  });
});
