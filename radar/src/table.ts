// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Precomputed tables for the big numeric families (up to 2^24 values each).
// Each entry is one 64-bit word: the digest's first 5 bytes, then the 24-bit
// index of the preimage. The table lives on disk, sorted, and is never held in
// memory whole: it is built as sorted runs of 2^20 entries merged into one
// file, and looked up by reading it once in 8 MB slices against the sorted
// targets. Every candidate index is re-hashed to confirm the match.

import fs from 'node:fs';
import path from 'node:path';
import type { HashPool } from './brute.js';
import { type Family, familyName, familySize, preimageFiller } from './families.js';
import { sha256 } from './hash.js';

const IDX_BITS = 24n;
const IDX_MASK = (1n << IDX_BITS) - 1n;
export const MAX_TABLE = 1 << 24;
const RUN = 1 << 20; // entries per sorted run (8 MB)
const SLICE = 1 << 20; // entries per read when looking up (8 MB)
const IO = 1 << 15; // entries per merge buffer (256 KB)

function key40(h: Uint8Array): bigint {
  return BigInt(h[0] + h[1] * 2 ** 8 + h[2] * 2 ** 16 + h[3] * 2 ** 24 + h[4] * 2 ** 32);
}

/** Table words for indices [start, end). */
export function tableSlice(f: Family, start: number, end: number): BigUint64Array {
  const out = new BigUint64Array(end - start);
  const fill = preimageFiller(f);
  for (let i = start; i < end; i++) out[i - start] = (key40(sha256(fill(i))) << IDX_BITS) | BigInt(i);
  return out;
}

export function tableFile(f: Family, dir: string): string {
  return path.join(dir, `${familyName(f).replace(/[^a-z0-9<_()x-]/gi, '_').replace(/</g, 'lt')}.bin`);
}

/** Builds the family's table file in `dir` unless it is already there. */
export async function buildTable(f: Family, dir: string, opts: { pool?: HashPool; log?: (s: string) => void; runSize?: number } = {}): Promise<string> {
  const n = familySize(f);
  if (n > MAX_TABLE) throw new Error(`${familyName(f)} is larger than a table holds (${n} > 2^24)`);
  const file = tableFile(f, dir);
  if (fs.existsSync(file) && fs.statSync(file).size === n * 8) return file;
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  // 1. sorted runs
  const runs: string[] = [];
  const run = opts.runSize ?? RUN;
  for (let s = 0; s < n; s += run) {
    const e = Math.min(n, s + run);
    const words = opts.pool ? await opts.pool.table(f, s, e) : tableSlice(f, s, e);
    words.sort();
    const rf = `${file}.run${runs.length}`;
    fs.writeFileSync(rf, Buffer.from(words.buffer, words.byteOffset, words.byteLength));
    runs.push(rf);
  }
  // 2. k-way merge into the table file
  const readers = runs.map((rf) => ({ fd: fs.openSync(rf, 'r'), buf: new BigUint64Array(IO), len: 0, pos: 0, off: 0 }));
  const refill = (r: (typeof readers)[number]) => {
    const bytes = fs.readSync(r.fd, Buffer.from(r.buf.buffer), 0, IO * 8, r.off);
    r.off += bytes;
    r.len = bytes / 8;
    r.pos = 0;
  };
  readers.forEach(refill);
  const tmp = `${file}.tmp`;
  const out = fs.openSync(tmp, 'w');
  const ob = new BigUint64Array(IO);
  let on = 0;
  for (;;) {
    let best = -1;
    for (let k = 0; k < readers.length; k++) {
      const r = readers[k];
      if (r.pos >= r.len) continue;
      if (best < 0 || r.buf[r.pos] < readers[best].buf[readers[best].pos]) best = k;
    }
    if (best < 0) break;
    const r = readers[best];
    ob[on++] = r.buf[r.pos++];
    if (r.pos >= r.len) refill(r);
    if (on === IO) { fs.writeSync(out, Buffer.from(ob.buffer)); on = 0; }
  }
  if (on) fs.writeSync(out, Buffer.from(ob.buffer, 0, on * 8));
  fs.closeSync(out);
  for (const r of readers) fs.closeSync(r.fd);
  for (const rf of runs) fs.rmSync(rf);
  fs.renameSync(tmp, file);
  opts.log?.(`built table ${familyName(f)}: ${n} entries in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return file;
}

/**
 * Looks every digest up in the table file with one sequential read. Returns
 * [digest hex, index] for each confirmed match.
 */
export function lookupAll(f: Family, file: string, digests: Iterable<string>): [string, number][] {
  const want = [...digests].map((d) => ({ d, k: key40(Buffer.from(d, 'hex')) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const out: [string, number][] = [];
  if (!want.length) return out;
  const fill = preimageFiller(f);
  const fd = fs.openSync(file, 'r');
  const buf = new BigUint64Array(SLICE);
  const bytesView = Buffer.from(buf.buffer);
  let off = 0;
  let t = 0;
  try {
    for (;;) {
      const bytes = fs.readSync(fd, bytesView, 0, SLICE * 8, off);
      if (bytes <= 0) break;
      off += bytes;
      const len = bytes / 8;
      for (let i = 0; i < len && t < want.length; i++) {
        const w = buf[i];
        const k = w >> IDX_BITS;
        while (t < want.length && want[t].k < k) t++;
        // every target with this key (targets can share their first 5 bytes)
        for (let u = t; u < want.length && want[u].k === k; u++) {
          const idx = Number(w & IDX_MASK);
          if (sha256(fill(idx)).toString('hex') === want[u].d) out.push([want[u].d, idx]);
        }
      }
      if (t >= want.length) break;
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

