import 'reflect-metadata';

import { Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, ZodBody, ZodResponse } from '../../src';
import { inlineAnonymousBodies } from '../../src/document/inline-anon.js';
import { createRegistry } from '../../src/schema/registry.js';

const ROOT = '#/components/schemas/';

// Named error schemas — these have ids and must survive as components even when
// the wrapping union is anonymous and inlined.
const InvalidRequest = z
  .object({ code: z.literal('INVALID_REQUEST') })
  .meta({ id: 'InvalidRequest' });
const TooLarge = z.object({ code: z.literal('TOO_LARGE') }).meta({ id: 'TooLarge' });

@Controller('anon')
class AnonController {
  // Anonymous union of NAMED members — no `.meta({ id })` on the union itself.
  @Get('errors')
  @ZodResponse({ status: HttpStatus.OK, type: z.string() })
  @ZodResponse({ status: HttpStatus.BAD_REQUEST, type: z.union([InvalidRequest, TooLarge]) })
  errors(): unknown {
    return '';
  }

  // Anonymous plain object — fully self-contained, nothing named inside.
  @Get('plain')
  @ZodResponse({ status: HttpStatus.OK, type: z.object({ a: z.string(), b: z.number() }) })
  plain(): unknown {
    return {};
  }

  // Anonymous request body.
  @Post('body')
  @ZodBody(z.object({ name: z.string() }))
  create(): void {}
}

describe('applyZodNest — anonymous schemas are inlined and pruned', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [AnonController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const config = new DocumentBuilder().setTitle('t').setVersion('v').build();
    doc = applyZodNest(SwaggerModule.createDocument(app, config));
  });

  afterAll(() => app.close());

  const schemas = (): Record<string, unknown> => doc.components?.schemas as Record<string, unknown>;

  const responseSchemaAt = (path: string, status: string): Record<string, unknown> | undefined => {
    const op = (doc.paths as Record<string, Record<string, Record<string, unknown>>>)[path]?.[
      'get'
    ];
    const responses = op?.responses as Record<string, Record<string, unknown>> | undefined;
    const content = responses?.[status]?.content as
      | Record<string, Record<string, unknown>>
      | undefined;
    return content?.['application/json']?.schema as Record<string, unknown> | undefined;
  };

  it('inlines an anonymous union response body as `anyOf` of the member $refs', () => {
    const schema = responseSchemaAt('/anon/errors', '400');
    expect(schema?.$ref).toBeUndefined();
    const anyOf = schema?.anyOf as { $ref: string }[] | undefined;
    expect(anyOf?.map((s) => s.$ref).sort()).toEqual([`${ROOT}InvalidRequest`, `${ROOT}TooLarge`]);
  });

  it('keeps the named members of an inlined union in components.schemas', () => {
    expect(schemas()['InvalidRequest']).toBeDefined();
    expect(schemas()['TooLarge']).toBeDefined();
  });

  it('leaves no synthetic `_AnonResponseSchema_*` / `_AnonBodySchema_*` component behind', () => {
    const keys = Object.keys(schemas());
    expect(keys.some((k) => k.startsWith('_Anon'))).toBe(false);
  });

  it('inlines a self-contained anonymous object response body', () => {
    const schema = responseSchemaAt('/anon/plain', '200');
    expect(schema?.$ref).toBeUndefined();
    expect(schema?.type).toBe('object');
    expect(Object.keys(schema?.properties as Record<string, unknown>).sort()).toEqual(['a', 'b']);
  });

  it('inlines an anonymous request body', () => {
    const op = (doc.paths as Record<string, Record<string, Record<string, unknown>>>)[
      '/anon/body'
    ]?.['post'];
    const requestBody = op?.requestBody as Record<string, unknown> | undefined;
    const content = requestBody?.content as Record<string, Record<string, unknown>> | undefined;
    const schema = content?.['application/json']?.schema as Record<string, unknown> | undefined;
    expect(schema?.$ref).toBeUndefined();
    expect(schema?.type).toBe('object');
    expect(Object.keys(schema?.properties as Record<string, unknown>)).toEqual(['name']);
  });
});

describe('inlineAnonymousBodies — defensive early returns', () => {
  const emptyDoc = (components?: unknown): OpenAPIObject =>
    ({
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      paths: {},
      ...(components === undefined ? {} : { components }),
    }) as OpenAPIObject;

  it('no-ops when the registry has no anonymous ids', () => {
    const registry = createRegistry();
    const doc = emptyDoc({ schemas: {} });
    expect(() => inlineAnonymousBodies({ doc, registry })).not.toThrow();
  });

  it('no-ops when there are anonymous ids but the doc has no components.schemas', () => {
    const registry = createRegistry();
    registry.register(z.object({ a: z.string() }), '_AnonResponseSchema_x', { anonymous: true });
    const doc = emptyDoc(); // no `components` at all
    expect(() => inlineAnonymousBodies({ doc, registry })).not.toThrow();
  });

  it('no-ops when an anonymous id has no emitted body in components.schemas', () => {
    const registry = createRegistry();
    registry.register(z.object({ a: z.string() }), '_AnonResponseSchema_y', { anonymous: true });
    // schemas present, but the anonymous id was never emitted into it.
    const doc = emptyDoc({ schemas: { Unrelated: { type: 'object' } } });
    inlineAnonymousBodies({ doc, registry });
    const schemas = doc.components?.schemas as Record<string, unknown>;
    expect(Object.keys(schemas)).toEqual(['Unrelated']);
  });
});
