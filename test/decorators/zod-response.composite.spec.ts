import 'reflect-metadata';

import { Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';

import { createZodDto } from '../../src';
import { ZodResponse } from '../../src/decorators/zod-response.decorator.js';

const API_RESPONSE_METADATA_KEY = 'swagger/apiResponse';

interface ApiResponseMeta {
  [status: string]: {
    type?: unknown;
    isArray?: boolean;
    schema?: { type?: string; prefixItems?: { $ref: string }[]; items?: false };
    description?: string;
    headers?: Record<string, unknown>;
    links?: Record<string, unknown>;
  };
}

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

class UserDto extends createZodDto(z.object({ id: z.string() }), { id: 'Composite_User' }) {}
class ErrorDto extends createZodDto(z.object({ code: z.number() }), { id: 'Composite_Error' }) {}
class FatalDto extends createZodDto(z.object({ trace: z.string() }), { id: 'Composite_Fatal' }) {}

class Controller {
  @Get('explicit')
  @ZodResponse({ status: HttpStatus.OK, type: UserDto, description: 'happy path' })
  explicitStatus(): void {}

  @Get('implicit')
  @ZodResponse({ type: UserDto })
  implicitStatus(): void {}

  @Post('implicit-post')
  @ZodResponse({ type: UserDto })
  implicitStatusPost(): void {}

  @Post('implicit-http-code')
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse({ type: UserDto })
  implicitStatusWithHttpCode(): void {}

  @Get('array')
  @ZodResponse({ status: HttpStatus.OK, type: [UserDto] })
  arrayKind(): void {}

  @Get('tuple')
  @ZodResponse({ status: HttpStatus.OK, type: [UserDto, ErrorDto] })
  tupleKind(): void {}

  @Get('stacked')
  @ZodResponse({ status: HttpStatus.OK, type: UserDto })
  @ZodResponse({ status: HttpStatus.NOT_FOUND, type: ErrorDto })
  @ZodResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, type: FatalDto })
  multiStatus(): void {}

  @Get('wildcard')
  @ZodResponse({ status: '2XX', type: UserDto })
  wildcard(): void {}

  @Get('desc-object')
  @ZodResponse({
    status: HttpStatus.OK,
    type: UserDto,
    description: { description: 'object form' },
  })
  descObjectOnly(): void {}

  @Get('desc-headers')
  @ZodResponse({
    status: HttpStatus.OK,
    type: UserDto,
    description: {
      description: 'with headers',
      headers: { 'X-Rate-Limit': { schema: { type: 'integer' } } },
    },
  })
  descWithHeaders(): void {}

  @Get('desc-links')
  @ZodResponse({
    status: HttpStatus.OK,
    type: UserDto,
    description: {
      description: 'with links',
      links: { GetUserById: { operationId: 'getUser' } },
    },
  })
  descWithLinks(): void {}
}

const apiResponseMeta = (handler: object): ApiResponseMeta | undefined =>
  Reflect.getMetadata(API_RESPONSE_METADATA_KEY, handler);

describe('@ZodResponse — composite swagger application', () => {
  beforeAll(async () => {
    // Flush microtasks queued by implicit-status decorations.
    await flushMicrotasks();
  });

  it('applies @ApiResponse synchronously for explicit numeric status', () => {
    const meta = apiResponseMeta(Controller.prototype.explicitStatus);
    expect(meta).toBeDefined();
    expect(meta?.['200']).toBeDefined();
    expect(meta?.['200']?.type).toBe(UserDto);
    expect(meta?.['200']?.description).toBe('happy path');
  });

  it('defers @ApiResponse via microtask for implicit GET (default 200)', () => {
    const meta = apiResponseMeta(Controller.prototype.implicitStatus);
    expect(meta?.['200']).toBeDefined();
    expect(meta?.['200']?.type).toBe(UserDto);
  });

  it('defers @ApiResponse via microtask for implicit POST (default 201)', () => {
    const meta = apiResponseMeta(Controller.prototype.implicitStatusPost);
    expect(meta?.['201']).toBeDefined();
    expect(meta?.['201']?.type).toBe(UserDto);
  });

  it('resolves @HttpCode for implicit-status calls', () => {
    const meta = apiResponseMeta(Controller.prototype.implicitStatusWithHttpCode);
    // @HttpCode(ACCEPTED = 202) wins over method-default 201.
    expect(meta?.['202']).toBeDefined();
    expect(meta?.['202']?.type).toBe(UserDto);
  });

  it('emits isArray: true for array kind', () => {
    const meta = apiResponseMeta(Controller.prototype.arrayKind);
    expect(meta?.['200']?.type).toBe(UserDto);
    expect(meta?.['200']?.isArray).toBe(true);
  });

  it('emits a prefixItems schema for tuple kind', () => {
    const meta = apiResponseMeta(Controller.prototype.tupleKind);
    expect(meta?.['200']?.schema).toBeDefined();
    expect(meta?.['200']?.schema?.type).toBe('array');
    expect(meta?.['200']?.schema?.items).toBe(false);
    expect(meta?.['200']?.schema?.prefixItems).toHaveLength(2);
    expect(meta?.['200']?.schema?.prefixItems?.[0]?.$ref).toContain('UserDto');
    expect(meta?.['200']?.schema?.prefixItems?.[1]?.$ref).toContain('ErrorDto');
  });

  it('emits one @ApiResponse entry per stacked variant', () => {
    const meta = apiResponseMeta(Controller.prototype.multiStatus);
    expect(meta?.['200']?.type).toBe(UserDto);
    expect(meta?.['404']?.type).toBe(ErrorDto);
    expect(meta?.['500']?.type).toBe(FatalDto);
  });

  it('passes wildcard status keys through to @nestjs/swagger', () => {
    const meta = apiResponseMeta(Controller.prototype.wildcard);
    expect(meta?.['2XX']?.type).toBe(UserDto);
  });

  it('accepts the description object form (description only)', () => {
    const meta = apiResponseMeta(Controller.prototype.descObjectOnly);
    expect(meta?.['200']?.description).toBe('object form');
    expect(meta?.['200']?.headers).toBeUndefined();
    expect(meta?.['200']?.links).toBeUndefined();
  });

  it('passes headers through when set on the description object', () => {
    const meta = apiResponseMeta(Controller.prototype.descWithHeaders);
    expect(meta?.['200']?.description).toBe('with headers');
    expect(meta?.['200']?.headers).toEqual({ 'X-Rate-Limit': { schema: { type: 'integer' } } });
  });

  it('passes links through when set on the description object', () => {
    const meta = apiResponseMeta(Controller.prototype.descWithLinks);
    expect(meta?.['200']?.description).toBe('with links');
    expect(meta?.['200']?.links).toEqual({ GetUserById: { operationId: 'getUser' } });
  });
});
