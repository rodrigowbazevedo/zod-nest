import {
  buildQuerystringParam,
  conflictingQueryNames,
  hasQueryConflict,
  QUERYSTRING_MEDIA_TYPE,
} from '../../src/document/querystring-param.js';

const queryParam = (name: string): Record<string, unknown> => ({
  name,
  in: 'query',
  required: false,
  schema: { type: 'string' },
});

const markerParam = (dtoId: string): Record<string, unknown> => ({
  name: 'x-zod-nest-dto',
  in: 'query',
  __zodNestDto: true,
  dtoId,
  io: 'input',
});

describe('buildQuerystringParam', () => {
  it('carries the schema under content, never as `schema` or with a `style`', () => {
    const param = buildQuerystringParam({
      dtoId: 'ListUsersQuery',
      body: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] },
    });

    expect(param).toEqual({
      name: 'ListUsersQuery',
      in: 'querystring',
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          schema: { $ref: '#/components/schemas/ListUsersQuery' },
        },
      },
    });
    // 3.2 forbids both on `in: querystring`.
    expect(param).not.toHaveProperty('schema');
    expect(param).not.toHaveProperty('style');
    expect(param).not.toHaveProperty('explode');
  });

  it('uses the form-urlencoded media type', () => {
    expect(QUERYSTRING_MEDIA_TYPE).toBe('application/x-www-form-urlencoded');
  });

  it('is required when the Zod schema requires at least one field', () => {
    const param = buildQuerystringParam({
      dtoId: 'Q',
      body: { type: 'object', properties: { a: {}, b: {} }, required: ['b'] },
    });

    expect(param.required).toBe(true);
  });

  it('is optional when every field is optional', () => {
    const param = buildQuerystringParam({
      dtoId: 'Q',
      body: { type: 'object', properties: { a: {}, b: {} }, required: [] },
    });

    expect(param.required).toBe(false);
  });

  it('is optional when the body has no `required` array at all', () => {
    const param = buildQuerystringParam({ dtoId: 'Q', body: { type: 'object' } });

    expect(param.required).toBe(false);
  });

  it('tolerates a non-record body', () => {
    expect(buildQuerystringParam({ dtoId: 'Q', body: undefined }).required).toBe(false);
    expect(buildQuerystringParam({ dtoId: 'Q', body: 'nope' }).required).toBe(false);
  });
});

describe('hasQueryConflict', () => {
  it('is false for a lone candidate with no sibling query parameters', () => {
    expect(
      hasQueryConflict({
        parameters: [markerParam('Q')],
        pathItemParameters: undefined,
        candidateCount: 1,
      }),
    ).toBe(false);
  });

  it('is true when a sibling `in: query` parameter shares the operation', () => {
    expect(
      hasQueryConflict({
        parameters: [markerParam('Q'), queryParam('page')],
        pathItemParameters: undefined,
        candidateCount: 1,
      }),
    ).toBe(true);
  });

  it('is true when the enclosing path item carries an `in: query` parameter', () => {
    expect(
      hasQueryConflict({
        parameters: [markerParam('Q')],
        pathItemParameters: [queryParam('tenant')],
        candidateCount: 1,
      }),
    ).toBe(true);
  });

  it('is true for more than one candidate — 3.2 allows only one querystring', () => {
    expect(
      hasQueryConflict({
        parameters: [markerParam('A'), markerParam('B')],
        pathItemParameters: undefined,
        candidateCount: 2,
      }),
    ).toBe(true);
  });

  it('ignores unresolved markers when scanning for `in: query` siblings', () => {
    // The marker is `in: 'query'` but is not yet a query parameter; the
    // candidate count already accounts for it.
    expect(
      hasQueryConflict({
        parameters: [markerParam('Q')],
        pathItemParameters: undefined,
        candidateCount: 1,
      }),
    ).toBe(false);
  });

  it('ignores non-query parameters', () => {
    expect(
      hasQueryConflict({
        parameters: [
          markerParam('Q'),
          { name: 'id', in: 'path', required: true },
          { name: 'x-key', in: 'header', required: false },
        ],
        pathItemParameters: [{ name: 'id', in: 'path', required: true }],
        candidateCount: 1,
      }),
    ).toBe(false);
  });

  it('tolerates a non-array path-item parameters value', () => {
    expect(
      hasQueryConflict({
        parameters: [markerParam('Q')],
        pathItemParameters: { nope: true },
        candidateCount: 1,
      }),
    ).toBe(false);
  });
});

describe('conflictingQueryNames', () => {
  it('collects names from the operation and its path item, in that order', () => {
    expect(
      conflictingQueryNames([markerParam('Q'), queryParam('page')], [queryParam('tenant')]),
    ).toEqual(['page', 'tenant']);
  });

  it('labels an unnamed query parameter rather than dropping it', () => {
    expect(conflictingQueryNames([{ in: 'query' }], undefined)).toEqual(['<unnamed>']);
  });

  it('is empty when nothing conflicts', () => {
    expect(conflictingQueryNames([markerParam('Q')], undefined)).toEqual([]);
  });
});
