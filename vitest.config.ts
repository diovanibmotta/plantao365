import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.test.{ts,tsx}',
      'packages/**/*.test.{ts,tsx}',
      'plugins/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Os testes de banco usam bancos temporários próprios; o migrator.test usa TEST_DATABASE_URL direto.
    fileParallelism: false,
  },
});
