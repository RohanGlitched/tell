// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The house wallet: deploys Tell's demo contracts on a Midnight test network, casts the
// demo ballots, and pays DUST fees for visitors' already-proven transactions.
// On Preview it starts from Midnight's reference bundle (fast sync), proves in WASM,
// and saves its own state after every sync so restarts take seconds.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino, { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { DustAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk/address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { MidnightProvider, UnboundTransaction, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import type { FacadeState } from '@midnight-ntwrk/wallet-sdk';
import { assembleWallet, type AssembledWallet } from './fast-sync/fast-wallet.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SECRETS = process.env.TELL_SECRETS ?? path.join(ROOT, 'secrets');

// Which Midnight test network the house lives on: TELL_NETWORK=preview (default)
// or preprod. Preprod is served by Blockfrost since Oct 9 2026 and needs a
// project id, read from BLOCKFROST_PROJECT_ID or secrets/blockfrost-preprod.
export const NETWORK = (process.env.TELL_NETWORK ?? 'preview') as 'preview' | 'preprod';

const PREVIEW_NET = {
  networkId: 'preview',
  walletNetworkId: 'preview',
  indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preview.midnight.network',
  nodeWS: 'wss://rpc.preview.midnight.network',
  proofServer: 'http://127.0.0.1:6300', // unused: everything proves in WASM
  faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
  explorer: 'https://preview.midnightexplorer.com',
};

function blockfrostKey(): string {
  const env = process.env.BLOCKFROST_PROJECT_ID?.trim();
  if (env) return env;
  const f = path.join(SECRETS, 'blockfrost-preprod');
  if (!fs.existsSync(f)) throw new Error(`Preprod needs a Blockfrost project id: set BLOCKFROST_PROJECT_ID or write it to ${f}`);
  return fs.readFileSync(f, 'utf8').trim();
}

function preprodNet() {
  const key = encodeURIComponent(blockfrostKey());
  return {
    networkId: 'preprod',
    walletNetworkId: 'preprod',
    indexer: `https://midnight-preprod.blockfrost.io/api/v0?project_id=${key}`,
    indexerWS: `wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=${key}`,
    node: `https://rpc.midnight-preprod.blockfrost.io?project_id=${key}`,
    nodeWS: `wss://rpc.midnight-preprod.blockfrost.io?project_id=${key}`,
    proofServer: 'http://127.0.0.1:6300',
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
    explorer: 'https://preprod.midnightexplorer.com',
  };
}

/** The endpoints for NETWORK. URLs may carry a Blockfrost key: never log them. */
export const NET = NETWORK === 'preprod' ? preprodNet() : PREVIEW_NET;

export const logger: Logger = pino({ level: process.env.LOG_LEVEL ?? 'info', transport: { target: 'pino-pretty' } });

const strict = (p: unknown) =>
  !!p && typeof (p as { isStrictlyComplete?: unknown }).isStrictlyComplete === 'function' && (p as { isStrictlyComplete: () => boolean }).isStrictlyComplete();

// "applied/highest" for each sub-wallet, as far as the SDK exposes it.
function progressText(st: FacadeState): string {
  const p = (x: unknown) => {
    const o = x as Record<string, unknown> | undefined;
    if (!o) return '?';
    const a = o.appliedIndex;
    const h = o.highestRelevantIndex ?? o.highestRelevantWalletIndex ?? o.highestIndex;
    return `${a ?? '?'}/${h ?? '?'}`;
  };
  return `shielded ${p(st.shielded.state.progress)}, dust ${p(st.dust.state.progress)}, unshielded ${p(st.unshielded.progress)}`;
}

const stateDir = () => path.join(SECRETS, NETWORK === 'preview' ? 'house-state' : `house-state-${NETWORK}`);

export function readSeed(): string {
  const env = process.env.TELL_HOUSE_SEED?.trim();
  if (env) return env;
  const f = path.join(SECRETS, 'house.seed');
  if (!fs.existsSync(f)) throw new Error(`No house seed at ${f}`);
  return fs.readFileSync(f, 'utf8').trim();
}

function readSaved() {
  const d = stateDir();
  const get = (n: string) => (fs.existsSync(path.join(d, n)) ? fs.readFileSync(path.join(d, n), 'utf8') : undefined);
  const shielded = get('shielded.json');
  const unshielded = get('unshielded.json');
  const dust = get('dust.json');
  return shielded && unshielded ? { shielded, unshielded, dust } : undefined;
}

export class House implements WalletProvider, MidnightProvider {
  private constructor(readonly w: AssembledWallet) {}

  static async open(opts: { fresh?: boolean } = {}): Promise<House> {
    const saved = opts.fresh ? undefined : readSaved();
    const w = await assembleWallet(logger, NET as never, { kind: 'seed', value: readSeed() }, { referenceRoot: path.join(ROOT, 'preseed'), saved });
    return new House(w);
  }

  get facade() {
    return this.w.facade;
  }
  get address(): string {
    return this.w.keystore.getBech32Address().toString();
  }
  getCoinPublicKey() {
    return this.w.zswapSecretKeys.coinPublicKey;
  }
  getEncryptionPublicKey() {
    return this.w.zswapSecretKeys.encryptionPublicKey;
  }
  private keys() {
    return { shieldedSecretKeys: this.w.zswapSecretKeys, dustSecretKey: this.w.dustSecretKey };
  }

  async start() {
    await this.facade.start(this.w.zswapSecretKeys, this.w.dustSecretKey);
  }
  async stop() {
    await this.save().catch((e) => logger.warn(`could not save wallet state: ${e}`));
    await this.facade.stop();
  }

  // Fails only when the chain stops sending updates for `stallMs`; saves progress as it goes,
  // so an interrupted first sync resumes where it stopped.
  async sync(stallMs = 300_000): Promise<FacadeState> {
    let n = 0;
    let saving = false;
    const t = Date.now();
    const s = await Rx.firstValueFrom(
      this.facade.state().pipe(
        Rx.timeout({ each: stallMs, with: () => Rx.throwError(() => new Error(`wallet sync stalled: no update for ${stallMs} ms`)) }),
        Rx.tap((st) => {
          if (++n % 200 === 0) logger.info(`syncing… ${n} updates, ${Math.round((Date.now() - t) / 1000)} s; ${progressText(st)}`);
          if (n % 2000 === 0 && !saving) {
            saving = true;
            this.save()
              .catch((e) => logger.warn(`could not save wallet state: ${e}`))
              .finally(() => (saving = false));
          }
        }),
        Rx.filter((st) => strict(st.shielded.state.progress) && strict(st.dust.state.progress) && strict(st.unshielded.progress)),
      ),
    );
    logger.info(`synced in ${Math.round((Date.now() - t) / 1000)} s (${n} updates)`);
    await this.save();
    return s;
  }

  async save() {
    fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    const sub = this.w.subWallets;
    for (const [name, wallet] of Object.entries(sub)) fs.writeFileSync(path.join(stateDir(), `${name}.json`), await wallet.serializeState(), { mode: 0o600 });
  }

  async summary() {
    const s = await this.facade.waitForSyncedState();
    const night = Object.values(s.unshielded.balances ?? {}).reduce((a: bigint, b) => a + (b as bigint), 0n);
    const dust = s.dust.balance(new Date());
    return {
      address: this.address,
      night: Number(night) / 1e6,
      dust: Number(dust) / 1e15,
      dustCoins: s.dust.availableCoins.length,
      unregisteredNightUtxos: s.unshielded.availableCoins.filter((c) => c.meta?.registeredForDustGeneration !== true).length,
    };
  }

  async registerForDust(): Promise<string | null> {
    const s = await this.facade.waitForSyncedState();
    const unregistered = s.unshielded.availableCoins.filter((c) => c.meta?.registeredForDustGeneration !== true);
    if (unregistered.length === 0) return null;
    const receiver = MidnightBech32m.parse(String(DustAddress.encodePublicKey(getNetworkId(), s.dust.publicKey))).decode(DustAddress, getNetworkId());
    const { fee } = await this.facade.estimateRegistration(unregistered);
    logger.info(`registration fee ${fee}; waiting for the NIGHT to accrue it…`);
    await this.facade.waitForGeneratedDust(unregistered, fee);
    const recipe = await this.facade.registerNightUtxosForDustGeneration(
      unregistered,
      this.w.keystore.getPublicKey(),
      (p) => this.w.keystore.signData(p),
      receiver,
    );
    return this.facade.submitTransaction(await this.facade.finalizeRecipe(recipe));
  }

  // WalletProvider: balance and pay our own transactions.
  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.facade.balanceUnboundTransaction(tx, this.keys(), { ttl });
    const signed = await this.facade.signRecipe(recipe, (p) => this.w.keystore.signData(p));
    return this.facade.finalizeRecipe(signed);
  }
  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.facade.submitTransaction(tx);
  }

  // Sponsor: attach only a DUST fee to someone else's proven, bound transaction.
  async sponsor(tx: FinalizedTransaction, ttl: Date = ttlOneHour()): Promise<string> {
    const recipe = await this.facade.balanceFinalizedTransaction(tx, this.keys(), { ttl, tokenKindsToBalance: ['dust'] });
    const signed = await this.facade.signRecipe(recipe, (p) => this.w.keystore.signData(p));
    return this.facade.submitTransaction(await this.facade.finalizeRecipe(signed));
  }
}
