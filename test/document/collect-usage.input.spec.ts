import type { OpenAPIObject } from '@nestjs/swagger';

import { collectUsage } from '../../src/document/collect-usage.js';
import { makeZodDtoMarker } from '../../src/dto/marker.js';
import { ZOD_NEST_DTO_EXTENSION } from '../../src/schema/constants.js';
import { createRegistry } from '../../src/schema/registry.js';

// Fresh empty registry per test invocation — the existing suite predates
// decorator-emitted refs (which need the registry to seed exposed ids) so
// an empty registry matches the pre-change behavior exactly.
const stubRegistry = createRegistry();

const makeDoc = (override: { paths?: unknown; components?: unknown } = {}): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths: {},
    components: { schemas: {} },
    ...override,
  }) as unknown as OpenAPIObject;

// Marker `type` is a callable (() => Object) — incompatible with the swagger
// `SchemaObject.type: string` typing; cast through `unknown` for fixture use.
const markerSchema = (dtoId: string, io: 'input' | 'output' = 'input'): unknown => ({
  type: 'object',
  properties: { [ZOD_NEST_DTO_EXTENSION]: makeZodDtoMarker(dtoId, io) },
});

describe('collectUsage — input side + class→dtoId map', () => {
  it('returns empty sets when the doc has no zod-nest markers', () => {
    const doc = makeDoc();
    const { inputExposedIds, outputExposedIds, classToDtoId } = collectUsage(doc, stubRegistry);

    expect(inputExposedIds.size).toBe(0);
    expect(outputExposedIds.size).toBe(0);
    expect(classToDtoId.size).toBe(0);
  });

  it('handles a doc with neither `paths` nor `components` (nullish fallbacks)', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
    } as unknown as OpenAPIObject;
    const { inputExposedIds, outputExposedIds, classToDtoId } = collectUsage(doc, stubRegistry);

    expect(inputExposedIds.size).toBe(0);
    expect(outputExposedIds.size).toBe(0);
    expect(classToDtoId.size).toBe(0);
  });

  it('builds class→dtoId map from `properties[x-zod-nest-dto]` markers', () => {
    const doc = makeDoc({
      components: {
        schemas: {
          UserDto: markerSchema('User'),
          TagDto: markerSchema('Tag'),
          PlainSchema: { type: 'object', properties: { x: { type: 'string' } } },
        },
      },
    });

    const { classToDtoId } = collectUsage(doc, stubRegistry);

    expect(classToDtoId.get('UserDto')).toBe('User');
    expect(classToDtoId.get('TagDto')).toBe('Tag');
    expect(classToDtoId.has('PlainSchema')).toBe(false);
  });

  it('detects input-side ids from requestBody.$ref', () => {
    const doc = makeDoc({
      paths: {
        '/users': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/UserDto' } },
              },
            },
          },
        },
      },
      components: { schemas: { UserDto: markerSchema('User') } },
    });

    const { inputExposedIds } = collectUsage(doc, stubRegistry);
    expect([...inputExposedIds]).toEqual(['User']);
  });

  it('detects input-side ids from `__zodNestDto: true` marker parameters (query / path / header DTOs)', () => {
    // Mirror of the placeholder @nestjs/swagger emits for `@Query() x: QueryDto`,
    // `@Param() y: PathDto`, etc. — a single parameter named `x-zod-nest-dto`
    // carrying the marker fields. `expandParamMarkers` later splits this; this
    // pre-pass test just verifies collect-usage adds the dtoId to `inputExposedIds`
    // so `bulkEmit` materialises the schema for that expansion.
    const doc = makeDoc({
      paths: {
        '/templates': {
          get: {
            parameters: [
              {
                name: 'x-zod-nest-dto',
                in: 'query',
                required: false,
                __zodNestDto: true,
                dtoId: 'TemplatesPaginationParams',
                io: 'input',
                schema: { $ref: '#/components/schemas/Object' },
              },
            ],
          },
        },
      },
    });

    const { inputExposedIds } = collectUsage(doc, stubRegistry);
    expect([...inputExposedIds]).toEqual(['TemplatesPaginationParams']);
  });

  it('ignores marker parameters whose `dtoId` is missing / empty / non-string', () => {
    const doc = makeDoc({
      paths: {
        '/x': {
          get: {
            parameters: [
              // valid — dtoId is a non-empty string
              {
                name: 'x-zod-nest-dto',
                in: 'query',
                __zodNestDto: true,
                dtoId: 'RealDto',
                io: 'input',
              },
              // invalid — empty dtoId
              { name: 'x-zod-nest-dto', in: 'query', __zodNestDto: true, dtoId: '', io: 'input' },
              // invalid — non-string dtoId
              { name: 'x-zod-nest-dto', in: 'query', __zodNestDto: true, dtoId: 42, io: 'input' },
              // invalid — missing dtoId
              { name: 'x-zod-nest-dto', in: 'query', __zodNestDto: true, io: 'input' },
              // invalid — __zodNestDto is not true
              { name: 'x-zod-nest-dto', in: 'query', __zodNestDto: false, dtoId: 'Skipped' },
            ],
          },
        },
      },
    });

    const { inputExposedIds } = collectUsage(doc, stubRegistry);
    expect([...inputExposedIds]).toEqual(['RealDto']);
  });

  it('detects input-side ids from parameters[*].schema.$ref', () => {
    const doc = makeDoc({
      paths: {
        '/users/{id}': {
          get: {
            parameters: [
              { name: 'id', in: 'path', schema: { $ref: '#/components/schemas/IdDto' } },
              { name: 'q', in: 'query', schema: { $ref: '#/components/schemas/QueryDto' } },
            ],
          },
        },
      },
      components: {
        schemas: { IdDto: markerSchema('Id'), QueryDto: markerSchema('Query') },
      },
    });

    const { inputExposedIds } = collectUsage(doc, stubRegistry);
    expect([...inputExposedIds].sort()).toEqual(['Id', 'Query']);
  });

  it('ignores `$ref`s pointing at non-zod-nest schemas', () => {
    const doc = makeDoc({
      paths: {
        '/x': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/NativeDto' } },
              },
            },
          },
        },
      },
      components: { schemas: { NativeDto: { type: 'object' } } },
    });

    const { inputExposedIds } = collectUsage(doc, stubRegistry);
    expect(inputExposedIds.size).toBe(0);
  });

  it('handles `dtoId !== className` (collected id is the marker dtoId, not the key)', () => {
    const doc = makeDoc({
      paths: {
        '/foo': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/FooDto' } },
              },
            },
          },
        },
      },
      components: { schemas: { FooDto: markerSchema('Bar') } },
    });

    const { inputExposedIds, classToDtoId } = collectUsage(doc, stubRegistry);
    expect([...inputExposedIds]).toEqual(['Bar']);
    expect(classToDtoId.get('FooDto')).toBe('Bar');
  });

  it('deduplicates ids across multiple operations referencing the same DTO', () => {
    const ref = { $ref: '#/components/schemas/UserDto' };
    const doc = makeDoc({
      paths: {
        '/a': {
          post: { requestBody: { content: { 'application/json': { schema: ref } } } },
        },
        '/b': {
          post: { requestBody: { content: { 'application/json': { schema: ref } } } },
        },
        '/c': {
          get: { parameters: [{ name: 'x', in: 'query', schema: ref }] },
        },
      },
      components: { schemas: { UserDto: markerSchema('User') } },
    });

    const { inputExposedIds } = collectUsage(doc, stubRegistry);
    expect([...inputExposedIds]).toEqual(['User']);
  });

  it('walks every HTTP method (get/put/post/delete/options/head/patch/trace)', () => {
    const refSchema = { $ref: '#/components/schemas/UserDto' };
    const opWithBody = {
      requestBody: { content: { 'application/json': { schema: refSchema } } },
    };
    const doc = makeDoc({
      paths: {
        '/x': {
          get: opWithBody,
          put: opWithBody,
          post: opWithBody,
          delete: opWithBody,
          options: opWithBody,
          head: opWithBody,
          patch: opWithBody,
          trace: opWithBody,
        },
      },
      components: { schemas: { UserDto: markerSchema('User') } },
    });

    const { inputExposedIds } = collectUsage(doc, stubRegistry);
    expect([...inputExposedIds]).toEqual(['User']);
  });

  it('ignores malformed path items / operations / params (defensive)', () => {
    const doc = {
      ...makeDoc(),
      paths: {
        '/null-pathitem': null,
        '/null-op': { post: null },
        '/null-body': { post: { requestBody: null } },
        '/null-content': { post: { requestBody: { content: null } } },
        '/null-schema': {
          post: { requestBody: { content: { 'application/json': { schema: null } } } },
        },
        '/non-array-params': { get: { parameters: 'not-an-array' } },
        '/null-param': { get: { parameters: [null, { schema: null }] } },
      },
    } as unknown as OpenAPIObject;

    const { inputExposedIds } = collectUsage(doc, stubRegistry);
    expect(inputExposedIds.size).toBe(0);
  });

  it('ignores `$ref`s outside the `#/components/schemas/` prefix', () => {
    const doc = {
      ...makeDoc(),
      paths: {
        '/x': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/parameters/Other' } },
              },
            },
          },
        },
      },
      components: { schemas: { UserDto: markerSchema('User') } },
    } as unknown as OpenAPIObject;

    const { inputExposedIds } = collectUsage(doc, stubRegistry);
    expect(inputExposedIds.size).toBe(0);
  });

  it('ignores non-object media-type entries in requestBody.content', () => {
    const doc = {
      ...makeDoc(),
      paths: {
        '/x': {
          post: {
            requestBody: {
              content: {
                'application/json': null,
                'text/plain': 'string-not-object',
              },
            },
          },
        },
      },
    } as unknown as OpenAPIObject;

    const { inputExposedIds } = collectUsage(doc, stubRegistry);
    expect(inputExposedIds.size).toBe(0);
  });

  it('ignores marker-shaped objects that fail the `isZodDtoMarker` guard', () => {
    const doc = {
      ...makeDoc(),
      components: {
        schemas: {
          FakeDto: {
            properties: {
              [ZOD_NEST_DTO_EXTENSION]: { dtoId: 'Forged' /* missing __zodNestDto: true */ },
            },
          },
          NullSchema: null,
          NullProps: { properties: null },
        },
      },
    } as unknown as OpenAPIObject;

    const { classToDtoId } = collectUsage(doc, stubRegistry);
    expect(classToDtoId.size).toBe(0);
  });
});
