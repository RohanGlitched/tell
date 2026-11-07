'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell Desk on the page: the grade registry as the indexer reports it (polled like LiveBoard),
// and the slot where the Lace wallet flow goes (connect, seal, file).

import { useEffect, useState } from 'react';
import type { DeskResponse } from '@/lib/desk';
import { Slot } from './ui';

const short = (h: string) => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);

export function DeskRegistry() {
  const [data, setData] = useState<DeskResponse | null>(null);
  const [state, setState] = useState<'loading' | 'not-deployed' | 'error' | 'ok'>('loading');
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch('/api/desk', { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (stop) return;
        if (r.status === 503) return setState('not-deployed');
        if (!r.ok) throw new Error(j.error ?? 'read failed');
        setData(j);
        setState('ok');
      } catch {
        if (!stop) setState('error');
      }
    };
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (state === 'loading') return <div className="tape h-40 animate-pulse rounded-sm opacity-60" aria-busy="true" />;
  if (state !== 'ok' || !data)
    return (
      <Slot title="Live registry reads" testId="desk-registry-slot">
        {state === 'not-deployed'
          ? 'Tell Desk is not deployed yet. Once it is on Preprod, this table lists every filed grade, read from the indexer every 20 seconds.'
          : 'The Midnight indexer did not answer. The registry is still there; this retries every 20 seconds.'}
      </Slot>
    );
  return (
    <div>
      <p className="text-[13px] text-[var(--graphite)]">
        Read at {new Date(data.readAt).toLocaleTimeString()} · {data.entries.length} grade{data.entries.length === 1 ? '' : 's'} filed
        {data.round !== null ? ` · round ${data.round}` : ''}; refreshes every 20 s.
      </p>
      <div className="mt-3 overflow-x-auto rounded-sm border border-[var(--rule)] bg-[var(--sheet)]">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b border-[var(--rule)] text-left">
              <th className="px-3 py-2 font-semibold">Contract</th>
              <th className="px-3 py-2 font-semibold">Grade</th>
              <th className="px-3 py-2 font-semibold">Sealed report</th>
              <th className="px-3 py-2 font-semibold">Filer tag</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.contract} className="border-b border-[var(--rule)]">
                <td className="mono px-3 py-2">{short(e.contract)}</td>
                <td className="display px-3 py-2 text-[18px] font-extrabold">{e.grade}</td>
                <td className="mono px-3 py-2 text-[var(--graphite)]">{short(e.report)}</td>
                <td className="mono px-3 py-2 text-[var(--graphite)]">{short(e.filer)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// LEAD: replace with the Lace flow (window.midnight.mnLace: enable(), then the deployed contract's
// `file` circuit via midnight-js). Keep the three steps visible so the flow reads the same.
export function DeskWalletSlot() {
  return (
    <Slot title="Wallet actions: connect Lace, seal a report, file the grade" testId="desk-wallet-slot">
      <ol className="mt-1 list-decimal space-y-1 pl-5">
        <li>Connect Lace (Midnight Preprod).</li>
        <li>Pick a scan from this browser and seal it: the report and its salt are kept in your private state.</li>
        <li>File: one transaction writes the grade and the commitment to the public ledger.</li>
      </ol>
      <button type="button" disabled className="mt-4 min-h-[44px] rounded bg-[var(--ink)] px-5 font-medium text-[var(--paper)] opacity-50">
        Connect Lace (available once Tell Desk is deployed)
      </button>
    </Slot>
  );
}
