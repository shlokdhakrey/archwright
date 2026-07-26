/** @type {import('prettier').Config} */
export default {
  printWidth: 110,
  singleQuote: true,
  semi: true,
  trailingComma: 'all',
  arrowParens: 'always',
  tabWidth: 2,
  endOfLine: 'lf',
  overrides: [
    {
      files: ['*.jsonc', 'wrangler.jsonc'],
      options: { trailingComma: 'none' },
    },
  ],
};
