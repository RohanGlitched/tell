// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell Desk's private state and witnesses. Everything here stays on the caller's
// device: the circuits read it to build a proof, and only what a circuit
// disclose()s reaches the public ledger.

import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { Ledger, Opening } from './contract.js';
import { toHex } from './codec.js';

/**
 * One party's private state. A single device may hold several roles (the demo's
 * house wallet does), but in practice a researcher holds `researcherSecret`, a
 * maintainer `maintainerSecret`, and only Tell holds `attesterSecret`.
 */
export type DeskPrivateState = {
  researcherSecret?: Uint8Array;
  maintainerSecret?: Uint8Array;
  attesterSecret?: Uint8Array;
  /** The finding being sealed next, with its fresh nonce. */
  draft?: Opening;
  /** Openings this party holds, by report id (hex): its own seals and reports sent to it. */
  openings: Record<string, Opening>;
};

export const emptyPrivateState = (): DeskPrivateState => ({ openings: {} });

type Ctx = WitnessContext<Ledger, DeskPrivateState>;

const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`Tell Desk: this private state holds no ${what}`);
  return v;
};

export const witnesses = {
  researcherSecret: ({ privateState }: Ctx): [DeskPrivateState, Uint8Array] => [privateState, need(privateState.researcherSecret, 'researcher secret')],
  maintainerSecret: ({ privateState }: Ctx): [DeskPrivateState, Uint8Array] => [privateState, need(privateState.maintainerSecret, 'maintainer secret')],
  attesterSecret: ({ privateState }: Ctx): [DeskPrivateState, Uint8Array] => [privateState, need(privateState.attesterSecret, 'attester secret')],
  draft: ({ privateState }: Ctx): [DeskPrivateState, Opening] => [privateState, need(privateState.draft, 'draft finding')],
  openingOf: ({ privateState }: Ctx, id: Uint8Array): [DeskPrivateState, Opening] => [privateState, need(privateState.openings[toHex(id)], `opening for report ${toHex(id)}`)],
  // The path comes from the public tree; the leaf (and so the secret and project) never leaves the device.
  maintainerPath: ({ privateState, ledger }: Ctx, leaf: Uint8Array) => {
    const path = ledger.maintainers.findPathForLeaf(leaf);
    if (!path) throw new Error('Tell Desk: this maintainer credential is not registered for that project');
    return [privateState, path] as [DeskPrivateState, typeof path];
  },
};
