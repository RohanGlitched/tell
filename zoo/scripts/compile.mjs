// Compiles every zoo contract into managed/<name>. Pass --keys to also build proving keys.
// Ledger 8 contracts (contracts/) use Compact 0.31.1; Ledger 9 contracts (ledger9/contracts/:
// events, cross-contract calls) need 0.36.0 and land in ledger9/managed/<name>.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const keys = process.argv.includes('--keys');
const sets = [
  { dir: path.resolve('contracts'), out: path.resolve('managed'), compiler: '+0.31.1' },
  { dir: path.resolve('ledger9', 'contracts'), out: path.resolve('ledger9', 'managed'), compiler: '+0.36.0' },
];
for (const { dir, out, compiler } of sets) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.compact'))) {
    const name = f.replace('.compact', '');
    const args = ['compile', compiler, ...(keys ? [] : ['--skip-zk']), path.join(dir, f), path.join(out, name)];
    process.stdout.write(`compact ${compiler} ${name}… `);
    execFileSync('compact', args, { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log('ok');
  }
}
