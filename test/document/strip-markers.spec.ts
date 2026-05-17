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
});
