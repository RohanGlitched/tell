'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Ninety-six case folders, one per surveyed project, each stamped with its grade.
// Folders are anonymized; selecting one shows what Tell found, never whose it is.

import { useState } from 'react';
import { KIND_LABEL, type FindingKind } from '@/lib/types';

export type CensusProject = { p: string; grade: string; contracts: number; worst: { severity: string; kind: string } | null };

const ORDER = 'ABCDF';
const INK: Record<string, string> = { A: 'var(--ink)', B: 'var(--graphite)', C: 'var(--amber)', D: 'var(--red)', F: 'var(--red)' };

export default function Census({ projects }: { projects: CensusProject[] }) {
  const sorted = [...projects].sort((a, b) => ORDER.indexOf(a.grade) - ORDER.indexOf(b.grade) || a.p.localeCompare(b.p));
  const [sel, setSel] = useState<CensusProject | null>(sorted.find((p) => p.grade === 'D') ?? null);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <ul className="grid grid-cols-8 gap-x-1.5 gap-y-2 sm:grid-cols-12 xl:grid-cols-16" aria-label="Surveyed projects by grade">
        {sorted.map((p) => {
          const serious = p.grade === 'C' || p.grade === 'D' || p.grade === 'F';
          const active = sel?.p === p.p;
          return (
            <li key={p.p}>
              <button
                onClick={() => setSel(p)}
                onMouseEnter={() => setSel(p)}
                onFocus={() => setSel(p)}
                aria-label={`${p.p}, grade ${p.grade}${p.worst ? `, worst finding ${p.worst.severity} ${p.worst.kind}` : ''}`}
                className="group relative block w-full pt-[5px] text-left"
              >
                {/* folder tab */}
                <span className={`absolute left-0 top-0 h-[6px] w-[45%] rounded-t-[3px] border border-b-0 ${active ? 'border-[var(--ink)] bg-[var(--uv)]' : 'border-[var(--rule-strong)] bg-[var(--sheet)]'}`} />
                <span
                  className={`relative grid aspect-[4/3] place-items-center rounded-[3px] rounded-tl-none border transition-colors ${
                    active ? 'border-[var(--ink)] bg-[var(--uv)]' : 'border-[var(--rule-strong)] bg-[var(--sheet)] group-hover:border-[var(--ink)]'
                  }`}
                >
                  <span
                    className="display text-[12px] font-extrabold sm:text-[13px]"
                    style={{
                      color: active ? (serious ? '#ff4fd8' : '#5cf2ff') : INK[p.grade],
                      transform: serious ? 'rotate(-10deg)' : undefined,
                      border: serious ? '2px solid currentColor' : undefined,
                      borderRadius: serious ? 4 : undefined,
                      padding: serious ? '0 4px' : undefined,
                      textShadow: active ? '0 0 10px currentColor' : undefined,
                    }}
                  >
                    {p.grade}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <aside aria-live="polite" className="sheet self-start rounded-sm p-5">
        {sel ? (
          <>
            <p className="label">{sel.p}</p>
            <p className="display mt-2 text-[44px] font-extrabold leading-none" style={{ color: INK[sel.grade] }}>
              {sel.grade}
            </p>
            <p className="mt-3 text-[15px]">
              {sel.contracts} contract{sel.contracts === 1 ? '' : 's'} analyzed.
            </p>
            <p className="hand mt-2 text-[19px] leading-snug">
              {sel.worst ? `Worst finding: ${sel.worst.severity}, ${KIND_LABEL[sel.worst.kind as FindingKind].toLowerCase()}.` : 'Nothing beyond what it means to publish.'}
            </p>
          </>
        ) : (
          <p className="text-[15px] text-[var(--graphite)]">Select a folder.</p>
        )}
        <p className="mt-4 border-t border-[var(--rule)] pt-3 text-[13px] text-[var(--graphite)]">
          Folders are numbered in an order fixed by a secret kept out of the repository, so a number says nothing about the team.
        </p>
      </aside>
    </div>
  );
}
