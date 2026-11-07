#!/usr/bin/env node
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell MCP server over stdio:  npx tsx mcp/src/server.ts
// Environment: TELL_COMPILERS (directories holding compactc.bin), TELL_PREFERRED_COMPILER,
// TELL_TMPDIR (where source text is written for a scan; default the OS temp directory).

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './mcp.js';

const server = createServer();
await server.connect(new StdioServerTransport());
// stdout carries the protocol; anything human goes to stderr.
console.error('tell MCP server ready on stdio');
