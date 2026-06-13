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

  it('leaves Zod `.describe()` text on the parameter schema, not on the parameter object', () => {
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
        schema: { type: 'number', description: 'The number of items to return' },
      },
    ]);
    // No top-level `description` key — Swagger UI renders the schema-level
    // description; lifting it to the parameter just added noise.
    expect(params[0]).not.toHaveProperty('description');
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

  // ─── ref mode (queryParamStyle: 'ref' + per-marker override) ─────────────

  const refDoc = (paramIn: string, dtoId: string): OpenAPIObject =>
    docOf({
      paths: { '/x': { get: { parameters: [markerParam(paramIn, dtoId)] } } },
      components: {
        schemas: { Object: objectMarkerSchema(), [dtoId]: { type: 'object', properties: {} } },
      },
    });

  const querySchema = (required: string[]): ReadonlyMap<string, unknown> =>
    new Map<string, unknown>([
      [
        'Q',
        {
          type: 'object',
          properties: { timeFrom: { type: 'string' }, search: { type: 'string' } },
          required,
        },
      ],
    ]);

  it('collapses a query marker to a single $ref param under queryParamStyle: "ref"', () => {
    const doc = refDoc('query', 'Q');

    expandParamMarkers({
      doc,
      inputSchemas: querySchema(['timeFrom']),
      outputSchemas: new Map(),
      queryParamStyle: 'ref',
    });

    const params = paramsOf(doc, '/x', 'get');
    expect(params).toEqual([
      {
        name: 'Q',
        in: 'query',
        required: true,
        style: 'form',
        explode: true,
        schema: { $ref: '#/components/schemas/Q' },
      },
    ]);
  });

  it('marks the ref param `required: false` when the schema has no required fields', () => {
    const doc = refDoc('query', 'Q');

    expandParamMarkers({
      doc,
      inputSchemas: querySchema([]),
      outputSchemas: new Map(),
      queryParamStyle: 'ref',
    });

    const params = paramsOf(doc, '/x', 'get');
    expect(params[0]?.required).toBe(false);
  });

  it('still expands per-property under the default queryParamStyle ("expand")', () => {
    const doc = refDoc('query', 'Q');

    expandParamMarkers({ doc, inputSchemas: querySchema(['timeFrom']), outputSchemas: new Map() });

    const params = paramsOf(doc, '/x', 'get');
    expect(params.map((p) => p.name)).toEqual(['timeFrom', 'search']);
  });

  it('honors a per-marker `ref: true` override even when the global style is "expand"', () => {
    const doc = docOf({
      paths: { '/x': { get: { parameters: [{ ...markerParam('query', 'Q'), ref: true }] } } },
      components: {
        schemas: { Object: objectMarkerSchema(), Q: { type: 'object', properties: {} } },
      },
    });

    expandParamMarkers({ doc, inputSchemas: querySchema(['timeFrom']), outputSchemas: new Map() });

    const params = paramsOf(doc, '/x', 'get');
    expect(params[0]?.schema).toEqual({ $ref: '#/components/schemas/Q' });
    expect(params[0]?.style).toBe('form');
  });

  it('honors a per-marker `ref: false` override even when the global style is "ref"', () => {
    const doc = docOf({
      paths: { '/x': { get: { parameters: [{ ...markerParam('query', 'Q'), ref: false }] } } },
      components: {
        schemas: { Object: objectMarkerSchema(), Q: { type: 'object', properties: {} } },
      },
    });

    expandParamMarkers({
      doc,
      inputSchemas: querySchema(['timeFrom']),
      outputSchemas: new Map(),
      queryParamStyle: 'ref',
    });

    const params = paramsOf(doc, '/x', 'get');
    expect(params.map((p) => p.name)).toEqual(['timeFrom', 'search']);
  });

  it('never collapses non-query markers — path stays expanded under "ref"', () => {
    const doc = docOf({
      paths: { '/x/{id}': { get: { parameters: [markerParam('path', 'P')] } } },
      components: {
        schemas: { Object: objectMarkerSchema(), P: { type: 'object', properties: {} } },
      },
    });
    const inputSchemas = new Map<string, unknown>([
      ['P', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map(), queryParamStyle: 'ref' });

    const params = paramsOf(doc, '/x/{id}', 'get');
    expect(params).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  it('falls back to expansion under "ref" when the doc has no components.schemas', () => {
    const doc = docOf({
      paths: { '/x': { get: { parameters: [markerParam('query', 'Q')] } } },
      components: {}, // no `schemas` key at all
    });

    expandParamMarkers({
      doc,
      inputSchemas: querySchema([]),
      outputSchemas: new Map(),
      queryParamStyle: 'ref',
    });

    // No component catalog → nothing to `$ref` → expands per property.
    const params = paramsOf(doc, '/x', 'get');
    expect(params.map((p) => p.name)).toEqual(['timeFrom', 'search']);
  });

  it('falls back to expansion under "ref" when the DTO component is absent', () => {
    // Defensive: `withRegistryExposure` should always emit the component, but
    // if it is somehow missing the contract still ships (expanded) rather than
    // dangling on a `$ref` to a non-existent schema.
    const doc = docOf({
      paths: { '/x': { get: { parameters: [markerParam('query', 'Missing')] } } },
      components: { schemas: { Object: objectMarkerSchema() } },
    });
    const inputSchemas = new Map<string, unknown>([
      ['Missing', { type: 'object', properties: { q: { type: 'string' } }, required: [] }],
    ]);

    expandParamMarkers({ doc, inputSchemas, outputSchemas: new Map(), queryParamStyle: 'ref' });

    const params = paramsOf(doc, '/x', 'get');
    expect(params).toEqual([
      { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
    ]);
  });

  it('skips a marker whose `ref` is not a boolean (defensive)', () => {
    const doc = docOf({
      paths: {
        '/x': { get: { parameters: [{ ...markerParam('query', 'Q'), ref: 'nope' }] } },
      },
      components: {
        schemas: { Object: objectMarkerSchema(), Q: { type: 'object', properties: {} } },
      },
    });

    expandParamMarkers({
      doc,
      inputSchemas: querySchema(['timeFrom']),
      outputSchemas: new Map(),
      queryParamStyle: 'ref',
    });

    // The malformed `ref` makes `readMarker` reject it, so the param is kept
    // verbatim rather than expanded or collapsed.
    const params = paramsOf(doc, '/x', 'get');
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({ __zodNestDto: true, ref: 'nope' });
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
