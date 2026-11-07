// Compiles every bundled contract (the zoo and test/fixtures/src) with two compilers and compares
// what Tell reports. Used when a new compiler ships: any difference is an IR change to look at.
//   npx tsx scripts/compiler-diff.ts 0.31.1 0.36.0
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCompilers, scanFile, type ContractResult } from '../src/index.js';

const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('usage: compiler-diff.ts <version> <version>');
const all = await findCompilers();
const pick = (v: string) => {
  const c = all.filter((x) => x.version === v);
  if (!c.length) throw new Error(`compiler ${v} is not installed (compact update ${v})`);
  return c;
};
const ca = pick(a);
const cb = pick(b);
const files = [
  ...fs.readdirSync('../zoo/contracts').map((f) => path.join('../zoo/contracts', f)),
  ...fs.readdirSync('test/fixtures/src').filter((f) => !fs.existsSync(path.join('../zoo/contracts', f))).map((f) => path.join('test/fixtures/src', f)),
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-diff-'));
// Same source, with the pragma each compiler's language accepts.
const scanWith = async (f: string, cs: typeof ca): Promise<ContractResult> => {
  const lang = cs[0].language.split('.').slice(0, 2).join('.');
  const d = fs.mkdtempSync(path.join(tmp, 'c-'));
  const file = path.join(d, path.basename(f));
  fs.writeFileSync(file, fs.readFileSync(f, 'utf8').replace(/pragma language_version [^;]+;/, `pragma language_version ${lang};`));
  return scanFile(file, cs);
};
const sig = (r: ContractResult) =>
  (r.report?.findings ?? [])
    .filter((f) => f.severity !== 'info')
    .map((f) => `${f.circuit}/${f.kind}/${f.severity}/${f.field}`)
    .sort();
let differ = 0;
for (const f of files) {
  const [ra, rb] = [await scanWith(f, ca), await scanWith(f, cb)];
  const name = path.basename(f, '.compact').padEnd(24);
  if (!ra.ok || !rb.ok) {
    console.log(`skip ${name} ${a}: ${ra.ok ? 'ok' : ra.error?.split('\n')[0]}  ${b}: ${rb.ok ? 'ok' : rb.error?.split('\n')[0]}`);
    continue;
  }
  const [sa, sb] = [sig(ra), sig(rb)];
  const unknown = [...new Set([...(ra.report!.unknownForms ?? []), ...(rb.report!.unknownForms ?? [])])];
  const same = JSON.stringify(sa) === JSON.stringify(sb) && unknown.length === 0;
  if (!same) differ++;
  console.log(`${same ? 'same' : 'DIFF'} ${name} ${ra.grade}/${rb.grade}  ${sa.length} findings above info${unknown.length ? `  unknown forms: ${unknown.join(', ')}` : ''}`);
  if (!same) {
    for (const x of sa.filter((x) => !sb.includes(x))) console.log(`       only ${a}: ${x}`);
    for (const x of sb.filter((x) => !sa.includes(x))) console.log(`       only ${b}: ${x}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${differ} contract${differ === 1 ? '' : 's'} differ`);
process.exit(differ ? 1 : 0);
