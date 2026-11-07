// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Precision tests: what Tell must report, and what it must not.

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { analyzeIr, gradeOf, pragmaAccepts, isContractFile, constructorForm, isTypeForm, type Finding } from '../src/index.js';
import { parseAll } from '../src/sexpr.js';
import { declaredPublic as declaredPublicForTest } from '../src/analyze.js';
import { toSarif } from '../src/sarif.js';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

// Installed compilers, without the async API: ~/.compact/versions or TELL_COMPILERS.
const findCompilersSync = () =>
  process.env.TELL_COMPILERS
    ? process.env.TELL_COMPILERS.split(',')
    : fs.existsSync(path.join(os.homedir(), '.compact', 'versions'))
      ? fs.readdirSync(path.join(os.homedir(), '.compact', 'versions'))
      : [];

const dir = path.join(__dirname, 'fixtures');
const load = (name: string) =>
  analyzeIr(fs.readFileSync(path.join(dir, 'r2c', name + '.txt'), 'utf8'), fs.readFileSync(path.join(dir, 'src', name + '.compact'), 'utf8'));
const serious = (fs: Finding[]) => fs.filter((f) => !f.suppressed && f.severity !== 'info' && f.severity !== 'low');

describe('every fixture parses with no unknown compiler forms', () => {
  for (const f of fs.readdirSync(path.join(dir, 'r2c')).map((f) => f.replace('.txt', '')))
    it(f, () => {
      const text = fs.readFileSync(path.join(dir, 'r2c', f + '.txt'), 'utf8');
      if (!text.includes('(program')) return;
      expect(analyzeIr(text).unknownForms).toEqual([]);
    });
});

// Each leaky zoo contract has exactly one intended leak; its fix has none.
const ZOO: [string, Finding['kind'], Finding['severity'], string][] = [
  ['ballot', 'guessable-hash', 'critical', 'choice'],
  ['payband', 'guessable-hash', 'critical', 'salary'],
  ['reserve', 'branch', 'medium', 'amount'],
  ['vault', 'secret-published', 'critical', 'secretKey'],
  ['board', 'attributable', 'medium', 'memberKey'],
  // Wave 3: the constructor, token operations, and Ledger 9 events
  ['raffle', 'guessable-hash', 'critical', 'winningNumber'],
  ['faucet', 'shielded-coin', 'medium', 'ownPublicKey.bytes'],
  ['deposit', 'published', 'medium', 'bidAmount'],
  ['poll', 'guessable-hash', 'critical', 'choice'],
];

describe('the leak zoo', () => {
  for (const [name, kind, severity, source] of ZOO) {
    it(`${name}-leaky: reports the ${kind}`, () => {
      const r = load(`${name}-leaky`);
      const hit = r.findings.filter((f) => f.kind === kind);
      expect(hit).toHaveLength(1);
      expect(hit[0].severity).toBe(severity);
      expect(hit[0].sources.map((s) => s.name)).toContain(source);
      expect(hit[0].line).toBeGreaterThan(0);
      expect(serious(r.findings)).toHaveLength(1);
    });
    it(`${name}-fixed: reports nothing above low`, () => {
      const r = load(`${name}-fixed`);
      expect(serious(r.findings)).toEqual([]);
      expect(['A', 'B']).toContain(gradeOf(r.findings));
    });
  }

  it('guessable hashes say how many tries recover the value', () => {
    const f = load('ballot-leaky').findings.find((f) => f.kind === 'guessable-hash')!;
    // assert(c < 4) bounds the Uint<8>: 2 bits, four tries
    expect(f.bits).toBe(2);
    expect(f.detail).toContain('at most 4 tries');
  });

  it('an input the same call publishes adds no secrecy to a hash', () => {
    // payband hashes (employee, salary) but employee is the public map key
    const f = load('payband-leaky').findings.find((f) => f.kind === 'guessable-hash')!;
    expect(f.bits).toBe(32);
    expect(f.sources.map((s) => s.name)).toEqual(['salary']);
  });
});

describe('official Midnight examples', () => {
  it('election: revealing a vote shows which counter moved', () => {
    const b = load('election').findings.find((f) => f.kind === 'branch' && f.circuit === 'revealVote')!;
    expect(b.sources[0].name).toBe('localGetVote');
    expect(b.fields).toEqual(expect.arrayContaining(['candidate0VoteCounter.increment', 'candidate1VoteCounter.increment']));
  });

  it('election: the voter tag links register, commit and reveal; the vote commitment stays separate', () => {
    const l = load('election').findings.filter((f) => f.kind === 'linkable');
    const tag = l.filter((f) => f.severity === 'low');
    // the constructor stores the organiser's tag, made the same way: an organiser who also votes is recognisable
    expect(new Set(tag.map((f) => f.circuit))).toEqual(new Set(['constructor', 'registerToVote', 'commitVote', 'revealVote']));
    expect(new Set(tag.map((f) => f.tagFp)).size).toBe(1);
    expect(l.some((f) => f.severity === 'info' && f.sources.some((s) => s.name === 'localGetVote'))).toBe(true);
  });

  it('zk-loan: approval publishes one bit about each scoring field, not the whole attestation', () => {
    const r = load('zkloan-credit-scorer');
    const preds = r.findings.filter((f) => f.kind === 'predicate' && f.circuit === 'requestLoan').map((f) => f.sources[0].name);
    expect(preds).toEqual(expect.arrayContaining(['getAttestedScoringWitness[0].creditScore', 'getAttestedScoringWitness[0].monthlyIncome']));
    const pub = r.findings.filter((f) => f.kind === 'published' && f.circuit === 'requestLoan' && f.sources[0].name.startsWith('getAttested'));
    expect(pub.every((f) => f.bits === 16)).toBe(true);
  });

  it('shielded-coin plumbing is not reported as a leak; a mint amount is public', () => {
    // (a coin whose nonce is public is a separate finding, below)
    for (const n of ['chips', 'token-transfers', 'private-tip-jar'])
      expect(load(n).findings.filter((f) => f.kind !== 'shielded-coin' && (f.fields ?? []).some((x) => /claimZswap|kernel\.self/.test(x)))).toEqual([]);
    expect(load('token-transfers').findings.some((f) => (f.fields ?? []).includes('kernel.mintShielded') && f.kind === 'published')).toBe(true);
  });

  it('unshielded transfers publish their amount and recipient', () => {
    const fs = load('token-transfers').findings.filter((f) => f.field === 'kernel');
    expect(fs.some((f) => f.circuit === 'sendToUser' && f.sources.some((s) => s.name === 'amount'))).toBe(true);
    expect(fs.some((f) => (f.fields ?? []).includes('kernel.claimUnshieldedCoinSpend') && f.sources.some((s) => s.name === 'user_addr'))).toBe(true);
  });
});

// Cases raised by the engineering review; each was a miss or a false alarm before.
describe('review cases', () => {
  const one = (name: string) => load(name).findings.filter((f) => f.severity !== 'info');
  it('ownPublicKey() published is a wallet link (medium)', () => {
    expect(one('case-wallet-key')).toMatchObject([{ kind: 'published', severity: 'medium', sources: [{ name: 'ownPublicKey' }] }]);
  });
  it('degradeToTransient is a cast, not a hash: the key is in the clear', () => {
    expect(one('case-degrade')).toMatchObject([{ kind: 'secret-published', severity: 'critical' }]);
  });
  it('names are read by words: individualIncome is not a division hint', () => {
    // reported as a branch, not waved through as a hint; low because nothing identifies the caller
    const [f] = one('case-income');
    expect(f).toMatchObject({ kind: 'branch', severity: 'low', sources: [{ name: 'individualIncome' }] });
    expect(f.detail).toContain('anonymous');
  });
  it('a membership leaf and a nullifier from the same key are not linked', () => {
    expect(load('case-nullifier').findings.filter((f) => f.kind === 'linkable' && f.severity !== 'info')).toEqual([]);
  });
  it('a guessable hash of a circuit argument is not waved through', () => {
    expect(one('case-vote-arg')).toMatchObject([{ kind: 'guessable-hash', severity: 'high', sources: [{ name: 'choice' }] }]);
  });
  it('renaming a variable does not hide a leak (review: five evasions)', () => {
    const by = (c: string) => one('case-evade').filter((f) => f.circuit === c);
    expect(by('claim')).toMatchObject([{ kind: 'published', severity: 'medium', sources: [{ name: 'ownerSeed' }] }]);
    expect(by('file')).toMatchObject([{ kind: 'published', severity: 'medium', sources: [{ name: 'salary' }] }]);
    expect(by('enrol')).toMatchObject([{ kind: 'guessable-hash', severity: 'critical' }]);
    expect(by('cast')).toMatchObject([{ kind: 'guessable-hash', severity: 'high', sources: [{ name: 'v' }] }]);
    expect(by('prove')).toMatchObject([{ kind: 'guessable-hash', severity: 'critical', sources: [{ name: 'age' }] }]);
  });
  it('an anonymous poll: the tally branch is low, the nullifier links nothing', () => {
    const fs = one('case-anonvote');
    expect(fs.every((f) => f.severity === 'low')).toBe(true);
    expect(fs.some((f) => f.kind === 'branch' && f.detail.includes('anonymous'))).toBe(true);
  });
  it('the same operation on both paths of a branch is not reported', () => {
    expect(one('case-balanced')).toEqual([]);
  });
  it('a tag scoped by a caller-chosen id is not one identity across actions', () => {
    expect(load('case-scoped').findings.filter((f) => f.kind === 'attributable')).toEqual([]);
  });
  it('the suppression example in the docs silences what it says it does', () => {
    const r = load('case-seeds-allow');
    expect(r.findings.some((f) => f.kind === 'published' && f.severity === 'medium' && f.suppressed)).toBe(true);
    expect(serious(r.findings)).toEqual([]);
  });
  it('a circuit result is public, like a ledger write', () => {
    expect(one('case-return')).toMatchObject([{ kind: 'secret-published', severity: 'critical', field: 'return' }]);
  });
  it('a shielded receive that only runs on a private condition shows the condition', () => {
    expect(one('case-shielded-guard')).toMatchObject([{ kind: 'branch', sources: [{ name: 'accept' }] }]);
  });
  it('an argument the source discloses directly is public on purpose', () => {
    const src = `pragma language_version 0.23;
export circuit f(role: Uint<8>): [] { const r = disclose(role); }`;
    const f = { kind: 'guessable-hash', severity: 'high', sources: [{ name: 'role', kind: 'argument' }], detail: '' } as unknown as Finding;
    const g = { ...f, sources: [{ name: 'v', kind: 'argument' }] } as unknown as Finding;
    declaredPublicForTest([f, g], src);
    expect([f.severity, g.severity]).toEqual(['low', 'high']);
  });
  it('a hash whose other inputs are public is only as strong as its private part', () => {
    const r = load('case-public-part');
    const g = (c: string) => r.findings.filter((f) => f.circuit === c && f.kind === 'guessable-hash');
    // the tag is written in the same call
    expect(g('vote')).toMatchObject([{ severity: 'critical', bits: 2, sources: [{ name: 'choice' }] }]);
    // the tag is on the ledger from another circuit
    expect(g('voteLate')).toMatchObject([{ severity: 'critical', bits: 2, sources: [{ name: 'choice' }] }]);
    // a struct with a public field
    expect(g('file')).toMatchObject([{ severity: 'critical', bits: 32, sources: [{ name: 'salary' }] }]);
    // a public tag next to 32 private bytes is fine
    expect(r.findings.filter((f) => f.circuit === 'note' && f.severity !== 'info' && f.severity !== 'low')).toEqual([]);
  });
  it('an officer key set in setup, an access check and a public epoch argument stay low', () => {
    const r = load('case-admin');
    expect(r.findings.filter((f) => f.severity !== 'info' && f.severity !== 'low')).toEqual([]);
    expect(r.findings.map((f) => [f.kind, f.severity]).sort()).toEqual(
      expect.arrayContaining([
        ['branch', 'low'],
        ['guessable-hash', 'low'],
        ['published', 'low'],
      ]),
    );
  });
});

// Wave 3: the constructor is read from the last compiler pass that still has it and analysed
// like a circuit, since what it writes is the contract's initial public state.
describe('constructors', () => {
  const ctor = (name: string) => load(name).findings.filter((f) => f.circuit === 'constructor');
  it('the raffle seal is a guessable hash written at deploy, on the constructor line', () => {
    const [f] = ctor('raffle-leaky').filter((f) => f.kind === 'guessable-hash');
    expect(f).toMatchObject({ severity: 'critical', bits: 14, sources: [{ name: 'winningNumber', kind: 'witness' }] });
    expect(fs.readFileSync(path.join(dir, 'src', 'raffle-leaky.compact'), 'utf8').split('\n')[f.line! - 1]).toContain('sealedDraw = disclose(seal(n))');
  });
  it('helpers, branches, loops and arguments in a constructor', () => {
    const fs_ = ctor('case-constructor');
    const by = (kind: string) => fs_.filter((f) => f.kind === kind);
    // a secret-named argument stored as-is
    expect(by('secret-published')).toMatchObject([{ severity: 'high', sources: [{ name: 'adminSecret', kind: 'argument' }] }]);
    // which field the deploy wrote depends on a private value (the loop and the else-branch are lowered)
    expect(by('branch')).toMatchObject([{ severity: 'medium', sources: [{ name: 'level' }] }]);
    // 32 private bytes written as-is
    expect(by('published').filter((f) => f.severity === 'medium')).toMatchObject([{ field: 'nonce', sources: [{ name: 'seed' }] }]);
    // a hash of the deployer's key through a helper circuit: an identifier, not a leak
    expect(by('linkable')).toMatchObject([{ severity: 'info', field: 'owner', sources: [{ name: 'secretKey' }] }]);
    // a fee passed in and disclosed on purpose
    expect(by('published').some((f) => f.severity === 'info' && f.sources[0].name === 'initialFee')).toBe(true);
    expect(fs_.every((f) => f.line && f.line >= 22 && f.line <= 35)).toBe(true);
  });
  it('a field only the constructor writes is constant: hashing it does not scope a tag', () => {
    // payband's employer is set at deploy; the circuit that compares against it still gets no new findings
    expect(serious(load('payband-fixed').findings)).toEqual([]);
  });
  it('official examples: constructors add nothing above low', () => {
    for (const n of ['battleship', 'bboard', 'canary', 'chips', 'election', 'private-bid', 'private-party', 'private-tip-jar', 'roulette', 'secret-message', 'silent-auction'])
      expect(serious(ctor(n)), n).toEqual([]);
  });
  it('lowering keeps the guard: a ledger write under an if runs only on that path', () => {
    const r = load('case-constructor');
    const c = r.circuits.find((c) => c.name === 'constructor')!;
    expect(c.ops.find((o) => o.field === 'tags')!.guardedBy).toContain('level');
    expect(c.ops.filter((o) => o.field === 'counter')).toHaveLength(2);
  });
});

// Wave 3: token operations. Minted and unshielded amounts are public by design; a coin's nonce
// decides whether its commitment hides the recipient.
describe('tokens', () => {
  const coin = (name: string) => load(name).findings.filter((f) => f.kind === 'shielded-coin');
  it('a nonce from public state or a wallet key: the recipient can be confirmed', () => {
    const fs_ = coin('case-coin-nonce');
    expect(fs_.map((f) => f.circuit)).toEqual(['mintKeyed']);
    expect(fs_[0]).toMatchObject({ severity: 'medium', sources: [{ name: 'ownPublicKey.bytes' }] });
  });
  it('a seeded nonce, or a mint to the contract itself, is not reported', () => {
    expect(coin('faucet-fixed')).toEqual([]);
    expect(coin('token-transfers')).toEqual([]);
  });
  it('a coin paid out of contract state: sendShielded derives its nonce from the stored, public nonce', () => {
    // private-tip-jar's withdraw sends a pot coin to ownPublicKey(): the pot coin's nonce, color and value are
    // public ledger state, so whether the withdrawal went to a given wallet can be checked.
    expect(coin('private-tip-jar')).toMatchObject([{ circuit: 'withdraw', severity: 'medium', sources: [{ name: 'ownPublicKey.bytes' }] }]);
  });
  it('a nonce the circuit returns is public too (low: the recipient is the caller\'s own argument)', () => {
    expect(coin('chips')).toMatchObject([{ circuit: 'mint', severity: 'low', sources: [{ name: 'recipient.bytes', kind: 'argument' }] }]);
  });
  it('a wallet key from private state written publicly is medium; from an argument it is info', () => {
    const fs_ = load('case-coin-nonce').findings.filter((f) => f.field === 'payees');
    expect(fs_.filter((f) => f.circuit === 'recordPayee' && f.severity !== 'info')).toMatchObject([{ kind: 'published', severity: 'medium', sources: [{ name: 'payee' }] }]);
    expect(fs_.filter((f) => f.circuit === 'registerPayee' && f.severity !== 'info')).toEqual([]);
  });
  it('a private amount moved as an unshielded transfer is medium; a public bond is nothing', () => {
    const [f] = load('deposit-leaky').findings.filter((f) => f.field === 'kernel' && f.severity === 'medium');
    expect(f.sources[0].name).toBe('bidAmount');
    expect(f.title).toContain('public token amount');
    expect(load('deposit-fixed').findings.filter((f) => f.field === 'kernel')).toEqual([]);
  });
  it('arguments as token amounts stay info (the caller chose them)', () => {
    const fs_ = load('token-transfers').findings.filter((f) => f.field === 'kernel');
    expect(fs_.every((f) => f.severity === 'info')).toBe(true);
  });
});

// Wave 3: Ledger 9 (Compact 0.33 and later). Events and cross-contract calls are public sinks.
describe('Ledger 9: events and contract calls', () => {
  const r = () => load('case-calls');
  const by = (c: string) => r().findings.filter((f) => f.circuit === c && f.severity !== 'info');
  it('a guessable hash passed to another contract is caught on the call', () => {
    expect(by('pushChoice')).toMatchObject([{ kind: 'guessable-hash', severity: 'critical', field: 'reg', op: 'record' }]);
  });
  it('which contract is called shows a private choice', () => {
    const [f] = by('route').filter((f) => f.kind === 'branch');
    expect(f).toMatchObject({ severity: 'medium', sources: [{ name: 'choice' }] });
    expect(f.fields).toEqual(expect.arrayContaining(['reg.record', 'other.record']));
  });
  it('the same call on both paths is not a branch', () => {
    expect(by('balanced').filter((f) => f.kind === 'branch')).toEqual([]);
  });
  it('a private amount in a token event is medium; an argument in an event is info', () => {
    expect(by('announce')).toMatchObject([{ kind: 'published', severity: 'medium', field: 'event', op: 'UnshieldedMint', sources: [{ name: 'bonus' }] }]);
    expect(by('spend')).toEqual([]);
    expect(r().findings.find((f) => f.circuit === 'spend')).toMatchObject({ field: 'event', op: 'ShieldedSpend', severity: 'info' });
  });
  it('events point at the emit line', () => {
    const f = by('announce')[0];
    expect(fs.readFileSync(path.join(dir, 'src', 'case-calls.compact'), 'utf8').split('\n')[f.line! - 1]).toContain('emit(UnshieldedMint');
  });
});

describe('suppression', () => {
  it('// tell:allow <kind> on the line silences that finding only', () => {
    const src = fs
      .readFileSync(path.join(dir, 'src', 'ballot-leaky.compact'), 'utf8')
      .replace('ballots.insert(tag, disclose(choiceHash(c)));', 'ballots.insert(tag, disclose(choiceHash(c))); // tell:allow guessable-hash');
    const r = analyzeIr(fs.readFileSync(path.join(dir, 'r2c', 'ballot-leaky.txt'), 'utf8'), src);
    expect(r.findings.find((f) => f.kind === 'guessable-hash')!.suppressed).toBe(true);
    expect(gradeOf(r.findings)).toBe('B');
  });
});

describe('pragmas and contract files', () => {
  it('matches language versions the way the compiler does', () => {
    expect(pragmaAccepts('0.23', '0.23.0')).toBe(true);
    expect(pragmaAccepts('0.23', '0.27.0')).toBe(false);
    expect(pragmaAccepts('>= 0.22 && <= 0.23', '0.23.0')).toBe(true);
    expect(pragmaAccepts('>= 0.25.0', '0.23.0')).toBe(false);
    expect(pragmaAccepts('>= 0.25.0', '0.27.0')).toBe(true);
  });
  it('0.36 prints types as operands; they are skipped, conversions are not', () => {
    const t = (s: string) => isTypeForm(parseAll(s)[0]);
    expect(t('(field-native)')).toBe(true);
    expect(t('(tfield (field-base (curve-secp256k1)))')).toBe(true);
    expect(t('(tunsigned 255)')).toBe(true);
    expect(t('(field->bytes 32 (field-native) %x.1)')).toBe(false);
    expect(t('(tuple %a.1 %b.2)')).toBe(false);
  });
  it('reads let* bindings in brackets, as the constructor pass prints them', () => {
    expect(parseAll('(let* ([(%x.1 (tbytes 32)) %y.2]) %x.1)')).toEqual(parseAll('(let* (((%x.1 (tbytes 32)) %y.2)) %x.1)'));
  });
  it('a Ledger 9 pragma skips 0.31.1 (language 0.23) and takes 0.36.0 (language 0.28)', () => {
    expect(pragmaAccepts('>= 0.25.0', '0.23.0')).toBe(false);
    expect(pragmaAccepts('>= 0.25.0', '0.28.0')).toBe(true);
    expect(pragmaAccepts('0.28', '0.28.0')).toBe(true);
  });
  it('takes the constructor from the last pass after inlining that still has it', () => {
    const trace = [
      'parse-file:',
      '(program (constructor () (seq (tuple))))',
      'inline-circuits:',
      '(program (public-ledger-declaration () (constructor () (seq "a (b" (tuple)))))',
      'drop-safe-casts:',
      '(program (public-ledger-declaration () (constructor ((%a.1 (tbytes 32))) (seq (public-ledger %f.0 (0) write %a.1) (tuple)))))',
      'resolve-indices/simplify:',
      '(program)',
      'reduce-to-circuit:',
      '(program)',
    ].join('\n');
    expect(constructorForm(trace, trace.indexOf('\nreduce-to-circuit:\n'))).toBe('(constructor ((%a.1 (tbytes 32))) (seq (public-ledger %f.0 (0) write %a.1) (tuple)))');
    expect(constructorForm('parse-file:\n(program (constructor () (tuple)))\nreduce-to-circuit:\n(program)', 50)).toBeNull();
  });
  it('tells contracts from modules', () => {
    expect(isContractFile('pragma language_version 0.23;\nexport circuit f(): [] {}')).toBe(true);
    expect(isContractFile('module Util { export circuit f(): [] {} }')).toBe(false);
  });
});

describe('other compilers', () => {
  // test/fixtures/r2c-legacy: the zoo compiled with 0.30.0, whose output binds `(= target expr)`
  // with guards inside calls. Findings must not depend on which compiler built the circuit.
  const sig = (fs: Finding[]) =>
    fs
      .filter((f) => f.severity !== 'info')
      .map((f) => `${f.circuit}/${f.kind}/${f.severity}/${f.field}`)
      .sort();
  // test/fixtures/r2c-0.36: the same zoo compiled with 0.36.0 (Ledger 9), which prints field types
  // as operands, e.g. (field->bytes 32 (field-native) x).
  for (const [sub, version] of [['r2c-legacy', '0.30.0'], ['r2c-0.36', '0.36.0']])
    for (const f of fs.readdirSync(path.join(dir, sub)).map((f) => f.replace('.txt', '')))
      it(`${f}: ${version} and 0.31.1 agree`, () => {
        const src = fs.readFileSync(path.join(dir, 'src', f + '.compact'), 'utf8');
        const other = analyzeIr(fs.readFileSync(path.join(dir, sub, f + '.txt'), 'utf8'), src);
        expect(other.unknownForms).toEqual([]);
        expect(sig(other.findings)).toEqual(sig(load(f).findings));
      });
});

describe('SARIF', () => {
  it('puts security severity on the rule, where GitHub reads it', () => {
    const report = load('ballot-leaky');
    const sarif = toSarif([{ file: path.join(dir, 'src', 'ballot-leaky.compact'), ok: true, report, grade: 'F' } as never], dir);
    const run = sarif.runs[0];
    const crit = run.tool.driver.rules.find((r) => r.id === 'tell/guessable-hash/critical')!;
    expect(crit.properties.tags).toContain('security');
    expect(crit.properties['security-severity']).toBe('9.5');
    for (const r of run.results) expect(run.tool.driver.rules[r.ruleIndex].id).toBe(r.ruleId);
    expect(run.results.find((r) => r.ruleId === crit.id)!.locations[0].physicalLocation.region.startLine).toBe(36);
  });
});

describe('command line', () => {
  // Needs the Compact compiler (CI installs 0.31.1).
  const cli = (args: string[]) => spawnSync('npx', ['tsx', 'src/cli.ts', ...args], { encoding: 'utf8', cwd: path.join(dir, '..', '..') });
  const has = findCompilersSync().length > 0;
  it.runIf(has)('exits 1 when a finding reaches --fail-on, 0 otherwise', () => {
    expect(cli(['../zoo/contracts/ballot-leaky.compact', '--fail-on', 'high']).status).toBe(1);
    expect(cli(['../zoo/contracts/ballot-fixed.compact', '--fail-on', 'medium']).status).toBe(0);
  }, 120_000);
});
