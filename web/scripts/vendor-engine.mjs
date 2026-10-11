// Copies the analysis engine into web/vendor/engine so the site builds on its own (Vercel builds this folder alone).
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const src = path.resolve(here, '../../engine/src');
const dst = path.resolve(here, '../vendor/engine');
if (!fs.existsSync(src)) { console.log('engine source not present; using vendored copy'); process.exit(0); }
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) if (f.endsWith('.ts') && f !== 'cli.ts') fs.copyFileSync(path.join(src, f), path.join(dst, f));
fs.writeFileSync(path.join(dst, 'README.md'), 'Generated copy of ../../engine/src (scripts/vendor-engine.mjs). Edit the engine there, not here.\n');
console.log('engine vendored');
