// Precomputes the scanner's sample results so the "Try" buttons answer at once,
// even on a cold server. Rerun after any engine change (run from WSL, where the
// Compact compilers are installed):  npx tsx web/scripts/sample-results.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCompilers, scanFile } from '../../engine/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples: { id: string; source: string }[] = JSON.parse(fs.readFileSync(path.join(here, '../data/samples.json'), 'utf8'));
// The compilers the website bundles (scripts/fetch-compilers.mjs): results must match a live scan.
const BUNDLED = ['0.35.0', '0.34.0', '0.31.1', '0.30.0', '0.29.0'];
const compilers = (await findCompilers()).filter((c) => BUNDLED.includes(c.version));
const out: Record<string, unknown> = {};
for (const s of samples) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-sample-'));
  const file = path.join(dir, 'contract.compact');
  fs.writeFileSync(file, s.source);
  const t = Date.now();
  const r = await scanFile(file, compilers);
  const ms = Date.now() - t;
  r.file = 'contract.compact';
  fs.rmSync(dir, { recursive: true, force: true });
  out[crypto.createHash('sha256').update(s.source).digest('hex')] = { kind: 'source', contracts: [r], compilers: BUNDLED, ms, precomputed: true };
  console.log(`${s.id}: ${r.grade ?? 'failed'}`);
}
fs.writeFileSync(path.join(here, '../data/sample-results.json'), JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
