// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Reader for the S-expressions the Compact compiler prints with --trace-passes.

export type Atom =
  | { t: 'sym'; v: string }
  | { t: 'num'; v: bigint }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'bytes'; v: Uint8Array };
export type SExpr = Atom | SExpr[];

export const isList = (x: SExpr): x is SExpr[] => Array.isArray(x);
export const isSym = (x: SExpr | undefined, name?: string): x is { t: 'sym'; v: string } =>
  !!x && !Array.isArray(x) && x.t === 'sym' && (name === undefined || x.v === name);
export const head = (x: SExpr): string | null => (isList(x) && x.length > 0 && isSym(x[0]) ? x[0].v : null);
export const symName = (x: SExpr): string => {
  if (!isSym(x)) throw new Error(`expected a symbol, got ${show(x)}`);
  return x.v;
};

export function parseAll(src: string): SExpr[] {
  let i = 0;
  const out: SExpr[] = [];
  const ws = () => {
    while (i < src.length) {
      const c = src[i];
      if (c === ';') {
        while (i < src.length && src[i] !== '\n') i++;
      } else if (c === ' ' || c === '\n' || c === '\t' || c === '\r') i++;
      else break;
    }
  };
  const delim = (c: string | undefined) => c === undefined || c === '(' || c === ')' || c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '"';
  const read = (): SExpr => {
    ws();
    const c = src[i];
    if (c === '(' || c === '[') {
      const close = c === '(' ? ')' : ']';
      i++;
      const list: SExpr[] = [];
      for (;;) {
        ws();
        if (i >= src.length) throw new Error('unexpected end of input inside a list');
        if (src[i] === close || src[i] === ')' || src[i] === ']') {
          i++;
          return list;
        }
        list.push(read());
      }
    }
    if (c === '"') {
      i++;
      let s = '';
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') {
          i++;
          const e = src[i];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else s += src[i];
        i++;
      }
      i++;
      return { t: 'str', v: s };
    }
    if (src.startsWith('#vu8(', i)) {
      i += 5;
      const bytes: number[] = [];
      for (;;) {
        ws();
        if (src[i] === ')') {
          i++;
          break;
        }
        let tok = '';
        while (!delim(src[i])) tok += src[i++];
        bytes.push(Number(tok));
      }
      return { t: 'bytes', v: Uint8Array.from(bytes) };
    }
    let tok = '';
    while (!delim(src[i])) tok += src[i++];
    if (tok === '') throw new Error(`unexpected character ${JSON.stringify(src[i])} at ${i}`);
    if (tok === '#t') return { t: 'bool', v: true };
    if (tok === '#f') return { t: 'bool', v: false };
    if (/^-?\d+$/.test(tok)) return { t: 'num', v: BigInt(tok) };
    return { t: 'sym', v: tok };
  };
  for (;;) {
    ws();
    if (i >= src.length) break;
    out.push(read());
  }
  return out;
}

export function show(x: SExpr, depth = 3): string {
  if (Array.isArray(x)) {
    if (depth <= 0) return '(…)';
    return '(' + x.map((y) => show(y, depth - 1)).join(' ') + ')';
  }
  switch (x.t) {
    case 'sym':
      return x.v;
    case 'num':
      return x.v.toString();
    case 'str':
      return JSON.stringify(x.v);
    case 'bool':
      return x.v ? '#t' : '#f';
    case 'bytes':
      return `#vu8[${x.v.length}]`;
  }
}

// "%name.12" -> "name"
export const baseName = (s: string): string => s.replace(/^%/, '').replace(/\.\d+$/, '');
