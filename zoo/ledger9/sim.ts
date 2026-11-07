// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The zoo simulator for Ledger 9 contracts (Compact 0.36, compact-runtime 0.21): one public
// state, many callers with their own private state, and the events each call emits, which
// are part of the public transaction.

import { createConstructorContext, createCircuitContext, dummyContractAddress } from '@midnight-ntwrk/compact-runtime';

const COIN_PK = '00'.repeat(32);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContract = any;

export class Sim9<PS> {
  private constructor(
    readonly mod: { Contract: new (w: unknown) => AnyContract; ledger: (s: unknown) => AnyContract },
    readonly contract: AnyContract,
    private state: unknown,
  ) {}
  readonly address = dummyContractAddress();
  // Every event each call emitted, in order: { version, eventType, data }.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly events: any[][] = [];

  static async deploy<PS>(
    mod: { Contract: new (w: unknown) => AnyContract; ledger: (s: unknown) => AnyContract },
    witnesses: Record<string, (ctx: { privateState: PS }, ...a: unknown[]) => [PS, unknown]>,
    deployer: PS,
    ...args: unknown[]
  ): Promise<Sim9<PS>> {
    const c = new mod.Contract(witnesses);
    const r = await c.initialState(createConstructorContext(deployer, COIN_PK), ...args);
    return new Sim9<PS>(mod, c, r.currentContractState);
  }

  get ledger(): AnyContract {
    const s = this.state as { data?: unknown };
    return this.mod.ledger(s.data ?? this.state);
  }

  async call(who: PS, circuit: string, ...args: unknown[]): Promise<PS> {
    const ctx = createCircuitContext({
      circuitId: circuit,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: COIN_PK,
      contractState: this.state as never,
      privateState: who,
    });
    const { context } = await this.contract.impureCircuits[circuit](ctx, ...args);
    this.state = context.callContext.currentQueryContext.state;
    this.events.push(context.events);
    return context.callContext.currentPrivateState as PS;
  }
}

// The bytes an event carries, as one hex string.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const eventHex = (e: any): string => {
  const parts: Uint8Array[] = e?.data?.tag === 'cell' ? e.data.content.value : [];
  return parts.map((b) => Buffer.from(b).toString('hex')).join('');
};
