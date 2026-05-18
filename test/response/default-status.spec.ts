import 'reflect-metadata';

import { Delete, Get, HttpCode, Patch, Post, Put, RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { z } from 'zod';

import { createZodDto } from '../../src';
import { ZodResponse } from '../../src/decorators/zod-response.decorator.js';
import { defaultStatusFor, resolveEffectiveStatus } from '../../src/response/default-status.js';
import { getResponseVariants } from '../../src/response/metadata.js';

class Routes {
  @Get('a')
  getA(): void {}

  @Post('b')
  postB(): void {}

  @Put('c')
  putC(): void {}

  @Delete('d')
  deleteD(): void {}

  @Patch('e')
  patchE(): void {}

  @Post('http-code-on-post')
  @HttpCode(204)
  httpCodeOnPost(): void {}

  @Get('http-code-on-get')
  @HttpCode(202)
  httpCodeOnGet(): void {}

  @Get('http-code-zero')
  @HttpCode(0)
  httpCodeZero(): void {}
}

describe('defaultStatusFor', () => {
  it('returns 201 for POST handlers', () => {
    expect(defaultStatusFor(Routes.prototype.postB)).toBe(201);
  });

  it('returns 200 for GET / PUT / DELETE / PATCH handlers', () => {
    expect(defaultStatusFor(Routes.prototype.getA)).toBe(200);
    expect(defaultStatusFor(Routes.prototype.putC)).toBe(200);
    expect(defaultStatusFor(Routes.prototype.deleteD)).toBe(200);
    expect(defaultStatusFor(Routes.prototype.patchE)).toBe(200);
  });

  it('returns 200 when no METHOD_METADATA is present (defensive fallback)', () => {
    const bare = function bare(): void {};
    expect(defaultStatusFor(bare)).toBe(200);
  });

  it('reads the documented METHOD_METADATA key — pins behavior so a Nest rename fails loudly', () => {
    // If this assertion ever fails, NestJS' METHOD_METADATA constant changed
    // value/name and `defaultStatusFor` will silently return 200 for POST.
    expect(METHOD_METADATA).toBe('method');
    expect(RequestMethod.POST).toBe(1);
    expect(Reflect.getMetadata(METHOD_METADATA, Routes.prototype.postB)).toBe(RequestMethod.POST);
  });

  it('@HttpCode(204) on a POST handler wins over the POST default of 201', () => {
    expect(defaultStatusFor(Routes.prototype.httpCodeOnPost)).toBe(204);
  });

  it('@HttpCode(202) on a GET handler wins over the GET default of 200', () => {
    expect(defaultStatusFor(Routes.prototype.httpCodeOnGet)).toBe(202);
  });

  it('@HttpCode(0) on a handler is honored (no truthy-fallback to method default)', () => {
    expect(defaultStatusFor(Routes.prototype.httpCodeZero)).toBe(0);
  });

  it('pins the HTTP_CODE_METADATA constant so a Nest rename fails loudly', () => {
    expect(HTTP_CODE_METADATA).toBe('__httpCode__');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, Routes.prototype.httpCodeOnPost)).toBe(204);
  });
});

class WildcardDto extends createZodDto(z.object({ ok: z.boolean() }), {
  id: 'DefaultStatus_Wildcard',
}) {}

class WildcardRoutes {
  @Get('a')
  @ZodResponse({ status: '2XX', type: WildcardDto })
  wildcard2xx(): void {}

  @Get('b')
  @ZodResponse({ status: '5XX', type: WildcardDto })
  wildcard5xx(): void {}

  @Get('c')
  @ZodResponse({ status: 'default', type: WildcardDto })
  defaultOnGet(): void {}

  @Post('d')
  @ZodResponse({ status: 'default', type: WildcardDto })
  defaultOnPost(): void {}

  @Post('e')
  @HttpCode(204)
  @ZodResponse({ status: 'default', type: WildcardDto })
  defaultOnPostWithHttpCode(): void {}
}

describe('resolveEffectiveStatus — wildcards and default', () => {
  it("returns '2XX' verbatim when the variant declared a wildcard", () => {
    const [variant] = getResponseVariants(WildcardRoutes.prototype.wildcard2xx) ?? [];
    expect(variant?.status).toBe('2XX');
    expect(resolveEffectiveStatus(variant!, WildcardRoutes.prototype.wildcard2xx)).toBe('2XX');
  });

  it("returns '5XX' verbatim for a 5XX wildcard variant", () => {
    const [variant] = getResponseVariants(WildcardRoutes.prototype.wildcard5xx) ?? [];
    expect(resolveEffectiveStatus(variant!, WildcardRoutes.prototype.wildcard5xx)).toBe('5XX');
  });

  it("collapses 'default' to undefined on the variant (sugar for method default)", () => {
    const [getVariant] = getResponseVariants(WildcardRoutes.prototype.defaultOnGet) ?? [];
    const [postVariant] = getResponseVariants(WildcardRoutes.prototype.defaultOnPost) ?? [];
    expect(getVariant?.status).toBeUndefined();
    expect(postVariant?.status).toBeUndefined();
  });

  it("'default' on a GET resolves to 200 via defaultStatusFor", () => {
    const [variant] = getResponseVariants(WildcardRoutes.prototype.defaultOnGet) ?? [];
    expect(resolveEffectiveStatus(variant!, WildcardRoutes.prototype.defaultOnGet)).toBe(200);
  });

  it("'default' on a POST resolves to 201 via defaultStatusFor", () => {
    const [variant] = getResponseVariants(WildcardRoutes.prototype.defaultOnPost) ?? [];
    expect(resolveEffectiveStatus(variant!, WildcardRoutes.prototype.defaultOnPost)).toBe(201);
  });

  it("'default' honours @HttpCode override (POST + @HttpCode(204) → 204)", () => {
    const handler = WildcardRoutes.prototype.defaultOnPostWithHttpCode;
    const [variant] = getResponseVariants(handler) ?? [];
    expect(resolveEffectiveStatus(variant!, handler)).toBe(204);
  });
});
