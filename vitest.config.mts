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
      // 90% global, 80% per-area. The per-area floor catches regressions in a
      // single module without dragging the global by aggregation.
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
        'src/decorators/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/document/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/dto/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/exceptions/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/interceptors/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/logging/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/module/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/pipes/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/response/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/schema/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
