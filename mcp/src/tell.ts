// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Scanning for the MCP tools: a contract given as source text, as a path, or
// both (unsaved text that includes files next to it). Everything goes through
// the engine's public API: the real Compact compiler, then Tell's analysis.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCompilers, findContracts, parsePolicy, scanFile, type Compiler, type ContractResult, type Finding, type Grade, type Policy, type ScanOptions, type Severity } from '@tell/engine';
import { SEVERITY_ORDER, transcript, transcriptFor } from './format.js';

// policy: declared intent, the same object a tell.json holds. Without it, a scan by `path` uses the
// nearest tell.json or .tellrc.json above the contract, and a scan of bare source text uses none.
export type ScanInput = { source?: string; path?: string; compiler?: string; policy?: Policy };

// Compilers are probed once per process (each probe runs the binary twice).
let probed: Promise<Compiler[]> | null = null;
export const installedCompilers = () => (probed ??= findCompilers());

export async function compilersFor(version?: string): Promise<{ ok: true; list: Compiler[] } | { ok: false; error: string }> {
  const all = await installedCompilers();
  if (all.length === 0)
    return { ok: false, error: 'No Compact compiler found. Install one with `compact update 0.31.1`, or set TELL_COMPILERS to directories holding compactc.bin.' };
  if (!version) return { ok: true, list: all };
  const list = all.filter((c) => c.version === version || c.version.startsWith(version + '.'));
  if (list.length === 0)
    return { ok: false, error: `Compact compiler ${version} is not installed. Installed: ${all.map((c) => c.version).join(', ')}. Install it with \`compact update ${version}\`.` };
  return { ok: true, list };
}

// Where source text is written when no path is given. WSL wipes /tmp between
// sessions, which is fine here: each scan gets its own directory and removes it.
const tmpRoot = () => process.env.TELL_TMPDIR || os.tmpdir();

export async function scan(input: ScanInput): Promise<ContractResult[]> {
  const comp = await compilersFor(input.compiler);
  const label = input.path ?? 'contract.compact';
  if (!comp.ok) return [{ file: label, compiler: null, language: null, ok: false, error: comp.error }];
  // Validate an inline policy the same way a file is validated (a typo must not pass silently).
  const policy = input.policy === undefined ? undefined : parsePolicy(JSON.stringify(input.policy), 'policy');
  const opts: ScanOptions = policy ? { policy } : {};

  if (input.source === undefined) {
    if (!input.path) throw new Error('Give the contract as `source` (Compact text) or `path` (a .compact file or a directory).');
    const p = path.resolve(input.path);
    if (!fs.existsSync(p)) throw new Error(`No such file or directory: ${p}`);
    const files = findContracts(p);
    const out: ContractResult[] = [];
    for (const f of files) out.push(await scanFile(f, comp.list, opts));
    return out;
  }

  // Source text. Next to `path` when one is given, so `include` and imports resolve as in the project.
  const nextTo = input.path ? path.dirname(path.resolve(input.path)) : null;
  if (nextTo && !fs.existsSync(nextTo)) throw new Error(`No such directory: ${nextTo}`);
  const dir = nextTo ?? fs.mkdtempSync(path.join(tmpRoot(), 'tell-mcp-'));
  const file = path.join(dir, nextTo ? `.tell-${crypto.randomBytes(4).toString('hex')}-${path.basename(input.path!)}` : 'contract.compact');
  fs.writeFileSync(file, input.source);
  try {
    const r = await scanFile(file, comp.list, policy ? opts : nextTo ? {} : { policyFile: null });
    return [{ ...r, file: label }];
  } finally {
    if (nextTo) fs.rmSync(file, { force: true });
    else fs.rmSync(dir, { recursive: true, force: true });
  }
}

// What a tool returns per contract: small, flat and readable by a model.
export type FindingSummary = {
  rule: Finding['kind'];
  severity: Severity;
  circuit: string;
  line: number | null;
  revealed: string;
  bits: number;
  detail: string;
  fix: string;
  field: string;
  sources: string[];
  publicTranscript: string[];
  suppressed?: boolean;
};

export type ContractSummary = {
  file: string;
  ok: boolean;
  error?: string;
  compiler: string | null;
  grade: Grade | null;
  counts: Record<Severity, number> | null;
  findings: FindingSummary[];
  circuits: { name: string; privateInputs: string[]; publishedBits: number; publicTranscript: string[] }[];
  infoFindingsHidden: number;
  suppressed: number;
};

export function summarizeFinding(f: Finding, r: ContractResult): FindingSummary {
  return {
    rule: f.kind,
    severity: f.severity,
    circuit: f.circuit,
    line: f.line ?? null,
    revealed: f.title,
    bits: f.bits,
    detail: f.detail,
    fix: f.fix,
    field: f.field,
    sources: f.sources.map((s) => `${s.kind === 'witness' ? s.name + '()' : s.name} (${s.kind}, ${s.type}, ${s.bits} bits)`),
    publicTranscript: transcriptFor(f, r.report?.circuits ?? []),
    ...(f.suppressed ? { suppressed: true } : {}),
  };
}

export function summarize(r: ContractResult, opts: { includeInfo?: boolean } = {}): ContractSummary {
  if (!r.ok || !r.report)
    return { file: r.file, ok: false, error: r.error, compiler: r.compiler, grade: null, counts: null, findings: [], circuits: [], infoFindingsHidden: 0, suppressed: 0 };
  const rep = r.report;
  const live = rep.findings.filter((f) => !f.suppressed);
  const shown = live.filter((f) => opts.includeInfo || f.severity !== 'info');
  return {
    file: r.file,
    ok: true,
    compiler: r.compiler,
    grade: r.grade ?? null,
    counts: r.counts ?? null,
    findings: shown.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (a.line ?? 0) - (b.line ?? 0)).map((f) => summarizeFinding(f, r)),
    circuits: rep.circuits.map((c) => ({
      name: c.name,
      privateInputs: c.privateInputs.map((i) => `${i.kind === 'witness' ? i.name + '()' : i.name}: ${i.type}`),
      publishedBits: c.publishedBits,
      publicTranscript: transcript(c),
    })),
    infoFindingsHidden: live.length - shown.length,
    suppressed: rep.findings.length - live.length,
  };
}

// Findings are matched across two versions of a contract by what they are about, not by line.
const keyOf = (f: Finding) => [f.kind, f.circuit, f.field, f.sources.map((s) => s.name).sort().join('+')].join('|');

export type FixCheck = {
  ok: boolean;
  error?: string;
  gradeBefore: Grade | null;
  gradeAfter: Grade | null;
  clean: boolean;
  resolved: FindingSummary[];
  remaining: (FindingSummary & { severityBefore?: Severity })[];
  introduced: FindingSummary[];
  verdict: string;
};

export function compareResults(before: ContractResult, after: ContractResult): FixCheck {
  const g0 = before.ok ? (before.grade ?? null) : null;
  if (!after.ok)
    return { ok: false, error: after.error, gradeBefore: g0, gradeAfter: null, clean: false, resolved: [], remaining: [], introduced: [], verdict: `The revised contract does not compile: ${after.error?.split('\n')[0] ?? 'unknown error'}` };
  const serious = (r: ContractResult) => (r.report?.findings ?? []).filter((f) => !f.suppressed && f.severity !== 'info');
  const a = serious(before);
  const b = serious(after);
  const bKeys = new Map(b.map((f) => [keyOf(f), f]));
  const aKeys = new Map(a.map((f) => [keyOf(f), f]));
  const resolved = a.filter((f) => !bKeys.has(keyOf(f))).map((f) => summarizeFinding(f, before));
  const remaining = b
    .filter((f) => aKeys.has(keyOf(f)))
    .map((f) => {
      const was = aKeys.get(keyOf(f))!.severity;
      return { ...summarizeFinding(f, after), ...(was !== f.severity ? { severityBefore: was } : {}) };
    });
  const introduced = b.filter((f) => !aKeys.has(keyOf(f))).map((f) => summarizeFinding(f, after));
  const g1 = after.grade ?? null;
  const clean = g1 === 'A';
  const parts = [
    `Grade ${g0 ?? '?'} → ${g1}.`,
    `${resolved.length} resolved, ${remaining.length} remaining, ${introduced.length} new.`,
    clean
      ? 'Nothing above info is left.'
      : [...remaining, ...introduced].some((f) => f.severity !== 'low')
        ? 'Still leaking: see remaining and introduced.'
        : 'Only low findings are left; check them, or mark intended ones with // tell:allow.',
  ];
  return { ok: true, gradeBefore: g0, gradeAfter: g1, clean, resolved, remaining, introduced, verdict: parts.join(' ') };
}
