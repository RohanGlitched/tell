// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// A careful GraphQL client for the Midnight indexer. Preprod is served by
// Blockfrost, whose project id travels in the URL: the URL is built here and
// never leaves this module (errors are rewritten so it cannot be logged).
// Every response is cached on disk by query, requests are spaced out, and a
// budget caps how many may be sent in one run.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type Network = 'preprod' | 'preview';

export function blockfrostKey(): string {
  const env = process.env.BLOCKFROST_PROJECT_ID?.trim();
  if (env) return env;
  const file = process.env.RADAR_BLOCKFROST_FILE;
  if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  throw new Error('Preprod needs a Blockfrost project id: set BLOCKFROST_PROJECT_ID or RADAR_BLOCKFROST_FILE');
}

function endpoint(network: Network): string {
  if (network === 'preview') return 'https://indexer.preview.midnight.network/api/v4/graphql';
  return `https://midnight-preprod.blockfrost.io/api/v0?project_id=${encodeURIComponent(blockfrostKey())}`;
}

export class BudgetExceeded extends Error {}

export type IndexerOptions = { network: Network; cacheDir: string; budget?: number; minIntervalMs?: number; offline?: boolean };

export class Indexer {
  readonly network: Network;
  private readonly cacheDir: string;
  private readonly minInterval: number;
  private readonly offline: boolean;
  budget: number;
  sent = 0;
  cached = 0;
  private last = 0;

  constructor(o: IndexerOptions) {
    this.network = o.network;
    this.cacheDir = path.join(o.cacheDir, 'gql', o.network);
    this.budget = o.budget ?? 1000;
    this.minInterval = o.minIntervalMs ?? 250;
    this.offline = o.offline ?? false;
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  private file(query: string): string {
    const h = createHash('sha256').update(query).digest('hex');
    return path.join(this.cacheDir, h.slice(0, 2), `${h}.json`);
  }

  /** Is this exact query answered from the cache? */
  has(query: string): boolean {
    return fs.existsSync(this.file(query));
  }

  /** Runs a query; `cache: false` for answers that change (the chain tip). */
  async query<T = Record<string, unknown>>(query: string, opts: { cache?: boolean } = {}): Promise<T> {
    const useCache = opts.cache !== false;
    const f = this.file(query);
    if (useCache && fs.existsSync(f)) {
      this.cached++;
      return JSON.parse(fs.readFileSync(f, 'utf8')) as T;
    }
    if (this.offline) throw new BudgetExceeded('offline: answer not in the cache');
    if (this.sent >= this.budget) throw new BudgetExceeded(`request budget of ${this.budget} reached`);
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.minInterval - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      this.sent++;
      let status = 0;
      let text = '';
      try {
        const r = await fetch(endpoint(this.network), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
        status = r.status;
        text = await r.text();
      } catch (e) {
        // Network errors can quote the URL; keep only the code.
        const code = (e as { cause?: { code?: string } }).cause?.code ?? 'fetch failed';
        if (attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
        throw new Error(`indexer unreachable (${code})`);
      }
      if ((status === 429 || status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      if (status !== 200) throw new Error(`indexer answered HTTP ${status}: ${text.slice(0, 200)}`);
      const body = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
      if (body.errors?.length || !body.data) throw new Error(`indexer error: ${body.errors?.map((e) => e.message).join('; ') ?? 'no data'}`);
      if (useCache) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(body.data));
      }
      return body.data;
    }
  }
}
