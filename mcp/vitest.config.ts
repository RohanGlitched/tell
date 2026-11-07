import { defineConfig } from 'vitest/config';
// Each scan runs the Compact compiler; give them room.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 } });
