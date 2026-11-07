// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The attacks again, against the contracts Tell's own fixes produce. For every leaky contract,
// `tell --fix` writes a patch; here the patched contract is compiled and the same attack that
// reads the secret out of the leaky one is run against it.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Sim, rand32, hex } from './sim.js';
import { findCompilers, scanFile } from '../../engine/src/index.js';
import { planFixes, type FilePlan } from '../../engine/src/fix.js';
import * as BallotLeaky from '../managed/ballot-leaky/contract/index.js';
import * as PayLeaky from '../managed/payband-leaky/contract/index.js';

setNetworkId('undeployed');

const ZOO = path.resolve(__dirname, '..');
const OUT = path.join(ZOO, 'managed', 'autofix');
const NAMES = ['ballot', 'payband', 'reserve', 'vault', 'board'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = any;
const patched: Record<string, { mod: Mod; plan: FilePlan }> = {};
// the nonce witness a fix added, if any: the DApp side supplies fresh random bytes for it
const nonce = (name: string) => patched[name].plan.suggestions.find((s) => s.patch)?.patch?.witness;

beforeAll(async () => {
  const compilers = await findCompilers();
  const c = compilers.find((x) => x.version === '0.31.1') ?? compilers[0];
  if (!c) throw new Error('no Compact compiler installed');
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of NAMES) {
    const file = path.join(ZOO, 'contracts', `${name}-leaky.compact`);
    const plan = await planFixes(await scanFile(file, compilers), { compilers, root: ZOO });
    if (!plan.combined) throw new Error(`no verified fix for ${name}-leaky`);
    const src = path.join(OUT, `${name}-autofixed.compact`);
    fs.writeFileSync(src, plan.combined.source);
    execFileSync(c.bin, ['--skip-zk', src, path.join(OUT, name)], { stdio: ['ignore', 'ignore', 'inherit'] });
    patched[name] = { plan, mod: await import(pathToFileURL(path.join(OUT, name, 'contract', 'index.js')).href) };
  }
}, 600_000);

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
const witnessFor = (name: string, rest: Record<string, unknown>) => {
  const w = nonce(name);
  return w ? { ...rest, [w]: ({ privateState }: { privateState: unknown }) => [privateState, rand32()] } : rest;
};

describe('tell --fix stops every zoo attack', () => {
  it('every leaky contract gets one verified patch that removes its finding', () => {
    for (const name of NAMES) {
      const { plan } = patched[name];
      expect(plan.combined!.verification).toMatchObject({ ok: true, compiles: true, gone: true, newFindings: [] });
      expect(['A', 'B']).toContain(plan.combined!.verification.gradeAfter);
    }
  });

  it('ballot: hashing all four choices no longer matches any ballot', () => {
    type PS = { key: Uint8Array; choice: bigint };
    const w = witnessFor('ballot', {
      voterKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
      choice: ({ privateState }: { privateState: PS }) => [privateState, privateState.choice],
    });
    const voters: PS[] = Array.from({ length: 12 }, () => ({ key: rand32(), choice: BigInt(pick([0, 1, 2, 3])) }));
    const sim = new Sim<PS>(patched.ballot.mod, w as never, voters[0]);
    for (const v of voters) sim.call(v, 'register');
    for (const v of voters) sim.call(v, 'vote');
    const table = new Map([0n, 1n, 2n, 3n].map((c) => [hex(BallotLeaky.pureCircuits.choiceHash(c)), c]));
    const ballots = [...sim.ledger.ballots] as [Uint8Array, Uint8Array][];
    expect(ballots).toHaveLength(voters.length);
    expect(ballots.map(([, h]) => table.get(hex(h))).filter((x) => x !== undefined)).toEqual([]);
  });

  it('payband: the salary brute force finds nothing', () => {
    type PS = { key: Uint8Array; salary: bigint };
    const w = witnessFor('payband', {
      employerKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
      salary: ({ privateState }: { privateState: PS }) => [privateState, privateState.salary],
    });
    const key = rand32();
    const sim = new Sim<PS>(patched.payband.mod, w as never, { key, salary: 0n }, PayLeaky.pureCircuits.keyHash(key));
    const payroll = [
      { employee: 101n, salary: 38_500n },
      { employee: 102n, salary: 52_000n },
    ];
    for (const p of payroll) sim.call({ key, salary: p.salary }, 'file', p.employee);
    let found = 0;
    for (const [employee, record] of sim.ledger.records as Iterable<[bigint, Uint8Array]>)
      for (let s = 50n; s <= 100_000n; s += 50n) if (hex(PayLeaky.pureCircuits.recordOf(employee, s)) === hex(record)) found++;
    expect(sim.ledger.records.size()).toBe(2n);
    expect(found).toBe(0);
  });

  it('reserve: low bids are rejected and every accepted bid leaves the same trace', () => {
    type PS = { key: Uint8Array; amount: bigint; salt: Uint8Array };
    const w = {
      bidderKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
      amount: ({ privateState }: { privateState: PS }) => [privateState, privateState.amount],
      bidSalt: ({ privateState }: { privateState: PS }) => [privateState, privateState.salt],
    };
    const bidders: PS[] = [900n, 1_400n, 1_000n, 650n, 2_200n].map((amount) => ({ key: rand32(), amount, salt: rand32() }));
    const sim = new Sim<PS>(patched.reserve.mod, w as never, bidders[0], 1_000n);
    let rejected = 0;
    for (const b of bidders)
      try {
        sim.call(b, 'bid');
      } catch {
        rejected++;
      }
    expect(rejected).toBe(2);
    // the leaky attack read which set each bid landed in; now there is only one outcome
    expect(sim.ledger.belowReserve.size()).toBe(0n);
    expect(sim.ledger.qualified.size()).toBe(sim.ledger.bids.size());
  });

  it('vault: reading `owner` no longer gives a working key', () => {
    type PS = { sk: Uint8Array };
    const w = { secretKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.sk] };
    const owner = { sk: rand32() };
    const sim = new Sim<PS>(patched.vault.mod, w as never, owner);
    sim.call(owner, 'claim');
    expect(hex(sim.ledger.owner)).not.toBe(hex(owner.sk));
    expect(() => sim.call({ sk: sim.ledger.owner as Uint8Array }, 'withdraw')).toThrow('not the owner');
    sim.call(owner, 'withdraw');
    expect(sim.ledger.withdrawals).toBe(1n);
  });

  it('board: posts no longer group by author from the authors map', () => {
    type PS = { sk: Uint8Array };
    const w = { memberKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.sk] };
    const alice = { sk: rand32() };
    const bob = { sk: rand32() };
    const sim = new Sim<PS>(patched.board.mod, w as never, alice);
    sim.call(alice, 'join');
    sim.call(bob, 'join');
    for (const who of [alice, bob, alice, alice, bob]) sim.call(who, 'post', rand32());
    const tags = [...(sim.ledger.authors as Iterable<[bigint, Uint8Array]>)].map(([, t]) => hex(t));
    expect(new Set(tags).size).toBe(5);
    // Honest limit: the membership check still reads the same tag in each post's transcript,
    // and the fix says so; board-fixed's Merkle proof is the full fix.
    expect(patched.board.plan.suggestions[0].notes.join(' ')).toContain('Merkle path');
  });
});
