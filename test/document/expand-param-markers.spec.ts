import type { OpenAPIObject } from '@nestjs/swagger';

import { ZodNestDocumentError } from '../../src/document/errors.js';
import { expandParamMarkers } from '../../src/document/expand-param-markers.js';

interface Param extends Record<string, unknown> {
  name: string;
  in: string;
  required: boolean;
  schema: Record<string, unknown>;
}

const docOf = (override: { paths?: unknown; components?: unknown }): OpenAPIObject =>
  ({
    openapi: '3.0.0',
    info: { title: 't', version: 'v' },
    paths: override.paths ?? {},
    components: override.components ?? { schemas: {} },
  }) as unknown as OpenAPIObject;

const paramsOf = (doc: OpenAPIObject, path: string, method: string): Param[] => {
  const paths = doc.paths as unknown as Record<string, Record<string, unknown>> | undefined;
  const op = paths?.[path]?.[method] as Record<string, unknown> | undefined;
  return (op?.parameters ?? []) as Param[];
};

const markerParam = (
  paramIn: string,
  dtoId: string,
  io: 'input' | 'output' = 'input',
): Record<string, unknown> => ({
  name: 'x-zod-nest-dto',
  required: false,
  in: paramIn,
  __zodNestDto: true,
  dtoId,
  io,
  schema: { $ref: '#/components/schemas/Object' },
});

const objectMarkerSchema = (): Record<string, unknown> => ({
  type: 'object',
  properties: { 'x-zod-nest-dto': { type: 'object' } },
});

describe('expandParamMarkers', () => {
  it('expands a query-param marker into one parameter per top-level property', () => {
    const doc = docOf({
      paths: {
        '/templates': {
          get: { parameters: [markerParam('query', 'TemplatesQuery')] },
        },
      },
      components: { schemas: { Object: objectMarkerSchema() } },
    });
    const inputSchemas = new Map<string, unknown>([
      [
        'TemplatesQuery',
        {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            cursor: { type: 'string' },
            search: { type: 'string' },
          },
          required: ['limit'],
        },
      ],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map() });

    const params = paramsOf(doc, '/templates', 'get');
    expect(params).toEqual([
      { name: 'limit', in: 'query', required: true, schema: { type: 'number' } },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'search', in: 'query', required: false, schema: { type: 'string' } },
    ]);
    // Orphan `Object` schema was pruned — nothing else references it now.
    expect((doc.components?.schemas as Record<string, unknown>).Object).toBeUndefined();
  });

  it('keeps non-marker parameters in place and preserves their order', () => {
    const doc = docOf({
      paths: {
        '/templates/{id}': {
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
              markerParam('query', 'TemplateQuery'),
            ],
          },
        },
      },
    });
    const inputSchemas = new Map<string, unknown>([
      ['TemplateQuery', { type: 'object', properties: { with: { type: 'string' } }, required: [] }],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map() });

    const params = paramsOf(doc, '/templates/{id}', 'get');
    expect(params).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
      { name: 'with', in: 'query', required: false, schema: { type: 'string' } },
    ]);
  });

  it('forces `required: true` on optional path params and emits a warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = docOf({
      paths: { '/x/{id}': { get: { parameters: [markerParam('path', 'PathDto')] } } },
    });
    const inputSchemas = new Map<string, unknown>([
      ['PathDto', { type: 'object', properties: { id: { type: 'number' } }, required: [] }],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map() });

    const params = paramsOf(doc, '/x/{id}', 'get');
    expect(params).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    const [firstCall] = warn.mock.calls;
    expect(firstCall?.[0]).toContain('Path parameter `id` on DTO `PathDto`');
    warn.mockRestore();
  });

  it('expands header DTOs with `in: "header"`', () => {
    const doc = docOf({
      paths: { '/x': { get: { parameters: [markerParam('header', 'HeaderDto')] } } },
    });
    const inputSchemas = new Map<string, unknown>([
      [
        'HeaderDto',
        {
          type: 'object',
          properties: { 'x-trace-id': { type: 'string' } },
          required: ['x-trace-id'],
        },
      ],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map() });

    const params = paramsOf(doc, '/x', 'get');
    expect(params).toEqual([
      { name: 'x-trace-id', in: 'header', required: true, schema: { type: 'string' } },
    ]);
  });

  it('expands cookie DTOs with `in: "cookie"` (parity with query/header/path)', () => {
    const doc = docOf({
      paths: { '/x': { get: { parameters: [markerParam('cookie', 'CookieDto')] } } },
    });
    const inputSchemas = new Map<string, unknown>([
      [
        'CookieDto',
        { type: 'object', properties: { session: { type: 'string' } }, required: ['session'] },
      ],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map() });

    const params = paramsOf(doc, '/x', 'get');
    expect(params).toEqual([
      { name: 'session', in: 'cookie', required: true, schema: { type: 'string' } },
    ]);
  });

  it('preserves `$ref` property schemas verbatim for later `rewriteRefs`', () => {
    const doc = docOf({
      paths: { '/x': { get: { parameters: [markerParam('query', 'QueryDto')] } } },
    });
    const inputSchemas = new Map<string, unknown>([
      [
        'QueryDto',
        {
          type: 'object',
          properties: { sort: { $ref: '#/components/schemas/SortDirection' } },
          required: ['sort'],
        },
      ],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map() });

    const params = paramsOf(doc, '/x', 'get');
    expect(params).toEqual([
      {
        name: 'sort',
        in: 'query',
        required: true,
        schema: { $ref: '#/components/schemas/SortDirection' },
      },
    ]);
  });

  it('duplicates Zod `.describe()` text onto both the parameter and its schema', () => {
    const doc = docOf({
      paths: { '/x': { get: { parameters: [markerParam('query', 'QueryDto')] } } },
    });
    const inputSchemas = new Map<string, unknown>([
      [
        'QueryDto',
        {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'The number of items to return' },
          },
          required: [],
        },
      ],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map() });

    const params = paramsOf(doc, '/x', 'get');
    expect(params).toEqual([
      {
        name: 'limit',
        in: 'query',
        required: false,
        description: 'The number of items to return',
        schema: { type: 'number', description: 'The number of items to return' },
      },
    ]);
  });

  it('throws UNEXPANDABLE_PARAM_DTO when the DTO body is not an object schema', () => {
    const doc = docOf({
      paths: { '/x': { get: { parameters: [markerParam('query', 'ListDto')] } } },
    });
    const inputSchemas = new Map<string, unknown>([
      ['ListDto', { type: 'array', items: { type: 'string' } }],
    ]);

    let thrown: unknown;
    try {
      expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map() });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ZodNestDocumentError);
    expect((thrown as ZodNestDocumentError).code).toBe('UNEXPANDABLE_PARAM_DTO');
    expect((thrown as ZodNestDocumentError).details).toEqual({
      dtoId: 'ListDto',
      in: 'query',
      io: 'input',
    });
  });

  it('reads `io: "output"` markers from `outputSchemas` rather than `inputSchemas`', () => {
    const doc = docOf({
      paths: { '/x': { get: { parameters: [markerParam('query', 'EchoDto', 'output')] } } },
    });
    const inputSchemas = new Map<string, unknown>([
      ['EchoDto', { type: 'object', properties: { x: { type: 'string' } }, required: [] }],
    ]);
    const outputSchemas = new Map<string, unknown>([
      ['EchoDto', { type: 'object', properties: { y: { type: 'number' } }, required: [] }],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas });

    const params = paramsOf(doc, '/x', 'get');
    expect(params).toEqual([
      { name: 'y', in: 'query', required: false, schema: { type: 'number' } },
    ]);
  });

  it('keeps `components.schemas.Object` when at least one ref still points at it', () => {
    const doc = docOf({
      paths: {
        '/x': { get: { parameters: [markerParam('query', 'QueryDto')] } },
        '/keeps-object-alive': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Object' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Object: objectMarkerSchema(),
        },
      },
    });
    const inputSchemas = new Map<string, unknown>([
      ['QueryDto', { type: 'object', properties: { q: { type: 'string' } }, required: [] }],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map() });

    expect((doc.components?.schemas as Record<string, unknown>).Object).toBeDefined();
  });

  it('is a no-op when there are no marker parameters', () => {
    const original = {
      '/static': {
        get: {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'number' } }],
        },
      },
    };
    const doc = docOf({ paths: original });

    expandParamMarkers({ doc, inputSchemas: new Map(), outputSchemas: new Map() });

    expect(doc.paths).toEqual(original);
  });

  it('ignores malformed paths / operations / parameters defensively', () => {
    const doc = docOf({
      paths: {
        '/null-pathitem': null,
        '/null-op': { post: null },
        '/non-array-params': { get: { parameters: 'not-an-array' } },
        '/null-param': { get: { parameters: [null, { in: 'query', schema: {} }] } },
      },
    });

    expect(() =>
      expandParamMarkers({ doc, inputSchemas: new Map(), outputSchemas: new Map() }),
    ).not.toThrow();
  });

  it('is a no-op when `doc.paths` is missing entirely', () => {
    const docWithoutPaths = {
      openapi: '3.0.0',
      info: { title: 't', version: 'v' },
      components: { schemas: {} },
    } as unknown as OpenAPIObject;

    expect(() =>
      expandParamMarkers({
        doc: docWithoutPaths,
        inputSchemas: new Map(),
        outputSchemas: new Map(),
      }),
    ).not.toThrow();
  });

  it('skips properties whose schema is not a plain record (defensive)', () => {
    const doc = docOf({
      paths: { '/x': { get: { parameters: [markerParam('query', 'WeirdDto')] } } },
    });
    const inputSchemas = new Map<string, unknown>([
      [
        'WeirdDto',
        {
          type: 'object',
          properties: {
            ok: { type: 'string' },
            broken: null,
            arrayProp: [],
            stringProp: 'not-a-schema',
          },
          required: [],
        },
      ],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map() });

    // Only `ok` survives; the malformed property values are silently dropped
    // so the doc-build doesn't crash on weird Zod / override output.
    const params = paramsOf(doc, '/x', 'get');
    expect(params).toEqual([
      { name: 'ok', in: 'query', required: false, schema: { type: 'string' } },
    ]);
  });

  it('skips marker params that are missing required fields (defensive)', () => {
    const docMissing = docOf({
      paths: {
        '/x': {
          get: {
            parameters: [
              { __zodNestDto: true, io: 'input', in: 'query' /* dtoId missing */ },
              { __zodNestDto: true, dtoId: 'NoIo', in: 'query' /* io missing */ },
              { __zodNestDto: true, dtoId: 'NoIn', io: 'input' /* in missing */ },
            ],
          },
        },
      },
    });

    expandParamMarkers({ doc: docMissing, inputSchemas: new Map(), outputSchemas: new Map() });

    // Malformed markers are kept verbatim — the defensive strip in `stripMarkers`
    // (which runs later in the pipeline) is responsible for removing leftovers.
    const params = paramsOf(docMissing, '/x', 'get');
    expect(params).toHaveLength(3);
  });
});
