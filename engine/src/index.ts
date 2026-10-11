// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import { analyze, type Finding, type Report, type Severity } from './analyze.js';
import { compileForAnalysis, findCompilers, isContractFile, type Compiler } from './compile.js';
import { readProgram } from './ir.js';

export * from './analyze.js';
export * from './ir.js';
export * from './compile.js';

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const severityRank = (s: Severity) => SEVERITIES.indexOf(s);

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type ContractResult = {
  file: string;
  compiler: string | null;
  language: string | null;
  ok: boolean;
  error?: string;
  grade?: Grade;
  report?: Report;
  counts?: Record<Severity, number>;
};

export function gradeOf(findings: Finding[]): Grade {
  const live = findings.filter((f) => !f.suppressed);
  if (live.some((f) => f.severity === 'critical')) return 'F';
  if (live.some((f) => f.severity === 'high')) return 'D';
  if (live.some((f) => f.severity === 'medium')) return 'C';
  if (live.some((f) => f.severity === 'low')) return 'B';
  return 'A';
}

// `// tell:allow` (optionally `tell:allow branch`) on the line or the line above.
export function applySuppressions(findings: Finding[], src: string) {
  const lines = src.split('\n');
  for (const f of findings) {
    if (!f.line) continue;
    for (const l of [lines[f.line - 1], lines[f.line - 2]]) {
      const m = l?.match(/tell:allow(?:\s+([\w-]+(?:\s*,\s*[\w-]+)*))?/);
      if (m && (!m[1] || m[1].split(/\s*,\s*/).includes(f.kind))) f.suppressed = true;
    }
  }
}

export function analyzeIr(ir: string, src?: string): Report {
  const report = analyze(readProgram(ir), { sourceText: src });
  if (src) applySuppressions(report.findings, src);
  return report;
}

export async function scanFile(file: string, compilers?: Compiler[]): Promise<ContractResult> {
  const src = fs.readFileSync(file, 'utf8');
  const c = await compileForAnalysis(file, compilers);
  if (!c.ok) return { file, compiler: c.compiler?.version ?? null, language: c.compiler?.language ?? null, ok: false, error: c.error };
  let report: Report;
  try {
    report = analyzeIr(c.ir, src);
  } catch (e) {
    return { file, compiler: c.compiler.version, language: c.compiler.language, ok: false, error: `Tell could not analyze this contract: ${(e as Error).message.slice(0, 300)}` };
  }
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, report.findings.filter((f) => f.severity === s && !f.suppressed).length])) as Record<Severity, number>;
  return { file, compiler: c.compiler.version, language: c.compiler.language, ok: true, report, counts, grade: gradeOf(report.findings) };
}

const SKIP = new Set(['node_modules', '.git', 'managed', 'dist', 'build', '.next', 'out', 'target']);

export function findContracts(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name));
      } else if (e.name.endsWith('.compact')) {
        const f = path.join(d, e.name);
        try {
          if (isContractFile(fs.readFileSync(f, 'utf8'))) out.push(f);
        } catch {
          /* unreadable file */
        }
      }
    }
  };
  if (fs.statSync(root).isFile()) return [root];
  walk(root);
  return out.sort();
}

export async function scanPath(root: string): Promise<ContractResult[]> {
  const compilers = await findCompilers();
  const results: ContractResult[] = [];
  for (const f of findContracts(root)) results.push(await scanFile(f, compilers));
  return results;
}
