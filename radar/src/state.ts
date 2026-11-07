// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Contract state and transactions as Radar sees them: no source code, no field
// names, only the shape the ledger stores (cells, maps, arrays, Merkle trees)
// and the values each call pushed in its public transcript.

import { ContractState, type StateValue } from '@midnight-ntwrk/compact-runtime';
import { Transaction } from '@midnight-ntwrk/ledger-v8';

export type Atom = { kind: 'bytes' | 'field' | 'compress'; len: number; hex: string };
export type Cell = { path: string; role: 'cell' | 'key' | 'value'; atoms: Atom[] };
export type MapInfo = { path: string; entries: number; valueDigests: string[] };
export type DecodedState = { entryPoints: string[]; cells: Cell[]; maps: MapInfo[]; merkleTrees: number };

type AlignmentSegment = { tag: 'atom'; value: { tag: 'bytes'; length: number } | { tag: 'field' } | { tag: 'compress' } } | { tag: 'option'; value: AlignmentSegment[][] };
type Aligned = { value: Uint8Array[]; alignment: AlignmentSegment[] };

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Pads each atom to the width its alignment gives, the way persistentHash sees it. */
export function atomsOf(av: Aligned): Atom[] {
  const out: Atom[] = [];
  const flat: AlignmentSegment[] = [];
  const visit = (segs: AlignmentSegment[]) => {
    for (const s of segs) {
      if (s.tag === 'atom') flat.push(s);
      else if (s.value.length) visit(s.value[0]); // options: the first arm; enough for the common cases
    }
  };
  visit(av.alignment);
  av.value.forEach((v, i) => {
    const a = flat[i];
    if (!a || a.tag !== 'atom') return;
    if (a.value.tag === 'bytes') {
      const b = Buffer.alloc(a.value.length);
      Buffer.from(v).copy(b, 0, 0, Math.min(v.length, a.value.length));
      out.push({ kind: 'bytes', len: a.value.length, hex: b.toString('hex') });
    } else if (a.value.tag === 'field') {
      const b = Buffer.alloc(32);
      Buffer.from(v).copy(b, 0, 0, Math.min(v.length, 32));
      out.push({ kind: 'field', len: 32, hex: b.toString('hex') });
    } else out.push({ kind: 'compress', len: v.length, hex: hex(v) });
  });
  return out;
}

/** A 32-byte atom that looks like a digest or a key rather than a small number or a padded label. */
export function isOpaque32(a: Atom): boolean {
  if (a.len !== 32 || a.kind === 'compress') return false;
  const b = Buffer.from(a.hex, 'hex');
  let zeros = 0;
  for (const x of b) if (x === 0) zeros++;
  if (zeros > 8) return false;
  // pad(32, "some label"): printable ASCII then zeros
  let printable = 0;
  for (const x of b) if (x >= 0x20 && x < 0x7f) printable++;
  return printable < 30;
}

export function decodeState(stateHex: string): DecodedState {
  const cs = ContractState.deserialize(Buffer.from(stateHex, 'hex'));
  const entryPoints = cs.operations().map((o) => (typeof o === 'string' ? o : hex(o)));
  const cells: Cell[] = [];
  const maps: MapInfo[] = [];
  let merkleTrees = 0;
  const walk = (v: StateValue, path: string) => {
    switch (v.type()) {
      case 'cell':
        cells.push({ path, role: 'cell', atoms: atomsOf(v.asCell() as Aligned) });
        break;
      case 'array':
        v.asArray()!.forEach((x, i) => walk(x, path ? `${path}.${i}` : String(i)));
        break;
      case 'map': {
        const m = v.asMap()!;
        const keys = m.keys();
        const info: MapInfo = { path, entries: keys.length, valueDigests: [] };
        for (const k of keys) {
          const ka = atomsOf(k as Aligned);
          cells.push({ path: `${path}{}`, role: 'key', atoms: ka });
          const child = m.get(k)!;
          const kp = `${path}[${ka.map((a) => a.hex.slice(0, 8)).join(',')}]`;
          if (child.type() === 'cell') {
            const va = atomsOf(child.asCell() as Aligned);
            cells.push({ path: `${path}[]`, role: 'value', atoms: va });
            const digests = va.filter(isOpaque32);
            if (va.length === 1 && digests.length === 1) info.valueDigests.push(digests[0].hex);
          } else walk(child, kp);
        }
        maps.push(info);
        break;
      }
      case 'boundedMerkleTree':
        merkleTrees++;
        break;
      default:
        break;
    }
  };
  walk(cs.data.state, '');
  return { entryPoints, cells, maps, merkleTrees };
}

export type CallValues = { entryPoint: string; atoms: Atom[] };

/** The values each call to `address` pushed or read in its public transcript. */
export function decodeCalls(rawHex: string, address: string): CallValues[] {
  let tx: Transaction<never, never, never>;
  try {
    tx = Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(rawHex, 'hex')) as never;
  } catch {
    return [];
  }
  const out: CallValues[] = [];
  const intents = (tx as unknown as { intents?: Map<number, { actions: unknown[] }> }).intents;
  for (const [, intent] of intents ?? []) {
    for (const act of intent.actions as { address?: string; entryPoint?: string | Uint8Array; guaranteedTranscript?: { program: unknown }; fallibleTranscript?: { program: unknown } }[]) {
      if (act.address !== address || act.entryPoint === undefined) continue;
      const atoms: Atom[] = [];
      const seen = new Set<unknown>();
      const visit = (x: unknown) => {
        if (!x || typeof x !== 'object' || seen.has(x) || x instanceof Uint8Array) return;
        seen.add(x);
        const o = x as Record<string, unknown>;
        if (Array.isArray(o.value) && Array.isArray(o.alignment)) {
          atoms.push(...atomsOf(o as unknown as Aligned));
          return;
        }
        for (const v of Array.isArray(x) ? x : Object.values(o)) visit(v);
      };
      visit(act.guaranteedTranscript?.program);
      visit(act.fallibleTranscript?.program);
      out.push({ entryPoint: typeof act.entryPoint === 'string' ? act.entryPoint : hex(act.entryPoint), atoms });
    }
  }
  return out;
}
