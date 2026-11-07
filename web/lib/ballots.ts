// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The two demo ballots on Midnight Preprod, as static facts for the home page: every vote
// transaction (data/deployments.json, written by chain/ when the votes were cast) and the value
// each vote stores in the leaky ballot's `ballots` map. That value is choiceHash(choice), which
// has no salt, so it is the same on chain as when data/hero.json computed it with Midnight's
// contract runtime. The /live page reads the same contracts from the indexer.

import deployments from '@/data/deployments.json';
import hero from '@/data/hero.json';

type Vote = { voter: number; choice: string; registerTx: string; voteTx: string };
type Dep = { network: string; contracts: Record<string, { address: string; deployTx: string; votes: Vote[] }> };

const DEP = deployments as unknown as Dep;
const VALUE_OF = new Map(
  (hero.rows as { contract: string; field: string; value: string; reveal: string }[])
    .filter((r) => r.contract === 'ballot' && r.field === 'ballots' && r.reveal.startsWith('voted '))
    .map((r) => [r.reveal.slice('voted '.length), r.value]),
);

export const short = (h: string, a = 6, b = 4) => (h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h);

export type LedgerRow = { voter: number; voteTx: string; value: string | null; choice: string };

export function leakyBallot(): { address: string; network: string; rows: LedgerRow[] } {
  const c = DEP.contracts['ballot-leaky'];
  return {
    address: c.address,
    network: DEP.network,
    rows: c.votes.map((v) => ({ voter: v.voter, voteTx: v.voteTx, value: VALUE_OF.get(v.choice) ?? null, choice: v.choice })),
  };
}

export function fixedBallot(): { address: string; votes: number } {
  const c = DEP.contracts['ballot-fixed'];
  return { address: c.address, votes: c.votes.length };
}
