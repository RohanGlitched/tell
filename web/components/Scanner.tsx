'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The scanner: paste a contract or name a public repository, scan it with the real compiler,
// and read the result as a report (components/Report.tsx). Share links, verified fixes and
// recent scans are handled here; nothing is stored on a server.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Ticks } from './Ticks';
import ReportView, { Card, pushRecent, worstGrade, type Compare } from './Report';
import type { Grade, ScanResponse, VerifiedFix } from '@/lib/types';
import { readShare, shareHash, type Shared } from '@/lib/share';
import { applyDiff } from '@/lib/patch';

type Sample = { id: string; label: string; note: string; source: string };

const MODES = ['source', 'repo'] as const;
const MAX_SOURCE = 200_000;

const behavior = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

// The API answers JSON; a platform error in front of it (413, 504) may not.
async function readError(res: Response): Promise<string> {
  const json = await res.json().catch(() => null);
  if (json?.error) return json.error;
  if (res.status === 413) return 'That request is too large. The limit for a pasted contract is 200 kB.';
  if (res.status === 504) return 'The scan took too long. Large repositories are best scanned with the CLI from github.com/RohanGlitched/tell.';
  if (res.status === 429) return 'That is a lot of scans from one address. Wait a few minutes, or run the CLI from github.com/RohanGlitched/tell.';
  return `The scan failed (${res.status}). Try again in a moment.`;
}

// `sample`: the id of a sample to load and scan at once (deep links from the leak zoo).
export default function Scanner({ samples, sample }: { samples: Sample[]; sample?: string }) {
  const linked = samples.find((s) => s.id === sample);
  const [mode, setMode] = useState<'source' | 'repo'>('source');
  const [source, setSource] = useState(linked?.source ?? samples[0]?.source ?? '');
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [scanned, setScanned] = useState<string>('');
  const [lastBody, setLastBody] = useState<{ source?: string; repo?: string; name?: string } | null>(null);
  // set after "Re-scan with fix": the grade before the patch, and the source it was applied to
  const [compare, setCompare] = useState<Compare | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const autoran = useRef(false);
  // the sample whose text is in the editor, if it is unedited
  const currentSample = samples.find((s) => s.source === source) ?? null;

  async function run(body: { source?: string; repo?: string; name?: string }, text = '', fixed?: { before: Grade; original: string }) {
    setError(null);
    setCompare(null);
    if (body.source && body.source.length > MAX_SOURCE) {
      setResult(null);
      setError(`That contract is ${Math.round(body.source.length / 1000)} kB; the limit is 200 kB.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json().catch(() => {
        throw new Error('The scanner sent back something unreadable. Try again in a moment.');
      })) as ScanResponse;
      setResult(json);
      setScanned(text);
      setLastBody(body);
      if (fixed) setCompare({ ...fixed, after: json.contracts[0]?.grade ?? null });
      const shared: Shared = body.repo ? { kind: 'repo', repo: json.repo ?? body.repo } : { kind: 'source', source: text };
      remember(shared);
      pushRecent({
        name: json.kind === 'repo' ? (json.repo ?? 'repository') : (body.name ?? json.contracts[0]?.file ?? 'contract.compact').replace(/^.*\//, ''),
        grade: worstGrade(json),
        at: new Date().toISOString(),
        hash: shareHash(shared),
      });
      requestAnimationFrame(() => {
        const first = document.querySelector('[data-testid="report-page"], .report-page');
        first?.scrollIntoView({ behavior: behavior(), block: 'start' });
      });
    } catch (e) {
      setResult(null);
      setError((e as Error).message === 'Failed to fetch' ? 'Could not reach the scanner. Check your connection and try again.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // On the scan page the address bar keeps the share link for what was scanned, so a reload
  // or a copied URL restores it. The contract rides in the fragment, which is never sent to a server.
  function remember(s: Shared) {
    if (window.location.pathname !== '/scan') return;
    const hash = s.kind === 'source' && !s.source ? '' : shareHash(s);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  }

  // Apply the engine's patch to the scanned source and scan the result, keeping the grade before.
  function rescanWithFix(fix: VerifiedFix, before: Grade) {
    const applied = applyDiff(scanned, fix.diff);
    if (!applied.ok) {
      setError(applied.error);
      return;
    }
    setMode('source');
    setSource(applied.text);
    void run({ source: applied.text, name: result?.contracts[0]?.file }, applied.text, { before, original: scanned });
  }

  function restore(original: string) {
    setSource(original);
    void run({ source: original, name: result?.contracts[0]?.file }, original);
  }

  // Restore what a share link (#c=… or #r=…) carries, and scan it.
  function restoreShared(hash: string): boolean {
    const shared = readShare(hash);
    if (shared?.kind === 'source') {
      setMode('source');
      setSource(shared.source);
      void run({ source: shared.source }, shared.source);
      return true;
    }
    if (shared?.kind === 'repo') {
      setMode('repo');
      setRepo(shared.repo);
      void run({ repo: shared.repo });
      return true;
    }
    if (/[#&](c|r)=/.test(hash)) setError('That share link is damaged or incomplete, so there is nothing to restore. Paste the contract instead.');
    return false;
  }

  // A deep link with ?sample= scans that sample straight away (its result is precomputed);
  // a share link restores the contract or repository and scans it.
  useEffect(() => {
    if (autoran.current) return;
    autoran.current = true;
    if (linked) void run({ source: linked.source, name: `${linked.id}.compact` }, linked.source);
    else restoreShared(window.location.hash);
    // a recent scan picked from the list changes only the fragment
    const onHash = () => {
      const s = readShare(window.location.hash);
      const current = result?.kind === 'repo' ? result.repo : scanned;
      if (s && (s.kind === 'repo' ? s.repo : s.source) !== current) restoreShared(window.location.hash);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? MODES.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const j = (next + MODES.length) % MODES.length;
    setMode(MODES[j]);
    tabRefs.current[j]?.focus();
  }

  const input = (
    <div ref={topRef} className="rounded-md bg-white shadow-[0_1px_0_var(--rule),0_24px_60px_-48px_rgba(26,20,70,.45)]">
      <div role="tablist" aria-label="What to scan" className="flex border-b border-[var(--rule)] px-2 text-[14px] sm:px-5">
        {MODES.map((m, i) => (
          <button
            key={m}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`scan-tab-${m}`}
            aria-selected={mode === m}
            aria-controls={mode === m ? `scan-panel-${m}` : undefined}
            tabIndex={mode === m ? 0 : -1}
            onClick={() => setMode(m)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`-mb-px min-h-[46px] px-3 font-medium ${mode === m ? 'border-b-2 border-[var(--marker)] text-[var(--ink)]' : 'text-[var(--graphite)] hover:text-[var(--ink)]'}`}
          >
            {m === 'source' ? 'Paste a contract' : 'GitHub repository'}
          </button>
        ))}
      </div>

      {mode === 'source' ? (
        <form
          id="scan-panel-source"
          role="tabpanel"
          aria-labelledby="scan-tab-source"
          className="p-4 sm:px-6 sm:py-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ source }, source);
          }}
        >
          {/* One row that scrolls sideways on a phone, so the editor and the Scan button stay in view;
              it wraps on wider screens. The sample in the editor is marked. */}
          <div className="mb-3 text-[13.5px]">
            <div className="mb-1.5 flex items-baseline justify-between gap-3 sm:hidden">
              <span className="text-[var(--faint)]" aria-hidden="true">
                Samples ({samples.length}), swipe for more
              </span>
            </div>
            <div
              role="group"
              aria-label="Sample contracts"
              data-testid="sample-row"
              className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] sm:mx-0 sm:flex-wrap sm:items-center sm:overflow-visible sm:px-0 sm:pb-0"
            >
              <span className="hidden shrink-0 text-[var(--faint)] sm:inline">Samples:</span>
              {samples.map((s) => {
                const on = s.id === currentSample?.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setSource(s.source);
                      void run({ source: s.source, name: `${s.id}.compact` }, s.source);
                    }}
                    className={`min-h-[44px] shrink-0 snap-start whitespace-nowrap rounded-md border px-3 sm:min-h-[32px] sm:px-2.5 ${on ? 'border-[var(--indigo)] bg-[var(--indigo)] text-white' : 'border-[var(--rule)] bg-white hover:border-[var(--ink-3)]'}`}
                    title={s.note}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[12.5px] text-[var(--graphite)]" aria-live="polite" data-testid="sample-current">
              {currentSample ? (
                <>
                  In the editor: <b className="font-semibold text-[var(--ink)]">{currentSample.label}</b>, {currentSample.note}.
                </>
              ) : (
                'In the editor: your own contract.'
              )}
            </p>
          </div>
          <label htmlFor="src" className="sr-only">
            Compact source
          </label>
          <textarea
            id="src"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            rows={12}
            className="mono block w-full resize-y rounded-md border border-[var(--rule)] bg-[var(--mist)] p-3 text-[12.5px] leading-[1.7] text-[var(--ink)]"
            placeholder={'pragma language_version 0.23;\n\nimport CompactStandardLibrary;\n…'}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button disabled={busy || !source.trim()} className="btn btn-pri">
              {busy ? 'Compiling and tracing…' : 'Scan this contract'}
            </button>
            <span className="text-[13.5px] text-[var(--graphite)]">Compiled by the real Compact compiler, matched to your pragma. Nothing is stored.</span>
          </div>
        </form>
      ) : (
        <form
          id="scan-panel-repo"
          role="tabpanel"
          aria-labelledby="scan-tab-repo"
          className="p-4 sm:px-6 sm:py-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ repo });
          }}
        >
          <label htmlFor="repo" className="block text-[14px] font-medium">
            Public repository
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="github.com/midnightntwrk/example-bboard"
              className="mono min-h-[44px] flex-1 rounded-md border border-[var(--rule)] bg-[var(--mist)] px-3 text-[14px]"
              autoComplete="off"
            />
            <button disabled={busy || !repo.trim()} className="btn btn-pri">
              {busy ? 'Fetching and scanning…' : 'Scan repository'}
            </button>
          </div>
          <p className="mt-2 text-[13.5px] text-[var(--graphite)]">Every .compact contract in the default branch, up to 30. Larger repositories: use the CLI.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
            {['midnightntwrk/example-bboard', 'midnightntwrk/example-zkloan', 'midnightntwrk/example-battleship'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRepo(r);
                  void run({ repo: r });
                }}
                className="mono min-h-[44px] rounded-md border border-[var(--rule)] bg-white px-3 hover:border-[var(--ink-3)] sm:min-h-[32px] sm:px-2.5"
              >
                {r}
              </button>
            ))}
          </div>
        </form>
      )}
    </div>
  );

  const status = (
    <>
      {error && (
        <div role="alert" className="rounded-md border border-[var(--marker)] bg-[var(--marker-soft)] px-4 py-3 text-[14px] text-[var(--marker-ink)]">
          <Ticks text={error} />
        </div>
      )}
      {busy && (
        <div className="space-y-3" aria-hidden="true">
          <div className="h-40 animate-pulse rounded-md bg-white/70" />
          <div className="h-24 animate-pulse rounded-md bg-white/50" />
        </div>
      )}
    </>
  );

  const idle = (
    <>
      <Card title="What you get">
        <ul className="grid gap-2 text-[13px] text-[var(--graphite)]">
          <li>A grade from A to F for each contract.</li>
          <li>Numbered findings: the line, what it gives away in bits, and the fix.</li>
          <li>The public transcript of each circuit: what a chain observer records.</li>
          <li>A share link, a PDF for an audit appendix, SARIF and JSON.</li>
        </ul>
      </Card>
      <Card title="Private by design">
        <p className="text-[13px] text-[var(--graphite)]">Your contract is compiled in a temporary folder and deleted after the scan. A share link carries the contract inside the link itself. Page views are counted by Vercel Web Analytics, without cookies, and the part of a link that holds a contract is removed before anything is counted.</p>
      </Card>
    </>
  );

  return (
    <ReportView
      result={result}
      source={scanned}
      compare={compare}
      busy={busy}
      onFix={result?.kind === 'source' && scanned ? rescanWithFix : undefined}
      onRestore={() => compare && restore(compare.original)}
      onRescan={lastBody ? () => void run(lastBody, lastBody.source ?? '') : undefined}
      input={input}
      status={status}
      idle={idle}
    />
  );
}
