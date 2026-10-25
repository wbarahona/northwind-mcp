import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Type-aware ESLint config for Node/TypeScript workspaces.
 *
 * @param {{ tsconfigRootDir: string }} options pass `import.meta.dirname` from the consuming eslint.config.js
 */
export function nodeConfig({ tsconfigRootDir }) {
  return defineConfig(
    { ignores: ['dist/**', 'coverage/**', 'eslint.config.*'] },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node, ...globals.jest },
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      // Tests assert on untyped HTTP bodies (supertest's `res.body` is `any`), and fakes
      // implement async interfaces without having anything to await.
      files: [
        '**/*.spec.ts',
        '**/*.e2e-spec.ts',
        '**/*.test.{ts,tsx}',
        'test/**/*.ts',
      ],
      rules: {
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
      },
    },
    {
      // Plain JS config/tooling files are not part of any tsconfig.
      files: ['**/*.{js,cjs,mjs}'],
      extends: [tseslint.configs.disableTypeChecked],
    },
    {
      files: ['**/*.cjs'],
      languageOptions: { sourceType: 'commonjs' },
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    // Must stay last: turns off rules that conflict with Prettier.
    prettier,
  );
}

/**
 * Type-aware ESLint config for a React app in the browser (Vite): browser globals and the
 * React Hooks rules on top of the shared TypeScript rules.
 *
 * @param {{ tsconfigRootDir: string }} options pass `import.meta.dirname` from the consuming eslint.config.js
 */
export function reactConfig({ tsconfigRootDir }) {
  return defineConfig(
    ...nodeConfig({ tsconfigRootDir }),
    {
      files: ['src/**/*.{ts,tsx}'],
      languageOptions: { globals: { ...globals.browser } },
    },
    reactHooks.configs.flat['recommended-latest'] ??
      reactHooks.configs.flat.recommended,
  );
}
