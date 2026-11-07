// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Radar's analysis, from chain data alone:
//  1. guessable hashes: hash small domains and look for the digests in state
//     and in call transcripts; a hit names the hidden value;
//  2. repeated hidden values: a map whose 32-byte values repeat cannot hold
//     salted commitments (random openings never collide), so its values come
//     from a small set even when the brute force does not name them;
//  3. linkable tags: the same 32-byte value in several calls of a contract
//     ties those calls together; the same value in several contracts ties them.

import { bruteForce, type Hit, Targets } from './brute.js';
import type { ContractRecord } from './chain.js';
import { describe, type Family, familyName, familySize } from './families.js';
import { type Atom, decodeCalls, decodeState, type DecodedState, isOpaque32 } from './state.js';
import { loadTable } from './table.js';
import { pairPrefixes, singlePrefixes, vocabulary } from './words.js';

export type Options = {
  /** Values per prefixed family (16 by default; 256 with --deep). */
  taggedCount?: number;
  /** Largest value tried for plain numeric hashes (2^16 without tables, 2^24 with). */
  uintMax?: number;
  /** Directory for the precomputed numeric tables; without it numeric families are hashed in memory. */
  tableDir?: string;
  deep?: boolean;
  threads?: number;
  log?: (s: string) => void;
};

export type Location = { address: string; where: 'state' | 'call'; path?: string; role?: string; txHash?: string; entryPoint?: string };
export type Recovery = { digest: string; family: string; type: string; expr: string; value: string; domain: string; locations: Location[] };
export type Cluster = { value: string; calls: number; entryPoints: string[]; constant: boolean };
export type RepeatedMap = { path: string; entries: number; distinct: number; recovered: number };
export type ContractResult = {
  address: string;
  decoded: boolean;
  entryPoints: string[];
  cells: number;
  opaque: number;
  merkleTrees: number;
  calls: number;
  recoveries: Recovery[];
  repeated: RepeatedMap[];
  clusters: Cluster[];
};
export type FamilyRun = { family: string; size: number; ms: number; hits: number };
export type Analysis = { contracts: ContractResult[]; families: FamilyRun[]; crossContract: { value: string; contracts: string[] }[]; targets: number };

type Seen = { state: DecodedState | null; calls: { txHash: string; entryPoint: string; atoms: Atom[] }[] };

function familiesFor(entryPoints: Set<string>, o: Options): { tables: Family[]; streamed: Family[] } {
  const words = vocabulary(entryPoints);
  const singles = singlePrefixes(words);
  const pairs = pairPrefixes(words);
  const count = o.taggedCount ?? (o.deep ? 256 : 16);
  const uintMax = o.uintMax ?? (o.tableDir ? 1 << 24 : 1 << 16);
  const tables: Family[] = [];
  const streamed: Family[] = [
    { kind: 'uint', width: 1, count: 256 },
    { kind: 'uint', width: 2, count: Math.min(uintMax, 1 << 16) },
    { kind: 'word', words: [...new Set([...words, ...singles, ...pairs])] },
    { kind: 'tagged', prefixes: singles, width: 32, count: 1024 },
    { kind: 'tagged', prefixes: singles, width: 1, count: 256 },
    { kind: 'tagged', prefixes: singles, width: 8, count: 1024 },
    { kind: 'tagged', prefixes: pairs, width: 32, count },
    { kind: 'tagged', prefixes: pairs, width: 1, count },
    { kind: 'taggedWord', prefixes: singles, words },
  ];
  if (o.deep) streamed.push({ kind: 'taggedWord', prefixes: pairs, words });
  for (const width of [4, 8, 16, 32] as const) {
    const f: Family = { kind: 'uint', width, count: width === 16 ? Math.min(uintMax, 1 << 20) : uintMax };
    (o.tableDir ? tables : streamed).push(f);
  }
  return { tables, streamed };
}

export async function analyze(records: ContractRecord[], o: Options = {}): Promise<Analysis> {
  const log = o.log ?? (() => {});
  const seen = new Map<string, Seen>();
  const entryPoints = new Set<string>();
  const targets = new Targets();
  const where = new Map<string, Location[]>(); // digest -> locations

  const note = (digest: string, loc: Location) => {
    targets.add(digest);
    const l = where.get(digest);
    if (!l) where.set(digest, [loc]);
    else if (l.length < 50) l.push(loc);
  };

  for (const r of records) {
    let state: DecodedState | null = null;
    try {
      state = decodeState(r.state);
    } catch {
      state = null;
    }
    const calls: Seen['calls'] = [];
    for (const a of r.actions) {
      if (a.type !== 'ContractCall') continue;
      for (const c of decodeCalls(a.raw, r.address)) calls.push({ txHash: a.txHash, entryPoint: c.entryPoint, atoms: c.atoms });
    }
    seen.set(r.address, { state, calls });
    for (const e of state?.entryPoints ?? []) entryPoints.add(e);
    for (const c of state?.cells ?? []) for (const a of c.atoms) if (isOpaque32(a)) note(a.hex, { address: r.address, where: 'state', path: c.path, role: c.role });
    for (const c of calls) for (const a of c.atoms) if (isOpaque32(a)) note(a.hex, { address: r.address, where: 'call', txHash: c.txHash, entryPoint: c.entryPoint });
  }
  log(`${records.length} contracts, ${targets.size} distinct 32-byte values to match`);

  // 1. Guessable hashes.
  const { tables, streamed } = familiesFor(entryPoints, o);
  const hits: Hit[] = [];
  const families: FamilyRun[] = [];
  for (const f of streamed) {
    const r = await bruteForce(f, targets, { threads: o.threads });
    hits.push(...r.hits);
    families.push({ family: familyName(f), size: r.hashed, ms: r.ms, hits: r.hits.length });
    log(`  ${familyName(f)}: ${r.hashed} hashed in ${(r.ms / 1000).toFixed(1)} s, ${r.hits.length} hits`);
  }
  for (const f of tables) {
    const t0 = Date.now();
    const table = await loadTable(f, o.tableDir!, { threads: o.threads, log });
    let n = 0;
    for (const list of targets.byKey.values()) for (const d of list) for (const i of table.lookup(Buffer.from(d, 'hex'))) { hits.push({ family: f, index: i, digest: d }); n++; }
    families.push({ family: familyName(f), size: familySize(f), ms: Date.now() - t0, hits: n });
    log(`  ${familyName(f)} (table): ${n} hits`);
  }

  const recoveries = new Map<string, Recovery>();
  for (const h of hits) {
    if (recoveries.has(h.digest)) continue; // the first (simplest) family wins
    const d = describe(h.family, h.index);
    recoveries.set(h.digest, { digest: h.digest, family: familyName(h.family), ...d, locations: where.get(h.digest) ?? [] });
  }

  // 3b. Values shared between contracts.
  const owners = new Map<string, Set<string>>();
  for (const [digest, locs] of where) {
    const s = new Set(locs.map((l) => l.address));
    if (s.size > 1 && !recoveries.has(digest)) owners.set(digest, s);
  }

  const contracts: ContractResult[] = [];
  for (const r of records) {
    const s = seen.get(r.address)!;
    const mine = [...recoveries.values()].filter((rec) => rec.locations.some((l) => l.address === r.address));
    // 2. Repeated hidden values.
    const repeated: RepeatedMap[] = [];
    for (const m of s.state?.maps ?? []) {
      if (m.valueDigests.length < 3) continue;
      const distinct = new Set(m.valueDigests).size;
      if (distinct < m.valueDigests.length) repeated.push({ path: m.path, entries: m.valueDigests.length, distinct, recovered: m.valueDigests.filter((d) => recoveries.has(d)).length });
    }
    // 3. Linkable tags across this contract's calls.
    const byValue = new Map<string, { txs: Set<string>; eps: Set<string> }>();
    const txs = new Set(s.calls.map((c) => c.txHash));
    for (const c of s.calls) for (const a of c.atoms) {
      if (!isOpaque32(a) || recoveries.has(a.hex)) continue;
      const e = byValue.get(a.hex) ?? { txs: new Set(), eps: new Set() };
      e.txs.add(c.txHash);
      e.eps.add(c.entryPoint);
      byValue.set(a.hex, e);
    }
    const clusters: Cluster[] = [];
    for (const [value, e] of byValue) {
      if (e.txs.size < 2) continue;
      clusters.push({ value, calls: e.txs.size, entryPoints: [...e.eps].sort(), constant: txs.size >= 3 && e.txs.size >= 0.8 * txs.size });
    }
    clusters.sort((a, b) => b.calls - a.calls);
    contracts.push({
      address: r.address,
      decoded: !!s.state,
      entryPoints: s.state?.entryPoints ?? [],
      cells: s.state?.cells.length ?? 0,
      opaque: s.state?.cells.reduce((n, c) => n + c.atoms.filter(isOpaque32).length, 0) ?? 0,
      merkleTrees: s.state?.merkleTrees ?? 0,
      calls: txs.size,
      recoveries: mine,
      repeated,
      clusters,
    });
  }
  return { contracts, families, crossContract: [...owners].map(([value, s]) => ({ value, contracts: [...s] })), targets: targets.size };
}
