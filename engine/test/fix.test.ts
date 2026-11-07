// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Auto-fix: the rewrite each finding gets, the diff format, and (with a compiler installed)
// that every patch compiles, removes its finding, and leaves fixed contracts alone.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { analyzeIr, scanFile, findCompilers, type Finding } from '../src/index.js';
import { propose, applyEdits, unifiedDiff, changedRange, mask, splitTop, planFixes, findingKey } from '../src/fix.js';

const dir = path.join(__dirname, 'fixtures');
const zoo = path.join(__dirname, '..', '..', 'zoo', 'contracts');
const srcOf = (name: string) => fs.readFileSync(path.join(dir, 'src', name + '.compact'), 'utf8');
const load = (name: string) => analyzeIr(fs.readFileSync(path.join(dir, 'r2c', name + '.txt'), 'utf8'), srcOf(name));
const serious = (fs: Finding[]) => fs.filter((f) => !f.suppressed && ['critical', 'high', 'medium'].includes(f.severity));
const patchOf = (name: string) => {
  const report = load(name);
  const [f] = serious(report.findings);
  const p = propose(srcOf(name), f, report, `${name}.compact`);
  if (p.rule === null) throw new Error(p.manual);
  return { p, out: applyEdits(srcOf(name), p.edits) };
};
const hasCompiler = () => {
  const root = path.join(os.homedir(), '.compact', 'versions');
  return !!process.env.TELL_COMPILERS || (fs.existsSync(root) && fs.readdirSync(root).length > 0);
};

describe('source reading', () => {
  it('masks comments and strings without moving offsets', () => {
    const s = 'a("x, y") // b(c\n/* d( */ e';
    const m = mask(s);
    expect(m).toHaveLength(s.length);
    expect(m.startsWith('a("    ")')).toBe(true);
    expect(m).not.toMatch(/[bcd]\(/);
    expect(m.split('\n')).toHaveLength(2);
    expect(m.endsWith(' e')).toBe(true);
  });
  it('splits arguments at top-level commas, not inside type arguments', () => {
    const s = 'f(persistentHash<Vector<2, Bytes<32>>>([pad(32, "a"), sk]), x < 4, y)';
    const parts = splitTop(mask(s), 2, s.length - 1).map(([a, b]) => s.slice(a, b));
    expect(parts).toEqual(['persistentHash<Vector<2, Bytes<32>>>([pad(32, "a"), sk])', 'x < 4', 'y']);
  });
});

describe('a rewrite for every zoo leak', () => {
  it('ballot: the guessable hash becomes a commitment with a new nonce witness', () => {
    const { p, out } = patchOf('ballot-leaky');
    expect(p.rule).toBe('commit-hash');
    expect(out).toContain('ballots.insert(tag, disclose(persistentCommit<Bytes<32>>(choiceHash(c), ballotsNonce())));');
    expect(out).toMatch(/\nwitness ballotsNonce\(\): Bytes<32>;.*\n\nexport circuit vote/);
    expect(p.notes.join(' ')).toContain('Off-chain');
  });
  it('payband: the salary record becomes a commitment', () => {
    const { p, out } = patchOf('payband-leaky');
    expect(p.rule).toBe('commit-hash');
    expect(out).toContain('disclose(persistentCommit<Bytes<32>>(recordOf(employee, pay), recordsNonce()))');
  });
  it('reserve: the branch becomes an assert on the condition', () => {
    const { p, out } = patchOf('reserve-leaky');
    expect(p.rule).toBe('assert-branch');
    expect(out).toContain('  assert(a >= reserve, "this call does not meet the condition");\n  qualified.insert(tag);\n}');
    expect(out).not.toContain('belowReserve.insert');
    expect(p.notes.join(' ')).toContain('changes behaviour');
  });
  it('vault: the key becomes a hash, and the check against it hashes too', () => {
    const { p, out } = patchOf('vault-leaky');
    expect(p.rule).toBe('hash-key');
    const h = 'persistentHash<Vector<2, Bytes<32>>>([pad(32, "vault-leaky:owner"), secretKey()])';
    expect(out).toContain(`owner = disclose(${h});`);
    expect(out).toContain(`assert(owner == disclose(${h}), "not the owner");`);
  });
  it('board: the author tag becomes one per post, and the remaining link is named', () => {
    const { p, out } = patchOf('board-leaky');
    expect(p.rule).toBe('one-time-tag');
    expect(out).toContain('authors.insert(n, disclose(persistentHash<Vector<3, Bytes<32>>>([pad(32, "board-leaky:authors"), memberKey(), (n as Field) as Bytes<32>])));');
    expect(p.notes.join(' ')).toContain('`members.member` still receives the same tag');
  });
  it('fixed zoo contracts have nothing to fix', () => {
    for (const n of ['ballot', 'payband', 'reserve', 'vault', 'board']) expect(serious(load(`${n}-fixed`).findings)).toEqual([]);
  });
});

describe('manual fixes where no rewrite is safe', () => {
  const manualFor = (name: string) =>
    serious(load(name).findings).map((f) => {
      const p = propose(srcOf(name), f, load(name), `${name}.compact`);
      return p.rule === null ? p.manual : `patch:${p.rule}`;
    });
  it('a wallet key: identify the user by a secret instead', () => {
    const [m] = manualFor('case-wallet-key');
    expect(m).toContain('SecretKey(): Bytes<32>;');
    expect(m).toContain('persistentHash<Vector<2, Bytes<32>>>');
  });
  it('a secret returned from a circuit: low, so no fix is planned; the advice says where it goes', () => {
    expect(manualFor('case-return')).toEqual([]);
    const [f] = load('case-return').findings;
    const p = propose(srcOf('case-return'), f, load('case-return'), 'case-return.compact');
    expect(p.rule).toBeNull();
    expect((p as { manual: string }).manual).toContain('not on chain');
    expect((p as { manual: string }).manual).toContain('a contract that calls `leakKey`');
  });
  it('a public value used as a private key: manual, with the domain-separation fix', () => {
    const f = load('case-derived-key').findings.find((x) => x.kind === 'derivable-secret')!;
    const p = propose(srcOf('case-derived-key'), f, load('case-derived-key'), 'case-derived-key.compact');
    expect(p.rule).toBeNull();
    expect((p as { manual: string }).manual).toContain('domain separator');
  });
  it('a membership lookup: manual, pointing at a Merkle proof', () => {
    const [m] = manualFor('case-member-lookup');
    expect(m).toContain('checkRoot');
  });
  it('a branch inside a loop is not turned into an assert', () => {
    const src = `pragma language_version 0.23;
import CompactStandardLibrary;
export ledger a: Counter;
export ledger b: Counter;
witness v(): Vector<4, Uint<8>>;
export circuit f(): [] {
  for (const x of v()) {
    if (disclose(x > 2)) {
      a.increment(1);
    } else {
      b.increment(1);
    }
  }
}`;
    const f = { circuit: 'f', kind: 'branch', severity: 'medium', field: 'a', op: 'increment', sources: [{ name: 'v', kind: 'witness', type: 'Vector<4, Uint<8>>', bits: 32 }], bits: 1, title: '', detail: '', fix: 'Pad the loop.', line: 9 } as Finding;
    expect(propose(src, f)).toMatchObject({ rule: null });
  });
});

describe('diffs', () => {
  it('writes a unified diff with deletions before additions', () => {
    const d = unifiedDiff('a\nb\nc\nd\n', 'a\nB\nc\nd\n', 'x.compact');
    expect(d).toBe('--- a/x.compact\n+++ b/x.compact\n@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n d\n');
  });
  it('a changed range covers every edit, and a pure insertion widens to the line above', () => {
    expect(changedRange('a\nb\nc\nd', 'a\nB\nc\nD')).toEqual({ start: 2, end: 4, lines: ['B', 'c', 'D'] });
    expect(changedRange('a\nb', 'a\nx\nb')).toEqual({ start: 1, end: 1, lines: ['a', 'x'] });
    expect(changedRange('a', 'a')).toBeNull();
  });
  it('finding keys are stable across line moves', () => {
    const [f] = serious(load('ballot-leaky').findings);
    expect(findingKey({ ...f, line: 99 }, 'zoo/a.compact')).toBe(findingKey(f, 'zoo/a.compact'));
    expect(findingKey(f, 'zoo/b.compact')).not.toBe(findingKey(f, 'zoo/a.compact'));
  });
});

// Verification needs the Compact compiler (CI installs 0.31.1).
describe.runIf(hasCompiler())('verified patches', () => {
  const EXPECT: [string, string, string, string][] = [
    ['ballot', 'commit-hash', 'F', 'B'],
    ['payband', 'commit-hash', 'F', 'A'],
    ['reserve', 'assert-branch', 'C', 'A'],
    ['vault', 'hash-key', 'F', 'A'],
    // still C: the membership check looks the member's tag up (the zoo's Merkle version is the full fix)
    ['board', 'one-time-tag', 'C', 'C'],
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-fix-test-'));
  for (const [name, rule, before, after] of EXPECT)
    it(`${name}-leaky: compiles, finding gone, grade ${before} → ${after}, and fixing again changes nothing`, async () => {
      const compilers = await findCompilers();
      const r = await scanFile(path.join(zoo, `${name}-leaky.compact`), compilers);
      const plan = await planFixes(r, { compilers });
      const ok = plan.suggestions.filter((s) => s.patch);
      expect(ok).toHaveLength(1);
      expect(ok[0].rule).toBe(rule);
      expect(ok[0].verification).toMatchObject({ ok: true, compiles: true, gone: true, newFindings: [], gradeBefore: before, gradeAfter: after });
      // idempotent: the patched contract has nothing left to fix
      const file = path.join(tmp, `${name}.compact`);
      fs.writeFileSync(file, plan.combined!.source);
      const again = await planFixes(await scanFile(file, compilers), { compilers });
      expect(again.grade).toBe(after);
      expect(again.suggestions.filter((s) => s.patch)).toEqual([]);
      expect(again.combined).toBeUndefined();
      // what is left is the board's membership lookup, with the Merkle proof as the manual fix
      expect(again.suggestions.map((s) => s.manual ?? '')).toEqual(name === 'board' ? [expect.stringContaining('checkRoot')] : []);
    }, 120_000);

  it('fixed zoo contracts produce no patches', async () => {
    const compilers = await findCompilers();
    for (const n of ['ballot', 'payband', 'reserve', 'vault', 'board']) {
      const plan = await planFixes(await scanFile(path.join(zoo, `${n}-fixed.compact`), compilers), { compilers });
      expect(plan.suggestions).toEqual([]);
    }
  }, 120_000);

  it('a personal value in the clear becomes a commitment, and the field holds Bytes<32>', async () => {
    const compilers = await findCompilers();
    const file = path.join(tmp, 'payroll.compact');
    fs.writeFileSync(
      file,
      `pragma language_version 0.23;
import CompactStandardLibrary;
export ledger salaries: Map<Bytes<32>, Uint<32>>;
witness salary(): Uint<32>;
export circuit file(id: Bytes<32>): [] {
  salaries.insert(disclose(id), disclose(salary()));
}
`,
    );
    const plan = await planFixes(await scanFile(file, compilers), { compilers });
    const s = plan.suggestions.find((x) => x.finding.kind === 'published')!;
    expect(s.rule).toBe('commit-value');
    expect(s.verification).toMatchObject({ ok: true, gradeBefore: 'C', gradeAfter: 'A' });
    expect(s.patch!.source).toContain('export ledger salaries: Map<Bytes<32>, Bytes<32>>;');
    expect(s.patch!.source).toContain('disclose(persistentCommit<Uint<32>>(salary(), salariesNonce()))');
  }, 120_000);

  it('a patch that breaks the contract is not offered', async () => {
    const compilers = await findCompilers();
    // a Uint ledger value: committing it would change the field's type, which the rest of the contract reads
    const file = path.join(tmp, 'tally.compact');
    fs.writeFileSync(
      file,
      `pragma language_version 0.23;
import CompactStandardLibrary;
export ledger salaries: Map<Bytes<32>, Uint<32>>;
witness salary(): Uint<32>;
export circuit file(id: Bytes<32>): [] {
  salaries.insert(disclose(id), disclose(salary()));
}
export circuit raise(id: Bytes<32>): [] {
  const s = salaries.lookup(disclose(id));
  assert(s < 1000000, "too high");
  salaries.insert(disclose(id), disclose((s + 1) as Uint<32>));
}
`,
    );
    const r = await scanFile(file, compilers);
    const plan = await planFixes(r, { compilers });
    const s = plan.suggestions.find((x) => x.finding.kind === 'published');
    expect(s).toBeDefined();
    expect(s!.patch).toBeUndefined();
    expect(s!.manual).toContain('was tried and rejected');
    expect(s!.verification?.compiles).toBe(false);
  }, 120_000);

  // async, so the test worker's event loop stays free while the CLI compiles
  const cli = (args: string[]) =>
    new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const p = spawn('npx', ['tsx', 'src/cli.ts', ...args], { cwd: path.join(__dirname, '..') });
      let stdout = '';
      p.stdout.on('data', (d) => (stdout += d));
      p.on('close', (status) => resolve({ status, stdout }));
    });
  it('--fix-dry-run prints the diff and changes nothing; --fix writes it and the scan passes', async () => {
    const file = path.join(tmp, 'vault.compact');
    fs.copyFileSync(path.join(zoo, 'vault-leaky.compact'), file);
    const before = fs.readFileSync(file, 'utf8');
    const dry = await cli([file, '--fix-dry-run']);
    expect(dry.stdout).toContain('verified secret-published in claim, line 19 (hash-key)');
    expect(dry.stdout).toContain('-  owner = disclose(secretKey());');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    const fix = await cli([file, '--fix', '--fail-on', 'medium']);
    expect(fix.stdout).toContain('grade F → A');
    expect(fix.status).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toContain('persistentHash<Vector<2, Bytes<32>>>');
  }, 240_000);
});

// Review of the Wave 3 auto-fix (judges' notes): a constant salt is replaced, not wrapped; a salt
// witness the contract already declares is reused; a branch rated low still gets its fix, and when
// no rewrite applies the manual text says why; a one-line patch is a one-click suggestion.
const BALLOT = `pragma language_version 0.23;
import CompactStandardLibrary;
export ledger ballots: Map<Bytes<32>, Bytes<32>>;
witness voterKey(): Bytes<32>;
witness choice(): Uint<8>;
witness ballotSalt(): Bytes<32>;
export circuit vote(): [] {
  const tag = disclose(persistentHash<Vector<2, Bytes<32>>>([pad(32, "ballot:voter"), voterKey()]));
  const c = choice();
  assert(c < 4, "there are four candidates");
  ballots.insert(tag, disclose(persistentCommit<Uint<8>>(c, pad(32, "salt"))));
}
`;
const commitFinding = (over: Partial<Finding> = {}): Finding =>
  ({ circuit: 'vote', kind: 'guessable-hash', severity: 'critical', field: 'ballots', op: 'insert', sources: [{ name: 'choice', kind: 'witness', type: 'Uint<8>', bits: 2 }], bits: 2, via: 'persistentCommit', title: '', detail: '', fix: 'Use a fresh salt.', line: 11, ...over }) as Finding;

describe('constant or public commitment randomness', () => {
  it('replaces the salt with a nonce witness instead of committing a second time', () => {
    const p = propose(BALLOT, commitFinding(), undefined, 'ballot.compact');
    if (p.rule === null) throw new Error(p.manual);
    const out = applyEdits(BALLOT, p.edits);
    expect(out).toContain('ballots.insert(tag, disclose(persistentCommit<Uint<8>>(c, ballotSalt())));');
    expect(out).not.toContain('persistentCommit<Bytes<32>>(persistentCommit');
    expect(out).not.toContain('pad(32, "salt")');
  });
  it('reuses the salt witness the contract declares, adding no new one', () => {
    const p = propose(BALLOT, commitFinding(), undefined, 'ballot.compact');
    if (p.rule === null) throw new Error(p.manual);
    const out = applyEdits(BALLOT, p.edits);
    expect(p.witness).toBe('ballotSalt');
    expect(out.match(/^witness /gm)).toHaveLength(3);
    expect(p.notes[0]).toContain('already declares');
    // the patch touches one line only
    expect(changedRange(BALLOT, out)).toMatchObject({ start: 11, end: 11 });
  });
  it('declares a fresh witness when the only salt witness is already used in the circuit', () => {
    const src = BALLOT.replace('const c = choice();', 'const c = choice();\n  const unused = ballotSalt();');
    const p = propose(src, commitFinding({ line: 12 }), undefined, 'ballot.compact');
    if (p.rule === null) throw new Error(p.manual);
    const out = applyEdits(src, p.edits);
    expect(p.witness).toBe('ballotsNonce');
    expect(out).toContain('witness ballotsNonce(): Bytes<32>;');
    expect(out).toContain('persistentCommit<Uint<8>>(c, ballotsNonce())');
  });
  it('a commitment bound to a const, and a transient one, get their randomness replaced in place', () => {
    const src = BALLOT.replace(
      '  ballots.insert(tag, disclose(persistentCommit<Uint<8>>(c, pad(32, "salt"))));',
      '  const cm = transientCommit<Uint<8>>(c, 7);\n  ballots.insert(tag, disclose(cm));',
    );
    const p = propose(src, commitFinding({ via: 'transientCommit', line: 12 }), undefined, 'ballot.compact');
    if (p.rule === null) throw new Error(p.manual);
    const out = applyEdits(src, p.edits);
    expect(out).toContain('const cm = transientCommit<Uint<8>>(c, degradeToTransient(ballotSalt()));');
  });
  it('a guessable hash (not a commitment) still becomes a commitment, with the declared salt', () => {
    const src = BALLOT.replace('persistentCommit<Uint<8>>(c, pad(32, "salt"))', 'persistentHash<Uint<8>>(c)');
    const p = propose(src, commitFinding({ via: 'persistentHash' }), undefined, 'ballot.compact');
    if (p.rule === null) throw new Error(p.manual);
    expect(applyEdits(src, p.edits)).toContain('disclose(persistentCommit<Bytes<32>>(persistentHash<Uint<8>>(c), ballotSalt()))');
  });
});

describe('branches: a fix when one applies, and why not when it does not', () => {
  const branch = (over: Partial<Finding> = {}): Finding =>
    ({ circuit: 'check', kind: 'branch', severity: 'low', field: 'rich', op: 'increment', sources: [{ name: 'balance', kind: 'witness', type: 'Uint<64>', bits: 64 }], bits: 1, title: '', detail: 'anonymous choices', fix: 'Touch both.', line: 8, ...over }) as Finding;
  const BRANCH = `pragma language_version 0.23;
import CompactStandardLibrary;
export ledger rich: Counter;
export ledger poor: Counter;
witness balance(): Uint<64>;
export circuit check(): [] {
  if (disclose(balance() > 5000)) {
    rich.increment(1);
  } else {
    poor.increment(1);
  }
}
`;
  it('if (disclose(b > 5000)) { … } else { … } becomes an assert', () => {
    const p = propose(BRANCH, branch());
    if (p.rule === null) throw new Error(p.manual);
    expect(applyEdits(BRANCH, p.edits)).toContain('assert(balance() > 5000, "this call does not meet the condition");\n  rich.increment(1);\n}');
  });
  it('a conditional expression gets an explicit manual fix', () => {
    const src = BRANCH.replace(/  if [\s\S]*?\n  }\n}/, '  rich.increment(disclose(balance() > 5000) ? 1 : 0);\n}');
    const p = propose(src, branch({ line: 7 }));
    expect(p.rule).toBeNull();
    if (p.rule === null) {
      expect(p.manual).toContain('not a braced `if { } else { }` block');
      expect(p.manual).toContain('assert()');
    }
  });
  it('a branch in a loop says why it is not rewritten and how to pad the loop', () => {
    const src = BRANCH.replace('witness balance(): Uint<64>;', 'witness balances(): Vector<2, Uint<64>>;').replace(
      /  if [\s\S]*?\n  }\n}/,
      '  for (const b of balances()) {\n    if (disclose(b > 5000)) {\n      rich.increment(1);\n    }\n  }\n}',
    );
    const p = propose(src, branch({ line: 9, sources: [{ name: 'balances', kind: 'witness', type: 'Vector<2, Uint<64>>', bits: 128 }] }));
    expect(p.rule).toBeNull();
    if (p.rule === null) expect(p.manual).toContain('Pad the loop');
  });
});

describe.runIf(hasCompiler())('the pull-request demo, end to end', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-fix-demo-'));
  it('a constant salt in demo/ballot.compact: verified, one line, reuses ballotSalt, and posts as a suggestion', async () => {
    const { commentableLines, desiredComments } = await import('../src/review.js');
    const demo = fs.readFileSync(path.join(__dirname, '..', '..', 'demo', 'ballot.compact'), 'utf8');
    const leaky = demo.replace('persistentCommit<Uint<8>>(c, ballotSalt())', 'persistentCommit<Uint<8>>(c, pad(32, "salt"))');
    expect(leaky).not.toBe(demo);
    const file = path.join(tmp, 'ballot.compact');
    fs.writeFileSync(file, leaky);
    const compilers = await findCompilers();
    const r = await scanFile(file, compilers);
    const plan = await planFixes(r, { compilers, root: tmp });
    const s = plan.suggestions.find((x) => x.finding.kind === 'guessable-hash')!;
    expect(s.patch).toBeDefined();
    expect(s.verification).toMatchObject({ ok: true, compiles: true, gone: true, newFindings: [] });
    expect(s.patch!.source).toBe(demo); // exactly the original line back
    expect(s.patch!.range.start).toBe(s.patch!.range.end);
    // the pull request changed only that line
    const L = leaky.split('\n');
    const line = L.findIndex((l) => l.includes('pad(32, "salt")')) + 1;
    const pr = { filename: 'ballot.compact', status: 'modified', patch: `@@ -${line - 1},3 +${line - 1},3 @@\n ${L[line - 2]}\n-${demo.split('\n')[line - 1]}\n+${L[line - 1]}\n ${L[line]}` };
    expect(commentableLines(pr.patch).has(line)).toBe(true);
    const { comments } = desiredComments([{ ...r, fixes: plan }], [pr], { root: tmp });
    const c = comments.find((x) => x.finding.kind === 'guessable-hash')!;
    expect(c.line).toBe(line);
    expect(c.body).toContain('```suggestion\n' + demo.split('\n')[line - 1] + '\n```');
  }, 240_000);
  it('a branch on a private balance, rated low, still gets a verified fix', async () => {
    const file = path.join(tmp, 'branch.compact');
    fs.writeFileSync(
      file,
      `pragma language_version 0.23;\nimport CompactStandardLibrary;\nexport ledger rich: Counter;\nexport ledger poor: Counter;\nwitness balance(): Uint<64>;\nexport circuit check(): [] {\n  const b = balance();\n  if (disclose(b > 5000)) {\n    rich.increment(1);\n  } else {\n    poor.increment(1);\n  }\n}\n`,
    );
    const compilers = await findCompilers();
    const r = await scanFile(file, compilers);
    expect(r.report!.findings.find((f) => f.kind === 'branch')!.severity).toBe('low');
    const plan = await planFixes(r, { compilers, root: tmp });
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]).toMatchObject({ rule: 'assert-branch', verification: { ok: true, gradeBefore: 'B', gradeAfter: 'A' } });
  }, 240_000);
});
