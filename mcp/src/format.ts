// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Plain-text views of Tell's results, shared by the MCP server and the VS Code
// extension: a finding's one-line message and a circuit's public transcript.

import type { ContractResult, Finding, OperandNote, TranscriptOp, CircuitReport, Severity } from '@tell/engine';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const atLeast = (s: Severity, min: Severity) => SEVERITY_ORDER.indexOf(s) <= SEVERITY_ORDER.indexOf(min);

const who = (n: { source: string; kind: string }) => (n.kind === 'argument' ? n.source : n.source.replace(/^([^.[]+)/, '$1()'));

function note(n: OperandNote): string {
  if (n.flow === 'guessable') return `${n.via ?? 'hash'}(${who(n)}): guessable, ${n.bits} bits`;
  if (n.flow === 'reveal') return `${who(n)} in the clear, ${n.bits} bits`;
  if (n.flow === 'predicate') return `yes/no about ${who(n)}`;
  if (n.tag) return `${n.via ?? 'hash'}(${who(n)}): same tag each call`;
  return `${n.via ?? 'sealed'}(${who(n)}): sealed`;
}

// `only if f(amount): qualified.insert(hash(bidderKey()): same tag each call)`
export function transcriptLine(op: TranscriptOp): string {
  const args = op.operands.map((ns) => (ns.length === 0 ? 'public' : ns.map(note).join(' + '))).join(', ');
  const guard = op.guardedBy.length ? `only if f(${op.guardedBy.join(', ')}): ` : '';
  return `${guard}${op.field}.${op.op}(${args})`;
}

// One line per ledger operation; identical consecutive lines (unrolled loops) collapse to `× n`.
export function transcript(c: Pick<CircuitReport, 'ops'>): string[] {
  const out: { line: string; n: number }[] = [];
  for (const op of c.ops ?? []) {
    const line = transcriptLine(op);
    const last = out[out.length - 1];
    if (last && last.line === line) last.n++;
    else out.push({ line, n: 1 });
  }
  return out.map(({ line, n }) => (n > 1 ? `${line} × ${n}` : line));
}

// The transcript lines for the ledger field a finding is about.
export function transcriptFor(f: Finding, circuits: CircuitReport[]): string[] {
  const c = circuits.find((x) => x.name === f.circuit);
  if (!c) return [];
  const fields = new Set([f.field, ...(f.fields ?? [])]);
  return transcript({ ops: (c.ops ?? []).filter((o) => fields.has(o.field)) });
}

export const bitsText = (f: Finding) => (f.bits > 0 ? `${f.bits} bit${f.bits === 1 ? '' : 's'}` : 'linkable');

// "choice() is hidden behind a persistentHash anyone can reverse (2 bits)"
export const findingMessage = (f: Finding) => `${f.title} (${bitsText(f)})`;

export function gradeLine(r: ContractResult): string {
  if (!r.ok) return `could not compile: ${r.error?.split('\n')[0] ?? 'unknown error'}`;
  const counts = SEVERITY_ORDER.filter((s) => r.counts?.[s]).map((s) => `${r.counts![s]} ${s}`);
  return `grade ${r.grade}, compact ${r.compiler}, ${r.report!.circuits.length} circuit${r.report!.circuits.length === 1 ? '' : 's'}${counts.length ? `: ${counts.join(', ')}` : ''}`;
}

// A readable report for an agent or a person: grade, findings with fixes, transcripts.
export function reportText(r: ContractResult, opts: { name?: string; includeInfo?: boolean } = {}): string {
  const name = opts.name ?? r.file;
  if (!r.ok) return `${name}: could not compile with ${r.compiler ?? 'any installed compiler'}\n${r.error ?? ''}`;
  const rep = r.report!;
  const live = rep.findings.filter((f) => !f.suppressed && (opts.includeInfo || f.severity !== 'info'));
  const lines = [`${name}: ${gradeLine(r)}`];
  if (live.length === 0) lines.push('', 'No findings above info.');
  for (const f of [...live].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))) {
    lines.push('', `[${f.severity}] ${f.kind} in ${f.circuit}${f.line ? `, line ${f.line}` : ''}: ${findingMessage(f)}`, `  ${f.detail}`, `  fix: ${f.fix}`);
    for (const t of transcriptFor(f, rep.circuits)) lines.push(`  public: ${t}`);
  }
  const suppressed = rep.findings.filter((f) => f.suppressed).length;
  if (suppressed) lines.push('', `${suppressed} finding${suppressed === 1 ? '' : 's'} marked tell:allow in the source.`);
  return lines.join('\n');
}
