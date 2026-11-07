// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Pull request review: which changed lines get a comment, what each comment says, and what to
// do about comments an earlier run already posted. No network here; action.ts does the calls.

import path from 'node:path';
import type { Finding, Severity } from './analyze.js';
import type { ContractResult } from './index.js';
import { findingKey, type FilePlan, type Suggestion } from './fix.js';

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const rank = (s: Severity) => SEVERITIES.indexOf(s);

// A scan result as the CLI writes it with --json-out (fixes present when they were requested).
export type ResultWithFixes = ContractResult & { fixes?: FilePlan };

// ---------------------------------------------------------------------------------------------
// Diff hunks: GitHub only accepts review comments on lines inside the pull request's diff.

// Right-side (new file) line number -> index of the hunk it is in.
export function commentableLines(patch: string | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (!patch) return out;
  let line = 0;
  let hunk = -1;
  for (const l of patch.split('\n')) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      line = Number(h[1]);
      hunk++;
      continue;
    }
    if (hunk < 0 || l.startsWith('\\')) continue;
    if (l.startsWith('-')) continue;
    if (l.startsWith('+') || l.startsWith(' ') || l === '') {
      out.set(line, hunk);
      line++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Comment bodies.

export const MARKER = 'tell:v1';
export const markerOf = (key: string, state: 'open' | 'resolved' = 'open') => `<!-- ${MARKER} key=${key}${state === 'resolved' ? ' state=resolved' : ''} -->`;
export function parseMarker(body: string): { key: string; resolved: boolean } | null {
  const m = body.match(/<!-- tell:v1 key=([0-9a-f]+)( state=resolved)? -->/);
  return m ? { key: m[1], resolved: !!m[2] } : null;
}

const KIND: Record<string, string> = {
  'guessable-hash': 'guessable hash',
  'secret-published': 'secret in the clear',
  published: 'published in the clear',
  branch: 'secret-dependent branch',
  attributable: 'same tag on every action',
  linkable: 'linkable tag',
  predicate: 'published yes/no fact',
};
export const kindLabel = (k: string) => KIND[k] ?? k.replace(/-/g, ' ');

export function revealed(f: Finding): string {
  const who = f.sources.map((s) => `\`${s.name}\``).join(', ') || 'a private input';
  const type = f.sources.length === 1 ? ` (${f.sources[0].type})` : '';
  if (f.kind === 'attributable' || f.kind === 'linkable') return `no bits of ${who} itself, but every action by the same holder carries the same value`;
  if (f.kind === 'branch' || f.kind === 'predicate') return `${f.bits} bit${f.bits === 1 ? '' : 's'} about ${who} per call`;
  const total = f.sources.reduce((n, s) => n + s.bits, 0);
  if (f.kind !== 'guessable-hash' && total > 0 && f.bits >= total) return `all ${total} bits of ${who}${type}`;
  const tries = f.kind === 'guessable-hash' && f.bits <= 40 ? `; at most ${f.bits <= 20 ? (2 ** f.bits).toLocaleString('en-US') : `2^${f.bits}`} guesses recover it` : '';
  return `${f.bits} bit${f.bits === 1 ? '' : 's'} of ${who}${type}${tries}`;
}

const fence = (lines: string[]) => (lines.some((l) => l.includes('```')) ? '````' : '```');

export type Placement = { line: number; startLine?: number; suggestion: boolean };

// Where a comment goes, and whether the fix can be a one-click suggestion: the patch must replace
// a small block of lines that contains the finding and sits inside one hunk of the diff.
export function placeComment(f: Finding, s: Suggestion | undefined, lines: Map<number, number>, maxLines = 15): Placement | null {
  if (!f.line || !lines.has(f.line)) return null;
  const r = s?.patch?.range;
  if (r && r.start <= f.line && f.line <= r.end && r.end - r.start + 1 <= maxLines) {
    const hunk = lines.get(f.line);
    let inOne = true;
    for (let l = r.start; l <= r.end; l++) if (lines.get(l) !== hunk) inOne = false;
    if (inOne) return r.start === r.end ? { line: r.end, suggestion: true } : { line: r.end, startLine: r.start, suggestion: true };
  }
  return { line: f.line, suggestion: false };
}

export function renderComment(f: Finding, key: string, s: Suggestion | undefined, placement: Placement, opts: { suggest: boolean } = { suggest: true }): string {
  const out = [markerOf(key)];
  out.push(`**Tell · ${f.severity} · ${kindLabel(f.kind)}** in \`${f.circuit}\` (\`${f.field}\` ${f.op})`);
  out.push('');
  out.push(`${f.title}. **Revealed:** ${revealed(f)}.`);
  out.push('');
  out.push(f.detail);
  if (opts.suggest && s?.patch && s.verification) {
    const v = s.verification;
    out.push('');
    out.push(`**Verified fix:** ${s.summary}. Compiles with Compact ${v.compiler}, finding gone, grade ${v.gradeBefore} → ${v.gradeAfter}.`);
    if (placement.suggestion) {
      const lines = s.patch.range.lines;
      const fnc = fence(lines);
      out.push('');
      out.push(`${fnc}suggestion`);
      out.push(...lines);
      out.push(fnc);
    } else {
      const diff = s.patch.diff.trimEnd().split('\n');
      const shown = diff.length > 80 ? [...diff.slice(0, 80), `… ${diff.length - 80} more lines; run \`tell --fix-dry-run\` for the whole patch`] : diff;
      const fnc = fence(shown);
      out.push('');
      out.push('<details><summary>Patch (touches lines outside this comment)</summary>');
      out.push('');
      out.push(`${fnc}diff`);
      out.push(...shown);
      out.push(fnc);
      out.push('');
      out.push('</details>');
    }
    if (s.notes.length) out.push('');
    for (const n of s.notes) out.push(`- ${n}`);
  } else if (s?.manual) {
    out.push('');
    out.push(`**Fix (manual):** ${s.manual}`);
  } else {
    out.push('');
    out.push(`**Fix:** ${f.fix}`);
  }
  out.push('');
  out.push(`<sub>Silence this one with \`// tell:allow ${f.kind}\` on the line if it is meant to be public.</sub>`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------
// What to post.

export type DesiredComment = { key: string; path: string; line: number; startLine?: number; body: string; finding: Finding };
export type PrFile = { filename: string; patch?: string; status?: string };

export function desiredComments(results: ResultWithFixes[], files: PrFile[], opts: { root: string; minSeverity?: Severity; suggest?: boolean }): { comments: DesiredComment[]; outside: { path: string; finding: Finding }[] } {
  const byPath = new Map(files.map((f) => [f.filename, f]));
  const comments: DesiredComment[] = [];
  const outside: { path: string; finding: Finding }[] = [];
  const min = rank(opts.minSeverity ?? 'medium');
  for (const r of results) {
    if (!r.ok || !r.report) continue;
    const rel = path.relative(opts.root, r.file).split(path.sep).join('/');
    const pr = byPath.get(rel);
    const lines = commentableLines(pr?.patch);
    const seen = new Set<string>();
    for (const f of r.report.findings) {
      if (f.suppressed || rank(f.severity) > min) continue;
      const s = r.fixes?.suggestions.find((x) => sameFinding(x.finding, f));
      const key = s?.key ?? keyFor(rel, f);
      if (seen.has(key)) continue;
      seen.add(key);
      const place = pr ? placeComment(f, opts.suggest === false ? undefined : s, lines) : null;
      if (!place) {
        outside.push({ path: rel, finding: f });
        continue;
      }
      comments.push({ key, path: rel, line: place.line, startLine: place.startLine, body: renderComment(f, key, s, place, { suggest: opts.suggest !== false }), finding: f });
    }
  }
  return { comments, outside };
}

const sameFinding = (a: Finding, b: Finding) => a.circuit === b.circuit && a.kind === b.kind && a.field === b.field && a.line === b.line;

// Same key as fix.ts, so a run without fixes still dedupes against one with them.
export const keyFor = (file: string, f: Finding) => findingKey(f, file);

// ---------------------------------------------------------------------------------------------
// Re-runs: update or skip what an earlier run posted, and mark what is no longer reported.

export type ExistingComment = { id: number; path: string; line: number | null; body: string };
export type ReviewAction =
  | { type: 'create'; comment: DesiredComment }
  | { type: 'update'; id: number; body: string; reason: 'changed' | 'resolved' | 'superseded' }
  | { type: 'skip'; id: number; key: string };

const norm = (b: string) => b.replace(/\r\n/g, '\n').trim();

export function planReview(desired: DesiredComment[], existing: ExistingComment[], opts: { scannedPaths: string[]; headSha: string }): ReviewAction[] {
  const actions: ReviewAction[] = [];
  const tell = existing.map((c) => ({ c, m: parseMarker(c.body) })).filter((x): x is { c: ExistingComment; m: { key: string; resolved: boolean } } => !!x.m);
  // latest comment per key wins; older ones are left alone
  const latest = new Map<string, ExistingComment>();
  for (const { c, m } of tell.sort((a, b) => a.c.id - b.c.id)) latest.set(m.key, c);
  const wanted = new Set(desired.map((d) => d.key));
  for (const d of desired) {
    const old = latest.get(d.key);
    if (!old) actions.push({ type: 'create', comment: d });
    else if (old.line === null || old.path !== d.path) {
      // outdated: the line is no longer in the diff, so post afresh where the finding is now
      actions.push({ type: 'create', comment: d });
      if (!parseMarker(old.body)!.resolved) actions.push({ type: 'update', id: old.id, body: resolvedBody(old.body, d.key, `moved; see the newer comment at line ${d.line}`), reason: 'superseded' });
    } else if (norm(old.body) === norm(d.body)) actions.push({ type: 'skip', id: old.id, key: d.key });
    else actions.push({ type: 'update', id: old.id, body: d.body, reason: 'changed' });
  }
  const scanned = new Set(opts.scannedPaths);
  for (const [key, c] of latest) {
    if (wanted.has(key) || !scanned.has(c.path)) continue;
    if (parseMarker(c.body)!.resolved) continue;
    actions.push({ type: 'update', id: c.id, body: resolvedBody(c.body, key, `no longer reported as of \`${opts.headSha.slice(0, 7)}\``), reason: 'resolved' });
  }
  return actions;
}

function resolvedBody(old: string, key: string, why: string): string {
  const inner = old.replace(/<!-- tell:v1[^>]*-->\n?/, '').trim();
  return [markerOf(key, 'resolved'), `**Tell:** ${why}.`, '', '<details><summary>Earlier comment</summary>', '', inner, '', '</details>'].join('\n');
}

// ---------------------------------------------------------------------------------------------
// The job summary.

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderSummary(results: ResultWithFixes[], opts: { root: string; minSeverity?: Severity; outside?: { path: string; finding: Finding }[] }): string {
  const min = rank(opts.minSeverity ?? 'medium');
  const rel = (f: string) => path.relative(opts.root, f).split(path.sep).join('/');
  const out: string[] = ['## Tell privacy scan', ''];
  if (results.length === 0) return out.concat('No Compact contracts found.', '').join('\n');
  const anyFixes = results.some((r) => r.fixes);
  out.push(anyFixes ? '| Contract | Grade | After verified fixes | Findings | Compiler |' : '| Contract | Grade | Findings | Compiler |');
  out.push(anyFixes ? '|---|---|---|---|---|' : '|---|---|---|---|');
  for (const r of results) {
    if (!r.ok) {
      out.push(`| \`${rel(r.file)}\` | could not compile | ${anyFixes ? '| ' : ''}${cell((r.error ?? '').split('\n')[0].slice(0, 120))} | ${r.compiler ?? '-'} |`);
      continue;
    }
    const counts = SEVERITIES.filter((s) => r.counts?.[s]).map((s) => `${r.counts![s]} ${s}`).join(', ') || 'none';
    const c = r.fixes?.combined;
    const after = c ? `**${c.verification.gradeAfter}** (${c.applied.length} fix${c.applied.length === 1 ? '' : 'es'})` : r.fixes ? (r.fixes.suggestions.length ? 'manual fixes only' : 'nothing to fix') : '';
    out.push(anyFixes ? `| \`${rel(r.file)}\` | **${r.grade}** | ${after} | ${counts} | ${r.compiler} |` : `| \`${rel(r.file)}\` | **${r.grade}** | ${counts} | ${r.compiler} |`);
  }
  const rows = results.flatMap((r) => (r.report?.findings ?? []).filter((f) => !f.suppressed && rank(f.severity) <= min).map((f) => ({ r, f })));
  out.push('');
  if (rows.length === 0) out.push(`Nothing at ${SEVERITIES[min]} or worse.`);
  else {
    out.push(`### Findings at ${SEVERITIES[min]} or worse`, '', '| Severity | Where | Finding | Revealed | Fix |', '|---|---|---|---|---|');
    for (const { r, f } of rows.sort((a, b) => rank(a.f.severity) - rank(b.f.severity))) {
      const s = r.fixes?.suggestions.find((x) => sameFinding(x.finding, f));
      const fix = s?.patch && s.verification ? `verified: ${s.summary} (grade ${s.verification.gradeBefore} → ${s.verification.gradeAfter})` : s?.manual ? `manual: ${s.manual}` : f.fix;
      out.push(`| ${f.severity} | \`${rel(r.file)}:${f.line ?? '?'}\` \`${f.circuit}\` | ${cell(f.title)} (${kindLabel(f.kind)}) | ${cell(revealed(f))} | ${cell(fix)} |`);
    }
  }
  const quiet = results.flatMap((r) => (r.report?.findings ?? []).filter((f) => !f.suppressed && rank(f.severity) > min && f.severity !== 'info')).length;
  if (quiet) out.push('', `${quiet} lower-severity finding${quiet === 1 ? '' : 's'} not listed; run \`tell\` locally to see ${quiet === 1 ? 'it' : 'them'}.`);
  if (opts.outside?.length) out.push('', `${opts.outside.length} finding${opts.outside.length === 1 ? ' is' : 's are'} on lines this pull request does not change, so ${opts.outside.length === 1 ? 'it is' : 'they are'} listed here and in code scanning, not inline.`);
  const patches = results.filter((r) => r.fixes?.combined);
  if (patches.length) {
    out.push('', '<details><summary>Verified fixes as one patch (<code>tell --fix</code> applies it)</summary>', '', '```diff');
    for (const r of patches) out.push(r.fixes!.combined!.diff.trimEnd());
    out.push('```', '', '</details>');
  }
  out.push('');
  return out.join('\n');
}
