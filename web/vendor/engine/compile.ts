// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Runs the real Compact compiler (no proving keys) and captures the
// reduce-to-circuit pass. Tell never re-implements Compact: whatever the
// compiler accepts, Tell analyzes exactly as the compiler understood it.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONSTRUCTOR_MARK } from './ir.js';

export type Compiler = { version: string; language: string; bin: string };

const run = (bin: string, args: string[], cwd?: string, timeout = 120_000) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(bin, args, { cwd, timeout, maxBuffer: 512 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as unknown as number) ?? 1 : 0;
      resolve({ code: typeof code === 'number' ? code : 1, stdout: String(stdout), stderr: String(stderr) });
    });
  });

const cmpVer = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

// Installed compilers: TELL_COMPILERS="/dir/a,/dir/b" (each holding compactc.bin), else ~/.compact.
export async function findCompilers(): Promise<Compiler[]> {
  const dirs: string[] = [];
  if (process.env.TELL_COMPILERS) dirs.push(...process.env.TELL_COMPILERS.split(',').filter(Boolean));
  else {
    const root = path.join(os.homedir(), '.compact', 'versions');
    if (fs.existsSync(root))
      for (const v of fs.readdirSync(root))
        for (const arch of fs.readdirSync(path.join(root, v))) dirs.push(path.join(root, v, arch));
  }
  const out: Compiler[] = [];
  for (const d of dirs) {
    const bin = path.join(d, 'compactc.bin');
    if (!fs.existsSync(bin)) continue;
    const v = await run(bin, ['--version']);
    const l = await run(bin, ['--language-version']);
    if (v.code === 0 && l.code === 0) out.push({ version: v.stdout.trim().split(/\s+/)[0], language: l.stdout.trim(), bin });
  }
  return out.sort((a, b) => cmpVer(b.version, a.version));
}

// pragma language_version 0.23;  >= 0.22 && <= 0.23;  >= 0.25.0;
export function pragmaAccepts(pragma: string, language: string): boolean {
  const clauses = pragma.split('&&').map((c) => c.trim()).filter(Boolean);
  const lang = language.split('.').slice(0, 3).join('.');
  return clauses.every((c) => {
    const m = c.match(/^(>=|<=|>|<|==)?\s*([\d.]+)$/);
    if (!m) return true;
    const op = m[1] ?? '==';
    const want = m[2];
    const parts = want.split('.').length;
    const have = lang.split('.').slice(0, Math.max(parts, 2)).join('.');
    const d = cmpVer(have, want);
    if (op === '==') return parts >= 3 ? d === 0 : cmpVer(lang.split('.').slice(0, parts).join('.'), want) === 0;
    if (op === '>=') return d >= 0;
    if (op === '<=') return parts >= 3 ? d <= 0 : cmpVer(lang.split('.').slice(0, parts).join('.'), want) <= 0;
    if (op === '>') return d > 0;
    return d < 0;
  });
}

export const readPragma = (src: string): string | null => src.match(/pragma\s+language_version\s+([^;]+);/)?.[1].trim() ?? null;

export function pickCompiler(compilers: Compiler[], src: string): Compiler | null {
  const pragma = readPragma(src);
  if (!pragma) return compilers[0] ?? null;
  return compilers.find((c) => pragmaAccepts(pragma, c.language)) ?? null;
}

export type Compiled = { ok: true; compiler: Compiler; ir: string } | { ok: false; compiler: Compiler | null; error: string };

// The compiler that targets the ledger live on Midnight today is tried first.
export const PREFERRED = process.env.TELL_PREFERRED_COMPILER ?? '0.31.1';

export function candidates(compilers: Compiler[], src: string): Compiler[] {
  const pragma = readPragma(src);
  const ok = pragma ? compilers.filter((c) => pragmaAccepts(pragma, c.language)) : compilers;
  return [...ok.filter((c) => c.version === PREFERRED), ...ok.filter((c) => c.version !== PREFERRED)];
}

export async function compileForAnalysis(file: string, compilers?: Compiler[]): Promise<Compiled> {
  const list = compilers ?? (await findCompilers());
  const src = fs.readFileSync(file, 'utf8');
  const tries = candidates(list, src);
  if (tries.length === 0)
    return {
      ok: false,
      compiler: null,
      error: `No installed Compact compiler accepts \`pragma language_version ${readPragma(src)}\`. Installed: ${list.map((c) => `${c.version} (language ${c.language})`).join(', ') || 'none'}.`,
    };
  let first: Compiled | null = null;
  for (const c of tries) {
    const r = await compileWith(file, c);
    if (r.ok) return r;
    first ??= r;
  }
  return first!;
}

async function compileWith(file: string, compiler: Compiler): Promise<Compiled> {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-'));
  try {
    const r = await run(compiler.bin, ['--trace-passes', '--skip-zk', path.basename(file), out], path.dirname(file));
    const text = r.stdout;
    const a = text.indexOf('\nreduce-to-circuit:\n');
    const b = text.indexOf('\nflatten-datatypes:\n', a);
    if (r.code !== 0 || a < 0) {
      const msg = (r.stderr || text.split('\n').filter((l) => /Exception|error/i.test(l)).slice(-5).join('\n') || 'compile failed').trim();
      return { ok: false, compiler, error: msg.slice(0, 2000) };
    }
    const ctor = constructorForm(text, a);
    return { ok: true, compiler, ir: text.slice(a + 1, b < 0 ? undefined : b) + (ctor ? CONSTRUCTOR_MARK + ctor + '\n' : '') };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

// reduce-to-circuit keeps only what gets proved, so the constructor is gone by then. Every compiler
// from 0.29 to 0.36 still prints it, inside public-ledger-declaration, up to drop-safe-casts: take it
// from the last pass before reduce-to-circuit that has it.
export function constructorForm(trace: string, r2c: number): string | null {
  const before = trace.slice(0, r2c);
  const headers = [...before.matchAll(/\n([a-z0-9/-]+):\n/g)];
  // Only passes after inline-circuits: before it, helper circuits are still calls.
  const first = headers.findIndex((h) => h[1] === 'inline-circuits');
  if (first < 0) return null;
  for (let i = headers.length - 1; i >= first; i--) {
    const from = headers[i].index! + headers[i][0].length;
    const to = i + 1 < headers.length ? headers[i + 1].index! : before.length;
    const rel = before.slice(from, to).indexOf('(constructor');
    if (rel < 0) continue;
    const at = from + rel;
    const end = matchParen(before, at);
    return end > at ? before.slice(at, end) : null;
  }
  return null;
}

// Index just past the list that opens at `start`, skipping strings.
function matchParen(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === '\\') i++;
    } else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// A file worth compiling on its own: a contract, not a module or include file.
export function isContractFile(src: string): boolean {
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/^\s*module\s+\w+/m.test(code) && !/^\s*export\s+(ledger|circuit)/m.test(code.replace(/module\s+\w+[^{]*\{[\s\S]*$/m, ''))) return false;
  return /\bpragma\s+language_version\b/.test(code) && /\b(export\s+circuit|constructor|export\s+ledger)\b/.test(code);
}
