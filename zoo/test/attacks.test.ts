// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Every leak Tell reports in the zoo is carried out here as an attack that
// reads only public ledger state, and every fix is shown to stop it.

import { describe, it, expect } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Sim, rand32, hex } from './sim.js';

import * as BallotLeaky from '../managed/ballot-leaky/contract/index.js';
import * as BallotFixed from '../managed/ballot-fixed/contract/index.js';
import * as PayLeaky from '../managed/payband-leaky/contract/index.js';
import * as PayFixed from '../managed/payband-fixed/contract/index.js';
import * as ReserveLeaky from '../managed/reserve-leaky/contract/index.js';
import * as ReserveFixed from '../managed/reserve-fixed/contract/index.js';
import * as VaultLeaky from '../managed/vault-leaky/contract/index.js';
import * as VaultFixed from '../managed/vault-fixed/contract/index.js';
import * as BoardLeaky from '../managed/board-leaky/contract/index.js';
import * as BoardFixed from '../managed/board-fixed/contract/index.js';

setNetworkId('undeployed');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = (m: any) => m;
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

describe('ballot: hash(choice) is a guessable hash', () => {
  type PS = { key: Uint8Array; choice: bigint; salt: Uint8Array };
  const w = {
    voterKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
    choice: ({ privateState }: { privateState: PS }) => [privateState, privateState.choice],
    ballotSalt: ({ privateState }: { privateState: PS }) => [privateState, privateState.salt],
  };
  const run = (m: typeof BallotLeaky | typeof BallotFixed) => {
    const voters: PS[] = Array.from({ length: 12 }, () => ({ key: rand32(), choice: BigInt(pick([0, 1, 2, 3])), salt: rand32() }));
    const sim = new Sim<PS>(mod(m), w as never, voters[0]);
    for (const v of voters) sim.call(v, 'register');
    for (const v of voters) sim.call(v, 'vote');
    // the attacker: hash all four choices, match against the public ballots
    const table = new Map([0n, 1n, 2n, 3n].map((c) => [hex(BallotLeaky.pureCircuits.choiceHash(c)), c]));
    const recovered = [...sim.ledger.ballots].map(([, h]: [Uint8Array, Uint8Array]) => table.get(hex(h)));
    return { voters, recovered };
  };

  it('leaky: every vote is recovered from public state with four hashes', () => {
    const { voters, recovered } = run(BallotLeaky);
    expect(recovered.filter((r) => r !== undefined)).toHaveLength(voters.length);
    expect(recovered.sort()).toEqual(voters.map((v) => v.choice).sort());
  });

  it('fixed: the same attack recovers nothing', () => {
    const { recovered } = run(BallotFixed);
    expect(recovered.every((r) => r === undefined)).toBe(true);
  });
});

describe('payband: hash(employee, salary) is a guessable hash', () => {
  type PS = { key: Uint8Array; salary: bigint; salt: Uint8Array };
  const w = {
    employerKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
    salary: ({ privateState }: { privateState: PS }) => [privateState, privateState.salary],
    slipSalt: ({ privateState }: { privateState: PS }) => [privateState, privateState.salt],
  };
  const payroll = [
    { employee: 101n, salary: 38_500n },
    { employee: 102n, salary: 52_000n },
    { employee: 103n, salary: 71_250n },
  ];
  const run = (m: typeof PayLeaky | typeof PayFixed) => {
    const key = rand32();
    const boss: PS = { key, salary: 0n, salt: rand32() };
    const sim = new Sim<PS>(mod(m), w as never, boss, PayLeaky.pureCircuits.keyHash(key));
    for (const p of payroll) sim.call({ key, salary: p.salary, salt: rand32() }, 'file', p.employee);
    // the attacker: monthly salaries in rupees, from ₹1 to ₹1,00,000, in steps of ₹50
    const found = new Map<bigint, bigint>();
    for (const [employee, record] of sim.ledger.records as Iterable<[bigint, Uint8Array]>) {
      const target = hex(record);
      for (let s = 50n; s <= 100_000n; s += 50n)
        if (hex(PayLeaky.pureCircuits.recordOf(employee, s)) === target) {
          found.set(employee, s);
          break;
        }
    }
    return found;
  };

  it('leaky: every salary falls to a brute force over a realistic range', () => {
    const found = run(PayLeaky);
    for (const p of payroll) expect(found.get(p.employee)).toBe(p.salary);
  });

  it('fixed: the same brute force finds nothing', () => {
    expect(run(PayFixed).size).toBe(0);
  });
});

describe('reserve: a branch on the bid amount', () => {
  type PS = { key: Uint8Array; amount: bigint; salt: Uint8Array };
  const w = {
    bidderKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
    amount: ({ privateState }: { privateState: PS }) => [privateState, privateState.amount],
    bidSalt: ({ privateState }: { privateState: PS }) => [privateState, privateState.salt],
  };
  const bidders: PS[] = [900n, 1_400n, 1_000n, 650n, 2_200n].map((amount) => ({ key: rand32(), amount, salt: rand32() }));

  it('leaky: the public sets say which bids met the reserve', () => {
    const sim = new Sim<PS>(mod(ReserveLeaky), w as never, bidders[0], 1_000n);
    for (const b of bidders) sim.call(b, 'bid');
    expect(sim.ledger.qualified.size()).toBe(3n);
    expect(sim.ledger.belowReserve.size()).toBe(2n);
  });

  it('fixed: low bids never land, and accepted bids leave identical traces', () => {
    const sim = new Sim<PS>(mod(ReserveFixed), w as never, bidders[0], 1_000n);
    let rejected = 0;
    for (const b of bidders)
      try {
        sim.call(b, 'bid');
      } catch (e) {
        expect(String(e)).toContain('below the reserve');
        rejected++;
      }
    expect(rejected).toBe(2);
    expect(sim.ledger.bids.size()).toBe(3n);
    expect(Object.keys(sim.ledger)).not.toContain('belowReserve');
  });
});

describe('vault: a secret key on the ledger', () => {
  type PS = { sk: Uint8Array };
  const w = { secretKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.sk] };

  it('leaky: anyone who reads `owner` can withdraw', () => {
    const owner = { sk: rand32() };
    const sim = new Sim<PS>(mod(VaultLeaky), w as never, owner);
    sim.call(owner, 'claim');
    const thief = { sk: sim.ledger.owner as Uint8Array };
    sim.call(thief, 'withdraw');
    expect(sim.ledger.withdrawals).toBe(1n);
  });

  it('fixed: reading `owner` gives a hash, which does not work as a key', () => {
    const owner = { sk: rand32() };
    const sim = new Sim<PS>(mod(VaultFixed), w as never, owner);
    sim.call(owner, 'claim');
    const thief = { sk: sim.ledger.owner as Uint8Array };
    expect(() => sim.call(thief, 'withdraw')).toThrow('not the owner');
    sim.call(owner, 'withdraw');
    expect(sim.ledger.withdrawals).toBe(1n);
  });
});

describe('board: the same author tag on every post', () => {
  it('leaky: posts group by author from public state alone', () => {
    type PS = { sk: Uint8Array };
    const w = { memberKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.sk] };
    const alice = { sk: rand32() };
    const bob = { sk: rand32() };
    const sim = new Sim<PS>(mod(BoardLeaky), w as never, alice);
    sim.call(alice, 'join');
    sim.call(bob, 'join');
    for (const who of [alice, bob, alice, alice, bob]) sim.call(who, 'post', rand32());
    const groups = new Map<string, number>();
    for (const [, tag] of sim.ledger.authors as Iterable<[bigint, Uint8Array]>) groups.set(hex(tag), (groups.get(hex(tag)) ?? 0) + 1);
    expect([...groups.values()].sort()).toEqual([2, 3]);
  });

  it('fixed: every post carries a different one-time tag', () => {
    type PS = { sk: Uint8Array };
    const w = {
      memberKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.sk],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      memberPath: ({ privateState, ledger }: any, leaf: Uint8Array) => [privateState, ledger.members.findPathForLeaf(leaf)],
    };
    const alice = { sk: rand32() };
    const bob = { sk: rand32() };
    const sim = new Sim<PS>(mod(BoardFixed), w as never, alice);
    for (const m of [alice, bob]) sim.call(m, 'join', BoardFixed.pureCircuits.memberLeaf(m.sk));
    for (const who of [alice, bob, alice, alice, bob]) sim.call(who, 'post', rand32());
    const tags = [...(sim.ledger.tags as Iterable<Uint8Array>)].map(hex);
    expect(new Set(tags).size).toBe(5);
    // and a non-member cannot post at all
    expect(() => sim.call({ sk: rand32() }, 'post', rand32())).toThrow();
  });
});
