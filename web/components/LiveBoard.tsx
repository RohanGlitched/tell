'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import type { LiveResponse, LiveBallot } from '@/lib/live';

const EXPLORER = 'https://preview.midnightexplorer.com';
const CANDIDATES = ['Asha', 'Bilal', 'Chen', 'Dara'];
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

export default function LiveBoard() {
  const [data, setData] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch('/api/live', { cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'read failed');
        if (!stop) {
          setData(j);
          setError(null);
        }
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (!data)
    return (
      <div className="mt-10 grid gap-6 lg:grid-cols-2" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="tape h-[420px] animate-pulse rounded-sm opacity-60" />
        ))}
        {error && <p className="text-[var(--red)]">{error}</p>}
      </div>
    );

  const leaky = data.ballots.find((b) => b.contract === 'ballot-leaky');
  const fixed = data.ballots.find((b) => b.contract === 'ballot-fixed');
  return (
    <div className="mt-10">
      <p className="text-[13px] text-[var(--graphite)]">
        Read from <span className="mono">indexer.preview.midnight.network</span> at {new Date(data.readAt).toLocaleTimeString()}; refreshes every 20 s.
        {error && <span className="ml-2 text-[var(--red)]">Last refresh failed: {error}</span>}
      </p>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {leaky && <Column b={leaky} />}
        {fixed && <Column b={fixed} />}
      </div>
      {leaky?.tally && <Tally tally={leaky.tally} total={leaky.ballots.length} />}
    </div>
  );
}

function Column({ b }: { b: LiveBallot }) {
  const isLeaky = b.contract === 'ballot-leaky';
  const recovered = b.ballots.filter((x) => x.recovered).length;
  return (
    <section className={`rounded-sm border ${isLeaky ? 'border-[var(--red)]' : 'border-[var(--rule)]'} bg-[var(--sheet)]`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--rule)] px-5 py-4">
        <div>
          <h2 className="text-[22px] font-extrabold">{isLeaky ? 'ballot-leaky' : 'ballot-fixed'}</h2>
          <a href={`${EXPLORER}/contract/${b.address}`} target="_blank" rel="noreferrer" className="mono text-[12.5px] text-[var(--graphite)]">
            {short(b.address)}
          </a>
        </div>
        <p className="display text-[15px] font-bold" style={{ color: isLeaky ? 'var(--red)' : 'var(--ink)' }}>
          {recovered} of {b.ballots.length} votes read
        </p>
      </header>
      <ol className="divide-y divide-[var(--rule)]">
        {b.ballots.map((x) => (
          <li key={x.tag} className={`grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-2.5 ${x.recovered ? 'bg-[var(--uv)]' : ''}`}>
            <span className="mono min-w-0 truncate text-[12.5px]" style={{ color: x.recovered ? '#8a78e0' : 'var(--graphite)' }}>
              ballots[{short(x.tag)}] = {short(x.value)}
            </span>
            {x.recovered ? (
              <span className="mono text-[13px] font-bold text-[#ff4fd8]" style={{ textShadow: '0 0 10px rgba(255,79,216,.7)' }}>
                {x.recovered}
              </span>
            ) : (
              <span className="mono text-[12.5px] text-[var(--faint)]">no match in 4 guesses</span>
            )}
          </li>
        ))}
      </ol>
      <details className="border-t border-[var(--rule)] px-5 py-3 text-[13px]">
        <summary className="cursor-pointer text-[var(--graphite)]">Transactions on the explorer</summary>
        <ul className="mono mt-2 space-y-1">
          {b.txs.map((t) => (
            <li key={t.voteTx}>
              voter {t.voter}:{' '}
              <a href={`${EXPLORER}/tx/${t.registerTx}`} target="_blank" rel="noreferrer">
                register
              </a>{' '}
              ·{' '}
              <a href={`${EXPLORER}/tx/${t.voteTx}`} target="_blank" rel="noreferrer">
                vote
              </a>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Tally({ tally, total }: { tally: Record<string, number>; total: number }) {
  const max = Math.max(1, ...Object.values(tally));
  return (
    <section className="mt-10">
      <h2 className="text-[24px] font-extrabold">The “secret” ballot’s result, read by anyone</h2>
      <ul className="mt-4 space-y-2">
        {CANDIDATES.map((c) => (
          <li key={c} className="grid grid-cols-[70px_1fr_40px] items-center gap-3">
            <span className="font-semibold">{c}</span>
            <span className="h-6 rounded-sm bg-[var(--uv)]" style={{ width: `${((tally[c] ?? 0) / max) * 100}%`, minWidth: tally[c] ? 8 : 0 }} />
            <span className="num text-right">{tally[c] ?? 0}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[14px] text-[var(--graphite)]">
        {total} ballots, every one attributed to its voter tag, computed in your browser’s request from public chain data in four hashes per ballot.
      </p>
    </section>
  );
}
