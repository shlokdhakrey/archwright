import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat ESLint configuration (ESLint 9 + typescript-eslint 8).
 * Type-aware linting keeps the production code honest; Prettier owns formatting.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.wrangler/**',
      'coverage/**',
      'worker-configuration.d.ts',
      'node_modules/**',
      // Tooling config files and standalone dev scripts are not part of the
      // typed project; Prettier still formats them.
      'eslint.config.js',
      'prettier.config.mjs',
      'scripts/**',
      'benchmarks/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.worker,
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      'no-console': 'off',
    },
  },
  {
    // Tests may use Node globals and are a little looser.
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      // Idiomatic in tests: `(await res.json()) as T` reads clearly, and
      // `expect(() => fn())` wraps void-returning calls.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  prettier,
);
