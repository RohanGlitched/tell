// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Runs Tell Desk in memory: one public state, many callers, each with their own
// private state, and a clock the caller controls. Each call also returns what the
// network would see of it (its circuit and public transcript), so tests can play an
// attacker who reads only public data, and, apart, what only the prover sees (the
// circuit's inputs and result).

import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { Contract, ledger, type Ledger } from './contract.js';
import { witnesses, type DeskPrivateState } from './witnesses.js';

const COIN_PK = '00'.repeat(32);

/**
 * What a transaction shows the world: which circuit it calls and its public transcript (every
 * ledger operation, with the values it reads and writes). A contract call on chain carries the
 * address, entry point, transcripts, proof and a hiding commitment to the call's inputs and
 * outputs (ledger `ContractCall.communicationCommitment`), not the inputs and outputs themselves.
 */
export type PublicView = { circuit: string; transcript: unknown };
/** What only the prover sees of a call: its arguments and result. */
export type ProverView = { input: unknown; output: unknown };

export class DeskSimulator {
  private state: unknown;
  readonly contract: InstanceType<typeof Contract>;
  /** Block time in seconds since the epoch. */
  time: number;
  /** Every transaction's public part, in order: the attacker's view besides the ledger. */
  readonly transactions: { circuit: string; view: PublicView; prover: ProverView }[] = [];

  /** `witnesses` replaces some of the real witnesses: how tests play a dishonest prover. */
  constructor(attesterHash: Uint8Array, embargoSeconds: bigint, opts: { time?: number; witnesses?: Partial<typeof witnesses> } = {}) {
    this.time = opts.time ?? 1_790_000_000;
    this.contract = new Contract({ ...witnesses, ...opts.witnesses } as never);
    const r = this.contract.initialState(createConstructorContext({ openings: {} } as DeskPrivateState, COIN_PK), attesterHash, embargoSeconds);
    this.state = r.currentContractState.data;
  }

  get ledger(): Ledger {
    return ledger(this.state as never);
  }
  /** The raw public state, as the indexer would return it. */
  get publicState(): unknown {
    return this.state;
  }

  advance(seconds: number) {
    this.time += seconds;
  }

  /** Runs a circuit as `who`. Throws (and leaves the state untouched) if the contract rejects it. */
  call(who: DeskPrivateState, circuit: string, ...args: unknown[]): { result: unknown; privateState: DeskPrivateState; view: PublicView; prover: ProverView } {
    const ctx = createCircuitContext(dummyContractAddress(), COIN_PK, this.state as never, who, undefined, undefined, this.time);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (this.contract.impureCircuits as any)[circuit](ctx, ...args);
    this.state = r.context.currentQueryContext.state;
    const view = { circuit, transcript: r.proofData.publicTranscript };
    const prover = { input: r.proofData.input, output: r.proofData.output };
    this.transactions.push({ circuit, view, prover });
    return { result: r.result, privateState: r.context.currentPrivateState, view, prover };
  }
}
