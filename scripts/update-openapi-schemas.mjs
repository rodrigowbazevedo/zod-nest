#!/usr/bin/env node
/**
 * update-openapi-schemas — refreshes the vendored OpenAPI JSON Schemas that
 * `test/document/openapi-validator.ts` compiles with Ajv.
 *
 * We vendor rather than depend on a validator package because no published
 * OpenAPI validator supports 3.2 yet: @apidevtools/swagger-parser (12.x and
 * 13.x alike) hard-rejects `3.2.0`, and its @apidevtools/openapi-schemas dep
 * ships no v3.2 document.
 *
 * The OpenAPI Initiative publishes each schema under a dated, immutable URL.
 * Pinning the date is deliberate — `.../schema/latest` is a moving target and
 * would make the test suite fail from upstream churn alone.
 *
 * To adopt a newer release: bump the `date` below, run this script, and run
 * the test suite. `/check-upstream-updates` watches for newer dated releases.
 *
 * Usage:
 *   node scripts/update-openapi-schemas.mjs           # rewrite the vendored copies
 *   node scripts/update-openapi-schemas.mjs --check   # fail if they are stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMAS = [
  { series: '3.1', date: '2025-02-13' },
  { series: '3.2', date: '2025-09-17' },
];

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test',
  'document',
  'openapi-schemas',
);

const checkOnly = process.argv.includes('--check');

const fetchSchema = async ({ series, date }) => {
  const url = `https://spec.openapis.org/oas/${series}/schema/${date}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`[oas-schemas] ${url} responded ${response.status}`);
  }
  const schema = await response.json();
  if (schema.$id !== url) {
    throw new Error(`[oas-schemas] ${url} returned $id ${schema.$id} — refusing to vendor`);
  }
  return schema;
};

let stale = 0;

for (const entry of SCHEMAS) {
  const target = join(OUT_DIR, `${entry.series}-${entry.date}.json`);
  const schema = await fetchSchema(entry);
  const next = `${JSON.stringify(schema, null, 2)}\n`;

  if (checkOnly) {
    const current = readFileSync(target, 'utf8');
    if (current === next) {
      console.log(`[oas-schemas] ${entry.series} up to date`);
      continue;
    }
    console.error(`[oas-schemas] ${entry.series} differs from ${entry.date} upstream`);
    stale += 1;
    continue;
  }

  writeFileSync(target, next);
  console.log(`[oas-schemas] wrote ${target}`);
}

if (stale > 0) {
  process.exit(1);
}
