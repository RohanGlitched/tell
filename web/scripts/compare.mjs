// Turns the head-to-head benchmark (bench/results/scores.json, made by `node bench/score.mjs`)
// into web/data/compare.json for the "How Tell compares" table. Run after a benchmark run:
//   node web/scripts/compare.mjs
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const src = path.resolve(here, '../../bench/results/scores.json');
const out = path.resolve(here, '../data/compare.json');
if (!fs.existsSync(src)) {
  console.log('bench results not present; keeping the committed compare.json');
  process.exit(0);
}
const scores = JSON.parse(fs.readFileSync(src, 'utf8'));
const NAMES = {
  tell: 'Tell',
  'tell-policy': 'Tell, with a one-line tell.json',
  nightshade: 'Nightshade, default',
  'nightshade-all': 'Nightshade, every rule',
  'nightshade-policy': 'Nightshade, secrets policy',
  'compact-guard': 'compact-guard',
  'compact-lint': 'compact-lint',
  'oz-detectors': 'OpenZeppelin detectors',
};
const rows = Object.entries(scores).map(([id, s]) => {
  const m = s.labelled?.medium ?? {};
  const a = s.labelled?.all ?? {};
  return {
    id,
    name: NAMES[id] ?? id,
    version: s.version ?? null,
    leaks: m.leaky ?? null,
    found: m.tp ?? null,
    falseAlarms: m.fp ?? null,
    safe: (m.safe ?? 0) || null,
    safeClean: m.safeClean ?? null,
    quantified: m.quantified ?? null,
    demonstrated: m.demonstrated ?? null,
    foundAnySeverity: a.tp ?? null,
  };
});
const stat = fs.statSync(src);
const commit = String(scores.tell?.version ?? '').match(/\(([0-9a-f]{7,})\)/)?.[1] ?? 'unknown commit';
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      source: 'bench/RESULTS.md',
      generatedFrom: 'bench/results/scores.json',
      runAt: stat.mtime.toISOString().slice(0, 10),
      // which Tell engine produced the numbers: the commit in the Tell row's version
      engine: `${process.env.TELL_BENCH_ENGINE ?? 'Wave 3 engine'} (${commit})`,
      engineNote: `Tell's row comes from the ${process.env.TELL_BENCH_ENGINE ?? 'Wave 3 engine'} (commit ${commit}). The first run, on the Wave 2 engine (d3a9104), is kept under History in bench/RESULTS.md.`,
      alsoRun: 'Tell also ran on Nightshade’s published regression corpus: 465 contracts, 443 analysed, 0 crashes (bench/RESULTS.md).',
      caveat:
        "Tell's author wrote this benchmark, the leak zoo is Tell's own development set, and the 30 cases were written knowing what Tell looks for; three of Tell's gains since the first run (L11, L12, L16) come from rules added after that run showed the misses. Read the labelled numbers as 'does each tool handle these patterns', not as a population accuracy. Most of the other tools also check things this benchmark does not measure.",
      corpus: '79 Compact files: Tell’s leak zoo (20: 10 leaky, 10 fixed), 30 cases written for the benchmark (15 leaky, 13 safe, 1 non-privacy bug, 1 value that is never public), 29 contracts from Midnight’s official examples',
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(`compare.json: ${rows.length} tools`);
