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

import { bruteForce, HashPool, type Hit, Targets } from './brute.js';
import type { ContractRecord } from './chain.js';
import { describe, type Family, familyName, familySize } from './families.js';
import { type Atom, decodeCalls, decodeState, type DecodedState, isOpaque32 } from './state.js';
import { defaultThreads } from './hash.js';
import { buildTable, lookupAll } from './table.js';
import { numericTables } from './tables.js';
import { COMMON_WORDS, ownWords, pairPrefixes, singlePrefixes, vocabulary } from './words.js';

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
  /** Every map whose values are single 32-byte digests: size and distinct values. */
  valueMaps: { path: string; entries: number; distinct: number }[];
  clusters: Cluster[];
};
export type FamilyRun = { family: string; size: number; ms: number; hits: number };
export type Analysis = { contracts: ContractResult[]; families: FamilyRun[]; crossContract: { value: string; contracts: string[] }[]; targets: number };

/** A contract reduced to what the analysis needs; raw transactions are dropped. */
export type Digested = { address: string; state: DecodedState | null; calls: { txHash: string; entryPoint: string; atoms: Atom[] }[] };

export function digest(r: ContractRecord): Digested {
  let state: DecodedState | null = null;
  try {
    state = decodeState(r.state);
  } catch {
    state = null;
  }
  const calls: Digested['calls'] = [];
  for (const a of r.actions) {
    if (a.type !== 'ContractCall') continue;
    // keep only digest-like atoms: everything else is ignored downstream
    for (const c of decodeCalls(a.raw, r.address)) calls.push({ txHash: a.txHash, entryPoint: c.entryPoint, atoms: c.atoms.filter(isOpaque32) });
  }
  if (state) state = { ...state, cells: state.cells.map((c) => ({ ...c, atoms: c.atoms.filter(isOpaque32) })) };
  return { address: r.address, state, calls };
}

/**
 * The families to hash. Single words come from the common list and every contract's
 * entry-point names. Two-word prefixes are the common list squared, plus, for each
 * contract, the pairs that use one of its own words (not every contract's words with
 * every other's, which would grow as the square of the whole chain's vocabulary).
 */
function familiesFor(records: Digested[], o: Options): { tables: Family[]; streamed: Family[]; pairChunks: () => Generator<string[]>; count: number } {
  const all = new Set<string>();
  for (const r of records) for (const e of r.state?.entryPoints ?? []) all.add(e);
  const words = vocabulary(all);
  const singles = singlePrefixes(words);
  const count = o.taggedCount ?? (o.deep ? 256 : 16);
  const uintMax = o.uintMax ?? (o.tableDir ? 1 << 24 : 1 << 16);
  const tables: Family[] = [];
  const streamed: Family[] = [
    { kind: 'uint', width: 1, count: 256 },
    { kind: 'uint', width: 2, count: Math.min(uintMax, 1 << 16) },
    { kind: 'word', words: [...new Set([...words, ...singles])] },
    { kind: 'tagged', prefixes: singles, width: 32, count: 1024 },
    { kind: 'tagged', prefixes: singles, width: 1, count: 256 },
    { kind: 'tagged', prefixes: singles, width: 8, count: 1024 },
    { kind: 'taggedWord', prefixes: singles, words },
  ];
  if (o.deep) streamed.push({ kind: 'taggedWord', prefixes: pairPrefixes(COMMON_WORDS), words: COMMON_WORDS });
  for (const f of numericTables(uintMax)) (o.tableDir ? tables : streamed).push(f);
  // Two-word prefixes are produced in bounded chunks so memory stays flat however many
  // contracts there are. Contracts with the same own words share one group.
  const groups = [...new Set(records.map((r) => ownWords(r.state?.entryPoints ?? []).join(' ')).filter(Boolean))];
  function* pairChunks(): Generator<string[]> {
    const size = 200_000;
    let chunk: string[] = [];
    const sources = [() => pairPrefixes(COMMON_WORDS), ...groups.map((g) => () => pairPrefixes(COMMON_WORDS, g.split(' ')))];
    for (const src of sources) {
      for (const p of src()) {
        chunk.push(p);
        if (chunk.length >= size) { yield chunk; chunk = []; }
      }
    }
    if (chunk.length) yield chunk;
  }
  return { tables, streamed, pairChunks, count };
}

/** A hit's family narrowed to the one prefix it used, so a chunk is not kept alive by it. */
function narrow(h: Hit): Hit {
  const f = h.family;
  if (f.kind === 'tagged') return { ...h, family: { ...f, prefixes: [f.prefixes[Math.floor(h.index / f.count)]] }, index: h.index % f.count };
  if (f.kind === 'word') return { ...h, family: { kind: 'word', words: [f.words[h.index]] }, index: 0 };
  if (f.kind === 'taggedWord') {
    const n = f.words.length;
    return { ...h, family: { ...f, prefixes: [f.prefixes[Math.floor(h.index / n)]], words: [f.words[h.index % n]] }, index: 0 };
  }
  return h;
}

/** Stops the run before it crowds a shared machine: RADAR_MAX_RSS_MB, 1500 by default. */
function guardMemory() {
  const limit = Number(process.env.RADAR_MAX_RSS_MB) || 1500;
  const rss = process.memoryUsage().rss / 1e6;
  if (rss > limit) throw new Error(`memory use ${Math.round(rss)} MB is over RADAR_MAX_RSS_MB=${limit}; stopping`);
}

export async function analyze(records: Digested[], o: Options = {}): Promise<Analysis> {
  const log = o.log ?? (() => {});
  const seen = new Map<string, Digested>();
  const targets = new Targets();
  const where = new Map<string, Location[]>(); // digest -> locations

  const note = (digest: string, loc: Location) => {
    targets.add(digest);
    const l = where.get(digest);
    if (!l) where.set(digest, [loc]);
    else if (l.length < 50) l.push(loc);
  };

  for (const r of records) {
    const { state, calls } = r;
    seen.set(r.address, r);
    for (const c of state?.cells ?? []) for (const a of c.atoms) if (isOpaque32(a)) note(a.hex, { address: r.address, where: 'state', path: c.path, role: c.role });
    for (const c of calls) for (const a of c.atoms) if (isOpaque32(a)) note(a.hex, { address: r.address, where: 'call', txHash: c.txHash, entryPoint: c.entryPoint });
  }
  log(`${records.length} contracts, ${targets.size} distinct 32-byte values to match (rss ${Math.round(process.memoryUsage().rss / 1e6)} MB)`);

  // 1. Guessable hashes.
  const { tables, streamed, pairChunks, count } = familiesFor(records, o);
  const hits: Hit[] = [];
  const families: FamilyRun[] = [];
  const pool = new HashPool(targets.keys(), o.threads ?? defaultThreads());
  try {
  for (const f of streamed) {
    const r = await bruteForce(f, targets, { pool });
    hits.push(...r.hits.map(narrow));
    families.push({ family: familyName(f), size: r.hashed, ms: r.ms, hits: r.hits.length });
    log(`  ${familyName(f)}: ${r.hashed} hashed in ${(r.ms / 1000).toFixed(1)} s, ${r.hits.length} hits`);
    guardMemory();
  }
  const pairRuns: Record<string, FamilyRun> = {};
  let prefixes = 0;
  for (const chunk of pairChunks()) {
    prefixes += chunk.length;
    const fams: [string, Family][] = [
      [`pairWord`, { kind: 'word', words: chunk }],
      [`pairTagged256x${count}`, { kind: 'tagged', prefixes: chunk, width: 32, count }],
      [`pairTagged8x${count}`, { kind: 'tagged', prefixes: chunk, width: 1, count }],
    ];
    for (const [name, f] of fams) {
      const r = await bruteForce(f, targets, { pool });
      hits.push(...r.hits.map(narrow));
      const run = (pairRuns[name] ??= { family: name, size: 0, ms: 0, hits: 0 });
      run.size += r.hashed;
      run.ms += r.ms;
      run.hits += r.hits.length;
    }
    guardMemory();
    log(`  two-word prefixes: ${prefixes} so far (rss ${Math.round(process.memoryUsage().rss / 1e6)} MB)`);
  }
  for (const run of Object.values(pairRuns)) {
    families.push({ ...run, family: `${run.family}(${prefixes} prefixes)` });
    log(`  ${run.family}: ${run.size} hashed in ${(run.ms / 1000).toFixed(1)} s, ${run.hits} hits`);
  }
  const all = [...targets.byKey.values()].flat();
  for (const f of tables) {
    const t0 = Date.now();
    const file = await buildTable(f, o.tableDir!, { pool, log });
    const found = lookupAll(f, file, all);
    for (const [d, i] of found) hits.push({ family: f, index: i, digest: d });
    families.push({ family: familyName(f), size: familySize(f), ms: Date.now() - t0, hits: found.length });
    guardMemory();
    log(`  ${familyName(f)} (table): ${found.length} hits (rss ${Math.round(process.memoryUsage().rss / 1e6)} MB)`);
  }
  } finally {
    await pool.close();
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
    const valueMaps = (s.state?.maps ?? []).filter((m) => m.valueDigests.length).map((m) => ({ path: m.path, entries: m.valueDigests.length, distinct: new Set(m.valueDigests).size }));
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
      valueMaps,
      clusters,
    });
  }
  return { contracts, families, crossContract: [...owners].map(([value, s]) => ({ value, contracts: [...s] })), targets: targets.size };
}
