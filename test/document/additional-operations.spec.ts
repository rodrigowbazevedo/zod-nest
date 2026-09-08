import type { OpenAPIObject } from '@nestjs/swagger';

import { relocateExtensionOperations } from '../../src/document/additional-operations.js';
import { EXTENSION_OPERATION_KEYS } from '../../src/document/http-methods.js';
import { validateOpenApi } from './openapi-validator.js';

const docOf = (pathItem: Record<string, unknown>): OpenAPIObject =>
  ({
    openapi: '3.2.0',
    info: { title: 't', version: 'v' },
    paths: { '/things': pathItem },
  }) as unknown as OpenAPIObject;

const pathItemOf = (doc: OpenAPIObject): Record<string, unknown> => {
  const paths: Record<string, unknown> = doc.paths;
  const pathItem = paths['/things'];
  if (pathItem === null || typeof pathItem !== 'object') {
    throw new Error('fixture has no /things path item');
  }
  return pathItem as Record<string, unknown>;
};

const operation = (operationId: string): Record<string, unknown> => ({
  operationId,
  responses: { 200: { description: 'ok' } },
});

describe('relocateExtensionOperations', () => {
  it.each(EXTENSION_OPERATION_KEYS)(
    'moves `%s` under additionalOperations, uppercased',
    (method) => {
      const doc = docOf({ [method]: operation('find') });

      relocateExtensionOperations(doc);

      const pathItem = pathItemOf(doc);
      expect(pathItem[method]).toBeUndefined();
      expect(pathItem.additionalOperations).toEqual({ [method.toUpperCase()]: operation('find') });
    },
  );

  // The 3.2 schema forbids these as additionalOperations keys, so relocating
  // one would produce a document that fails validation.
  it.each(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'])(
    'leaves the first-class `%s` operation in place',
    (method) => {
      const doc = docOf({ [method]: operation('op') });

      relocateExtensionOperations(doc);

      const pathItem = pathItemOf(doc);
      expect(pathItem[method]).toEqual(operation('op'));
      expect(pathItem.additionalOperations).toBeUndefined();
    },
  );

  it('relocates several extension methods on one path item', () => {
    const doc = docOf({
      get: operation('list'),
      search: operation('find'),
      mkcol: operation('make'),
    });

    relocateExtensionOperations(doc);

    const pathItem = pathItemOf(doc);
    expect(pathItem.get).toEqual(operation('list'));
    expect(pathItem.additionalOperations).toEqual({
      SEARCH: operation('find'),
      MKCOL: operation('make'),
    });
  });

  it('merges into a caller-authored additionalOperations without clobbering it', () => {
    const doc = docOf({
      search: operation('find'),
      additionalOperations: { PURGE: operation('purge') },
    });

    relocateExtensionOperations(doc);

    expect(pathItemOf(doc).additionalOperations).toEqual({
      PURGE: operation('purge'),
      SEARCH: operation('find'),
    });
  });

  it('lets a caller-authored entry win a key collision', () => {
    const doc = docOf({
      search: operation('from-route'),
      additionalOperations: { SEARCH: operation('from-caller') },
    });

    relocateExtensionOperations(doc);

    expect(pathItemOf(doc).additionalOperations).toEqual({ SEARCH: operation('from-caller') });
  });

  it('adds no additionalOperations key when there is nothing to relocate', () => {
    const doc = docOf({ get: operation('list') });

    relocateExtensionOperations(doc);

    expect('additionalOperations' in pathItemOf(doc)).toBe(false);
  });

  it('leaves a document with no paths alone', () => {
    const doc = {
      openapi: '3.2.0',
      info: { title: 't', version: 'v' },
    } as unknown as OpenAPIObject;

    expect(() => relocateExtensionOperations(doc)).not.toThrow();
  });

  it('produces output the 3.2 schema accepts, where the inline form did not', () => {
    const doc = docOf({ search: operation('find') });

    expect(() => validateOpenApi(doc)).toThrow(/schema validation failed/);

    relocateExtensionOperations(doc);

    expect(() => validateOpenApi(doc)).not.toThrow();
  });
});
