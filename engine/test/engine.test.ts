// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Precision tests: what Tell must report, and what it must not.

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { analyzeIr, gradeOf, pragmaAccepts, isContractFile, type Finding } from '../src/index.js';

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
    expect(f.bits).toBe(8);
    expect(f.detail).toContain('256 tries');
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
    expect(new Set(tag.map((f) => f.circuit))).toEqual(new Set(['registerToVote', 'commitVote', 'revealVote']));
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

  it('shielded-coin plumbing is not reported as a leak', () => {
    for (const n of ['chips', 'token-transfers', 'private-tip-jar'])
      expect(load(n).findings.filter((f) => (f.fields ?? []).some((x) => /claimZswap|kernel\.self|mintShielded/.test(x)))).toEqual([]);
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
    expect(one('case-income')).toMatchObject([{ kind: 'branch', severity: 'medium', sources: [{ name: 'individualIncome' }] }]);
  });
  it('a membership leaf and a nullifier from the same key are not linked', () => {
    expect(load('case-nullifier').findings.filter((f) => f.kind === 'linkable' && f.severity !== 'info')).toEqual([]);
  });
  it('a guessable hash of a circuit argument is not waved through', () => {
    expect(one('case-vote-arg')).toMatchObject([{ kind: 'guessable-hash', severity: 'medium', sources: [{ name: 'choice' }] }]);
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
  it('tells contracts from modules', () => {
    expect(isContractFile('pragma language_version 0.23;\nexport circuit f(): [] {}')).toBe(true);
    expect(isContractFile('module Util { export circuit f(): [] {} }')).toBe(false);
  });
});
