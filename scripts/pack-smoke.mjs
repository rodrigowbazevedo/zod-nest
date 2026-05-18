#!/usr/bin/env node
/**
 * pack-smoke — verifies the package is installable + every documented
 * public export resolves from both the CJS and ESM entries.
 *
 * Catches publish-time-only regressions that the in-repo test suite can't
 * see: missing files in `package.json#files`, broken `exports` map,
 * misnamed entry, removed-but-still-referenced exports.
 *
 * Workflow:
 *   1. `npm pack --json` → tarball in repo root.
 *   2. Copy tarball into a fresh tempdir sandbox.
 *   3. `npm init -y` + install peer-deps + the tarball.
 *   4. CJS smoke: `node -e "require('zod-nest')"` + assert exports.
 *   5. ESM smoke: `node --input-type=module ...` + assert exports.
 *   6. Cleanup.
 *
 * Failure exits non-zero; CI fails the job.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Mirror of `src/index.ts` value exports — type-only exports are skipped
// because they don't resolve at runtime. Keep this list in sync when adding
// a new public value export.
const EXPECTED_EXPORTS = [
  'COMPONENTS_SCHEMAS_PREFIX',
  'createRegistry',
  'defaultRegistry',
  'extend',
  'getLineage',
  'toOpenApi',
  'ZOD_NEST_DTO_EXTENSION',
  'ZOD_NEST_ERROR_DUPLICATE_ID',
  'ZOD_NEST_ERROR_EXTENSION',
  'ZodNestError',
  'ZodNestUnrepresentableError',
  'createZodDto',
  'isZodDto',
  'isZodDtoMarker',
  'makeZodDtoMarker',
  'ZOD_DTO_SYMBOL',
  'ZodSerializationException',
  'ZodValidationException',
  'ZodValidationPipe',
  'ZodResponse',
  'ZodSerializerInterceptor',
  'defaultStatusFor',
  'resolveEffectiveStatus',
  'ZOD_RESPONSES_METADATA_KEY',
  'DEFAULT_MAX_LOGGED_VALUE_BYTES',
  'DEFAULT_REDACT_KEYS',
  'ZOD_NEST_OPTIONS',
  'ZodNestModule',
  'applyZodNest',
  'ZodNestDocumentError',
];

const log = (msg) => console.log(`[pack-smoke] ${msg}`);

const sandbox = mkdtempSync(join(tmpdir(), 'zod-nest-pack-smoke-'));
let tarballPathInRoot = null;

try {
  log(`sandbox: ${sandbox}`);

  log('running npm pack');
  const packOut = execSync('npm pack --json', { cwd: ROOT, encoding: 'utf-8' });
  const packMeta = JSON.parse(packOut)[0];
  tarballPathInRoot = join(ROOT, packMeta.filename);
  log(`tarball: ${packMeta.filename} (${packMeta.size} bytes)`);

  copyFileSync(tarballPathInRoot, join(sandbox, packMeta.filename));

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const peerArgs = Object.entries(pkg.peerDependencies ?? {})
    .map(([name, ver]) => `'${name}@${ver}'`)
    .join(' ');

  log('npm init + install peers + tarball');
  execSync('npm init -y', { cwd: sandbox, stdio: 'ignore' });
  execSync(`npm install --no-audit --no-fund reflect-metadata ${peerArgs}`, {
    cwd: sandbox,
    stdio: 'inherit',
  });
  execSync(`npm install --no-audit --no-fund ./${packMeta.filename}`, {
    cwd: sandbox,
    stdio: 'inherit',
  });

  const exportsJSON = JSON.stringify(EXPECTED_EXPORTS);

  // Scripts written to files (not `node -e` strings) so newlines survive
  // intact — `node -e` passes its arg through shell interpolation and
  // mangles escape sequences.

  log('CJS smoke');
  const cjsScript = `require('reflect-metadata');
const m = require('zod-nest');
const expected = ${exportsJSON};
const missing = expected.filter((n) => m[n] === undefined);
if (missing.length) {
  console.error('Missing CJS exports:', missing);
  process.exit(1);
}
console.log('CJS:', expected.length, 'exports present');
`;
  writeFileSync(join(sandbox, 'cjs-smoke.cjs'), cjsScript);
  execSync('node cjs-smoke.cjs', { cwd: sandbox, stdio: 'inherit' });

  log('ESM smoke');
  const esmScript = `import 'reflect-metadata';
import * as m from 'zod-nest';
const expected = ${exportsJSON};
const missing = expected.filter((n) => m[n] === undefined);
if (missing.length) {
  console.error('Missing ESM exports:', missing);
  process.exit(1);
}
console.log('ESM:', expected.length, 'exports present');
`;
  writeFileSync(join(sandbox, 'esm-smoke.mjs'), esmScript);
  execSync('node esm-smoke.mjs', { cwd: sandbox, stdio: 'inherit' });

  log('✅ all exports present in both CJS and ESM');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  if (tarballPathInRoot) {
    rmSync(tarballPathInRoot, { force: true });
  }
}
