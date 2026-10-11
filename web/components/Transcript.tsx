'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The public transcript of a circuit as a perforated tape: every ledger
// operation, and for each operand, what it carries about the caller's secrets.

import { useState } from 'react';
import type { CircuitReport } from '@/lib/types';

type Note = { source: string; kind: 'witness' | 'argument'; flow: 'reveal' | 'guessable' | 'predicate' | 'hidden'; via?: string; bits: number; tag?: boolean };
type Op = { field: string; op: string; operands: Note[][]; guardedBy: string[] };

const who = (n: Note) => (n.kind === 'argument' ? n.source : `${n.source.replace(/^([^.[]+)/, '$1()')}`);

function Chip({ n }: { n: Note }) {
  if (n.flow === 'guessable')
    return (
      <span className="rounded-[2px] bg-[var(--uv)] px-1.5 py-0.5 font-bold text-[#ff4fd8]" style={{ textShadow: '0 0 8px rgba(255,79,216,.6)' }}>
        {n.via}({who(n)}) · {n.bits} bits, guessable
      </span>
    );
  if (n.flow === 'reveal')
    return <span className="rounded-[2px] bg-[var(--red-soft)] px-1.5 py-0.5 font-bold text-[var(--red)]">{who(n)} in the clear · {n.bits} bits</span>;
  if (n.flow === 'predicate') return <span className="rounded-[2px] bg-[var(--amber-soft)] px-1.5 py-0.5 text-[var(--amber)]">yes/no about {who(n)}</span>;
  if (n.tag)
    return (
      <span className="rounded-[2px] bg-[var(--uv)] px-1.5 py-0.5 text-[#5cf2ff]">
        {n.via}({who(n)}) · same tag each call
      </span>
    );
  return <span className="rounded-[2px] border border-[var(--rule)] px-1.5 py-0.5 text-[var(--graphite)]">{n.via ?? 'sealed'}({who(n)}) · sealed</span>;
}

export default function Transcript({ circuits }: { circuits: CircuitReport[] }) {
  const withOps = circuits.filter((c) => ((c as CircuitReport & { ops?: Op[] }).ops ?? []).length > 0);
  // open on the circuit whose transcript gives away the most
  const score = (c: CircuitReport) =>
    ((c as CircuitReport & { ops?: Op[] }).ops ?? []).flatMap((o) => o.operands.flat()).reduce((a, n) => a + (n.flow === 'guessable' ? 100 : n.flow === 'reveal' ? 50 : n.flow === 'predicate' ? 5 : n.tag ? 1 : 0), 0) +
    ((c as CircuitReport & { ops?: Op[] }).ops ?? []).filter((o) => o.guardedBy.length).length * 20;
  const [sel, setSel] = useState([...withOps].sort((a, b) => score(b) - score(a))[0]?.name ?? '');
  if (withOps.length === 0) return null;
  const cur = withOps.find((c) => c.name === sel) ?? withOps[0];
  const ops = ((cur as CircuitReport & { ops?: Op[] }).ops ?? []) as Op[];
  // collapse identical consecutive lines (unrolled loops)
  const lines: { op: Op; n: number }[] = [];
  for (const op of ops) {
    const last = lines[lines.length - 1];
    if (last && JSON.stringify(last.op) === JSON.stringify(op)) last.n++;
    else lines.push({ op, n: 1 });
  }
  return (
    <figure className="mt-6">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
        <span className="font-semibold text-[var(--ink)]">Public transcript</span>
        <span className="text-[var(--graphite)]">What a chain observer sees when this circuit runs.</span>
        <span className="no-scrollbar ml-auto flex max-w-full gap-1 overflow-x-auto">
          {withOps.map((c) => (
            <button
              key={c.name}
              onClick={() => setSel(c.name)}
              className={`mono min-h-[32px] whitespace-nowrap rounded-sm px-2 text-[12px] ${c.name === cur.name ? 'bg-[var(--ink)] text-[var(--paper)]' : 'border border-[var(--rule)] text-[var(--graphite)] hover:border-[var(--ink)]'}`}
            >
              {c.name}
            </button>
          ))}
        </span>
      </figcaption>
      <ol className="tape mono overflow-x-auto rounded-sm px-7 py-3 text-[12.5px] leading-[1.9]">
        {lines.map(({ op, n }, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-dashed border-[var(--rule)] py-1 last:border-0">
            <span className="w-6 shrink-0 text-right text-[var(--faint)]">{i + 1}</span>
            {op.guardedBy.length > 0 && <span className="rounded-[2px] bg-[var(--amber-soft)] px-1.5 text-[var(--amber)]">only if f({op.guardedBy.join(', ')})</span>}
            <span className="font-semibold">
              {op.field}.{op.op}
            </span>
            <span className="text-[var(--faint)]">(</span>
            {op.operands.length === 0 && <span className="text-[var(--faint)]">no operands</span>}
            {op.operands.map((notes, j) => (
              <span key={j} className="inline-flex flex-wrap items-baseline gap-1">
                {notes.length === 0 ? <span className="text-[var(--graphite)]">public</span> : notes.map((nn, k) => <Chip key={k} n={nn} />)}
                {j < op.operands.length - 1 && <span className="text-[var(--faint)]">,</span>}
              </span>
            ))}
            <span className="text-[var(--faint)]">)</span>
            {n > 1 && <span className="text-[var(--faint)]">× {n}</span>}
          </li>
        ))}
      </ol>
    </figure>
  );
}
