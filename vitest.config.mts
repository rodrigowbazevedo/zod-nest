import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['{src,test}/**/*.spec.ts'],
    reporters: ['default', 'junit'],
    outputFile: { junit: './reports/junit.xml' },
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'lcov', 'html'],
      // Per-area `src/*/index.ts` files are pure re-exports — counting their
      // re-export expressions as uncalled "functions" produced false negatives.
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts', 'src/**/*.types.ts'],
      // 99% global, 80% per-area: the per-area floor catches one module
      // regressing. 99 not 100, leaving room for type-driven fallbacks whose
      // runtime invariant makes them unreachable (see `registry.ts`).
      thresholds: {
        statements: 99,
        branches: 99,
        functions: 99,
        lines: 99,
        'src/decorators/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/document/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/dto/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/exceptions/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/express/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/fastify/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/interceptors/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/logging/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/module/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/multipart/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/pipes/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/response/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/schema/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
