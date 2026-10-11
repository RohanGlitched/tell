import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: { '/api/scan': ['./bin/**/*'] },
  serverExternalPackages: ['tar'],
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
