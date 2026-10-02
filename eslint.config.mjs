// The linter, taken from ConnectOtherAIs' `src_vs_code/eslint.config.mjs` (2026-10-02) and cut to what a
// new package needs: no suppressions file, because there is no old code to forgive.
//
// Type-aware on purpose: `no-floating-promises` is the rule that cannot be had from a syntax-only config.
// `typescript-eslint` accepts `typescript >=4.8.4 <6.1.0`, which is why `typescript` is pinned to 6.0.3
// exactly — TypeScript 7 refuses to install beside the parser and refuses at run time too.
//
// `complexity: 4` and `max-lines-per-function: 50` hold `src/**`; `src/test/**` is exempt because a test
// narrates one scenario end to end. `linebreak-style: unix` because the suite runs on Windows too and a
// byte-compat test must see the same bytes on both.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', '.agents/**'],
  },
  {
    // A disable that has stopped being needed is an exemption nobody granted.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'linebreak-style': ['error', 'unix'],
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // `node:test`'s `test`/`describe` return a promise BY DESIGN and are not meant to be awaited.
      '@typescript-eslint/no-floating-promises': ['error', {
        allowForKnownSafeCalls: [
          {
            from: 'package',
            package: 'node:test',
            name: ['test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach'],
          },
        ],
      }],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      'max-lines': ['error', { max: 800, skipBlankLines: false, skipComments: false }],
      complexity: ['error', 4],
      'max-lines-per-function': ['error', 50],
    },
  },
  {
    files: ['src/test/**/*.ts'],
    rules: {
      'max-lines': 'off',
      complexity: 'off',
      'max-lines-per-function': 'off',
    },
  },
  {
    // The `.mjs` scripts and this file are node scripts outside the TypeScript program.
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
