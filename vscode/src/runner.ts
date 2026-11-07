// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Runs Tell on one contract: the engine bundled with the extension by default,
// or an external Tell CLI (`tell.cliPath`) called with --json.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { findCompilers, scanFile, type Compiler, type ContractResult } from '@tell/engine';
import { compilerDir, parseCliJson } from './mapping.js';

export type RunOptions = { compilerVersion?: string; compilerDirs?: string[]; cliPath?: string; timeoutMs?: number };

const cache = new Map<string, Promise<Compiler[]>>();

// The engine reads TELL_COMPILERS when it probes, so it is set only for the probe.
export function compilersIn(dirs: string[]): Promise<Compiler[]> {
  const key = dirs.join(',');
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const before = process.env.TELL_COMPILERS;
      if (dirs.length) process.env.TELL_COMPILERS = dirs.map(compilerDir).join(',');
      try {
        return await findCompilers();
      } finally {
        if (before === undefined) delete process.env.TELL_COMPILERS;
        else process.env.TELL_COMPILERS = before;
      }
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export const forgetCompilers = () => cache.clear();

export async function runTell(file: string, opts: RunOptions = {}): Promise<ContractResult> {
  if (opts.cliPath) return runCli(file, opts);
  const all = await compilersIn(opts.compilerDirs ?? []);
  const fail = (error: string): ContractResult => ({ file, compiler: null, language: null, ok: false, error });
  if (all.length === 0)
    return fail('No Compact compiler found. Install one with `compact update 0.31.1`, or set tell.compilerDirs to directories holding compactc.bin.');
  const v = opts.compilerVersion?.trim();
  const list = v ? all.filter((c) => c.version === v || c.version.startsWith(v + '.')) : all;
  if (list.length === 0) return fail(`Compact compiler ${v} is not installed. Installed: ${all.map((c) => c.version).join(', ')}.`);
  return scanFile(file, list);
}

function runCli(file: string, opts: RunOptions): Promise<ContractResult> {
  const cli = opts.cliPath!;
  const ts = /\.[cm]?ts$/.test(cli);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const [bin, args] = ts ? [npx, ['--yes', 'tsx', cli, file, '--json']] : [cli, [file, '--json']];
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  if (opts.compilerDirs?.length) env.TELL_COMPILERS = opts.compilerDirs.map(compilerDir).join(',');
  if (opts.compilerVersion?.trim()) env.TELL_PREFERRED_COMPILER = opts.compilerVersion.trim();
  return new Promise((resolve) => {
    execFile(bin, args, { cwd: path.dirname(cli), env, shell: process.platform === 'win32', timeout: opts.timeoutMs ?? 180_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      try {
        const results = parseCliJson(String(stdout));
        const mine = results.find((r) => path.resolve(r.file) === path.resolve(file)) ?? results[0];
        if (mine) return resolve(mine);
        resolve({ file, compiler: null, language: null, ok: false, error: 'Tell found no contract in this file (a module or include file?).' });
      } catch (e) {
        resolve({ file, compiler: null, language: null, ok: false, error: `${err ? `${err.message}\n` : ''}${String(stderr).slice(0, 1000) || (e as Error).message}` });
      }
    });
  });
}
