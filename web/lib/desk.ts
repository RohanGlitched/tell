// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Server-side reads of Tell Desk's public ledger, for /api/desk and the /desk page.
// Same pattern as lib/live.ts: an indexer public-data provider, the compiled contract's
// ledger() decoder, a short in-memory cache.
//
// LEAD: once desk/ is deployed, copy its compiled contract to web/lib/contracts/desk (like
// scripts/contracts.mjs does for the ballots), set address/deployTx in data/desk.json, and
// fill in readDesk() below. The page and DeskBoard already render this shape.

import desk from '@/data/desk.json';
import type { Grade } from './types';

export type DeskEntry = {
  contract: string; // address of the graded contract (hex)
  grade: Grade;
  report: string; // the sealed report commitment (hex)
  filer: string; // the filer tag (hex)
};

export type DeskResponse = {
  network: string;
  address: string;
  readAt: string;
  round: number | null;
  scanner: string | null;
  entries: DeskEntry[];
};

export class NotDeployed extends Error {}

export async function readDesk(): Promise<DeskResponse> {
  const d = desk as { address: string | null; network: string };
  if (!d.address) throw new NotDeployed('Tell Desk is not deployed yet');
  // TODO(lead): read the ledger from the indexer, as readLive() does:
  //   setNetworkId(NETWORK); const pdp = indexerPublicDataProvider(...indexer());
  //   const st = await pdp.queryContractState(d.address); const l = Desk.ledger(st.data);
  //   entries = [...l.grades].map(([addr, g]) => ({ contract: hex(addr), grade: 'ABCDF'[Number(g)], report: hex(l.reports.lookup(addr)), filer: … }))
  throw new NotDeployed('Tell Desk ledger reads are not wired yet');
}
