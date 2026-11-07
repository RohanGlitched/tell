// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Leaks in a contract's initial state and in token operations, carried out from
// public data only: the state a deploy writes, and the effects every transaction
// carries (coin commitments, token inputs and outputs).

import { describe, it, expect } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { coinCommitment, rawTokenType, sampleCoinPublicKey } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { Sim, rand32, hex } from './sim.js';

import * as RaffleLeaky from '../managed/raffle-leaky/contract/index.js';
import * as RaffleFixed from '../managed/raffle-fixed/contract/index.js';
import * as FaucetLeaky from '../managed/faucet-leaky/contract/index.js';
import * as FaucetFixed from '../managed/faucet-fixed/contract/index.js';
import * as DepositLeaky from '../managed/deposit-leaky/contract/index.js';
import * as DepositFixed from '../managed/deposit-fixed/contract/index.js';

setNetworkId('undeployed');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = (m: any) => m;

describe('raffle: the constructor seals the winner with a guessable hash', () => {
  type PS = { n: bigint; salt: Uint8Array };
  const w = {
    winningNumber: ({ privateState }: { privateState: PS }) => [privateState, privateState.n],
    sealSalt: ({ privateState }: { privateState: PS }) => [privateState, privateState.salt],
  };
  // The attacker: read the deployed contract's initial state, hash every ticket.
  const attack = (sealed: Uint8Array) => {
    for (let t = 0n; t < 10_000n; t++) if (hex(RaffleLeaky.pureCircuits.seal(t)) === hex(sealed)) return t;
    return undefined;
  };

  it('leaky: the winning number is read from the initial state before any ticket is sold', () => {
    const organiser: PS = { n: 7_351n, salt: rand32() };
    const sim = new Sim<PS>(mod(RaffleLeaky), w as never, organiser);
    expect(sim.ledger.open).toBe(false);
    expect(attack(sim.ledger.sealedDraw)).toBe(7_351n);
  });

  it('fixed: the same search finds nothing, and the organiser can still open the draw', () => {
    const organiser: PS = { n: 7_351n, salt: rand32() };
    const sim = new Sim<PS>(mod(RaffleFixed), w as never, organiser);
    expect(attack(sim.ledger.sealedDraw)).toBeUndefined();
    expect(() => sim.call(organiser, 'reveal', 7_351n, rand32())).toThrow('not the sealed number');
    sim.call(organiser, 'reveal', 7_351n, organiser.salt);
    expect(sim.ledger.drawn).toBe(7_351n);
  });
});

describe('faucet: a shielded mint with a nonce from public state', () => {
  type PS = { seed: Uint8Array };
  const w = { nonceSeed: ({ privateState }: { privateState: PS }) => [privateState, privateState.seed] };
  const domain = new Uint8Array(Buffer.from('faucet:token'.padEnd(32, '\0')));
  // Wallet keys the attacker already knows (they appear in other transactions and address books).
  const wallets = Array.from({ length: 8 }, () => sampleCoinPublicKey());
  const claimers = [wallets[2], wallets[5], wallets[2], wallets[7]];

  const run = (m: typeof FaucetLeaky | typeof FaucetFixed) => {
    const sim = new Sim<PS>(mod(m), w as never, { seed: rand32() });
    const color = rawTokenType(domain, sim.address);
    const found: (string | undefined)[] = [];
    for (const pk of claimers) {
      sim.callAs(pk, { seed: rand32() }, 'claim');
      // The attacker: the nonce the claim used is public (leaky) and the amount and color are public;
      // try each known wallet against the commitment the transaction claims.
      const fx = sim.effects.at(-1);
      const claimed = new Set<string>(fx.claimedShieldedSpends);
      const nonce = 'nonce' in sim.ledger ? hex(sim.ledger.nonce) : hex(rand32());
      found.push(wallets.find((k) => claimed.has(coinCommitment({ type: color, nonce, value: 100n }, k))));
    }
    return { sim, found };
  };

  it('leaky: every claim is matched to the wallet that received it', () => {
    const { sim, found } = run(FaucetLeaky);
    expect(found).toEqual(claimers);
    // and the mint itself is public: 100 tokens per claim
    expect([...sim.effects[0].shieldedMints.values()]).toEqual([100n]);
  });

  it('fixed: no claim matches any wallet', () => {
    const { found } = run(FaucetFixed);
    expect(found.every((x) => x === undefined)).toBe(true);
  });
});

describe('deposit: a sealed bid locked as an unshielded amount', () => {
  type PS = { key: Uint8Array; amount: bigint; salt: Uint8Array };
  const w = {
    bidderKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
    bidAmount: ({ privateState }: { privateState: PS }) => [privateState, privateState.amount],
    bidSalt: ({ privateState }: { privateState: PS }) => [privateState, privateState.salt],
  };
  const bidders: PS[] = [1_250n, 980n, 2_400n].map((amount) => ({ key: rand32(), amount, salt: rand32() }));
  // The attacker: the unshielded inputs each bid transaction expects.
  const deposits = (sim: Sim<PS>) => sim.effects.map((fx) => [...fx.unshieldedInputs.values()].reduce((a: bigint, b: bigint) => a + b, 0n));

  it('leaky: every sealed bid is read from the deposit', () => {
    const sim = new Sim<PS>(mod(DepositLeaky), w as never, bidders[0]);
    for (const b of bidders) sim.call(b, 'bid');
    expect(sim.ledger.bids.size()).toBe(3n);
    expect(deposits(sim)).toEqual(bidders.map((b) => b.amount));
  });

  it('fixed: every deposit is the same public bond', () => {
    const sim = new Sim<PS>(mod(DepositFixed), w as never, bidders[0], 5_000n);
    for (const b of bidders) sim.call(b, 'bid');
    expect(sim.ledger.bids.size()).toBe(3n);
    expect(deposits(sim)).toEqual([5_000n, 5_000n, 5_000n]);
  });
});
