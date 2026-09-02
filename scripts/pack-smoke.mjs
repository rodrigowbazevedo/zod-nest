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
 *   5. CJS smoke: assert root + subpath exports + cross-entry shared state +
 *      bootstrap `ZodNestModule.forRoot()` and
 *      resolve `ZodSerializerInterceptor` via `NestFactory.createApplicationContext`.
 *   6. ESM smoke: same.
 *   7. Cleanup.
 *
 * Failure exits non-zero; CI fails the job.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Value exports per subpath entry in `package.json#exports`. Type-only exports
// are skipped because they don't resolve at runtime. Keep these lists in sync
// when adding a new public value export to a subpath.
const EXPECTED_SUBPATH_EXPORTS = {
  helpers: [
    'binary',
    'binaryFragment',
    'byteFragment',
    'dateFragment',
    'dateTimeFragment',
    'doubleFragment',
    'emailFragment',
    'enrich',
    'floatFragment',
    'hostnameFragment',
    'int32Fragment',
    'int64Fragment',
    'ipv4Fragment',
    'ipv6Fragment',
    'opaque',
    'opaqueFragment',
    'timeFragment',
    'uriFragment',
    'uuidFragment',
    'BlobSchema',
    'BufferSchema',
    'FileSchema',
  ],
  express: [
    'MULTIPART_CONTENT_TYPE',
    'MulterDiskFileSchema',
    'MulterMemoryFileSchema',
    'multerDiskFile',
    'multerMemoryFile',
    'ZodMultipart',
    'ZodMultipartBody',
    'ZodUploadedFile',
    'ZodUploadedFiles',
  ],
  fastify: [
    'MULTIPART_CONTENT_TYPE',
    'FastifyMultipartFileSchema',
    'fastifyMultipartFile',
    'ZodMultipart',
    'ZodMultipartBody',
  ],
};

const log = (msg) => console.log(`[pack-smoke] ${msg}`);

const parseCompatCell = () => {
  const raw = process.env.COMPAT_CELL;
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`COMPAT_CELL is not valid JSON: ${err.message}`, { cause: err });
  }
};

// `peerDependencies` holds ranges, so installing straight from them smoke-tests
// each range's maximum rather than the cell under test. When run inside the
// compat matrix, the cell's exact pins win for the peers it names.
const resolvePeerArgs = (peerDependencies) => {
  const cell = parseCompatCell();
  const pinned = Object.keys(peerDependencies).filter((name) => cell[name] !== undefined);
  if (pinned.length > 0) {
    log(`COMPAT_CELL "${cell.name ?? '<unnamed>'}" pins: ${pinned.join(', ')}`);
  }
  return Object.entries(peerDependencies)
    .map(([name, range]) => `'${name}@${cell[name] ?? range}'`)
    .join(' ');
};

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
  const peerArgs = resolvePeerArgs(pkg.peerDependencies ?? {});

  log('npm init + install peers + tarball');
  execSync('npm init -y', { cwd: sandbox, stdio: 'ignore' });
  const nodeTypes = `'@types/node@${pkg.devDependencies['@types/node']}'`;
  execSync(`npm install --no-audit --no-fund reflect-metadata ${nodeTypes} ${peerArgs}`, {
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
  const subpathExportsJSON = JSON.stringify(EXPECTED_SUBPATH_EXPORTS);

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

const subpaths = ${subpathExportsJSON};
for (const [subpath, names] of Object.entries(subpaths)) {
  const mod = require('zod-nest/' + subpath);
  const absent = names.filter((n) => mod[n] === undefined);
  if (absent.length) {
    console.error('Missing CJS exports from zod-nest/' + subpath + ':', absent);
    process.exit(1);
  }
  console.log('CJS: zod-nest/' + subpath + ':', names.length, 'exports present');
}

const main = m;
const helpers = require('zod-nest/helpers');
const expressEntry = require('zod-nest/express');
const fastifyEntry = require('zod-nest/fastify');
const zod = require('zod');
const LABEL = 'CJS';

// Cross-entry state: a subpath schema must emit through the main entry.
// Asserting exports exist does not catch a duplicated override map --
// only crossing the boundary with a real schema does.
const crossEntry = [
  ['zod-nest/helpers FileSchema', helpers.FileSchema],
  ['zod-nest/express multerMemoryFile()', expressEntry.multerMemoryFile()],
  ['zod-nest/fastify fastifyMultipartFile()', fastifyEntry.fastifyMultipartFile()],
];
for (const [label, schema] of crossEntry) {
  let emitted;
  try {
    emitted = main.toOpenApi(schema, {
      io: 'input',
      registry: main.createRegistry(),
      strict: true,
    }).schema;
  } catch (err) {
    console.error('Cross-entry emission failed for ' + label + ': ' + (err && err.message));
    console.error('  -> that subpath bundle does not share module state with the main entry.');
    process.exit(1);
  }
  if (emitted.type !== 'string' || emitted.format !== 'binary') {
    console.error('Cross-entry emission wrong for ' + label + ': ' + JSON.stringify(emitted));
    process.exit(1);
  }
}
console.log(LABEL + ': cross-entry override map shared (' + crossEntry.length + ' subpath schemas)');

// The registry is the other half: ZodMultipart registers named components
// into defaultRegistry, which applyZodNest reads from the main entry.
const probeSchema = zod.z
  .object({ file: expressEntry.multerMemoryFile() })
  .meta({ id: 'PackSmokeCrossEntryProbe' });
expressEntry.ZodMultipart(probeSchema)({}, 'upload', { value: function upload() {} });
if (!main.defaultRegistry.ids().includes('PackSmokeCrossEntryProbe')) {
  console.error('Cross-entry registry not shared: the main defaultRegistry does not see an id');
  console.error('  registered by zod-nest/express. Named components would be silently dropped.');
  process.exit(1);
}
console.log(LABEL + ': cross-entry defaultRegistry shared');

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

const subpaths = ${subpathExportsJSON};
for (const [subpath, names] of Object.entries(subpaths)) {
  const mod = await import('zod-nest/' + subpath);
  const absent = names.filter((n) => mod[n] === undefined);
  if (absent.length) {
    console.error('Missing ESM exports from zod-nest/' + subpath + ':', absent);
    process.exit(1);
  }
  console.log('ESM: zod-nest/' + subpath + ':', names.length, 'exports present');
}

const main = m;
const helpers = await import('zod-nest/helpers');
const expressEntry = await import('zod-nest/express');
const fastifyEntry = await import('zod-nest/fastify');
const zod = await import('zod');
const LABEL = 'ESM';

// Cross-entry state: a subpath schema must emit through the main entry.
// Asserting exports exist does not catch a duplicated override map --
// only crossing the boundary with a real schema does.
const crossEntry = [
  ['zod-nest/helpers FileSchema', helpers.FileSchema],
  ['zod-nest/express multerMemoryFile()', expressEntry.multerMemoryFile()],
  ['zod-nest/fastify fastifyMultipartFile()', fastifyEntry.fastifyMultipartFile()],
];
for (const [label, schema] of crossEntry) {
  let emitted;
  try {
    emitted = main.toOpenApi(schema, {
      io: 'input',
      registry: main.createRegistry(),
      strict: true,
    }).schema;
  } catch (err) {
    console.error('Cross-entry emission failed for ' + label + ': ' + (err && err.message));
    console.error('  -> that subpath bundle does not share module state with the main entry.');
    process.exit(1);
  }
  if (emitted.type !== 'string' || emitted.format !== 'binary') {
    console.error('Cross-entry emission wrong for ' + label + ': ' + JSON.stringify(emitted));
    process.exit(1);
  }
}
console.log(LABEL + ': cross-entry override map shared (' + crossEntry.length + ' subpath schemas)');

// The registry is the other half: ZodMultipart registers named components
// into defaultRegistry, which applyZodNest reads from the main entry.
const probeSchema = zod.z
  .object({ file: expressEntry.multerMemoryFile() })
  .meta({ id: 'PackSmokeCrossEntryProbe' });
expressEntry.ZodMultipart(probeSchema)({}, 'upload', { value: function upload() {} });
if (!main.defaultRegistry.ids().includes('PackSmokeCrossEntryProbe')) {
  console.error('Cross-entry registry not shared: the main defaultRegistry does not see an id');
  console.error('  registered by zod-nest/express. Named components would be silently dropped.');
  process.exit(1);
}
console.log(LABEL + ': cross-entry defaultRegistry shared');

class RootModule {}
Module({ imports: [m.ZodNestModule.forRoot()] })(RootModule);

const ctx = await NestFactory.createApplicationContext(RootModule, { logger: false });
console.log('ESM: ZodNestModule.forRoot() DI bootstrap OK');
await ctx.close();
`;
  writeFileSync(join(sandbox, 'esm-smoke.mjs'), esmScript);
  execSync('node esm-smoke.mjs', { cwd: sandbox, stdio: 'inherit' });

  log('types smoke: subpath types resolve + name portably in declaration emit');

  // Declaration emit is where a types-resolution gap bites: the subpath type
  // must be nameable through a specifier valid in the consumer's resolution
  // mode, or tsc writes a raw `node_modules/…/dist` path and rejects it (#144).
  const typesSandbox = join(sandbox, 'types-smoke');
  mkdirSync(join(typesSandbox, 'src', 'shared'), { recursive: true });
  mkdirSync(join(typesSandbox, 'src', 'api'), { recursive: true });

  // The schemas must reach the consumer through a local module, not a direct
  // `zod-nest/express` import — with the import in scope tsc reuses its
  // specifier and the gap stays hidden.
  writeFileSync(
    join(typesSandbox, 'src', 'shared', 'file-schemas.ts'),
    `import { createRegistry } from 'zod-nest';
import { multerMemoryFile } from 'zod-nest/express';
import { fastifyMultipartFile } from 'zod-nest/fastify';
import { FileSchema } from 'zod-nest/helpers';

export const UploadedFileSchema = multerMemoryFile();
export const UploadedMultipartSchema = fastifyMultipartFile();
export const UploadedBlobSchema = FileSchema;
export const registry = createRegistry();
`,
  );
  writeFileSync(
    join(typesSandbox, 'src', 'api', 'schemas.ts'),
    `import { z } from 'zod';

import {
  registry,
  UploadedBlobSchema,
  UploadedFileSchema,
  UploadedMultipartSchema,
} from '../shared/file-schemas.js';

export const ExpressBody = z.object({ file: UploadedFileSchema });
export const FastifyBody = z.object({ file: UploadedMultipartSchema });
export const HelperBody = z.object({ file: UploadedBlobSchema });
export const sharedRegistry = registry;
`,
  );

  // `commonjs` + `bundler` is the NestJS CLI default under TypeScript 6 and the
  // cell #144 reported; `node10` is the other half of that report.
  const TYPES_SMOKE_CELLS = [
    { module: 'commonjs', moduleResolution: 'bundler', consumer: 'commonjs' },
    { module: 'commonjs', moduleResolution: 'node10', consumer: 'commonjs' },
    { module: 'nodenext', moduleResolution: 'nodenext', consumer: 'commonjs' },
    { module: 'nodenext', moduleResolution: 'nodenext', consumer: 'module' },
  ];
  const EXPECTED_TYPE_SPECIFIERS = ['zod-nest', 'zod-nest/express', 'zod-nest/fastify'];
  const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

  for (const { module, moduleResolution, consumer } of TYPES_SMOKE_CELLS) {
    const label = `${module}/${moduleResolution} (${consumer} consumer)`;
    const outDir = `dts-${module}-${moduleResolution}-${consumer}`;
    writeFileSync(
      join(typesSandbox, 'package.json'),
      JSON.stringify({ name: 'types-smoke', private: true, type: consumer }, null, 2),
    );
    writeFileSync(
      join(typesSandbox, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            module,
            moduleResolution,
            target: 'esnext',
            ignoreDeprecations: '6.0',
            declaration: true,
            strict: true,
            skipLibCheck: true,
            types: ['node'],
            rootDir: 'src',
            outDir,
          },
          include: ['src'],
        },
        null,
        2,
      ),
    );

    try {
      execSync(`node ${JSON.stringify(tsc)} -p tsconfig.json`, {
        cwd: typesSandbox,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    } catch (err) {
      throw new Error(
        `tsc failed for ${label} — the published types don't resolve or don't ` +
          `emit portably under that config (#144):\n${err.stdout ?? err.message}`,
        { cause: err },
      );
    }

    const emitted = readFileSync(join(typesSandbox, outDir, 'api', 'schemas.d.ts'), 'utf-8');
    if (emitted.includes('node_modules')) {
      throw new Error(
        `Declaration emit for ${label} named a type through a raw node_modules ` +
          `path instead of a package specifier — not portable (#144):\n${emitted}`,
      );
    }
    const named = new Set([...emitted.matchAll(/import\("([^"]+)"\)/g)].map((match) => match[1]));
    const unnamed = EXPECTED_TYPE_SPECIFIERS.filter((specifier) => !named.has(specifier));
    if (unnamed.length > 0) {
      throw new Error(
        `Declaration emit for ${label} never named a type through ${unnamed.join(', ')} — ` +
          `expected every entry point to be reachable by specifier (#144):\n${emitted}`,
      );
    }
    log(`types: ${label} OK`);
  }

  log('✅ exports + DI bootstrap + declaration emit green in both CJS and ESM');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  if (tarballPathInRoot) {
    rmSync(tarballPathInRoot, { force: true });
  }
}
