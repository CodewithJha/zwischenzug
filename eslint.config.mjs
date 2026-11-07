import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'release/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['src/main/**', 'src/preload/**', 'scripts/**', 'tests/**', '*.config.*'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The pure core must stay portable and unit-testable: no Electron, no Node built-ins.
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['electron', 'node:*', 'fs', 'path', '@smartspectra/*'] },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
);
