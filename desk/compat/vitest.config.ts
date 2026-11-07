import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { root: import.meta.dirname, include: ['*.test.ts'], testTimeout: 300_000 } });
