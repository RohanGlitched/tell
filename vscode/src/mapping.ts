// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell results to editor diagnostics, without depending on VS Code, so the
// mapping is unit-tested on its own. extension.ts turns these into vscode objects.

import type { ContractResult, Finding, Severity } from '@tell/engine';
import { atLeast, findingMessage, transcriptFor } from '../../mcp/src/format.js';
import { ruleById, ruleMarkdown } from '../../mcp/src/rules.js';

// Same numbering as vscode.DiagnosticSeverity.
export const DiagnosticLevel = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;
export type DiagnosticLevel = (typeof DiagnosticLevel)[keyof typeof DiagnosticLevel];

export const levelOf = (s: Severity): DiagnosticLevel =>
  s === 'critical' || s === 'high' ? DiagnosticLevel.Error : s === 'medium' ? DiagnosticLevel.Warning : s === 'low' ? DiagnosticLevel.Information : DiagnosticLevel.Hint;

export type Span = { line: number; start: number; end: number }; // zero-based line, character offsets

export type PlainDiagnostic = {
  span: Span;
  level: DiagnosticLevel;
  message: string;
  code: Finding['kind'];
  source: 'Tell';
  related: { span: Span; message: string }[];
  finding: Finding;
};

// The code on a line: from its first non-space character to the end, before any `//` comment.
export function spanOfLine(text: string, line0: number): Span {
  const lines = text.split(/\r?\n/);
  const l = lines[Math.max(0, Math.min(line0, lines.length - 1))] ?? '';
  const start = l.search(/\S/);
  if (start < 0) return { line: line0, start: 0, end: l.length };
  const comment = l.indexOf('//', start);
  const code = (comment >= 0 ? l.slice(0, comment) : l).trimEnd();
  return { line: line0, start, end: Math.max(start + 1, code.length) };
}

const findLine = (text: string, re: RegExp): number => text.split(/\r?\n/).findIndex((l) => re.test(l));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Where a finding lives: its reported line, else its circuit's declaration, else the top of the file.
export function spanOf(f: Finding, text: string): Span {
  if (f.line && f.line > 0) return spanOfLine(text, f.line - 1);
  const c = findLine(text, new RegExp(`\\bcircuit\\s+${escape(f.circuit)}\\b`));
  return spanOfLine(text, c >= 0 ? c : 0);
}

export function toDiagnostics(r: ContractResult, text: string, opts: { minSeverity?: Severity } = {}): PlainDiagnostic[] {
  if (!r.ok || !r.report) return [];
  const min = opts.minSeverity ?? 'low';
  const circuits = r.report.circuits;
  return r.report.findings
    .filter((f) => !f.suppressed && atLeast(f.severity, min))
    .map((f) => {
      const span = spanOf(f, text);
      const decl = findLine(text, new RegExp(`\\bledger\\s+${escape(f.field)}\\s*:`));
      const declSpan = decl >= 0 ? spanOfLine(text, decl) : span;
      const related = transcriptFor(f, circuits).map((t) => ({ span: declSpan, message: `public transcript of ${f.circuit}: ${t}` }));
      return { span, level: levelOf(f.severity), message: `${f.severity}: ${findingMessage(f)}`, code: f.kind, source: 'Tell' as const, related, finding: f };
    });
}

// The CLI's --json output: an array of ContractResult. Tolerates anything printed before it.
export function parseCliJson(stdout: string): ContractResult[] {
  const i = stdout.indexOf('[');
  if (i < 0) throw new Error(`Tell printed no JSON: ${stdout.slice(0, 200)}`);
  const v = JSON.parse(stdout.slice(i));
  if (!Array.isArray(v)) throw new Error('Tell JSON is not a list of results');
  return v as ContractResult[];
}

export type Status = { text: string; tooltip: string; tone: 'error' | 'warning' | 'ok' };

export function statusOf(r: ContractResult | undefined): Status | null {
  if (!r) return null;
  if (!r.ok) return { text: '$(eye) Tell: no grade', tooltip: `Tell could not compile this contract.\n${r.error ?? ''}`.trim(), tone: 'warning' };
  const c = r.counts!;
  const parts = (['critical', 'high', 'medium', 'low'] as Severity[]).filter((s) => c[s]).map((s) => `${c[s]} ${s}`);
  const tone = r.grade === 'F' || r.grade === 'D' ? 'error' : r.grade === 'C' ? 'warning' : 'ok';
  return {
    text: `$(eye) Tell: ${r.grade}`,
    tooltip: `Privacy grade ${r.grade} (compact ${r.compiler}, ${r.report!.circuits.length} circuits)\n${parts.length ? parts.join(', ') : 'nothing above info'}\nClick for the Problems panel.`,
    tone,
  };
}

// Hover for a line holding findings: what leaks, the fix, and the public transcript.
export function hoverMarkdown(ds: PlainDiagnostic[], commandUri?: (d: PlainDiagnostic) => string): string {
  return ds
    .map((d) => {
      const f = d.finding;
      const out = [`**Tell · ${f.severity} · ${f.kind}** in \`${f.circuit}\``, '', `${findingMessage(f)}. ${f.detail}`, '', `**Fix:** ${f.fix}`];
      if (d.related.length) out.push('', '**Public transcript**', '', ...d.related.map((r) => `- \`${r.message.replace(/^public transcript of [^:]+: /, '')}\``));
      if (commandUri) out.push('', `[Show Tell's fix](${commandUri(d)})`);
      return out.join('\n');
    })
    .join('\n\n---\n\n');
}

// The document "Show Tell's fix" opens: this finding, then the rule with a worked leak and fix.
export function fixMarkdown(f: Finding, file: string, related: string[] = []): string {
  const rule = ruleById(f.kind);
  return [
    `# ${f.title}`,
    '',
    `\`${file}\`${f.line ? `, line ${f.line}` : ''}, circuit \`${f.circuit}\`: **${f.severity}**, ${f.bits} bits.`,
    '',
    f.detail,
    '',
    '## What to change',
    '',
    f.fix,
    ...(related.length ? ['', '## Public transcript', '', ...related.map((r) => `- \`${r}\``)] : []),
    '',
    '---',
    '',
    rule ? ruleMarkdown(rule).replace(/^# /, '# Rule: ') : `Rule \`${f.kind}\`: see https://tell-midnight.vercel.app/how`,
  ].join('\n');
}

// tell.compilerDirs entries may name compactc.bin itself or its directory.
export const compilerDir = (p: string) => p.replace(/[\\/]compactc(\.bin)?$/, '');
