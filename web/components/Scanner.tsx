'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Transcript from './Transcript';
import { plain, Ticks } from './Ticks';
import { GRADE_TEXT, KIND_LABEL, SEVERITY_ORDER, type ContractResult, type Finding, type ScanResponse, type Severity } from '@/lib/types';

type Sample = { id: string; label: string; note: string; source: string };

const SEV_STYLE: Record<Severity, string> = {
  critical: 'bg-[var(--red)] text-white',
  high: 'bg-[var(--red-soft)] text-[var(--red)] ring-1 ring-[var(--red)]',
  medium: 'bg-[var(--hi)] text-[#151b2c]',
  low: 'bg-[var(--hi-soft)] text-[var(--ink)]',
  info: 'bg-[var(--paper)] text-[var(--graphite)] ring-1 ring-[var(--rule)]',
};

const MODES = ['source', 'repo'] as const;
const MAX_SOURCE = 200_000;

// Smooth scrolling unless the visitor asked for less motion.
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
  const resultsRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const autoran = useRef(false);

  // Bring the results area on screen if it is below the fold (phones), so a scan visibly starts.
  function reveal() {
    requestAnimationFrame(() => {
      const el = resultsRef.current;
      if (el && el.getBoundingClientRect().top > window.innerHeight - 120) el.scrollIntoView({ behavior: behavior(), block: 'start' });
    });
  }

  async function run(body: { source?: string; repo?: string; name?: string }, text = '') {
    setError(null);
    if (body.source && body.source.length > MAX_SOURCE) {
      setResult(null);
      setError(`That contract is ${Math.round(body.source.length / 1000)} kB; the limit is 200 kB.`);
      return;
    }
    setBusy(true);
    reveal();
    try {
      const res = await fetch('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json().catch(() => {
        throw new Error('The scanner sent back something unreadable. Try again in a moment.');
      })) as ScanResponse;
      setResult(json);
      setScanned(text);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: behavior(), block: 'start' }));
    } catch (e) {
      setResult(null);
      setError((e as Error).message === 'Failed to fetch' ? 'Could not reach the scanner. Check your connection and try again.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A deep link with ?sample= scans that sample straight away (its result is precomputed).
  useEffect(() => {
    if (!linked || autoran.current) return;
    autoran.current = true;
    void run({ source: linked.source, name: `${linked.id}.compact` }, linked.source);
  }, []);

  // Arrow keys, Home and End move between the two tabs (WAI-ARIA tabs pattern).
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? MODES.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const j = (next + MODES.length) % MODES.length;
    setMode(MODES[j]);
    tabRefs.current[j]?.focus();
  }

  return (
    <div>
      <div className="sheet rounded-md">
        <div role="tablist" aria-label="What to scan" className="flex border-b border-[var(--rule)] text-[14px]">
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
              className={`min-h-[44px] px-4 font-medium ${mode === m ? 'border-b-2 border-[var(--ink)] text-[var(--ink)]' : 'text-[var(--graphite)] hover:text-[var(--ink)]'}`}
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
            className="p-4 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run({ source }, source);
            }}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[14px]">
              <span className="text-[var(--graphite)]">Try:</span>
              {samples.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSource(s.source);
                    void run({ source: s.source, name: `${s.id}.compact` }, s.source);
                  }}
                  className="min-h-[44px] rounded border border-[var(--rule)] bg-[var(--paper)] px-3 py-1 hover:border-[var(--ink)] sm:min-h-[36px] sm:px-2.5"
                  title={s.note}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <label htmlFor="src" className="sr-only">
              Compact source
            </label>
            <textarea
              id="src"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              spellCheck={false}
              rows={14}
              className="mono block w-full resize-y rounded border border-[var(--rule)] bg-[var(--paper)] p-3 text-[13px] leading-[1.6] text-[var(--ink)]"
              placeholder={'pragma language_version 0.23;\n\nimport CompactStandardLibrary;\n…'}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button disabled={busy || !source.trim()} className="min-h-[44px] rounded bg-[var(--ink)] px-5 font-medium text-[var(--paper)] disabled:opacity-50">
                {busy ? 'Compiling and tracing…' : 'Scan this contract'}
              </button>
              <span className="text-[14px] text-[var(--graphite)]">Compiled by the real Compact compiler, matched to your pragma. Nothing is stored.</span>
            </div>
          </form>
        ) : (
          <form
            id="scan-panel-repo"
            role="tabpanel"
            aria-labelledby="scan-tab-repo"
            className="p-4 sm:p-5"
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
                className="mono min-h-[44px] flex-1 rounded border border-[var(--rule)] bg-[var(--paper)] px-3 text-[14px]"
                autoComplete="off"
              />
              <button disabled={busy || !repo.trim()} className="min-h-[44px] rounded bg-[var(--ink)] px-5 font-medium text-[var(--paper)] disabled:opacity-50">
                {busy ? 'Fetching and scanning…' : 'Scan repository'}
              </button>
            </div>
            <p className="mt-2 text-[14px] text-[var(--graphite)]">Every .compact contract in the default branch, up to 30. Larger repositories: use the CLI.</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
              {['midnightntwrk/example-bboard', 'midnightntwrk/example-zkloan', 'midnightntwrk/example-battleship'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRepo(r);
                    void run({ repo: r });
                  }}
                  className="mono min-h-[44px] rounded border border-[var(--rule)] bg-[var(--paper)] px-3 py-1 hover:border-[var(--ink)] sm:min-h-[36px] sm:px-2.5"
                >
                  {r}
                </button>
              ))}
            </div>
          </form>
        )}
      </div>

      <div ref={resultsRef} aria-live="polite" className="scroll-mt-20">
        {error && (
          <div role="alert" className="mt-5 rounded border border-[var(--red)] bg-[var(--red-soft)] px-4 py-3 text-[14px] text-[var(--red)]">
            <Ticks text={error} />
          </div>
        )}
        {busy && <Skeleton />}
        {!busy && result && <Results result={result} source={scanned} />}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-6 space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="tape h-16 animate-pulse rounded-sm opacity-70" />
      ))}
    </div>
  );
}

// The whole scan result as a file, to keep or attach to a review.
function download(result: ScanResponse) {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tell-${result.repo ? result.repo.replace(/\//g, '-') : (result.contracts[0]?.file ?? 'contract').replace(/\.compact$/, '')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The compiler prefixes its messages with the exception class; the message is enough.
const compileError = (e?: string) => (e ?? '').replace(/^Exception:\s*/gm, '');

function Results({ result, source }: { result: ScanResponse; source: string }) {
  const contracts = result.contracts;
  const counts = contracts.filter((c) => c.ok).length;
  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--rule)] pb-3">
        <h2 className="text-[20px] font-semibold">
          {result.kind === 'repo' ? (
            <>
              <span className="mono text-[17px]">{result.repo}</span>
              {result.commit && <span className="mono ml-2 text-[13px] text-[var(--graphite)]">@ {result.commit.slice(0, 7)}</span>}
            </>
          ) : (
            'Your contract'
          )}
        </h2>
        <span className="text-[14px] text-[var(--graphite)] num">
          {counts} of {contracts.length} contract{contracts.length === 1 ? '' : 's'} analyzed in {(result.ms / 1000).toFixed(1)} s{result.precomputed ? ' (sample, scanned ahead of time; edit any line to scan it live)' : ''}
          {result.skipped ? `, ${result.skipped} more not scanned` : ''}
        </span>
        <button
          type="button"
          onClick={() => download(result)}
          className="ml-auto inline-flex min-h-[44px] items-center rounded border border-[var(--rule)] px-3 text-[14px] hover:border-[var(--ink)] sm:min-h-[36px]"
        >
          Download JSON
        </button>
      </div>
      {contracts.length === 0 && (
        <p className="mt-4 text-[var(--graphite)]">No Compact contracts in this repository. Tell looks for .compact files with a pragma and an exported circuit.</p>
      )}
      <div className="space-y-10">
        {contracts.map((c) => (
          <ContractView key={c.file} c={c} source={result.kind === 'source' ? source : undefined} repo={result.repo} commit={result.commit ?? undefined} />
        ))}
      </div>
    </div>
  );
}

function ContractView({ c, source, repo, commit }: { c: ContractResult; source?: string; repo?: string; commit?: string }) {
  const [showInfo, setShowInfo] = useState(false);
  const [focus, setFocus] = useState<{ circuit: string; field: string } | null>(null);
  if (!c.ok)
    return (
      <section className="pt-6">
        <h3 className="mono text-[15px]">{c.file}</h3>
        <p className="mt-2 text-[14px] text-[var(--graphite)]">This contract did not compile, so there is nothing to trace yet:</p>
        <pre className="mono mt-2 overflow-x-auto whitespace-pre-wrap rounded border border-[var(--rule)] bg-[var(--sheet)] p-3 text-[12.5px]">{compileError(c.error)}</pre>
      </section>
    );
  const findings = c.report!.findings.filter((f) => !f.suppressed);
  const shown = findings
    .filter((f) => showInfo || f.severity !== 'info')
    .filter((f) => !focus || (f.circuit === focus.circuit && (f.fields ?? [`${f.field}.${f.op}`]).some((x) => x.startsWith(focus.field + '.'))))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const hidden = findings.filter((f) => f.severity === 'info').length;
  const lines = source?.split('\n');
  const lineHref = (n?: number) => (repo && commit && n ? `https://github.com/${repo}/blob/${commit}/${c.file}#L${n}` : undefined);

  return (
    <section className="pt-6">
      <div className="flex flex-wrap items-start gap-5">
        <Stamp grade={c.grade!} />
        <div className="min-w-0 flex-1">
          <h3 className="mono break-all text-[15px]">{c.file}</h3>
          <p className="mt-1 max-w-[62ch] text-[15px]">{GRADE_TEXT[c.grade!]}</p>
          <p className="mt-1 text-[13px] text-[var(--graphite)]">
            Compact {c.compiler} (language {c.language}) · {c.report!.circuits.length} circuit{c.report!.circuits.length === 1 ? '' : 's'} ·{' '}
            {SEVERITY_ORDER.filter((s) => c.counts?.[s]).map((s) => `${c.counts![s]} ${s}`).join(', ') || 'no findings'}
          </p>
        </div>
      </div>

      <LeakMap c={c} focus={focus} onFocus={setFocus} />

      <Transcript circuits={c.report!.circuits} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[15px] font-semibold">
          {focus ? (
            <>
              <span className="mono">{focus.circuit}</span> → <span className="mono">{focus.field}</span>{' '}
              <button onClick={() => setFocus(null)} className="ml-2 text-[13px] font-normal text-[var(--graphite)] underline">
                show all
              </button>
            </>
          ) : (
            'Findings'
          )}
        </h4>
        {hidden > 0 && (
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-[14px] text-[var(--graphite)] sm:min-h-[36px]">
            <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" />
            Show {hidden} info-level disclosure{hidden === 1 ? '' : 's'}
          </label>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-[14px] text-[var(--graphite)]">
          {findings.length === 0 ? 'No disclosures found. Every private input stays private or is only proven about.' : 'Nothing above info level here.'}
        </p>
      ) : (
        <ol className="mt-3 space-y-3">
          {shown.map((f, i) => (
            <FindingCard key={i} f={f} lines={lines} href={lineHref(f.line)} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Stamp({ grade }: { grade: string }) {
  const bad = grade === 'D' || grade === 'F';
  return (
    <div
      aria-label={`Grade ${grade}`}
      className={`grid h-[72px] w-[72px] shrink-0 -rotate-6 place-items-center rounded-full border-[3px] text-[34px] font-bold ${
        bad ? 'border-[var(--red)] text-[var(--red)]' : grade === 'C' ? 'border-[var(--amber)] text-[var(--amber)]' : 'border-[var(--ink)] text-[var(--ink)]'
      }`}
      style={{ boxShadow: 'inset 0 0 0 3px var(--sheet), inset 0 0 0 4px currentColor' }}
    >
      {grade}
    </div>
  );
}

// Rows: circuits. Columns: ledger fields. A cell is the worst thing that circuit tells that field.
function LeakMap({ c, focus, onFocus }: { c: ContractResult; focus: { circuit: string; field: string } | null; onFocus: (f: { circuit: string; field: string } | null) => void }) {
  const { circuits, fields, cell } = useMemo(() => {
    const circuits = c.report!.circuits.filter((x) => x.touches.length > 0);
    const fields = [...new Set(circuits.flatMap((x) => x.touches))];
    const cell = new Map<string, Finding>();
    for (const f of c.report!.findings) {
      if (f.suppressed) continue;
      for (const fl of f.fields ?? [`${f.field}.${f.op}`]) {
        const field = fl.split('.')[0];
        const k = `${f.circuit}|${field}`;
        const prev = cell.get(k);
        if (!prev || SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(prev.severity)) cell.set(k, f);
      }
    }
    return { circuits, fields, cell };
  }, [c]);
  if (circuits.length === 0) return null;
  return (
    <figure className="mt-6">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--graphite)]">
        <span className="font-medium text-[var(--ink)]">Leak map</span>
        <span>Each cell: what a circuit tells a public field. Select a cell to filter.</span>
        <Legend />
      </figcaption>
      <div className="overflow-x-auto rounded border border-[var(--rule)] bg-[var(--sheet)]">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 whitespace-nowrap bg-[var(--sheet)] px-3 py-2 text-left font-medium text-[var(--graphite)]">circuit ↓ field →</th>
              {fields.map((f) => (
                <th key={f} className="mono whitespace-nowrap px-2 py-2 text-left font-medium">
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {circuits.map((ci) => (
              <tr key={ci.name} className="border-t border-[var(--rule)]">
                <th scope="row" className="mono sticky left-0 z-10 whitespace-nowrap bg-[var(--sheet)] px-3 py-1.5 text-left font-medium">
                  {ci.name}
                </th>
                {fields.map((fl) => {
                  const touched = ci.touches.includes(fl);
                  const f = cell.get(`${ci.name}|${fl}`);
                  const active = focus?.circuit === ci.name && focus.field === fl;
                  return (
                    <td key={fl} className="px-1 py-1">
                      {touched ? (
                        <button
                          onClick={() => onFocus(active ? null : { circuit: ci.name, field: fl })}
                          className={`block h-7 w-full min-w-[54px] rounded-sm text-[11px] font-medium pointer-coarse:h-11 ${f ? SEV_STYLE[f.severity] : 'bg-[var(--paper)] text-[var(--faint)] ring-1 ring-[var(--rule)]'} ${active ? 'outline outline-2 outline-[var(--ink)]' : ''}`}
                          aria-label={`${ci.name} → ${fl}: ${f ? `${f.severity}, ${KIND_LABEL[f.kind]}` : 'public data only'}`}
                          title={f ? plain(f.title) : 'Touched with public data only'}
                        >
                          {f ? (f.bits > 0 ? `${f.bits}b` : '·') : '—'}
                        </button>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {SEVERITY_ORDER.map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className={`inline-block h-3 w-4 rounded-sm ${SEV_STYLE[s]}`} />
          {s}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="inline-grid h-3 w-4 place-items-center rounded-sm bg-[var(--paper)] text-[9px] leading-none text-[var(--faint)] ring-1 ring-[var(--rule)]">—</span>
        public data only
      </span>
      <span>
        <b className="mono font-medium text-[var(--ink)]">8b</b> bits given away, <b className="mono font-medium text-[var(--ink)]">·</b> a finding with no bits counted
      </span>
    </span>
  );
}

function FindingCard({ f, lines, href }: { f: Finding; lines?: string[]; href?: string }) {
  const excerpt = f.line && lines ? lines.slice(Math.max(0, f.line - 2), f.line + 1).map((t, i) => ({ n: Math.max(1, f.line! - 1) + i, t })) : null;
  return (
    <li className="sheet rounded-sm p-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className={`rounded-sm px-2 py-0.5 font-semibold uppercase tracking-[0.04em] ${SEV_STYLE[f.severity]}`}>{f.severity}</span>
        <span className="font-medium">{KIND_LABEL[f.kind]}</span>
        <span className="mono text-[var(--graphite)]">{f.circuit}</span>
        {f.bits > 0 && <span className="mono text-[var(--graphite)] num">{f.bits} bit{f.bits === 1 ? '' : 's'}</span>}
        {f.line && (href ? (
          <a href={href} target="_blank" rel="noreferrer" className="mono ml-auto text-[var(--graphite)]">
            line {f.line}
          </a>
        ) : (
          <span className="mono ml-auto text-[var(--graphite)]">line {f.line}</span>
        ))}
      </div>
      <p className="hand mt-2 text-[19px] leading-snug">
        <Ticks text={f.title} />
      </p>
      <p className="mt-1.5 max-w-[78ch] text-[14.5px] text-[var(--ink)]">
        <Ticks text={f.detail} />
      </p>
      {excerpt && (
        <pre className="mono mt-3 overflow-x-auto rounded-sm border border-[var(--rule)] bg-[var(--paper)] py-2 text-[12.5px] leading-[1.6]">
          {excerpt.map((l) => (
            <div key={l.n} className={`px-3 ${l.n === f.line ? (f.severity === 'critical' || f.severity === 'high' ? 'bg-[var(--red-soft)]' : 'bg-[var(--hi-soft)]') : ''}`}>
              <span className="mr-3 inline-block w-8 select-none text-right text-[var(--faint)]">{l.n}</span>
              {l.t || ' '}
            </div>
          ))}
        </pre>
      )}
      {f.fields && f.fields.length > 1 && (
        <p className="mono mt-2 text-[12.5px] text-[var(--graphite)]">touches {f.fields.join(', ')}</p>
      )}
      <p className="mt-2 text-[14px]">
        <span className="font-semibold">Fix: </span>
        <Ticks text={f.fix} />
      </p>
    </li>
  );
}
