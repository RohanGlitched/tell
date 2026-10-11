// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Deploys the leaky and the fixed ballot to Midnight Preview and casts the same
// demo votes into both. The website then reads both contracts' public state
// from the indexer and shows which one gives every vote away.
//   npm run deploy -w chain -- [voters=6]

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { House, ROOT, logger, NET, NETWORK } from '../src/house.js';
import { providers } from '../src/providers.js';

const VOTERS = Number(process.argv[2] ?? 6);
const CANDIDATES = ['Asha', 'Bilal', 'Chen', 'Dara'];
const OUT = path.join(ROOT, NETWORK === 'preview' ? 'deployments.json' : `deployments-${NETWORK}.json`);
const ZOO_KEYS = path.resolve(ROOT, '../zoo/keys');

type PS = { key: Uint8Array; choice: bigint; salt: Uint8Array };
const witnesses = {
  voterKey: ({ privateState }: { privateState: PS }) => [privateState, privateState.key],
  choice: ({ privateState }: { privateState: PS }) => [privateState, privateState.choice],
  ballotSalt: ({ privateState }: { privateState: PS }) => [privateState, privateState.salt],
};

type Deployment = { contract: string; address: string; deployTx: string; votes: { voter: number; choice: string; registerTx: string; voteTx: string }[] };
const state: Record<string, Deployment> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const save = () => fs.writeFileSync(OUT, JSON.stringify(state, null, 2));

// The node rejects a transaction that spends DUST the wallet has not yet seen settle; resync and retry.
async function retry<T>(what: string, f: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries) throw e;
      logger.warn(`${what} failed (${String(e).slice(0, 160)}); resyncing and retrying (${i}/${tries - 1})`);
      await new Promise((r) => setTimeout(r, 20_000 * i));
      await house.sync();
    }
  }
}

const house = await House.open();
await house.start();
await house.sync();
logger.info(await house.summary());

// The same voters and choices go into both ballots.
const voters: PS[] = Array.from({ length: VOTERS }, (_, i) => ({
  key: new Uint8Array(randomBytes(32)),
  choice: BigInt([2, 0, 2, 1, 3, 2, 0, 2][i % 8]),
  salt: new Uint8Array(randomBytes(32)),
}));

for (const name of ['ballot-leaky', 'ballot-fixed']) {
  const dir = path.join(ZOO_KEYS, name);
  const mod = await import(path.join(dir, 'contract/index.js'));
  const compiled = CompiledContract.make(name, mod.Contract).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(dir),
  );
  const p = providers(house, dir, `tell-${name}`);

  let dep = state[name];
  if (!dep) {
    logger.info(`deploying ${name}…`);
    const t = Date.now();
    const deployed = await retry(`deploy ${name}`, () => deployContract(p as never, { compiledContract: compiled as never, privateStateId: 'deployer', initialPrivateState: voters[0] } as never));
    const d = deployed as unknown as { deployTxData: { public: { contractAddress: string; txId: string } } };
    dep = state[name] = { contract: name, address: d.deployTxData.public.contractAddress, deployTx: d.deployTxData.public.txId, votes: [] };
    save();
    logger.info(`${name} at ${dep.address} (${Math.round((Date.now() - t) / 1000)} s)`);
  }

  p.privateStateProvider.setContractAddress(dep.address);
  for (let i = dep.votes.length; i < voters.length; i++) {
    const v = voters[i];
    const id = `voter-${i}`;
    await p.privateStateProvider.set(id, v as never);
    const t = Date.now();
    const call = (circuitId: string) =>
      retry(`${name} voter ${i} ${circuitId}`, async () =>
        (await submitCallTx(p as never, { compiledContract: compiled as never, contractAddress: dep.address, privateStateId: id, circuitId, args: [] } as never)) as unknown as { public: { txId: string } },
      );
    const reg = await call('register');
    const vote = await call('vote');
    dep.votes.push({ voter: i, choice: CANDIDATES[Number(v.choice)], registerTx: reg.public.txId, voteTx: vote.public.txId });
    save();
    logger.info(`${name}: voter ${i} voted ${CANDIDATES[Number(v.choice)]} (${Math.round((Date.now() - t) / 1000)} s)`);
  }
}

logger.info(`done; explorer: ${NET.explorer}`);
await house.stop();
process.exit(0);
