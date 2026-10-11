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
const dep = path.resolve(here, '../../chain/deployments.json');
const out = path.resolve(here, '../data/deployments.json');
fs.writeFileSync(out, fs.existsSync(dep) ? fs.readFileSync(dep) : '{}\n');
console.log('contracts copied');
