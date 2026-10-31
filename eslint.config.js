import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nodeBuiltins = ['fs', 'path', 'os', 'child_process', 'crypto', 'url', 'worker_threads', 'stream', 'http', 'https', 'net'];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/out/**', '**/release/**', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Playwright fixtures must destructure their (empty) dependencies.
    files: ['apps/desktop/e2e/**/*.ts'],
    rules: { 'no-empty-pattern': 'off' },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['react', 'react-dom', 'electron', 'three', ...nodeBuiltins.flatMap((m) => [m, `node:${m}`])],
          patterns: ['@react-three/*', 'dockview*'],
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        { paths: ['electron', ...nodeBuiltins.flatMap((m) => [m, `node:${m}`])], patterns: ['**/main/*', '**/preload/*'] },
      ],
    },
  },
);
