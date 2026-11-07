#!/usr/bin/env node
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
//   tell [path…]                    scan .compact contracts (default: current directory)
//   tell [path…] --json             machine-readable results
//   tell [path…] --json-out <file>  also write the JSON results to a file
//   tell [path…] --sarif <file>     write SARIF 2.1.0 for GitHub code scanning
//   tell [path…] --fail-on high     exit 1 if anything at or above this severity is found
//   tell [path…] --all              also print info-level disclosures
//   tell [path…] --fix-dry-run      print verified fixes as a unified diff; change nothing
//   tell [path…] --fix              apply verified fixes to the files, then report what is left

import fs from 'node:fs';
import path from 'node:path';
import { scanPath, scanFile, findCompilers, severityRank, type ContractResult, SEVERITIES } from './index.js';
import type { Severity, Finding } from './analyze.js';
import { toSarif } from './sarif.js';
import { planFixes, describeVerification, type FilePlan } from './fix.js';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = ['--sarif', '--fail-on', '--json-out'];
const paths = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1] ?? ''));
if (paths.length === 0) paths.push('.');

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const dim = c('2');
const green = c('32');
const red = c('31');
const COLOR: Record<Severity, (s: string) => string> = { critical: c('1;31'), high: c('31'), medium: c('33'), low: c('36'), info: c('2') };

const applyFixes = flag('--fix');
const wantFixes = applyFixes || flag('--fix-dry-run');

let results: ContractResult[] = [];
for (const p of paths) results.push(...(await scanPath(path.resolve(p))));

const plans = new Map<string, FilePlan>();
if (wantFixes) {
  const compilers = await findCompilers();
  for (const r of results) if (r.ok) plans.set(r.file, await planFixes(r, { compilers, root: process.cwd() }));
}

const json = flag('--json') || opt('--json-out');
const jsonText = json
  ? JSON.stringify(
      results.map((r) => (plans.has(r.file) ? { ...r, fixes: slim(plans.get(r.file)!) } : r)),
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    ) + '\n'
  : '';
if (opt('--json-out')) fs.writeFileSync(opt('--json-out')!, jsonText);

if (flag('--json')) {
  process.stdout.write(jsonText);
} else {
  const showInfo = flag('--all');
  if (results.length === 0) console.log('No Compact contracts found.');
  for (const r of results) {
    const rel = path.relative(process.cwd(), r.file) || r.file;
    if (!r.ok) {
      console.log(`\n${bold(rel)}  ${COLOR.medium('could not compile')}\n  ${r.error?.split('\n').join('\n  ')}`);
      continue;
    }
    const rep = r.report!;
    const live = rep.findings.filter((f) => !f.suppressed);
    const counts = SEVERITIES.filter((s) => r.counts![s]).map((s) => COLOR[s](`${r.counts![s]} ${s}`));
    console.log(`\n${bold(rel)}  grade ${bold(r.grade!)}  ${dim(`compact ${r.compiler}, ${rep.circuits.length} circuits`)}  ${counts.join(', ')}`);
    for (const circ of rep.circuits) {
      const fs_ = live.filter((f) => f.circuit === circ.name && (showInfo || f.severity !== 'info'));
      if (fs_.length === 0) continue;
      console.log(`\n  ${bold(circ.name)}  ${dim(`private inputs: ${circ.privateInputs.map((i) => `${i.name} (${i.type})`).join(', ') || 'none'}`)}`);
      for (const f of fs_.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))) printFinding(f, rel);
      if (showInfo && circ.proves.length) for (const p of circ.proves) console.log(`    ${dim('proves')} "${p.message}" ${dim(`about ${p.sources.join(', ')}`)}`);
    }
    if (rep.unknownForms.length) console.log(dim(`\n  note: ${rep.unknownForms.length} compiler forms treated conservatively: ${rep.unknownForms.join(', ')}`));
    const plan = plans.get(r.file);
    if (plan) printPlan(plan);
  }
  const total = results.flatMap((r) => r.report?.findings.filter((f) => !f.suppressed && f.severity !== 'info') ?? []);
  console.log(`\n${results.length} contract${results.length === 1 ? '' : 's'}, ${total.length} finding${total.length === 1 ? '' : 's'} above info.`);
}

// --fix: write each file's combined, verified patch, then scan again so --fail-on sees the result.
if (applyFixes) {
  const log = flag('--json') ? console.error : console.log;
  let written = 0;
  for (const plan of plans.values()) {
    if (!plan.combined) continue;
    fs.writeFileSync(plan.file, plan.combined.source);
    written++;
    const v = plan.combined.verification;
    log(`${green('fixed')} ${path.relative(process.cwd(), plan.file) || plan.file}: ${plan.combined.applied.length} patch${plan.combined.applied.length === 1 ? '' : 'es'}, grade ${v.gradeBefore} → ${v.gradeAfter}`);
  }
  if (written) {
    const compilers = await findCompilers();
    results = await Promise.all(results.map((r) => (plans.get(r.file)?.combined ? scanFile(r.file, compilers) : r)));
  }
  if (!written) log('No verified fixes to apply.');
}

const sarif = opt('--sarif');
if (sarif) fs.writeFileSync(sarif, JSON.stringify(toSarif(results, process.cwd()), null, 2));

const failOn = opt('--fail-on') as Severity | undefined;
if (failOn && SEVERITIES.includes(failOn)) {
  const bad = results.some((r) => !r.ok || r.report!.findings.some((f) => !f.suppressed && severityRank(f.severity) <= severityRank(failOn)));
  process.exitCode = bad ? 1 : 0;
}

function printFinding(f: Finding, file: string) {
  const where = f.line ? dim(`${file}:${f.line}`) : '';
  console.log(`    ${COLOR[f.severity](f.severity.padEnd(8))} ${f.title}  ${where}`);
  console.log(`             ${dim(f.detail)}`);
  if (f.fields && f.fields.length > 1) console.log(`             ${dim('touches: ' + f.fields.join(', '))}`);
  console.log(`             ${dim('fix: ' + f.fix)}`);
}

function printPlan(plan: FilePlan) {
  if (plan.suggestions.length === 0) return;
  console.log(`\n  ${bold('fixes')}`);
  for (const s of plan.suggestions) {
    const f = s.finding;
    const at = `${f.kind} in ${f.circuit}${f.line ? `, line ${f.line}` : ''}`;
    if (s.patch) {
      console.log(`    ${green('verified')} ${at} (${s.rule}): ${s.summary}`);
      console.log(`             ${dim(describeVerification(s.verification!))}`);
      for (const n of s.notes) console.log(`             ${dim(n)}`);
      console.log(colorDiff(s.patch.diff, '    '));
    } else {
      console.log(`    ${COLOR.medium('manual')}   ${at}`);
      console.log(`             ${dim(s.manual ?? '')}`);
    }
  }
  if (plan.combined && plan.combined.applied.length > 1) console.log(`    ${dim(`all ${plan.combined.applied.length} together: ${describeVerification(plan.combined.verification)}`)}`);
}

function colorDiff(diff: string, indent: string) {
  return diff
    .trimEnd()
    .split('\n')
    .map((l) => indent + (l.startsWith('+') && !l.startsWith('+++') ? green(l) : l.startsWith('-') && !l.startsWith('---') ? red(l) : l.startsWith('@@') ? dim(l) : l))
    .join('\n');
}

// JSON keeps diffs and ranges, not whole patched sources.
function slim(plan: FilePlan) {
  return {
    ...plan,
    suggestions: plan.suggestions.map((s) => (s.patch ? { ...s, patch: { ...s.patch, source: undefined } } : s)),
    combined: plan.combined ? { ...plan.combined, source: undefined } : undefined,
  };
}
