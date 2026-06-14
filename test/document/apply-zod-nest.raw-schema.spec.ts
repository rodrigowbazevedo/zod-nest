import 'reflect-metadata';

import { Controller, Get, HttpStatus } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, ZodResponse } from '../../src';

const ROOT = '#/components/schemas/';

// A discriminated union — cannot be wrapped with `createZodDto` (its `z.infer`
// is a union, so `class … extends createZodDto(schema)` trips TS2509). Passing
// it straight to `@ZodResponse` is the feature under test. `.meta({ id })`
// supplies the OpenAPI component name.
const EventSchema = z
  .discriminatedUnion('event', [
    z.object({ event: z.literal('progress'), pct: z.number() }),
    z.object({ event: z.literal('done'), id: z.string() }),
  ])
  .meta({ id: 'RawSchema_Event' });

// An object schema carrying a transform — it can't be wrapped as a clean DTO
// either, yet flows straight through as a response. Only the output side is
// exposed (response-only), so it emits under the base id with no `*Output`
// suffix (the suffix appears only when an input usage of the same id diverges).
const TransformedSchema = z
  .object({
    n: z
      .string()
      .transform((v) => Number(v))
      .pipe(z.number()),
  })
  .meta({ id: 'RawSchema_Transformed' });

@Controller('raw')
class RawController {
  @Get('union')
  @ZodResponse({ status: HttpStatus.OK, type: EventSchema })
  union(): unknown {
    return { event: 'done', id: 'x' };
  }

  @Get('array')
  @ZodResponse({ status: HttpStatus.OK, type: [EventSchema] })
  list(): unknown {
    return [];
  }

  @Get('transformed')
  @ZodResponse({ status: HttpStatus.OK, type: TransformedSchema })
  transformed(): unknown {
    return { n: '42' };
  }
}

describe('applyZodNest — @ZodResponse accepts a raw Zod schema', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [RawController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const config = new DocumentBuilder().setTitle('t').setVersion('v').build();
    doc = applyZodNest(SwaggerModule.createDocument(app, config));
  });

  afterAll(() => app.close());

  const responseSchemaAt = (
    path: string,
    method: string,
    status: string,
  ): Record<string, unknown> | undefined => {
    const ops = (doc.paths as Record<string, Record<string, Record<string, unknown>>>)[path]?.[
      method
    ];
    const responses = ops?.responses as Record<string, Record<string, unknown>> | undefined;
    const content = responses?.[status]?.content as
      | Record<string, Record<string, unknown>>
      | undefined;
    return content?.['application/json']?.schema as Record<string, unknown> | undefined;
  };

  const schemas = (): Record<string, unknown> => doc.components?.schemas as Record<string, unknown>;

  it('registers the raw discriminated-union schema under its .meta({ id }) component name', () => {
    expect(schemas()['RawSchema_Event']).toBeDefined();
  });

  it('emits a $ref to the named component for a single raw schema', () => {
    expect(responseSchemaAt('/raw/union', 'get', '200')?.$ref).toBe(`${ROOT}RawSchema_Event`);
  });

  it('emits `type: array, items: $ref` for a `[schema]` array form', () => {
    const schema = responseSchemaAt('/raw/array', 'get', '200');
    expect(schema?.type).toBe('array');
    expect((schema?.items as Record<string, unknown> | undefined)?.$ref).toBe(
      `${ROOT}RawSchema_Event`,
    );
  });

  it('accepts a transform-bearing schema (also un-DTO-able) under its base id', () => {
    expect(schemas()['RawSchema_Transformed']).toBeDefined();
    expect(responseSchemaAt('/raw/transformed', 'get', '200')?.$ref).toBe(
      `${ROOT}RawSchema_Transformed`,
    );
  });
});
