// Writes the Ledger 8 zoo compiled with another compiler, so tests can check that findings do not
// depend on which compiler built the circuit:
//   npx tsx scripts/legacy-fixtures.ts                  0.30.0 -> test/fixtures/r2c-legacy (older binding shape)
//   npx tsx scripts/legacy-fixtures.ts 0.36.0 r2c-0.36  0.36.0 -> test/fixtures/r2c-0.36 (Ledger 9 compiler)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileForAnalysis, findCompilers } from '../src/compile.js';

const version = process.argv[2] ?? '0.30.0';
const out = path.join('test/fixtures', process.argv[3] ?? 'r2c-legacy');
fs.mkdirSync(out, { recursive: true });
const cs = (await findCompilers()).filter((c) => c.version === version);
if (!cs.length) throw new Error(`compiler ${version} is not installed (compact update ${version})`);
const lang = cs[0].language.split('.').slice(0, 2).join('.');
for (const f of fs.readdirSync('../zoo/contracts')) {
  // Same source, with the pragma this compiler accepts.
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tell-legacy-')), f);
  fs.writeFileSync(tmp, fs.readFileSync(path.join('../zoo/contracts', f), 'utf8').replace(/pragma language_version [^;]+;/, `pragma language_version ${lang};`));
  const r = await compileForAnalysis(tmp, cs);
  if (!r.ok) throw new Error(`${f}: ${r.error}`);
  fs.writeFileSync(path.join(out, f.replace('.compact', '.txt')), r.ir);
  console.log(`ok ${f} with ${r.compiler.version}`);
}
