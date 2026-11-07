// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell Desk's public state, read from the Midnight indexer.
//   GET /api/desk                  reports (status only, no content), revealed openings, grades
//   GET /api/desk?address=<hex>    a contract's grade: its code hash, then the registry
// 503 until the contract is deployed; the /desk page shows that state instead of failing.

import { NextResponse } from 'next/server';
import { gradeOfAddress, NotDeployed, readDesk, UserFacing } from '@/lib/desk';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address');
  try {
    if (address !== null) {
      const a = address.trim().toLowerCase().replace(/^0x/, '');
      if (!/^[0-9a-f]{64}$/.test(a)) return NextResponse.json({ error: 'A contract address is 64 hexadecimal characters.' }, { status: 400 });
      return NextResponse.json(await gradeOfAddress(a), { headers: { 'cache-control': 's-maxage=30, stale-while-revalidate=120' } });
    }
    return NextResponse.json(await readDesk(), { headers: { 'cache-control': 's-maxage=10, stale-while-revalidate=30' } });
  } catch (e) {
    if (e instanceof NotDeployed) return NextResponse.json({ error: e.message, deployed: false }, { status: 503, headers: { 'cache-control': 'no-store' } });
    if (e instanceof UserFacing) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error('desk read failed', e);
    return NextResponse.json({ error: 'The Midnight indexer did not answer. Try again in a minute.' }, { status: 502 });
  }
}
