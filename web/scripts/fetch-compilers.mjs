// Downloads the official Compact compilers (Linux x86_64) into web/bin/<version>/compactc.bin.
// Runs before `next build`, so the scan function can compile any contract the way its pragma asks.
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

const VERSIONS = ['0.35.0', '0.34.0', '0.31.1', '0.30.0', '0.29.0'];
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'bin');

for (const v of VERSIONS) {
  const dest = path.join(root, v, 'compactc.bin');
  if (fs.existsSync(dest)) continue;
  const url = `https://github.com/midnightntwrk/compact/releases/download/compactc-v${v}/compactc_v${v}_x86_64-unknown-linux-musl.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const name = Object.keys(files).find((n) => n.endsWith('compactc.bin'));
  if (!name) throw new Error(`no compactc.bin in ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, files[name], { mode: 0o755 });
  console.log(`compact ${v}: ${(files[name].length / 1e6).toFixed(1)} MB`);
}
