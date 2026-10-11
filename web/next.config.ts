import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: { '/api/scan': ['./bin/**/*'], '/api/live': ['./node_modules/@midnight-ntwrk/**/*.wasm', '../node_modules/@midnight-ntwrk/**/*.wasm'] },
  // Midnight's runtimes load .wasm files next to their JS: keep them as real node_modules.
  serverExternalPackages: [
    'tar',
    '@midnight-ntwrk/compact-runtime',
    '@midnight-ntwrk/onchain-runtime-v3',
    '@midnight-ntwrk/ledger-v8',
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider',
    '@midnight-ntwrk/midnight-js-network-id',
  ],
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    cfg.resolve.alias = { ...(cfg.resolve.alias ?? {}), '@tell/engine': path.join(__dirname, 'vendor/engine/index.ts') };
    return cfg;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
export default config;
