'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Main navigation. Wide screens: every page in a row, the current one marked, Wave 3 highlighted.
// Phones: Scan and Wave 3 stay in the bar; the rest open from a menu button.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export const NAV: [href: string, label: string][] = [
  ['/scan', 'Scan'],
  ['/live', 'Live'],
  ['/desk', 'Desk'],
  ['/survey', 'Survey'],
  ['/zoo', 'Leak zoo'],
  ['/teams', 'For teams'],
  ['/how', 'How it works'],
];
const HIGHLIGHT: [string, string] = ['/wave3', 'Wave 3'];

const linkClass = 'inline-flex min-h-[44px] items-center whitespace-nowrap rounded px-2 no-underline hover:bg-[var(--sheet)] hover:text-[var(--ink)]';

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

  const wave = (
    <Link
      href={HIGHLIGHT[0]}
      aria-current={current(HIGHLIGHT[0]) ? 'page' : undefined}
      className="inline-flex min-h-[36px] items-center whitespace-nowrap rounded-sm bg-[var(--uv)] px-2.5 text-[13.5px] font-semibold text-[#e9e6ff] no-underline hover:text-white aria-[current=page]:ring-2 aria-[current=page]:ring-[var(--glow)]"
    >
      {HIGHLIGHT[1]}
    </Link>
  );

  return (
    <>
      {/* wide screens */}
      <nav className="ml-auto hidden items-center gap-1 text-[14px] lg:flex" aria-label="Main">
        {NAV.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={current(href) ? 'page' : undefined}
            className={`${linkClass} text-[var(--graphite)] aria-[current=page]:font-semibold aria-[current=page]:text-[var(--ink)] aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-[6px]`}
          >
            {label}
          </Link>
        ))}
        <span className="ml-2">{wave}</span>
      </nav>

      {/* phones and tablets */}
      <div className="relative ml-auto flex items-center gap-2 text-[14px] lg:hidden">
        <Link href="/scan" aria-current={current('/scan') ? 'page' : undefined} className={`${linkClass} text-[var(--graphite)] aria-[current=page]:text-[var(--ink)]`}>
          Scan
        </Link>
        {wave}
        <button
          ref={button}
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded px-2 text-[var(--ink)] hover:bg-[var(--sheet)]"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            {open ? <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" /> : <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.8" />}
          </svg>
          Menu
        </button>
        {open && (
          <div ref={panel} id="mobile-nav" className="absolute right-0 top-full z-50 mt-1.5 w-[min(86vw,280px)] rounded-sm border border-[var(--rule)] bg-[var(--sheet)] p-2 shadow-lg">
            <nav aria-label="Main">
              <ul>
                {[...NAV, HIGHLIGHT, ['/adoption', 'Adoption'] as [string, string]].map(([href, label]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={current(href) ? 'page' : undefined}
                      className="flex min-h-[44px] items-center rounded px-3 text-[15px] no-underline hover:bg-[var(--paper)] aria-[current=page]:font-semibold"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        )}
      </div>
    </>
  );
}
