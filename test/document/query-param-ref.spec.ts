import 'reflect-metadata';

import { Controller, Get, Query, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createRegistry, createZodDto, ZodQuery, ZodValidationPipe } from '../../src';

// Mirrors the bff `/api/users/activities` shape that motivated this feature:
// required time bounds, optional scalars, and array filters.
const ActivityQuerySchema = z
  .object({
    timeFrom: z.iso.datetime().describe('Start date'),
    timeTo: z.iso.datetime().describe('End date'),
    search: z.string().optional().describe('Search term'),
    userId: z.array(z.uuid()).optional().describe('Filter by user IDs'),
  })
  .meta({ id: 'ActivityQuery' });

type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

const bootstrap = async (
  controllers: Type<unknown>[],
  declared?: string,
): Promise<{ app: INestApplication; raw: OpenAPIObject }> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const builder = new DocumentBuilder().setTitle('query-ref').setVersion('v');
  if (declared !== undefined) {
    builder.setOpenAPIVersion(declared);
  }
  const raw = SwaggerModule.createDocument(app, builder.build());
  return { app, raw };
};

const paramsIn = (
  doc: OpenAPIObject,
  path: string,
  location: string,
): Array<Record<string, unknown>> => {
  const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>> | undefined;
  const parameters = paths?.[path]?.get?.parameters;
  if (!Array.isArray(parameters)) {
    return [];
  }
  return (parameters as Array<Record<string, unknown>>).filter((p) => p.in === location);
};

const queryParamsAt = (doc: OpenAPIObject, path: string): Array<Record<string, unknown>> =>
  paramsIn(doc, path, 'query');

describe('query parameter ref mode (end-to-end)', () => {
  describe('queryParamStyle: "ref"', () => {
    let app: INestApplication;
    let doc: OpenAPIObject;

    beforeAll(async () => {
      const registry = createRegistry();
      class Local extends createZodDto(ActivityQuerySchema, { registry }) {}
      @Controller('activities')
      class LocalController {
        @Get('via-dto')
        viaDto(@Query() _params: Local): void {}
      }
      const result = await bootstrap([LocalController]);
      app = result.app;
      doc = applyZodNest(result.raw, { registry, queryParamStyle: 'ref' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('collapses the @Query() DTO to a single $ref form/explode parameter', () => {
      const params = queryParamsAt(doc, '/activities/via-dto');
      expect(params).toHaveLength(1);
      const [param] = params;
      expect(param?.schema).toEqual({ $ref: '#/components/schemas/ActivityQuery' });
      expect(param?.style).toBe('form');
      expect(param?.explode).toBe(true);
    });

    it('marks the parameter required (the schema has required fields)', () => {
      const [param] = queryParamsAt(doc, '/activities/via-dto');
      expect(param?.required).toBe(true);
    });

    it('keeps the ActivityQuery component intact with its properties', () => {
      const schemas = (doc.components?.schemas ?? {}) as Record<string, unknown>;
      const component = schemas.ActivityQuery;
      expect(component).toEqual(
        expect.objectContaining({
          type: 'object',
          required: ['timeFrom', 'timeTo'],
          properties: expect.objectContaining({
            timeFrom: expect.anything(),
            timeTo: expect.anything(),
            search: expect.anything(),
            userId: expect.anything(),
          }),
        }),
      );
    });
  });

  describe('default (queryParamStyle omitted) keeps @Query() DTOs expanded', () => {
    let app: INestApplication;
    let doc: OpenAPIObject;

    beforeAll(async () => {
      const registry = createRegistry();
      class Local extends createZodDto(ActivityQuerySchema, { registry }) {}
      @Controller('activities')
      class LocalController {
        @Get('via-dto')
        viaDto(@Query() _params: Local): void {}
      }
      const result = await bootstrap([LocalController]);
      app = result.app;
      doc = applyZodNest(result.raw, { registry });
    });

    afterAll(async () => {
      await app.close();
    });

    it('expands per-property (no collapse) by default', () => {
      const params = queryParamsAt(doc, '/activities/via-dto');
      expect(params.map((p) => p.name).sort()).toEqual(['search', 'timeFrom', 'timeTo', 'userId']);
      expect(params.every((p) => p.schema !== undefined && !('$ref' in p))).toBe(true);
    });
  });

  describe('@ZodQuery({ ref: true }) overrides a default (expand) preference', () => {
    let app: INestApplication;
    let doc: OpenAPIObject;

    beforeAll(async () => {
      const registry = createRegistry();
      const schema = ActivityQuerySchema;
      @Controller('activities')
      class LocalController {
        @Get('via-decorator')
        @ZodQuery(schema, { registry, ref: true })
        viaDecorator(@Query(new ZodValidationPipe(schema)) _params: ActivityQuery): void {}
      }
      const result = await bootstrap([LocalController]);
      app = result.app;
      // No queryParamStyle → global default is "expand", but the decorator
      // override forces ref for this handler.
      doc = applyZodNest(result.raw, { registry });
    });

    afterAll(async () => {
      await app.close();
    });

    it('emits a single $ref parameter despite the expand default', () => {
      const params = queryParamsAt(doc, '/activities/via-decorator');
      expect(params).toHaveLength(1);
      expect(params[0]?.schema).toEqual({ $ref: '#/components/schemas/ActivityQuery' });
      expect(params[0]?.style).toBe('form');
    });
  });

  describe('OpenAPI 3.2 collapses to `in: querystring` with no option set', () => {
    let app: INestApplication;
    let doc: OpenAPIObject;

    beforeAll(async () => {
      const registry = createRegistry();
      class Local extends createZodDto(ActivityQuerySchema, { registry }) {}
      @Controller('activities')
      class LocalController {
        @Get('via-dto')
        viaDto(@Query() _params: Local): void {}
      }
      const result = await bootstrap([LocalController], '3.2.0');
      app = result.app;
      doc = applyZodNest(result.raw, { registry });
    });

    afterAll(async () => {
      await app.close();
    });

    it('emits one querystring parameter and no `in: query` parameters', () => {
      expect(queryParamsAt(doc, '/activities/via-dto')).toHaveLength(0);
      const params = paramsIn(doc, '/activities/via-dto', 'querystring');
      expect(params).toHaveLength(1);
      expect(params[0]).toEqual({
        name: 'ActivityQuery',
        in: 'querystring',
        required: true,
        content: {
          'application/x-www-form-urlencoded': {
            schema: { $ref: '#/components/schemas/ActivityQuery' },
          },
        },
      });
    });

    it('keeps the ActivityQuery component intact', () => {
      const schemas = (doc.components?.schemas ?? {}) as Record<string, unknown>;
      expect(schemas.ActivityQuery).toEqual(
        expect.objectContaining({ type: 'object', required: ['timeFrom', 'timeTo'] }),
      );
    });
  });

  describe('OpenAPI 3.2 degrades to expansion when a plain @Query() shares the handler', () => {
    let app: INestApplication;
    let doc: OpenAPIObject;
    const warnings: string[] = [];

    beforeAll(async () => {
      const registry = createRegistry();
      class Local extends createZodDto(ActivityQuerySchema, { registry }) {}
      @Controller('activities')
      class LocalController {
        @Get('mixed')
        mixed(@Query() _params: Local, @Query('page') _page: string): void {}
      }
      const result = await bootstrap([LocalController], '3.2.0');
      app = result.app;
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation((message: unknown) => void warnings.push(String(message)));
      doc = applyZodNest(result.raw, { registry });
      warn.mockRestore();
    });

    afterAll(async () => {
      await app.close();
    });

    it('expands rather than emitting an invalid querystring/query mix', () => {
      expect(paramsIn(doc, '/activities/mixed', 'querystring')).toHaveLength(0);
      const names = queryParamsAt(doc, '/activities/mixed').map((p) => p.name);
      expect(names).toContain('timeFrom');
      expect(names).toContain('page');
    });

    it('warns naming the operation and the conflicting parameter', () => {
      expect(warnings).toContainEqual(expect.stringContaining('`GET /activities/mixed`'));
      expect(warnings).toContainEqual(expect.stringContaining('`page`'));
    });
  });
});
