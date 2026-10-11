// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server';
import { scanRepo, scanSource, UserError } from '@/lib/scan';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Best effort, per instance: 30 scans per visitor per 10 minutes.
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30;
}

export function GET() {
  return NextResponse.json({
    usage: 'POST JSON to this URL: { "source": "<Compact contract>" } or { "repo": "owner/name" }.',
    docs: 'https://github.com/RohanGlitched/tell',
  });
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  if (limited(ip)) return NextResponse.json({ error: 'That is a lot of scans. Wait a few minutes, or use the CLI.' }, { status: 429 });
  let body: { source?: unknown; repo?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send JSON: { "source": "…" } or { "repo": "owner/name" }.' }, { status: 400 });
  }
  try {
    const out =
      typeof body.repo === 'string' && body.repo.trim()
        ? await scanRepo(body.repo)
        : typeof body.source === 'string'
          ? await scanSource(body.source, typeof body.name === 'string' ? body.name : undefined)
          : null;
    if (!out) return NextResponse.json({ error: 'Send a contract (`source`) or a repository (`repo`).' }, { status: 400 });
    return new NextResponse(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error('scan failed', e);
    return NextResponse.json({ error: 'The scan failed on our side. Try again, or run the CLI from github.com/RohanGlitched/tell.' }, { status: 500 });
  }
}
