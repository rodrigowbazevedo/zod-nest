import 'reflect-metadata';

import { Body, Controller, Get, Headers, Param, Post, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { expectTypeOf } from 'expect-type';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import {
  applyZodNest,
  createRegistry,
  ZodBody,
  ZodHeaders,
  ZodQuery,
  ZodValidationPipe,
} from '../../src';

const bootstrap = async (
  controllers: Type<unknown>[],
): Promise<{ app: INestApplication; raw: OpenAPIObject }> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const config = new DocumentBuilder().setTitle('zod-deco-smoke').setVersion('v').build();
  const raw = SwaggerModule.createDocument(app, config);
  return { app, raw };
};

const opAt = (doc: OpenAPIObject, path: string, method: string): Record<string, unknown> => {
  const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>> | undefined;
  const op = paths?.[path]?.[method];
  if (op === undefined) {
    throw new Error(`No ${method.toUpperCase()} ${path}`);
  }
  return op;
};

const paramsAt = (op: Record<string, unknown>): Array<Record<string, unknown>> => {
  const parameters = op.parameters;
  if (!Array.isArray(parameters)) {
    return [];
  }
  return parameters as Array<Record<string, unknown>>;
};

// Shared registry per test to avoid cross-suite leakage into defaultRegistry.
const registry = createRegistry();

// ─── The canonical user repro ──────────────────────────────────────────────

const IntersectionWithUnion = z
  .intersection(
    z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
    z.union([z.object({ c: z.string() }), z.object({ d: z.string() })]),
  )
  .meta({ id: 'IntersectionWithUnion' });

type IntersectionWithUnionType = z.infer<typeof IntersectionWithUnion>;

@Controller('cases')
class CasesController {
  @Post('intersection-with-union')
  @ZodBody(IntersectionWithUnion, { registry })
  postIntersectionWithUnion(
    @Body(new ZodValidationPipe(IntersectionWithUnion))
    body: IntersectionWithUnionType,
  ): IntersectionWithUnionType {
    return body;
  }

  @Get('listing/:userId')
  @ZodQuery(
    z.object({ q: z.string(), limit: z.number().optional() }).meta({ id: 'ListingQuery' }),
    {
      registry,
    },
  )
  @ZodHeaders(z.object({ 'x-trace-id': z.string().optional() }).meta({ id: 'ListingHeaders' }), {
    registry,
  })
  listing(
    @Param('userId') _userId: string,
    @Headers('x-trace-id') _traceId: string | undefined,
  ): void {}
}

describe('@ZodBody / @ZodQuery / @ZodHeaders — end-to-end with applyZodNest', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const result = await bootstrap([CasesController]);
    app = result.app;
    doc = applyZodNest(result.raw, { app, registry });
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Body: intersection-with-union ──────────────────────────────────────

  it('emits the body as a $ref to components.schemas.IntersectionWithUnion', () => {
    const op = opAt(doc, '/cases/intersection-with-union', 'post');
    const requestBody = op.requestBody as Record<string, unknown> | undefined;
    expect(requestBody).toBeDefined();
    const content = requestBody?.content as Record<string, { schema?: Record<string, unknown> }>;
    const schema = content?.['application/json']?.schema;
    expect(schema).toEqual({ $ref: '#/components/schemas/IntersectionWithUnion' });
  });

  it('emits the IntersectionWithUnion JSON Schema into components.schemas', () => {
    const schemas = doc.components?.schemas as Record<string, unknown>;
    expect(schemas['IntersectionWithUnion']).toBeDefined();
  });

  it('keeps the handler param precisely typed via z.infer (no TS2509)', () => {
    // Compile-only assertion — the test passes by virtue of TS accepting it.
    // The previous PR #67 patch lied about this type, collapsing the union
    // to `never` for the discriminant. With the new decorator the handler
    // arg stays the full `z.infer<typeof IntersectionWithUnion>`.
    expectTypeOf<IntersectionWithUnionType>().toEqualTypeOf<
      ({ a: string } | { b: string }) & ({ c: string } | { d: string })
    >();
  });

  // ─── Query and headers ──────────────────────────────────────────────────

  it('expands @ZodQuery into per-property query parameters with optional respect', () => {
    const op = opAt(doc, '/cases/listing/{userId}', 'get');
    const params = paramsAt(op);
    const q = params.find((p) => p.name === 'q' && p.in === 'query');
    const limit = params.find((p) => p.name === 'limit' && p.in === 'query');
    expect(q?.required).toBe(true);
    expect(limit?.required).toBe(false);
  });

  it('expands @ZodHeaders into per-property header parameters', () => {
    const op = opAt(doc, '/cases/listing/{userId}', 'get');
    const params = paramsAt(op);
    const trace = params.find((p) => p.name === 'x-trace-id' && p.in === 'header');
    expect(trace).toBeDefined();
    expect(trace?.required).toBe(false);
  });

  it('keeps root query/headers schemas out of components.schemas when not referenced', () => {
    // The root object schemas for @ZodQuery / @ZodHeaders are containers for
    // expansion — they're registered idempotently in the registry but only
    // surface in `components.schemas` when something actually `$ref`s them
    // (e.g. used elsewhere as a `@ZodBody`). This keeps the doc tight.
    const schemas = doc.components?.schemas as Record<string, unknown>;
    expect(schemas['ListingQuery']).toBeUndefined();
    expect(schemas['ListingHeaders']).toBeUndefined();
  });
});
