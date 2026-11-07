// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Two leak classes added after the head-to-head benchmark (bench/GAPS-FOR-TELL.md): a published
// hash reused as a private key, and an "anonymous" claim that looks the caller's tag up in a set.
// Each attack reads only public data: ledger state, or the public transcript of a call.

import { describe, it, expect } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { degradeToTransient, ecMulGenerator } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { Sim, rand32, hex } from './sim.js';

import * as KeyringLeaky from '../managed/keyring-leaky/contract/index.js';
import * as KeyringFixed from '../managed/keyring-fixed/contract/index.js';
import * as ClubLeaky from '../managed/club-leaky/contract/index.js';
import * as ClubFixed from '../managed/club-fixed/contract/index.js';

setNetworkId('undeployed');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = (m: any) => m;
type Point = { x: bigint; y: bigint };
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

describe('keyring: the account id is the private key', () => {
  type PS = { seed: Uint8Array };
  const w = { seed: ({ privateState }: { privateState: PS }) => [privateState, privateState.seed] };
  const run = (m: typeof KeyringLeaky | typeof KeyringFixed) => {
    const users: PS[] = Array.from({ length: 6 }, () => ({ seed: rand32() }));
    const sim = new Sim<PS>(mod(m), w as never, users[0]);
    for (const u of users) sim.call(u, 'register');
    // the attacker: read each (account id, public key) pair and try the id as the private key
    const entries = [...(sim.ledger.accounts as Iterable<[Uint8Array, Point]>)];
    const broken = entries.filter(([id, pk]) => same(ecMulGenerator(degradeToTransient(id)), pk));
    return { users, entries, broken };
  };

  it('leaky: every encryption key is opened from its public account id', () => {
    const { users, entries, broken } = run(KeyringLeaky);
    expect(entries).toHaveLength(users.length);
    expect(broken).toHaveLength(users.length);
  });

  it('fixed: no account id opens its key; only the seed owner can derive it', () => {
    const { users, entries, broken } = run(KeyringFixed);
    expect(broken).toEqual([]);
    // the owner can: the scalar is hash("keyring:enc-key", seed)
    const u = users[0];
    const pk = entries.find(([id]) => hex(id) === hex(KeyringFixed.pureCircuits.accountOf(u.seed)))![1];
    expect(same(ecMulGenerator(degradeToTransient(KeyringFixed.pureCircuits.scalarOf(u.seed))), pk)).toBe(true);
  });
});

// Every 32-byte value in a call's public transcript, as hex.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bytesIn(x: any, out = new Set<string>()): Set<string> {
  if (x instanceof Uint8Array) {
    if (x.length === 32) out.add(hex(x));
  } else if (Array.isArray(x)) for (const y of x) bytesIn(y, out);
  else if (x && typeof x === 'object') for (const y of Object.values(x)) bytesIn(y, out);
  return out;
}

describe('club: a membership lookup names the member', () => {
  type PS = { sk: Uint8Array };
  const memberKey = ({ privateState }: { privateState: PS }) => [privateState, privateState.sk];
  const order = [0, 1, 0, 2, 0, 1];

  it('leaky: each claim is tied to the member who joined with that leaf', () => {
    const members: PS[] = Array.from({ length: 3 }, () => ({ sk: rand32() }));
    const sim = new Sim<PS>(mod(ClubLeaky), { memberKey } as never, members[0]);
    for (const m of members) sim.call(m, 'join', ClubLeaky.pureCircuits.memberLeaf(m.sk));
    const joins = sim.transcripts.length;
    for (const i of order) sim.call(members[i], 'claim');
    // the attacker: the public member set, and the transcript of each claim
    const leaves = [...(sim.ledger.members as Iterable<Uint8Array>)].map(hex);
    const named = sim.transcripts.slice(joins).map((t) => leaves.findIndex((l) => bytesIn(t).has(l)));
    expect(named.every((i) => i >= 0)).toBe(true);
    const leafOf = members.map((m) => hex(ClubLeaky.pureCircuits.memberLeaf(m.sk)));
    expect(named.map((i) => leafOf.indexOf(leaves[i]))).toEqual(order);
  });

  it('fixed: no claim transcript contains a member leaf, and each member claims once', () => {
    const w = {
      memberKey,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      memberPath: ({ privateState, ledger }: any, leaf: Uint8Array) => [privateState, ledger.members.findPathForLeaf(leaf)],
    };
    const members: PS[] = Array.from({ length: 3 }, () => ({ sk: rand32() }));
    const sim = new Sim<PS>(mod(ClubFixed), w as never, members[0]);
    const leafOf = members.map((m) => hex(ClubFixed.pureCircuits.memberLeaf(m.sk)));
    for (const m of members) sim.call(m, 'join', ClubFixed.pureCircuits.memberLeaf(m.sk));
    const joins = sim.transcripts.length;
    for (const m of members) sim.call(m, 'claim');
    for (const t of sim.transcripts.slice(joins)) for (const l of leafOf) expect(bytesIn(t).has(l)).toBe(false);
    expect(() => sim.call(members[0], 'claim')).toThrow();
    expect(() => sim.call({ sk: rand32() }, 'claim')).toThrow();
  });
});
