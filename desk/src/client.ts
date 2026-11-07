// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// A small client for Tell Desk on a Midnight network, built on midnight-js. Each
// role (researcher, maintainer, attester) is a private state id in the caller's
// private-state store; secrets and openings never leave it except where a circuit
// discloses them (see desk/README.md).

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { Contract, pureCircuits, type Opening } from './contract.js';
import { witnesses, emptyPrivateState, type DeskPrivateState } from './witnesses.js';
import { fromHex, gradeToNumber, nowSeconds, projectId, randomBytes32, reportDigest, toHex, type GradeLetter } from './codec.js';
import { readDesk, type DeskView } from './view.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeskProviders = MidnightProviders<any, string, DeskPrivateState>;

/** The contract with its witnesses and the keys in `assetsDir` (`npm run compact:keys -w desk` writes keys/desk). */
export const compiledDesk = (assetsDir: string) =>
  CompiledContract.make('tell-desk', Contract).pipe(CompiledContract.withWitnesses(witnesses as never), CompiledContract.withCompiledFileAssets(assetsDir));

/** The credential leaf a maintainer hands to Tell to be registered: hides both the secret and the project. */
export const credentialLeaf = async (maintainerSecret: Uint8Array, repoUrl: string) => pureCircuits.maintainerLeaf(maintainerSecret, await projectId(repoUrl));

export const attesterHash = (attesterSecret: Uint8Array) => pureCircuits.attesterKey(attesterSecret);

/** A new sealed-report opening: the report's digest, its project, and a fresh nonce. */
export async function newOpening(text: string, repoUrl: string): Promise<Opening> {
  return { finding: { digest: await reportDigest(text), project: await projectId(repoUrl) }, nonce: randomBytes32() };
}

/** What a researcher sends a maintainer off chain, with the report text itself. */
export type Note = { id: string; digest: string; project: string; nonce: string };
export const noteOf = (id: string, o: Opening): Note => ({ id, digest: toHex(o.finding.digest), project: toHex(o.finding.project), nonce: toHex(o.nonce) });
export const openingOfNote = (n: Note): Opening => ({ finding: { digest: fromHex(n.digest), project: fromHex(n.project) }, nonce: fromHex(n.nonce) });

type Tx = { txId: string };

export class DeskClient {
  private constructor(
    readonly providers: DeskProviders,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly compiled: any,
    readonly address: string,
  ) {
    providers.privateStateProvider.setContractAddress(address as never);
  }

  static async deploy(
    providers: DeskProviders,
    assetsDir: string,
    opts: { attesterHash: Uint8Array; embargoSeconds: bigint; privateStateId: string; initialPrivateState?: DeskPrivateState },
  ): Promise<{ client: DeskClient; txId: string }> {
    const compiled = compiledDesk(assetsDir);
    const deployed = await deployContract(providers as never, {
      compiledContract: compiled as never,
      privateStateId: opts.privateStateId,
      initialPrivateState: opts.initialPrivateState ?? emptyPrivateState(),
      args: [opts.attesterHash, opts.embargoSeconds],
    } as never);
    const d = deployed as unknown as { deployTxData: { public: { contractAddress: string; txId: string } } };
    return { client: new DeskClient(providers, compiled, d.deployTxData.public.contractAddress), txId: d.deployTxData.public.txId };
  }

  static join(providers: DeskProviders, assetsDir: string, address: string): DeskClient {
    return new DeskClient(providers, compiledDesk(assetsDir), address);
  }

  async privateState(as: string): Promise<DeskPrivateState> {
    return (await this.providers.privateStateProvider.get(as)) ?? emptyPrivateState();
  }
  async setPrivateState(as: string, ps: DeskPrivateState) {
    await this.providers.privateStateProvider.set(as, ps);
  }
  /** Adds secrets or openings to a role's private state. */
  async update(as: string, f: (ps: DeskPrivateState) => DeskPrivateState) {
    await this.setPrivateState(as, f(await this.privateState(as)));
  }

  private async call(as: string, circuitId: string, args: unknown[]): Promise<Tx & { result: unknown }> {
    const r = (await submitCallTx(this.providers as never, { compiledContract: this.compiled, contractAddress: this.address, privateStateId: as, circuitId, args } as never)) as unknown as {
      public: { txId: string };
      private: { result: unknown };
    };
    return { txId: r.public.txId, result: r.private.result };
  }

  // ------------------------------------------------------------ researcher

  /** Seals a report about a repository. Returns the report id and the note to send its maintainer. */
  async seal(as: string, text: string, repoUrl: string, now = nowSeconds()): Promise<Tx & { id: string; note: Note }> {
    const opening = await newOpening(text, repoUrl);
    await this.update(as, (ps) => ({ ...ps, draft: opening }));
    const { txId, result } = await this.call(as, 'seal', [now]);
    const id = toHex(result as Uint8Array);
    await this.update(as, (ps) => ({ ...ps, draft: undefined, openings: { ...ps.openings, [id]: opening } }));
    return { txId, id, note: noteOf(id, opening) };
  }

  retract(as: string, id: string, now = nowSeconds()): Promise<Tx> {
    return this.call(as, 'retract', [fromHex(id), now]);
  }

  // ------------------------------------------------------------ maintainer

  /** Stores the opening a researcher sent, so this maintainer can acknowledge and fix the report. */
  receive(as: string, note: Note) {
    return this.update(as, (ps) => ({ ...ps, openings: { ...ps.openings, [note.id]: openingOfNote(note) } }));
  }
  acknowledge(as: string, id: string, now = nowSeconds()): Promise<Tx> {
    return this.call(as, 'acknowledge', [fromHex(id), now]);
  }
  markFixed(as: string, id: string, now = nowSeconds()): Promise<Tx> {
    return this.call(as, 'markFixed', [fromHex(id), now]);
  }
  async selfGrade(as: string, codeHash: Uint8Array, repoUrl: string, grade: GradeLetter, rules: bigint, scan: bigint): Promise<Tx> {
    return this.call(as, 'selfGrade', [codeHash, await projectId(repoUrl), gradeToNumber(grade), rules, scan]);
  }

  // ------------------------------------------------------------ either side

  /** Publishes the opening of a fixed (or embargo-expired) report this role holds. */
  async reveal(as: string, id: string): Promise<Tx> {
    const o = (await this.privateState(as)).openings[id];
    if (!o) throw new Error(`no opening for report ${id} in ${as}'s private state`);
    return this.call(as, 'reveal', [fromHex(id), o]);
  }

  // ------------------------------------------------------------ attester

  registerMaintainer(as: string, leaf: Uint8Array): Promise<Tx> {
    return this.call(as, 'registerMaintainer', [leaf]);
  }
  attest(as: string, codeHash: Uint8Array, grade: GradeLetter, rules: bigint, scan: bigint): Promise<Tx> {
    return this.call(as, 'attest', [codeHash, gradeToNumber(grade), rules, scan]);
  }
  handOver(as: string, newAttesterHash: Uint8Array): Promise<Tx> {
    return this.call(as, 'handOver', [newAttesterHash]);
  }

  // ------------------------------------------------------------ public

  async view(): Promise<DeskView> {
    const s = await this.providers.publicDataProvider.queryContractState(this.address as never);
    if (!s) throw new Error(`no contract at ${this.address}`);
    return readDesk(s.data);
  }
}

export { randomBytes32 };
