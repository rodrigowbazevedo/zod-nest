#!/usr/bin/env node
/**
 * pack-smoke — verifies the package is installable + every documented
 * public export resolves from both the CJS and ESM entries + the bundled DI
 * metadata is intact so consumers can bootstrap a real NestJS container
 * (regression guard for #35).
 *
 * Catches publish-time-only regressions that the in-repo test suite can't
 * see: missing files in `package.json#files`, broken `exports` map,
 * misnamed entry, removed-but-still-referenced exports, missing
 * `design:paramtypes` metadata on `@Injectable()` classes.
 *
 * Workflow:
 *   1. `npm pack --json` → tarball in repo root.
 *   2. Copy tarball into a fresh tempdir sandbox.
 *   3. `npm init -y` + install peer-deps + the tarball.
 *   4. Metadata grep: installed `dist/index.js` must carry `design:paramtypes`.
 *   5. CJS smoke: assert exports + bootstrap `ZodNestModule.forRoot()` and
 *      resolve `ZodSerializerInterceptor` via `NestFactory.createApplicationContext`.
 *   6. ESM smoke: same.
 *   7. Cleanup.
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
  // `--ignore-scripts` skips the `prepare` lifecycle (husky setup) so its
  // stdout doesn't pollute `--json`'s output. CI's `HUSKY=0` env makes
  // husky print `HUSKY=0 skip install` to stdout, which then breaks
  // `JSON.parse` here. We don't need prepare-time effects during pack.
  //
  // Defensive parse on top: slice from the first `[` so any future
  // pre-pack stdout noise still parses.
  const packOutRaw = execSync('npm pack --json --ignore-scripts', {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  const jsonStart = packOutRaw.indexOf('[');
  if (jsonStart === -1) {
    throw new Error(`npm pack --json produced no JSON array:\n${packOutRaw}`);
  }
  const packMeta = JSON.parse(packOutRaw.slice(jsonStart))[0];
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

  log('metadata grep: installed dist/index.js carries design:paramtypes (#35)');
  // The published bundle must contain `design:paramtypes` emissions so NestJS
  // DI can resolve type-keyed constructor params. tsup's default esbuild
  // transform skips this; SWC restores it. Asserting on the *installed*
  // dist (not the repo's) makes sure `package.json#files` + `exports` ship
  // the right artifact.
  const installedCjs = readFileSync(
    join(sandbox, 'node_modules', 'zod-nest', 'dist', 'index.js'),
    'utf-8',
  );
  const installedEsm = readFileSync(
    join(sandbox, 'node_modules', 'zod-nest', 'dist', 'index.mjs'),
    'utf-8',
  );
  for (const [label, source] of [
    ['CJS', installedCjs],
    ['ESM', installedEsm],
  ]) {
    if (!/design:paramtypes/.test(source)) {
      throw new Error(
        `Installed ${label} bundle is missing design:paramtypes metadata — ` +
          'NestJS DI will fail to resolve type-keyed constructor params (#35).',
      );
    }
  }

  const exportsJSON = JSON.stringify(EXPECTED_EXPORTS);

  // Scripts written to files (not `node -e` strings) so newlines survive
  // intact — `node -e` passes its arg through shell interpolation and
  // mangles escape sequences.
  //
  // Each smoke also bootstraps a Nest application context with
  // `ZodNestModule.forRoot()` and resolves `ZodSerializerInterceptor`.
  // `createApplicationContext` exercises the DI container without needing
  // an HTTP platform adapter, which is sufficient to reproduce the #35
  // failure mode (the original error fires while Nest builds providers).

  log('CJS smoke');
  // Note: \`@Module(...)\` mutates the target class via reflect-metadata and
  // returns void, so the class reference must be retained separately — do
  // not assign the decorator-application's return value.
  //
  // Successful \`createApplicationContext\` is the assertion: Nest instantiates
  // \`APP_INTERCEPTOR\` providers eagerly during container init, so the #35
  // failure mode ("Nest can't resolve dependencies of ZodSerializerInterceptor")
  // would throw here. No need to resolve the interceptor afterwards — it's
  // wired via \`APP_INTERCEPTOR\` (a multi-token), not as a direct provider.
  const cjsScript = `require('reflect-metadata');
const m = require('zod-nest');
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const expected = ${exportsJSON};
const missing = expected.filter((n) => m[n] === undefined);
if (missing.length) {
  console.error('Missing CJS exports:', missing);
  process.exit(1);
}
console.log('CJS:', expected.length, 'exports present');

class RootModule {}
Module({ imports: [m.ZodNestModule.forRoot()] })(RootModule);

NestFactory.createApplicationContext(RootModule, { logger: false })
  .then((ctx) => {
    console.log('CJS: ZodNestModule.forRoot() DI bootstrap OK');
    return ctx.close();
  })
  .catch((err) => {
    console.error('CJS DI bootstrap failed:', err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  });
`;
  writeFileSync(join(sandbox, 'cjs-smoke.cjs'), cjsScript);
  execSync('node cjs-smoke.cjs', { cwd: sandbox, stdio: 'inherit' });

  log('ESM smoke');
  const esmScript = `import 'reflect-metadata';
import * as m from 'zod-nest';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
const expected = ${exportsJSON};
const missing = expected.filter((n) => m[n] === undefined);
if (missing.length) {
  console.error('Missing ESM exports:', missing);
  process.exit(1);
}
console.log('ESM:', expected.length, 'exports present');

class RootModule {}
Module({ imports: [m.ZodNestModule.forRoot()] })(RootModule);

const ctx = await NestFactory.createApplicationContext(RootModule, { logger: false });
console.log('ESM: ZodNestModule.forRoot() DI bootstrap OK');
await ctx.close();
`;
  writeFileSync(join(sandbox, 'esm-smoke.mjs'), esmScript);
  execSync('node esm-smoke.mjs', { cwd: sandbox, stdio: 'inherit' });

  log('✅ exports + DI bootstrap green in both CJS and ESM');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  if (tarballPathInRoot) {
    rmSync(tarballPathInRoot, { force: true });
  }
}
