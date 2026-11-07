// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Finding → diagnostic mapping and output parsing, without a VS Code instance.
// Results come from the engine run on its recorded compiler output (engine/test/fixtures),
// so these tests need no compiler; the last block runs the real one when it is installed.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeIr, candidates, gradeOf, SEVERITIES, type ContractResult, type Severity } from '@tell/engine';
import { DiagnosticLevel, compilerDir, fixMarkdown, hoverMarkdown, levelOf, parseCliJson, spanOfLine, statusOf, toDiagnostics } from '../src/mapping.js';
import { compilersIn, runTell } from '../src/runner.js';

const FIX = path.resolve(__dirname, '../../engine/test/fixtures');
const ZOO = path.resolve(__dirname, '../../zoo/contracts');
const srcOf = (name: string) => fs.readFileSync(path.join(FIX, 'src', `${name}.compact`), 'utf8');

// What scanFile returns, built from a recorded reduce-to-circuit pass.
function resultOf(name: string): ContractResult {
  const src = srcOf(name);
  const report = analyzeIr(fs.readFileSync(path.join(FIX, 'r2c', `${name}.txt`), 'utf8'), src);
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, report.findings.filter((f) => f.severity === s && !f.suppressed).length])) as Record<Severity, number>;
  return { file: `/work/${name}.compact`, compiler: '0.31.1', language: '0.23.0', ok: true, report, counts, grade: gradeOf(report.findings) };
}
const lineOf = (src: string, needle: string) => src.split('\n').findIndex((l) => l.includes(needle));

describe('severity → diagnostic level', () => {
  it('critical and high are errors, medium a warning, low information, info a hint', () => {
    expect(levelOf('critical')).toBe(DiagnosticLevel.Error);
    expect(levelOf('high')).toBe(DiagnosticLevel.Error);
    expect(levelOf('medium')).toBe(DiagnosticLevel.Warning);
    expect(levelOf('low')).toBe(DiagnosticLevel.Information);
    expect(levelOf('info')).toBe(DiagnosticLevel.Hint);
  });
  it('matches vscode.DiagnosticSeverity numbering', () => {
    expect(DiagnosticLevel).toEqual({ Error: 0, Warning: 1, Information: 2, Hint: 3 });
  });
});

describe('ranges', () => {
  it('covers the code on the line, not its indent or trailing comment', () => {
    const text = 'a\n    seeds.insert(disclose(slot), disclose(s)); // tell:allow published\n';
    const s = spanOfLine(text, 1);
    expect(s).toEqual({ line: 1, start: 4, end: 4 + 'seeds.insert(disclose(slot), disclose(s));'.length });
  });
  it('handles blank lines and CRLF', () => {
    expect(spanOfLine('x\r\n\r\n  y;\r\n', 1)).toEqual({ line: 1, start: 0, end: 0 });
    expect(spanOfLine('x\r\n\r\n  y;\r\n', 2)).toEqual({ line: 2, start: 2, end: 4 });
  });
});

describe('zoo findings as diagnostics', () => {
  it('ballot-leaky: one error on the ballots.insert line, in bits, with the public transcript', () => {
    const src = srcOf('ballot-leaky');
    const ds = toDiagnostics(resultOf('ballot-leaky'), src);
    const errors = ds.filter((d) => d.level === DiagnosticLevel.Error);
    expect(errors).toHaveLength(1);
    const d = errors[0];
    expect(d.code).toBe('guessable-hash');
    expect(d.source).toBe('Tell');
    expect(d.span.line).toBe(lineOf(src, 'ballots.insert(tag'));
    expect(src.split('\n')[d.span.line].slice(d.span.start, d.span.end)).toBe('ballots.insert(tag, disclose(choiceHash(c)));');
    expect(d.message).toMatch(/^critical: .*\(2 bits\)$/);
    expect(d.related.map((r) => r.message)).toContainEqual(expect.stringMatching(/^public transcript of vote: ballots\.insert\(.*persistentHash\(choice\(\)\): guessable, 2 bits\)$/));
    // related information points at the ledger declaration the transcript writes to
    expect(d.related[0].span.line).toBe(lineOf(src, 'export ledger ballots'));
  });

  const CASES: [string, string, number][] = [
    ['payband', 'guessable-hash', DiagnosticLevel.Error],
    ['reserve', 'branch', DiagnosticLevel.Warning],
    ['vault', 'secret-published', DiagnosticLevel.Error],
    ['board', 'attributable', DiagnosticLevel.Warning],
  ];
  for (const [name, code, level] of CASES)
    it(`${name}-leaky: the ${code} finding at the right level, ${name}-fixed: nothing above information`, () => {
      const leaky = toDiagnostics(resultOf(`${name}-leaky`), srcOf(`${name}-leaky`));
      const hit = leaky.filter((d) => d.code === code);
      expect(hit).toHaveLength(1);
      expect(hit[0].level).toBe(level);
      expect(hit[0].span.line).toBeGreaterThan(0);
      const fixed = toDiagnostics(resultOf(`${name}-fixed`), srcOf(`${name}-fixed`));
      expect(fixed.filter((d) => d.level <= DiagnosticLevel.Warning)).toEqual([]);
    });

  it('hides info findings unless asked, and never shows suppressed ones', () => {
    const r = resultOf('case-seeds-allow');
    expect(r.report!.findings.some((f) => f.suppressed)).toBe(true);
    for (const min of ['low', 'info'] as Severity[]) {
      const ds = toDiagnostics(r, srcOf('case-seeds-allow'), { minSeverity: min });
      expect(ds.every((d) => !d.finding.suppressed)).toBe(true);
    }
    const ballot = resultOf('ballot-leaky');
    const lowAndUp = toDiagnostics(ballot, srcOf('ballot-leaky'));
    const everything = toDiagnostics(ballot, srcOf('ballot-leaky'), { minSeverity: 'info' });
    expect(lowAndUp.some((d) => d.level === DiagnosticLevel.Hint)).toBe(false);
    expect(everything.length).toBeGreaterThanOrEqual(lowAndUp.length);
    expect(toDiagnostics(ballot, srcOf('ballot-leaky'), { minSeverity: 'critical' })).toHaveLength(1);
  });

  it('a failed compile gives no diagnostics', () => {
    expect(toDiagnostics({ file: 'x', compiler: null, language: null, ok: false, error: 'boom' }, '')).toEqual([]);
  });
});

describe('status bar', () => {
  it('shows the grade, red for D and F, amber for C, plain for A and B', () => {
    expect(statusOf(resultOf('ballot-leaky'))).toMatchObject({ text: '$(eye) Tell: F', tone: 'error' });
    expect(statusOf(resultOf('reserve-leaky'))).toMatchObject({ text: '$(eye) Tell: C', tone: 'warning' });
    const fixed = statusOf(resultOf('ballot-fixed'))!;
    expect(fixed.tone).toBe('ok');
    expect(fixed.text).toMatch(/Tell: [AB]$/);
    expect(statusOf(resultOf('ballot-leaky'))!.tooltip).toContain('1 critical');
  });
  it('says when there is no grade', () => {
    expect(statusOf({ file: 'x', compiler: null, language: null, ok: false, error: 'No Compact compiler found.' })).toMatchObject({ tone: 'warning', text: '$(eye) Tell: no grade' });
    expect(statusOf(undefined)).toBeNull();
  });
});

describe('hover and fix document', () => {
  const src = srcOf('vault-leaky');
  const d = toDiagnostics(resultOf('vault-leaky'), src).find((x) => x.code === 'secret-published')!;
  it('hover carries the fix, the transcript and the command link', () => {
    const md = hoverMarkdown([d], () => 'command:tell.showFix?x');
    expect(md).toContain(`**Fix:** ${d.finding.fix}`);
    expect(md).toContain('owner.');
    expect(md).toContain("[Show Tell's fix](command:tell.showFix?x)");
  });
  it("Show Tell's fix explains the rule with the zoo's leak and fix", () => {
    const md = fixMarkdown(d.finding, 'contracts/vault.compact', ['owner.write(secretKey() in the clear, 256 bits)']);
    expect(md).toContain(d.finding.fix);
    expect(md).toContain('# Rule: Secret in the clear');
    expect(md).toContain('owner = disclose(publicKey(secretKey()));');
  });
});

describe('CLI output parsing', () => {
  it('reads the --json list, skipping anything printed before it', () => {
    const r = resultOf('ballot-leaky');
    const json = JSON.stringify([r], (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
    const parsed = parseCliJson(`npm warn something\n${json}\n`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].grade).toBe('F');
    expect(toDiagnostics(parsed[0], srcOf('ballot-leaky')).filter((d) => d.level === DiagnosticLevel.Error)).toHaveLength(1);
  });
  it('fails clearly on output that is not JSON', () => {
    expect(() => parseCliJson('No Compact contracts found.')).toThrow(/no JSON/);
  });
  it('accepts compactc.bin or its directory in tell.compilerDirs', () => {
    expect(compilerDir('/home/me/.compact/versions/0.31.1/x86_64-unknown-linux-musl/compactc.bin')).toBe('/home/me/.compact/versions/0.31.1/x86_64-unknown-linux-musl');
    expect(compilerDir('/opt/compact/0.31.1')).toBe('/opt/compact/0.31.1');
  });
});

const compilers = await compilersIn([]);
describe.skipIf(compilers.length === 0)('with the real compiler', () => {
  it('bundled engine: ballot-leaky gets its error, on the right line', async () => {
    const file = path.join(ZOO, 'ballot-leaky.compact');
    const r = await runTell(file);
    expect(r.ok).toBe(true);
    const src = fs.readFileSync(file, 'utf8');
    const errors = toDiagnostics(r, src).filter((d) => d.level === DiagnosticLevel.Error);
    expect(errors.map((d) => d.span.line)).toEqual([lineOf(src, 'ballots.insert(tag')]);
  });

  it('tell.compilerVersion picks the compiler', async () => {
    // the least preferred compiler that accepts the contract's pragma
    const file = path.join(ZOO, 'vault-leaky.compact');
    const want = candidates(compilers, fs.readFileSync(file, 'utf8')).at(-1)!.version;
    const r = await runTell(file, { compilerVersion: want });
    expect(r.compiler).toBe(want);
    const missing = await runTell(path.join(ZOO, 'vault-leaky.compact'), { compilerVersion: '9.9.9' });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('not installed');
  });

  it('tell.compilerDirs restricts the compilers to those directories', async () => {
    const one = compilers.find((c) => c.version === '0.31.1') ?? compilers[0];
    const r = await runTell(path.join(ZOO, 'vault-leaky.compact'), { compilerDirs: [one.bin] });
    expect(r.compiler).toBe(one.version);
  });

  it('tell.cliPath: the CLI from a clone, called with --json, gives the same diagnostics', async () => {
    const file = path.join(ZOO, 'reserve-leaky.compact');
    const viaCli = await runTell(file, { cliPath: path.resolve(__dirname, '../../engine/src/cli.ts') });
    expect(viaCli.ok).toBe(true);
    const bundled = await runTell(file);
    const src = fs.readFileSync(file, 'utf8');
    const strip = (r: ContractResult) => toDiagnostics(r, src).map((d) => [d.span, d.level, d.message]);
    expect(strip(viaCli)).toEqual(strip(bundled));
  });

  it('the CLI exits cleanly with JSON for a whole directory', () => {
    const out = execFileSync('npx', ['tsx', path.resolve(__dirname, '../../engine/src/cli.ts'), ZOO, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(parseCliJson(out)).toHaveLength(10);
  });
});
