import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'apps/mobile/android/**', 'apps/mobile/modules/*/android/build/**', '**/.expo/**', 'infra/**', 'coverage/**', '**/dist-check/**', '**/test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/mobile/{app,src}/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.config.js', 'apps/mobile/metro.config.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // jest.mock factories must require() lazily; the icon stub is CommonJS.
    files: ['apps/mobile/test/**/*.{screen,native}.test.tsx', 'apps/mobile/test/stubs/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
