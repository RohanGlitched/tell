// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell Desk's public ledger, read from the Midnight indexer. 503 until the contract is deployed
// and lib/desk.ts reads it; the /desk page shows that state instead of failing.

import { NextResponse } from 'next/server';
import { NotDeployed, readDesk } from '@/lib/desk';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  try {
    return NextResponse.json(await readDesk(), { headers: { 'cache-control': 's-maxage=10, stale-while-revalidate=30' } });
  } catch (e) {
    if (e instanceof NotDeployed) return NextResponse.json({ error: e.message, deployed: false }, { status: 503, headers: { 'cache-control': 'no-store' } });
    console.error('desk read failed', e);
    return NextResponse.json({ error: 'The Midnight indexer did not answer. Try again in a minute.' }, { status: 502 });
  }
}
