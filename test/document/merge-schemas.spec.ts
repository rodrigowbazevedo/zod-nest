import type { OpenAPIObject } from '@nestjs/swagger';
import type { CollectedUsage } from '../../src/document/collect-usage.js';

import { ZodNestDocumentError } from '../../src/document/errors.js';
import { mergeSchemas } from '../../src/document/merge-schemas.js';

const emptyDoc = (): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths: {},
    components: { schemas: {} },
  }) as OpenAPIObject;

const usage = (override: Partial<CollectedUsage> = {}): CollectedUsage => ({
  inputExposedIds: new Set(),
  outputExposedIds: new Set(),
  classToDtoId: new Map(),
  ...override,
});

const NO_COLLISIONS = new Map<string, ReadonlySet<unknown>>();

const schemasOf = (doc: OpenAPIObject): Record<string, unknown> =>
  doc.components?.schemas as Record<string, unknown>;

describe('mergeSchemas — suffix truth table', () => {
  it('input-only → writes inputSchemas[id] to components.schemas[id]', () => {
    const doc = emptyDoc();
    const result = mergeSchemas({
      doc,
      inputSchemas: new Map([['User', { type: 'object', properties: { id: { type: 'string' } } }]]),
      outputSchemas: new Map(),
      collected: usage({ inputExposedIds: new Set(['User']) }),
      collisions: NO_COLLISIONS,
    });

    expect(schemasOf(doc).User).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    expect(result.divergentOutputIds.size).toBe(0);
    expect(result.renames.size).toBe(0);
  });

  it('output-only → writes outputSchemas[id] to components.schemas[id]', () => {
    const doc = emptyDoc();
    mergeSchemas({
      doc,
      inputSchemas: new Map(),
      outputSchemas: new Map([
        ['User', { type: 'object', properties: { id: { type: 'string' } } }],
      ]),
      collected: usage({ outputExposedIds: new Set(['User']) }),
      collisions: NO_COLLISIONS,
    });

    expect(schemasOf(doc).User).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
  });

  it('both & byte-equal → writes one entry as components.schemas[id]', () => {
    const doc = emptyDoc();
    const body = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } };
    const result = mergeSchemas({
      doc,
      inputSchemas: new Map([['Foo', body]]),
      outputSchemas: new Map([['Foo', { ...body }]]), // different reference, same content
      collected: usage({
        inputExposedIds: new Set(['Foo']),
        outputExposedIds: new Set(['Foo']),
      }),
      collisions: NO_COLLISIONS,
    });

    expect(schemasOf(doc).Foo).toEqual(body);
    expect(schemasOf(doc).FooOutput).toBeUndefined();
    expect(result.divergentOutputIds.size).toBe(0);
  });

  it('both & differ → input as id, output as <id>Output; divergentOutputIds tracks the id', () => {
    const doc = emptyDoc();
    const result = mergeSchemas({
      doc,
      inputSchemas: new Map([['Person', { type: 'object', required: [] }]]),
      outputSchemas: new Map([['Person', { type: 'object', required: ['name'] }]]),
      collected: usage({
        inputExposedIds: new Set(['Person']),
        outputExposedIds: new Set(['Person']),
      }),
      collisions: NO_COLLISIONS,
    });

    expect(schemasOf(doc).Person).toEqual({ type: 'object', required: [] });
    expect(schemasOf(doc).PersonOutput).toEqual({ type: 'object', required: ['name'] });
    expect([...result.divergentOutputIds]).toEqual(['Person']);
  });

  it('canonical equality treats key-reordered objects as equal', () => {
    const doc = emptyDoc();
    mergeSchemas({
      doc,
      inputSchemas: new Map([['Sorted', { a: 1, b: 2 }]]),
      outputSchemas: new Map([['Sorted', { b: 2, a: 1 }]]),
      collected: usage({
        inputExposedIds: new Set(['Sorted']),
        outputExposedIds: new Set(['Sorted']),
      }),
      collisions: NO_COLLISIONS,
    });

    expect(schemasOf(doc).Sorted).toEqual({ a: 1, b: 2 });
    expect(schemasOf(doc).SortedOutput).toBeUndefined();
  });
});

describe('mergeSchemas — className → dtoId rename', () => {
  it('drops the className entry when dtoId differs and reports the rename', () => {
    const doc = emptyDoc();
    doc.components = {
      schemas: {
        FooDto: {
          type: 'object',
          properties: { 'x-zod-nest-dto': { __zodNestDto: true, dtoId: 'Bar', io: 'input' } },
        } as never,
      },
    };

    const result = mergeSchemas({
      doc,
      inputSchemas: new Map([['Bar', { type: 'object', properties: { id: { type: 'string' } } }]]),
      outputSchemas: new Map(),
      collected: usage({
        inputExposedIds: new Set(['Bar']),
        classToDtoId: new Map([['FooDto', 'Bar']]),
      }),
      collisions: NO_COLLISIONS,
    });

    expect(schemasOf(doc).Bar).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    expect(schemasOf(doc).FooDto).toBeUndefined();
    expect([...result.renames]).toEqual([['FooDto', 'Bar']]);
  });

  it('keeps the marker entry untouched when dtoId matches className (in-place replace)', () => {
    const doc = emptyDoc();
    doc.components = {
      schemas: {
        User: {
          type: 'object',
          properties: { 'x-zod-nest-dto': { __zodNestDto: true, dtoId: 'User', io: 'input' } },
        } as never,
      },
    };

    const result = mergeSchemas({
      doc,
      inputSchemas: new Map([['User', { type: 'object', properties: { id: { type: 'string' } } }]]),
      outputSchemas: new Map(),
      collected: usage({
        inputExposedIds: new Set(['User']),
        classToDtoId: new Map([['User', 'User']]),
      }),
      collisions: NO_COLLISIONS,
    });

    expect(schemasOf(doc).User).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    expect(result.renames.size).toBe(0);
  });

  it('throws AMBIGUOUS_RENAME when two distinct bodies target the same dtoId', () => {
    const doc = emptyDoc();
    doc.components = {
      schemas: {
        // Existing key (non-marker, non-equal body) at the rename target
        Bar: { type: 'object', properties: { existing: { type: 'string' } } } as never,
      },
    };

    expect(() =>
      mergeSchemas({
        doc,
        inputSchemas: new Map([
          ['Bar', { type: 'object', properties: { fresh: { type: 'number' } } }],
        ]),
        outputSchemas: new Map(),
        collected: usage({
          inputExposedIds: new Set(['Bar']),
          classToDtoId: new Map([['FooDto', 'Bar']]),
        }),
        collisions: NO_COLLISIONS,
      }),
    ).toThrow(ZodNestDocumentError);
  });

  it('AMBIGUOUS_RENAME error carries the conflicting key in details', () => {
    const doc = emptyDoc();
    doc.components = {
      schemas: { Bar: { type: 'string' } as never },
    };

    let caught: unknown;
    try {
      mergeSchemas({
        doc,
        inputSchemas: new Map([['Bar', { type: 'number' }]]),
        outputSchemas: new Map(),
        collected: usage({ inputExposedIds: new Set(['Bar']) }),
        collisions: NO_COLLISIONS,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ZodNestDocumentError);
    expect((caught as ZodNestDocumentError).code).toBe('AMBIGUOUS_RENAME');
    expect((caught as ZodNestDocumentError).details.key).toBe('Bar');
  });
});

describe('mergeSchemas — collision decoration', () => {
  it('replaces the body with the duplicate-id error marker', () => {
    const doc = emptyDoc();
    mergeSchemas({
      doc,
      inputSchemas: new Map([['Dup', { type: 'object' }]]),
      outputSchemas: new Map(),
      collected: usage({ inputExposedIds: new Set(['Dup']) }),
      collisions: new Map([['Dup', new Set([{}, {}])]]),
    });

    expect(schemasOf(doc).Dup).toEqual({
      description: 'ERROR: duplicate zod-nest id <Dup>',
      'x-zod-nest-error': 'duplicate-id',
    });
  });

  it('decorates both id and idOutput when the divergent output exists', () => {
    const doc = emptyDoc();
    mergeSchemas({
      doc,
      inputSchemas: new Map([['Dup', { type: 'object', required: [] }]]),
      outputSchemas: new Map([['Dup', { type: 'object', required: ['x'] }]]),
      collected: usage({
        inputExposedIds: new Set(['Dup']),
        outputExposedIds: new Set(['Dup']),
      }),
      collisions: new Map([['Dup', new Set([{}, {}])]]),
    });

    expect(schemasOf(doc).Dup).toMatchObject({ 'x-zod-nest-error': 'duplicate-id' });
    expect(schemasOf(doc).DupOutput).toMatchObject({ 'x-zod-nest-error': 'duplicate-id' });
  });

  it('skips collisions for ids not present in components.schemas', () => {
    const doc = emptyDoc();
    expect(() =>
      mergeSchemas({
        doc,
        inputSchemas: new Map(),
        outputSchemas: new Map(),
        collected: usage(),
        collisions: new Map([['Ghost', new Set([{}, {}])]]),
      }),
    ).not.toThrow();
    expect(schemasOf(doc).Ghost).toBeUndefined();
  });
});

describe('mergeSchemas — edge cases', () => {
  it('skips ids whose emitted body is undefined (registry/exposed-id mismatch)', () => {
    const doc = emptyDoc();
    mergeSchemas({
      doc,
      inputSchemas: new Map(), // No emission for 'Phantom'
      outputSchemas: new Map(),
      collected: usage({ inputExposedIds: new Set(['Phantom']) }),
      collisions: NO_COLLISIONS,
    });

    expect(schemasOf(doc).Phantom).toBeUndefined();
  });

  it('initializes components.schemas if the doc has no components block', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      paths: {},
    } as OpenAPIObject;
    mergeSchemas({
      doc,
      inputSchemas: new Map([['Foo', { type: 'object' }]]),
      outputSchemas: new Map(),
      collected: usage({ inputExposedIds: new Set(['Foo']) }),
      collisions: NO_COLLISIONS,
    });

    expect(doc.components?.schemas).toBeDefined();
    expect((doc.components?.schemas as Record<string, unknown>).Foo).toEqual({ type: 'object' });
  });

  it('AMBIGUOUS_RENAME fires even when the existing body is a non-object (string)', () => {
    // Covers the `isMarkerPlaceholder(value) → value === null || typeof !== 'object'`
    // branch — existing schema is a string, fails the placeholder check, and
    // also differs canonically from the incoming body.
    const doc = emptyDoc();
    doc.components = {
      schemas: { Foo: 'pre-existing-string' as unknown as Record<string, unknown> },
    };

    expect(() =>
      mergeSchemas({
        doc,
        inputSchemas: new Map([['Foo', { type: 'object' }]]),
        outputSchemas: new Map(),
        collected: usage({ inputExposedIds: new Set(['Foo']) }),
        collisions: NO_COLLISIONS,
      }),
    ).toThrow(ZodNestDocumentError);
  });

  it('canonicalEqual hits the reference-equality fast path when input ref === output ref', () => {
    // Pass the SAME body reference for both input and output to hit `a === b`
    // → no Output suffix, no extra entry.
    const doc = emptyDoc();
    const sharedBody = { type: 'object', properties: { x: { type: 'string' } } };

    const result = mergeSchemas({
      doc,
      inputSchemas: new Map([['Refeq', sharedBody]]),
      outputSchemas: new Map([['Refeq', sharedBody]]),
      collected: usage({
        inputExposedIds: new Set(['Refeq']),
        outputExposedIds: new Set(['Refeq']),
      }),
      collisions: NO_COLLISIONS,
    });

    expect(schemasOf(doc).Refeq).toBe(sharedBody);
    expect(schemasOf(doc).RefeqOutput).toBeUndefined();
    expect(result.divergentOutputIds.size).toBe(0);
  });
});
