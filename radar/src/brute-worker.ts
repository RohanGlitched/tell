// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// A hashing thread in the pool: it keeps the target keys and answers one job at a time.

import { parentPort, workerData } from 'node:worker_threads';
import { scanRange } from './brute.js';
import type { Family } from './families.js';
import { tableSlice } from './table.js';

const keys = new Set<number>((workerData as { keys: Float64Array }).keys);
parentPort!.on('message', (m: { id: number; mode: 'scan' | 'table'; family: Family; start: number; end: number }) => {
  if (m.mode === 'table') {
    const out = tableSlice(m.family, m.start, m.end);
    parentPort!.postMessage({ id: m.id, out }, [out.buffer as ArrayBuffer]);
  } else {
    parentPort!.postMessage({ id: m.id, out: scanRange(m.family, m.start, m.end, keys) });
  }
});
