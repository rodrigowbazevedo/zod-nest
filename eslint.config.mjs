import js from '@eslint/js';
import jestPlugin from 'eslint-plugin-jest';
import prettierPlugin from 'eslint-plugin-prettier/recommended';
import unicornPlugin from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'reports/**',
      'node_modules/**',
      '**/*.config.*',
      // Claude Code session state: agent worktrees, transcripts, settings —
      // not project source, must not affect lint regardless of what's inside.
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      unicorn: unicornPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'object-shorthand': ['error', 'properties'],
      'arrow-body-style': ['error', 'as-needed'],
      'unicorn/no-array-for-each': 'error',
      'unicorn/no-await-expression-member': 'error',
      'no-console': 'warn',
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    plugins: { jest: jestPlugin },
    languageOptions: {
      globals: jestPlugin.environments.globals.globals,
    },
    rules: {
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
      'jest/no-identical-title': 'error',
      'jest/valid-expect': 'error',
    },
  },
  {
    // CLI utility scripts intentionally write to stdout/stderr.
    files: ['scripts/**/*.{js,mjs,ts}'],
    rules: {
      'no-console': 'off',
    },
  },
  prettierPlugin,
  {
    rules: {
      // Re-enable after prettier-config (which disables `curly`).
      // Project convention: always brace `if`/`for`/`while` bodies; never inline.
      curly: ['error', 'all'],
      // Project convention: prefer `const foo = (...) => ...` over `function foo(...)`.
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
    },
  },
);
