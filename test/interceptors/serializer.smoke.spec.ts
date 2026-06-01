import 'reflect-metadata';

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { z } from 'zod';

import type { INestApplication, LoggerService } from '@nestjs/common';

import { createZodDto, ZodNestModule, ZodResponse } from '../../src';

class UserDto extends createZodDto(
  z.object({ id: z.string(), email: z.email().transform((v) => v.toLowerCase()) }),
  { id: 'Smoke_Serialize_User' },
) {}

class TagDto extends createZodDto(z.object({ name: z.string() }), { id: 'Smoke_Serialize_Tag' }) {}

class ProxyDto extends createZodDto(z.object({ canonical: z.string() }), {
  id: 'Smoke_Serialize_Proxy',
}) {}

@Controller('users')
class UsersController {
  @Get('single')
  @ZodResponse({ type: UserDto })
  single(): { id: string; email: string } {
    return { id: 'u1', email: 'A@B.COM' };
  }

  @Get('array')
  @ZodResponse({ type: [UserDto] })
  array(): { id: string; email: string }[] {
    return [
      { id: 'u1', email: 'A@B.COM' },
      { id: 'u2', email: 'C@D.COM' },
    ];
  }

  @Get('tuple')
  @ZodResponse({ type: [UserDto, TagDto] })
  tuple(): unknown {
    return [{ id: 'u1', email: 'A@B.COM' }, { name: 'admin' }];
  }

  @Get('strict-broken')
  @ZodResponse({ type: UserDto })
  strictBroken(): unknown {
    // id is a number — fails validation; strict mode → 500.
    return { id: 42, email: 'a@b.com' };
  }

  @Get('soft-broken')
  @ZodResponse({ type: ProxyDto, passthroughOnError: true })
  softBroken(): unknown {
    // Upstream-controlled shape we don't trust; emit untouched on failure.
    return { upstream: 'value', extra: ['raw', 'shape'] };
  }

  @Get('not-found')
  @ZodResponse({ type: UserDto })
  notFound(): unknown {
    throw new NotFoundException();
  }

  @Post()
  @ZodResponse({ type: UserDto })
  create(): { id: string; email: string } {
    // Default status for POST is 201, so this should match.
    return { id: 'u-new', email: 'NEW@B.COM' };
  }

  @Get('http-coded')
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse({ type: UserDto })
  httpCoded(): { id: string; email: string } {
    // @HttpCode(202) overrides the GET default of 200; the interceptor
    // must read HTTP_CODE_METADATA in defaultStatusFor to match correctly.
    return { id: 'u-accepted', email: 'X@Y.COM' };
  }
}

const makeFakeLogger = (): jest.Mocked<LoggerService> => ({
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
});

const logger: jest.Mocked<LoggerService> = makeFakeLogger();

@Module({
  imports: [ZodNestModule.forRoot({ validationLogs: { output: true }, logger })],
  controllers: [UsersController],
})
class SmokeAppModule {}

describe('ZodSerializerInterceptor — end-to-end smoke', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(SmokeAppModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('200 single success: response validates + transforms (email lowercased)', async () => {
    const res = await request(app.getHttpServer()).get('/users/single');
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('200 array success: each element validated + transformed', async () => {
    const res = await request(app.getHttpServer()).get('/users/array');
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toEqual([
      { id: 'u1', email: 'a@b.com' },
      { id: 'u2', email: 'c@d.com' },
    ]);
  });

  it('200 tuple success: positional validation', async () => {
    const res = await request(app.getHttpServer()).get('/users/tuple');
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toEqual([{ id: 'u1', email: 'a@b.com' }, { name: 'admin' }]);
  });

  it('200 strict failure: returns 500 without leaking the zod error tree', async () => {
    const res = await request(app.getHttpServer()).get('/users/strict-broken');
    expect(res.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.body.statusCode).toBe(500);
    expect(res.body.message).toBe('Response validation failed');
    // 5xx is opaque to clients — the diagnostic tree goes to logs, not the wire.
    expect(res.body.errors).toBeUndefined();
  });

  it("200 soft failure: emits handler's raw value untouched", async () => {
    const res = await request(app.getHttpServer()).get('/users/soft-broken');
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toEqual({ upstream: 'value', extra: ['raw', 'shape'] });
  });

  it("404 thrown: Nest's default 404 passes through untouched", async () => {
    const res = await request(app.getHttpServer()).get('/users/not-found');
    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('POST default status 201: interceptor matches and validates', async () => {
    const res = await request(app.getHttpServer()).post('/users').send({});
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body).toEqual({ id: 'u-new', email: 'new@b.com' });
  });

  it('@HttpCode(202) GET: interceptor matches via HTTP_CODE_METADATA, validates response', async () => {
    const res = await request(app.getHttpServer()).get('/users/http-coded');
    expect(res.status).toBe(HttpStatus.ACCEPTED);
    expect(res.body).toEqual({ id: 'u-accepted', email: 'x@y.com' });
  });

  it('logs `error` severity on strict failure (validationLogs.output enabled)', async () => {
    logger.error.mockClear();
    await request(app.getHttpServer()).get('/users/strict-broken');
    expect(logger.error).toHaveBeenCalled();
    const [payload] = logger.error.mock.calls[0] ?? [];
    // status logged is the variant's declared status (200), captured at parse
    // time — the 500 comes later from Nest's exception filter on throw.
    expect(payload).toMatchObject({
      side: 'output',
      dto: 'Smoke_Serialize_User',
      status: 200,
    });
  });

  it('logs `warn` severity on soft failure', async () => {
    logger.warn.mockClear();
    await request(app.getHttpServer()).get('/users/soft-broken');
    expect(logger.warn).toHaveBeenCalled();
    const [payload] = logger.warn.mock.calls[0] ?? [];
    expect(payload).toMatchObject({ side: 'output', dto: 'Smoke_Serialize_Proxy' });
  });
});
