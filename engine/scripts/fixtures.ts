// Regenerates test/fixtures/r2c/*.txt from the zoo and the bundled sample sources.
import fs from 'node:fs';
import path from 'node:path';
import { compileForAnalysis } from '../src/compile.js';

const out = 'test/fixtures/r2c';
const files = [
  ...fs.readdirSync('../zoo/contracts').map((f) => path.join('../zoo/contracts', f)),
  ...fs.readdirSync('test/fixtures/src').filter((f) => !fs.existsSync(path.join('../zoo/contracts', f))).map((f) => path.join('test/fixtures/src', f)),
];
for (const f of files) {
  const r = await compileForAnalysis(f);
  const name = path.basename(f, '.compact');
  if (!r.ok) {
    console.log(`skip ${name}: ${r.error.split('\n')[0]}`);
    continue;
  }
  fs.writeFileSync(path.join(out, name + '.txt'), r.ir);
  if (f.includes('zoo')) fs.copyFileSync(f, path.join('test/fixtures/src', name + '.compact'));
  console.log(`ok ${name}`);
}
