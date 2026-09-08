import 'reflect-metadata';

import * as nestCommon from '@nestjs/common';
import { Body, Controller, Search, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, ZodResponse } from '../../src';

type RouteDecoratorFactory = (path?: string | string[]) => MethodDecorator;

const isRouteDecoratorFactory = (value: unknown): value is RouteDecoratorFactory =>
  typeof value === 'function';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const recordAt = (root: unknown, ...segments: string[]): Record<string, unknown> => {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (!isRecord(cursor)) {
      throw new Error(`Expected an object at ${segments.join('.')}`);
    }
    cursor = cursor[segment];
  }
  if (!isRecord(cursor)) {
    throw new Error(`Expected an object at ${segments.join('.')}`);
  }
  return cursor;
};

const refAt = (root: unknown, ...segments: string[]): unknown => {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
};

const sortedKeys = (value: unknown): string[] => [...Object.keys(recordAt(value))].sort();

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

const bootstrap = async (controller: Type<unknown>): Promise<OpenAPIObject> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers: [controller],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const raw = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('t').setVersion('v').build(),
  );
  await app.close();
  return applyZodNest(raw);
};

describe('applyZodNest — SEARCH routes', () => {
  @Controller('search-things')
  class SearchController {
    @Search()
    @ZodResponse({ type: HitDto })
    find(@Body() body: CriteriaDto): HitDto {
      return { id: body.term };
    }
  }

  let doc: OpenAPIObject;

  beforeAll(async () => {
    doc = await bootstrap(SearchController);
  });

  it('resolves the request body ref instead of throwing DANGLING_REF', () => {
    const operation = recordAt(doc.paths, '/search-things', 'search');
    expect(refAt(operation, 'requestBody', 'content', 'application/json', 'schema', '$ref')).toBe(
      '#/components/schemas/Criteria',
    );
  });

  it('emits the referenced schemas into components.schemas', () => {
    expect(sortedKeys(doc.components?.schemas)).toEqual(['Criteria', 'Hit']);
  });

  it('strips the x-zod-nest-dto marker from the emitted schemas', () => {
    const properties = recordAt(doc.components?.schemas, 'Criteria', 'properties');
    expect(properties['x-zod-nest-dto']).toBeUndefined();
    expect(properties.term).toEqual({ type: 'string' });
  });
});

describe.skipIf(queryMethod === undefined)('applyZodNest — QUERY routes (RFC 10008)', () => {
  @Controller('query-things')
  class QueryController {
    @(queryMethod ?? noopDecorator)
    @ZodResponse({ type: HitDto })
    find(@Body() body: CriteriaDto): HitDto {
      return { id: body.term };
    }
  }

  let doc: OpenAPIObject;

  beforeAll(async () => {
    doc = await bootstrap(QueryController);
  });

  it('emits the handler under the `query` path-item key', () => {
    expect(sortedKeys(recordAt(doc.paths, '/query-things'))).toEqual(['query']);
  });

  it('resolves the request body ref instead of throwing DANGLING_REF', () => {
    const operation = recordAt(doc.paths, '/query-things', 'query');
    expect(refAt(operation, 'requestBody', 'content', 'application/json', 'schema', '$ref')).toBe(
      '#/components/schemas/Criteria',
    );
  });

  it('defaults to 200 because QUERY is safe and idempotent', () => {
    const operation = recordAt(doc.paths, '/query-things', 'query');
    expect(sortedKeys(operation.responses)).toEqual(['200']);
    expect(
      refAt(operation, 'responses', '200', 'content', 'application/json', 'schema', '$ref'),
    ).toBe('#/components/schemas/Hit');
  });

  it('strips the x-zod-nest-dto marker from the emitted schemas', () => {
    const properties = recordAt(doc.components?.schemas, 'Hit', 'properties');
    expect(properties['x-zod-nest-dto']).toBeUndefined();
    expect(properties.id).toEqual({ type: 'string' });
  });
});
