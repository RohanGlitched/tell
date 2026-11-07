'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Main navigation on the indigo bar. Wide screens: the pages in a row (current one marked),
// Wave 3 highlighted, GitHub and the Scan button on the right. Narrower: Scan and a menu.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export const NAV: [href: string, label: string][] = [
  ['/live', 'Live'],
  ['/desk', 'Tell Desk'],
  ['/survey', 'Survey'],
  ['/zoo', 'Leak zoo'],
  ['/teams', 'For teams'],
  ['/how', 'How it works'],
];
const WAVE: [string, string] = ['/wave3', 'Wave 3'];
const MENU: [string, string][] = [['/scan', 'Scan'], ...NAV, WAVE, ['/adoption', 'Adoption']];

export default function SiteNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = (href: string) => path === href || path.startsWith(href + '/');

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <>
      <nav className="hidden items-center gap-5 text-[14.5px] text-[var(--on-indigo)] xl:flex" aria-label="Main">
        {NAV.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={current(href) ? 'page' : undefined}
            className="no-underline hover:text-white aria-[current=page]:text-white aria-[current=page]:underline aria-[current=page]:decoration-[var(--marker)] aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-[8px]"
          >
            {label}
          </Link>
        ))}
        <Link
          href={WAVE[0]}
          aria-current={current(WAVE[0]) ? 'page' : undefined}
          className="rounded-md bg-[var(--indigo-2)] px-2.5 py-1 font-semibold text-white no-underline shadow-[inset_0_0_0_1.5px_var(--marker)] hover:bg-[var(--indigo-3)]"
        >
          {WAVE[1]}
        </Link>
      </nav>

      <div className="relative ml-auto flex items-center gap-3 text-[14.5px] text-[var(--on-indigo)]">
        <a href="https://github.com/RohanGlitched/tell" className="hidden no-underline hover:text-white sm:inline">
          GitHub
        </a>
        <Link href="/scan" aria-current={current('/scan') ? 'page' : undefined} className="btn btn-pri btn-sm !min-h-[36px] !text-[14px]">
          Scan a contract
        </Link>
        <button
          ref={button}
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-white hover:bg-[var(--indigo-2)] xl:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            {open ? <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" /> : <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.8" />}
          </svg>
          Menu
        </button>
        {open && (
          <div ref={panel} id="mobile-nav" className="absolute right-0 top-full z-50 mt-2 w-[min(86vw,280px)] rounded-lg bg-white p-2 text-[var(--ink)] shadow-[0_20px_40px_-20px_rgba(26,20,70,.6)]">
            <nav aria-label="Main">
              <ul>
                {MENU.map(([href, label]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={current(href) ? 'page' : undefined}
                      className="flex min-h-[44px] items-center rounded-md px-3 text-[15px] no-underline hover:bg-[var(--mist)] aria-[current=page]:font-semibold aria-[current=page]:text-[var(--marker)]"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
                <li>
                  <a href="https://github.com/RohanGlitched/tell" className="flex min-h-[44px] items-center rounded-md px-3 text-[15px] no-underline hover:bg-[var(--mist)]">
                    GitHub
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        )}
      </div>
    </>
  );
}
