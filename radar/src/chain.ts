// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// What Radar reads from the indexer: which contracts acted in a block range,
// whether an address is a contract, and a contract's state and recent calls.

import fs from 'node:fs';
import path from 'node:path';
import { BudgetExceeded, type Indexer } from './indexer.js';

export type ContractAction = { type: 'ContractDeploy' | 'ContractCall' | 'ContractUpdate'; entryPoint?: string; txHash: string; height: number; raw: string };
export type ContractRecord = { address: string; state: string; stateHeight: number; actions: ContractAction[] };

const HEX64 = /^[0-9a-f]{64}$/;

export async function tip(ix: Indexer): Promise<number> {
  const d = await ix.query<{ block: { height: number } }>('{ block { height } }', { cache: false });
  return d.block.height;
}

/** Blocks per request: the most the indexer's complexity limit allows for this shape. */
export const BLOCKS_PER_REQUEST = 50;

export type CrawlState = { network: string; done: [number, number][]; contracts: Record<string, { first: number; last: number; actions: number }> };

function addRange(done: [number, number][], a: number, b: number): [number, number][] {
  const all = [...done, [a, b] as [number, number]].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const r of all) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function loadCrawl(file: string, network: string): CrawlState {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) as CrawlState;
  return { network, done: [], contracts: {} };
}

/** Walks blocks [from, to] newest first, recording every contract that acted. Resumable. */
export async function crawl(ix: Indexer, file: string, from: number, to: number, log: (s: string) => void): Promise<CrawlState> {
  const st = loadCrawl(file, ix.network);
  const isDone = (h: number) => st.done.some(([a, b]) => h >= a && h <= b);
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(st));
  };
  let batches = 0;
  for (let hi = to; hi >= from; hi -= BLOCKS_PER_REQUEST) {
    const lo = Math.max(from, hi - BLOCKS_PER_REQUEST + 1);
    if (isDone(lo) && isDone(hi)) continue;
    let q = '{';
    for (let h = lo; h <= hi; h++) q += ` b${h}: block(offset: {height: ${h}}) { transactions { contractActions { address } } }`;
    q += ' }';
    let d: Record<string, { transactions: { contractActions: { address: string }[] }[] } | null>;
    try {
      d = await ix.query(q);
    } catch (e) {
      if (e instanceof BudgetExceeded) { log(`stopped at height ${hi}: ${e.message}`); break; }
      throw e;
    }
    for (const [k, b] of Object.entries(d)) {
      const h = Number(k.slice(1));
      for (const t of b?.transactions ?? []) for (const a of t.contractActions) {
        const c = (st.contracts[a.address] ??= { first: h, last: h, actions: 0 });
        c.first = Math.min(c.first, h);
        c.last = Math.max(c.last, h);
        c.actions++;
      }
    }
    st.done = addRange(st.done, lo, hi);
    if (++batches % 100 === 0) { save(); log(`crawled down to ${lo}: ${Object.keys(st.contracts).length} contracts, ${ix.sent} requests`); }
  }
  save();
  return st;
}

/** Which of these 64-hex strings are contracts on this network (one request per 40). */
export async function verifyAddresses(ix: Indexer, candidates: string[]): Promise<string[]> {
  const uniq = [...new Set(candidates.map((c) => c.toLowerCase()).filter((c) => HEX64.test(c)))];
  const found: string[] = [];
  for (let i = 0; i < uniq.length; i += 40) {
    const part = uniq.slice(i, i + 40);
    const q = `{ ${part.map((a, j) => `c${j}: contract(address: "${a}") { address }`).join(' ')} }`;
    let d: Record<string, { address: string } | null>;
    try {
      d = await ix.query(q);
    } catch (e) {
      if (e instanceof BudgetExceeded) break;
      // One malformed address fails the batch: fall back to one by one.
      d = {};
      for (const [j, a] of part.entries()) {
        try {
          const r = await ix.query<{ c: { address: string } | null }>(`{ c: contract(address: "${a}") { address } }`);
          d[`c${j}`] = r.c;
        } catch (e2) {
          if (e2 instanceof BudgetExceeded) break;
        }
      }
    }
    for (const v of Object.values(d)) if (v?.address) found.push(v.address);
  }
  return found;
}

/** Current state and up to `limit` most recent actions with their raw transactions. */
export async function fetchContract(ix: Indexer, address: string, limit: number): Promise<ContractRecord | null> {
  const q = `{ contract(address: "${address}") { address state stateAt { height } actions(limit: ${limit}) { __typename ... on ContractCall { entryPoint } transaction { hash raw block { height } } } } }`;
  const d = await ix.query<{ contract: null | { address: string; state: string; stateAt: { height: number }; actions: { __typename: ContractAction['type']; entryPoint?: string; transaction: { hash: string; raw: string; block: { height: number } } }[] } }>(q);
  const c = d.contract;
  if (!c) return null;
  return {
    address: c.address,
    state: c.state,
    stateHeight: c.stateAt.height,
    actions: c.actions.map((a) => ({ type: a.__typename, entryPoint: a.entryPoint, txHash: a.transaction.hash, height: a.transaction.block.height, raw: a.transaction.raw })),
  };
}

/** 64-hex strings in text files under `dir` (deployment files, READMEs, configs). */
export function harvestCandidates(dir: string): string[] {
  const out = new Set<string>();
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'managed', 'keys', 'zkir']);
  const re = /(?<![0-9a-fA-Fx])([0-9a-f]{64})(?![0-9a-fA-F])/g;
  const walk = (d: string) => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(p); continue; }
      if (!e.isFile() || /lock|\.(wasm|map|zkir|prover|verifier|png|jpg|gif|ico|woff2?|pdf|mp4)$/i.test(e.name)) continue;
      let s: string;
      try {
        if (fs.statSync(p).size > 2_000_000) continue;
        s = fs.readFileSync(p, 'utf8');
      } catch { continue; }
      for (const m of s.matchAll(re)) out.add(m[1]);
    }
  };
  walk(dir);
  return [...out];
}
