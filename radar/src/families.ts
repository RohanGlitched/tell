// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The small domains Radar hashes. A family is a numbered list of preimages:
// entry i can be rebuilt from (family, i) alone, so a hit is proved by
// recomputing it. Families are plain data so worker threads can share them.

import { le, pad32 } from './hash.js';

/** Atom widths: Uint<8>=1, Uint<16>=2, Uint<32>=4, Uint<64>=8, Uint<128>=16, Field or Bytes<32>=32. */
export type Width = 1 | 2 | 4 | 8 | 16 | 32;

export type Family =
  /** persistentHash<Uint<8w>>(v) for v < count; width 32 is Field (or Bytes<32> holding v). */
  | { kind: 'uint'; width: Width; count: number }
  /** persistentHash<Bytes<32>>(pad(32, w)). */
  | { kind: 'word'; words: string[] }
  /** persistentHash of [pad(32, p), v] with v at `width`, for every prefix p and v < count. */
  | { kind: 'tagged'; prefixes: string[]; width: Width; count: number }
  /** persistentHash<Vector<2, Bytes<32>>>([pad(32, p), pad(32, w)]). */
  | { kind: 'taggedWord'; prefixes: string[]; words: string[] };

export function familySize(f: Family): number {
  switch (f.kind) {
    case 'uint': return f.count;
    case 'word': return f.words.length;
    case 'tagged': return f.prefixes.length * f.count;
    case 'taggedWord': return f.prefixes.length * f.words.length;
  }
}

/** The bytes persistentHash would digest for entry i. */
export function preimage(f: Family, i: number): Buffer {
  switch (f.kind) {
    case 'uint': return le(i, f.width);
    case 'word': return pad32(f.words[i]);
    case 'tagged': return Buffer.concat([pad32(f.prefixes[Math.floor(i / f.count)]), le(i % f.count, f.width)]);
    case 'taggedWord': {
      const n = f.words.length;
      return Buffer.concat([pad32(f.prefixes[Math.floor(i / n)]), pad32(f.words[i % n])]);
    }
  }
}

/**
 * The same preimages as `preimage`, written into one reused buffer: the hot loop
 * allocates nothing but the digest. The returned view is valid until the next call.
 */
export function preimageFiller(f: Family): (i: number) => Buffer {
  const buf = Buffer.alloc(64);
  const putLE = (off: number, width: number, v: number) => {
    buf.fill(0, off, off + width);
    for (let k = 0; k < width && v > 0; k++) {
      buf[off + k] = v % 256;
      v = Math.floor(v / 256);
    }
  };
  const putStr = (off: number, s: string) => {
    buf.fill(0, off, off + 32);
    buf.write(s, off, 32, 'utf8');
  };
  switch (f.kind) {
    case 'uint':
      return (i) => { putLE(0, f.width, i); return buf.subarray(0, f.width); };
    case 'word':
      return (i) => { putStr(0, f.words[i]); return buf.subarray(0, 32); };
    case 'tagged': {
      let last = -1;
      return (i) => {
        const p = Math.floor(i / f.count);
        if (p !== last) { putStr(0, f.prefixes[p]); last = p; }
        putLE(32, f.width, i % f.count);
        return buf.subarray(0, 32 + f.width);
      };
    }
    case 'taggedWord': {
      let last = -1;
      const n = f.words.length;
      return (i) => {
        const p = Math.floor(i / n);
        if (p !== last) { putStr(0, f.prefixes[p]); last = p; }
        putStr(32, f.words[i % n]);
        return buf.subarray(0, 64);
      };
    }
  }
}

const TYPE: Record<Width, string> = { 1: 'Uint<8>', 2: 'Uint<16>', 4: 'Uint<32>', 8: 'Uint<64>', 16: 'Uint<128>', 32: 'Field' };

/** What entry i is, written the way a Compact developer would write it. */
export function describe(f: Family, i: number): { type: string; expr: string; value: string; domain: string } {
  switch (f.kind) {
    case 'uint': return { type: TYPE[f.width], expr: `persistentHash<${TYPE[f.width]}>(${i})`, value: String(i), domain: `${TYPE[f.width]} < ${f.count}` };
    case 'word': return { type: 'Bytes<32>', expr: `persistentHash<Bytes<32>>(pad(32, "${f.words[i]}"))`, value: f.words[i], domain: 'short label' };
    case 'tagged': {
      const p = f.prefixes[Math.floor(i / f.count)];
      const v = i % f.count;
      const second = f.width === 32 ? `${v} as Field as Bytes<32>` : `${v} as ${TYPE[f.width]}`;
      const type = f.width === 32 ? 'Vector<2, Bytes<32>>' : `[Bytes<32>, ${TYPE[f.width]}]`;
      return { type, expr: `persistentHash<${type}>([pad(32, "${p}"), ${second}])`, value: String(v), domain: `prefixed ${TYPE[f.width]} < ${f.count}` };
    }
    case 'taggedWord': {
      const n = f.words.length;
      const p = f.prefixes[Math.floor(i / n)];
      const w = f.words[i % n];
      return { type: 'Vector<2, Bytes<32>>', expr: `persistentHash<Vector<2, Bytes<32>>>([pad(32, "${p}"), pad(32, "${w}")])`, value: w, domain: 'prefixed label' };
    }
  }
}

export function familyName(f: Family): string {
  switch (f.kind) {
    case 'uint': return `uint${f.width * 8}<${f.count}`;
    case 'word': return `word(${f.words.length})`;
    case 'tagged': return `tagged${f.width * 8}(${f.prefixes.length}x${f.count})`;
    case 'taggedWord': return `taggedWord(${f.prefixes.length}x${f.words.length})`;
  }
}
