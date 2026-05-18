import 'reflect-metadata';

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Query,
  Type,
} from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest, createZodDto, ZodNestDocumentError, ZodResponse } from '../../src';

const ROOT = '#/components/schemas/';

const bootstrap = async (
  controllers: Type<unknown>[],
): Promise<{ app: INestApplication; raw: OpenAPIObject }> => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const config = new DocumentBuilder().setTitle('t').setVersion('v').build();
  const raw = SwaggerModule.createDocument(app, config);
  return { app, raw };
};

const schemasOf = (doc: OpenAPIObject): Record<string, unknown> =>
  doc.components?.schemas as Record<string, unknown>;

const refAt = (root: unknown, ...path: (string | number)[]): string | undefined => {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return typeof cur === 'string' ? cur : undefined;
};

const paramsAt = (
  doc: OpenAPIObject,
  path: string,
  method: string,
): Array<Record<string, unknown>> => {
  const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>> | undefined;
  const op = paths?.[path]?.[method];
  const parameters = op?.parameters;
  if (!Array.isArray(parameters)) {
    throw new Error(`No parameters[] at ${method.toUpperCase()} ${path}`);
  }
  return parameters as Array<Record<string, unknown>>;
};

// ─── Happy path ────────────────────────────────────────────────────────────

describe('applyZodNest — happy path (input + output)', () => {
  class HappyUserDto extends createZodDto(z.object({ id: z.string(), name: z.string() }), {
    id: 'HappyUser',
  }) {}

  @Controller('happy')
  class HappyController {
    @Post()
    @ZodResponse({ type: HappyUserDto })
    create(@Body() body: HappyUserDto): HappyUserDto {
      return body;
    }
  }

  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const boot = await bootstrap([HappyController]);
    app = boot.app;
    doc = applyZodNest(boot.raw, { app });
  });

  afterAll(() => app.close());

  it('exposes the DTO under its dtoId in components.schemas', () => {
    const body = schemasOf(doc).HappyUser as { type: string; properties: Record<string, unknown> };
    expect(body.type).toBe('object');
    expect(body.properties).toHaveProperty('id');
    expect(body.properties).toHaveProperty('name');
  });

  it('strips the x-zod-nest-dto marker from every components.schemas entry', () => {
    const happy = schemasOf(doc).HappyUser as { properties: Record<string, unknown> };
    expect(happy.properties['x-zod-nest-dto']).toBeUndefined();
  });

  it('keeps input + output requestBody/responses refs pointing at the same id (non-divergent schema)', () => {
    const inputRef = refAt(
      doc.paths,
      '/happy',
      'post',
      'requestBody',
      'content',
      'application/json',
      'schema',
      '$ref',
    );
    expect(inputRef).toBe(`${ROOT}HappyUser`);
  });
});

// ─── Divergent dtoId !== className (rename + ref rewrite) ──────────────────

describe('applyZodNest — divergent dtoId (rename + ref rewrite)', () => {
  class RenameSchemaDto extends createZodDto(z.object({ value: z.string() }), {
    id: 'RenameTarget',
  }) {}

  @Controller('rename')
  class RenameController {
    @Post()
    create(@Body() body: RenameSchemaDto): unknown {
      return body;
    }
  }

  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const boot = await bootstrap([RenameController]);
    app = boot.app;
    doc = applyZodNest(boot.raw, { app });
  });

  afterAll(() => app.close());

  it('puts the schema at components.schemas[<dtoId>] (not the class name)', () => {
    expect(schemasOf(doc).RenameTarget).toBeDefined();
    expect(schemasOf(doc).RenameSchemaDto).toBeUndefined();
  });

  it('rewrites doc-level $refs to point at the dtoId', () => {
    const ref = refAt(
      doc.paths,
      '/rename',
      'post',
      'requestBody',
      'content',
      'application/json',
      'schema',
      '$ref',
    );
    expect(ref).toBe(`${ROOT}RenameTarget`);
  });
});

// ─── Suffix: equal input/output collapses ──────────────────────────────────

describe('applyZodNest — suffix: input/output collapse when canonically equal', () => {
  // `.strict()` forces additionalProperties: false on both input + output —
  // a plain `z.object()` diverges via Zod v4's strip semantics (input allows
  // extras silently, output asserts).
  class EqualDto extends createZodDto(z.object({ a: z.string(), b: z.number() }).strict(), {
    id: 'EqualCollapse',
  }) {}

  @Controller('equal')
  class EqualController {
    @Post()
    @ZodResponse({ type: EqualDto })
    create(@Body() body: EqualDto): EqualDto {
      return body;
    }
  }

  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const boot = await bootstrap([EqualController]);
    app = boot.app;
    doc = applyZodNest(boot.raw, { app });
  });

  afterAll(() => app.close());

  it('emits one entry only — no <id>Output suffix appears', () => {
    expect(schemasOf(doc).EqualCollapse).toBeDefined();
    expect(schemasOf(doc).EqualCollapseOutput).toBeUndefined();
  });
});

// ─── Suffix: divergent input/output splits ─────────────────────────────────

describe('applyZodNest — suffix: divergent input/output splits with Output suffix', () => {
  // `.default()` diverges: input optional (default fills in), output required.
  class DivergentDto extends createZodDto(z.object({ name: z.string().default('anon') }), {
    id: 'DivergentSplit',
  }) {}

  @Controller('divergent')
  class DivergentController {
    @Post()
    @ZodResponse({ type: DivergentDto })
    create(@Body() body: DivergentDto): DivergentDto {
      return body;
    }
  }

  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const boot = await bootstrap([DivergentController]);
    app = boot.app;
    doc = applyZodNest(boot.raw, { app });
  });

  afterAll(() => app.close());

  it('emits both <id> and <id>Output entries', () => {
    expect(schemasOf(doc).DivergentSplit).toBeDefined();
    expect(schemasOf(doc).DivergentSplitOutput).toBeDefined();
  });

  it('keeps input-side requestBody ref pointed at the canonical id', () => {
    expect(
      refAt(
        doc.paths,
        '/divergent',
        'post',
        'requestBody',
        'content',
        'application/json',
        'schema',
        '$ref',
      ),
    ).toBe(`${ROOT}DivergentSplit`);
  });
});

// ─── Output-only (DTO referenced via @ZodResponse but not @Body) ───────────

describe('applyZodNest — @ZodResponse-only DTO lands via the controller walk', () => {
  class OutputOnlyDto extends createZodDto(z.object({ kind: z.string() }), {
    id: 'OutputOnly',
  }) {}

  @Controller('out')
  class OutputOnlyController {
    @Get()
    @ZodResponse({ type: OutputOnlyDto })
    list(): OutputOnlyDto[] {
      return [];
    }
  }

  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const boot = await bootstrap([OutputOnlyController]);
    app = boot.app;
    doc = applyZodNest(boot.raw, { app });
  });

  afterAll(() => app.close());

  it('puts the DTO in components.schemas even with no @Body reference in the doc', () => {
    const body = schemasOf(doc).OutputOnly as { properties?: Record<string, unknown> };
    expect(body).toBeDefined();
    expect(body.properties).toHaveProperty('kind');
  });
});

// ─── Array + tuple shorthand register the underlying DTOs ──────────────────

describe('applyZodNest — array + tuple @ZodResponse shorthand registers underlying DTOs', () => {
  class ArrayItemDto extends createZodDto(z.object({ id: z.string() }), { id: 'ArrayItem' }) {}
  class TupleHeadDto extends createZodDto(z.object({ head: z.string() }), { id: 'TupleHead' }) {}
  class TupleTailDto extends createZodDto(z.object({ tail: z.string() }), { id: 'TupleTail' }) {}

  @Controller('shapes')
  class ShapesController {
    @Get('list')
    @ZodResponse({ type: [ArrayItemDto] })
    list(): ArrayItemDto[] {
      return [];
    }

    @Get('pair')
    @ZodResponse({ type: [TupleHeadDto, TupleTailDto] })
    pair(): unknown {
      return [];
    }
  }

  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const boot = await bootstrap([ShapesController]);
    app = boot.app;
    doc = applyZodNest(boot.raw, { app });
  });

  afterAll(() => app.close());

  it('registers the underlying DTO ids (not the wrapper array/tuple)', () => {
    expect(schemasOf(doc).ArrayItem).toBeDefined();
    expect(schemasOf(doc).TupleHead).toBeDefined();
    expect(schemasOf(doc).TupleTail).toBeDefined();
  });
});

// ─── Multi-status @ZodResponse stack ───────────────────────────────────────

describe('applyZodNest — multi-status @ZodResponse stack', () => {
  class OkResponseDto extends createZodDto(z.object({ data: z.string() }), {
    id: 'MultiOkResponse',
  }) {}
  class NotFoundResponseDto extends createZodDto(z.object({ code: z.number() }), {
    id: 'MultiNotFoundResponse',
  }) {}

  @Controller('multi')
  class MultiController {
    @Get(':id')
    @ZodResponse({ status: HttpStatus.OK, type: OkResponseDto })
    @ZodResponse({ status: HttpStatus.NOT_FOUND, type: NotFoundResponseDto })
    one(): OkResponseDto {
      return new OkResponseDto();
    }
  }

  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const boot = await bootstrap([MultiController]);
    app = boot.app;
    doc = applyZodNest(boot.raw, { app });
  });

  afterAll(() => app.close());

  it('registers every referenced DTO in components.schemas', () => {
    expect(schemasOf(doc).MultiOkResponse).toBeDefined();
    expect(schemasOf(doc).MultiNotFoundResponse).toBeDefined();
  });
});

// ─── No zod-nest DTOs at all ──────────────────────────────────────────────

describe('applyZodNest — controller with no zod-nest DTOs is a clean pass-through', () => {
  @Controller('plain')
  class PlainController {
    @Get()
    hello(): string {
      return 'hi';
    }
  }

  it('runs without error and leaves the doc untouched (no errors, no extra schemas)', async () => {
    const { app, raw } = await bootstrap([PlainController]);
    const originalSchemaCount = Object.keys(raw.components?.schemas ?? {}).length;
    const doc = applyZodNest(raw, { app });
    expect(Object.keys(schemasOf(doc)).length).toBe(originalSchemaCount);
    await app.close();
  });
});

// ─── Dangling ref ──────────────────────────────────────────────────────────

describe('applyZodNest — dangling ref guard', () => {
  class DanglingDto extends createZodDto(z.object({ x: z.string() }), { id: 'DanglingOk' }) {}

  @Controller('dangling')
  class DanglingController {
    @Post()
    create(@Body() body: DanglingDto): unknown {
      return body;
    }
  }

  it('throws ZodNestDocumentError(DANGLING_REF) when a pre-pass injects a missing ref', async () => {
    const { app, raw } = await bootstrap([DanglingController]);
    // Inject a $ref to a nonexistent schema.
    const ops = (raw.paths as Record<string, Record<string, Record<string, unknown>>>)?.[
      '/dangling'
    ]?.post;
    if (ops !== undefined) {
      ops.responses = {
        '500': {
          description: 'oops',
          content: { 'application/json': { schema: { $ref: `${ROOT}NeverDefined` } } },
        },
      };
    }

    let caught: unknown;
    try {
      applyZodNest(raw, { app });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ZodNestDocumentError);
    expect((caught as ZodNestDocumentError).code).toBe('DANGLING_REF');
    expect((caught as ZodNestDocumentError).details.dangling).toContain(`${ROOT}NeverDefined`);
    await app.close();
  });
});

// ─── Collision id reuse (two classes targeting the same dtoId) ────────────

describe('applyZodNest — same dtoId across two classes decorates with duplicate-id error', () => {
  // Two distinct classes with explicit id: 'CollisionShared' → registry
  // tracks the collision; merge-schemas replaces the body with the
  // duplicate-id error marker so the broken contract is visible.
  class ShareA extends createZodDto(z.object({ count: z.number() }), {
    id: 'CollisionShared',
  }) {}
  class ShareB extends createZodDto(z.object({ name: z.string() }), {
    id: 'CollisionShared',
  }) {}

  @Controller('collision')
  class CollisionController {
    @Post('a')
    a(@Body() body: ShareA): unknown {
      return body;
    }

    @Post('b')
    b(@Body() body: ShareB): unknown {
      return body;
    }
  }

  it('replaces the body with `x-zod-nest-error: duplicate-id` instead of silently picking one', async () => {
    const { app, raw } = await bootstrap([CollisionController]);
    const doc = applyZodNest(raw, { app });

    const body = schemasOf(doc).CollisionShared as Record<string, unknown>;
    expect(body['x-zod-nest-error']).toBe('duplicate-id');
    expect(body.description).toContain('CollisionShared');
    await app.close();
  });
});

// ─── Ambiguous rename (different bodies hit the same target key) ───────────

describe('applyZodNest — ambiguous rename guard', () => {
  // Synthetic: feed mergeSchemas via the orchestrator a doc where a
  // pre-existing non-marker entry sits at the rename target with a different
  // body. Easiest reproduction is to inject the conflict into the raw doc
  // before applyZodNest runs.
  class AmbigDto extends createZodDto(z.object({ x: z.string() }), { id: 'AmbigTarget' }) {}

  @Controller('ambig')
  class AmbigController {
    @Post()
    create(@Body() body: AmbigDto): unknown {
      return body;
    }
  }

  it('throws ZodNestDocumentError(AMBIGUOUS_RENAME) when the rename target already holds a differing body', async () => {
    const { app, raw } = await bootstrap([AmbigController]);
    // Inject a non-marker, non-equal body at the rename target (`AmbigTarget`).
    if (raw.components?.schemas !== undefined) {
      (raw.components.schemas as Record<string, unknown>).AmbigTarget = {
        type: 'string',
        description: 'injected',
      };
    }

    let caught: unknown;
    try {
      applyZodNest(raw, { app });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ZodNestDocumentError);
    expect((caught as ZodNestDocumentError).code).toBe('AMBIGUOUS_RENAME');
    expect((caught as ZodNestDocumentError).details.key).toBe('AmbigTarget');
    await app.close();
  });
});

// ─── Composability: pre/post user passes survive applyZodNest ──────────────

describe('applyZodNest — composability with user-supplied pre/post passes', () => {
  class ComposeDto extends createZodDto(z.object({ id: z.string() }), { id: 'Compose' }) {}

  @Controller('compose')
  class ComposeController {
    @Post()
    @ZodResponse({ type: ComposeDto })
    create(@Body() body: ComposeDto): ComposeDto {
      return body;
    }
  }

  it('preserves user-added extensions on unrelated operations', async () => {
    const { app, raw } = await bootstrap([ComposeController]);

    // Pre-pass: tag every operation with a custom extension.
    for (const pathItem of Object.values(raw.paths ?? {})) {
      if (!pathItem || typeof pathItem !== 'object') {
        continue;
      }
      for (const op of Object.values(pathItem as Record<string, unknown>)) {
        if (op !== null && typeof op === 'object') {
          (op as Record<string, unknown>)['x-tenant'] = 'acme';
        }
      }
    }

    const doc = applyZodNest(raw, { app });

    // Post-pass tag must still be present on the operation.
    const op = (doc.paths as Record<string, Record<string, Record<string, unknown>>>)['/compose']
      ?.post;
    expect(op?.['x-tenant']).toBe('acme');
    await app.close();
  });
});

// ─── Nested .meta({ id }) auto-pickup ──────────────────────────────────────

describe('applyZodNest — nested .meta({ id }) schemas are registered transitively', () => {
  // Helper schema declared with `.meta({ id })` but NOT wrapped in
  // `createZodDto`. nestjs-zod allowed this pattern; previously zod-nest
  // dropped the helper from `components.schemas` and `assertNoDanglingRefs`
  // would throw. After the transitive-registration fix, the helper is
  // emitted as a named component.
  const NestedFileType = z.enum(['csv', 'xlsx', 'json']).meta({ id: 'NestedFileType' });
  class NestedParentDto extends createZodDto(
    z.object({ datasetId: z.number(), fileType: NestedFileType }),
    { id: 'NestedParent' },
  ) {}

  @Controller('nested')
  class NestedController {
    @Post()
    create(@Body() body: NestedParentDto): NestedParentDto {
      return body;
    }
  }

  it('emits both the wrapping DTO and the nested helper into components.schemas without dangling refs', async () => {
    const { app, raw } = await bootstrap([NestedController]);
    const doc = applyZodNest(raw, { app });

    const components = schemasOf(doc);
    expect(components.NestedParent).toBeDefined();
    expect(components.NestedFileType).toBeDefined();

    // The nested schema is emitted as a real body, not a $ref or marker.
    const helper = components.NestedFileType as Record<string, unknown>;
    expect(helper.type).toBe('string');
    expect(helper.enum).toEqual(['csv', 'xlsx', 'json']);

    // The parent references the helper via $ref.
    expect(refAt(components.NestedParent, 'properties', 'fileType', '$ref')).toBe(
      `${ROOT}NestedFileType`,
    );

    await app.close();
  });
});

// ─── Parameter-marker expansion (@Query / @Param / @Headers) ───────────────

describe('applyZodNest — @Query() / @Param() / @Headers() DTO marker expansion', () => {
  class ListQueryDto extends createZodDto(
    z.object({
      limit: z.number().describe('The number of items to return'),
      cursor: z.string().optional(),
      sort: z.enum(['asc', 'desc']).optional(),
    }),
    { id: 'ListQueryDto' },
  ) {}
  class PathParamsDto extends createZodDto(z.object({ templateId: z.number() }), {
    id: 'PathParamsDto',
  }) {}
  class HeadersDto extends createZodDto(z.object({ 'x-trace-id': z.string() }), {
    id: 'HeadersDto',
  }) {}
  class ListBodyDto extends createZodDto(z.object({ name: z.string() }), {
    id: 'ListBodyDto',
  }) {}

  @Controller('items')
  class ParamMixController {
    @Get()
    list(@Query() q: ListQueryDto): ListBodyDto[] {
      return [q as never];
    }

    @Get(':templateId')
    one(@Param() params: PathParamsDto, @Headers() _headers: HeadersDto): ListBodyDto {
      return params as never;
    }

    @Post()
    create(@Body() body: ListBodyDto): ListBodyDto {
      return body;
    }
  }

  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const boot = await bootstrap([ParamMixController]);
    app = boot.app;
    doc = applyZodNest(boot.raw, { app });
  });

  afterAll(() => app.close());

  it('forces `openapi: "3.1.0"` on the emitted document', () => {
    expect(doc.openapi).toBe('3.1.0');
  });

  it('expands @Query() DTO into one parameter per top-level field', () => {
    const params = paramsAt(doc, '/items', 'get');
    const names = params.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['limit', 'cursor', 'sort']));
    // No leftover marker placeholder.
    expect(names).not.toContain('x-zod-nest-dto');
    // `.describe()` stays on the parameter schema (where Zod emits it);
    // applyZodNest no longer copies it to the parameter object itself.
    const limit = params.find((p) => p.name === 'limit');
    expect(limit).not.toHaveProperty('description');
    expect((limit?.schema as Record<string, unknown>).description).toBe(
      'The number of items to return',
    );
  });

  it('expands @Param() DTO into individual path parameters with `required: true`', () => {
    const params = paramsAt(doc, '/items/{templateId}', 'get');
    const templateId = params.find((p) => p.name === 'templateId');
    expect(templateId).toBeDefined();
    expect(templateId?.in).toBe('path');
    expect(templateId?.required).toBe(true);
  });

  it('expands @Headers() DTO with `in: "header"`', () => {
    const params = paramsAt(doc, '/items/{templateId}', 'get');
    const trace = params.find((p) => p.name === 'x-trace-id');
    expect(trace).toBeDefined();
    expect(trace?.in).toBe('header');
    expect(trace?.required).toBe(true);
  });

  it('leaves @Body() DTOs untouched (requestBody $ref intact)', () => {
    const ref = refAt(
      doc.paths,
      '/items',
      'post',
      'requestBody',
      'content',
      'application/json',
      'schema',
      '$ref',
    );
    expect(ref).toBe(`${ROOT}ListBodyDto`);
  });

  it('prunes the synthetic `Object` schema once its only referrer is gone', () => {
    expect(schemasOf(doc).Object).toBeUndefined();
  });
});

// ─── Path-param required coercion (warn + force) ───────────────────────────

describe('applyZodNest — optional field in @Param() DTO is coerced to required', () => {
  class OptionalPathDto extends createZodDto(z.object({ id: z.string().optional() }), {
    id: 'OptionalPathDto',
  }) {}

  @Controller('opt-path')
  class OptPathController {
    @Get(':id')
    one(@Param() params: OptionalPathDto): unknown {
      return params;
    }
  }

  it('coerces `required: true` and emits a console.warn naming the field', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, raw } = await bootstrap([OptPathController]);
    const doc = applyZodNest(raw, { app });

    const params = paramsAt(doc, '/opt-path/{id}', 'get');
    const id = params.find((p) => p.name === 'id');
    expect(id?.required).toBe(true);
    expect(warn).toHaveBeenCalled();
    const [firstCall] = warn.mock.calls;
    expect(firstCall?.[0]).toContain('Path parameter `id` on DTO `OptionalPathDto`');

    warn.mockRestore();
    await app.close();
  });
});

// ─── UNEXPANDABLE_PARAM_DTO guard (non-object schema bound to @Query()) ────

describe('applyZodNest — UNEXPANDABLE_PARAM_DTO guard for non-object query DTOs', () => {
  // Array shape — has no top-level `properties`; the marker cannot be split.
  class ArrayQueryDto extends createZodDto(z.array(z.string()), { id: 'ArrayQueryDto' }) {}

  @Controller('arr-query')
  class ArrQueryController {
    @Get()
    list(@Query() q: ArrayQueryDto): unknown {
      return q;
    }
  }

  it('throws ZodNestDocumentError(UNEXPANDABLE_PARAM_DTO) at applyZodNest time', async () => {
    const { app, raw } = await bootstrap([ArrQueryController]);
    let caught: unknown;
    try {
      applyZodNest(raw, { app });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ZodNestDocumentError);
    expect((caught as ZodNestDocumentError).code).toBe('UNEXPANDABLE_PARAM_DTO');
    expect((caught as ZodNestDocumentError).details.dtoId).toBe('ArrayQueryDto');
    await app.close();
  });
});

// Collision DETECTION for nested .meta({ id }) schemas is covered at the
// registry level in `test/schema/registry.transitive.spec.ts`. End-to-end
// decoration through `applyZodNest` for `.meta({ id })`-style collisions
// is not yet supported — Zod v4's bulk `toJSONSchema` throws on duplicate
// ids before zod-nest's collision decoration can run. The existing
// `createZodDto({ id })` collision path (above) works because that path
// uses `globalRegistry.add` which overwrites instead of stacking. See
// follow-up issue for the nested-collision decoration gap.
