import { defineConfig } from 'tsup';
import swc from 'unplugin-swc';

// SWC transforms TS — not esbuild — so legacy decorator metadata
// (`design:paramtypes`) is emitted into the published bundle. NestJS DI
// resolves type-keyed constructor params via this metadata (e.g. the
// non-`@Optional()` `Reflector` on `ZodSerializerInterceptor`); without it,
// consumers hit `Nest can't resolve dependencies of …` at bootstrap. See #35.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  treeshake: true,
  esbuildPlugins: [
    swc.esbuild({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
});
