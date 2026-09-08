import type { OpenAPIObject } from '@nestjs/swagger';

import { forEachOperation, HTTP_METHODS } from '../../src/document/http-methods.js';

const docOf = (pathItem: Record<string, unknown>): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths: { '/things': pathItem },
  }) as unknown as OpenAPIObject;

const visitedOperationIds = (pathItem: Record<string, unknown>): string[] => {
  const seen: string[] = [];
  forEachOperation(docOf(pathItem), (op) => {
    seen.push(op.operationId as string);
  });
  return seen;
};

describe('HTTP_METHODS', () => {
  it('covers the OpenAPI 3.1 fixed operation set', () => {
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      expect(HTTP_METHODS).toContain(method);
    }
  });

  it('covers the extension methods NestJS can route', () => {
    for (const method of [
      'query',
      'search',
      'propfind',
      'proppatch',
      'mkcol',
      'copy',
      'move',
      'lock',
      'unlock',
    ]) {
      expect(HTTP_METHODS).toContain(method);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(HTTP_METHODS).size).toBe(HTTP_METHODS.length);
  });
});

describe('forEachOperation', () => {
  it('visits a `query` operation (RFC 10008)', () => {
    expect(visitedOperationIds({ query: { operationId: 'find' } })).toEqual(['find']);
  });

  it('visits extension-method operations alongside 3.1 ones', () => {
    const seen = visitedOperationIds({
      get: { operationId: 'list' },
      query: { operationId: 'find' },
      search: { operationId: 'legacyFind' },
    });
    expect([...seen].sort()).toEqual(['find', 'legacyFind', 'list']);
  });

  it('ignores non-operation path-item keys', () => {
    const seen = visitedOperationIds({
      summary: 'a summary',
      description: 'a description',
      parameters: [{ name: 'id', in: 'path' }],
      servers: [{ url: 'https://example.test' }],
      query: { operationId: 'find' },
    });
    expect(seen).toEqual(['find']);
  });
});
