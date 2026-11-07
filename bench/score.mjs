#!/usr/bin/env node
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Scores bench/results/<tool>.json against the ground truth (bench/truth.json and
// the header of each bench case) and the hand labels (bench/labels/labels.json).
// Writes bench/results/scores.json and bench/results/scores.md.
//
//   node bench/score.mjs            # score
//   node bench/score.mjs --todo     # list findings that still need a hand label

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(BENCH);
const TOOLS = ['tell', 'nightshade', 'nightshade-all', 'nightshade-policy', 'compact-guard', 'compact-lint', 'oz-detectors'];
const SEV = ['critical', 'high', 'medium', 'low', 'info'];
const atLeast = (s, t) => SEV.indexOf(s) <= SEV.indexOf(t);
const family = (t) => (t.startsWith('nightshade') ? 'nightshade' : t);

const truthZoo = JSON.parse(fs.readFileSync(path.join(BENCH, 'truth.json'), 'utf8')).zoo;
const labels = JSON.parse(fs.readFileSync(path.join(BENCH, 'labels/labels.json'), 'utf8'));
const results = Object.fromEntries(
  TOOLS.filter((t) => fs.existsSync(path.join(BENCH, 'results', `${t}.json`))).map((t) => [t, JSON.parse(fs.readFileSync(path.join(BENCH, 'results', `${t}.json`), 'utf8'))]),
);

// ---------------------------------------------------------------- ground truth

function sourceOf(id) {
  if (id.startsWith('zoo/')) return fs.readFileSync(path.join(ROOT, 'zoo/contracts', id.slice(4)), 'utf8');
  if (id.startsWith('cases/')) return fs.readFileSync(path.join(BENCH, id), 'utf8');
  return null;
}

// lines [from, to] of the circuit or constructor that contains line `ln`
function spanOf(src, ln) {
  const lines = src.split('\n');
  let start = ln - 1;
  while (start >= 0 && !/^\s*(export\s+)?(pure\s+)?(circuit\s+\w+|constructor\s*\()/.test(lines[start])) start--;
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i].replace(/\/\/.*$/, '')) {
      if (ch === '{') (depth++, (seen = true));
      if (ch === '}') depth--;
    }
    if (seen && depth === 0) return [start + 1, i + 1];
  }
  return [start + 1, lines.length];
}

function truthOf(id) {
  const src = sourceOf(id);
  if (!src) return null;
  if (id.startsWith('zoo/')) {
    const t = truthZoo[id];
    if (t.truth !== 'leak') return { truth: t.truth };
    const line = src.split('\n').findIndex((l) => l.includes(t.pattern)) + 1;
    return { ...t, line, span: spanOf(src, line) };
  }
  const h = Object.fromEntries([...src.matchAll(/^\/\/ (truth|class|circuit|line|why): (.*)$/gm)].map((m) => [m[1], m[2].trim()]));
  const out = { truth: h.truth, class: h.class, circuit: h.circuit, why: h.why };
  if (h.line && h.line !== 'none') {
    out.line = Number(h.line);
    out.span = spanOf(src, out.line);
  }
  return out;
}

// ---------------------------------------------------------------- labelling

const keyOf = (tool, id, f) => `${family(tool)}|${id}|${f.rule}|${f.line ?? ''}`;

// The most severe finding on the planted leak is the TP; any others on it are duplicates.
function label(tool, file, truth, findings) {
  const out = findings.map((f) => {
    const manual = labels.findings[keyOf(tool, file.id, f)];
    let lab = manual?.label;
    if (!lab && truth?.truth === 'leak' && f.privacy) {
      const inSpan = f.line != null ? f.line >= truth.span[0] && f.line <= truth.span[1] : f.circuit === truth.circuit;
      if (inSpan) lab = 'tp';
    }
    return { ...f, label: lab ?? 'unlabelled', leak: manual?.leak };
  });
  const tps = out.filter((f) => f.label === 'tp').sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity));
  for (const f of tps.slice(1)) f.label = 'dup';
  return out;
}

// ---------------------------------------------------------------- scoring

const todo = [];
const scores = {};
for (const [tool, res] of Object.entries(results)) {
  const s = (scores[tool] = { version: res.version, configuration: res.configuration, labelled: {}, examples: {}, matrix: {}, coverage: {} });
  for (const set of ['labelled', 'examples']) {
    const files = res.files.filter((f) => (set === 'labelled' ? !f.id.startsWith('examples/') : f.id.startsWith('examples/')));
    s.coverage[set] = { files: files.length, complete: files.filter((f) => f.status === 'complete').length, incomplete: files.filter((f) => f.status === 'incomplete').length, error: files.filter((f) => f.status === 'error').length, adjusted: files.filter((f) => f.adjusted).length };
    for (const th of ['medium', 'all']) {
      const keep = (f) => th === 'all' || atLeast(f.severity, th);
      const m = { tp: 0, fn: 0, fp: 0, realOther: 0, intended: 0, realPrivacyExtra: 0, findings: 0, quantified: 0, demonstrated: 0, leaky: 0, safe: 0, safeClean: 0, leaks: new Set() };
      for (const file of files) {
        const truth = set === 'labelled' ? truthOf(file.id) : null;
        const lab = label(tool, file, truth, file.findings).filter(keep);
        for (const f of lab) if (f.label === 'unlabelled' && (set === 'labelled' || atLeast(f.severity, 'medium'))) todo.push({ tool, id: file.id, f });
        m.findings += lab.length;
        m.fp += lab.filter((f) => f.label === 'false-alarm').length;
        m.realOther += lab.filter((f) => f.label === 'real-other').length;
        m.intended += lab.filter((f) => f.label === 'intended').length;
        m.realPrivacyExtra += lab.filter((f) => f.label === 'real-privacy').length;
        for (const f of lab) if ((f.label === 'real-privacy' || f.label === 'tp') && f.leak) m.leaks.add(f.leak);
        if (truth?.truth === 'leak') {
          m.leaky++;
          const hit = lab.find((f) => f.label === 'tp');
          if (hit) {
            m.tp++;
            if (lab.some((f) => (f.label === 'tp' || f.label === 'dup') && f.quantity)) m.quantified++;
            if (truth.attackTest && family(tool) === 'tell') m.demonstrated++;
          } else m.fn++;
          if (th === 'medium') s.matrix[file.id] = hit ? `TP ${hit.severity}` : (label(tool, file, truth, file.findings).find((f) => f.label === 'tp') ? `low: ${label(tool, file, truth, file.findings).find((f) => f.label === 'tp').severity}` : 'missed');
        } else if (truth) {
          m.safe++;
          const bad = lab.filter((f) => f.label === 'false-alarm');
          if (!bad.length) m.safeClean++;
          if (th === 'medium') {
            const all = label(tool, file, truth, file.findings);
            const fa = all.filter((f) => f.label === 'false-alarm');
            s.matrix[file.id] = fa.some((f) => atLeast(f.severity, 'medium')) ? `FP ${fa.filter((f) => atLeast(f.severity, 'medium')).map((f) => f.rule).join(', ')}` : fa.length ? `clean (${fa.length} low/info)` : truth.truth === 'nonprivacy' && all.some((f) => f.label === 'real-other') ? `bug found (${all.find((f) => f.label === 'real-other').severity})` : 'clean';
          }
        }
        if (file.status !== 'complete' && th === 'medium') s.matrix[file.id] = `${s.matrix[file.id] ?? ''} [${file.status}]`.trim();
      }
      m.leaks = [...m.leaks].sort();
      s[set][th] = m;
    }
  }
}

if (process.argv.includes('--todo')) {
  const seen = new Set();
  for (const { tool, id, f } of todo) {
    const k = keyOf(tool, id, f);
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`${k}\t${f.severity}\t${f.message.slice(0, 160)}`);
  }
  console.log(`${seen.size} findings need a label`);
  process.exit(0);
}
if (todo.length) {
  console.error(`${new Set(todo.map(({ tool, id, f }) => keyOf(tool, id, f))).size} findings have no label; run with --todo`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------- report

const ids = [...new Set(Object.values(results).flatMap((r) => r.files.map((f) => f.id)))].sort();
const labelledIds = ids.filter((i) => !i.startsWith('examples/'));
const allLeaks = [...new Set(Object.values(scores).flatMap((s) => [...s.examples.medium.leaks]))].sort();
const T = Object.keys(scores);
const md = [];
md.push('## Labelled set (zoo + bench cases), medium and above\n');
md.push('| Tool | Leaks found (TP) | Missed (FN) | False alarms (FP) | Safe files with no false alarm | Real non-privacy findings | Leak quantified | Leak shown by a shipped attack test |');
md.push('|---|---|---|---|---|---|---|---|');
for (const t of T) {
  const m = scores[t].labelled.medium;
  md.push(`| ${t} | ${m.tp} / ${m.leaky} | ${m.fn} | ${m.fp} | ${m.safeClean} / ${m.safe} | ${m.realOther} | ${m.quantified} / ${m.tp} | ${m.demonstrated} |`);
}
md.push('\n## Labelled set, all severities (info and low included)\n');
md.push('| Tool | Leaks found (TP) | Missed (FN) | False alarms (FP) | Safe files with no false alarm | Real non-privacy findings | Findings in total |');
md.push('|---|---|---|---|---|---|---|');
for (const t of T) {
  const m = scores[t].labelled.all;
  md.push(`| ${t} | ${m.tp} / ${m.leaky} | ${m.fn} | ${m.fp} | ${m.safeClean} / ${m.safe} | ${m.realOther} | ${m.findings} |`);
}
md.push(`\n## Midnight examples (${scores[T[0]]?.coverage.examples.files ?? 0} contracts at 377495c), medium and above, hand-labelled\n`);
md.push(`Distinct real privacy leaks found by any tool: ${allLeaks.length} (${allLeaks.join(', ') || 'none'}).\n`);
md.push('| Tool | Analysis complete | Findings (medium+) | Real privacy leak | Intended disclosure | Real non-privacy | False alarm | Distinct privacy leaks found | Findings, all severities |');
md.push('|---|---|---|---|---|---|---|---|---|');
for (const t of T) {
  const m = scores[t].examples.medium;
  const c = scores[t].coverage.examples;
  const priv = m.findings - m.realOther - m.fp - m.intended;
  md.push(`| ${t} | ${c.complete} / ${c.files}${c.adjusted ? ` (${c.adjusted} pragma-adjusted)` : ''} | ${m.findings} | ${priv} | ${m.intended} | ${m.realOther} | ${m.fp} | ${m.leaks.length} / ${allLeaks.length} | ${scores[t].examples.all.findings} |`);
}
md.push('\n## Per-file matrix (labelled set, medium and above)\n');
md.push(`| File | Truth | ${T.join(' | ')} |`);
md.push(`|---|---|${T.map(() => '---').join('|')}|`);
for (const id of labelledIds) {
  const tr = truthOf(id);
  md.push(`| ${id.replace(/\.compact$/, '')} | ${tr.truth}${tr.class ? ` (${tr.class})` : ''} | ${T.map((t) => scores[t].matrix[id] ?? '').join(' | ')} |`);
}
md.push('\n## Ground truth of the labelled set\n');
md.push('| File | Truth | Class | Circuit | Why |');
md.push('|---|---|---|---|---|');
for (const id of labelledIds) {
  const tr = truthOf(id);
  md.push(`| ${id.replace(/\.compact$/, '')} | ${tr.truth} | ${tr.class ?? ''} | ${tr.circuit ?? ''} | ${(tr.why ?? '').replace(/\|/g, '\\|')} |`);
}
fs.writeFileSync(path.join(BENCH, 'results/scores.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(BENCH, 'results/scores.json'), JSON.stringify(scores, null, 2) + '\n');
console.log(md.join('\n'));
