import type { OpenAPIObject } from '@nestjs/swagger';

import { assertNoDanglingRefs } from '../../src/document/dangling-refs.js';
import { ZodNestDocumentError } from '../../src/document/errors.js';

const docOf = (
  paths: Record<string, unknown>,
  schemas: Record<string, unknown> = {},
): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths,
    components: { schemas },
  }) as unknown as OpenAPIObject;

describe('assertNoDanglingRefs', () => {
  it('passes when every #/components/schemas/<id> target exists', () => {
    const doc = docOf(
      {
        '/x': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Foo' } } },
            },
          },
        },
      },
      { Foo: { type: 'object' } },
    );

    expect(() => assertNoDanglingRefs(doc)).not.toThrow();
  });

  it('throws ZodNestDocumentError(DANGLING_REF) when a ref target is missing', () => {
    const doc = docOf(
      {
        '/x': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Ghost' } } },
            },
          },
        },
      },
      { Other: { type: 'object' } },
    );

    let caught: unknown;
    try {
      assertNoDanglingRefs(doc);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ZodNestDocumentError);
    expect((caught as ZodNestDocumentError).code).toBe('DANGLING_REF');
    expect((caught as ZodNestDocumentError).details.dangling).toEqual([
      '#/components/schemas/Ghost',
    ]);
  });

  it('collects every dangling ref into a single error', () => {
    const doc = docOf(
      {
        '/a': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MissA' } } },
              },
            },
          },
        },
        '/b': {
          get: {
            responses: {
              '500': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MissB' } } },
              },
            },
          },
        },
      },
      { Present: { type: 'object' } },
    );

    let caught: unknown;
    try {
      assertNoDanglingRefs(doc);
    } catch (e) {
      caught = e;
    }

    const dangling = (caught as ZodNestDocumentError).details.dangling as string[];
    expect(dangling).toContain('#/components/schemas/MissA');
    expect(dangling).toContain('#/components/schemas/MissB');
    expect(dangling.length).toBe(2);
  });

  it('ignores refs into other component namespaces', () => {
    const doc = docOf(
      {
        '/x': {
          get: {
            parameters: [{ $ref: '#/components/parameters/PageQuery' }],
            responses: {
              '404': { $ref: '#/components/responses/NotFound' },
            },
          },
        },
      },
      {},
    );

    expect(() => assertNoDanglingRefs(doc)).not.toThrow();
  });

  it('passes on a doc with no components block', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: 'v' },
      paths: {},
    } as OpenAPIObject;

    expect(() => assertNoDanglingRefs(doc)).not.toThrow();
  });
});
