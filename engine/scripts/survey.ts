// Scans every cloned repository under a directory and writes one JSON result
// per repository, pinned to the commit that was scanned.
//   npx tsx scripts/survey.ts ~/mn/survey ../survey/results.json
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findCompilers, findContracts, scanFile, type ContractResult } from '../src/index.js';

const [root, outFile] = process.argv.slice(2);
const compilers = await findCompilers();
console.log(`compilers: ${compilers.map((c) => `${c.version} (lang ${c.language})`).join(', ')}`);

type RepoResult = { repo: string; commit: string | null; contracts: ContractResult[] };
const prev: RepoResult[] = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];
const done = new Map(prev.map((r) => [r.repo, r]));
const results: RepoResult[] = [];

for (const d of fs.readdirSync(root).sort()) {
  const dir = path.join(root, d);
  if (!fs.statSync(dir).isDirectory() || !fs.existsSync(path.join(dir, '.git'))) continue;
  const repo = d.replace('__', '/');
  let commit: string | null = null;
  try {
    commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    /* not a git checkout */
  }
  const cached = done.get(repo);
  if (cached && cached.commit === commit) {
    results.push(cached);
    continue;
  }
  const files = findContracts(dir);
  const contracts: ContractResult[] = [];
  for (const f of files) {
    const r = await scanFile(f, compilers);
    r.file = path.relative(dir, f).split(path.sep).join('/');
    contracts.push(r);
  }
  results.push({ repo, commit, contracts });
  const worst = contracts.map((c) => c.grade ?? (c.ok ? '?' : 'x')).join('');
  console.log(`${repo.padEnd(56)} ${String(files.length).padStart(3)} contracts  ${worst}`);
  fs.writeFileSync(outFile, JSON.stringify(results, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
}
fs.writeFileSync(outFile, JSON.stringify(results, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
console.log(`wrote ${results.length} repositories`);
