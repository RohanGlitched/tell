// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Midnight's two ledgers side by side: what a contract puts on the public ledger (everyone,
// forever) and what stays in the user's private state (their machine). Colours come from the
// --ledger-* variables in globals.css.

import type { LedgerField } from '@/lib/content';

export default function DualLedger({ pub, priv, caption }: { pub: LedgerField[]; priv: LedgerField[]; caption?: string }) {
  return (
    <figure data-testid="dual-ledger">
      <div className="grid overflow-hidden rounded-sm border border-[var(--rule)] md:grid-cols-2">
        <Column
          tone="public"
          title="Public ledger"
          sub="On chain. Anyone can read it, forever."
          fields={pub}
        />
        <Column tone="private" title="Your private state" sub="On your machine. The proof uses it; the chain never sees it." fields={priv} />
      </div>
      {caption && <figcaption className="mt-2 text-[13px] text-[var(--graphite)]">{caption}</figcaption>}
    </figure>
  );
}

function Column({ tone, title, sub, fields }: { tone: 'public' | 'private'; title: string; sub: string; fields: LedgerField[] }) {
  const pub = tone === 'public';
  return (
    <section
      className="p-5 sm:p-6"
      style={{
        background: pub ? 'var(--ledger-public-bg)' : 'var(--ledger-private-bg)',
        color: pub ? 'var(--ledger-public-fg)' : 'var(--ledger-private-fg)',
      }}
      aria-label={title}
    >
      <header className="border-b pb-3" style={{ borderColor: pub ? 'color-mix(in srgb, var(--ledger-public-fg) 25%, transparent)' : 'var(--rule)' }}>
        <h3 className="flex items-center gap-2 text-[20px] font-extrabold">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: pub ? 'var(--ledger-public-accent)' : 'var(--ledger-private-accent)' }} />
          {title}
        </h3>
        <p className="mt-1 text-[14px] opacity-80">{sub}</p>
      </header>
      <ul className="mt-2">
        {fields.map((f) => (
          <li key={f.name} className="border-b py-3 last:border-b-0" style={{ borderColor: pub ? 'color-mix(in srgb, var(--ledger-public-fg) 14%, transparent)' : 'var(--rule)' }}>
            <p className="mono flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
              <span className="font-bold">{f.name}</span>
              <span className="opacity-70">{f.type}</span>
            </p>
            <p className="mt-1 text-[14.5px]">{f.holds}</p>
            <p className="mt-0.5 text-[12.5px] opacity-70">Readable by: {f.who}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
