// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Small shared building blocks for the content pages (Wave 3, adoption, teams, desk).
// Visual decisions live here and in globals.css (.status, .slot, --status-*, --ledger-*),
// so a redesign changes them in one place.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { STATUS_LABEL, type Status } from '@/lib/content';

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-10 sm:px-6">{children}</div>;
}

export function PageHead({ kicker, title, children }: { kicker?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header>
      {kicker && <p className="label">{kicker}</p>}
      <h1 className="mt-2 max-w-[22ch] text-[36px] font-extrabold leading-[1.04] sm:text-[52px]">{title}</h1>
      {children && <div className="mt-4 max-w-[68ch] space-y-3 text-[17px] text-[var(--graphite)]">{children}</div>}
    </header>
  );
}

export function Section({ id, title, intro, children, rule = true }: { id?: string; title: ReactNode; intro?: ReactNode; children: ReactNode; rule?: boolean }) {
  return (
    <section id={id} className={`mt-16 scroll-mt-20 ${rule ? 'border-t-2 border-[var(--ink)] pt-8' : ''}`}>
      <h2 className="text-[26px] font-extrabold leading-[1.1] sm:text-[32px]">{title}</h2>
      {intro && <div className="mt-2 max-w-[68ch] text-[16px] text-[var(--graphite)]">{intro}</div>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className="status" data-status={status}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export type LinkRef = { label: string; href: string | null };

// External links open in place (the site is the evidence); a null href is work not linked yet.
export function Evidence({ links }: { links: LinkRef[] }) {
  if (links.length === 0) return <span className="text-[14px] text-[var(--faint)]">Evidence link added when it ships</span>;
  return (
    <ul className="space-y-1 text-[14.5px]">
      {links.map((l) => (
        <li key={l.label}>
          {l.href ? (
            l.href.startsWith('/') ? (
              <Link href={l.href}>{l.label}</Link>
            ) : (
              <a href={l.href} rel="noreferrer">
                {l.label}
              </a>
            )
          ) : (
            <span className="text-[var(--faint)]">{l.label} (link when it ships)</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Stat({ n, label, note }: { n: ReactNode; label: string; note?: string }) {
  return (
    <div className="border-t-2 border-[var(--ink)] pt-3">
      <dt className="display num text-[44px] font-extrabold leading-none tracking-[-0.03em] sm:text-[52px]">{n}</dt>
      <dd className="mt-2 max-w-[30ch] text-[14.5px] text-[var(--graphite)]">
        {label}
        {note && <span className="mt-1 block text-[13px] text-[var(--faint)]">{note}</span>}
      </dd>
    </div>
  );
}

// A marked slot for something the lead wires up later (wallet actions, indexer reads, prices).
export function Slot({ title, children, testId }: { title: string; children?: ReactNode; testId?: string }) {
  return (
    <div className="slot p-5" data-testid={testId}>
      <p className="label">{title}</p>
      {children && <div className="mt-2 text-[14.5px] text-[var(--graphite)]">{children}</div>}
    </div>
  );
}

export function CtaRow({ links }: { links: { href: string; label: string; primary?: boolean }[] }) {
  return (
    <div className="mt-7 flex flex-wrap gap-3">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`inline-flex min-h-[46px] items-center rounded-sm px-5 font-semibold no-underline ${
            l.primary ? 'bg-[var(--ink)] text-[var(--paper)]' : 'border border-[var(--ink)]'
          }`}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
