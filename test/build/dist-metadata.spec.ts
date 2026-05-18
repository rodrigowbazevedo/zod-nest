import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Regression guard for #35: the published bundle must carry
// `design:paramtypes` reflect-metadata. Without it, NestJS DI cannot resolve
// type-keyed constructor params (like the non-`@Optional()` `Reflector` on
// `ZodSerializerInterceptor`) and consumers fail at bootstrap. tsup's default
// esbuild transform skips legacy decorator metadata; we plug in SWC via
// `unplugin-swc` to restore the emission. Asserts both CJS and ESM outputs.
//
// Skipped when `dist/` is absent so `npm test` works in a fresh checkout
// before `npm run build`. CI runs `npm run pack:smoke` after `npm run build`,
// which exercises the same guarantee end-to-end against the packed tarball.

const ROOT = resolve(__dirname, '..', '..');
const CJS_BUNDLE = resolve(ROOT, 'dist/index.js');
const ESM_BUNDLE = resolve(ROOT, 'dist/index.mjs');

const distBuilt = existsSync(CJS_BUNDLE) && existsSync(ESM_BUNDLE);
const describeIfBuilt = distBuilt ? describe : describe.skip;

describeIfBuilt('dist bundle reflect-metadata emission (#35)', () => {
  it.each([
    ['CJS', CJS_BUNDLE],
    ['ESM', ESM_BUNDLE],
  ])('%s bundle emits design:paramtypes for ZodSerializerInterceptor → Reflector', (_, path) => {
    const source = readFileSync(path, 'utf-8');

    // SWC emits `_ts_metadata("design:paramtypes", [...])`; esbuild's default
    // transform (the broken path) emits nothing. Either form is acceptable —
    // we just need *some* `design:paramtypes` block referencing `Reflector`.
    expect(source).toMatch(/design:paramtypes/);

    // ZodSerializerInterceptor specifically: index 0 must reference Reflector,
    // because it's the only constructor param without an explicit DI hint.
    // CJS qualifies as `core.Reflector`; ESM bundles import it bare.
    const interceptorBlock = extractDecorateBlock(source, 'ZodSerializerInterceptor');
    expect(interceptorBlock).toMatch(/design:paramtypes/);
    expect(interceptorBlock).toMatch(/\bReflector\b/);
  });
});

// Pulls the `_ts_decorate*([...], <prefix>?ClassName)` block that wires
// class-level decorators + metadata. SWC emits one of these per decorated
// class. CJS bundles use `exports.ClassName`, ESM bundles use a bare
// `ClassName`; the regex accepts either tail.
const extractDecorateBlock = (source: string, className: string): string => {
  const closeRe = new RegExp(`,\\s*(?:[\\w.]+\\.)?${className}\\)`);
  const closeMatch = closeRe.exec(source);
  if (closeMatch === null) {
    throw new Error(`could not locate _ts_decorate block for ${className}`);
  }
  const end = closeMatch.index + closeMatch[0].length;
  const openRe = new RegExp(`(?:[\\w.]+\\.)?${className}\\s*=\\s*_ts_decorate`);
  const openMatch = openRe.exec(source.slice(0, end));
  if (openMatch === null) {
    throw new Error(`could not locate _ts_decorate assignment for ${className}`);
  }
  return source.slice(openMatch.index, end);
};
