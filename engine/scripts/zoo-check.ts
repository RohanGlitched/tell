// Scans the leak zoo and checks each contract on its own: every leaky contract must have a
// finding at medium or worse, every fix must have none. Used by CI across compiler versions.
//   npx tsx scripts/zoo-check.ts                     the compiler each pragma picks
//   npx tsx scripts/zoo-check.ts --compiler 0.35.0   one compiler, the pragma rewritten to its language
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCompilers, scanFile } from '../src/index.js';

const dir = '../zoo/contracts';
const want = process.argv.includes('--compiler') ? process.argv[process.argv.indexOf('--compiler') + 1] : null;
let compilers = await findCompilers();
if (want) {
  compilers = compilers.filter((c) => c.version === want);
  if (!compilers.length) throw new Error(`compiler ${want} is not installed`);
}
const lang = want ? compilers[0].language.split('.').slice(0, 2).join('.') : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-zoo-'));
let failed = 0;
for (const f of fs.readdirSync(dir).sort()) {
  let file = path.join(dir, f);
  if (lang) {
    file = path.join(tmp, f);
    fs.writeFileSync(file, fs.readFileSync(path.join(dir, f), 'utf8').replace(/pragma language_version [^;]+;/, `pragma language_version ${lang};`));
  }
  const r = await scanFile(file, compilers);
  const serious = (r.report?.findings ?? []).filter((x) => !x.suppressed && ['critical', 'high', 'medium'].includes(x.severity));
  const leaky = f.includes('-leaky');
  const ok = r.ok && (leaky ? serious.length > 0 : serious.length === 0);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(24)} grade ${r.grade ?? '-'}  compiler ${r.compiler ?? '-'}  ${serious.map((x) => `${x.severity} ${x.kind}`).join(', ') || 'nothing at medium or worse'}`);
}
process.exit(failed ? 1 : 0);
