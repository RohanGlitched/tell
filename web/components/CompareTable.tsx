// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// "How Tell compares": the head-to-head benchmark (bench/), from data/compare.json
// (scripts/compare.mjs). Numbers are medium-and-above on the labelled set.

import compare from '@/data/compare.json';

type Row = { id: string; name: string; leaks: number | null; found: number | null; falseAlarms: number | null; safe: number | null; safeClean: number | null; quantified: number | null; demonstrated: number | null };

export default function CompareTable() {
  const rows = compare.rows as Row[];
  return (
    <div data-testid="compare-table">
      <p className="mb-3 inline-block rounded-md border border-[var(--marker)] px-2.5 py-1 text-[13px] font-semibold text-[var(--marker-ink)]" data-testid="compare-engine">
        {compare.engineNote}
      </p>
      <div className="overflow-x-auto rounded-lg border border-[var(--rule)] bg-white">
        <table className="w-full min-w-[680px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-[var(--indigo)] text-left align-bottom">
              <th className="px-4 py-2.5 font-semibold">Tool</th>
              <th className="px-4 py-2.5 font-semibold">Planted leaks found</th>
              <th className="px-4 py-2.5 font-semibold">False alarms</th>
              <th className="px-4 py-2.5 font-semibold">Safe files left clean</th>
              <th className="px-4 py-2.5 font-semibold">Leak measured</th>
              <th className="px-4 py-2.5 font-semibold">Read back by an attack test</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tell = r.id === 'tell';
              const share = r.leaks ? (r.found ?? 0) / r.leaks : 0;
              return (
                <tr key={r.id} className={`border-b border-[var(--rule)] last:border-b-0 ${tell ? 'bg-[var(--marker-soft)]' : ''}`}>
                  <th scope="row" className={`px-4 py-2.5 text-left ${tell ? 'font-semibold' : 'font-normal'}`}>
                    {r.name}
                  </th>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span className="num w-12 shrink-0">
                        {r.found ?? '–'} / {r.leaks ?? '–'}
                      </span>
                      <span className="h-2 w-24 overflow-hidden rounded-[2px] bg-[var(--mist)]" aria-hidden="true">
                        <span className="block h-full" style={{ width: `${share * 100}%`, background: tell ? 'var(--marker)' : 'var(--indigo)' }} />
                      </span>
                    </span>
                  </td>
                  <td className="num px-4 py-2.5">{r.falseAlarms ?? '–'}</td>
                  <td className="num px-4 py-2.5">
                    {r.safeClean ?? '–'} / {r.safe ?? '–'}
                  </td>
                  <td className="num px-4 py-2.5">{r.found ? `${r.quantified ?? 0} of ${r.found}` : 'n/a'}</td>
                  <td className="num px-4 py-2.5">{r.demonstrated ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 max-w-[90ch] text-[13px] text-[var(--graphite)]">
        {compare.corpus}. Medium and above, labelled set; run {compare.runAt} with the {compare.engine}. {compare.caveat} Method and every per-file result:{' '}
        <a href="https://github.com/RohanGlitched/tell/blob/main/bench/RESULTS.md">bench/RESULTS.md</a>.
      </p>
    </div>
  );
}
