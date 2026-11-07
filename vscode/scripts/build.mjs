// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Bundles the extension with the Tell engine into dist/extension.cjs, so the
// .vsix needs no node_modules and runs wherever the extension host runs.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: [path.join(root, 'src/extension.ts')],
  outfile: path.join(root, 'dist/extension.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  legalComments: 'inline',
  logLevel: 'warning',
});
console.log('built vscode/dist/extension.cjs');
