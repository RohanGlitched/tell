'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The hero: a wall of real public-ledger values from the leaky zoo contracts.
// The pointer is a UV examination lamp; under it, the hidden ink shows what each
// value gives away. Two identical layers, the top one masked by a circle that
// follows the pointer through CSS variables (no React state per mouse move).

import { useEffect, useRef } from 'react';

export type HeroRow = { contract: string; field: string; key: string; value: string; reveal: string; how: string; severity: 'critical' | 'high' | 'medium' };

const short = (h: string) => (/^[0-9a-f]{20,}$/.test(h) ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);

export default function Lamp({ rows, children }: { rows: HeroRow[]; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let px = 0.68;
    let py = 0.42;
    let manual = false;
    let raf = 0;
    let last = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hover = window.matchMedia('(hover: hover)').matches;
    const set = (x: number, y: number) => {
      el.style.setProperty('--lx', `${x}px`);
      el.style.setProperty('--ly', `${y}px`);
    };
    const place = () => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--lr', r.width < 640 ? '120px' : '230px');
      set(px * r.width, py * r.height);
    };
    place();
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      manual = true;
      set(e.clientX - r.left, e.clientY - r.top);
      last = performance.now();
    };
    // Without a mouse (or after the pointer leaves) the lamp sweeps on its own.
    const tick = (t: number) => {
      if (!manual || t - last > 2600) {
        manual = false;
        const r = el.getBoundingClientRect();
        const s = t / 1000;
        if (r.width < 640) {
          // phones: the lamp lives in the band above the card
          px = 0.5 + 0.32 * Math.sin(s * 0.45);
          py = 0.13 + 0.06 * Math.sin(s * 0.7 + 1.1);
        } else {
          px = 0.66 + 0.18 * Math.sin(s * 0.37);
          py = 0.5 + 0.26 * Math.sin(s * 0.53 + 1.1);
        }
        set(px * r.width, py * r.height);
      }
      raf = requestAnimationFrame(tick);
    };
    if (!reduce) raf = requestAnimationFrame(tick);
    if (hover) el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onMove);
    window.addEventListener('resize', place);
    // Pause the sweep when the hero is off screen.
    const io = new IntersectionObserver(([en]) => {
      cancelAnimationFrame(raf);
      if (en.isIntersecting && !reduce) raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onMove);
      window.removeEventListener('resize', place);
    };
  }, []);

  // Enough lines to fill the wall; each line is a real ledger value.
  const lines = Array.from({ length: 30 }, (_, i) => rows[(i * 7) % rows.length]);

  return (
    <section ref={ref} className="relative isolate overflow-hidden border-b border-[var(--rule)] select-none" style={{ ['--lx' as string]: '68%', ['--ly' as string]: '42%' }} aria-label="Public ledger values from the leak zoo, with what each reveals">
      {/* paper layer: what anyone sees on chain */}
      <Wall lines={lines} uv={false} />
      {/* UV layer: what the lamp reveals */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          WebkitMaskImage: 'radial-gradient(circle var(--lr, 230px) at var(--lx) var(--ly), #000 0 97%, transparent 100%)',
          maskImage: 'radial-gradient(circle var(--lr, 230px) at var(--lx) var(--ly), #000 0 97%, transparent 100%)',
        }}
      >
        <Wall lines={lines} uv />
      </div>
      {/* lamp rim */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-[calc(var(--lr,230px)*2)] w-[calc(var(--lr,230px)*2)] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: 'var(--lx)', top: 'var(--ly)', boxShadow: '0 0 0 1.5px rgba(92,242,255,.85), 0 0 0 9px rgba(26,16,64,.18), 0 0 60px 10px rgba(255,79,216,.25)' }}
      />
      {/* headline card */}
      <div className="pointer-events-none relative z-10 mx-auto flex min-h-[640px] max-w-[1180px] items-end px-4 pb-10 pt-[300px] sm:min-h-[720px] sm:items-center sm:px-6 sm:py-16">
        <div className="pointer-events-auto max-w-[560px] rounded-sm border border-[var(--rule)] bg-[var(--sheet)] p-6 shadow-[0_30px_60px_-30px_rgba(13,18,32,.45)] sm:p-9">{children}</div>
      </div>
    </section>
  );
}

function Wall({ lines, uv }: { lines: HeroRow[]; uv: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 overflow-hidden ${uv ? '' : ''}`}
      style={uv ? { background: 'radial-gradient(circle at var(--lx) var(--ly), #2a1a63 0, #1a1040 70%)' } : { background: 'var(--paper)' }}
    >
      <div className="mono absolute -left-24 -right-24 -top-6 grid gap-[2px] text-[12.5px] leading-[22px] sm:text-[13.5px]">
        {lines.map((r, i) => (
          <div key={i} className="flex whitespace-nowrap" style={{ paddingLeft: `${(i * 37) % 120}px` }}>
            {[0, 1, 2].map((k) => {
              const row = lines[(i + k * 11) % lines.length];
              return (
                <span key={k} className="mr-24 inline-flex items-baseline gap-3">
                  <span className={uv ? 'text-[#8a78e0]' : 'text-[var(--faint)] opacity-70'}>
                    {row.field}.{row.contract === 'board' || row.contract === 'payband' ? 'insert' : row.field === 'owner' ? 'write' : 'insert'}
                  </span>
                  <span className={uv ? 'text-[#5d4ca8]' : 'text-[var(--rule-strong)] opacity-80'}>{short(row.key)}</span>
                  <span className="relative">
                    <span className={uv ? 'text-[#4a3b8f]' : 'text-[var(--graphite)] opacity-55'}>{short(row.value)}</span>
                    {uv && (
                      <span className="absolute -left-1 top-0 z-10 whitespace-nowrap rounded-[2px] bg-[#1a1040] px-1 font-bold text-[#ff4fd8]" style={{ textShadow: '0 0 14px rgba(255,79,216,.8)' }}>
                        {row.reveal}
                        <span className="ml-2 font-medium text-[#5cf2ff]" style={{ textShadow: '0 0 10px rgba(92,242,255,.6)' }}>
                          {row.how}
                        </span>
                      </span>
                    )}
                  </span>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
