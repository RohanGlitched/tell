// Regenerates test/fixtures/r2c/*.txt from the zoo and the bundled sample sources.
//   npx tsx scripts/fixtures.ts            everything
//   npx tsx scripts/fixtures.ts name…      only these (file names without .compact)
import fs from 'node:fs';
import path from 'node:path';
import { compileForAnalysis } from '../src/compile.js';

const out = 'test/fixtures/r2c';
const only = process.argv.slice(2);
// Ledger 8 zoo, Ledger 9 zoo (events, contract calls), then the samples and review cases.
const zoo = ['../zoo/contracts', '../zoo/ledger9/contracts'].filter((d) => fs.existsSync(d));
const zooFiles = zoo.flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f)));
const files = [
  ...zooFiles,
  ...fs.readdirSync('test/fixtures/src').filter((f) => !zooFiles.some((z) => path.basename(z) === f)).map((f) => path.join('test/fixtures/src', f)),
].filter((f) => only.length === 0 || only.includes(path.basename(f, '.compact')));
for (const f of files) {
  const r = await compileForAnalysis(f);
  const name = path.basename(f, '.compact');
  if (!r.ok) {
    console.log(`skip ${name}: ${r.error.split('\n')[0]}`);
    continue;
  }
  fs.writeFileSync(path.join(out, name + '.txt'), r.ir);
  if (f.includes('zoo')) fs.copyFileSync(f, path.join('test/fixtures/src', name + '.compact'));
  console.log(`ok ${name} (${r.compiler.version})`);
}
