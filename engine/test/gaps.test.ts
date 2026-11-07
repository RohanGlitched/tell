// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The gaps the head-to-head benchmark found (bench/GAPS-FOR-TELL.md): a published hash used as a
// private key, membership shown by a lookup, tags that link across contracts, what a circuit's
// result and a branch really reveal on Midnight, and declared intent (tell.json). Each rule has a
// positive and look-alikes that must stay quiet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { analyzeIr, findPolicyFile, parsePolicy, policyFor, resolvePolicy, callerOf, type Finding, type Policy } from '../src/index.js';

const dir = path.join(__dirname, 'fixtures');
const load = (name: string, policy?: Policy) =>
  analyzeIr(
    fs.readFileSync(path.join(dir, 'r2c', name + '.txt'), 'utf8'),
    fs.readFileSync(path.join(dir, 'src', name + '.compact'), 'utf8'),
    policy ? resolvePolicy(policy, null, name + '.compact') : undefined,
  );
const by = (fs_: Finding[], circuit: string) => fs_.filter((f) => f.circuit === circuit);
const serious = (fs_: Finding[]) => fs_.filter((f) => !f.suppressed && f.severity !== 'info' && f.severity !== 'low');

describe('a published hash used as a private key (L16)', () => {
  const r = () => load('case-derived-key').findings;
  it('the scalar is the published id: critical, on the public key', () => {
    expect(by(r(), 'register').filter((f) => f.kind === 'derivable-secret')).toMatchObject([{ severity: 'critical', field: 'encKey', sources: [{ name: 'seed' }] }]);
  });
  it('the scalar is a public function of the published id: still critical', () => {
    expect(by(r(), 'share').filter((f) => f.kind === 'derivable-secret')).toMatchObject([{ severity: 'critical', field: 'shareKey' }]);
  });
  it('look-alikes stay quiet: the secret itself as scalar, separate domains, a public challenge', () => {
    for (const c of ['own', 'separate', 'check']) expect(serious(by(r(), c)), c).toEqual([]);
    expect(r().filter((f) => f.kind === 'derivable-secret').map((f) => f.circuit).sort()).toEqual(['register', 'share']);
  });
  it('publishing ecMulGenerator(k) does not count as publishing k', () => {
    // keyring-fixed publishes hash("account", s) and ecMulGenerator(hash("enc-key", s))
    expect(load('keyring-fixed').findings.filter((f) => f.kind === 'derivable-secret')).toEqual([]);
    expect(load('keyring-leaky').findings.filter((f) => f.kind === 'derivable-secret')).toHaveLength(1);
  });
  it('the bench pair: L16 is caught, S13 (separate domains) is not', () => {
    // same shapes as bench/cases/L16 and S13, compiled into case-derived-key (register, separate)
    expect(by(r(), 'separate').some((f) => f.kind === 'derivable-secret')).toBe(false);
  });
});

describe('membership shown by looking up the caller\'s tag (L11)', () => {
  const r = (p?: Policy) => load('case-member-lookup', p).findings;
  it('an "anonymous" claim that tests members.member(hash(key)) names the member: medium', () => {
    const [f] = by(r(), 'claim');
    expect(f).toMatchObject({ kind: 'linkable', severity: 'medium', field: 'members' });
    expect(f.title).toContain('which member');
    expect(f.fix).toContain('checkRoot');
  });
  it('an officer check and a one-time nullifier stay info', () => {
    expect(by(r(), 'pause').map((f) => f.severity)).toEqual(['info']);
    expect(by(r(), 'redeem').map((f) => f.severity)).toEqual(['info']);
  });
  it('declared intent: an identified caller, or a once-per-member circuit, is not a leak', () => {
    expect(by(r({ circuits: { claim: { caller: 'identified' } } }), 'claim').map((f) => f.severity)).toEqual(['info']);
    expect(by(r({ circuits: { claim: { once: true } } }), 'claim').map((f) => f.severity)).toEqual(['info']);
  });
  it('the Merkle version of the same club reports nothing above info', () => {
    expect(serious(load('club-fixed').findings)).toEqual([]);
    expect(load('club-fixed').findings.every((f) => f.severity === 'info')).toBe(true);
  });
});

describe('tags that link across contracts', () => {
  const r = () => load('case-cross-link').findings;
  it('no domain separator and no contract address: low, says why', () => {
    const [f] = by(r(), 'joinPlain');
    expect(f).toMatchObject({ kind: 'linkable', severity: 'low' });
    expect(f.detail).toContain('no domain separator and no contract address');
  });
  it('a domain separator but no contract address: info, with one sentence', () => {
    const [f] = by(r(), 'joinTagged');
    expect(f.severity).toBe('info');
    expect(f.detail).toContain('domain separator but no contract address');
  });
  it('the contract address mixed in, or a hash of content: at most info, no cross-contract note', () => {
    for (const c of ['joinScoped', 'note'])
      for (const f of by(r(), c)) {
        expect(f.severity, c).toBe('info');
        expect(f.detail, c).not.toContain('contract address');
      }
    expect(by(r(), 'note')).toHaveLength(1);
  });
  it('a public key (ecMulGenerator) gets no hashing advice', () => {
    expect(by(load('case-derived-key').findings, 'own').every((f) => f.severity === 'info')).toBe(true);
  });
});

describe('what a circuit result reveals', () => {
  it('a returned secret leaves the proof but is not on chain: low, with the reason', () => {
    const [f] = load('case-return').findings;
    expect(f).toMatchObject({ kind: 'secret-published', severity: 'low', field: 'return' });
    expect(f.title).toContain('returned');
    expect(f.detail).toContain('randomized commitment');
  });
  it('a value returned to the DApp is not treated as public elsewhere (chips mint keeps its nonce)', () => {
    // shielded-chips returns the minted coin's info, nonce included, to the DApp: nothing is on chain
    expect(load('chips').findings.filter((f) => f.kind === 'shielded-coin')).toEqual([]);
  });
});

describe('branches when nothing identifies the caller', () => {
  it('low, and the finding says what that rests on', () => {
    const [f] = by(load('case-intent').findings, 'check');
    expect(f).toMatchObject({ kind: 'branch', severity: 'low' });
    expect(f.detail).toContain('DUST');
    expect(f.detail).toContain('"caller": "identified"');
  });
  it('medium when the policy says callers are identified', () => {
    expect(by(load('case-intent', { caller: 'identified' }).findings, 'check')).toMatchObject([{ kind: 'branch', severity: 'medium' }]);
    expect(by(load('case-intent', { circuits: { check: { caller: 'identified' } } }).findings, 'check')).toMatchObject([{ severity: 'medium' }]);
  });
  it('the same operation on both sides of a branch: nothing at any severity (bench S05)', () => {
    expect(by(load('case-intent').findings, 'balanced')).toEqual([]);
  });
  it('every branch lowered for an anonymous caller carries the note', () => {
    for (const n of ['case-intent', 'case-income']) {
      const low = load(n).findings.filter((f) => f.kind === 'branch' && f.severity === 'low');
      expect(low.length, n).toBeGreaterThan(0);
      for (const f of low) expect(f.detail, n).toContain('anonymous choices');
    }
  });
});

describe('declared intent (tell.json)', () => {
  const policy: Policy = {
    witnesses: { reading: 'secret', code: 'public' },
    circuits: { enroll: { once: true } },
    intended: [{ kind: 'published', field: 'winner', reason: 'the draw is public' }],
  };
  it('without a policy: Tell guesses from names and shape', () => {
    const r = load('case-intent').findings;
    expect(by(r, 'enroll').filter((f) => f.kind === 'attributable')).toMatchObject([{ severity: 'medium' }]);
    expect(by(r, 'report')).toMatchObject([{ kind: 'published', severity: 'low' }]);
    expect(by(r, 'publish')).toMatchObject([{ kind: 'guessable-hash', severity: 'critical' }]);
    expect(by(r, 'draw')[0].suppressed).toBeFalsy();
  });
  it('once: a tag stored once per holder is not an attribution (bench S07)', () => {
    const r = load('case-intent', policy).findings;
    expect(by(r, 'enroll').filter((f) => f.kind === 'attributable')).toEqual([]);
    expect(serious(by(r, 'enroll'))).toEqual([]);
  });
  it('a witness declared secret is a secret when published, whatever its name', () => {
    expect(by(load('case-intent', policy).findings, 'report')).toMatchObject([{ kind: 'secret-published', severity: 'high', sources: [{ name: 'reading' }] }]);
  });
  it('a witness declared public adds no secrecy to a hash', () => {
    expect(by(load('case-intent', policy).findings, 'publish').filter((f) => f.kind === 'guessable-hash')).toEqual([]);
  });
  it('an intended disclosure is kept, suppressed, with the reason', () => {
    const [f] = by(load('case-intent', policy).findings, 'draw');
    expect(f).toMatchObject({ suppressed: true, suppressedBy: 'policy: the draw is public' });
  });
  it('an argument declared secret ranks like a witness', () => {
    const r = load('case-vote-arg').findings.filter((f) => f.kind === 'guessable-hash');
    const s = load('case-vote-arg', { arguments: { choice: 'secret' } }).findings.filter((f) => f.kind === 'guessable-hash');
    expect(r[0].severity).toBe('high');
    expect(s[0].severity).toBe('critical');
    expect(s[0].detail).not.toContain('Arguments are often public');
  });
});

describe('names that say "secret" but describe a derived value (from Nightshade\'s corpus)', () => {
  it('a secretCommitment or a secretHash written to the ledger is not a secret key in the clear', () => {
    const r = load('case-secret-names').findings;
    expect(serious(by(r, 'constructor'))).toEqual([]);
    expect(serious(by(r, 'setTag'))).toEqual([]);
  });
  it('a secretKey still is', () => {
    expect(by(load('case-secret-names').findings, 'leak')).toMatchObject([{ kind: 'secret-published', severity: 'critical' }]);
  });
});

describe('policy files', () => {
  it('rejects what it does not understand, with the place', () => {
    expect(() => parsePolicy('{"witnesess": {}}', 'tell.json')).toThrow(/unknown key "witnesess"/);
    expect(() => parsePolicy('{"witnesses": {"k": "private"}}')).toThrow(/"secret" or "public"/);
    expect(() => parsePolicy('{"circuits": {"c": {"caller": "known"}}}')).toThrow(/anonymous" or "identified/);
    expect(() => parsePolicy('{"intended": [{"reason": "x"}]}')).toThrow(/at least one of/);
    expect(() => parsePolicy('{"intended": [{"kind": "leak"}]}')).toThrow(/kind must be one of/);
    expect(() => parsePolicy('{"version": 2}')).toThrow(/version must be 1/);
    expect(() => parsePolicy('{')).toThrow(/not valid JSON/);
  });
  it('per-file settings merge over the top level, by relative path or file name', () => {
    const p = parsePolicy(JSON.stringify({ caller: 'identified', circuits: { a: { once: true } }, files: { 'sub/x.compact': { circuits: { a: { caller: 'anonymous' } } }, 'y.compact': { witnesses: { k: 'secret' } } } }));
    const x = resolvePolicy(p, '/repo/tell.json', '/repo/sub/x.compact');
    expect(x.circuits!.a).toEqual({ once: true, caller: 'anonymous' });
    expect(callerOf(x, 'a')).toBe('anonymous');
    expect(callerOf(x, 'b')).toBe('identified');
    expect(resolvePolicy(p, '/repo/tell.json', '/repo/deep/y.compact').witnesses).toEqual({ k: 'secret' });
    expect(resolvePolicy(p, '/repo/tell.json', '/repo/z.compact').witnesses).toEqual({});
  });
  it('a circuit called constructor does not find Object.prototype', () => {
    expect(callerOf({}, 'constructor')).toBe('anonymous');
    expect(callerOf({ circuits: { constructor: { caller: 'identified' as const } } }, 'constructor')).toBe('identified');
  });
  it('the nearest tell.json or .tellrc.json applies, up to the repository root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-policy-'));
    fs.mkdirSync(path.join(root, 'repo', 'contracts', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(root, 'repo', '.git'));
    fs.writeFileSync(path.join(root, 'tell.json'), '{}'); // outside the repository: never used
    const file = path.join(root, 'repo', 'contracts', 'deep', 'a.compact');
    expect(findPolicyFile(file)).toBeNull();
    fs.writeFileSync(path.join(root, 'repo', '.tellrc.json'), '{"caller": "identified"}');
    expect(findPolicyFile(file)).toBe(path.join(root, 'repo', '.tellrc.json'));
    fs.writeFileSync(path.join(root, 'repo', 'contracts', 'tell.json'), '{"caller": "anonymous"}');
    expect(findPolicyFile(file)).toBe(path.join(root, 'repo', 'contracts', 'tell.json'));
    expect(policyFor(file)!.caller).toBe('anonymous');
    expect(policyFor(file, { policyFile: null })).toBeUndefined();
    // saved scan results under the same name are not a policy
    fs.writeFileSync(path.join(root, 'repo', 'contracts', 'tell.json'), '[{"file": "a.compact"}]');
    expect(policyFor(file)).toBeUndefined();
  });
});

describe('command line with a policy', () => {
  const has = fs.existsSync(path.join(os.homedir(), '.compact', 'versions')) || !!process.env.TELL_COMPILERS;
  it.runIf(has)('--policy applies a file, --no-policy ignores the one next to the contract', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-cli-policy-'));
    fs.mkdirSync(path.join(tmp, '.git'));
    const file = path.join(tmp, 'intent.compact');
    fs.copyFileSync(path.join(dir, 'src', 'case-intent.compact'), file);
    fs.writeFileSync(path.join(tmp, 'tell.json'), JSON.stringify({ circuits: { enroll: { once: true } } }));
    const run = (...a: string[]) => JSON.parse(spawnSync('npx', ['tsx', 'src/cli.ts', file, '--json', ...a], { encoding: 'utf8', cwd: path.join(dir, '..', '..') }).stdout)[0];
    const found = run();
    expect(found.report.policy).toBe(path.join(tmp, 'tell.json'));
    expect(found.report.findings.some((f: Finding) => f.kind === 'attributable')).toBe(false);
    const none = run('--no-policy');
    expect(none.report.policy).toBeUndefined();
    expect(none.report.findings.some((f: Finding) => f.kind === 'attributable')).toBe(true);
  }, 300_000);
});
