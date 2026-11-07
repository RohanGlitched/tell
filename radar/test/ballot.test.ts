// Acceptance: from Preprod chain data alone (a cached snapshot, no network and
// no source code), Radar reads every vote off Tell's leaky ballot and nothing
// off the fixed one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, type Analysis, digest } from '../src/analyze.js';
import type { ContractRecord } from '../src/chain.js';
import { aggregate } from '../src/report.js';
import { decodeCalls, decodeState, isOpaque32 } from '../src/state.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `ballot-${n}.json`), 'utf8')) as ContractRecord;
const leaky = load('leaky');
const fixed = load('fixed');

describe('state decoding', () => {
  it('reads the ballot state as two maps of 32-byte values, no names needed', () => {
    for (const r of [leaky, fixed]) {
      const s = decodeState(r.state);
      expect(s.entryPoints.sort()).toEqual(['register', 'vote']);
      expect(s.maps.map((m) => m.entries)).toEqual([6, 6]);
      expect(s.cells.filter((c) => c.role === 'key')).toHaveLength(12);
      expect(s.cells.filter((c) => c.role === 'value')).toHaveLength(6);
      expect(s.cells.every((c) => c.atoms.every((a) => a.len === 32))).toBe(true);
      expect(s.maps[1].valueDigests).toHaveLength(6);
    }
  });

  it('reads the values each call put in its public transcript', () => {
    const vote = leaky.actions.find((a) => a.entryPoint === 'vote')!;
    const calls = decodeCalls(vote.raw, leaky.address);
    expect(calls).toHaveLength(1);
    expect(calls[0].entryPoint).toBe('vote');
    const opaque = calls[0].atoms.filter(isOpaque32).map((a) => a.hex);
    // the voter's tag (checked, then used as the key) and the stored vote
    const state = decodeState(leaky.state);
    const stored = state.cells.filter((c) => c.role === 'value').map((c) => c.atoms[0].hex);
    expect(opaque.some((v) => stored.includes(v))).toBe(true);
    expect(decodeCalls(vote.raw, fixed.address)).toEqual([]); // other contracts' calls are not mixed in
  });

  it('tells digests from small numbers and padded labels', () => {
    expect(isOpaque32({ kind: 'bytes', len: 32, hex: '02'.padEnd(64, '0') })).toBe(false);
    expect(isOpaque32({ kind: 'bytes', len: 32, hex: Buffer.from('ballot:choice'.padEnd(32, '\0')).toString('hex') })).toBe(false);
    expect(isOpaque32({ kind: 'bytes', len: 32, hex: 'e73f93026f6ff45f15993abb1f5f12dd148413cc25c0af332cb71782726b687b' })).toBe(true);
  });
});

describe('ballot acceptance', () => {
  let a: Analysis;
  it('runs the default brute force over both ballots', async () => {
    a = await analyze([leaky, fixed].map(digest));
    expect(a.contracts).toHaveLength(2);
  });

  it('recovers all six votes from the leaky ballot', () => {
    const c = a.contracts.find((x) => x.address === leaky.address)!;
    const votes = c.recoveries.flatMap((r) => r.locations.filter((l) => l.address === leaky.address && l.where === 'state' && l.role === 'value').map(() => r.value));
    expect(votes).toHaveLength(6);
    const tally = votes.reduce<Record<string, number>>((t, v) => ((t[v] = (t[v] ?? 0) + 1), t), {});
    // candidates 0..3 are Asha, Bilal, Chen, Dara; the six votes were Chen, Asha, Chen, Bilal, Dara, Chen
    expect(tally).toEqual({ '0': 1, '1': 1, '2': 3, '3': 1 });
    for (const r of c.recoveries) expect(r.expr).toMatch(/^persistentHash<Vector<2, Bytes<32>>>\(\[pad\(32, "ballot:choice"\), [0-3] as Field as Bytes<32>\]\)$/);
    expect(c.repeated).toEqual([{ path: '1', entries: 6, distinct: 4, recovered: 6 }]);
  });

  it('recovers nothing from the fixed ballot', () => {
    const c = a.contracts.find((x) => x.address === fixed.address)!;
    expect(c.recoveries).toEqual([]);
    expect(c.repeated).toEqual([]); // salted commitments never repeat
  });

  it('links each voter\'s register call to their vote, in both ballots', () => {
    for (const r of [leaky, fixed]) {
      const c = a.contracts.find((x) => x.address === r.address)!;
      expect(c.calls).toBe(4);
      const links = c.clusters.filter((k) => k.entryPoints.join() === 'register,vote');
      expect(links).toHaveLength(2);
      expect(links.every((k) => k.calls === 2 && !k.constant)).toBe(true);
    }
  });

  it('publishes counts only, plus the named own contracts', () => {
    const agg = aggregate(a, 'preprod', {}, { [leaky.address]: 'tell-ballot-leaky', [fixed.address]: 'tell-ballot-fixed' });
    expect(agg.own['tell-ballot-leaky']).toMatchObject({ entries: 6, recovered: 6, values: { '0': 1, '1': 1, '2': 3, '3': 1 } });
    expect(agg.own['tell-ballot-fixed']).toMatchObject({ recovered: 0, repeated: null });
    expect(agg.guessableHashes.valuesRecovered).toBe(4);
    const anon = aggregate(a, 'preprod', {}, {});
    const text = JSON.stringify(anon);
    expect(text).not.toContain(leaky.address);
    expect(text).not.toContain('e73f93026f6ff45f');
  });
});
