// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Two outputs. The aggregate report has counts only: no addresses, values or
// transaction hashes, except for contracts listed as "own" (Tell's demo
// ballots), so it can be published. The detailed report names contracts and
// recovered values; it is for writing privately to the teams concerned.

import type { Analysis, ContractResult } from './analyze.js';

export type Own = Record<string, string>; // address -> label, contracts we may name

export type Aggregate = {
  network: string;
  generatedAt: string;
  source: Record<string, unknown>;
  contracts: { scanned: number; decoded: number; withCells: number; withCalls: number; cells: number; opaqueValues: number; calls: number; merkleTrees: number };
  guessableHashes: { valuesRecovered: number; contracts: number; byType: Record<string, number>; byDomain: Record<string, number>; inState: number; inCallsOnly: number };
  repeatedHiddenValues: { contracts: number; maps: number; entries: number };
  linkableTags: { contracts: number; clusters: number; constantClusters: number; largestCluster: number; contractsAllCallsLinked: number };
  crossContract: { values: number; contractsInvolved: number };
  bruteForce: { families: { family: string; size: number; seconds: number; hits: number }[]; hashed: number; distinctTargets: number };
  own: Record<string, OwnResult>;
};

export type OwnResult = { address: string; entries: number; recovered: number; values: Record<string, number>; repeated: { entries: number; distinct: number } | null; clusters: number };

function ownResult(c: ContractResult): OwnResult {
  // The largest map of 32-byte values is the one a ballot keeps its votes in.
  const rep = c.repeated[0] ?? null;
  const values: Record<string, number> = {};
  let entries = 0;
  let recovered = 0;
  for (const r of c.recoveries) {
    const inState = r.locations.filter((l) => l.address === c.address && l.where === 'state' && l.role === 'value').length;
    if (!inState) continue;
    values[r.value] = (values[r.value] ?? 0) + inState;
    recovered += inState;
  }
  entries = Math.max(rep?.entries ?? 0, recovered);
  return { address: c.address, entries, recovered, values, repeated: rep ? { entries: rep.entries, distinct: rep.distinct } : null, clusters: c.clusters.length };
}

export function aggregate(a: Analysis, network: string, source: Record<string, unknown>, own: Own): Aggregate {
  const cs = a.contracts;
  const byType: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  const recovered = new Map<string, { type: string; domain: string; state: boolean }>();
  for (const c of cs) for (const r of c.recoveries) recovered.set(r.digest, { type: r.type, domain: r.domain, state: r.locations.some((l) => l.where === 'state') });
  for (const r of recovered.values()) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    byDomain[r.domain.replace(/ < \d+$/, '')] = (byDomain[r.domain.replace(/ < \d+$/, '')] ?? 0) + 1;
  }
  const withClusters = cs.filter((c) => c.clusters.some((k) => !k.constant));
  const ownOut: Record<string, OwnResult> = {};
  for (const c of cs) if (own[c.address]) ownOut[own[c.address]] = ownResult(c);
  return {
    network,
    generatedAt: new Date().toISOString(),
    source,
    contracts: {
      scanned: cs.length,
      decoded: cs.filter((c) => c.decoded).length,
      withCells: cs.filter((c) => c.cells > 0).length,
      withCalls: cs.filter((c) => c.calls > 0).length,
      cells: cs.reduce((n, c) => n + c.cells, 0),
      opaqueValues: cs.reduce((n, c) => n + c.opaque, 0),
      calls: cs.reduce((n, c) => n + c.calls, 0),
      merkleTrees: cs.reduce((n, c) => n + c.merkleTrees, 0),
    },
    guessableHashes: {
      valuesRecovered: recovered.size,
      contracts: cs.filter((c) => c.recoveries.length > 0).length,
      byType,
      byDomain,
      inState: [...recovered.values()].filter((r) => r.state).length,
      inCallsOnly: [...recovered.values()].filter((r) => !r.state).length,
    },
    repeatedHiddenValues: {
      contracts: cs.filter((c) => c.repeated.length > 0).length,
      maps: cs.reduce((n, c) => n + c.repeated.length, 0),
      entries: cs.reduce((n, c) => n + c.repeated.reduce((m, r) => m + r.entries, 0), 0),
    },
    linkableTags: {
      contracts: withClusters.length,
      clusters: cs.reduce((n, c) => n + c.clusters.filter((k) => !k.constant).length, 0),
      constantClusters: cs.reduce((n, c) => n + c.clusters.filter((k) => k.constant).length, 0),
      largestCluster: Math.max(0, ...cs.flatMap((c) => c.clusters.filter((k) => !k.constant).map((k) => k.calls))),
      contractsAllCallsLinked: cs.filter((c) => c.calls >= 2 && c.clusters.some((k) => k.calls === c.calls)).length,
    },
    crossContract: { values: a.crossContract.length, contractsInvolved: new Set(a.crossContract.flatMap((x) => x.contracts)).size },
    bruteForce: {
      families: a.families.map((f) => ({ family: f.family, size: f.size, seconds: Math.round(f.ms / 100) / 10, hits: f.hits })),
      hashed: a.families.reduce((n, f) => n + f.size, 0),
      distinctTargets: a.targets,
    },
    own: ownOut,
  };
}

/** The private report: everything, per contract, for notes to owners. */
export function details(a: Analysis) {
  return {
    contracts: a.contracts
      .filter((c) => c.recoveries.length || c.repeated.length || c.clusters.length)
      .map((c) => ({
        address: c.address,
        entryPoints: c.entryPoints,
        calls: c.calls,
        recoveries: c.recoveries.map((r) => ({ expr: r.expr, value: r.value, digest: r.digest, locations: r.locations.filter((l) => l.address === c.address).slice(0, 10) })),
        repeated: c.repeated,
        clusters: c.clusters.slice(0, 20),
      })),
    crossContract: a.crossContract.slice(0, 200),
  };
}
