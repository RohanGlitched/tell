// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Shared building blocks for the content pages, in the Redacted layout: an indigo page head,
// then sections on the marginalia grid (a note column beside the heading, like an annotated
// audit). Colours and type come from globals.css tokens.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { STATUS_LABEL, type Status } from '@/lib/content';

export function Page({ children }: { children: ReactNode }) {
  return <div className="pb-6">{children}</div>;
}

export function PageHead({ kicker, title, children, aside }: { kicker?: string; title: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="on-indigo">
      <div className={`wrap grid gap-10 pb-14 pt-10 sm:pb-16 sm:pt-14 ${aside ? 'lg:grid-cols-[1.15fr_1fr] lg:items-center' : ''}`}>
        <div>
          {kicker && <p className="text-[13.5px] font-medium text-[var(--on-indigo-2)]">{kicker}</p>}
          <h1 className="mt-3 max-w-[22ch] text-[34px] leading-[1.1] sm:text-[46px]">{title}</h1>
          {children && <div className="mt-5 max-w-[62ch] space-y-3 text-[16px] text-[var(--on-indigo-3)] sm:text-[17.5px] [&_a]:text-white">{children}</div>}
        </div>
        {aside}
      </div>
    </header>
  );
}

type Tone = 'plain' | 'mist' | 'indigo' | 'violet';
const TONE: Record<Tone, string> = { plain: '', mist: 'bg-[var(--mist)]', indigo: 'on-indigo', violet: 'on-violet' };

// A section on the marginalia grid. `note` is the bold margin label, `noteText` the note under it.
export function Section({
  id,
  title,
  intro,
  note,
  noteText,
  children,
  tone = 'plain',
  testId,
}: {
  id?: string;
  title: ReactNode;
  intro?: ReactNode;
  note?: string;
  noteText?: ReactNode;
  children: ReactNode;
  tone?: Tone;
  rule?: boolean;
  testId?: string;
}) {
  const dark = tone === 'indigo' || tone === 'violet';
  return (
    <section id={id} className={`scroll-mt-20 py-14 sm:py-20 ${TONE[tone]}`} data-testid={testId}>
      <div className="wrap">
        <div className="marg mb-8 sm:mb-10">
          <p className="margin-note">
            {note && <b>{note}</b>}
            {noteText}
          </p>
          <div>
            <h2 className={`max-w-[26ch] text-[26px] leading-[1.2] sm:text-[32px] ${dark ? 'text-white' : ''}`}>{title}</h2>
            {intro && <div className={`mt-3.5 max-w-[64ch] text-[16px] sm:text-[17px] ${dark ? 'text-[var(--on-indigo)]' : 'text-[var(--graphite)]'}`}>{intro}</div>}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

export const MarginSection = Section;

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  return (
    <span className="status" data-status={status}>
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

export type LinkRef = { label: string; href: string | null };

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
    <div className="border-t-2 border-[var(--indigo)] pt-3">
      <dt className="num font-[family-name:var(--serif)] text-[44px] font-medium leading-none sm:text-[52px]">{n}</dt>
      <dd className="mt-2 max-w-[30ch] text-[14.5px] text-[var(--graphite)]">
        {label}
        {note && <span className="mt-1 block text-[13px] text-[var(--faint)]">{note}</span>}
      </dd>
    </div>
  );
}

// A marked slot for something wired up later (wallet actions, indexer reads, numbers).
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
    <div className="mt-8 flex flex-wrap gap-3">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={`btn ${l.primary ? 'btn-pri' : 'btn-quiet'}`}>
          {l.label}
        </Link>
      ))}
    </div>
  );
}

// The closing band every page ends on.
export function Closer({ note = 'Before you deploy', noteText = 'A contract’s history is public forever.', title = 'Find the tell before someone else does.' }: { note?: string; noteText?: string; title?: string }) {
  return (
    <section className="bg-[var(--mist)] py-16 sm:py-20">
      <div className="wrap grid items-center gap-6 lg:grid-cols-[var(--margin-col)_1fr_auto] lg:gap-12">
        <p className="margin-note">
          <b>{note}</b>
          {noteText}
        </p>
        <h2 className="text-[26px] sm:text-[30px]">{title}</h2>
        <Link href="/scan" className="btn btn-pri justify-self-start">
          Scan a contract
        </Link>
      </div>
    </section>
  );
}
