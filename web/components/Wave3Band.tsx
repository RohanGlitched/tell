// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Home-page band: what is new in Wave 3, from data/wave3.json, linking to /wave3.

import Link from 'next/link';
import { wave3 } from '@/lib/content';
import { StatusPill } from './ui';

export default function Wave3Band() {
  return (
    <section className="border-y border-[var(--rule)] bg-[var(--sheet)]" data-testid="wave3-band">
      <div className="mx-auto max-w-[1180px] px-4 py-12 sm:px-6">
        <div className="grid gap-6 md:grid-cols-[1fr_1.6fr] md:items-end">
          <div>
            <p className="label">New in Wave 3</p>
            <h2 className="mt-2 text-[30px] font-extrabold leading-[1.08] sm:text-[36px]">You said. We did.</h2>
          </div>
          <p className="text-[16px] text-[var(--graphite)]">
            Every point from the Wave 2 review, answered with something you can open.{' '}
            <Link href="/wave3" className="font-semibold text-[var(--ink)]">
              Read the whole list
            </Link>
          </p>
        </div>
        <ul className="mt-8 grid gap-px overflow-hidden rounded-sm border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-3">
          {wave3.highlights.map((h) => (
            <li key={h.title} className="bg-[var(--paper)]">
              <Link href={h.href} className="flex h-full flex-col gap-2 p-5 no-underline hover:bg-[var(--sheet)]">
                <StatusPill status={h.status} />
                <span className="text-[17px] font-bold">{h.title}</span>
                <span className="text-[14.5px] text-[var(--graphite)]">{h.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
