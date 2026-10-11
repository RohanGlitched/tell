#!/usr/bin/env node
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
//   tell [path…]                 scan .compact contracts (default: current directory)
//   tell [path…] --json          machine-readable results
//   tell [path…] --sarif <file>  write SARIF 2.1.0 for GitHub code scanning
//   tell [path…] --fail-on high  exit 1 if anything at or above this severity is found
//   tell [path…] --all           also print info-level disclosures

import fs from 'node:fs';
import path from 'node:path';
import { scanPath, severityRank, type ContractResult, SEVERITIES } from './index.js';
import type { Severity, Finding } from './analyze.js';
import { toSarif } from './sarif.js';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const paths = args.filter((a, i) => !a.startsWith('--') && !['--sarif', '--fail-on'].includes(args[i - 1] ?? ''));
if (paths.length === 0) paths.push('.');

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const dim = c('2');
const COLOR: Record<Severity, (s: string) => string> = { critical: c('1;31'), high: c('31'), medium: c('33'), low: c('36'), info: c('2') };

const results: ContractResult[] = [];
for (const p of paths) results.push(...(await scanPath(path.resolve(p))));

if (flag('--json')) {
  process.stdout.write(JSON.stringify(results, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
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
  }
  const total = results.flatMap((r) => r.report?.findings.filter((f) => !f.suppressed && f.severity !== 'info') ?? []);
  console.log(`\n${results.length} contract${results.length === 1 ? '' : 's'}, ${total.length} finding${total.length === 1 ? '' : 's'} above info.`);
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
