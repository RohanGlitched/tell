#!/usr/bin/env node
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Runs every tool on every corpus file and writes normalised results to
// bench/results/<tool>.json. Run from the repository root, on Linux or WSL:
//
//   bash bench/install.sh                 # once: pinned tools + examples
//   node bench/run.mjs                    # all tools, all sets
//   node bench/run.mjs --tools tell,compact-guard --sets cases
//
// Environment: BENCH_TOOLS (default bench/.tools), BENCH_EXAMPLES
// (default bench/.corpus/midnight-examples), BENCH_WORK (scratch copies,
// default ~/.cache/tell-bench). Tools run one at a time, one file at a time.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(BENCH);
const TOOLS = path.resolve(process.env.BENCH_TOOLS ?? path.join(BENCH, '.tools'));
const EXAMPLES = path.resolve(process.env.BENCH_EXAMPLES ?? path.join(BENCH, '.corpus', 'midnight-examples'));
const WORK = path.resolve(process.env.BENCH_WORK ?? path.join(os.homedir(), '.cache', 'tell-bench'));
const EXAMPLES_COMMIT = '377495c5efbd5b1f3123f5aee2776c3694b05eda';

const argv = process.argv.slice(2);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const ALL_TOOLS = ['tell', 'tell-policy', 'nightshade', 'nightshade-all', 'nightshade-policy', 'compact-guard', 'compact-lint', 'oz-detectors'];
const tools = (opt('--tools') ?? ALL_TOOLS.join(',')).split(',');
const sets = (opt('--sets') ?? 'zoo,cases,examples').split(',');

// ---------------------------------------------------------------- corpus

function corpus() {
  const out = [];
  const add = (set, abs, id) => out.push({ set, abs, id });
  if (sets.includes('zoo'))
    for (const f of fs.readdirSync(path.join(ROOT, 'zoo/contracts')).filter((f) => f.endsWith('.compact')).sort())
      add('zoo', path.join(ROOT, 'zoo/contracts', f), `zoo/${f}`);
  if (sets.includes('cases'))
    for (const f of fs.readdirSync(path.join(BENCH, 'cases')).filter((f) => f.endsWith('.compact')).sort())
      add('cases', path.join(BENCH, 'cases', f), `cases/${f}`);
  if (sets.includes('examples')) {
    const head = git(EXAMPLES, ['rev-parse', 'HEAD']);
    if (head !== EXAMPLES_COMMIT) throw new Error(`midnight-examples at ${EXAMPLES} is ${head}, expected ${EXAMPLES_COMMIT}`);
    const walk = (d) =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === 'node_modules' || e.name === 'managed' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.compact') ? [path.join(d, e.name)] : [],
      );
    const files = [...walk(path.join(EXAMPLES, 'examples')), ...walk(path.join(EXAMPLES, 'experimental/q2-ledger9/contracts'))].sort();
    for (const f of files) {
      // zk-loan/contract/schnorr.compact is a module imported by zk-loan, not a contract: scanned through its importer
      if (!/^\s*pragma\s+language_version/m.test(fs.readFileSync(f, 'utf8'))) continue;
      add('examples', f, `examples/${path.relative(EXAMPLES, f)}`);
    }
  }
  return out;
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function run(cmd, args, cwd = ROOT, timeout = 600_000) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
}

const lineOf = (src, offset) => src.slice(0, offset).split('\n').length;
const QTY = /(2\^\d+|\b\d[\d,]*\s+(?:values|candidates|guesses|possible values)\b|\b\d+(?:\.\d+)?\s+bits?\b|domain\s*(?:<=|≤)\s*\S+)/i;
const quantity = (...texts) => {
  for (const t of texts) {
    const m = typeof t === 'string' ? t.match(QTY) : null;
    if (m) return m[1];
  }
  return null;
};

// Rules whose subject is privacy (what the public transcript reveals). Everything else
// a tool reports is kept and labelled, but cannot count as finding a privacy leak.
const PRIVACY_RULES = {
  nightshade: new Set([
    'ledger-bound-preimage-publication',
    'declared-secret-publication',
    'predictable-commitment-randomness',
    'low-entropy-hash-disclosure',
    'publicly-derivable-encryption-secret',
    'published-digest-generator-scalar-review',
    'exported-shielded-descriptor',
  ]),
  'compact-guard': new Set(['CG002', 'CG003', 'CG004', 'CG007']),
  'compact-lint': new Set(),
  'oz-detectors': new Set(),
};

// ---------------------------------------------------------------- Tell

// tell: inference only (--no-policy). tell-policy: with bench/policies/tell.json, the intent each
// file's header states, written down as a policy (see bench/policies/README.md).
function runTell(files, variant = 'tell') {
  const tsx = path.join(ROOT, 'node_modules/.bin/tsx');
  const policyArgs = variant === 'tell-policy' ? ['--policy', path.join(BENCH, 'policies/tell.json')] : ['--no-policy'];
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  // a git worktree created on Windows cannot be read by Linux git; BENCH_TELL_COMMIT names it then
  const commit = git(ROOT, ['rev-parse', '--short', 'HEAD']) ?? process.env.BENCH_TELL_COMMIT ?? 'working tree';
  const out = [];
  for (const f of files) {
    process.stderr.write(`${variant} ${f.id}\n`);
    const r = run(tsx, ['engine/src/cli.ts', f.abs, '--json', ...policyArgs]);
    let res;
    try {
      res = JSON.parse(r.stdout);
    } catch {
      out.push({ id: f.id, status: 'error', note: (r.stderr || r.stdout).slice(0, 400), findings: [] });
      continue;
    }
    const c = res[0];
    if (!c || !c.ok) {
      out.push({ id: f.id, status: 'error', note: (c?.error ?? 'no result').slice(0, 400), findings: [] });
      continue;
    }
    out.push({
      id: f.id,
      status: 'complete',
      note: `compact ${c.compiler}`,
      findings: c.report.findings
        .filter((x) => !x.suppressed)
        .map((x) => ({
          rule: x.kind,
          severity: x.severity,
          native: x.severity,
          line: x.line ?? null,
          circuit: x.circuit,
          message: `${x.title}. ${x.detail}`,
          quantity: x.bits > 0 ? `${x.bits} bits` : null,
          privacy: true,
        })),
    });
  }
  return {
    tool: variant,
    version: `${version} (${commit})`,
    repo: 'https://github.com/RohanGlitched/tell',
    configuration: variant === 'tell-policy' ? 'with the declared-intent policy bench/policies/tell.json' : 'inference only, no policy file',
    command: `npx tsx engine/src/cli.ts <file> --json ${variant === 'tell-policy' ? '--policy bench/policies/tell.json' : '--no-policy'}`,
    files: out,
  };
}

// ---------------------------------------------------------------- Nightshade

const NS_PROFILES = [
  ['0.20', '0.28.0'],
  ['0.21', '0.29.0'],
  ['0.22', '0.30.0'],
  ['0.23', '0.31.1'],
  ['0.26', '0.34.0'],
  ['0.27', '0.35.0'],
];

// Pick the pinned profile for the file's pragma. Language 0.28 (compiler 0.36.0)
// has no Nightshade profile yet: the file is scanned as 0.27 under the 0.35.0
// profile, recorded as `adjusted`.
function nsProfile(src) {
  const m = src.match(/pragma\s+language_version\s+([^;]+);/);
  const p = m ? m[1].trim() : '';
  const exact = p.match(/^(\d+\.\d+)(?:\.\d+)?$/);
  if (exact) {
    const hit = NS_PROFILES.find(([l]) => l === exact[1]);
    if (hit) return { compiler: hit[1], adjust: null };
    return { compiler: '0.35.0', adjust: '0.27' };
  }
  return { compiler: '0.35.0', adjust: null }; // ">= 0.25.0" and similar ranges: newest profile
}

function nsAllIds(bin) {
  const r = run(bin, ['detector', 'list', '--json']);
  const j = JSON.parse(r.stdout);
  const list = Array.isArray(j) ? j : j.detectors;
  return list;
}

function runNightshade(files, variant) {
  const bin = path.join(TOOLS, 'nightshade/node_modules/.bin/nightshade');
  const version = run(bin, ['--version']).stdout.trim();
  const detectors = nsAllIds(bin);
  // Every registered rule that runs without a declared policy (policy-only rules need intent to mean anything).
  const allIds = detectors.filter((d) => !d.policyRequired).map((d) => d.id);
  const out = [];
  for (const f of files) {
    process.stderr.write(`${variant} ${f.id}\n`);
    const dir = path.join(WORK, variant, f.id.replace(/[^\w.-]+/g, '_'));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // copy the file and its sibling sources (imports resolve relative to the file)
    for (const s of fs.readdirSync(path.dirname(f.abs)).filter((x) => x.endsWith('.compact')))
      fs.copyFileSync(path.join(path.dirname(f.abs), s), path.join(dir, s));
    const target = path.join(dir, path.basename(f.abs));
    const src = fs.readFileSync(target, 'utf8');
    const prof = nsProfile(src);
    if (prof.adjust) fs.writeFileSync(target, src.replace(/(pragma\s+language_version\s+)[^;]+;/, `$1${prof.adjust};`));
    const args = [];
    if (variant === 'nightshade-policy') {
      const witnesses = [...src.matchAll(/^\s*(?:export\s+)?witness\s+(\w+)/gm)].map((m) => m[1]);
      const cfg = { version: 1, roots: [path.basename(target)], compilerVersion: prof.compiler };
      if (witnesses.length) cfg.policies = { secrets: witnesses.map((w) => ({ witness: w, allowedForms: ['hash', 'commitment'] })) };
      fs.writeFileSync(path.join(dir, 'nightshade.json'), JSON.stringify(cfg, null, 2));
      args.push('--config', path.join(dir, 'nightshade.json'), '--json');
    } else {
      args.push(target, '--compiler-version', prof.compiler, '--json');
      if (variant === 'nightshade-all') args.push('--detectors', allIds.join(','), '--profile', 'hygiene');
    }
    const r = run(bin, args, dir);
    let j;
    try {
      j = JSON.parse(r.stdout);
    } catch {
      out.push({ id: f.id, status: 'error', note: (r.stderr || r.stdout).slice(0, 400), findings: [] });
      continue;
    }
    const diags = (j.diagnostics ?? []).map((d) => `${d.code ?? d.id ?? ''}: ${d.message ?? ''}`.slice(0, 200));
    out.push({
      id: f.id,
      status: j.status === 'complete' ? 'complete' : 'incomplete',
      adjusted: prof.adjust ? `pragma ${prof.adjust}, profile ${prof.compiler}` : undefined,
      note: [`profile ${j.semanticProfile}`, ...diags.slice(0, 3)].join('; '),
      findings: (j.findings ?? [])
        .filter((x) => path.basename(x.location?.file ?? target) === path.basename(target))
        .map((x) => ({
          rule: x.detectorId,
          severity: x.severity,
          native: `${x.severity}/${x.confidence}`,
          line: x.location?.line ?? null,
          circuit: x.entrypoint ?? x.callPath?.[0] ?? null,
          message: `${x.title}. ${x.message}`,
          quantity: x.detectorId === 'low-entropy-hash-disclosure' ? quantity(x.message, JSON.stringify(x.evidence ?? '')) : null,
          privacy: PRIVACY_RULES.nightshade.has(x.detectorId),
        })),
    });
  }
  const what = {
    nightshade: 'default audit selection',
    'nightshade-all': `every rule that needs no policy (${allIds.length} of ${detectors.length}), hygiene profile`,
    'nightshade-policy': 'default selection plus a secrets policy declaring every witness secret, allowed forms hash and commitment (the shape of the shipped examples/review/secret-policy.json)',
  }[variant];
  return { tool: variant, version, repo: 'https://github.com/DicksonWu654/nightshade', configuration: what, command: `nightshade <file> --compiler-version <profile> --json ${variant === 'nightshade-all' ? '--detectors <ids> --profile hygiene' : variant === 'nightshade-policy' ? '(via --config)' : ''}`.trim(), files: out };
}

// ---------------------------------------------------------------- compact-guard

function runCompactGuard(files) {
  const dir = path.join(TOOLS, 'compact-guard');
  const bin = path.join(dir, 'packages/cli/bin/compact-guard.js');
  const version = `${run('node', [bin, '--version']).stdout.trim()} (${git(dir, ['rev-parse', '--short', 'HEAD'])})`;
  const SEV = { error: 'high', warning: 'medium', review: 'low' };
  const out = [];
  for (const f of files) {
    process.stderr.write(`compact-guard ${f.id}\n`);
    const r = run('node', [bin, '--format', 'json', '--fail-on', 'none', path.basename(f.abs)], path.dirname(f.abs));
    let j;
    try {
      j = JSON.parse(r.stdout);
    } catch {
      out.push({ id: f.id, status: 'error', note: (r.stderr || r.stdout).slice(0, 400), findings: [] });
      continue;
    }
    const fr = j.files?.[0] ?? { findings: [], diagnostics: [] };
    out.push({
      id: f.id,
      status: 'complete',
      note: fr.diagnostics?.length ? `${fr.diagnostics.length} diagnostics: ${fr.diagnostics.slice(0, 2).map((d) => d.message ?? JSON.stringify(d)).join(' | ').slice(0, 300)}` : '',
      findings: fr.findings.map((x) => ({
        rule: x.rule,
        severity: SEV[x.severity] ?? x.severity,
        native: x.severity,
        line: x.line,
        circuit: x.circuit ?? null,
        message: `${x.message} [${x.evidence?.detail ?? ''}]`,
        quantity: quantity(x.message),
        privacy: PRIVACY_RULES['compact-guard'].has(x.rule),
      })),
    });
  }
  return { tool: 'compact-guard', version, repo: 'https://github.com/KAMEVETRICS/compact-guard', configuration: 'all eight rules (default)', severityMap: 'error=high, warning=medium, review=low', command: 'compact-guard --format json --fail-on none <file>', files: out };
}

// ---------------------------------------------------------------- compact-lint

function runCompactLint(files) {
  const dir = path.join(TOOLS, 'compact-lint');
  const bin = path.join(dir, 'bin/cli.js');
  const version = `${JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version} (${git(dir, ['rev-parse', '--short', 'HEAD'])})`;
  const SEV = { error: 'high', warning: 'medium', review: 'low' };
  const out = [];
  for (const f of files) {
    process.stderr.write(`compact-lint ${f.id}\n`);
    const r = run('node', [bin, '--json', f.abs]);
    let j;
    try {
      j = JSON.parse(r.stdout);
    } catch {
      out.push({ id: f.id, status: 'error', note: (r.stderr || r.stdout).slice(0, 400), findings: [] });
      continue;
    }
    out.push({
      id: f.id,
      status: 'complete',
      findings: (j.findings ?? []).map((x) => ({
        rule: x.rule,
        severity: SEV[x.severity] ?? x.severity,
        native: x.severity,
        line: x.line,
        circuit: x.circuit ?? null,
        message: x.message,
        quantity: null,
        privacy: false,
      })),
    });
  }
  return { tool: 'compact-lint', version, repo: 'https://github.com/wbaxterh/compact-lint', configuration: 'default (one rule)', severityMap: 'error=high, warning=medium, review=low', command: 'compact-lint --json <file>', files: out };
}

// ---------------------------------------------------------------- OpenZeppelin

function runOz(files) {
  const bin = path.join(TOOLS, 'compact-scanner/compact-scanner');
  const meta = JSON.parse(run(bin, ['metadata']).stdout);
  const sev = Object.fromEntries(meta.detectors.map((d) => [d.id, d.report?.severity ?? 'medium']));
  const out = [];
  for (const f of files) {
    process.stderr.write(`oz-detectors ${f.id}\n`);
    const r = run(bin, ['scan', f.abs]);
    let j;
    try {
      j = JSON.parse(r.stdout);
    } catch {
      out.push({ id: f.id, status: 'error', note: (r.stderr || r.stdout).slice(0, 400), findings: [] });
      continue;
    }
    const src = fs.readFileSync(f.abs, 'utf8');
    const findings = [];
    for (const [id, resp] of Object.entries(j.detector_responses ?? {}))
      for (const fd of resp.findings ?? [])
        for (const inst of fd.instances ?? [])
          findings.push({
            rule: id,
            severity: sev[id] ?? 'medium',
            native: sev[id] ?? 'medium',
            line: lineOf(src, inst.offset_start),
            circuit: inst.extra?.metavars?.PARENT_NAME ?? null,
            message: JSON.stringify(inst.extra?.metavars ?? {}).slice(0, 300),
            quantity: null,
            privacy: false,
          });
    out.push({ id: f.id, status: j.errors?.length ? 'incomplete' : 'complete', note: j.errors?.length ? JSON.stringify(j.errors).slice(0, 300) : '', findings });
  }
  return { tool: 'oz-detectors', version: `compact-scanner ${meta.version} (release v0.0.3 binary)`, repo: 'https://github.com/OpenZeppelin/compact-security-detectors-sdk', configuration: `all detectors (${meta.detectors.map((d) => d.id).join(', ')})`, command: 'compact-scanner scan <file>', files: out };
}

// ---------------------------------------------------------------- main

const files = corpus();
fs.mkdirSync(path.join(BENCH, 'results'), { recursive: true });
for (const t of tools) {
  const t0 = Date.now();
  let res;
  if (t === 'tell' || t === 'tell-policy') res = runTell(files, t);
  else if (t.startsWith('nightshade')) res = runNightshade(files, t);
  else if (t === 'compact-guard') res = runCompactGuard(files);
  else if (t === 'compact-lint') res = runCompactLint(files);
  else if (t === 'oz-detectors') res = runOz(files);
  else throw new Error(`unknown tool ${t}`);
  res.seconds = Math.round((Date.now() - t0) / 1000);
  res.corpus = { sets, examplesCommit: sets.includes('examples') ? EXAMPLES_COMMIT : undefined };
  // merge with an existing result file so a partial run (--sets) does not drop other sets
  const file = path.join(BENCH, 'results', `${t}.json`);
  if (fs.existsSync(file)) {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ids = new Set(res.files.map((x) => x.id));
    res.files = [...old.files.filter((x) => !ids.has(x.id)), ...res.files].sort((a, b) => a.id.localeCompare(b.id));
    res.corpus.sets = [...new Set([...(old.corpus?.sets ?? []), ...sets])];
    if (old.corpus?.examplesCommit) res.corpus.examplesCommit = old.corpus.examplesCommit;
  }
  // keep local paths out of the committed results
  const clean = JSON.stringify(res, null, 2).split(WORK).join('<work>').split(ROOT).join('<repo>').split(os.homedir()).join('~');
  fs.writeFileSync(file, clean + '\n');
  const n = res.files.reduce((a, x) => a + x.findings.length, 0);
  process.stderr.write(`${t}: ${res.files.length} files, ${n} findings, ${res.seconds}s -> ${path.relative(ROOT, file)}\n`);
}
