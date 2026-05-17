import type { OpenAPIObject } from '@nestjs/swagger';

import { rewriteRefs } from '../../src/document/rewrite-refs.js';

const docOf = (paths: Record<string, unknown>): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths,
    components: { schemas: {} },
  }) as unknown as OpenAPIObject;

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

describe('rewriteRefs — className → dtoId rename pass', () => {
  it('rewrites every $ref whose target id is in the renames map', () => {
    const doc = docOf({
      '/x': {
        post: {
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/FooDto' } } },
          },
          responses: {
            '200': {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/FooDto' } },
              },
            },
          },
        },
      },
    });

    rewriteRefs({
      doc,
      renames: new Map([['FooDto', 'Bar']]),
      divergentOutputIds: new Set(),
    });

    expect(
      refAt(
        doc.paths,
        '/x',
        'post',
        'requestBody',
        'content',
        'application/json',
        'schema',
        '$ref',
      ),
    ).toBe('#/components/schemas/Bar');
    expect(
      refAt(
        doc.paths,
        '/x',
        'post',
        'responses',
        '200',
        'content',
        'application/json',
        'schema',
        '$ref',
      ),
    ).toBe('#/components/schemas/Bar');
  });

  it('leaves unrelated $refs untouched', () => {
    const doc = docOf({
      '/x': {
        get: { parameters: [{ schema: { $ref: '#/components/schemas/OtherDto' } }] },
      },
    });

    rewriteRefs({
      doc,
      renames: new Map([['FooDto', 'Bar']]),
      divergentOutputIds: new Set(),
    });

    expect(refAt(doc.paths, '/x', 'get', 'parameters', 0, 'schema', '$ref')).toBe(
      '#/components/schemas/OtherDto',
    );
  });

  it('skips $refs outside the #/components/schemas/ namespace', () => {
    const doc = docOf({
      '/x': { get: { parameters: [{ $ref: '#/components/parameters/FooDto' }] } },
    });

    rewriteRefs({
      doc,
      renames: new Map([['FooDto', 'Bar']]),
      divergentOutputIds: new Set(),
    });

    expect(refAt(doc.paths, '/x', 'get', 'parameters', 0, '$ref')).toBe(
      '#/components/parameters/FooDto',
    );
  });

  it('is a no-op when renames map is empty', () => {
    const doc = docOf({
      '/x': {
        get: {
          responses: {
            '200': {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/A' } } },
            },
          },
        },
      },
    });

    rewriteRefs({
      doc,
      renames: new Map(),
      divergentOutputIds: new Set(),
    });

    expect(
      refAt(
        doc.paths,
        '/x',
        'get',
        'responses',
        '200',
        'content',
        'application/json',
        'schema',
        '$ref',
      ),
    ).toBe('#/components/schemas/A');
  });
});

describe('rewriteRefs — output-suffix pass', () => {
  it('appends `Output` to divergent ids referenced from response sub-trees', () => {
    const doc = docOf({
      '/x': {
        get: {
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Person' } } },
          },
          responses: {
            '200': {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Person' } },
              },
            },
          },
        },
      },
    });

    rewriteRefs({
      doc,
      renames: new Map(),
      divergentOutputIds: new Set(['Person']),
    });

    expect(
      refAt(doc.paths, '/x', 'get', 'requestBody', 'content', 'application/json', 'schema', '$ref'),
    ).toBe('#/components/schemas/Person');
    expect(
      refAt(
        doc.paths,
        '/x',
        'get',
        'responses',
        '200',
        'content',
        'application/json',
        'schema',
        '$ref',
      ),
    ).toBe('#/components/schemas/PersonOutput');
  });

  it('does not rewrite response refs whose id is not divergent', () => {
    const doc = docOf({
      '/x': {
        get: {
          responses: {
            '200': {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Plain' } } },
            },
          },
        },
      },
    });

    rewriteRefs({
      doc,
      renames: new Map(),
      divergentOutputIds: new Set(['SomethingElse']),
    });

    expect(
      refAt(
        doc.paths,
        '/x',
        'get',
        'responses',
        '200',
        'content',
        'application/json',
        'schema',
        '$ref',
      ),
    ).toBe('#/components/schemas/Plain');
  });

  it('rename pass runs before output-suffix pass so combined rewrites work', () => {
    const doc = docOf({
      '/x': {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/PersonDto' } },
              },
            },
          },
        },
      },
    });

    rewriteRefs({
      doc,
      renames: new Map([['PersonDto', 'Person']]),
      divergentOutputIds: new Set(['Person']),
    });

    expect(
      refAt(
        doc.paths,
        '/x',
        'get',
        'responses',
        '200',
        'content',
        'application/json',
        'schema',
        '$ref',
      ),
    ).toBe('#/components/schemas/PersonOutput');
  });

  it('walks every HTTP method when scanning for response refs', () => {
    const opWithResponse = {
      responses: {
        '200': {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/X' } } },
        },
      },
    };
    const doc = docOf({
      '/all': {
        get: opWithResponse,
        put: opWithResponse,
        post: opWithResponse,
        delete: opWithResponse,
        options: opWithResponse,
        head: opWithResponse,
        patch: opWithResponse,
        trace: opWithResponse,
      },
    });

    rewriteRefs({
      doc,
      renames: new Map(),
      divergentOutputIds: new Set(['X']),
    });

    const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
    for (const m of methods) {
      expect(
        refAt(
          doc.paths,
          '/all',
          m,
          'responses',
          '200',
          'content',
          'application/json',
          'schema',
          '$ref',
        ),
      ).toBe('#/components/schemas/XOutput');
    }
  });
});

describe('rewriteRefs — defensive guards', () => {
  it('ignores null pathItem entries during the Output-suffix pass', () => {
    const doc = docOf({
      '/null-pathitem': null,
      '/real': {
        get: {
          responses: {
            '200': {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/X' } } },
            },
          },
        },
      },
    } as unknown as Record<string, unknown>);

    expect(() =>
      rewriteRefs({ doc, renames: new Map(), divergentOutputIds: new Set(['X']) }),
    ).not.toThrow();

    expect(
      refAt(
        doc.paths,
        '/real',
        'get',
        'responses',
        '200',
        'content',
        'application/json',
        'schema',
        '$ref',
      ),
    ).toBe('#/components/schemas/XOutput');
  });

  it('ignores null operation entries during the Output-suffix pass', () => {
    const doc = docOf({
      '/x': {
        get: null,
        post: {
          responses: {
            '200': {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/X' } } },
            },
          },
        },
      },
    } as unknown as Record<string, unknown>);

    expect(() =>
      rewriteRefs({ doc, renames: new Map(), divergentOutputIds: new Set(['X']) }),
    ).not.toThrow();

    expect(
      refAt(
        doc.paths,
        '/x',
        'post',
        'responses',
        '200',
        'content',
        'application/json',
        'schema',
        '$ref',
      ),
    ).toBe('#/components/schemas/XOutput');
  });

  it('ignores operations whose responses field is null/non-object', () => {
    const doc = docOf({
      '/x': {
        get: { responses: null },
        post: { responses: 'not-an-object' },
      },
    } as unknown as Record<string, unknown>);

    expect(() =>
      rewriteRefs({ doc, renames: new Map(), divergentOutputIds: new Set(['X']) }),
    ).not.toThrow();
  });

  it('skips non-schemas-prefixed refs during the Output-suffix pass', () => {
    const doc = docOf({
      '/x': {
        get: {
          responses: {
            '200': { $ref: '#/components/responses/SomeShared' },
          },
        },
      },
    });

    rewriteRefs({ doc, renames: new Map(), divergentOutputIds: new Set(['SomeShared']) });

    expect(refAt(doc.paths, '/x', 'get', 'responses', '200', '$ref')).toBe(
      '#/components/responses/SomeShared',
    );
  });

  it('handles a doc with no paths block (no-op)', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      components: { schemas: {} },
    } as unknown as OpenAPIObject;

    expect(() =>
      rewriteRefs({ doc, renames: new Map(), divergentOutputIds: new Set(['X']) }),
    ).not.toThrow();
  });
});
