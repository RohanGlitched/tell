// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Server-side scanning for the website: a pasted contract, or a public GitHub
// repository fetched as a tarball. The same engine as the CLI.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { x as untar } from 'tar';
import { findCompilers, findContracts, scanFile, type Compiler, type ContractResult } from '@tell/engine';

const MAX_SOURCE = 200_000;
const MAX_TARBALL = 25 * 1024 * 1024;
const MAX_CONTRACTS = 30;

let compilers: Promise<Compiler[]> | null = null;

// Vercel does not keep the executable bit on bundled files: copy each compiler to /tmp once.
function prepareCompilers(): Promise<Compiler[]> {
  if (compilers) return compilers;
  compilers = (async () => {
    const bundled = path.join(process.cwd(), 'bin');
    if (fs.existsSync(bundled)) {
      const dirs: string[] = [];
      for (const v of fs.readdirSync(bundled)) {
        const src = path.join(bundled, v, 'compactc.bin');
        if (!fs.existsSync(src)) continue;
        const dir = path.join(os.tmpdir(), 'tell-compilers', v);
        const dest = path.join(dir, 'compactc.bin');
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(src, dest);
          fs.chmodSync(dest, 0o755);
        }
        dirs.push(dir);
      }
      process.env.TELL_COMPILERS = dirs.join(',');
    }
    return findCompilers();
  })();
  return compilers;
}

// `include "…"` and `import "…"` make the compiler read another file. A pasted contract may not
// read any file; a repository's contracts may only read files inside the repository.
const FILE_REFS = /^\s*(?:include|import)\s+"([^"]*)"/gm;
function unsafeRefs(src: string, file: string, root: string | null): string[] {
  return [...src.matchAll(FILE_REFS)]
    .map((m) => m[1])
    .filter((ref) => {
      if (root === null || path.isAbsolute(ref) || ref.includes(String.fromCharCode(0))) return true;
      const target = path.resolve(path.dirname(file), ref);
      return target !== root && !target.startsWith(root + path.sep);
    });
}

export type ScanResponse = {
  kind: 'source' | 'repo';
  repo?: string;
  commit?: string | null;
  contracts: ContractResult[];
  skipped?: number;
  compilers: string[];
  ms: number;
  // a sample's result, made ahead of time by the same engine and compiler
  precomputed?: boolean;
};

// The cheap checks on a pasted contract, before any compiler runs. Throws a UserError.
export function checkSource(source: string) {
  if (source.length > MAX_SOURCE) throw new UserError(`That contract is ${Math.round(source.length / 1000)} kB; the limit is 200 kB.`);
  if (!/pragma\s+language_version/.test(source)) throw new UserError('Paste a whole Compact contract, starting with `pragma language_version …;`.');
  if (unsafeRefs(source, '', null).length)
    throw new UserError('A pasted contract cannot include or import other files. Scan its GitHub repository instead, or paste it with the included code inlined.');
}

// The file name a pasted contract is scanned under.
export function sourceFileName(name = 'contract.compact') {
  const safe = name.replace(/[^\w.-]/g, '_').replace(/^\.+/, '') || 'contract.compact';
  return safe.endsWith('.compact') ? safe : safe + '.compact';
}

export async function scanSource(source: string, name = 'contract.compact'): Promise<ScanResponse> {
  const t = Date.now();
  checkSource(source);
  const list = await prepareCompilers();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-src-'));
  try {
    const file = path.join(dir, sourceFileName(name));
    fs.writeFileSync(file, source);
    const r = await scanFile(file, list);
    r.file = path.basename(file);
    return { kind: 'source', contracts: [r], compilers: list.map((c) => c.version), ms: Date.now() - t };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function parseRepo(input: string): { owner: string; name: string; ref: string | null } | null {
  const s = input.trim().replace(/\.git$/, '');
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([\w./-]+))?/) ?? s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { owner: m[1], name: m[2], ref: m[3]?.split('/')[0] ?? null };
}

export async function scanRepo(input: string): Promise<ScanResponse> {
  const t = Date.now();
  const r = parseRepo(input);
  if (!r) throw new UserError('Give a public GitHub repository, like `github.com/owner/repo`.');
  const list = await prepareCompilers();
  // Pin the scan to a commit so every finding links to the exact line on GitHub.
  let sha: string | null = null;
  try {
    const c = await fetch(`https://api.github.com/repos/${r.owner}/${r.name}/commits/${encodeURIComponent(r.ref ?? 'HEAD')}`, {
      headers: { accept: 'application/vnd.github.sha', 'user-agent': 'tell-scanner', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    });
    if (c.ok) sha = (await c.text()).trim().slice(0, 40) || null;
  } catch {
    /* fall back to the default branch without a pinned commit */
  }
  const url = `https://codeload.github.com/${r.owner}/${r.name}/tar.gz/${sha ?? r.ref ?? 'HEAD'}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (res.status === 404) throw new UserError(`github.com/${r.owner}/${r.name} was not found, or it is private.`);
  if (!res.ok || !res.body) throw new UserError(`GitHub answered ${res.status} for that repository. Try again in a minute.`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_TARBALL) throw new UserError('That repository is over 25 MB; scan it with the CLI instead.');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-repo-'));
  try {
    let seen = 0;
    const body = Readable.fromWeb(res.body as never);
    body.on('data', (c: Buffer) => {
      seen += c.length;
      if (seen > MAX_TARBALL) body.destroy(new UserError('That repository is over 25 MB; scan it with the CLI instead.'));
    });
    // Only Compact sources matter; skip everything else while extracting.
    // Regular files and folders only: a symlink in the archive could point anywhere on this server.
    await pipeline(
      body,
      untar({
        cwd: dir,
        filter: (p, e) => {
          const type = (e as unknown as { type?: string }).type;
          return type === 'Directory' || ((type === 'File' || type === 'OldFile' || type === 'ContiguousFile') && p.endsWith('.compact'));
        },
      }),
    );
    const top = fs.readdirSync(dir)[0];
    const root = top ? path.join(dir, top) : dir;
    const commit = sha ?? top?.match(/-([0-9a-f]{40})$/)?.[1] ?? null;
    const files = findContracts(root).filter((f) => unsafeRefs(fs.readFileSync(f, 'utf8'), f, root).length === 0);
    const contracts: ContractResult[] = [];
    for (const f of files.slice(0, MAX_CONTRACTS)) {
      if (Date.now() - t > 45_000) break;
      const res = await scanFile(f, list);
      res.file = path.relative(root, f).split(path.sep).join('/');
      contracts.push(res);
    }
    return {
      kind: 'repo',
      repo: `${r.owner}/${r.name}`,
      commit,
      contracts,
      skipped: files.length - contracts.length,
      compilers: list.map((c) => c.version),
      ms: Date.now() - t,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export class UserError extends Error {}
