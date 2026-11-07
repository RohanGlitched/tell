// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Brute force: hash every preimage of a family and look the digest up among
// the 32-byte values seen on chain. Large families are split across worker
// threads. Each hit is checked in full (not just the 6-byte key).

import { Worker } from 'node:worker_threads';
import { type Family, familySize, preimage } from './families.js';
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
  keys(): number[] { return [...this.byKey.keys()]; }
  static fromKeys(keys: number[]): Set<number> { return new Set(keys); }
}

/** Indices in [start, end) whose digest's 6-byte key is in `keys`. */
export function scanRange(f: Family, start: number, end: number, keys: Set<number>): number[] {
  const out: number[] = [];
  for (let i = start; i < end; i++) if (keys.has(key48(sha256(preimage(f, i))))) out.push(i);
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

export async function bruteForce(f: Family, targets: Targets, opts: { threads?: number } = {}): Promise<{ hits: Hit[]; hashed: number; ms: number }> {
  const n = familySize(f);
  const t0 = Date.now();
  const threads = Math.max(1, Math.min(opts.threads ?? defaultThreads(), Math.ceil(n / 200_000)));
  let candidates: number[];
  if (threads === 1) {
    candidates = scanRange(f, 0, n, new Set(targets.keys()));
  } else {
    const keys = targets.keys();
    const step = Math.ceil(n / threads);
    const parts = await Promise.all(
      Array.from({ length: threads }, (_, t) =>
        new Promise<number[]>((resolve, reject) => {
          const w = new Worker(WORKER_SOURCE, { execArgv: ['--import', 'tsx'], workerData: { family: f, start: t * step, end: Math.min(n, (t + 1) * step), keys } });
          w.once('message', (m: number[]) => { resolve(m); void w.terminate(); });
          w.once('error', reject);
        }),
      ),
    );
    candidates = parts.flat();
  }
  return { hits: confirm(f, candidates, targets), hashed: n, ms: Date.now() - t0 };
}
