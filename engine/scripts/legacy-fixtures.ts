// Writes test/fixtures/r2c-legacy/*.txt: the zoo compiled with an older compiler (0.30.0),
// whose reduce-to-circuit output uses the older binding shape. Tests check both agree.
//   npx tsx scripts/legacy-fixtures.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileForAnalysis, findCompilers } from '../src/compile.js';

const out = 'test/fixtures/r2c-legacy';
fs.mkdirSync(out, { recursive: true });
const old = (await findCompilers()).filter((c) => c.version === '0.30.0');
if (!old.length) throw new Error('compiler 0.30.0 is not installed (compact update 0.30.0)');
for (const f of fs.readdirSync('../zoo/contracts')) {
  // Same source, with the pragma the older compiler accepts.
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tell-legacy-')), f);
  fs.writeFileSync(tmp, fs.readFileSync(path.join('../zoo/contracts', f), 'utf8').replace(/pragma language_version [^;]+;/, 'pragma language_version 0.22;'));
  const r = await compileForAnalysis(tmp, old);
  if (!r.ok) throw new Error(`${f}: ${r.error}`);
  fs.writeFileSync(path.join(out, f.replace('.compact', '.txt')), r.ir);
  console.log(`ok ${f} with ${r.compiler}`);
}
