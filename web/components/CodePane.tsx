'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// A contract in a scrolling pane that opens on the lines that matter: the leak on
// the left, what the fix changed on the right.

import { useEffect, useRef } from 'react';

export default function CodePane({ title, code, tone, marks }: { title: string; code: string; tone: 'red' | 'ink'; marks: number[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const pre = ref.current;
    const first = pre?.querySelector<HTMLElement>('[data-mark]');
    // only scroll when the first marked line would be below the pane's fold
    if (pre && first && first.offsetTop + first.offsetHeight > pre.clientHeight) pre.scrollTop = Math.max(0, first.offsetTop - pre.clientHeight / 3);
  }, []);
  const marked = new Set(marks);
  return (
    <figure className="min-w-0">
      <figcaption className={`mono mb-1 text-[13px] ${tone === 'red' ? 'text-[var(--red)]' : 'text-[var(--graphite)]'}`}>{title}</figcaption>
      <pre
        ref={ref}
        className={`mono relative max-h-[420px] overflow-auto rounded-sm border bg-[var(--sheet)] p-3 text-[12.5px] leading-[1.6] ${tone === 'red' ? 'border-[var(--red)]' : 'border-[var(--rule)]'}`}
      >
        {code.split('\n').map((l, i) =>
          marked.has(i + 1) ? (
            <span key={i} data-mark className={`-mx-3 block px-3 ${tone === 'red' ? 'bg-[var(--red-soft)]' : 'bg-[var(--hi-soft)]'}`}>
              {l || ' '}
            </span>
          ) : (
            <span key={i} className="block">
              {l || ' '}
            </span>
          ),
        )}
      </pre>
    </figure>
  );
}
