// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Verified fixes for the website: the engine's planFixes (engine/src/fix.ts) proposes a rewrite
// per finding, compiles the patched contract with the same compiler and scans it again. Only
// patches that compile, remove the finding and add nothing at medium or worse are attached.
// Must run while the scanned file is still on disk.

import type { Compiler, ContractResult } from '@tell/engine';
import { planFixes, type FilePlan, type Suggestion } from '@/vendor/engine/fix';

// What the API adds to a finding with a verified patch (lib/types.ts VerifiedFix).
type Patch = { diff: string; verified: true; gradeAfter?: string; text: string; rule: string };

// What the API adds to a contract: every verified patch applied together, verified as a whole.
export type CombinedFix = { diff: string; applied: number; gradeBefore: string | null; gradeAfter: string | null };

const sameFinding = (a: Suggestion['finding'], b: Suggestion['finding']) =>
  a.circuit === b.circuit && a.kind === b.kind && a.field === b.field && a.severity === b.severity && (a.line ?? 0) === (b.line ?? 0);

// Rewrites the diff's file headers to the name the visitor sees.
const rename = (diff: string, name: string) => diff.replace(/^(---|\+\+\+) (a\/|b\/)?.*$/gm, (_m, side: string) => `${side} ${side === '---' ? 'a' : 'b'}/${name}`);

export async function attachFixes(result: ContractResult, compilers: Compiler[], shownName: string, deadline: number): Promise<void> {
  if (!result.ok || !result.report || Date.now() > deadline) return;
  if (!result.report.findings.some((f) => !f.suppressed && ['critical', 'high', 'medium'].includes(f.severity))) return;
  let plan: FilePlan;
  try {
    plan = await planFixes(result, { compilers });
  } catch (e) {
    console.error('fix planning failed', (e as Error).message);
    return;
  }
  for (const s of plan.suggestions) {
    if (!s.patch || !s.verification?.ok) continue;
    const f = result.report.findings.find((g) => sameFinding(g, s.finding));
    if (!f) continue;
    const patch: Patch = { diff: rename(s.patch.diff, shownName), verified: true, gradeAfter: s.verification.gradeAfter ?? undefined, text: s.summary, rule: s.rule ?? '' };
    (f as unknown as { patch: Patch }).patch = patch;
  }
  if (plan.combined)
    (result as ContractResult & { fixes?: CombinedFix }).fixes = {
      diff: rename(plan.combined.diff, shownName),
      applied: plan.combined.applied.length,
      gradeBefore: plan.combined.verification.gradeBefore,
      gradeAfter: plan.combined.verification.gradeAfter,
    };
}
