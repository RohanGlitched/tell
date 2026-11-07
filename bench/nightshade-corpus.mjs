#!/usr/bin/env node
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Runs Tell on Nightshade's own published regression corpus (tests/corpus in the Nightshade
// repository), so Tell is measured on contracts its author did not write. Nightshade's 300-root
// evaluation set is private (docs/evaluation.md: "private and unavailable for reproduction"); this
// is the corpus it does publish: synthetic positive / corrected / look-alike programs labelled for
// individual Nightshade detectors. `drafts/` (work in progress, not registered in a manifest) is
// left out.
//
//   NIGHTSHADE_REPO=~/mn/work/bench/tools/nightshade node bench/nightshade-corpus.mjs
//   node bench/nightshade-corpus.mjs --summary      # re-summarise an existing run
//
// Writes bench/results/nightshade-corpus.json (one entry per file: status, compiler, findings, and
// the Nightshade labels that mention the file) and prints a summary.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(BENCH);
const REPO = path.resolve((process.env.NIGHTSHADE_REPO ?? '~/mn/work/bench/tools/nightshade').replace(/^~/, os.homedir()));
const CORPUS = path.join(REPO, 'tests/corpus');
const OUT = path.join(BENCH, 'results/nightshade-corpus.json');
const PRIVACY = new Set([
  'ledger-bound-preimage-publication',
  'declared-secret-publication',
  'predictable-commitment-randomness',
  'low-entropy-hash-disclosure',
  'publicly-derivable-encryption-secret',
  'published-digest-generator-scalar-review',
  'exported-shielded-descriptor',
]);
const SEV = ['critical', 'high', 'medium', 'low', 'info'];

// Every label Nightshade's manifests give a file: detector, role (positive / corrected / lookalike / safe), lines.
function labels() {
  const out = new Map();
  const add = (file, l) => {
    const k = path.normalize(file.replace(/^tests\/corpus\//, ''));
    out.set(k, [...(out.get(k) ?? []), l]);
  };
  const read = (f) => JSON.parse(fs.readFileSync(path.join(CORPUS, f), 'utf8'));
  const m = read('manifest.json');
  const group = (detector, cases) => {
    for (const c of cases ?? []) if (c.file) add(c.file, { detector, role: c.lines?.length ? 'positive' : 'quiet', lines: c.lines ?? [] });
  };
  group(m.detector, m.cases);
  for (const v of Object.values(m)) if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.cases)) group(v.detector ?? (v.detectors ?? []).join('+'), v.cases);
  for (const c of read('known-bugs.json').cases) {
    add(c.file, { detector: c.detector, role: 'positive', lines: c.expectedLines ?? [] });
    if (c.corrected) add(c.corrected, { detector: c.detector, role: 'corrected', lines: [] });
    if (c.lookalike) add(c.lookalike, { detector: c.detector, role: 'lookalike', lines: [] });
  }
  for (const c of read('synthetic-regressions.json').cases)
    for (const [role, x] of Object.entries(c.checks ?? {}))
      for (const t of c.targets ?? []) add(x.file, { detector: t.detector, role, lines: role === 'positive' ? (t.positiveLines ?? []) : [] });
  for (const c of read('detector-counterexamples/manifest.json').cases) add(c.file, { detector: c.detectorId, role: c.kind, lines: [] });
  // de-duplicate
  for (const [k, ls] of out) out.set(k, [...new Map(ls.map((l) => [`${l.detector}|${l.role}|${l.lines.join(',')}`, l])).values()]);
  return out;
}

function files() {
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'drafts' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.compact') ? [path.join(d, e.name)] : []));
  return walk(CORPUS)
    .filter((f) => /^\s*pragma\s+language_version/m.test(fs.readFileSync(f, 'utf8')))
    .sort();
}

function run() {
  const tsx = path.join(ROOT, 'node_modules/.bin/tsx');
  const lab = labels();
  const list = files();
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
  const prev = fs.existsSync(OUT) && process.argv.includes('--resume') ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const done = new Map((prev?.files ?? []).map((f) => [f.id, f]));
  const out = [];
  const t0 = Date.now();
  list.forEach((abs, i) => {
    const id = path.relative(CORPUS, abs);
    if (done.has(id)) return out.push(done.get(id));
    process.stderr.write(`[${i + 1}/${list.length}] ${id}\n`);
    const t = Date.now();
    const r = spawnSync(tsx, ['engine/src/cli.ts', abs, '--json', '--no-policy'], { cwd: ROOT, encoding: 'utf8', timeout: 600_000, maxBuffer: 256 * 1024 * 1024 });
    let entry = { id, labels: lab.get(path.normalize(id)) ?? [], seconds: Math.round((Date.now() - t) / 100) / 10 };
    try {
      const c = JSON.parse(r.stdout)[0];
      if (!c) entry = { ...entry, status: 'error', note: 'no result' };
      else if (!c.ok) entry = { ...entry, status: /could not analyze/.test(c.error ?? '') ? 'crash' : 'compile-error', compiler: c.compiler, note: (c.error ?? '').split('\n').slice(0, 3).join(' ').slice(0, 300) };
      else
        entry = {
          ...entry,
          status: 'complete',
          compiler: c.compiler,
          grade: c.grade,
          unknownForms: c.report.unknownForms,
          findings: c.report.findings.filter((x) => !x.suppressed).map((x) => ({ kind: x.kind, severity: x.severity, circuit: x.circuit, line: x.line ?? null, field: x.field, sources: x.sources.map((s) => s.name), bits: x.bits, title: x.title })),
        };
    } catch {
      entry = { ...entry, status: r.error?.code === 'ETIMEDOUT' ? 'timeout' : 'crash', note: ((r.stderr || r.stdout || '') + (r.error ? String(r.error) : '')).slice(0, 300) };
    }
    out.push(entry);
    if (out.length % 20 === 0) save(out, commit, t0, list.length);
  });
  save(out, commit, t0, list.length);
}

function save(out, commit, t0, total) {
  const res = {
    tool: 'tell',
    corpus: { repo: 'https://github.com/DicksonWu654/nightshade', commit, path: 'tests/corpus (drafts/ excluded)', files: total },
    command: 'npx tsx engine/src/cli.ts <file> --json --no-policy',
    seconds: Math.round((Date.now() - t0) / 1000),
    files: out,
  };
  const clean = JSON.stringify(res, null, 1).split(REPO).join('<nightshade>').split(ROOT).join('<repo>').split(os.homedir()).join('~');
  fs.writeFileSync(OUT, clean + '\n');
}

function summary() {
  const res = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const fsx = res.files;
  const by = (s) => fsx.filter((f) => f.status === s).length;
  const lines = [];
  lines.push(`files ${fsx.length}: complete ${by('complete')}, compile-error ${by('compile-error')}, crash ${by('crash')}, timeout ${by('timeout')}, error ${by('error')}`);
  const unk = new Set(fsx.flatMap((f) => f.unknownForms ?? []));
  lines.push(`files with unknown compiler forms: ${fsx.filter((f) => (f.unknownForms ?? []).length).length} (${[...unk].join(', ')})`);
  const all = fsx.flatMap((f) => (f.findings ?? []).map((x) => ({ ...x, id: f.id })));
  lines.push(`findings: ${all.length}; by severity ${SEV.map((s) => `${s} ${all.filter((x) => x.severity === s).length}`).join(', ')}`);
  const med = all.filter((x) => SEV.indexOf(x.severity) <= 2);
  const kinds = {};
  for (const x of med) kinds[x.kind] = (kinds[x.kind] ?? 0) + 1;
  lines.push(`medium+ by kind: ${JSON.stringify(kinds)}`);
  lines.push(`files with a medium+ finding: ${new Set(med.map((x) => x.id)).size}`);
  // the privacy-labelled part: Nightshade's own positives and negatives for its privacy rules
  const priv = fsx.filter((f) => f.labels.some((l) => PRIVACY.has(l.detector)));
  lines.push(`\nprivacy-labelled files: ${priv.length}`);
  for (const f of priv) {
    const roles = [...new Set(f.labels.filter((l) => PRIVACY.has(l.detector)).map((l) => `${l.detector}:${l.role}${l.lines.length ? '@' + l.lines.join(',') : ''}`))].join(' ');
    const m = (f.findings ?? []).filter((x) => SEV.indexOf(x.severity) <= 2).map((x) => `${x.kind}/${x.severity}@${x.line}`);
    lines.push(`  ${f.status === 'complete' ? '' : `[${f.status}] `}${f.id}  ${roles}  -> ${m.join(' ') || '-'}`);
  }
  const roleCount = {};
  for (const f of fsx) for (const l of f.labels) roleCount[l.role] = (roleCount[l.role] ?? 0) + 1;
  lines.push(`\nlabel roles over all files: ${JSON.stringify(roleCount)}`);
  lines.push(`compile errors (first 15):`);
  for (const f of fsx.filter((f) => f.status !== 'complete').slice(0, 15)) lines.push(`  ${f.id} [${f.status}] ${f.compiler ?? ''} ${f.note}`);
  console.log(lines.join('\n'));
}

if (process.argv.includes('--summary')) summary();
else {
  run();
  summary();
}
