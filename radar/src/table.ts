// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Precomputed tables for the big numeric families (up to 2^24 values each).
// Each entry is one 64-bit word: the digest's first 5 bytes, then the 24-bit
// index of the preimage. Sorted and written to disk once, a table answers a
// lookup by binary search; the index is then re-hashed to confirm the match.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { type Family, familyName, familySize, preimage } from './families.js';
import { sha256 } from './hash.js';

const IDX_BITS = 24n;
export const MAX_TABLE = 1 << 24;

function key40(h: Uint8Array): bigint {
  return BigInt(h[0] + h[1] * 2 ** 8 + h[2] * 2 ** 16 + h[3] * 2 ** 24 + h[4] * 2 ** 32);
}

export function tableSlice(f: Family, start: number, end: number): BigUint64Array {
  const out = new BigUint64Array(end - start);
  for (let i = start; i < end; i++) out[i - start] = (key40(sha256(preimage(f, i))) << IDX_BITS) | BigInt(i);
  return out;
}

export class Table {
  constructor(readonly family: Family, readonly words: BigUint64Array) {}

  /** Indices whose digest equals `digest` (full 32-byte check). */
  lookup(digest: Buffer): number[] {
    const k = key40(digest);
    const lo = k << IDX_BITS;
    const w = this.words;
    let a = 0;
    let b = w.length;
    while (a < b) {
      const m = (a + b) >>> 1;
      if (w[m] < lo) a = m + 1;
      else b = m;
    }
    const out: number[] = [];
    for (let i = a; i < w.length && w[i] >> IDX_BITS === k; i++) {
      const idx = Number(w[i] & ((1n << IDX_BITS) - 1n));
      if (sha256(preimage(this.family, idx)).equals(digest)) out.push(idx);
    }
    return out;
  }
}

const WORKER_SOURCE = new URL('./brute-worker.ts', import.meta.url);

/** Loads the family's table from `dir`, building and saving it first if needed. */
export async function loadTable(f: Family, dir: string, opts: { threads?: number; log?: (s: string) => void } = {}): Promise<Table> {
  const n = familySize(f);
  if (n > MAX_TABLE) throw new Error(`${familyName(f)} is larger than a table holds (${n} > 2^24)`);
  const file = path.join(dir, `${familyName(f).replace(/[^a-z0-9<_()x-]/gi, '_').replace(/</g, 'lt')}.bin`);
  if (fs.existsSync(file) && fs.statSync(file).size === n * 8) {
    const buf = fs.readFileSync(file);
    return new Table(f, new BigUint64Array(buf.buffer, buf.byteOffset, n));
  }
  const t0 = Date.now();
  const threads = Math.max(1, Math.min(opts.threads ?? os.cpus().length - 1, Math.ceil(n / 100_000)));
  let words: BigUint64Array;
  if (threads === 1) words = tableSlice(f, 0, n);
  else {
    const step = Math.ceil(n / threads);
    const parts = await Promise.all(
      Array.from({ length: threads }, (_, t) =>
        new Promise<BigUint64Array>((resolve, reject) => {
          const w = new Worker(WORKER_SOURCE, { execArgv: ['--import', 'tsx'], workerData: { mode: 'table', family: f, start: t * step, end: Math.min(n, (t + 1) * step) } });
          w.once('message', (m: BigUint64Array) => { resolve(m); void w.terminate(); });
          w.once('error', reject);
        }),
      ),
    );
    words = new BigUint64Array(n);
    let o = 0;
    for (const p of parts) { words.set(p, o); o += p.length; }
  }
  words.sort();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, Buffer.from(words.buffer, words.byteOffset, words.byteLength));
  opts.log?.(`built table ${familyName(f)}: ${n} entries in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return new Table(f, words);
}
