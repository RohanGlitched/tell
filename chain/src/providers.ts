// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// midnight-js providers for the house: proofs are made in WASM in this process
// (zkir-v2's prover, the same one Midnight's testkit uses), so no proof server.

import path from 'node:path';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { createProofProvider, type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { WasmProver } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import { provingProvider } from '@midnight-ntwrk/zkir-v2';
import { type House, NET, SECRETS } from './house.js';

export function wasmProofProvider(zk: NodeZkConfigProvider<string>) {
  const defaults = WasmProver.makeDefaultKeyMaterialProvider();
  const prover = provingProvider({
    async lookupKey(location: string) {
      const [ir, proverKey, verifierKey] = await Promise.all([zk.getZKIR(location), zk.getProverKey(location), zk.getVerifierKey(location)]);
      return { ir, proverKey, verifierKey };
    },
    getParams: (k: number) => defaults.getParams(k),
  } as never);
  return createProofProvider(prover as never);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function providers(house: House, keysDir: string, store: string): MidnightProviders<any> {
  const zk = new NodeZkConfigProvider<string>(keysDir);
  return {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: path.join(SECRETS, 'private-state'),
      privateStateStoreName: store,
      privateStoragePasswordProvider: () => 'Tell-house-1!',
      accountId: house.getCoinPublicKey(),
    } as never),
    publicDataProvider: indexerPublicDataProvider(NET.indexer, NET.indexerWS),
    zkConfigProvider: zk,
    proofProvider: wasmProofProvider(zk) as never,
    walletProvider: house,
    midnightProvider: house,
  } as never;
}
