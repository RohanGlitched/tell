'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// A scan result as an audit-style report: a document per contract (summary, numbered findings
// F-1…, measurements, source, public transcript, fix, appendix), a table of contents, and an
// actions rail (apply fix, re-scan, share, downloads, README badge). Print gives the PDF.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Transcript from './Transcript';
import { plain, Ticks } from './Ticks';
import { GradeSeal, Sev } from './brand';
import { behaviourOf, fixOf, GRADE_TEXT, KIND_LABEL, SEVERITY_ORDER, type CircuitReport, type ContractResult, type Finding, type Grade, type ScanResponse, type VerifiedFix } from '@/lib/types';
import { shareHash } from '@/lib/share';
import { downloadText, reportName, toJson, toMarkdown, toSarif } from '@/lib/report';
import { badgeMarkdown, badgeSvg } from '@/lib/badge';

const SITE = 'https://tell-midnight.vercel.app';
const MAJOR = new Set(['critical', 'high', 'medium']);
const GRADES = 'ABCDF';

export type Compare = { before: Grade; after: Grade | null; original: string };
type Numbered = Finding & { id: string };

// ---- recent scans: kept in this browser only --------------------------------------------------
export type Recent = { name: string; grade: Grade | null; at: string; hash: string };
const RECENT_KEY = 'tell:recent-scans';
export function readRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function pushRecent(r: Recent) {
  try {
    const list = [r, ...readRecent().filter((x) => x.hash !== r.hash)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* private mode: nothing to remember */
  }
}

export function worstGrade(result: ScanResponse): Grade | null {
  const g = result.contracts.filter((c) => c.ok && c.grade).map((c) => c.grade!);
  return g.length ? g.reduce((w, x) => (GRADES.indexOf(x) > GRADES.indexOf(w) ? x : w)) : null;
}

function numbered(c: ContractResult): Numbered[] {
  return (c.report?.findings ?? [])
    .filter((f) => !f.suppressed)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (a.line ?? 0) - (b.line ?? 0))
    .map((f, i) => ({ ...f, id: `F-${i + 1}` }));
}

const anchor = (ci: number, id: string) => `c${ci}-${id.toLowerCase()}`;

// ---- the whole report -------------------------------------------------------------------------
export default function ReportView({
  result,
  source,
  compare,
  onFix,
  onRestore,
  onRescan,
  busy,
  input,
  status,
  idle,
}: {
  result: ScanResponse | null;
  source: string;
  compare: Compare | null;
  onFix?: (fix: VerifiedFix, before: Grade) => void;
  onRestore: () => void;
  onRescan?: () => void;
  busy: boolean;
  input: ReactNode; // the scan form, at the top of the centre column
  status: ReactNode; // error and progress, under the form
  idle: ReactNode; // the rail before anything is scanned
}) {
  const contracts = result?.contracts ?? [];
  const lists = useMemo(() => contracts.map(numbered), [contracts]);
  return (
    <div className="report-layout grid gap-7 lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[200px_minmax(0,1fr)_260px]">
      <Toc result={result} lists={lists} />
      <div className="min-w-0 space-y-7">
        <div className="no-print">{input}</div>
        <div aria-live="polite">{status}</div>
        {result && !busy && contracts.length === 0 && (
          <article className="report-page scroll-mt-24 rounded-md bg-white p-8 shadow-[0_1px_0_var(--rule)]">
            <p className="text-[var(--graphite)]">No Compact contracts in this repository. Tell looks for .compact files with a pragma and an exported circuit.</p>
          </article>
        )}
        {result &&
          !busy &&
          contracts.map((c, i) => (
            <ContractReport
              key={c.file}
              c={c}
              ci={i}
              list={lists[i]}
              result={result}
              source={result.kind === 'source' ? source : undefined}
              onFix={onFix && c.grade ? (fix) => onFix(fix, c.grade!) : undefined}
            />
          ))}
      </div>
      {result && !busy ? <Rail result={result} source={source} lists={lists} compare={compare} onFix={onFix} onRestore={onRestore} onRescan={onRescan} busy={busy} /> : <aside className="report-rail grid content-start gap-3.5 self-start lg:sticky lg:top-24">{idle}</aside>}
    </div>
  );
}

function Toc({ result, lists }: { result: ScanResponse | null; lists: Numbered[][] }) {
  const [recent, setRecent] = useState<Recent[]>([]);
  useEffect(() => setRecent(readRecent()), [result]);
  return (
    <nav className="report-toc sticky top-24 hidden self-start text-[13.5px] xl:block" aria-label="Report contents">
      {result && <p className="mb-2 text-[12.5px] text-[var(--faint)]">This report</p>}
      {result?.contracts.map((c, i) => (
        <div key={c.file} className="mb-2">
          <a href={`#c${i}-summary`} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 font-semibold no-underline hover:bg-white/60">
            <span className="h-2 w-2 shrink-0 rounded-[2px] bg-[var(--indigo)]" />
            <span className="truncate">{result.contracts.length > 1 ? c.file.split('/').pop() : 'Summary'}</span>
          </a>
          {lists[i].filter((f) => MAJOR.has(f.severity)).slice(0, 8).map((f) => (
            <a key={f.id} href={`#${anchor(i, f.id)}`} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[var(--graphite)] no-underline hover:bg-white/60">
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: `var(--sev-${f.severity}-bg)` }} />
              <span className="truncate">
                {f.id} {KIND_LABEL[f.kind]}
              </span>
            </a>
          ))}
          {lists[i].some((f) => !MAJOR.has(f.severity)) && (
            <a href={`#c${i}-minor`} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[var(--graphite)] no-underline hover:bg-white/60">
              <span className="h-2 w-2 shrink-0 rounded-[2px] bg-[var(--violet-soft)]" />
              Lower severity
            </a>
          )}
          {c.ok && (
            <a href={`#c${i}-appendix`} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[var(--graphite)] no-underline hover:bg-white/60">
              <span className="h-2 w-2 shrink-0 rounded-[2px] bg-[var(--faint)]" />
              Appendix
            </a>
          )}
        </div>
      ))}
      {!result && recent.length === 0 && <p className="text-[12.5px] leading-[1.5] text-[var(--faint)]">Your scans will be listed here, in this browser only.</p>}
      {recent.length > 0 && (
        <>
          {result && <hr className="my-3 border-[var(--rule)]" />}
          <p className="mb-1 text-[12.5px] text-[var(--faint)]">Your recent scans, in this browser</p>
          {recent.map((r) => (
            <a key={r.hash + r.at} href={`/scan${r.hash}`} className="block truncate rounded-md px-2.5 py-1.5 text-[var(--graphite)] no-underline hover:bg-white/60">
              {r.name}, grade {r.grade ?? '?'}
            </a>
          ))}
        </>
      )}
    </nav>
  );
}

// ---- one contract's report --------------------------------------------------------------------
function ContractReport({ c, ci, list, result, source, onFix }: { c: ContractResult; ci: number; list: Numbered[]; result: ScanResponse; source?: string; onFix?: (fix: VerifiedFix) => void }) {
  const [showInfo, setShowInfo] = useState(false);
  if (!c.ok)
    return (
      <article className="report-page scroll-mt-24 rounded-md bg-white shadow-[0_1px_0_var(--rule),0_24px_60px_-40px_rgba(26,20,70,.45)]" id={`c${ci}-summary`}>
        <header className="border-b-2 border-[var(--indigo)] px-5 py-6 sm:px-11 sm:py-8">
          <p className="text-[13px] text-[var(--faint)]">Privacy report for</p>
          <h2 className="mono mt-1 break-all text-[20px]">{c.file}</h2>
          <p className="mt-3 text-[15px] text-[var(--graphite)]">This contract did not compile, so there is nothing to trace yet:</p>
        </header>
        <pre className="well mx-5 my-6 whitespace-pre-wrap px-4 sm:mx-11">{(c.error ?? '').replace(/^Exception:\s*/gm, '')}</pre>
      </article>
    );
  const major = list.filter((f) => MAJOR.has(f.severity));
  const minor = list.filter((f) => !MAJOR.has(f.severity));
  const infos = minor.filter((f) => f.severity === 'info').length;
  const shownMinor = minor.filter((f) => showInfo || f.severity !== 'info');
  const lines = source?.split('\n');
  const circuits = c.report!.circuits;
  const lineHref = (n?: number) => (result.repo && result.commit && n ? `https://github.com/${result.repo}/blob/${result.commit}/${c.file}#L${n}` : undefined);
  const firstPatch = major.map((f) => fixOf(f).patch).find((p) => p?.verified && p.gradeAfter);

  return (
    <article className="report-page scroll-mt-24 rounded-md bg-white shadow-[0_1px_0_var(--rule),0_24px_60px_-40px_rgba(26,20,70,.45)]" data-testid="report-page">
      <header id={`c${ci}-summary`} className="grid scroll-mt-24 grid-cols-[1fr_auto] items-start gap-6 border-b-2 border-[var(--indigo)] px-5 py-6 max-sm:grid-cols-1 sm:px-11 sm:pb-7 sm:pt-9">
        <div className="max-sm:order-2">
          <p className="text-[13px] text-[var(--faint)]">Privacy report for</p>
          <h2 className="mt-1.5 text-[23px] leading-[1.2] sm:text-[30px]">
            <code className="mono block break-all text-[0.74em]">{c.file}</code>
            {headline(c.grade!)}
          </h2>
          <p className="mt-2.5 max-w-[56ch] text-[15.5px] text-[var(--graphite)]">{summary(c, major, minor, firstPatch, showInfo)}</p>
        </div>
        <div className="max-sm:order-1">
          <GradeSeal grade={c.grade!} size={84} />
        </div>
      </header>
      <dl className="grid grid-cols-2 border-b border-[var(--rule)] sm:grid-cols-4">
        <Fact k="Compiler" v={`Compact ${c.compiler ?? '?'}`} first />
        <Fact k="Circuits" v={circuits.length <= 3 ? circuits.map((x) => x.name).join(', ') || 'none' : `${circuits.length} circuits`} />
        <Fact k="Scanned" v={`${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${(result.ms / 1000).toFixed(1)} s`} />
        <Fact k={result.kind === 'repo' ? 'Commit' : 'Source'} v={result.kind === 'repo' ? (result.commit?.slice(0, 7) ?? 'default branch') : 'pasted, not stored'} />
      </dl>

      <Sec title="Findings" id={`c${ci}-findings`}>
        {list.length === 0 ? (
          <p className="text-[15px] text-[var(--graphite)]">No disclosures found. Every private input stays private or is only proven about.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-[var(--rule)]">
            {list.filter((f) => showInfo || f.severity !== 'info').map((f) => (
              <a
                key={f.id}
                href={`#${MAJOR.has(f.severity) ? anchor(ci, f.id) : `c${ci}-minor`}`}
                className="grid grid-cols-[40px_1fr_auto] items-baseline gap-3 border-t border-[var(--rule)] px-4 py-3 text-[14.5px] no-underline first:border-t-0 hover:bg-[var(--mist)] sm:grid-cols-[42px_1fr_auto_auto] sm:gap-3.5"
              >
                <span className="mono text-[12.5px] text-[var(--faint)]">{f.id}</span>
                <span className="min-w-0">
                  {KIND_LABEL[f.kind]} <span className="mono text-[12.5px] text-[var(--faint)]">in {f.circuit}</span>
                </span>
                <span className="mono hidden text-[12.5px] text-[var(--faint)] sm:inline">{f.bits > 0 ? `${f.bits} bit${f.bits === 1 ? '' : 's'}` : f.line ? `line ${f.line}` : ''}</span>
                <Sev s={f.severity} />
              </a>
            ))}
          </div>
        )}
        {infos > 0 && (
          <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-2 text-[14px] text-[var(--graphite)] sm:min-h-[32px]">
            <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} className="h-4 w-4 accent-[var(--indigo)]" />
            Show {infos} info-level disclosure{infos === 1 ? '' : 's'} (values published on purpose)
          </label>
        )}
      </Sec>

      <LeakMap c={c} />

      {major.map((f) => (
        <FindingSection key={f.id} f={f} ci={ci} lines={lines} href={lineHref(f.line)} circuits={circuits} onFix={onFix} file={c.file} others={major.filter((o) => o.id !== f.id)} />
      ))}

      {shownMinor.length > 0 && (
        <Sec title="Lower-severity findings" id={`c${ci}-minor`}>
          <ol className="grid gap-3.5">
            {shownMinor.map((f) => (
              <li key={f.id} className="grid grid-cols-[38px_1fr_auto] items-baseline gap-3 sm:grid-cols-[42px_1fr_auto]">
                <span className="mono text-[12.5px] text-[var(--faint)]">{f.id}</span>
                <p className="text-[14px] text-[var(--graphite)]">
                  <b className="font-semibold text-[var(--ink)]">
                    <Ticks text={f.title} />.
                  </b>{' '}
                  <Ticks text={f.detail} /> {f.line ? <LineRef n={f.line} href={lineHref(f.line)} /> : null}
                  <span className="mt-1 block">
                    <span className="font-semibold text-[var(--ink)]">Fix: </span>
                    <Ticks text={fixOf(f).text} />
                  </span>
                </p>
                <Sev s={f.severity} />
              </li>
            ))}
          </ol>
        </Sec>
      )}

      <Sec title="Appendix" id={`c${ci}-appendix`}>
        <dl className="grid gap-x-7 gap-y-1.5 text-[13.5px] text-[var(--graphite)] sm:grid-cols-2">
          <Appx k="Compiler" v={`Compact ${c.compiler ?? '?'}, language ${c.language ?? '?'}`} />
          <Appx k="Compiler pass" v="reduce-to-circuit" />
          <Appx k="Ledger fields" v={[...new Set(circuits.flatMap((x) => x.touches))].join(', ') || 'none'} />
          <Appx k="Private inputs" v={[...new Set(circuits.flatMap((x) => x.privateInputs.map((p) => p.name)))].join(', ') || 'none'} />
          <Appx k="Circuits" v={String(circuits.length)} />
          <Appx k="Findings" v={SEVERITY_ORDER.filter((s) => c.counts?.[s]).map((s) => `${c.counts![s]} ${s}`).join(', ') || 'none'} />
          {c.report!.unknownForms.length > 0 && <Appx k="Forms not read" v={String(c.report!.unknownForms.length)} />}
          <Appx k="Engine" v="Tell, github.com/RohanGlitched/tell" />
        </dl>
        <p className="mt-4 text-[12.5px] text-[var(--faint)]">
          Static analysis of what the Compact compiler builds. Findings describe what the public transcript can reveal, not proof that anyone has read it.
        </p>
      </Sec>
    </article>
  );
}

function headline(g: Grade): string {
  return {
    A: 'Nothing private reaches public state.',
    B: 'Only low-risk notes in public state.',
    C: 'Something private shows through.',
    D: 'A private value can be recovered from public state.',
    F: 'A secret can be read from public state.',
  }[g];
}

// The summary counts only what the reader can see: info-level disclosures are hidden until the
// box under the findings is ticked, so they are named as hidden, not as notes "below".
function summary(c: ContractResult, major: Numbered[], minor: Numbered[], patch: VerifiedFix | null | undefined, showInfo: boolean): string {
  if (major.length === 0) {
    const shown = minor.filter((f) => showInfo || f.severity !== 'info').length;
    const hidden = minor.length - shown;
    const notes = shown ? `${shown} lower-severity note${shown === 1 ? '' : 's'} below, each with its fix.` : '';
    const info = hidden ? `${hidden} info-level disclosure${hidden === 1 ? '' : 's'} (values published on purpose) ${hidden === 1 ? 'is' : 'are'} hidden; tick the box under the findings to show ${hidden === 1 ? 'it' : 'them'}.` : '';
    return `${GRADE_TEXT[c.grade!]} ${notes} ${info}`.replace(/\s+/g, ' ').trim();
  }
  const worst = major[0];
  const circuits = [...new Set(major.map((f) => f.circuit))];
  const n = major.filter((f) => f.severity === worst.severity).length;
  const lead = `${n} ${worst.severity} finding${n === 1 ? '' : 's'} in circuit${circuits.length === 1 ? '' : 's'} ${circuits.join(', ')}.`;
  if (!patch) return `${lead} Each finding below comes with its fix.`;
  return `${lead} The verified fix below brings the contract to grade ${patch.gradeAfter}${behaviourOf(patch) ? ', and changes behaviour: read the note before applying it' : ''}.`;
}

function Fact({ k, v, first }: { k: string; v: string; first?: boolean }) {
  return (
    <div className={`border-[var(--rule)] px-5 py-3.5 max-sm:[&:nth-child(n+3)]:border-t sm:border-l ${first ? 'sm:border-l-0 sm:pl-11' : ''} max-sm:[&:nth-child(2n)]:border-l`}>
      <dt className="text-[12px] text-[var(--faint)]">{k}</dt>
      <dd className="truncate text-[14.5px] font-semibold" title={v}>
        {v}
      </dd>
    </div>
  );
}

function Sec({ title, id, children, aside }: { title: ReactNode; id?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-[var(--rule)] px-5 py-6 last:border-b-0 sm:px-11 sm:py-7">
      <h3 className="mb-3.5 flex flex-wrap items-baseline gap-3 font-[family-name:var(--serif)] text-[21px] font-medium">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

function Appx({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-[var(--rule)] py-1.5">
      <dt>{k}</dt>
      <dd className="mono min-w-0 truncate text-right text-[12.5px] text-[var(--ink)]" title={v}>
        {v}
      </dd>
    </div>
  );
}

function LineRef({ n, href }: { n: number; href?: string }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="mono text-[12.5px]">
      line {n}
    </a>
  ) : (
    <span className="mono text-[12.5px] text-[var(--faint)]">line {n}</span>
  );
}

// ---- a numbered finding -----------------------------------------------------------------------
function guesses(f: Finding): string {
  if (f.kind === 'secret-published' || f.kind === 'published') return 'none: in the clear';
  if (f.kind === 'guessable-hash' && f.bits > 0) return f.bits <= 40 ? Math.pow(2, f.bits).toLocaleString('en-GB') : `2^${f.bits}`;
  return '–';
}

function FindingSection({ f, ci, lines, href, circuits, onFix, file, others }: { f: Numbered; ci: number; lines?: string[]; href?: string; circuits: CircuitReport[]; onFix?: (fix: VerifiedFix) => void; file: string; others: Numbered[] }) {
  const { text, patch } = fixOf(f);
  const sources = f.sources ?? [];
  const excerpt = f.line && lines ? lines.slice(Math.max(0, f.line - 5), f.line + 1).map((t, i) => ({ n: Math.max(1, f.line! - 4) + i, t })) : null;
  return (
    <section id={anchor(ci, f.id)} className="scroll-mt-24 border-b border-[var(--rule)] px-5 py-6 sm:px-11 sm:py-7" data-testid="finding">
      <div className="-ml-5 border-l-4 pl-4 sm:-ml-[26px] sm:pl-[22px]" style={{ borderColor: `var(--sev-${f.severity}-bg)` }}>
        <p className="flex flex-wrap items-baseline gap-3">
          <span className="mono text-[13px] text-[var(--faint)]">{f.id}</span>
          <Sev s={f.severity} />
          <span className="text-[13px] text-[var(--graphite)]">{KIND_LABEL[f.kind]}</span>
        </p>
        <h3 className="mt-2 max-w-[44ch] font-[family-name:var(--serif)] text-[18px] font-medium leading-[1.4] sm:text-[20px]">
          <Ticks text={f.title} />
        </h3>
        <p className="mt-2.5 max-w-[64ch] text-[15px] text-[var(--graphite)]">
          <Ticks text={f.detail} />
        </p>
      </div>
      <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-md border border-[var(--rule)] sm:grid-cols-4">
        <Kv k="Secret" v={sources.map((s) => (s.kind === 'witness' ? `${s.name}()` : s.name)).join(', ') || '–'} />
        <Kv k="Declared type" v={sources.map((s) => s.type).join(', ') || '–'} />
        <Kv k="Bits it gives away" v={f.bits > 0 ? String(f.bits) : '–'} hot={f.bits > 0} />
        <Kv k="Guesses to recover" v={guesses(f)} hot={f.kind === 'guessable-hash'} />
      </dl>

      <SubHead title="Source" note={f.line ? `circuit ${f.circuit}, line ${f.line}` : `circuit ${f.circuit}`} />
      {excerpt ? (
        <div className="well">
          {excerpt.map((l) => (
            <div key={l.n} className={`whitespace-pre pr-4 ${l.n === f.line ? 'bg-[var(--marker-soft)]' : ''}`}>
              <span className="inline-block w-[46px] select-none pr-4 text-right text-[var(--faint)] max-sm:w-8 max-sm:pr-2.5">{l.n}</span>
              {l.t || ' '}
            </div>
          ))}
          {f.via && <span className="block whitespace-normal py-0.5 pl-[62px] pr-4 font-[family-name:var(--sans)] text-[12.5px] text-[var(--marker-ink)] max-sm:pl-10">through {f.via}</span>}
        </div>
      ) : (
        <p className="text-[14px] text-[var(--graphite)]">{href ? <a href={href} target="_blank" rel="noreferrer">Open line {f.line} on GitHub</a> : 'No line recorded for this finding.'}</p>
      )}

      <Transcript circuits={circuits} only={f.circuit} />

      <SubHead title={patch ? (patch.verified ? 'Verified fix' : 'Proposed fix') : 'Fix'} note={patch ? file : undefined} />
      <FixView text={text} patch={patch} onFix={onFix} file={file} others={others} />
      {f.fields && f.fields.length > 1 && <p className="mono mt-3 text-[12.5px] text-[var(--graphite)]">touches {f.fields.join(', ')}</p>}
      {href && f.line && (
        <p className="mt-3 text-[13px]">
          <a href={href} target="_blank" rel="noreferrer">
            Line {f.line} on GitHub
          </a>
        </p>
      )}
    </section>
  );
}

function Kv({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return (
    <div className="border-[var(--rule)] px-3.5 py-2.5 [&:nth-child(n+2)]:border-l max-sm:[&:nth-child(3)]:border-l-0 max-sm:[&:nth-child(n+3)]:border-t">
      <dt className="text-[11.5px] text-[var(--faint)]">{k}</dt>
      <dd className={`mono truncate text-[14px] font-medium ${hot ? 'text-[var(--marker)]' : ''}`} title={v}>
        {v}
      </dd>
    </div>
  );
}

function SubHead({ title, note }: { title: string; note?: string }) {
  return (
    <p className="mb-2 mt-6 flex flex-wrap justify-between gap-3 text-[13px] font-semibold text-[var(--graphite)]">
      {title}
      {note && <span className="font-normal text-[var(--faint)]">{note}</span>}
    </p>
  );
}

// The fix in words; with a patch from the engine, the diff, whether a re-scan verified it, and
// a button that applies it to the pasted contract and scans again.
// The grade a finding's severity sets on its own (GRADE_TEXT): critical F, high D, medium C, low B.
const SEV_GRADE: Record<string, Grade> = { critical: 'F', high: 'D', medium: 'C', low: 'B', info: 'A' };

// Why a verified patch leaves the grade where it is: the other findings that set it.
function gradeReason(after: Grade | undefined, others: Numbered[]): string | null {
  if (!after || GRADES.indexOf(after) < GRADES.indexOf('C')) return null;
  const setting = others.filter((o) => SEV_GRADE[o.severity] === after);
  if (setting.length === 0) return null;
  const sev = setting[0].severity;
  const what = setting.map((o) => `${o.id} ${KIND_LABEL[o.kind].toLowerCase()} in ${o.circuit}`).join('; ');
  return setting.length === 1 ? `another ${sev} finding remains: ${what}.` : `${setting.length} other ${sev} findings remain: ${what}.`;
}

function FixView({ text, patch, onFix, file, others = [] }: { text: string; patch: VerifiedFix | null; onFix?: (fix: VerifiedFix) => void; file: string; others?: Numbered[] }) {
  const behaviour = patch ? behaviourOf(patch) : null;
  const reason = patch?.verified ? gradeReason(patch.gradeAfter, others) : null;
  return (
    <div data-testid="fix-view">
      <p className="text-[14.5px]">
        <span className="font-semibold">Fix: </span>
        <Ticks text={text} />
      </p>
      {patch && (
        <>
          {patch.text && <p className="mt-2 text-[13.5px] text-[var(--graphite)]">Rewrite: {patch.text}</p>}
          <DiffView diff={patch.diff} file={file} />
          {patch.verified ? (
            <div className="mt-3.5 flex flex-wrap gap-2.5">
              <span className="stamp">Compiles</span>
              <span className="stamp">Finding gone</span>
              {patch.gradeAfter && <span className="stamp solid">Grade after: {patch.gradeAfter}</span>}
              {behaviour && (
                <span className="stamp warn" data-testid="behaviour-change">
                  Changes behaviour
                </span>
              )}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-[var(--graphite)]">Not verified by a re-scan yet: review it before use.</p>
          )}
          {behaviour && (
            <p className="mt-2.5 max-w-[64ch] text-[13.5px] text-[var(--marker-ink)]">
              <span className="font-semibold">Changes behaviour: </span>
              <Ticks text={behaviour} /> Apply it only if those calls should fail.
            </p>
          )}
          {reason && (
            <p className="mt-2.5 max-w-[64ch] text-[13.5px] text-[var(--graphite)]" data-testid="grade-reason">
              <span className="font-semibold text-[var(--ink)]">Why the grade after is still {patch.gradeAfter}: </span>
              {reason}
            </p>
          )}
          <div className="no-print mt-4 flex flex-wrap gap-2">
            {onFix && (
              <button type="button" data-testid="rescan-with-fix" onClick={() => onFix(patch)} className="btn btn-ink btn-sm">
                Re-scan with fix
              </button>
            )}
            <CopyButton text={() => patch.diff} label="Copy patch" />
          </div>
        </>
      )}
    </div>
  );
}

function DiffView({ diff, file }: { diff: string; file: string }) {
  const rows = diff.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').filter((l) => !/^(---|\+\+\+|diff |index )/.test(l));
  return (
    <div className="diff mt-3" role="figure" aria-label="Proposed patch, unified diff">
      <div className="fh">{file}</div>
      {rows.map((l, i) => {
        const hunk = l.startsWith('@@');
        const add = l.startsWith('+');
        const del = l.startsWith('-');
        return (
          <div key={i} className={`l ${hunk ? 'ctx' : add ? 'add' : del ? 'del' : 'ctx'}`}>
            <span className="sr-only">{add ? 'added: ' : del ? 'removed: ' : ''}</span>
            {hunk ? '…' : l || ' '}
          </div>
        );
      })}
    </div>
  );
}

// ---- leak map ---------------------------------------------------------------------------------
// Rows: circuits. Columns: ledger fields. A cell is the worst thing a circuit tells a field.
function LeakMap({ c }: { c: ContractResult }) {
  const { circuits, fields, cell } = useMemo(() => {
    const circuits = c.report!.circuits.filter((x) => x.touches.length > 0);
    const fields = [...new Set(circuits.flatMap((x) => x.touches))];
    const cell = new Map<string, Finding>();
    for (const f of c.report!.findings) {
      if (f.suppressed) continue;
      for (const fl of f.fields ?? [`${f.field}.${f.op}`]) {
        const k = `${f.circuit}|${fl.split('.')[0]}`;
        const prev = cell.get(k);
        if (!prev || SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(prev.severity)) cell.set(k, f);
      }
    }
    return { circuits, fields, cell };
  }, [c]);
  if (circuits.length === 0) return null;
  return (
    <Sec title="Leak map" aside={<span className="font-[family-name:var(--sans)] text-[13px] text-[var(--faint)]">what each circuit tells each public field</span>}>
      <div className="overflow-x-auto rounded-md border border-[var(--rule)]">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[var(--mist)]">
              <th className="sticky left-0 z-10 whitespace-nowrap bg-[var(--mist)] px-3 py-2 text-left font-medium text-[var(--graphite)]">circuit ↓ field →</th>
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
                <th scope="row" className="mono sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 text-left font-medium">
                  {ci.name}
                </th>
                {fields.map((fl) => {
                  const f = cell.get(`${ci.name}|${fl}`);
                  if (!ci.touches.includes(fl)) return <td key={fl} />;
                  return (
                    <td key={fl} className="px-1 py-1">
                      <span
                        className="block min-w-[54px] rounded-[3px] px-1 py-1 text-center text-[11px] font-semibold"
                        style={f ? { background: `var(--sev-${f.severity}-bg)`, color: `var(--sev-${f.severity}-fg)` } : { background: 'var(--white)', color: 'var(--ink-3)', boxShadow: 'inset 0 0 0 1px var(--rule)' }}
                        title={f ? `${f.severity}: ${plain(f.title)}` : 'public data only'}
                      >
                        {f ? (f.bits > 0 ? `${f.bits} bits` : f.severity) : 'public'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sec>
  );
}

// ---- actions rail -----------------------------------------------------------------------------
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label, testId, full }: { text: () => string; label: string; testId?: string; full?: boolean }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const [manual, setManual] = useState('');
  return (
    <span className={`inline-flex flex-col ${full ? 'w-full' : ''}`}>
      <button
        type="button"
        data-testid={testId}
        onClick={async () => {
          const t = text();
          const ok = await copy(t);
          setState(ok ? 'done' : 'failed');
          setManual(ok ? '' : t);
          if (ok) setTimeout(() => setState('idle'), 2000);
        }}
        className={`btn btn-quiet btn-sm ${full ? 'w-full' : ''}`}
      >
        <span aria-live="polite">{state === 'done' ? 'Copied' : label}</span>
      </button>
      {state === 'failed' && (
        <input readOnly value={manual} aria-label="Copy this text" onFocus={(e) => e.currentTarget.select()} className="mono mt-1 w-full rounded border border-[var(--rule)] bg-white px-2 py-1 text-[12px]" />
      )}
    </span>
  );
}

const FORMATS = [
  ['SARIF for code scanning', 'sarif', 'application/sarif+json', toSarif],
  ['JSON', 'json', 'application/json', toJson],
  ['Markdown', 'md', 'text/markdown', (r: ScanResponse) => toMarkdown(r)],
] as const;

export function Card({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <div className="rounded-md bg-white p-4 shadow-[0_1px_0_var(--rule)]" data-testid={testId}>
      <h4 className="mb-2.5 text-[13px] font-semibold">{title}</h4>
      {children}
    </div>
  );
}

function Rail({
  result,
  source,
  lists,
  compare,
  onFix,
  onRestore,
  onRescan,
  busy,
}: {
  result: ScanResponse;
  source: string;
  lists: Numbered[][];
  compare: Compare | null;
  onFix?: (fix: VerifiedFix, before: Grade) => void;
  onRestore: () => void;
  onRescan?: () => void;
  busy: boolean;
}) {
  const grade = worstGrade(result);
  // every verified patch for the first contract that has any, applied together and verified as a
  // whole by the engine; else the first single verified patch
  const combinedAt = result.contracts.find((c) => c.fixes?.diff && c.grade);
  const singleAt = result.contracts.map((c, i) => ({ c, f: lists[i].find((f) => fixOf(f).patch) })).find((x) => x.f && x.c.grade);
  const patchAt = combinedAt
    ? { c: combinedAt, patch: { diff: combinedAt.fixes!.diff, verified: true, gradeAfter: combinedAt.fixes!.gradeAfter ?? undefined } as VerifiedFix, count: combinedAt.fixes!.applied }
    : singleAt?.f
      ? { c: singleAt.c, patch: fixOf(singleAt.f).patch!, count: 1 }
      : null;
  const patch = patchAt?.patch ?? null;
  // The link is computed while rendering (the rail only renders in the browser, after a scan), so
  // it always matches what was scanned: after "Apply fix", the fixed source; the original keeps
  // its own link below.
  const origin = typeof window === 'undefined' ? SITE : window.location.origin;
  const linkFor = (src: string) => `${origin}/scan${shareHash({ kind: 'source', source: src })}`;
  const share = useMemo(
    () => (result.kind === 'repo' ? (result.repo ? `${origin}/scan${shareHash({ kind: 'repo', repo: result.repo })}` : '') : source ? linkFor(source) : ''),
    [result, source, origin],
  );
  const original = useMemo(() => (compare?.original && compare.original !== source ? linkFor(compare.original) : ''), [compare, source, origin]);
  const canShare = !!share;
  // with every patch applied, the grade can stay put because a finding has no verified patch
  const unpatched = patchAt ? lists[result.contracts.indexOf(patchAt.c)].filter((f) => MAJOR.has(f.severity) && !fixOf(f).patch) : [];
  const stuck = patch?.gradeAfter && patchAt && GRADES.indexOf(patch.gradeAfter) >= GRADES.indexOf('C') ? unpatched : [];
  // a branch rewritten as an assert rejects the other path: say so before anyone applies it
  const branchFix = patchAt ? lists[result.contracts.indexOf(patchAt.c)].map((f) => fixOf(f).patch).find((p) => p && behaviourOf(p)) : null;
  const changesBehaviour = branchFix ? behaviourOf(branchFix) : null;

  return (
    <aside className="report-rail grid content-start gap-3.5 self-start sm:grid-cols-2 lg:sticky lg:top-24 lg:grid-cols-1" aria-label="Report actions">
      {compare ? (
        <Card title="With the fix applied" testId="fix-compare">
          <Arrow from={compare.before} to={compare.after} />
          <p className="sr-only">
            Grade {compare.before} before the fix, {compare.after ?? 'unknown'} after
          </p>
          <p className="mt-2 text-[12.5px] text-[var(--faint)]">
            {compare.after && GRADES.indexOf(compare.after) < GRADES.indexOf(compare.before)
              ? 'The patch was applied and the contract scanned again with the same compiler. The editor holds the patched source.'
              : 'The patch was applied and scanned again, but the grade did not improve.'}
          </p>
          <div className="mt-3 grid gap-2">
            <button type="button" onClick={onRestore} className="btn btn-quiet btn-sm w-full">
              Undo the fix
            </button>
          </div>
        </Card>
      ) : patch && patchAt ? (
        <Card title={patch.verified ? 'With the fix applied' : 'A fix is proposed'}>
          {patch.gradeAfter && <Arrow from={patchAt.c.grade!} to={patch.gradeAfter} />}
          <p className="mt-2 text-[12.5px] text-[var(--faint)]">
            {patch.verified
              ? `${patchAt.count === 1 ? 'One verified patch' : `${patchAt.count} verified patches`}: compiled with the same compiler and scanned again${result.contracts.length > 1 ? ` (${patchAt.c.file})` : ''}.`
              : 'Not verified yet: review the diff first.'}
          </p>
          {changesBehaviour && (
            <p className="mt-2 text-[12.5px] text-[var(--marker-ink)]" data-testid="rail-behaviour">
              <span className="stamp warn mr-1.5">Changes behaviour</span>
              <Ticks text={changesBehaviour} />
            </p>
          )}
          {stuck.length > 0 && (
            <p className="mt-2 text-[12.5px] text-[var(--graphite)]" data-testid="rail-stuck">
              Grade after stays {patch.gradeAfter}: {stuck.length === 1 ? 'one finding has' : `${stuck.length} findings have`} no verified patch ({stuck.map((f) => `${f.id}, ${f.severity}`).join('; ')}). Its fix is in words, in the report.
            </p>
          )}
          <div className="mt-3 grid gap-2">
            {onFix && (
              <button type="button" data-testid="apply-fix" disabled={busy} onClick={() => onFix(patch, patchAt.c.grade!)} className="btn btn-pri btn-sm w-full">
                {patchAt.count > 1 ? 'Apply all fixes' : 'Apply fix'}
              </button>
            )}
            {onRescan && (
              <button type="button" disabled={busy} onClick={onRescan} className="btn btn-quiet btn-sm w-full">
                Re-scan
              </button>
            )}
          </div>
        </Card>
      ) : (
        <Card title="Fixes">
          {grade && <Arrow from={grade} to={null} />}
          <p className="mt-2 text-[12.5px] text-[var(--faint)]">
            Every finding lists its fix in words. Tell offers a patch only when it can verify one: the patched contract compiles, loses the finding and gains nothing at medium or worse. None passed for this scan.
          </p>
          {onRescan && (
            <button type="button" disabled={busy} onClick={onRescan} className="btn btn-quiet btn-sm mt-3 w-full">
              Re-scan
            </button>
          )}
        </Card>
      )}

      {canShare && (
        <Card title="Share" testId="share-card">
          {compare && result.kind === 'source' && <p className="mb-1.5 text-[12.5px] font-semibold text-[var(--ink)]">The fixed contract, as it is in the editor</p>}
          <div className="mono truncate rounded-md bg-[var(--mist)] px-2.5 py-2 text-[12px] text-[var(--graphite)]" title={share} data-testid="share-link">
            {share.replace(/^https?:\/\//, '')}
          </div>
          <div className="mt-2">
            <CopyButton text={() => share} label={compare ? 'Copy link to the fixed contract' : 'Copy share link'} testId="copy-share" full />
          </div>
          {original && (
            <div className="mt-2">
              <CopyButton text={() => original} label="Copy link to the original" testId="copy-share-original" full />
            </div>
          )}
          <p className="mt-2 text-[12.5px] text-[var(--faint)]">
            {result.kind === 'source' ? 'The contract travels inside the link, after the #. Nothing is stored on a server.' : 'Opens this repository and scans it again.'}
          </p>
        </Card>
      )}

      <Card title="Download">
        <div className="grid gap-2">
          <button type="button" data-testid="download-pdf" onClick={() => window.print()} className="btn btn-quiet btn-sm w-full">
            PDF for an audit appendix
          </button>
          {FORMATS.map(([label, ext, type, make]) => (
            <button key={ext} type="button" data-testid={`download-${ext}`} onClick={() => downloadText(`${reportName(result)}.${ext}`, make(result), type)} className="btn btn-quiet btn-sm w-full">
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-[var(--faint)]">PDF: your browser’s print dialog, “Save as PDF”.</p>
      </Card>

      <BadgeCard result={result} grade={grade} />
    </aside>
  );
}

function Arrow({ from, to }: { from: Grade; to: Grade | null }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px] text-[var(--graphite)]">
      <GradeSeal grade={from} size={32} caption={null} />
      <i className="h-px flex-1 bg-[var(--rule)]" />
      {to ? <GradeSeal grade={to} size={32} caption={null} /> : <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-dashed border-[var(--rule-strong)] text-[var(--faint)]">?</span>}
    </div>
  );
}

function BadgeCard({ result, grade }: { result: ScanResponse; grade: Grade | null }) {
  if (result.kind !== 'repo' || !result.repo)
    return (
      <Card title="README badge">
        <p className="text-[12.5px] text-[var(--faint)]">Scan your public GitHub repository (the repository tab) to get a badge that shows its grade and stays current.</p>
      </Card>
    );
  const md = badgeMarkdown(SITE, result.repo);
  return (
    <Card title="README badge" testId="badge-panel">
      {grade && (
        // the SVG the badge route serves, drawn from this scan so no second scan runs
        <img alt={`Tell privacy grade ${grade}`} src={`data:image/svg+xml;utf8,${encodeURIComponent(badgeSvg(grade))}`} height={20} className="h-5 w-auto" />
      )}
      <pre className="mono mt-2.5 overflow-x-auto whitespace-pre rounded-md bg-[var(--mist)] p-2.5 text-[11.5px] leading-[1.6] text-[var(--graphite)]">{md}</pre>
      <div className="mt-2">
        <CopyButton text={() => md} label="Copy badge" testId="copy-badge" full />
      </div>
      <p className="mt-2 text-[12.5px] text-[var(--faint)]">Scans the default branch; refreshes about once a day.</p>
    </Card>
  );
}
