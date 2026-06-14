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

  @Post('flattened-multipart')
  @ZodBody(
    z.intersection(
      z.object({ a: z.string(), b: z.string() }).meta({ id: 'FlatLeft' }),
      z.object({ c: z.string(), d: z.string() }).meta({ id: 'FlatRight' }),
    ),
    { registry, flatten: true },
  )
  flattenedMultipart(): void {}

  @Post('flattened-with-named-child')
  @ZodBody(
    z.intersection(
      z.object({ blob: z.object({ raw: z.string() }).meta({ id: 'FlatNamedBlob' }) }),
      z.object({ count: z.number() }),
    ),
    { registry, flatten: true },
  )
  flattenedWithNamedChild(): void {}

  @Post('flattened-with-named-root')
  @ZodBody(
    z
      .intersection(
        z.object({ a: z.string() }).meta({ id: 'FlatNamedRootLeft' }),
        z.object({ b: z.number() }).meta({ id: 'FlatNamedRootRight' }),
      )
      .meta({ id: 'FlatNamedRoot' }),
    { registry, flatten: true },
  )
  flattenedWithNamedRoot(): void {}
}

describe('@ZodBody / @ZodQuery / @ZodHeaders — end-to-end with applyZodNest', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const result = await bootstrap([CasesController]);
    app = result.app;
    doc = applyZodNest(result.raw, { registry });
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

  it('exposes the named @ZodQuery root (via its doc marker) even when expanded inline', () => {
    // Exposure is now reachability-scoped. `@ZodQuery` emits a deferred marker
    // parameter carrying the root dtoId, so `collectUsage` sees it in the doc
    // and exposes the root — honoring "expand inline but still document the
    // query schema" — even though no `$ref` points at the root after expansion.
    const schemas = doc.components?.schemas as Record<string, unknown>;
    expect(schemas['ListingQuery']).toBeDefined();
  });

  it('prunes the eagerly-expanded @ZodHeaders root (no doc reference to it)', () => {
    // `@ZodHeaders` expands per-property at decoration time without a root
    // marker, so nothing in the document references `ListingHeaders`. Under
    // reachability-scoped exposure it is pruned — the per-property header
    // parameters carry the full contract.
    const schemas = doc.components?.schemas as Record<string, unknown>;
    expect(schemas['ListingHeaders']).toBeUndefined();
  });

  // ─── flatten: true (Swagger UI multipart compatibility) ─────────────────

  it('emits a flat inline body — no $ref, no allOf — when flatten: true', () => {
    const op = opAt(doc, '/cases/flattened-multipart', 'post');
    const requestBody = op.requestBody as Record<string, unknown> | undefined;
    const content = requestBody?.content as
      | Record<string, { schema?: Record<string, unknown> }>
      | undefined;
    const schema = content?.['application/json']?.schema;
    expect(schema?.$ref).toBeUndefined();
    expect(schema?.allOf).toBeUndefined();
    expect(schema?.type).toBe('object');
    const props = schema?.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('prunes flattened arms that are merged away (no $ref points at them)', () => {
    // FlatLeft / FlatRight are merged into the flat inline body, so nothing in
    // the document `$ref`s them. Under reachability-scoped exposure they are
    // pruned — only schemas referenced by an endpoint (directly or via a
    // surviving `$ref`) are kept.
    const schemas = doc.components?.schemas as Record<string, unknown>;
    expect(schemas['FlatLeft']).toBeUndefined();
    expect(schemas['FlatRight']).toBeUndefined();
  });

  it('keeps the flat inline body but prunes the flattened named root (nothing $refs it)', () => {
    // The operation body is the flat merged form (Swagger UI friendly). The
    // named root's natural (allOf) composition is NOT referenced by any
    // operation — flatten inlines the body — so under reachability-scoped
    // exposure the catalog entry is pruned. Add `.meta({ id })` plus an
    // endpoint that `$ref`s it (or `{ expose: true }`) to keep it.
    const op = opAt(doc, '/cases/flattened-with-named-root', 'post');
    const requestBody = op.requestBody as Record<string, unknown> | undefined;
    const content = requestBody?.content as
      | Record<string, { schema?: Record<string, unknown> }>
      | undefined;
    const opSchema = content?.['application/json']?.schema;
    expect(opSchema?.$ref).toBeUndefined();
    expect(opSchema?.type).toBe('object');
    const opProps = opSchema?.properties as Record<string, unknown>;
    expect(Object.keys(opProps).sort()).toEqual(['a', 'b']);

    const schemas = doc.components?.schemas as Record<string, unknown>;
    expect(schemas['FlatNamedRoot']).toBeUndefined();
    expect(schemas['FlatNamedRootLeft']).toBeUndefined();
    expect(schemas['FlatNamedRootRight']).toBeUndefined();
  });

  it('emits components.schemas entries for named child schemas referenced inside a flattened body', () => {
    // Regression: when `flatten: true` produces an inline body like
    // `{ type: 'object', properties: { csv: { $ref: ... } } }`, the nested
    // refs must still trigger emission. Earlier `collectUsage` only walked
    // top-level `$ref`s in request bodies; nested refs inside flattened
    // bodies got dropped, surfacing as `DANGLING_REF` at doc-build time.
    const schemas = doc.components?.schemas as Record<string, unknown>;
    expect(schemas['FlatNamedBlob']).toBeDefined();
  });
});
