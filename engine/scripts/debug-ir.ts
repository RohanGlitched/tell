// Analyses an IR file written by ir-dump.ts and prints every finding.
//   npx tsx scripts/debug-ir.ts ir.txt [source.compact]
import fs from 'node:fs';
import { analyzeIr } from '../src/index.js';

const [irFile, srcFile] = process.argv.slice(2);
const r = analyzeIr(fs.readFileSync(irFile, 'utf8'), srcFile ? fs.readFileSync(srcFile, 'utf8') : undefined);
console.log(`${r.circuits.length} circuits${r.unknownForms.length ? `, unknown forms: ${r.unknownForms.join(', ')}` : ''}`);
for (const f of r.findings)
  console.log(`  [${f.severity}] ${f.circuit}:${f.line ?? '?'} ${f.kind} ${(f.fields ?? [f.field + '.' + f.op]).join(',')} <- ${f.sources.map((s) => `${s.kind === 'argument' ? 'arg ' : ''}${s.name}:${s.type}`).join(', ')} (${f.bits}b) ${f.title}`);
