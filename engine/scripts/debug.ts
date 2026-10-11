import fs from 'node:fs';
import path from 'node:path';
import { readProgram } from '../src/ir.js';
import { analyze } from '../src/analyze.js';
const dir = 'test/fixtures';
const only = process.argv[2];
for (const f of fs.readdirSync(path.join(dir, 'r2c'))) {
  const name = f.replace('.txt', '');
  if (only && name !== only) continue;
  const text = fs.readFileSync(path.join(dir, 'r2c', f), 'utf8');
  if (!text.includes('(program')) { console.log(`\n## ${name}: no program`); continue; }
  const src = fs.existsSync(path.join(dir, 'src', name + '.compact')) ? fs.readFileSync(path.join(dir, 'src', name + '.compact'), 'utf8') : undefined;
  const r = analyze(readProgram(text), { sourceText: src });
  console.log(`\n## ${name}: ${r.circuits.length} circuits, ${r.findings.length} findings${r.unknownForms.length ? ' UNKNOWN ' + r.unknownForms.join(' ') : ''}`);
  for (const f of r.findings.filter((f) => f.severity !== 'info' || only)) console.log(`  [${f.severity}] ${f.circuit}:${f.line ?? '?'} ${f.kind} ${f.field}.${f.op} <- ${f.sources.map((s) => s.name + ':' + s.type).join(',')} (${f.bits}b) ${f.title}`);
}
