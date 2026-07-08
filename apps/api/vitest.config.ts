import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Tests de integración usan el Postgres de Docker (5434); sin paralelismo
    // entre archivos para evitar choques en las tablas compartidas.
    fileParallelism: false,
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
