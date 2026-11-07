// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The compiler's `reduce-to-circuit` pass, as data. At this point every helper
// circuit is inlined, loops are unrolled, and each step is a guarded binding:
//   (= guard target expr)   (assert cond "message")
// which is exactly the shape an information-flow analysis wants.

import { type SExpr, isList, isSym, head, symName, baseName, parseAll, show } from './sexpr.js';

export type Type =
  | { k: 'bytes'; n: number }
  | { k: 'uint'; max: bigint }
  | { k: 'bool' }
  | { k: 'field' }
  | { k: 'opaque'; name: string }
  | { k: 'vector'; n: number; of: Type }
  | { k: 'tuple'; items: Type[] }
  | { k: 'struct'; name: string; fields: { name: string; type: Type }[] }
  | { k: 'adt'; name: string; args: Type[] }
  | { k: 'unknown'; text: string };

export type Param = { name: string; id: string; type: Type };
export type LedgerField = { name: string; id: string; index: number[]; type: Type };
export type Callable = { name: string; id: string; params: Param[]; result: Type };
export type Binding = { guard: SExpr; target: string; expr: SExpr };
export type Step = { k: 'bind'; b: Binding } | { k: 'assert'; cond: SExpr; message: string };
// `isConstructor`: the contract's constructor, which runs once at deploy time. Its writes are the
// contract's initial public state, so it is analysed like a circuit.
export type Circuit = Callable & { steps: Step[]; ret: SExpr; isConstructor?: boolean };

// Type expressions the compiler prints as operands: 0.36 writes `(field->bytes 32 (field-native) x)`
// and `(- (tunsigned 255) a b)` where 0.35 and older wrote `(field->bytes 32 x)` and `(- 8 a b)`.
// They are not values; the analysis skips them.
const TYPE_HEADS = new Set([
  'tbytes', 'tunsigned', 'tboolean', 'tfield', 'topaque', 'tvector', 'ttuple', 'tstruct', 'tenum',
  'tcontract', 'talias', 'tunknown', 'tpoint',
]);
// Field and curve kinds inside those: (field-native), (field-base (curve-secp256k1)), (field-scalar …).
// Not (field->bytes …), which is a conversion.
export const isTypeForm = (x: SExpr): boolean => {
  const h = head(x);
  return h !== null && (TYPE_HEADS.has(h) || /^(field|curve)-[a-z0-9]+$/.test(h));
};

export type Program = {
  ledger: Map<string, LedgerField>;
  witnesses: Map<string, Callable>;
  natives: Map<string, Callable>;
  circuits: Circuit[];
};

export function parseType(x: SExpr): Type {
  const h = head(x);
  const l = x as SExpr[];
  const num = (y: SExpr) => (!Array.isArray(y) && y.t === 'num' ? y.v : 0n);
  switch (h) {
    case 'tbytes':
      return { k: 'bytes', n: Number(num(l[1])) };
    case 'tunsigned':
      return { k: 'uint', max: num(l[1]) };
    case 'tboolean':
      return { k: 'bool' };
    case 'tfield':
      return { k: 'field' };
    case 'topaque':
      return { k: 'opaque', name: !Array.isArray(l[1]) && l[1].t === 'str' ? l[1].v : 'opaque' };
    case 'tvector':
      return { k: 'vector', n: Number(num(l[1])), of: parseType(l[2]) };
    case 'ttuple':
      return { k: 'tuple', items: l.slice(1).map(parseType) };
    case 'tstruct':
      return {
        k: 'struct',
        name: symName(l[1]),
        fields: l.slice(2).map((f) => ({ name: symName((f as SExpr[])[0]), type: parseType((f as SExpr[])[1]) })),
      };
    case null:
      return { k: 'unknown', text: show(x) };
    default:
      return { k: 'adt', name: h, args: l.slice(1).filter(isList).map(parseType) };
  }
}

// How many bits of uncertainty a value of this type can carry.
export function typeBits(t: Type): number {
  switch (t.k) {
    case 'bytes':
      return t.n * 8;
    case 'uint':
      return t.max <= 0n ? 0 : t.max.toString(2).length;
    case 'bool':
      return 1;
    case 'field':
      return 254;
    case 'opaque':
      return 64;
    case 'vector':
      return t.n * typeBits(t.of);
    case 'tuple':
      return t.items.reduce((a, i) => a + typeBits(i), 0);
    case 'struct':
      return t.fields.reduce((a, f) => a + typeBits(f.type), 0);
    default:
      return 64;
  }
}

// A value is "numeric-ish" if it holds no byte strings: amounts, ages, choices.
// Such values are small or clustered in practice, so they are never a salt.
export function hasBytes(t: Type, min = 16): boolean {
  switch (t.k) {
    case 'bytes':
      return t.n >= min;
    case 'field':
      return true;
    case 'vector':
      return hasBytes(t.of, min) || (t.of.k === 'uint' && t.n * typeBits(t.of) >= min * 8 && typeBits(t.of) >= 8);
    case 'tuple':
      return t.items.some((i) => hasBytes(i, min));
    case 'struct':
      return t.fields.some((f) => hasBytes(f.type, min));
    default:
      return false;
  }
}

export function typeText(t: Type): string {
  switch (t.k) {
    case 'bytes':
      return `Bytes<${t.n}>`;
    case 'uint':
      return t.max === 1n ? 'Uint<1>' : `Uint<0..${t.max + 1n}>`.replace(/<0\.\.(\d+)>/, (_, n) => {
        const b = BigInt(n);
        const bits = (b - 1n).toString(2).length;
        return (1n << BigInt(bits)) === b ? `<${bits}>` : `<0..${n}>`;
      });
    case 'bool':
      return 'Boolean';
    case 'field':
      return 'Field';
    case 'opaque':
      return `Opaque<"${t.name}">`;
    case 'vector':
      return `Vector<${t.n}, ${typeText(t.of)}>`;
    case 'tuple':
      return `[${t.items.map(typeText).join(', ')}]`;
    case 'struct':
      return t.name;
    case 'adt':
      return t.name;
    default:
      return '?';
  }
}

const params = (x: SExpr): Param[] =>
  (x as SExpr[]).map((p) => {
    const l = p as SExpr[];
    const id = symName(l[0]);
    return { id, name: baseName(id), type: parseType(l[1]) };
  });

// compile.ts appends the constructor, taken from the last pass that still has it, after this marker.
export const CONSTRUCTOR_MARK = '\ntell-constructor:\n';

export function readProgram(text: string): Program {
  const start = text.indexOf('(program');
  if (start < 0) throw new Error('no (program …) found in the compiler trace');
  const mark = text.indexOf(CONSTRUCTOR_MARK);
  const [prog] = parseAll(text.slice(start, mark > start ? mark : undefined));
  if (head(prog) !== 'program') throw new Error('expected (program …)');
  const p: Program = { ledger: new Map(), witnesses: new Map(), natives: new Map(), circuits: [] };
  for (const item of (prog as SExpr[]).slice(1)) {
    const h = head(item);
    const l = item as SExpr[];
    if (h === 'public-ledger-declaration') {
      // Large ledgers are declared as nested groups; a field is (%name (index…) type).
      const walk = (f: SExpr) => {
        if (!isList(f)) return;
        if (isSym(f[0]) && f[0].v.startsWith('%')) {
          const id = f[0].v;
          const index = (f[1] as SExpr[]).map((n) => (!Array.isArray(n) && n.t === 'num' ? Number(n.v) : 0));
          p.ledger.set(id, { id, name: baseName(id), index, type: parseType(f[2]) });
        } else f.forEach(walk);
      };
      walk(l[1]);
    } else if (h === 'native' || h === 'witness') {
      const id = symName(l[1]);
      const c: Callable = { id, name: baseName(id), params: params(l[2]), result: parseType(l[3]) };
      (h === 'native' ? p.natives : p.witnesses).set(id, c);
    } else if (h === 'circuit') {
      const id = symName(l[1]);
      const steps: Step[] = [];
      const body = l.slice(4);
      for (const s of body.slice(0, -1)) {
        const sh = head(s);
        const sl = s as SExpr[];
        if (sh === '=' && sl.length === 4) steps.push({ k: 'bind', b: { guard: sl[1], target: symName(sl[2]), expr: sl[3] } });
        else if (sh === '=' && sl.length === 3) steps.push({ k: 'bind', b: legacyBinding(p, symName(sl[1]), sl[2]) });
        else if (sh === 'assert') steps.push({ k: 'assert', cond: sl[1], message: !Array.isArray(sl[2]) && sl[2].t === 'str' ? sl[2].v : '' });
        else throw new Error(`unexpected circuit step ${show(s)}`);
      }
      p.circuits.push({ id, name: baseName(id), params: params(l[2]), result: parseType(l[3]), steps, ret: body[body.length - 1] });
    }
  }
  if (mark > start) {
    const [ctor] = parseAll(text.slice(mark + CONSTRUCTOR_MARK.length));
    if (head(ctor) === 'constructor') {
      const l = ctor as SExpr[];
      const { steps, ret } = lowerBody(l.slice(2));
      p.circuits.push({ id: '%constructor', name: 'constructor', params: params(l[1]), result: { k: 'tuple', items: [] }, steps, ret, isConstructor: true });
    }
  }
  return p;
}

// The constructor never reaches reduce-to-circuit (it is not proved), so Tell reads it from the
// last pass before that, where it is still a nested expression: (seq …), (let* ([(%x type) e]) body),
// (if c a b), (assert c "msg"). Helpers are already inlined and loops unrolled there. This lowers it
// to the same guarded bindings reduce-to-circuit prints, so one analysis covers both.
const EFFECTS = new Set(['seq', 'let*', 'if', 'assert', 'public-ledger', 'emit', 'contract-call']);
export function lowerBody(body: SExpr[]): { steps: Step[]; ret: SExpr } {
  const steps: Step[] = [];
  let n = 0;
  const T: SExpr = { t: 'bool', v: true };
  const F: SExpr = { t: 'bool', v: false };
  const sym = (v: string): SExpr => ({ t: 'sym', v });
  const isTrue = (g: SExpr) => !Array.isArray(g) && g.t === 'bool' && g.v;
  const bind = (guard: SExpr, expr: SExpr, target = `%tell.${n++}`): SExpr => {
    steps.push({ k: 'bind', b: { guard, target, expr } });
    return sym(target);
  };
  const effectful = (x: SExpr): boolean => isList(x) && !isTypeForm(x) && (EFFECTS.has(head(x) ?? '') || x.some(effectful));
  const atom = (x: SExpr) => (isList(x) ? bind(T, x) : x);
  const lower = (x: SExpr, g: SExpr): SExpr => {
    if (!isList(x) || isTypeForm(x)) return x;
    const h = head(x);
    switch (h) {
      case 'seq': {
        let last: SExpr = [sym('tuple')];
        for (const y of x.slice(1)) last = lower(y, g);
        return last;
      }
      case 'let*': {
        for (const b of x[1] as SExpr[]) {
          const [decl, e] = b as SExpr[];
          bind(g, lower(e, g), symName((decl as SExpr[])[0]));
        }
        let last: SExpr = [sym('tuple')];
        for (const y of x.slice(2)) last = lower(y, g);
        return last;
      }
      case 'if': {
        const c = atom(lower(x[1], g));
        const yes = x[2] ?? [sym('tuple')];
        const no = x[3] ?? [sym('tuple')];
        if (!effectful(yes) && !effectful(no)) return [sym('select'), c, yes, no];
        const gYes = isTrue(g) ? c : bind(T, [sym('select'), g, c, F]);
        const notC = bind(T, [sym('not'), c]);
        const gNo = isTrue(g) ? notC : bind(T, [sym('select'), g, notC, F]);
        const a = lower(yes, gYes);
        const b = lower(no, gNo);
        return [sym('select'), c, a, b];
      }
      case 'assert': {
        const c = lower(x[1], g);
        const message = !Array.isArray(x[2]) && x[2]?.t === 'str' ? x[2].v : '';
        steps.push({ k: 'assert', cond: isTrue(g) ? c : [sym('select'), g, c, T], message });
        return [sym('tuple')];
      }
      case 'public-ledger':
      case 'emit':
      case 'contract-call':
      case 'call':
        return bind(g, x.map((y, i) => (i === 0 ? y : lower(y, g))));
      default:
        return x.map((y, i) => (i === 0 && isSym(y) ? y : lower(y, g)));
    }
  };
  let ret: SExpr = [sym('tuple')];
  for (const y of body) ret = lower(y, T);
  return { steps, ret };
}

export const isVar = (x: SExpr): x is { t: 'sym'; v: string } => isSym(x) && x.v.startsWith('%');

// Compilers before 0.31 print (= target expr) and keep the guard inside the
// effectful forms: (call guard %fn args…) and (public-ledger guard %field …).
// Normalise to the 0.31 shape: (= guard target expr) with the guard lifted out.
function legacyBinding(p: Program, target: string, expr: SExpr): Binding {
  const h = head(expr);
  const l = expr as SExpr[];
  const known = (x: SExpr) => isSym(x) && (p.ledger.has(x.v) || p.witnesses.has(x.v) || p.natives.has(x.v) || x.v.startsWith('%kernel'));
  const isGuard = (x: SExpr) => (!Array.isArray(x) && x.t === 'bool') || (isVar(x) && !known(x));
  if ((h === 'call' || h === 'public-ledger') && l.length >= 3 && isGuard(l[1]) && known(l[2]))
    return { guard: l[1], target, expr: [l[0], ...l.slice(2)] };
  return { guard: { t: 'bool', v: true }, target, expr };
}
