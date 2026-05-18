#!/usr/bin/env node
/**
 * run-compat — applies a compatibility-matrix cell's peer-dep overrides
 * and runs the test suite under those versions.
 *
 * Reads the cell from `process.env.COMPAT_CELL` (a JSON object set by
 * the GitHub Actions workflow). Cells look like:
 *   { "name": "floor", "zod": "4.4.0", "@nestjs/common": "10.0.0", ... }
 *
 * Strategy:
 *   1. Build an `<dep>@<version>` list from every key except `name`.
 *   2. `npm install --no-save` the overrides into node_modules/. Doesn't
 *      modify package.json on the runner.
 *   3. `npm test` against the resulting tree.
 *   4. Exit non-zero on failure; CI marks the cell red.
 *
 * Run locally only with care — `--no-save` doesn't restore your
 * node_modules after the run. Re-run `npm install` to reset.
 */
import { execSync } from 'node:child_process';

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
  .filter(([key]) => key !== 'name')
  .map(([dep, version]) => `${dep}@${version}`);

if (overrides.length === 0) {
  console.error(`[compat] cell "${name}" has no dep overrides — nothing to test.`);
  process.exit(1);
}

console.log(`[compat] cell: ${name}`);
console.log(`[compat] overrides: ${overrides.join(' ')}`);

console.log(`[compat] applying overrides via npm install --no-save`);
execSync(`npm install --no-save --no-audit --no-fund ${overrides.map((o) => `'${o}'`).join(' ')}`, {
  stdio: 'inherit',
});

console.log(`[compat] running test suite`);
execSync('npm test', { stdio: 'inherit' });

console.log(`[compat] ✅ cell "${name}" passed`);
