// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Ledger 9 leaks: what a contract emits as an event is public, like a ledger write.
// These contracts are compiled with Compact 0.36 and run on compact-runtime 0.21 (zoo/ledger9).

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Sim9, eventHex } from '../ledger9/sim.js';

import * as PollLeaky from '../ledger9/managed/poll-leaky/contract/index.js';
import * as PollFixed from '../ledger9/managed/poll-fixed/contract/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = (m: any) => m;
const rand32 = () => new Uint8Array(randomBytes(32));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('poll: a receipt event that is hash(choice)', () => {
  type PS = { key: Uint8Array; choice: bigint; salt: Uint8Array };
  const w = {
    voterKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
    choice: ({ privateState }: { privateState: PS }) => [privateState, privateState.choice],
    ballotSalt: ({ privateState }: { privateState: PS }) => [privateState, privateState.salt],
  };
  const voters: PS[] = [2n, 0n, 3n, 2n, 1n, 2n].map((choice) => ({ key: rand32(), choice, salt: rand32() }));

  const run = async (m: typeof PollLeaky | typeof PollFixed) => {
    const sim = await Sim9.deploy<PS>(mod(m), w as never, voters[0]);
    for (const v of voters) await sim.call(v, 'vote');
    // The attacker: hash the four options, look for each hash in each vote's events.
    const table = [0n, 1n, 2n, 3n].map((c) => [hex(PollLeaky.pureCircuits.receipt(c)), c] as const);
    const recovered = sim.events.map((evs) => {
      const all = evs.map(eventHex).join('');
      return table.find(([h]) => all.includes(h))?.[1];
    });
    return { sim, recovered };
  };

  it('leaky: every vote is recovered from the events alone', async () => {
    const { sim, recovered } = await run(PollLeaky);
    expect(sim.events.every((evs) => evs.length === 1)).toBe(true);
    expect(recovered).toEqual(voters.map((v) => v.choice));
  });

  it('fixed: the same search over the events finds nothing', async () => {
    const { sim, recovered } = await run(PollFixed);
    expect(sim.ledger.ballots.size()).toBe(BigInt(voters.length));
    expect(sim.events.every((evs) => evs.length === 1)).toBe(true);
    expect(recovered.every((r) => r === undefined)).toBe(true);
  });
});
