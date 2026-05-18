import type { OpenAPIObject } from '@nestjs/swagger';

import { stripMarkers } from '../../src/document/strip-markers.js';
import { makeZodDtoMarker } from '../../src/dto/marker.js';
import { ZOD_NEST_DTO_EXTENSION } from '../../src/schema/constants.js';

const docOf = (schemas: Record<string, unknown>): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths: {},
    components: { schemas },
  }) as unknown as OpenAPIObject;

describe('stripMarkers', () => {
  it('removes the x-zod-nest-dto entry from properties', () => {
    const doc = docOf({
      Foo: {
        type: 'object',
        properties: {
          [ZOD_NEST_DTO_EXTENSION]: makeZodDtoMarker('Foo', 'input'),
          id: { type: 'string' },
        },
      },
    });

    stripMarkers(doc);

    const foo = (doc.components?.schemas as Record<string, unknown>).Foo as {
      properties: Record<string, unknown>;
    };
    expect(ZOD_NEST_DTO_EXTENSION in foo.properties).toBe(false);
    expect(foo.properties.id).toEqual({ type: 'string' });
  });

  it('drops the empty `properties` block when the marker was the only key', () => {
    const doc = docOf({
      Foo: {
        type: 'object',
        properties: { [ZOD_NEST_DTO_EXTENSION]: makeZodDtoMarker('Foo', 'input') },
      },
    });

    stripMarkers(doc);

    const foo = (doc.components?.schemas as Record<string, unknown>).Foo as {
      properties?: Record<string, unknown>;
    };
    expect(foo.properties).toBeUndefined();
  });

  it('preserves x-zod-nest-error (collision-decoration marker)', () => {
    const doc = docOf({
      Dup: { description: 'ERROR: duplicate', 'x-zod-nest-error': 'duplicate-id' },
    });

    stripMarkers(doc);

    expect((doc.components?.schemas as Record<string, unknown>).Dup).toEqual({
      description: 'ERROR: duplicate',
      'x-zod-nest-error': 'duplicate-id',
    });
  });

  it('leaves non-marker schemas untouched', () => {
    const doc = docOf({
      Plain: { type: 'object', properties: { id: { type: 'string' } } },
      WithRef: { properties: { tag: { $ref: '#/components/schemas/Tag' } } },
    });

    stripMarkers(doc);

    expect((doc.components?.schemas as Record<string, unknown>).Plain).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    expect((doc.components?.schemas as Record<string, unknown>).WithRef).toEqual({
      properties: { tag: { $ref: '#/components/schemas/Tag' } },
    });
  });

  it('is a no-op when components.schemas is absent', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      paths: {},
    } as OpenAPIObject;
    expect(() => stripMarkers(doc)).not.toThrow();
  });

  it('skips null/non-object schema entries (defensive)', () => {
    const doc = docOf({
      Foo: null as unknown as Record<string, unknown>,
      Bar: 'not-an-object' as unknown as Record<string, unknown>,
      Ok: {
        properties: { [ZOD_NEST_DTO_EXTENSION]: makeZodDtoMarker('Ok', 'input') },
      },
    });

    expect(() => stripMarkers(doc)).not.toThrow();
    const ok = (doc.components?.schemas as Record<string, unknown>).Ok as {
      properties?: Record<string, unknown>;
    };
    expect(ok.properties).toBeUndefined();
  });

  it('removes leftover marker parameters from operation.parameters[]', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      paths: {
        '/x': {
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
              {
                name: 'x-zod-nest-dto',
                in: 'query',
                __zodNestDto: true,
                dtoId: 'StaleMarker',
                io: 'input',
              },
            ],
          },
        },
      },
      components: { schemas: {} },
    } as unknown as OpenAPIObject;

    stripMarkers(doc);

    const paths = doc.paths as unknown as Record<string, Record<string, Record<string, unknown>>>;
    const params = paths['/x']?.get?.parameters as Array<Record<string, unknown>>;
    expect(params).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ]);
  });

  it('handles missing / null / malformed paths and parameters defensively', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      paths: {
        '/null-pathitem': null,
        '/null-op': { post: null },
        '/non-array-params': { get: { parameters: 'not-an-array' } },
        '/null-param': {
          get: {
            parameters: [
              null,
              'string-not-object',
              { name: 'real', in: 'query', schema: { type: 'string' } },
            ],
          },
        },
      },
      components: { schemas: {} },
    } as unknown as OpenAPIObject;

    expect(() => stripMarkers(doc)).not.toThrow();
    // Real parameter survives; the null / non-object entries are kept verbatim
    // (the filter only drops marker entries).
    const paths = doc.paths as unknown as Record<string, Record<string, Record<string, unknown>>>;
    const params = paths['/null-param']?.get?.parameters as unknown[];
    expect(params).toHaveLength(3);
  });

  it('is a no-op when doc.paths is missing entirely', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      components: { schemas: {} },
    } as unknown as OpenAPIObject;
    expect(() => stripMarkers(doc)).not.toThrow();
  });

  it('drops `$schema` and `$id` from every components.schemas[K] body', () => {
    const doc = docOf({
      SortDirection: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: '#/components/schemas/SortDirection',
        type: 'string',
        enum: ['asc', 'desc'],
        title: 'SortDirection',
      },
      Plain: { type: 'object', properties: { x: { type: 'string' } } },
    });

    stripMarkers(doc);

    const schemas = doc.components?.schemas as Record<string, Record<string, unknown>>;
    const sortDirection = schemas.SortDirection!;
    expect(sortDirection).not.toHaveProperty('$schema');
    expect(sortDirection).not.toHaveProperty('$id');
    // Other fields are preserved.
    expect(sortDirection.type).toBe('string');
    expect(sortDirection.title).toBe('SortDirection');
    // Schemas without the metadata are untouched.
    expect(schemas.Plain).toEqual({ type: 'object', properties: { x: { type: 'string' } } });
  });

  it('does not chase `$id` / `$schema` inside nested properties (root-level only)', () => {
    const doc = docOf({
      Outer: {
        $id: '#/components/schemas/Outer',
        type: 'object',
        properties: {
          inner: {
            // Nested $id / $schema must survive — those are part of a
            // referenced sub-schema's payload, not the root component identity.
            $id: 'nested-id',
            $schema: 'nested-dialect',
            type: 'string',
          },
        },
      },
    });

    stripMarkers(doc);

    const outer = (doc.components?.schemas as Record<string, Record<string, unknown>>).Outer!;
    expect(outer).not.toHaveProperty('$id');
    const inner = (outer.properties as Record<string, Record<string, unknown>>).inner!;
    expect(inner.$id).toBe('nested-id');
    expect(inner.$schema).toBe('nested-dialect');
  });
});
