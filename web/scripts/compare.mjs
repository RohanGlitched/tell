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
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      source: 'bench/RESULTS.md',
      generatedFrom: 'bench/results/scores.json',
      runAt: stat.mtime.toISOString().slice(0, 10),
      caveat:
        "Tell's author wrote this benchmark, the leak zoo is Tell's own development set, and the 30 cases were written knowing what Tell looks for. Read the labelled numbers as 'does each tool handle these patterns', not as a population accuracy. Most of the other tools also check things this benchmark does not measure.",
      corpus: '69 Compact files: the leak zoo (10), 30 cases written for the benchmark, 29 contracts from Midnight’s official examples',
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(`compare.json: ${rows.length} tools`);
