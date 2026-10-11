// Copies the two live demo contracts' generated code (no keys) and the deployment record into the web app.
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const keys = path.resolve(here, '../../zoo/keys');
for (const c of ['ballot-leaky', 'ballot-fixed']) {
  const src = path.join(keys, c, 'contract');
  if (!fs.existsSync(src)) continue;
  const dst = path.resolve(here, '../lib/contracts', c, 'contract');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['index.js', 'index.d.ts']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
// Preprod wins when both exist: it is where the live demo runs.
const out = path.resolve(here, '../data/deployments.json');
const pick = ['preprod', 'preview']
  .map((n) => [n, path.resolve(here, '../../chain', n === 'preview' ? 'deployments.json' : `deployments-${n}.json`)])
  .find(([, f]) => fs.existsSync(f) && Object.keys(JSON.parse(fs.readFileSync(f, 'utf8'))).length > 0);
if (pick) fs.writeFileSync(out, JSON.stringify({ network: pick[0], contracts: JSON.parse(fs.readFileSync(pick[1], 'utf8')) }, null, 2) + '\n');
else if (!fs.existsSync(out)) fs.writeFileSync(out, '{}\n');
console.log('contracts copied');
