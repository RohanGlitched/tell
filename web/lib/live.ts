// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Reads the two demo ballots' public state from the Midnight Preview indexer and
// runs the attack Tell predicts: hash the four candidates, match the ballots.

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import deployments from '@/data/deployments.json';
import * as Leaky from './contracts/ballot-leaky/contract/index.js';
import * as Fixed from './contracts/ballot-fixed/contract/index.js';

export const PREVIEW = {
  indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  explorer: 'https://preview.midnightexplorer.com',
};
const CANDIDATES = ['Asha', 'Bilal', 'Chen', 'Dara'];
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

export type LiveBallot = {
  contract: 'ballot-leaky' | 'ballot-fixed';
  address: string;
  voters: number;
  ballots: { tag: string; value: string; recovered: string | null }[];
  tally: Record<string, number> | null;
  txs: { voter: number; registerTx: string; voteTx: string }[];
};
export type LiveResponse = { network: 'preview'; readAt: string; ballots: LiveBallot[]; error?: string };

let cache: { at: number; data: LiveResponse } | null = null;

export async function readLive(): Promise<LiveResponse> {
  if (cache && Date.now() - cache.at < 15_000) return cache.data;
  setNetworkId('preview');
  const pdp = indexerPublicDataProvider(PREVIEW.indexer, PREVIEW.indexerWS);
  const table = new Map([0n, 1n, 2n, 3n].map((c) => [hex(Leaky.pureCircuits.choiceHash(c)), CANDIDATES[Number(c)]]));
  const ballots: LiveBallot[] = [];
  for (const [name, mod] of [
    ['ballot-leaky', Leaky],
    ['ballot-fixed', Fixed],
  ] as const) {
    const dep = (deployments as Record<string, { address: string; votes: { voter: number; registerTx: string; voteTx: string }[] }>)[name];
    if (!dep) continue;
    const st = await pdp.queryContractState(dep.address);
    if (!st) throw new Error(`no contract state at ${dep.address}`);
    const l = mod.ledger(st.data);
    const rows = [...(l.ballots as Iterable<[Uint8Array, Uint8Array]>)].map(([t, v]) => ({ tag: hex(t), value: hex(v), recovered: table.get(hex(v)) ?? null }));
    const tally = name === 'ballot-leaky' ? rows.reduce<Record<string, number>>((a, r) => (r.recovered ? ((a[r.recovered] = (a[r.recovered] ?? 0) + 1), a) : a), {}) : null;
    ballots.push({ contract: name, address: dep.address, voters: Number(l.voters.size()), ballots: rows, tally, txs: dep.votes.map(({ voter, registerTx, voteTx }) => ({ voter, registerTx, voteTx })) });
  }
  const data: LiveResponse = { network: 'preview', readAt: new Date().toISOString(), ballots };
  cache = { at: Date.now(), data };
  return data;
}
