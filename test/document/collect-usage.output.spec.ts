import { z } from 'zod';

import type { OpenAPIObject } from '@nestjs/swagger';

import { collectUsage } from '../../src/document/collect-usage.js';
import { makeZodDtoMarker } from '../../src/dto/marker.js';
import { ZOD_NEST_DTO_EXTENSION } from '../../src/schema/constants.js';
import { createRegistry } from '../../src/schema/registry.js';

// Output exposure is now read from the document's `responses` (the swagger
// bridge emits `@ApiResponse` content `$ref`s), keeping it scoped to the
// document rather than walking every controller in the app.

const makeDoc = (override: { paths?: unknown; components?: unknown } = {}): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths: {},
    components: { schemas: {} },
    ...override,
  }) as unknown as OpenAPIObject;

// Marker `type` is a callable (() => Object) — incompatible with the swagger
// `SchemaObject.type: string` typing; build the fixture as `unknown`.
const markerSchema = (dtoId: string): unknown => ({
  type: 'object',
  properties: { [ZOD_NEST_DTO_EXTENSION]: makeZodDtoMarker(dtoId, 'output') },
});

const ref = (name: string): { $ref: string } => ({ $ref: `#/components/schemas/${name}` });

const jsonResponse = (schema: unknown): unknown => ({
  content: { 'application/json': { schema } },
});

describe('collectUsage — output side (document responses)', () => {
  const emptyRegistry = createRegistry();

  it('collects a class-placeholder response ref as its marker dtoId', () => {
    const doc = makeDoc({
      paths: {
        '/users/{id}': {
          get: {
            responses: {
              '200': jsonResponse(ref('UserDto')),
              '404': jsonResponse(ref('ErrorDto')),
            },
          },
        },
      },
      components: { schemas: { UserDto: markerSchema('User'), ErrorDto: markerSchema('Error') } },
    });

    const { outputExposedIds } = collectUsage(doc, emptyRegistry);
    expect([...outputExposedIds].sort()).toEqual(['Error', 'User']);
  });

  it('collects array (items.$ref) and tuple (prefixItems) response shapes', () => {
    const doc = makeDoc({
      paths: {
        '/list': {
          get: { responses: { '200': jsonResponse({ type: 'array', items: ref('UserDto') }) } },
        },
        '/pair': {
          get: {
            responses: {
              '200': jsonResponse({ type: 'array', prefixItems: [ref('UserDto'), ref('TagDto')] }),
            },
          },
        },
      },
      components: {
        schemas: {
          UserDto: markerSchema('User'),
          TagDto: markerSchema('Tag'),
        },
      },
    });

    const { outputExposedIds } = collectUsage(doc, emptyRegistry);
    expect([...outputExposedIds].sort()).toEqual(['Tag', 'User']);
  });

  it('deduplicates a dtoId referenced across multiple responses / operations', () => {
    const doc = makeDoc({
      paths: {
        '/a': { get: { responses: { '200': jsonResponse(ref('UserDto')) } } },
        '/b': {
          get: { responses: { '200': jsonResponse({ type: 'array', items: ref('UserDto') }) } },
        },
      },
      components: { schemas: { UserDto: markerSchema('User') } },
    });

    const { outputExposedIds } = collectUsage(doc, emptyRegistry);
    expect([...outputExposedIds]).toEqual(['User']);
  });

  it('collects a direct dtoId response ref (no marker) when the id is registered', () => {
    // Decorator-emitted / anonymous response refs target the dtoId directly
    // with no class-placeholder hop — matched against the registry's known ids.
    const registry = createRegistry();
    registry.register(z.object({ id: z.string() }), 'DirectId');

    const doc = makeDoc({
      paths: {
        '/x': { get: { responses: { '200': jsonResponse(ref('DirectId')) } } },
      },
    });

    const { outputExposedIds } = collectUsage(doc, registry);
    expect([...outputExposedIds]).toEqual(['DirectId']);
  });

  it('is document-scoped — a registered DTO not referenced by any response is not exposed', () => {
    const registry = createRegistry();
    registry.register(z.object({ id: z.string() }), 'Unreferenced');

    const doc = makeDoc({
      paths: { '/x': { get: { responses: { '200': jsonResponse(ref('UserDto')) } } } },
      components: { schemas: { UserDto: markerSchema('User') } },
    });

    const { outputExposedIds } = collectUsage(doc, registry);
    expect(outputExposedIds.has('Unreferenced')).toBe(false);
    expect([...outputExposedIds]).toEqual(['User']);
  });

  it('walks non-application/json media types (streamed / binary responses)', () => {
    const doc = makeDoc({
      paths: {
        '/stream': {
          get: {
            responses: {
              '200': { content: { 'text/event-stream': { schema: ref('EventDto') } } },
            },
          },
        },
      },
      components: { schemas: { EventDto: markerSchema('Event') } },
    });

    const { outputExposedIds } = collectUsage(doc, emptyRegistry);
    expect([...outputExposedIds]).toEqual(['Event']);
  });

  it('ignores responses without content and non-zod-nest refs', () => {
    const doc = makeDoc({
      paths: {
        '/x': {
          get: {
            responses: {
              '204': { description: 'no content' },
              '200': jsonResponse(ref('ThirdParty')),
            },
          },
        },
      },
      components: { schemas: { ThirdParty: { type: 'object' } } },
    });

    const { outputExposedIds } = collectUsage(doc, emptyRegistry);
    expect(outputExposedIds.size).toBe(0);
  });

  it('ignores malformed paths / operations / responses (defensive)', () => {
    const doc = {
      ...makeDoc(),
      paths: {
        '/null-pathitem': null,
        '/null-op': { get: null },
        '/null-responses': { get: { responses: null } },
        '/null-response': { get: { responses: { '200': null } } },
        '/null-content': { get: { responses: { '200': { content: null } } } },
      },
    } as unknown as OpenAPIObject;

    const { outputExposedIds } = collectUsage(doc, emptyRegistry);
    expect(outputExposedIds.size).toBe(0);
  });
});
