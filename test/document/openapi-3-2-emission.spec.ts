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

  // `query` is first-class in 3.2 and the schema forbids `QUERY` as an
  // additionalOperations key, so relocating it would emit an invalid document.
  it('stays a first-class `query` key and is never relocated', async () => {
    const doc = await bootstrap(QueryController, '3.2.0');
    const paths: Record<string, unknown> = doc.paths;
    const pathItem = paths['/query-things'];

    if (pathItem === null || typeof pathItem !== 'object') {
      throw new Error('no /query-things path item');
    }
    expect(Object.keys(pathItem)).toEqual(['query']);
    expect('additionalOperations' in pathItem).toBe(false);
  });

  // The whole point: 3.2 defines `query` as a path-item field, 3.1 does not.
  it('does not validate against the 3.1 schema', async () => {
    const doc = await bootstrap(QueryController, '3.1.0');
    expect(() => validateOpenApi(doc)).toThrow(/schema validation failed/);
  });
});

@Controller('streams')
class StreamsController {
  @Get('sse')
  @ZodResponse({ type: HitDto, contentType: 'text/event-stream' })
  sse(): void {}

  @Get('ndjson')
  @ZodResponse({ type: [HitDto], contentType: 'application/x-ndjson' })
  ndjson(): void {}

  @Get('download')
  @ZodResponse({ type: HitDto, contentType: 'application/octet-stream' })
  download(): void {}

  @Get('csv')
  @ZodResponse({ type: HitDto, contentType: 'text/csv', stream: true })
  csv(): void {}

  @Get('tuple')
  @ZodResponse({ type: [HitDto, HitDto], contentType: 'text/event-stream' })
  tuple(): void {}
}

describe('applyZodNest — itemSchema for sequential media types', () => {
  const HIT_REF = { $ref: '#/components/schemas/Hit' };

  const mediaTypeAt = (
    doc: OpenAPIObject,
    route: string,
    mediaType: string,
  ): Record<string, unknown> => {
    const paths = doc.paths as Record<
      string,
      Record<string, { responses: Record<string, { content: Record<string, unknown> }> }>
    >;
    const found = paths[`/streams/${route}`]?.get?.responses?.['200']?.content?.[mediaType];
    if (found === undefined || found === null || typeof found !== 'object') {
      throw new Error(`No ${mediaType} content for GET /streams/${route}`);
    }
    return found as Record<string, unknown>;
  };

  it('rewrites an SSE response to itemSchema under 3.2', async () => {
    const doc = await bootstrap(StreamsController, '3.2.0');

    expect(mediaTypeAt(doc, 'sse', 'text/event-stream')).toEqual({ itemSchema: HIT_REF });
  });

  it('keeps `schema` on the same SSE response under 3.1', async () => {
    const doc = await bootstrap(StreamsController, '3.1.0');

    expect(mediaTypeAt(doc, 'sse', 'text/event-stream')).toEqual({ schema: HIT_REF });
  });

  it('unwraps an NDJSON array response into its element schema', async () => {
    const doc = await bootstrap(StreamsController, '3.2.0');

    expect(mediaTypeAt(doc, 'ndjson', 'application/x-ndjson')).toEqual({ itemSchema: HIT_REF });
  });

  it('leaves an opaque binary download on `schema`', async () => {
    const doc = await bootstrap(StreamsController, '3.2.0');

    expect(mediaTypeAt(doc, 'download', 'application/octet-stream')).toEqual({ schema: HIT_REF });
  });

  it('rewrites a custom `stream: true` content type', async () => {
    const doc = await bootstrap(StreamsController, '3.2.0');

    expect(mediaTypeAt(doc, 'csv', 'text/csv')).toEqual({ itemSchema: HIT_REF });
  });

  // A tuple names each slot positionally, so it has no single item shape — and
  // an array `schema` is already how 3.2 describes complete sequential content.
  it('leaves a tuple response on `schema`', async () => {
    const doc = await bootstrap(StreamsController, '3.2.0');

    expect(mediaTypeAt(doc, 'tuple', 'text/event-stream')).toEqual({
      schema: { type: 'array', prefixItems: [HIT_REF, HIT_REF], items: false },
    });
  });

  it('conforms to the vendored schema under either version', async () => {
    const asThirtyOne = await bootstrap(StreamsController, '3.1.0');
    const asThirtyTwo = await bootstrap(StreamsController, '3.2.0');

    expect(() => validateOpenApi(asThirtyOne)).not.toThrow();
    expect(() => validateOpenApi(asThirtyTwo)).not.toThrow();
  });

  // The whole point: `itemSchema` is a 3.2 field, and 3.1's Media Type Object
  // sets `unevaluatedProperties: false`, so the 3.2 body is invalid as 3.1.
  it('produces a body that does not validate as 3.1', async () => {
    const doc = await bootstrap(StreamsController, '3.2.0');

    expect(() => validateOpenApi({ ...doc, openapi: '3.1.0' })).toThrow(/schema validation failed/);
  });

  it('leaves no zod-nest marker behind under either version', async () => {
    const asThirtyOne = await bootstrap(StreamsController, '3.1.0');
    const asThirtyTwo = await bootstrap(StreamsController, '3.2.0');

    expect(JSON.stringify(asThirtyOne)).not.toContain('x-zod-nest-item-stream');
    expect(JSON.stringify(asThirtyTwo)).not.toContain('x-zod-nest-item-stream');
  });
});
