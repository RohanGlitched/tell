// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// One slice of a brute-force run or of a table build, in a worker thread.

import { parentPort, workerData } from 'node:worker_threads';
import { scanRange } from './brute.js';
import type { Family } from './families.js';
import { tableSlice } from './table.js';

const d = workerData as { mode?: 'table'; family: Family; start: number; end: number; keys?: number[]; shared?: SharedArrayBuffer };
if (d.mode === 'table') {
  tableSlice(d.family, d.start, d.end, new BigUint64Array(d.shared!));
  parentPort!.postMessage(true);
} else {
  parentPort!.postMessage(scanRange(d.family, d.start, d.end, new Set(d.keys)));
}
