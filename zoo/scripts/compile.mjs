// Compiles every zoo contract into managed/<name>. Pass --keys to also build proving keys.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const keys = process.argv.includes('--keys');
const dir = path.resolve('contracts');
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.compact'))) {
  const name = f.replace('.compact', '');
  const args = ['compile', '+0.31.1', ...(keys ? [] : ['--skip-zk']), path.join(dir, f), path.resolve('managed', name)];
  process.stdout.write(`compact ${name}… `);
  execFileSync('compact', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('ok');
}
