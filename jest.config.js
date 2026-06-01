/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Per-area `src/*/index.ts` files are pure re-exports — Jest counts the
  // re-export expressions as uncalled "functions", which dragged the
  // function-coverage metric down to false negatives. Exclude them.
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/**/index.ts', '!src/**/*.types.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // 90% global, 80% per-area. The per-area floor catches regressions in a
  // single module without dragging the global by aggregation.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 90,
      functions: 90,
      lines: 90,
    },
    './src/decorators/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/document/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/dto/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/exceptions/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/interceptors/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/logging/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/module/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/pipes/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/response/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
    './src/schema/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
  reporters: ['default', ['jest-junit', { outputDirectory: 'reports', outputName: 'junit.xml' }]],
};
