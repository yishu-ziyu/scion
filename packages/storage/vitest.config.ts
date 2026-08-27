import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@extension/context-engine': fileURLToPath(new URL('../context-engine/index.ts', import.meta.url)),
      '@extension/wisebase-core': fileURLToPath(new URL('../wisebase-core/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
