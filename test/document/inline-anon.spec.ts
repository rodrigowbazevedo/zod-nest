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
      Record<string, Record<string, unknown>> | undefined;
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

interface CommentShape {
  body: string;
  replies: CommentShape[];
}

// Anonymous AND recursive: no `.meta({ id })`, and the body refs itself.
const AnonComment: z.ZodType<CommentShape> = z.lazy(() =>
  z.object({ body: z.string(), replies: z.array(AnonComment) }),
);
// A distinct instance — `resolveAnonId` caches one id per schema instance, so
// reusing `AnonComment` here would share its `_AnonBodySchema_` id.
const AnonReply: z.ZodType<CommentShape> = z.lazy(() =>
  z.object({ body: z.string(), replies: z.array(AnonReply) }),
);
const NamedComment: z.ZodType<CommentShape> = z
  .lazy(() => z.object({ body: z.string(), replies: z.array(NamedComment) }))
  .meta({ id: 'RecNamedComment' });

@Controller('rec')
class RecursiveController {
  @Post('anon-body')
  @ZodBody(AnonComment)
  anonBody(): void {}

  @Get('anon-response')
  @ZodResponse({ status: HttpStatus.OK, type: AnonReply })
  anonResponse(): unknown {
    return {};
  }

  @Post('named-body')
  @ZodBody(NamedComment)
  namedBody(): void {}

  @Post('flat-body')
  @ZodBody(z.object({ label: z.string() }))
  flatBody(): void {}
}

describe('applyZodNest — a recursive anonymous body stays a component', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [RecursiveController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const config = new DocumentBuilder().setTitle('t').setVersion('v').build();
    doc = applyZodNest(SwaggerModule.createDocument(app, config));
  });

  afterAll(() => app.close());

  const schemas = (): Record<string, unknown> => doc.components?.schemas as Record<string, unknown>;

  const bodySchemaAt = (path: string): Record<string, unknown> | undefined => {
    const op = (doc.paths as Record<string, Record<string, Record<string, unknown>>>)[path]?.[
      'post'
    ];
    const body = op?.requestBody as Record<string, Record<string, unknown>> | undefined;
    const content = body?.content as Record<string, Record<string, unknown>> | undefined;
    return content?.['application/json']?.schema as Record<string, unknown> | undefined;
  };

  const anonIds = (): string[] => Object.keys(schemas()).filter((id) => id.startsWith('_Anon'));

  it('emits a document instead of throwing DANGLING_REF', () => {
    expect(doc.components?.schemas).toBeDefined();
  });

  it('references the retained component from the operation', () => {
    const schema = bodySchemaAt('/rec/anon-body');
    expect(schema?.$ref).toMatch(/^#\/components\/schemas\/_AnonBodySchema_/);
  });

  it('keeps the recursive body reachable so its self-ref resolves', () => {
    const bodyRef = bodySchemaAt('/rec/anon-body')?.$ref as string;
    const id = bodyRef.slice(ROOT.length);
    const body = schemas()[id] as { properties?: Record<string, { items?: { $ref?: string } }> };

    expect(body.properties?.replies?.items?.$ref).toBe(bodyRef);
  });

  it('retains a component for the recursive response body too', () => {
    expect(anonIds().some((id) => id.startsWith('_AnonResponseSchema_'))).toBe(true);
  });

  it('leaves every $ref in the document resolvable', () => {
    const present = new Set(Object.keys(schemas()));
    const unresolved: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }
      if (node === null || typeof node !== 'object') {
        return;
      }
      const obj = node as Record<string, unknown>;
      const ref = obj.$ref;
      if (typeof ref === 'string' && ref.startsWith(ROOT) && !present.has(ref.slice(ROOT.length))) {
        unresolved.push(ref);
      }
      for (const value of Object.values(obj)) {
        walk(value);
      }
    };
    walk(doc);

    expect(unresolved).toEqual([]);
  });

  it('still inlines and prunes a non-recursive anonymous body', () => {
    const schema = bodySchemaAt('/rec/flat-body');
    expect(schema?.$ref).toBeUndefined();
    expect(schema?.properties).toMatchObject({ label: { type: 'string' } });
  });

  it('leaves a named recursive schema on its own id', () => {
    expect(schemas()['RecNamedComment']).toBeDefined();
    expect(bodySchemaAt('/rec/named-body')?.$ref).toBe(`${ROOT}RecNamedComment`);
  });
});
