// Turns survey/results.json into the anonymized aggregate the website shows.
// Team names never leave this script: projects become "Project 01…", in a
// stable order, until a team agrees to be named.
//   npx tsx scripts/summarize.ts ../survey/results.json ../web/data/survey.json
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import type { Finding, Severity } from '../src/analyze.js';

type ContractResult = { file: string; ok: boolean; error?: string; grade?: string; compiler?: string; report?: { findings: Finding[]; circuits: { name: string }[] } };
type Repo = { repo: string; commit: string | null; contracts: ContractResult[] };

const [inFile, outFile] = process.argv.slice(2);
const repos: Repo[] = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const named = new Set<string>((process.env.TELL_NAMED ?? '').split(',').filter(Boolean));

const SEV: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const GENERIC: Record<string, string> = {
  'guessable-hash': 'A private value sits behind a hash with too few possible inputs; brute force recovers it',
  'secret-published': 'A secret key is written to the ledger in readable form',
  published: 'A private value is written to the ledger in readable form',
  branch: 'Which ledger operations run depends on private data (a branch or a count shows on chain)',
  attributable: 'Every repeated action stores the same tag derived from a key, so one user’s actions line up',
  linkable: 'The same tag derived from a key appears across transactions',
  predicate: 'A yes/no fact about private data is stored',
};
const rank = (g: string) => 'ABCDF'.indexOf(g);

const analyzed = repos.filter((r) => r.contracts.some((c) => c.ok));
const contracts = repos.flatMap((r) => r.contracts);
const ok = contracts.filter((c) => c.ok);

const failCause = (e = '') =>
  /No installed Compact compiler accepts/.test(e)
    ? 'targets a language version no released compiler supports'
    : /parse error|unbound identifier|incompatible|mismatch|no compatible function|disclosure must be declared/.test(e)
      ? 'does not compile with any compiler its pragma allows'
      : 'other';

const grades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
for (const r of analyzed) {
  const worst = r.contracts.filter((c) => c.ok).map((c) => c.grade!).sort((a, b) => rank(b) - rank(a))[0];
  grades[worst]++;
}

// How many projects show each kind of finding, at each severity.
const kinds: Record<string, Record<string, number>> = {};
for (const r of analyzed) {
  const seen = new Set<string>();
  for (const c of r.contracts) for (const f of c.report?.findings ?? []) if (!f.suppressed) seen.add(`${f.kind}|${f.severity}`);
  for (const k of seen) {
    const [kind, sev] = k.split('|');
    kinds[kind] ??= {};
    kinds[kind][sev] = (kinds[kind][sev] ?? 0) + 1;
  }
}

// Anonymized serious cases, in a stable order by repository name.
// Numbered in an order derived from a hash of the name, so a label does not hint at the team.
// The salt is a secret kept out of the repository (survey/.salt, gitignored), so the
// numbering cannot be recomputed from the public repo list. Without it, labels are random.
const saltFile = path.join(path.dirname(inFile), '.salt');
if (!fs.existsSync(saltFile)) fs.writeFileSync(saltFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const salt = fs.readFileSync(saltFile, 'utf8').trim();
const h = (x: string) => createHmac('sha256', salt).update(x).digest('hex');
const order = [...analyzed].sort((a, b) => h(a.repo).localeCompare(h(b.repo)));
const label = new Map(order.map((r, i) => [r.repo, named.has(r.repo) ? r.repo : `Project ${String(i + 1).padStart(2, '0')}`]));
const rawCases = order.flatMap((r) =>
  r.contracts.flatMap((c) =>
    (c.report?.findings ?? [])
      .filter((f) => !f.suppressed && SEV.indexOf(f.severity) <= 2)
      .map((f) => ({
        project: label.get(r.repo)!,
        severity: f.severity,
        kind: f.kind,
        circuit: named.has(r.repo) ? f.circuit : undefined,
        // Titles name functions and fields, which are searchable: unnamed projects get a generic line.
        title: named.has(r.repo) ? f.title : GENERIC[f.kind] ?? f.kind,
        bits: f.bits,
      })),
  ),
);

// One line per project and kind (several contracts often share a pattern).
const cases = Object.values(
  rawCases.reduce<Record<string, (typeof rawCases)[number] & { count: number }>>((acc, c) => {
    const k = `${c.project}|${c.kind}|${c.severity}`;
    acc[k] = acc[k] ? { ...acc[k], count: acc[k].count + 1, bits: Math.max(acc[k].bits, c.bits) } : { ...c, count: 1 };
    return acc;
  }, {}),
).sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || a.project.localeCompare(b.project));
const linkableProjects = analyzed.filter((r) => r.contracts.some((c) => c.report?.findings.some((f) => f.kind === 'linkable' || f.kind === 'attributable'))).length;
const publishedBits = ok.reduce((a, c) => a + (c.report?.findings ?? []).filter((f) => f.kind === 'published' && !f.suppressed).length, 0);

const out = {
  generatedAt: new Date().toISOString(),
  method: 'Every public GitHub repository linked from a Midnight Buildathon submission on AKINDO, cloned at its default branch and scanned with Tell. Compiler chosen per contract from its pragma, preferring 0.31.1 (the compiler for the ledger live today).',
  repositoriesListed: repos.length,
  repositoriesWithCompact: repos.filter((r) => r.contracts.length).length,
  projectsAnalyzed: analyzed.length,
  contractsFound: contracts.length,
  contractsAnalyzed: ok.length,
  contractsNotCompiled: Object.entries(
    contracts.filter((c) => !c.ok).reduce<Record<string, number>>((a, c) => ((a[failCause(c.error)] = (a[failCause(c.error)] ?? 0) + 1), a), {}),
  ).map(([cause, n]) => ({ cause, n })),
  grades,
  kinds,
  linkableProjects,
  publishedValues: publishedBits,
  cases,
  // One entry per analyzed project, anonymized: grade, contracts, and its worst finding.
  projects: order.map((r) => {
    const live = r.contracts.filter((c) => c.ok);
    const fs = live.flatMap((c) => (c.report?.findings ?? []).filter((f) => !f.suppressed));
    const worst = [...fs].sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity))[0];
    return {
      p: label.get(r.repo)!,
      grade: live.map((c) => c.grade!).sort((a, b) => rank(b) - rank(a))[0],
      worst: worst && SEV.indexOf(worst.severity) <= 3 ? { severity: worst.severity, kind: worst.kind } : null,
    };
  }),
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, cases: out.cases.length }, null, 2));
