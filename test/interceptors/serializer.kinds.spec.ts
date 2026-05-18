import 'reflect-metadata';

import { Get, HttpCode, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';

import type { ResponseStatusWildcard, ResponseVariant } from '../../src/response/metadata.js';

import { createZodDto } from '../../src';
import { ZodResponse } from '../../src/decorators/zod-response.decorator.js';
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

const makeSingleVariant = (
  status: number | ResponseStatusWildcard | undefined,
): ResponseVariant => ({
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

class WildcardController {
  @Get('two-hundred')
  @ZodResponse({ status: '2XX', type: UserDto })
  twoHundred(): void {}

  @Get('four-hundred')
  @ZodResponse({ status: '4XX', type: UserDto })
  fourHundred(): void {}

  @Get('exact-beats-wildcard')
  @ZodResponse({ status: 204, type: UserDto })
  @ZodResponse({ status: '2XX', type: TagDto })
  exactBeatsWildcard(): void {}

  @Get('mixed-200-2XX-default')
  @ZodResponse({ status: 200, type: UserDto })
  @ZodResponse({ status: '2XX', type: UserDto })
  @ZodResponse({ status: 'default', type: UserDto })
  mixed(): void {}

  @Post('default-on-post-with-httpcode')
  @HttpCode(204)
  @ZodResponse({ status: 'default', type: UserDto })
  defaultOnPostWithHttpCode(): void {}
}

describe('ZodSerializerInterceptor — wildcard matching', () => {
  const interceptor = new ZodSerializerInterceptor(new Reflector());

  it.each([200, 204, 299])("'2XX' matches statusCode %i", async (statusCode) => {
    const handler = WildcardController.prototype.twoHundred;
    const ctx = makeContext({ statusCode, handler });
    const result = await collect(
      interceptor.intercept(ctx, makeNext({ id: 'u1', email: 'A@B.COM' })),
    );
    expect(result).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it.each([400, 404, 499])("'4XX' matches statusCode %i", async (statusCode) => {
    const handler = WildcardController.prototype.fourHundred;
    const ctx = makeContext({ statusCode, handler });
    const result = await collect(
      interceptor.intercept(ctx, makeNext({ id: 'u1', email: 'A@B.COM' })),
    );
    expect(result).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it("'2XX' does NOT match statusCode 500 — original value passes through", async () => {
    const handler = WildcardController.prototype.twoHundred;
    const ctx = makeContext({ statusCode: 500, handler });
    // Raw value (uppercase email) emitted unchanged, because no variant matched
    // and the interceptor has no DTO to validate against at 500.
    const result = await collect(
      interceptor.intercept(ctx, makeNext({ id: 'u1', email: 'RAW@UNTOUCHED.COM' })),
    );
    expect(result).toEqual({ id: 'u1', email: 'RAW@UNTOUCHED.COM' });
  });

  it('exact numeric match wins over a NXX wildcard at the same hundreds bucket', async () => {
    // Variants: [204 → UserDto, '2XX' → TagDto]. A 204 response carrying a
    // UserDto-shaped payload only validates if the exact 204 variant ran;
    // had the '2XX' wildcard won, TagDto.schema would reject `{ id, email }`.
    const handler = WildcardController.prototype.exactBeatsWildcard;
    const ctx = makeContext({ statusCode: 204, handler });
    const result = await collect(
      interceptor.intercept(ctx, makeNext({ id: 'u1', email: 'A@B.COM' })),
    );
    expect(result).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('NXX wildcard still wins for a sibling status not covered by the exact variant', async () => {
    // Same controller, 201 → '2XX' variant (TagDto). The exact 204 variant
    // doesn't apply; TagDto-shaped payload validates cleanly.
    const handler = WildcardController.prototype.exactBeatsWildcard;
    const ctx = makeContext({ statusCode: 201, handler });
    const result = await collect(interceptor.intercept(ctx, makeNext({ name: 'admin' })));
    expect(result).toEqual({ name: 'admin' });
  });

  it('mixed [200, 2XX, default] on a GET: 201 matches the 2XX variant (200 exact misses, default resolves to 200)', async () => {
    const handler = WildcardController.prototype.mixed;
    const ctx = makeContext({ statusCode: 201, handler });
    const result = await collect(
      interceptor.intercept(ctx, makeNext({ id: 'u1', email: 'A@B.COM' })),
    );
    expect(result).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it("'default' on a POST with @HttpCode(204) validates the 204 response", async () => {
    const handler = WildcardController.prototype.defaultOnPostWithHttpCode;
    const ctx = makeContext({ statusCode: 204, handler });
    const result = await collect(
      interceptor.intercept(ctx, makeNext({ id: 'u1', email: 'A@B.COM' })),
    );
    expect(result).toEqual({ id: 'u1', email: 'a@b.com' });
  });
});
