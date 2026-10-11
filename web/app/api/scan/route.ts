// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { checkSource, parseRepo, scanRepo, scanSource, sourceFileName, UserError, type ScanResponse } from '@/lib/scan';
import precomputed from '@/data/sample-results.json';

// The sample contracts' results, made by scripts/sample-results.ts with the same engine.
const SAMPLES = precomputed as unknown as Record<string, ScanResponse>;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const runtime = 'nodejs';
export const maxDuration = 60;

// Best effort, per instance: 30 scans per visitor per 10 minutes. Only scans that run the
// compiler count: not samples answered from SAMPLES, malformed requests, or refused ones.
const WINDOW = 600_000;
const LIMIT = 30;
const hits = new Map<string, number[]>();
function recent(ip: string): number[] {
  const now = Date.now();
  const r = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW);
  if (r.length) hits.set(ip, r);
  else hits.delete(ip);
  return r;
}
// Seconds until this visitor may scan again; 0 when a scan may run now (and is counted).
function take(ip: string): number {
  const r = recent(ip);
  if (r.length >= LIMIT) return Math.max(1, Math.ceil((r[0] + WINDOW - Date.now()) / 1000));
  hits.set(ip, [...r, Date.now()]);
  return 0;
}
function tooMany(wait: number) {
  const min = Math.ceil(wait / 60);
  return NextResponse.json(
    { error: `That is a lot of scans from one address. Try again in ${min} minute${min === 1 ? '' : 's'}, or run the CLI from github.com/RohanGlitched/tell.` },
    { status: 429, headers: { 'retry-after': String(wait) } },
  );
}

export function GET() {
  return NextResponse.json({
    usage: 'POST JSON to this URL: { "source": "<Compact contract>" } or { "repo": "owner/name" }.',
    docs: 'https://github.com/RohanGlitched/tell',
  });
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  let body: { source?: unknown; repo?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send JSON: { "source": "…" } or { "repo": "owner/name" }.' }, { status: 400 });
  }
  try {
    let out: ScanResponse;
    if (typeof body.repo === 'string' && body.repo.trim()) {
      if (!parseRepo(body.repo)) throw new UserError('Give a public GitHub repository, like `github.com/owner/repo`.');
      const wait = take(ip);
      if (wait) return tooMany(wait);
      out = await scanRepo(body.repo);
    } else if (typeof body.source === 'string') {
      const name = typeof body.name === 'string' ? body.name : undefined;
      const sample = SAMPLES[sha(body.source)];
      if (sample) {
        // A sample button: answer from the precomputed result, under the sample's own file name.
        out = { ...sample, contracts: sample.contracts.map((c) => ({ ...c, file: sourceFileName(name) })) };
      } else {
        checkSource(body.source);
        const wait = take(ip);
        if (wait) return tooMany(wait);
        out = await scanSource(body.source, name);
      }
    } else {
      return NextResponse.json({ error: 'Send a contract (`source`) or a repository (`repo`).' }, { status: 400 });
    }
    return new NextResponse(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error('scan failed', e);
    return NextResponse.json({ error: 'The scan failed on our side. Try again, or run the CLI from github.com/RohanGlitched/tell.' }, { status: 500 });
  }
}
