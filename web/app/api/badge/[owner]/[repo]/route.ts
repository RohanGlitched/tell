// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// README badge: GET /api/badge/<owner>/<repo> answers an SVG "Tell | grade B" for a public
// GitHub repository, graded by its worst contract on the default branch. The scan is the same
// as the scanner's repository scan; results are cached for a day (data cache and CDN), so a
// README view almost never runs the compiler.

import { unstable_cache } from 'next/cache';
import { scanRepo, UserError } from '@/lib/scan';
import { badgeSvg, validRepo, type BadgeState } from '@/lib/badge';
import type { Grade } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DAY = 86_400;
const TIMEOUT = 50_000;

type Verdict = { state: BadgeState; commit: string | null; at: string };

async function grade(owner: string, name: string): Promise<Verdict> {
  const r = await scanRepo(`${owner}/${name}`);
  const ok = r.contracts.filter((c) => c.ok && c.grade);
  let state: BadgeState;
  if (r.contracts.length === 0) state = 'no contracts';
  else if (ok.length === 0) state = 'not compiled';
  else state = ok.map((c) => c.grade as Grade).reduce((w, g) => ('ABCDF'.indexOf(g) > 'ABCDF'.indexOf(w) ? g : w));
  return { state, commit: r.commit ?? null, at: new Date().toISOString() };
}

// Shared across instances by Next's data cache; keyed by the lower-cased repository.
const cached = (owner: string, name: string) =>
  unstable_cache(() => grade(owner, name), ['tell-badge', owner.toLowerCase(), name.toLowerCase()], { revalidate: DAY, tags: ['tell-badge'] })();

// One scan per repository at a time on this instance; concurrent requests share it.
const inflight = new Map<string, Promise<Verdict>>();

function svg(state: BadgeState, maxAge: number, sMaxAge: number, extra: Record<string, string> = {}) {
  return new Response(badgeSvg(state), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${7 * DAY}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      ...extra,
    },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await ctx.params;
  const name = repo.replace(/\.svg$/i, '');
  if (!validRepo(owner, name)) return svg('not found', 3600, DAY);
  const key = `${owner}/${name}`.toLowerCase();
  try {
    let p = inflight.get(key);
    if (!p) {
      p = Promise.race([
        cached(owner, name),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT)),
      ]).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const v = await p;
    return svg(v.state, 3600, DAY, { 'x-tell-scanned-at': v.at, ...(v.commit ? { 'x-tell-commit': v.commit } : {}) });
  } catch (e) {
    // a missing repository is stable; a timeout or GitHub hiccup is retried soon
    if (e instanceof UserError && /not found|private/.test(e.message)) return svg('not found', 3600, DAY);
    if ((e as Error).message !== 'timeout') console.error('badge scan failed', (e as Error).message);
    return svg('unknown', 60, 300);
  }
}
