import type { OpenAPIObject } from '@nestjs/swagger';

import {
  DEFAULT_OPENAPI_VERSION,
  resolveOpenApiVersion,
} from '../../src/document/openapi-version.js';

const docOf = (openapi?: string): OpenAPIObject =>
  ({ openapi, info: { title: 't', version: 'v' }, paths: {} }) as unknown as OpenAPIObject;

describe('resolveOpenApiVersion', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  // Preserved verbatim rather than normalised — the schemas accept every patch
  // and pre-release in the series, so the caller's own string stays accurate.
  it.each(['3.1.0', '3.1.1', '3.1.2', '3.2.0', '3.2.10', '3.1.0-rc1'])(
    'passes supported %s through untouched',
    (version) => {
      expect(resolveOpenApiVersion(docOf(version))).toBe(version);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('falls back silently when the document declares no version', () => {
    expect(resolveOpenApiVersion(docOf(undefined))).toBe(DEFAULT_OPENAPI_VERSION);
    expect(resolveOpenApiVersion(docOf(''))).toBe(DEFAULT_OPENAPI_VERSION);
    expect(warn).not.toHaveBeenCalled();
  });

  // DocumentBuilder stamps '3.0.0' whenever setOpenAPIVersion is not called, so
  // this warning reaches anyone who never opted into a version.
  it('warns and falls back on the DocumentBuilder default of 3.0.0', () => {
    expect(resolveOpenApiVersion(docOf('3.0.0'))).toBe(DEFAULT_OPENAPI_VERSION);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/declares OpenAPI `3\.0\.0`/);
    expect(warn.mock.calls[0][0]).toMatch(/emitting `3\.1\.0` instead/);
    expect(warn.mock.calls[0][0]).toMatch(/Supported: 3\.1\.x, 3\.2\.x/);
  });

  it.each(['2.0', '3.3.0', '3.1', '3.1.x', '3.10.0', 'nonsense'])(
    'warns and falls back on unsupported %s',
    (version) => {
      expect(resolveOpenApiVersion(docOf(version))).toBe(DEFAULT_OPENAPI_VERSION);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts every version the vendored schemas would', () => {
    // `3.10.0` is a different minor, not a 3.1 patch — the pattern must not
    // treat it as one.
    expect(resolveOpenApiVersion(docOf('3.10.0'))).toBe(DEFAULT_OPENAPI_VERSION);
    expect(resolveOpenApiVersion(docOf('3.1.10'))).toBe('3.1.10');
  });
});
