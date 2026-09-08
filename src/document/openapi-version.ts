import type { OpenAPIObject } from '@nestjs/swagger';

/** Series `applyZodNest` can emit. 3.2 is a backward-compatible superset of
 * 3.1; the only body difference is the `query` key, undefined in 3.1. */
export const SUPPORTED_OPENAPI_SERIES = ['3.1', '3.2'] as const;

export const DEFAULT_OPENAPI_VERSION = '3.1.0';

/** Mirrors the `openapi` pattern the 3.1 and 3.2 schemas enforce themselves,
 * so every patch and pre-release those accept is accepted here too. */
const SUPPORTED_VERSION_PATTERN = /^3\.[12]\.\d+(?:-.+)?$/;

/** Version the caller declared via `DocumentBuilder.setOpenAPIVersion()`. Unset
 * falls back to the default silently; an unsupported value warns. */
export const resolveOpenApiVersion = (doc: OpenAPIObject): string => {
  const declared: unknown = doc.openapi;
  if (typeof declared !== 'string' || declared === '') {
    return DEFAULT_OPENAPI_VERSION;
  }
  if (SUPPORTED_VERSION_PATTERN.test(declared)) {
    return declared;
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[zod-nest] Document declares OpenAPI \`${declared}\`, which zod-nest does not emit; ` +
      `emitting \`${DEFAULT_OPENAPI_VERSION}\` instead. ` +
      `Supported: ${SUPPORTED_OPENAPI_SERIES.map((series) => `${series}.x`).join(', ')}. ` +
      `Set one via \`DocumentBuilder.setOpenAPIVersion()\` to silence this.`,
  );
  return DEFAULT_OPENAPI_VERSION;
};
