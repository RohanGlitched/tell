// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Runs a compiled zoo contract in memory: one public state, many callers, each
// with their own private state, exactly as on the network.

import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { randomBytes } from 'node:crypto';

const COIN_PK = '00'.repeat(32);

export const rand32 = (): Uint8Array => new Uint8Array(randomBytes(32));
export const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContract = any;

export class Sim<PS> {
  private state: unknown;
  constructor(
    readonly mod: { Contract: new (w: unknown) => AnyContract; ledger: (s: unknown) => AnyContract },
    readonly witnesses: Record<string, (ctx: { privateState: PS }, ...a: unknown[]) => [PS, unknown]>,
    deployer: PS,
    ...args: unknown[]
  ) {
    const c = new mod.Contract(witnesses);
    this.contract = c;
    const r = c.initialState(createConstructorContext(deployer, COIN_PK), ...args);
    this.state = r.currentContractState.data;
  }
  readonly contract: AnyContract;

  get ledger(): AnyContract {
    return this.mod.ledger(this.state);
  }

  call(who: PS, circuit: string, ...args: unknown[]): PS {
    const ctx = createCircuitContext(dummyContractAddress(), COIN_PK, this.state as never, who);
    const { context } = this.contract.impureCircuits[circuit](ctx, ...args);
    this.state = context.currentQueryContext.state;
    return context.currentPrivateState as PS;
  }
}
