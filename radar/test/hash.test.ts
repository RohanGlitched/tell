// Radar's fast persistentHash must agree with the Compact runtime, byte for byte.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { type Family, familySize, preimage } from '../src/families.js';
import { le, pad32, sha256 } from '../src/hash.js';
import { loadTable } from '../src/table.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const B32 = new rt.CompactTypeBytes(32);
const U = (bits: number) => new rt.CompactTypeUnsignedInteger((1n << BigInt(bits)) - 1n, bits / 8);
// [Bytes<32>, Uint<n>] as a compiled contract's tuple type would build it
const tuple = <A, B>(a: rt.CompactType<A>, b: rt.CompactType<B>): rt.CompactType<[A, B]> =>
  ({
    alignment: () => [...a.alignment(), ...b.alignment()],
    toValue: ([x, y]: [A, B]) => [...a.toValue(x), ...b.toValue(y)],
    fromValue: () => { throw new Error('unused'); },
  }) as unknown as rt.CompactType<[A, B]>;

describe('persistentHash encoding', () => {
  it('matches the runtime for unsigned integers of every width', () => {
    for (const bits of [8, 16, 32, 64, 128]) {
      for (const v of [0n, 1n, 3n, 255n, (1n << BigInt(bits)) - 1n, 0x123456n & ((1n << BigInt(bits)) - 1n)]) {
        expect(hex(sha256(le(v, bits / 8))), `Uint<${bits}> ${v}`).toBe(hex(rt.persistentHash(U(bits), v)));
      }
    }
  });

  it('matches the runtime for Field, Boolean and Bytes<32>', () => {
    for (const v of [0n, 2n, 1n << 200n]) expect(hex(sha256(le(v, 32)))).toBe(hex(rt.persistentHash(rt.CompactTypeField, v)));
    expect(hex(sha256(Buffer.from([1])))).toBe(hex(rt.persistentHash(rt.CompactTypeBoolean, true)));
    expect(hex(sha256(Buffer.from([0])))).toBe(hex(rt.persistentHash(rt.CompactTypeBoolean, false)));
    expect(hex(sha256(pad32('yes')))).toBe(hex(rt.persistentHash(B32, new Uint8Array(pad32('yes')))));
  });

  it('matches the runtime for domain-separated pairs', () => {
    const V2 = new rt.CompactTypeVector(2, B32);
    for (const v of [0, 5, 255]) {
      const want = rt.persistentHash(V2, [new Uint8Array(pad32('app:thing')), new Uint8Array(le(v, 32))]);
      expect(hex(sha256(Buffer.concat([pad32('app:thing'), le(v, 32)])))).toBe(hex(want));
      const t = tuple(B32, U(8));
      expect(hex(sha256(Buffer.concat([pad32('app'), le(v, 1)])))).toBe(hex(rt.persistentHash(t, [new Uint8Array(pad32('app')), BigInt(v)])));
    }
  });

  it('every family builds the preimage the runtime would hash', () => {
    const V2 = new rt.CompactTypeVector(2, B32);
    const fams: [Family, (i: number) => Uint8Array][] = [
      [{ kind: 'uint', width: 4, count: 1 << 20 }, (i) => rt.persistentHash(U(32), BigInt(i))],
      [{ kind: 'uint', width: 32, count: 1 << 20 }, (i) => rt.persistentHash(rt.CompactTypeField, BigInt(i))],
      [{ kind: 'word', words: ['alpha', 'beta:gamma'] }, (i) => rt.persistentHash(B32, new Uint8Array(pad32(['alpha', 'beta:gamma'][i])))],
      [{ kind: 'tagged', prefixes: ['a', 'b:c'], width: 32, count: 300 }, (i) => rt.persistentHash(V2, [new Uint8Array(pad32(['a', 'b:c'][Math.floor(i / 300)])), new Uint8Array(le(i % 300, 32))])],
      [{ kind: 'tagged', prefixes: ['x', 'y'], width: 8, count: 1000 }, (i) => rt.persistentHash(tuple(B32, U(64)), [new Uint8Array(pad32(['x', 'y'][Math.floor(i / 1000)])), BigInt(i % 1000)])],
      [{ kind: 'taggedWord', prefixes: ['p'], words: ['q', 'r'] }, (i) => rt.persistentHash(V2, [new Uint8Array(pad32('p')), new Uint8Array(pad32(['q', 'r'][i]))])],
    ];
    for (const [f, want] of fams) {
      const n = familySize(f);
      for (const i of [0, 1, n - 1, Math.floor(n / 2)]) expect(hex(sha256(preimage(f, i))), `${f.kind} ${i}`).toBe(hex(want(i)));
    }
  });
});

describe('precomputed table', () => {
  it('finds values by digest and only those', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-table-'));
    const f: Family = { kind: 'uint', width: 2, count: 1 << 16 };
    const t = await loadTable(f, dir, { threads: 1 });
    for (const v of [0, 7, 4242, 65535]) expect(t.lookup(Buffer.from(rt.persistentHash(U(16), BigInt(v))))).toEqual([v]);
    expect(t.lookup(sha256(Buffer.from('nothing')))).toEqual([]);
    // reloaded from disk, same answers
    const again = await loadTable(f, dir, { threads: 1 });
    expect(again.lookup(Buffer.from(rt.persistentHash(U(16), 4242n)))).toEqual([4242]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
