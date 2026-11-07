// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Starts the server over stdio the way an MCP client does and scans a contract.
//   node scripts/smoke.mjs [file.compact]            runs dist/server.js (npm run build first)
//   node scripts/smoke.mjs --src [file.compact]      runs src/server.ts with tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fromSrc = args.includes('--src');
const file = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(root, '../zoo/contracts/ballot-leaky.compact'));

const transport = fromSrc
  ? new StdioClientTransport({ command: process.execPath, args: [path.join(root, '../node_modules/tsx/dist/cli.mjs'), path.join(root, 'src/server.ts')], stderr: 'inherit' })
  : new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/server.js')], stderr: 'inherit' });
const client = new Client({ name: 'tell-smoke', version: '0.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));
const res = await client.callTool({ name: 'tell_scan', arguments: { source: fs.readFileSync(file, 'utf8') } });
console.log(res.content.map((c) => c.text).join('\n'));
await client.close();
