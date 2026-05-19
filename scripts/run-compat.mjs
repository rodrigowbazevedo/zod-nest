#!/usr/bin/env node
/**
 * run-compat — applies a compatibility-matrix cell's peer-dep overrides,
 * runs the test suite, builds the lib, and runs pack-smoke under those
 * versions.
 *
 * Reads the cell from `process.env.COMPAT_CELL` (a JSON object set by
 * the GitHub Actions workflow). Cells look like:
 *   { "name": "floor-node22", "node": "22", "zod": "4.4.0", ... }
 *
 * The `name` and `node` keys are metadata for the workflow (cell label
 * and `setup-node` version) — they are NOT peer-dep overrides and must
 * not be passed to `npm install`. Every other key is treated as a
 * `<dep>@<version>` pair.
 *
 * Strategy:
 *   1. Build an `<dep>@<version>` list from every key except `name` and `node`.
 *   2. `npm install --no-save` the overrides into node_modules/. Doesn't
 *      modify package.json on the runner.
 *   3. `npm test` against the resulting tree.
 *   4. `npm run build` to produce dist/.
 *   5. `npm run pack:smoke` to verify the built tarball installs and
 *      bootstraps NestJS DI under the cell's Node + peer-dep pin.
 *   6. Exit non-zero on the first failure; CI marks the cell red.
 *
 * Run locally only with care — `--no-save` doesn't restore your
 * node_modules after the run. Re-run `npm install` to reset.
 */
import { execSync } from 'node:child_process';

// Metadata keys on each cell — the workflow consumes them, run-compat
// must not treat them as peer-dep override targets.
const NON_DEP_KEYS = new Set(['name', 'node']);

const cellJSON = process.env.COMPAT_CELL;
if (!cellJSON) {
  console.error('[compat] COMPAT_CELL env var is required.');
  process.exit(1);
}

let cell;
try {
  cell = JSON.parse(cellJSON);
} catch (err) {
  console.error('[compat] COMPAT_CELL is not valid JSON:', err.message);
  console.error('         received:', cellJSON);
  process.exit(1);
}

const name = cell.name ?? '<unnamed>';
const overrides = Object.entries(cell)
  .filter(([key]) => !NON_DEP_KEYS.has(key))
  .map(([dep, version]) => `${dep}@${version}`);

if (overrides.length === 0) {
  console.error(`[compat] cell "${name}" has no dep overrides — nothing to test.`);
  process.exit(1);
}

console.log(`[compat] cell: ${name}`);
console.log(`[compat] node: ${cell.node ?? '<runner default>'}`);
console.log(`[compat] overrides: ${overrides.join(' ')}`);

console.log(`[compat] applying overrides via npm install --no-save`);
execSync(`npm install --no-save --no-audit --no-fund ${overrides.map((o) => `'${o}'`).join(' ')}`, {
  stdio: 'inherit',
});

console.log(`[compat] running test suite`);
execSync('npm test', { stdio: 'inherit' });

console.log(`[compat] building dist`);
execSync('npm run build', { stdio: 'inherit' });

console.log(`[compat] running pack-smoke against the built tarball`);
execSync('npm run pack:smoke', { stdio: 'inherit' });

console.log(`[compat] ✅ cell "${name}" passed`);
