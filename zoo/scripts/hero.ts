// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Runs the leaky zoo contracts, then exports their real public ledger values next
// to what an observer recovers from them. The website's lamp shows exactly this.
//   npx tsx scripts/hero.ts ../web/data/hero.json
import fs from 'node:fs';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Sim, rand32, hex } from '../test/sim.js';
import * as Ballot from '../managed/ballot-leaky/contract/index.js';
import * as Pay from '../managed/payband-leaky/contract/index.js';
import * as Board from '../managed/board-leaky/contract/index.js';
import * as Reserve from '../managed/reserve-leaky/contract/index.js';
import * as Vault from '../managed/vault-leaky/contract/index.js';

setNetworkId('undeployed');
type Row = { contract: string; field: string; key: string; value: string; reveal: string; how: string; severity: 'critical' | 'high' | 'medium' };
const rows: Row[] = [];
const CANDIDATES = ['Asha', 'Bilal', 'Chen', 'Dara'];
const any = (m: unknown) => m as never;

// Ballot: hash(choice)
{
  type PS = { key: Uint8Array; choice: bigint; salt: Uint8Array };
  const w = {
    voterKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
    choice: ({ privateState }: { privateState: PS }) => [privateState, privateState.choice],
  };
  const voters: PS[] = Array.from({ length: 10 }, (_, i) => ({ key: rand32(), choice: BigInt([2, 0, 2, 1, 3, 2, 0, 2, 1, 2][i]), salt: rand32() }));
  const sim = new Sim<PS>(any(Ballot), any(w), voters[0]);
  for (const v of voters) sim.call(v, 'register');
  for (const v of voters) sim.call(v, 'vote');
  const table = new Map([0n, 1n, 2n, 3n].map((c) => [hex(Ballot.pureCircuits.choiceHash(c)), c]));
  for (const [tag, h] of sim.ledger.ballots as Iterable<[Uint8Array, Uint8Array]>) {
    const c = table.get(hex(h))!;
    rows.push({ contract: 'ballot', field: 'ballots', key: hex(tag), value: hex(h), reveal: `voted ${CANDIDATES[Number(c)]}`, how: '4 guesses', severity: 'critical' });
  }
}

// Payband: hash(employee, salary)
{
  type PS = { key: Uint8Array; salary: bigint };
  const w = {
    employerKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
    salary: ({ privateState }: { privateState: PS }) => [privateState, privateState.salary],
  };
  const key = rand32();
  const sim = new Sim<PS>(any(Pay), any(w), { key, salary: 0n }, Pay.pureCircuits.keyHash(key));
  const pay: [bigint, bigint][] = [
    [101n, 38_500n],
    [102n, 52_000n],
    [103n, 71_250n],
    [104n, 45_000n],
    [105n, 96_500n],
  ];
  for (const [e, s] of pay) sim.call({ key, salary: s }, 'file', e);
  for (const [e, rec] of sim.ledger.records as Iterable<[bigint, Uint8Array]>) {
    let found = 0n;
    for (let s = 50n; s <= 100_000n; s += 50n)
      if (hex(Pay.pureCircuits.recordOf(e, s)) === hex(rec)) {
        found = s;
        break;
      }
    rows.push({ contract: 'payband', field: 'records', key: `employee ${e}`, value: hex(rec), reveal: `₹${found.toLocaleString('en-IN')} / month`, how: `${Number(found / 50n)} guesses`, severity: 'critical' });
  }
}

// Board: the same author tag on every post
{
  type PS = { sk: Uint8Array };
  const w = { memberKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.sk] };
  const people = { Priya: { sk: rand32() }, Tom: { sk: rand32() } };
  const sim = new Sim<PS>(any(Board), any(w), people.Priya);
  for (const p of Object.values(people)) sim.call(p, 'join');
  const order: (keyof typeof people)[] = ['Priya', 'Tom', 'Priya', 'Priya', 'Tom'];
  for (const n of order) sim.call(people[n], 'post', rand32());
  const tags = [...(sim.ledger.authors as Iterable<[bigint, Uint8Array]>)];
  const first = new Map<string, number>();
  for (const [n, t] of tags) {
    const h = hex(t);
    if (!first.has(h)) first.set(h, Number(n));
    rows.push({
      contract: 'board',
      field: 'authors',
      key: `post #${n}`,
      value: h,
      reveal: first.get(h) === Number(n) ? 'author A, first post' : `same author as post #${first.get(h)}`,
      how: 'tag matches',
      severity: 'medium',
    });
  }
}

// Reserve: which set was touched
{
  type PS = { key: Uint8Array; amount: bigint; salt: Uint8Array };
  const w = {
    bidderKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
    amount: ({ privateState }: { privateState: PS }) => [privateState, privateState.amount],
    bidSalt: ({ privateState }: { privateState: PS }) => [privateState, privateState.salt],
  };
  const bidders: PS[] = [900n, 1_400n, 1_000n, 650n].map((amount) => ({ key: rand32(), amount, salt: rand32() }));
  const sim = new Sim<PS>(any(Reserve), any(w), bidders[0], 1_000n);
  for (const b of bidders) sim.call(b, 'bid');
  for (const t of sim.ledger.qualified as Iterable<Uint8Array>) rows.push({ contract: 'reserve', field: 'qualified', key: 'bidder', value: hex(t), reveal: 'bid ≥ reserve', how: 'set touched', severity: 'medium' });
  for (const t of sim.ledger.belowReserve as Iterable<Uint8Array>) rows.push({ contract: 'reserve', field: 'belowReserve', key: 'bidder', value: hex(t), reveal: 'bid < reserve', how: 'set touched', severity: 'medium' });
}

// Vault: the key itself
{
  type PS = { sk: Uint8Array };
  const owner = { sk: rand32() };
  const sim = new Sim<PS>(any(Vault), any({ secretKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.sk] }), owner);
  sim.call(owner, 'claim');
  rows.push({ contract: 'vault', field: 'owner', key: 'cell', value: hex(sim.ledger.owner), reveal: 'this is the owner’s secret key', how: 'read it', severity: 'critical' });
}

const out = process.argv[2] ?? '../web/data/hero.json';
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 1));
console.log(`${rows.length} rows → ${out}`);
