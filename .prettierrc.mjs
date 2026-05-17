/**
 * @type {import('prettier').Options}
 */
export default {
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  semi: true,
  plugins: ['@ianvs/prettier-plugin-sort-imports'],
  importOrderParserPlugins: ['typescript', 'decorators-legacy'],
  importOrder: [
    '<BUILTIN_MODULES>',
    '<THIRD_PARTY_MODULES>',
    '',
    '<TYPES>^(?!\\.)',
    '<TYPES>^\\.',
    '',
    '^src/(.*)$',
    '',
    '^[../]',
    '^[./]',
  ],
};
