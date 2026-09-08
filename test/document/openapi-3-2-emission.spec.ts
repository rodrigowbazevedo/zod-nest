import 'reflect-metadata';

import * as nestCommon from '@nestjs/common';
import { Body, Controller, Get, Post, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, ZodResponse } from '../../src';
import { validateOpenApi } from './openapi-validator.js';

type RouteDecoratorFactory = (path?: string | string[]) => MethodDecorator;

const isRouteDecoratorFactory = (value: unknown): value is RouteDecoratorFactory =>
  typeof value === 'function';

/** `@QueryMethod()` (RFC 10008) only exists from NestJS 12 — absent on the v11 floor. */
const resolveQueryMethod = (): MethodDecorator | undefined => {
  const exports: Record<string, unknown> = { ...nestCommon };
  const factory = exports.QueryMethod;
  return isRouteDecoratorFactory(factory) ? factory() : undefined;
};

const queryMethod = resolveQueryMethod();
const noopDecorator: MethodDecorator = () => undefined;

class CriteriaDto extends createZodDto(z.object({ term: z.string() }), { id: 'Criteria' }) {}
class HitDto extends createZodDto(z.object({ id: z.string() }), { id: 'Hit' }) {}

const bootstrap = async (controller: Type<unknown>, declared?: string): Promise<OpenAPIObject> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers: [controller],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const builder = new DocumentBuilder().setTitle('t').setVersion('v');
  if (declared !== undefined) {
    builder.setOpenAPIVersion(declared);
  }
  const raw = SwaggerModule.createDocument(app, builder.build());
  await app.close();
  return applyZodNest(raw);
};

@Controller('things')
class ThingsController {
  @Get()
  @ZodResponse({ type: HitDto })
  list(): HitDto {
    return { id: 'a' };
  }

  @Post()
  @ZodResponse({ type: HitDto })
  create(@Body() body: CriteriaDto): HitDto {
    return { id: body.term };
  }
}

describe('applyZodNest — OpenAPI version from the document', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('emits what DocumentBuilder declared when it is supported', async () => {
    const asThirtyOne = await bootstrap(ThingsController, '3.1.0');
    const asThirtyTwo = await bootstrap(ThingsController, '3.2.0');

    expect(asThirtyOne.openapi).toBe('3.1.0');
    expect(asThirtyTwo.openapi).toBe('3.2.0');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and emits 3.1.0 when the version was never set', async () => {
    const doc = await bootstrap(ThingsController);

    expect(doc.openapi).toBe('3.1.0');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/declares OpenAPI `3\.0\.0`/);
  });

  // 3.2 is a backward-compatible superset: the same body must validate under both.
  it('produces a body that conforms under either version', async () => {
    const asThirtyOne = await bootstrap(ThingsController, '3.1.0');
    const asThirtyTwo = await bootstrap(ThingsController, '3.2.0');

    expect(() => validateOpenApi(asThirtyOne)).not.toThrow();
    expect(() => validateOpenApi(asThirtyTwo)).not.toThrow();
  });

  it('changes nothing but the version string', async () => {
    const asThirtyOne = await bootstrap(ThingsController, '3.1.0');
    const asThirtyTwo = await bootstrap(ThingsController, '3.2.0');

    expect({ ...asThirtyTwo, openapi: '3.1.0' }).toEqual(asThirtyOne);
  });
});

describe.skipIf(queryMethod === undefined)('applyZodNest — QUERY under 3.2 (RFC 10008)', () => {
  @Controller('query-things')
  class QueryController {
    @(queryMethod ?? noopDecorator)
    @ZodResponse({ type: HitDto })
    find(@Body() body: CriteriaDto): HitDto {
      return { id: body.term };
    }
  }

  it('validates against the 3.2 schema', async () => {
    const doc = await bootstrap(QueryController, '3.2.0');
    expect(() => validateOpenApi(doc)).not.toThrow();
  });

  // The whole point: 3.2 defines `query` as a path-item field, 3.1 does not.
  it('does not validate against the 3.1 schema', async () => {
    const doc = await bootstrap(QueryController, '3.1.0');
    expect(() => validateOpenApi(doc)).toThrow(/schema validation failed/);
  });
});
