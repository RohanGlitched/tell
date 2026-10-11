// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server';
import { readLive } from '@/lib/live';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  try {
    return NextResponse.json(await readLive(), { headers: { 'cache-control': 's-maxage=10, stale-while-revalidate=30' } });
  } catch (e) {
    console.error('live read failed', e);
    return NextResponse.json({ error: 'The Midnight Preview indexer did not answer. The contracts are still there; try again in a minute.' }, { status: 502 });
  }
}
