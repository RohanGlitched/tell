// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Brute force: hash every preimage of a family and look the digest up among
// the 32-byte values seen on chain. Large families are split across a fixed
// pool of worker threads, started once per run (the target keys are sent to
// each worker once). Each hit is checked in full, not just by its 6-byte key.

import { Worker } from 'node:worker_threads';
import { type Family, familySize, preimage, preimageFiller } from './families.js';
import { defaultThreads, key48, sha256 } from './hash.js';

export type Hit = { family: Family; index: number; digest: string };

/** The values to look for, keyed by their first 6 bytes. */
export class Targets {
  readonly byKey = new Map<number, string[]>();
  add(hex32: string) {
    const k = key48(Buffer.from(hex32, 'hex'));
    const list = this.byKey.get(k);
    if (!list) this.byKey.set(k, [hex32]);
    else if (!list.includes(hex32)) list.push(hex32);
  }
  get size() { return this.byKey.size; }
  keys(): Float64Array { return Float64Array.from(this.byKey.keys()); }
}

/** Indices in [start, end) whose digest's 6-byte key is in `keys`. */
export function scanRange(f: Family, start: number, end: number, keys: Set<number>): number[] {
  const out: number[] = [];
  const fill = preimageFiller(f);
  for (let i = start; i < end; i++) if (keys.has(key48(sha256(fill(i))))) out.push(i);
  return out;
}

function confirm(f: Family, candidates: number[], targets: Targets): Hit[] {
  const hits: Hit[] = [];
  for (const i of candidates) {
    const d = sha256(preimage(f, i));
    const list = targets.byKey.get(key48(d));
    const hx = d.toString('hex');
    if (list?.includes(hx)) hits.push({ family: f, index: i, digest: hx });
  }
  return hits;
}

const WORKER_SOURCE = new URL('./brute-worker.ts', import.meta.url);

/** A fixed set of hashing threads, each holding the target keys. */
export class HashPool {
  private readonly workers: Worker[];
  private next = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly waiting = new Map<number, { resolve: (v: any) => void; reject: (e: unknown) => void }>();

  constructor(keys: Float64Array, readonly size = defaultThreads()) {
    this.workers = Array.from({ length: size }, () => {
      const w = new Worker(WORKER_SOURCE, { execArgv: ['--import', 'tsx'], workerData: { keys }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
      w.on('message', (m: { id: number; out: unknown }) => {
        const p = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        p?.resolve(m.out);
      });
      w.on('error', (e) => { for (const p of this.waiting.values()) p.reject(e); this.waiting.clear(); });
      return w;
    });
  }

  private run<T>(w: Worker, mode: 'scan' | 'table', family: Family, start: number, end: number): Promise<T> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      w.postMessage({ id, mode, family, start, end });
    });
  }

  /** Table words for [start, end), computed across the pool. */
  async table(f: Family, start: number, end: number): Promise<BigUint64Array> {
    const step = Math.ceil((end - start) / this.size);
    const parts = await Promise.all(
      this.workers.map((w, t) => {
        const a = start + t * step;
        const b = Math.min(end, a + step);
        return a < b ? this.run<BigUint64Array>(w, 'table', f, a, b) : Promise.resolve(new BigUint64Array(0));
      }),
    );
    const out = new BigUint64Array(end - start);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  async scan(f: Family): Promise<number[]> {
    const n = familySize(f);
    const step = Math.ceil(n / this.size);
    const parts = await Promise.all(this.workers.map((w, t) => (t * step < n ? this.run<number[]>(w, 'scan', f, t * step, Math.min(n, (t + 1) * step)) : Promise.resolve([] as number[]))));
    return parts.flat();
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

export async function bruteForce(f: Family, targets: Targets, opts: { pool?: HashPool } = {}): Promise<{ hits: Hit[]; hashed: number; ms: number }> {
  const n = familySize(f);
  const t0 = Date.now();
  const candidates = opts.pool && n > 200_000 ? await opts.pool.scan(f) : scanRange(f, 0, n, new Set(targets.keys()));
  return { hits: confirm(f, candidates, targets), hashed: n, ms: Date.now() - t0 };
}
