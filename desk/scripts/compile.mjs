// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Compiles Tell Desk into managed/desk (circuits only, for the simulator and tests).
//   --keys          also build proving keys, into keys/desk (what a deploy needs)
//   --compiler X    use compiler X instead of 0.31.1 (the ledger live today)
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const keys = process.argv.includes('--keys');
const at = process.argv.indexOf('--compiler');
const compiler = at > 0 ? process.argv[at + 1] : '0.31.1';
const out = path.resolve(keys ? 'keys' : 'managed', 'desk');
const args = ['compile', `+${compiler}`, ...(keys ? [] : ['--skip-zk']), path.resolve('contracts/desk.compact'), out];
process.stdout.write(`compact ${compiler} desk → ${path.relative(process.cwd(), out)}… `);
execFileSync('compact', args, { stdio: ['ignore', 'ignore', 'inherit'] });
console.log('ok');
