#!/usr/bin/env -S npx tsx
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// radar tables   (build the numeric hash tables once)
// radar crawl    --network preprod [--from H] [--to H] [--days N] [--budget N]
// radar discover --network preprod --dir DIR [--budget N]
// radar scan     --network preprod [--addresses FILE] [--max N] [--actions N] [--budget N] [--deep] [--offline]
//
// Everything fetched is cached under $RADAR_HOME (default ~/.cache/tell-radar);
// a second run reads the cache and sends nothing it already has.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, digest, type Digested } from './analyze.js';
import { BLOCKS_PER_REQUEST, crawl, fetchContract, harvestCandidates, loadCrawl, tip, verifyAddresses } from './chain.js';
import { BudgetExceeded, Indexer, type Network } from './indexer.js';
import { aggregate, details, type Own } from './report.js';
import { HashPool } from './brute.js';
import { buildTable } from './table.js';
import { numericTables } from './tables.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.RADAR_HOME ?? path.join(os.homedir(), '.cache', 'tell-radar');

function args(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) flags[k] = true;
      else { flags[k] = v; i++; }
    } else pos.push(a);
  }
  return { cmd: pos[0], flags };
}

const log = (s: string) => process.stderr.write(`${s}\n`);
const num = (v: string | boolean | undefined, d: number) => (typeof v === 'string' ? Number(v) : d);

function readList(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split(/\s+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[0-9a-f]{64}$/.test(s));
}

function ownContracts(network: string): Own {
  // Tell's own demo ballots are the only contracts the public report names.
  const f = path.join(ROOT, 'own.json');
  if (!fs.existsSync(f)) return {};
  const all = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, Own>;
  return all[network] ?? {};
}

async function main() {
  const { cmd, flags } = args(process.argv.slice(2));
  const network = (flags.network ?? 'preprod') as Network;
  const ix = new Indexer({ network, cacheDir: HOME, budget: num(flags.budget, 500), minIntervalMs: num(flags.interval, 250), offline: !!flags.offline });
  const crawlFile = path.join(HOME, `crawl-${network}.json`);
  const discoveredFile = path.join(HOME, `discovered-${network}.txt`);
  try {
    if (cmd === 'tables') {
      // Builds the numeric tables ahead of a scan (about 400 MB on disk), one at a time.
      const pool = new HashPool(new Float64Array(0));
      try {
        for (const f of numericTables(1 << 24)) await buildTable(f, path.join(HOME, 'tables'), { pool, log });
      } finally {
        await pool.close();
      }
      log(`tables ready in ${path.join(HOME, 'tables')}`);
    } else if (cmd === 'crawl') {
      const top = typeof flags.to === 'string' ? Number(flags.to) : await tip(ix);
      const from = typeof flags.from === 'string' ? Number(flags.from) : Math.max(0, top - num(flags.days, 7) * 14_400);
      log(`crawling ${network} blocks ${from}..${top} (${Math.ceil((top - from + 1) / BLOCKS_PER_REQUEST)} requests at most, budget ${ix.budget})`);
      const st = await crawl(ix, crawlFile, from, top, log);
      const blocks = st.done.reduce((n, [a, b]) => n + b - a + 1, 0);
      log(`done: ${blocks} blocks covered in ${st.done.length} range(s), ${Object.keys(st.contracts).length} contracts, ${ix.sent} requests sent, ${ix.cached} from cache`);
    } else if (cmd === 'discover') {
      if (typeof flags.dir !== 'string') throw new Error('--dir is required');
      const cands = harvestCandidates(flags.dir);
      log(`${cands.length} 64-hex strings under ${flags.dir}`);
      const found = await verifyAddresses(ix, cands);
      const prev = fs.existsSync(discoveredFile) ? readList(discoveredFile) : [];
      const all = [...new Set([...prev, ...found])];
      fs.mkdirSync(HOME, { recursive: true });
      fs.writeFileSync(discoveredFile, all.join('\n') + '\n');
      log(`${found.length} are contracts on ${network} (${all.length} known in total); ${ix.sent} requests sent`);
    } else if (cmd === 'scan') {
      const sources: Record<string, unknown> = {};
      const addrs = new Set<string>();
      const own = ownContracts(network);
      for (const a of Object.keys(own)) addrs.add(a);
      sources.own = Object.keys(own).length;
      if (typeof flags.addresses === 'string') { const l = readList(flags.addresses); l.forEach((a) => addrs.add(a)); sources.addressFile = l.length; }
      if (!flags['only-addresses']) {
        const st = loadCrawl(crawlFile, network);
        Object.keys(st.contracts).forEach((a) => addrs.add(a));
        sources.crawl = { contracts: Object.keys(st.contracts).length, blocks: st.done.reduce((n, [a, b]) => n + b - a + 1, 0), ranges: st.done };
        if (fs.existsSync(discoveredFile)) { const l = readList(discoveredFile); l.forEach((a) => addrs.add(a)); sources.discovered = l.length; }
      }
      const list = [...addrs].slice(0, num(flags.max, Infinity));
      const limit = num(flags.actions, 100);
      log(`scanning ${list.length} contracts (up to ${limit} recent actions each)`);
      const records: Digested[] = [];
      let missing = 0;
      // Decoding proofs-carrying transactions is the slow part; keep each contract's digest.
      const digestDir = path.join(HOME, 'digest', network);
      fs.mkdirSync(digestDir, { recursive: true });
      for (const [i, a] of list.entries()) {
        try {
          const df = path.join(digestDir, `${a}-${limit}.json`);
          if (!flags.refresh && fs.existsSync(df)) {
            records.push(JSON.parse(fs.readFileSync(df, 'utf8')) as Digested);
            continue;
          }
          const r = await fetchContract(ix, a, limit);
          if (r) {
            const d = digest(r);
            fs.writeFileSync(df, JSON.stringify(d));
            records.push(d);
          } else missing++;
        } catch (e) {
          if (e instanceof BudgetExceeded) { log(`stopped fetching after ${i} contracts: ${e.message}`); break; }
          log(`  ${a.slice(0, 8)}…: ${(e as Error).message.slice(0, 120)}`);
        }
        if ((i + 1) % 25 === 0) log(`  fetched ${i + 1}/${list.length} (${ix.sent} requests)`);
      }
      sources.requestsThisRun = ix.sent;
      sources.notFound = missing;
      const a = await analyze(records, { deep: !!flags.deep, tableDir: flags['no-tables'] ? undefined : path.join(HOME, 'tables'), threads: typeof flags.threads === 'string' ? Number(flags.threads) : undefined, log });
      const agg = aggregate(a, network, sources, own);
      const out = typeof flags.out === 'string' ? flags.out : path.join(ROOT, 'out', 'report.json');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(agg, null, 2) + '\n');
      const priv = typeof flags.private === 'string' ? flags.private : path.join(HOME, 'private', `details-${network}.json`);
      fs.mkdirSync(path.dirname(priv), { recursive: true, mode: 0o700 });
      fs.writeFileSync(priv, JSON.stringify(details(a), null, 2) + '\n', { mode: 0o600 });
      log(`aggregate report: ${out}`);
      log(`private details (do not publish): ${priv}`);
      process.stdout.write(JSON.stringify({ contracts: agg.contracts, guessableHashes: agg.guessableHashes, repeatedHiddenValues: agg.repeatedHiddenValues, linkableTags: agg.linkableTags, crossContract: agg.crossContract, own: agg.own }, null, 2) + '\n');
    } else {
      log('usage: radar crawl|discover|scan --network preprod [options]  (see radar/README.md)');
      process.exitCode = 2;
    }
  } finally {
    log(`indexer requests sent this run: ${ix.sent}`);
  }
}

main().catch((e) => {
  log(`radar: ${(e as Error).message}`);
  process.exit(1);
});
