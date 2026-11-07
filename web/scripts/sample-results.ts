// Precomputes the scanner's sample results so the "Try" buttons answer at once,
// even on a cold server. Rerun after any engine change (run from WSL, where the
// Compact compilers are installed):  npx tsx web/scripts/sample-results.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCompilers, scanFile } from '../../engine/src/index.js';
import { planFixes } from '../../engine/src/fix.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples: { id: string; source: string }[] = JSON.parse(fs.readFileSync(path.join(here, '../data/samples.json'), 'utf8'));
// The compilers the website bundles (scripts/fetch-compilers.mjs): results must match a live scan.
const BUNDLED = ['0.36.0', '0.35.0', '0.34.0', '0.31.1', '0.30.0', '0.29.0'];
const compilers = (await findCompilers()).filter((c) => BUNDLED.includes(c.version));
const out: Record<string, unknown> = {};
for (const s of samples) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-sample-'));
  const file = path.join(dir, 'contract.compact');
  fs.writeFileSync(file, s.source);
  const t = Date.now();
  const r = await scanFile(file, compilers);
  const ms = Date.now() - t;
  // the same verified patches the live API attaches (web/lib/fixes.ts)
  if (r.ok && r.report?.findings.some((f) => !f.suppressed && ['critical', 'high', 'medium'].includes(f.severity))) {
    const plan = await planFixes(r, { compilers });
    const rename = (d: string) => d.replace(/^(---|\+\+\+) (a\/|b\/)?.*$/gm, (_m, side: string) => `${side} ${side === '---' ? 'a' : 'b'}/contract.compact`);
    for (const s of plan.suggestions) {
      if (!s.patch || !s.verification?.ok) continue;
      const f = r.report.findings.find((g) => g.circuit === s.finding.circuit && g.kind === s.finding.kind && g.field === s.finding.field && g.severity === s.finding.severity && (g.line ?? 0) === (s.finding.line ?? 0));
      if (f) Object.assign(f, { patch: { diff: rename(s.patch.diff), verified: true, gradeAfter: s.verification.gradeAfter ?? undefined, text: s.summary, rule: s.rule ?? '', notes: s.notes, behaviourChange: s.rule === 'assert-branch' } });
    }
    if (plan.combined) Object.assign(r, { fixes: { diff: rename(plan.combined.diff), applied: plan.combined.applied.length, gradeBefore: plan.combined.verification.gradeBefore, gradeAfter: plan.combined.verification.gradeAfter } });
  }
  r.file = 'contract.compact';
  fs.rmSync(dir, { recursive: true, force: true });
  out[crypto.createHash('sha256').update(s.source).digest('hex')] = { kind: 'source', contracts: [r], compilers: BUNDLED, ms, precomputed: true };
  const fx = (r as { fixes?: { gradeAfter: string | null } }).fixes;
  console.log(`${s.id}: ${r.grade ?? 'failed'}${fx ? ` (verified fix: ${fx.gradeAfter})` : ''}`);
}
fs.writeFileSync(path.join(here, '../data/sample-results.json'), JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
