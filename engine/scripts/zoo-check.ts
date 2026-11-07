// Scans the leak zoo and checks each contract on its own: every leaky contract must have a
// finding at medium or worse, every fix must have none. Used by CI across compiler versions.
//   npx tsx scripts/zoo-check.ts                     the compiler each pragma picks
//   npx tsx scripts/zoo-check.ts --compiler 0.35.0   one compiler, the pragma rewritten to its language
// Ledger 9 contracts (zoo/ledger9/contracts: events, cross-contract calls) need language 0.25
// (Compact 0.33) or later; with an older compiler they are skipped and say so. With 0.34+ the
// one source change that compiler needs is made too (see port() below).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCompilers, scanFile } from '../src/index.js';

const dirs = ['../zoo/contracts', '../zoo/ledger9/contracts'].filter((d) => fs.existsSync(d));
const want = process.argv.includes('--compiler') ? process.argv[process.argv.indexOf('--compiler') + 1] : null;
let compilers = await findCompilers();
if (want) {
  compilers = compilers.filter((c) => c.version === want);
  if (!compilers.length) throw new Error(`compiler ${want} is not installed`);
}
const lang = want ? compilers[0].language.split('.').slice(0, 2).join('.') : null;
const ledger9 = !want || Number(lang!.split('.')[1]) >= 25;
const minor = lang ? Number(lang.split('.')[1]) : 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-zoo-'));

// Compact 0.34.0 (language 0.26) changed ecMulGenerator to take a JubjubScalar instead of a Field,
// and JubjubScalar is not a name before it, so no single source compiles under both 0.31 and 0.34+.
// The zoo is written for language 0.23 (the ledger live today); for 0.26 and later the argument
// gets the cast a contract on the newer compiler writes, ecMulGenerator(k as JubjubScalar). The key
// derivation, and the leak in keyring-leaky, are the same: the contract must still be caught.
function port(src: string): string {
  if (minor < 26) return src;
  let out = '';
  let i = 0;
  for (let at = src.indexOf('ecMulGenerator(', i); at >= 0; at = src.indexOf('ecMulGenerator(', i)) {
    const open = at + 'ecMulGenerator('.length;
    let depth = 1;
    let j = open;
    for (; j < src.length && depth; j++) depth += src[j] === '(' ? 1 : src[j] === ')' ? -1 : 0;
    const arg = src.slice(open, j - 1);
    out += `${src.slice(i, open)}(${port(arg)}) as JubjubScalar)`;
    i = j;
  }
  return out + src.slice(i);
}
let failed = 0;
for (const dir of dirs) {
  const l9 = dir.includes('ledger9');
  for (const f of fs.readdirSync(dir).sort()) {
    if (l9 && !ledger9) {
      console.log(`skip ${f.padEnd(24)} Ledger 9 contract; compiler ${want} predates events and contract calls`);
      continue;
    }
    let file = path.join(dir, f);
    if (lang) {
      file = path.join(tmp, f);
      fs.writeFileSync(file, port(fs.readFileSync(path.join(dir, f), 'utf8').replace(/pragma language_version [^;]+;/, `pragma language_version ${lang};`)));
    }
    const r = await scanFile(file, compilers);
    const serious = (r.report?.findings ?? []).filter((x) => !x.suppressed && ['critical', 'high', 'medium'].includes(x.severity));
    const leaky = f.includes('-leaky');
    const ok = r.ok && (leaky ? serious.length > 0 : serious.length === 0);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(24)} grade ${r.grade ?? '-'}  compiler ${r.compiler ?? '-'}  ${r.ok ? serious.map((x) => `${x.severity} ${x.kind}`).join(', ') || 'nothing at medium or worse' : r.error?.split('\n').slice(0, 4).join(' / ')}`);
  }
}
process.exit(failed ? 1 : 0);
