import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

import type { OpenAPIObject } from '@nestjs/swagger';
import type { ValidateFunction } from 'ajv';

const SCHEMA_FILES = {
  '3.1': '3.1-2025-02-13.json',
  '3.2': '3.2-2025-09-17.json',
} as const;

export type OpenApiSeries = keyof typeof SCHEMA_FILES;

export const OPENAPI_SERIES = Object.keys(SCHEMA_FILES) as OpenApiSeries[];

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'openapi-schemas');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const readSchema = (series: OpenApiSeries): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(readFileSync(join(SCHEMA_DIR, SCHEMA_FILES[series]), 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(`Vendored OpenAPI ${series} schema is not a JSON object`);
  }
  return parsed;
};

/**
 * Ajv mis-resolves the `$dynamicRef: "#meta"` the OAS schemas use for the
 * Schema Object dialect, so splice in the de-anchored `$defs.schema` at each
 * site. Same workaround @apidevtools/swagger-parser applies — see ajv#1573.
 */
const resolveSchemaDialect = (schema: Record<string, unknown>): Record<string, unknown> => {
  const defs = schema.$defs;
  if (!isRecord(defs) || !isRecord(defs.schema)) {
    throw new Error('Vendored OpenAPI schema has no `$defs.schema` to splice in');
  }
  const placeholder = { ...defs.schema };
  delete placeholder.$dynamicAnchor;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (!isRecord(node)) {
      return node;
    }
    if (node.$dynamicRef === '#meta') {
      return placeholder;
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value)]));
  };

  const resolved = walk(schema);
  if (!isRecord(resolved)) {
    throw new Error('Vendored OpenAPI schema did not survive dialect resolution');
  }
  return resolved;
};

const validators = new Map<OpenApiSeries, ValidateFunction>();

const validatorFor = (series: OpenApiSeries): ValidateFunction => {
  const cached = validators.get(series);
  if (cached !== undefined) {
    return cached;
  }
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  // Not in ajv-formats; left unchecked rather than logged as unknown on every run.
  ajv.addFormat('media-range', true);
  const compiled = ajv.compile(resolveSchemaDialect(readSchema(series)));
  validators.set(series, compiled);
  return compiled;
};

export const seriesOf = (version: unknown): OpenApiSeries => {
  if (typeof version !== 'string') {
    throw new Error(`Document has no \`openapi\` version string (got ${String(version)})`);
  }
  const series = OPENAPI_SERIES.find((candidate) => version.startsWith(`${candidate}.`));
  if (series === undefined) {
    throw new Error(
      `Unsupported OpenAPI version: ${version}. Vendored schemas cover ${OPENAPI_SERIES.join(', ')}.`,
    );
  }
  return series;
};

/** Throws with every Ajv error when `doc` does not conform to its declared OpenAPI version. */
export const validateOpenApi = (doc: OpenAPIObject): void => {
  const series = seriesOf(doc.openapi);
  const validate = validatorFor(series);
  if (validate(JSON.parse(JSON.stringify(doc)))) {
    return;
  }
  const details = (validate.errors ?? [])
    .map((error) => `  ${error.instancePath === '' ? '/' : error.instancePath} ${error.message}`)
    .join('\n');
  throw new Error(`OpenAPI ${series} schema validation failed.\n${details}`);
};
