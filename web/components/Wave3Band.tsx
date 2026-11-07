// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Home-page band: what is new in Wave 3, from data/wave3.json, linking to /wave3.

import Link from 'next/link';
import { wave3 } from '@/lib/content';
import { StatusPill } from './ui';

export default function Wave3Band() {
  return (
    <section className="border-b border-[var(--rule)] bg-[var(--mist)] py-12 sm:py-14" data-testid="wave3-band">
      <div className="wrap">
        <div className="marg mb-7">
          <p className="margin-note">
            <b>New in Wave 3</b>Every point from the Wave 2 review, answered with something you can open.
          </p>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 className="text-[26px] sm:text-[30px]">You said. We did.</h2>
            <Link href="/wave3" className="text-[15px] font-semibold">
              Read the whole list
            </Link>
          </div>
        </div>
        <ul className="grid gap-px overflow-hidden rounded-lg border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-3">
          {wave3.highlights.map((h) => (
            <li key={h.title} className="bg-white">
              <Link href={h.href} className="flex h-full flex-col items-start gap-2 p-5 no-underline hover:bg-[var(--paper)] hover:shadow-[inset_3px_0_0_var(--marker)]">
                <StatusPill status={h.status} />
                <span className="font-[family-name:var(--serif)] text-[19px] font-medium leading-snug">{h.title}</span>
                <span className="text-[14.5px] text-[var(--graphite)]">{h.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
