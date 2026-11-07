// Prints the IR Tell analyses for one contract (reduce-to-circuit, plus the constructor), as the
// compiler that the pragma picks produced it.
//   npx tsx scripts/ir-dump.ts path/to/contract.compact [--compiler 0.36.0] > ir.txt
import { compileForAnalysis, findCompilers } from '../src/compile.js';

const file = process.argv[2];
const want = process.argv.includes('--compiler') ? process.argv[process.argv.indexOf('--compiler') + 1] : null;
const compilers = (await findCompilers()).filter((c) => !want || c.version === want);
const r = await compileForAnalysis(file, compilers);
if (!r.ok) {
  console.error(r.error);
  process.exit(1);
}
console.error(`compiled with ${r.compiler.version}`);
process.stdout.write(r.ir);
