import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-types/**', '**/node_modules/**', '.ai/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', '*.config.{js,ts}', 'apps/web/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
