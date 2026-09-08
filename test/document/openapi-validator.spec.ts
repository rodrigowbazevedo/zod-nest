import type { OpenAPIObject } from '@nestjs/swagger';

import { OPENAPI_SERIES, seriesOf, validateOpenApi } from './openapi-validator.js';

const docOf = (openapi: string, paths: Record<string, unknown> = {}): OpenAPIObject =>
  ({
    openapi,
    info: { title: 'validator', version: '0.0.0' },
    paths,
  }) as unknown as OpenAPIObject;

describe('seriesOf', () => {
  it('maps patch versions onto their series', () => {
    expect(seriesOf('3.1.0')).toBe('3.1');
    expect(seriesOf('3.1.2')).toBe('3.1');
    expect(seriesOf('3.2.0')).toBe('3.2');
  });

  it('rejects a version with no vendored schema', () => {
    expect(() => seriesOf('3.0.3')).toThrow(/Unsupported OpenAPI version: 3\.0\.3/);
  });

  it('rejects a missing version string', () => {
    expect(() => seriesOf(undefined)).toThrow(/no `openapi` version string/);
  });
});

describe('validateOpenApi — both vendored schemas load and accept a minimal doc', () => {
  it.each(OPENAPI_SERIES)('compiles and accepts a minimal %s document', (series) => {
    expect(() => validateOpenApi(docOf(`${series}.0`))).not.toThrow();
  });
});

// The failure mode worth guarding: a validator that silently accepts everything
// still passes the whole conformance suite while catching nothing.
describe('validateOpenApi — negative controls', () => {
  it.each(OPENAPI_SERIES)('rejects a malformed operation under %s', (series) => {
    const doc = docOf(`${series}.0`, { '/broken': { get: { responses: 'not-an-object' } } });
    expect(() => validateOpenApi(doc)).toThrow(/schema validation failed/);
  });

  it.each(OPENAPI_SERIES)('rejects a missing `info` block under %s', (series) => {
    const doc = docOf(`${series}.0`);
    delete (doc as { info?: unknown }).info;
    expect(() => validateOpenApi(doc)).toThrow(/schema validation failed/);
  });

  it('reports the offending instance path', () => {
    const doc = docOf('3.1.0', { '/broken': { get: { responses: 'not-an-object' } } });
    expect(() => validateOpenApi(doc)).toThrow(/\/paths\/~1broken\/get\/responses/);
  });
});

describe('validateOpenApi — 3.2-only shapes', () => {
  const pathItem = {
    query: {
      operationId: 'find',
      responses: { 200: { description: 'ok' } },
    },
  };

  it('accepts a first-class `query` operation under 3.2', () => {
    expect(() => validateOpenApi(docOf('3.2.0', { '/things': pathItem }))).not.toThrow();
  });

  it('rejects that same `query` operation under 3.1', () => {
    expect(() => validateOpenApi(docOf('3.1.0', { '/things': pathItem }))).toThrow(
      /schema validation failed/,
    );
  });
});
