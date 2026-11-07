// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Bundles the server with the Tell engine into dist/, so the published package
// needs only the MCP SDK and zod at runtime.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: { server: path.join(root, 'src/server.ts'), index: path.join(root, 'src/index.ts') },
  outdir: path.join(root, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['@modelcontextprotocol/sdk', 'zod'],
  legalComments: 'inline',
  logLevel: 'warning',
});
fs.chmodSync(path.join(root, 'dist/server.js'), 0o755);
console.log('built mcp/dist (server.js, index.js)');
