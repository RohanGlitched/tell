// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Information flow from private inputs (witness results, circuit arguments) to
// the public transcript (every public-ledger operation, its operands, and
// whether it ran at all). For each circuit Tell answers: what does an observer
// of the chain learn about the caller's private data, and how cheaply?

import { type SExpr, isList, isSym, head, symName, baseName, show } from './sexpr.js';
import { type Program, type Circuit, type Type, type Callable, typeBits, hasBytes, isVar, parseType, typeText } from './ir.js';

export type SourceKind = 'witness' | 'argument';
export type Source = { key: string; kind: SourceKind; name: string; type: Type; bits: number };

// How much of a source a value gives away, from most to least.
//   reveal:    the value itself, or a reversible function of it
//   guessable: a hash or commitment with too little unknown input; brute force recovers it
//   predicate: a yes/no fact about it
//   hidden:    one-way and well salted; at most a linkable tag
export type Flow = 'reveal' | 'guessable' | 'predicate' | 'hidden';
const RANK: Record<Flow, number> = { reveal: 3, guessable: 2, predicate: 1, hidden: 0 };

// idTag: a deterministic hash of key material only (an identity), not of content.
// choice: the secret entered the hash only as a yes/no selector (e.g. Merkle path bits).
export type Fact = { flow: Flow; via?: string; preimageBits?: number; tag?: boolean; idTag?: boolean; choice?: boolean; fp?: string };
export type Label = Map<string, Fact>;

// `varying`: derived from public state that changes between calls (a counter, a sequence).
// lits: literal constants inside the value (domain separators), used to fingerprint tags.
type Val = { label: Label; parts?: Val[]; fields?: Map<string, Val>; varying?: boolean; lits?: string[] };

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingKind =
  | 'guessable-hash'
  | 'secret-published'
  | 'published'
  | 'branch'
  | 'predicate'
  | 'linkable'
  | 'attributable';

export type Finding = {
  circuit: string;
  kind: FindingKind;
  severity: Severity;
  field: string;
  op: string;
  sources: { name: string; kind: SourceKind; type: string; bits: number }[];
  bits: number;
  via?: string;
  title: string;
  detail: string;
  fix: string;
  line?: number;
  fields?: string[];
  suppressed?: boolean;
  // for tags: a fingerprint of the hash expression, so only identical tags are linked
  tagFp?: string;
};

export type OperandNote = { source: string; kind: SourceKind; flow: Flow; via?: string; bits: number; tag?: boolean };
export type TranscriptOp = { field: string; op: string; operands: OperandNote[][]; guardedBy: string[] };

export type Proof = { circuit: string; message: string; sources: string[] };

export type CircuitReport = {
  name: string;
  privateInputs: { name: string; kind: SourceKind; type: string; bits: number }[];
  publishedBits: number;
  findings: Finding[];
  proves: Proof[];
  touches: string[];
  // The public transcript, one entry per ledger operation, with what each operand carries.
  ops: TranscriptOp[];
};

export type Report = {
  circuits: CircuitReport[];
  findings: Finding[];
  unknownForms: string[];
};

// degradeToTransient is a reversible Bytes<32>→Field conversion, not a hash: it is a cast below.
const HASHES = new Set(['persistentHash', 'transientHash', 'hashToCurve']);
const COMMITS = new Set(['persistentCommit', 'transientCommit']);
const ONE_WAY_EC = new Set(['ecMulGenerator', 'ecMul', 'ecAdd']);
const CASTS = new Set(['degradeToTransient', 'upgradeFromTransient', 'convertFieldToBytes', 'convertBytesToField']);
// Names are classified by whole words (camelCase and snake_case split), never substrings:
// `individualIncome` is not a division hint and `brand` is not randomness.
const words = (n: string) =>
  n
    .replace(/\[\d+\]/g, '')
    .split(/[._\s]+|(?<=[a-z0-9])(?=[A-Z])/)
    .map((w) => w.toLowerCase())
    .filter(Boolean)
    // plurals read as their singular: `admins`, `certEphemerals`
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
const lastWord = (n: string) => words(n).at(-1) ?? '';
const isSecretish = (n: string) => {
  const w = words(n);
  return w.some((x) => ['secret', 'sk', 'password', 'passphrase', 'mnemonic', 'priv'].includes(x)) || (w.includes('private') && w.includes('key'));
};
const isPositional = (n: string) => words(n).includes('path') || ['index', 'idx', 'bits', 'bit', 'slot', 'position', 'pos', 'leaf'].includes(lastWord(n));
const isHint = (n: string) => {
  const w = words(n);
  return w.some((x) => ['divmod', 'quotient', 'remainder', 'sqrt', 'hint', 'inverse', 'timestamp', 'clock'].includes(x)) || ['div', 'mod', 'now', 'time'].includes(lastWord(n));
};
// Arguments are usually public inputs the caller chose; these names say the value is personal.
const isPersonal = (n: string) => {
  const w = words(n);
  if (isFresh(n)) return false; // a ballotSalt is randomness, not a ballot
  return (
    w.some((x) =>
      ['vote', 'ballot', 'choice', 'option', 'bid', 'offer', 'amount', 'salary', 'wage', 'income', 'balance', 'age', 'score', 'answer', 'guess', 'move', 'pick', 'selection', 'rating', 'location', 'gps', 'lat', 'lon', 'coords', 'coord', 'birth', 'dob', 'pin', 'ssn', 'phone', 'email', 'zip', 'postcode', 'diagnosis', 'diagnosi', 'gender', 'nationality', 'secret'].includes(x),
    ) || (w.includes('name') && w.some((x) => ['full', 'first', 'last', 'given', 'family', 'legal', 'real', 'user', 'person'].includes(x)))
  );
};
// Written in the clear, these are a leak whatever the design: identity and life facts.
// (Amounts, bids and votes are revealed on purpose all the time; a hash of one is still caught.)
const isSensitive = (n: string) => {
  const w = words(n);
  if (isFresh(n)) return false;
  return (
    w.some((x) => ['salary', 'wage', 'income', 'age', 'birth', 'dob', 'ssn', 'gps', 'location', 'coords', 'coord', 'lat', 'lon', 'diagnosis', 'diagnosi', 'gender', 'nationality', 'email', 'phone', 'pin', 'postcode', 'zip'].includes(x)) ||
    (w.includes('name') && w.some((x) => ['full', 'first', 'last', 'given', 'family', 'legal', 'real', 'person'].includes(x)))
  );
};
// Key material by name: a seed or a private key, not a public key, an id or a commitment.
const isKeyish = (n: string) => {
  const w = words(rootName(n));
  if (w.some((x) => ['pub', 'public', 'pk', 'id', 'commitment', 'commit', 'root', 'hash', 'digest'].includes(x))) return false;
  return w.some((x) => ['seed', 'sk', 'secret', 'priv', 'private', 'mnemonic', 'passphrase', 'password', 'signing', 'master', 'key'].includes(x));
};
// Personal values hold far fewer real values than their type allows (an age, a name, a PIN).
const PERSONAL_BITS = 40;
// Fields that hold a contract's own officers: publishing an admin's key there is the usual design.
const isRoleField = (n: string) =>
  words(n).some((x) =>
    ['owner', 'admin', 'authority', 'operator', 'issuer', 'governor', 'manager', 'treasury', 'recipient', 'deployer', 'controller', 'organizer', 'organiser', 'platform', 'pool', 'approval', 'signer', 'guardian', 'validator', 'committee', 'registrar', 'moderator'].includes(x),
  );
const isSetup = (circuit: string) => ['init', 'initialize', 'initialise', 'setup', 'constructor', 'bootstrap'].includes(words(circuit)[0] ?? '');
const isFresh = (n: string) => words(n).some((x) => ['nonce', 'salt', 'rand', 'random', 'randomnes', 'randomness', 'fresh', 'blind', 'blinding', 'unblinding', 'ephemeral', 'entropy', 'scalar'].includes(x));
// Shielded-token plumbing: coin commitments and nullifiers are the protocol's own privacy.
// Kernel operations of the shielded token protocol carry commitments and nullifiers by design.
// Every other kernel operation (unshielded spends, mints, balance and time checks) is public.
// A mint's amount is an operand like any other, so mintShielded is analysed; only its coin is private.
const SHIELDED_KERNEL_OPS = new Set(['claimZswapCoinReceive', 'claimZswapCoinSpend', 'claimZswapNullifier', 'self']);
const READ_OPS = new Set(['read', 'member', 'lookup', 'size', 'isEmpty', 'checkRoot', 'checkRootHistoric', 'isFull', 'head', 'length', 'balance', 'balanceLessThan', 'balanceGreaterThan']);
// A preimage needs this many unknown bits before brute force is hopeless.
const SAFE_BITS = 112;
// Selectors that usually encode a public position (tree paths, indexes), not a secret.
// Helper witnesses that hand the circuit public arithmetic or the time, not user secrets.
// Per-use randomness: a hash that includes it never repeats, so it links nothing.
// A literal's identity for tag fingerprints: byte strings by content, not length.
const litKey = (a: SExpr): string => (!Array.isArray(a) && a.t === 'bytes' ? Buffer.from(a.v).toString('hex') : show(a));
const rootName = (n: string) => n.replace(/[.[].*$/, '');
// The name a projected value carries itself: `rec.salary` is a salary; `salaryAttestation[1]`
// is some element of an attestation (its expiry, here), so it says nothing.
const ownName = (n: string) => (/\[\d+\]$/.test(n) ? '' : n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : n);

const empty = (): Val => ({ label: new Map() });

function mergeFact(a: Fact | undefined, b: Fact): Fact {
  if (!a) return b;
  if (RANK[b.flow] > RANK[a.flow]) return { ...b, tag: a.tag || b.tag };
  if (RANK[b.flow] < RANK[a.flow]) return { ...a, tag: a.tag || b.tag };
  return { ...a, tag: a.tag || b.tag, preimageBits: Math.min(a.preimageBits ?? 1e9, b.preimageBits ?? 1e9) };
}

function flat(v: Val): Label {
  const out: Label = new Map(v.label);
  for (const p of v.parts ?? []) for (const [k, f] of flat(p)) out.set(k, mergeFact(out.get(k), f));
  for (const p of v.fields?.values() ?? []) for (const [k, f] of flat(p)) out.set(k, mergeFact(out.get(k), f));
  return out;
}

function union(...vs: Val[]): Label {
  const out: Label = new Map();
  for (const v of vs) for (const [k, f] of flat(v)) out.set(k, mergeFact(out.get(k), f));
  return out;
}

const withFlow = (l: Label, f: (x: Fact) => Fact): Label => new Map([...l].map(([k, x]) => [k, f(x)]));

export function analyze(p: Program, opts: { sourceText?: string } = {}): Report {
  const unknown = new Set<string>();
  const circuits: CircuitReport[] = [];
  // Fields some circuit writes: reading them gives a value that can change between calls.
  const mutated = new Set<string>();
  for (const c of p.circuits)
    for (const st of c.steps)
      if (st.k === 'bind' && head(st.b.expr) === 'public-ledger') {
        const l = st.b.expr as SExpr[];
        const op = isSym(l[3]) ? l[3].v : '';
        if (!READ_OPS.has(op)) mutated.add(symName(l[1]));
      }
  // Pass 1 finds inputs each circuit publishes outright (an attacker knows those, so pass 2
  // does not count them as secret when judging a hash's strength), and the private values the
  // contract uses as key material in an identity hash anywhere.
  const keyed = new Set<string>();
  const firsts = p.circuits.map((c) => analyzeCircuit(p, c, new Set(), new Set(), mutated, keyed, new Set()));
  p.circuits.forEach((c, i) => {
    const known = new Set(firsts[i].findings.filter((f) => f.kind === 'published' || f.kind === 'secret-published').flatMap((f) => f.sources.map((s) => s.name)));
    circuits.push(analyzeCircuit(p, c, unknown, known, mutated, new Set(), keyed));
  });
  const findings = circuits.flatMap((c) => c.findings);
  if (opts.sourceText) {
    locate(findings, opts.sourceText);
    declaredPublic(findings, opts.sourceText);
  }
  linkAcrossCircuits(findings);
  return { circuits, findings, unknownForms: [...unknown].sort() };
}

function analyzeCircuit(
  p: Program,
  c: Circuit,
  unknown: Set<string>,
  known: Set<string>,
  mutated: Set<string>,
  keyed: Set<string>,
  hiddenElsewhere: Set<string>,
): CircuitReport {
  const env = new Map<string, Val>();
  const sources = new Map<string, Source>();
  const findings = new Map<string, Finding>();
  const proves: Proof[] = [];
  const touches = new Set<string>();
  const ops: TranscriptOp[] = [];
  // field|op -> each guarded run of it: the private sources guarding it, and its public operands
  // (private operands count as '*': a hidden commitment looks the same on either path).
  const guarded = new Map<string, { keys: Set<string>; sig: string }[]>();
  const recordGuard = (field: string, op: string, g: Label, operands: Val[], exprs: SExpr[]) => {
    if (!g.size) return;
    const sig = operands.map((v, i) => (flat(v).size ? '*' : show(resolve(exprs[i] ?? { t: 'sym', v: '' } as SExpr)))).join('|');
    guarded.set(`${field}|${op}`, [...(guarded.get(`${field}|${op}`) ?? []), { keys: new Set(g.keys()), sig }]);
  };

  const addSource = (kind: SourceKind, name: string, type: Type): string => {
    const key = `${kind === 'witness' ? 'w' : 'a'}:${name}`;
    if (!sources.has(key)) sources.set(key, { key, kind, name, type, bits: typeBits(type) });
    return key;
  };

  for (const prm of c.params) {
    const key = addSource('argument', prm.name, prm.type);
    env.set(prm.id, { label: new Map([[key, { flow: 'reveal' }]]) });
  }

  const val = (x: SExpr): Val => {
    if (isVar(x)) return env.get(x.v) ?? empty();
    if (isList(x)) return evalExpr(x);
    return empty();
  };

  // Unknown bits an attacker must guess to invert a one-way function of `l`.
  const unknownBits = (l: Label): { bits: number; strong: boolean } => {
    let bits = 0;
    let strong = false;
    for (const [k, f] of l) {
      const s = sources.get(k)!;
      if (known.has(s.name)) continue;
      if (f.flow === 'hidden') {
        bits += 256;
        strong = true;
      } else if (f.flow === 'predicate') bits += 1;
      else if (f.flow === 'guessable') bits += f.preimageBits ?? s.bits;
      else {
        const b = isPersonal(s.name) && !isSecretish(s.name) ? Math.min(s.bits, PERSONAL_BITS) : s.bits;
        bits += b;
        // Personal values are already capped below SAFE_BITS above, so a Field named `age` is not a salt.
        if (hasBytes(s.type) && b >= SAFE_BITS) strong = true;
      }
    }
    return { bits, strong };
  };

  const oneWay = (via: string, input: Label, salt?: Label, varying = false, lits: string[] = []): Val => {
    const all = salt ? union({ label: input }, { label: salt }) : input;
    const { bits, strong } = unknownBits(all);
    const secure = strong && bits >= SAFE_BITS;
    // A commitment whose randomness is secret and strong is hiding and unlinkable.
    const saltStrong = salt ? unknownBits(salt).strong : false;
    const out: Label = new Map();
    const fp = `${via}|${[...all.keys()].sort().join(',')}|${[...lits].sort().join(',')}`;
    const idTag = [...all].every(([k, f]) => f.flow === 'hidden' || (hasBytes(sources.get(k)!.type) && sources.get(k)!.bits >= SAFE_BITS));
    // A secret named like per-use randomness makes the output a one-time value.
    const freshType = (t: Type): boolean => (t.k === 'struct' ? t.fields.some((x) => isFresh(x.name) || freshType(x.type)) : t.k === 'tuple' ? t.items.some(freshType) : false);
    if ([...all].some(([k, f]) => f.flow !== 'hidden' && (isFresh(sources.get(k)!.name) || freshType(sources.get(k)!.type)))) varying = true;
    // A caller-chosen argument mixed in (a room id, a poll id) scopes the tag to it: hash(roomId, sk)
    // differs from room to room, so it is not one identity across actions.
    if ([...all].some(([k, f]) => f.flow === 'reveal' && sources.get(k)!.kind === 'argument')) varying = true;
    for (const [k, f] of all) {
      if (known.has(sources.get(k)!.name)) continue; // already public in this call
      if (f.flow === 'hidden') out.set(k, { ...f, idTag: f.idTag && idTag, fp: f.fp ?? fp });
      else if (secure) {
        out.set(k, { flow: 'hidden', via, tag: !saltStrong && !varying, idTag: idTag && !saltStrong && !varying, fp });
        // Only private data counts: public ids (arguments) are hashed into keys all the time.
        if (f.flow === 'reveal' && !salt && idTag && !varying && sources.get(k)!.kind === 'witness' && rootName(sources.get(k)!.name) !== 'ownPublicKey')
          keyed.add(sources.get(k)!.name);
      }
      else out.set(k, { flow: 'guessable', via, preimageBits: bits, choice: f.flow === 'predicate' || (f.flow === 'guessable' && !!f.choice) });
    }
    return { label: out, varying };
  };
  const anyVarying = (vs: Val[]): boolean =>
    vs.some((v) => v.varying || (v.parts ?? []).some((x) => anyVarying([x])) || [...(v.fields?.values() ?? [])].some((x) => anyVarying([x])));

  const callable = (id: string): Callable | undefined => p.witnesses.get(id) ?? p.natives.get(id);

  // Reading one field of a private struct exposes that field, not the whole struct.
  const project = (v: Val, part: string | number): Val => {
    const out: Label = new Map();
    for (const [k, f] of flat(v)) {
      const s = sources.get(k)!;
      const t = s.type;
      const sub =
        typeof part === 'string' && t.k === 'struct'
          ? t.fields.find((x) => x.name === part)?.type
          : typeof part === 'number' && t.k === 'tuple'
            ? t.items[part]
            : typeof part === 'number' && t.k === 'vector'
              ? t.of
              : typeof part === 'number' && t.k === 'bytes'
                ? ({ k: 'uint', max: 255n } as Type)
                : undefined;
      if (!sub || f.flow !== 'reveal') {
        out.set(k, mergeFact(out.get(k), f));
        continue;
      }
      const key = `${k}.${part}`;
      if (!sources.has(key)) sources.set(key, { key, kind: s.kind, name: `${s.name}.${typeof part === 'number' ? `[${part}]` : part}`.replace('.[', '['), type: sub, bits: typeBits(sub) });
      out.set(key, mergeFact(out.get(key), f));
    }
    return { label: out };
  };

  const evalExpr = (x: SExpr[]): Val => {
    const h = head(x);
    switch (h) {
      case 'call': {
        const id = symName(x[1]);
        const args = x.slice(2).map(val);
        if (p.witnesses.has(id)) {
          const w = p.witnesses.get(id)!;
          const key = addSource('witness', w.name, w.result);
          return { label: new Map([[key, { flow: 'reveal' }]]) };
        }
        const n = callable(id);
        const name = n ? n.name : baseName(id);
        // The caller's own Zswap coin key: supplied by the prover, identifies their wallet.
        if (name === 'ownPublicKey') {
          const key = addSource('witness', 'ownPublicKey', n?.result ?? { k: 'bytes', n: 32 });
          return { label: new Map([[key, { flow: 'reveal' }]]) };
        }
        if (CASTS.has(name)) return { label: union(...args), parts: args.length === 1 ? args[0].parts : undefined, varying: anyVarying(args) };
        const lits = [...args.flatMap((a) => a.lits ?? []), ...x.slice(2).filter((a) => !isList(a) && !isVar(a)).map(litKey)];
        if (HASHES.has(name)) return oneWay(name, union(...args), undefined, anyVarying(args), lits);
        if (COMMITS.has(name)) return oneWay(name, union(args[0] ?? empty()), union(args[1] ?? empty()), anyVarying(args), lits);
        if (ONE_WAY_EC.has(name)) return oneWay(name, union(...args), undefined, anyVarying(args), lits);
        if (!n) unknown.add(`call:${name}`);
        return { label: union(...args), varying: anyVarying(args) };
      }
      case 'public-ledger': {
        // handled as a sink by the step loop; reads return public data
        return empty();
      }
      case 'tuple': {
        const parts = x.slice(1).map(val);
        const lits = [...x.slice(1).filter((a) => !isList(a) && !isVar(a)).map(litKey), ...parts.flatMap((v) => v.lits ?? [])];
        return { label: new Map(), parts, varying: anyVarying(parts), lits };
      }
      case 'new': {
        const t = parseType(x[1]);
        const args = x.slice(2).map(val);
        if (t.k === 'struct') return { label: new Map(), fields: new Map(t.fields.map((f, i) => [f.name, args[i] ?? empty()])) };
        return { label: union(...args) };
      }
      case 'elt-ref': {
        const v = val(x[1]);
        const f = isSym(x[2]) ? x[2].v : '';
        return v.fields?.get(f) ?? (v.fields ? empty() : project(v, f));
      }
      case 'bytes-ref': {
        const i = !Array.isArray(x[2]) && x[2].t === 'num' ? Number(x[2].v) : -1;
        return i >= 0 ? project(val(x[1]), i) : { label: union(val(x[1]), val(x[2])) };
      }
      case 'tuple-ref': {
        const v = val(x[1]);
        const i = !Array.isArray(x[2]) && x[2].t === 'num' ? Number(x[2].v) : -1;
        return v.parts?.[i] ?? (v.parts ? empty() : project(v, i));
      }
      case 'select': {
        const cond = union(val(x[1]));
        const a = val(x[2]);
        const b = val(x[3]);
        const out = union(a, b);
        for (const [k, f] of withFlow(cond, (f) => ({ flow: f.flow === 'hidden' ? 'hidden' : 'predicate', via: 'branch' })))
          out.set(k, mergeFact(out.get(k), f));
        // keep structure when the condition is public
        if (cond.size === 0 && a.fields && b.fields) return { label: new Map(), fields: new Map([...a.fields].map(([k, v]) => [k, { label: union(v, b.fields!.get(k) ?? empty()) }])) };
        return { label: out };
      }
      case '==':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=':
      case 'not':
        return { label: withFlow(union(...x.slice(1).map(val)), (f) => (f.flow === 'hidden' && !f.tag ? f : { flow: f.flow === 'hidden' ? 'predicate' : RANK[f.flow] > RANK.predicate ? 'predicate' : f.flow, via: h })) };
      case '+':
      case '-':
      case '*': {
        const args = x.slice(1).map(val);
        return { label: union(...args), varying: anyVarying(args) };
      }
      case 'default':
        return empty();
      case 'downcast-unsigned':
      case 'field->bytes':
      case 'bytes->field':
      case 'vector->bytes':
      case 'bytes->vector':
      case 'safe-cast':
      case 'cast': {
        const args = x.slice(1).map(val);
        return { label: union(...args), varying: anyVarying(args) };
      }
      default:
        unknown.add(h ?? show(x, 1));
        return { label: union(...x.slice(1).map(val)) };
    }
  };

  const describe = (key: string) => {
    const s = sources.get(key)!;
    return { name: s.name, kind: s.kind, type: typeText(s.type), bits: s.bits };
  };

  const report = (f: Finding) => {
    // One finding per idea: tags are grouped per circuit (all inputs mixed into them),
    // branches per input, and clear/guessable values per field and input; every
    // ledger operation involved is listed in `fields`.
    const src = f.sources.map((s) => s.name).join(',');
    const id = f.kind === 'linkable' ? `linkable|${f.tagFp ?? ''}` : f.kind === 'attributable' ? `attributable|${f.field}` : f.kind === 'branch' ? `branch|${f.sources.map((s) => rootName(s.name)).join(',')}` : f.kind === 'guessable-hash' ? `guessable|${f.field}|${f.severity}` : `${f.kind}|${f.field}|${src}`;
    const label = `${f.field}.${f.op}`;
    const prev = findings.get(id);
    if (prev) {
      if (!prev.fields!.includes(label)) prev.fields!.push(label);
      for (const s of f.sources) if (!prev.sources.some((x) => x.name === s.name)) prev.sources.push(s);
      if (f.bits > prev.bits) prev.bits = f.bits;
      return;
    }
    findings.set(id, { ...f, sources: [...f.sources], fields: [label] });
  };

  // role 'value': the operand is stored as data (a map value, a cell); 'key': looked up or registered.
  const sink = (field: string, op: string, operand: Val, guard: Label, role: 'key' | 'value' = 'key', perAction = false) => {
    const l = flat(operand);
    for (const [k, f] of l) {
      const s = sources.get(k)!;
      const src = [describe(k)];
      const who = whoOf(s);
      if (f.flow === 'guessable') {
        const bits = f.preimageBits ?? s.bits;
        // Arguments are usually public inputs the caller chose; witnesses are the private data.
        // Witnesses are the private data. Arguments are just as private in Compact, but usually carry
        // public inputs the caller chose, so they rank one step lower, and only when they are small
        // or named like personal data; a source that writes disclose(arg) marks them public.
        const witnessSev: Severity = bits <= 40 ? 'critical' : 'high';
        const publicHint = isPositional(s.name) || isHint(s.name);
        const severity: Severity = f.choice
          ? publicHint || s.kind === 'argument'
            ? 'low'
            : 'medium'
          : s.kind === 'witness' || isSecretish(s.name)
            ? witnessSev
            : !publicHint && (s.bits <= 16 || isPersonal(s.name))
              ? bits <= 40
                ? 'high'
                : 'medium'
              : 'low';
        report({
          circuit: c.name,
          kind: 'guessable-hash',
          severity,
          field,
          op,
          sources: src,
          bits,
          via: f.via,
          title: f.choice
            ? `which way ${who} steered can be recovered from a ${f.via}`
            : `${who} is hidden behind a ${f.via} anyone can reverse`,
          detail: f.choice
            ? `\`${field}\` receives a ${f.via} whose only unknown inputs are yes/no choices made from ${who} (about ${bits} bit${bits === 1 ? '' : 's'} in all). Trying every combination recovers them. Harmless if those choices are public anyway (a leaf's position in an append-only tree usually is).`
            : `\`${field}\` receives ${f.via}(… ${who} …), but the only unknown input is ${who} (${typeText(s.type)}), about ${bits} bit${bits === 1 ? '' : 's'}. ` +
              `Anyone reading the chain can try every value (${bits <= 40 ? `at most ${fmtTries(bits)} tries` : 'real values cluster, so far fewer in practice'}) and recover it.` +
              (s.kind === 'argument' ? ' Arguments are often public on purpose; this matters only if the caller expects it to stay private.' : ''),
          fix: `Use persistentCommit(value, salt) with a fresh 32-byte random salt kept in private state, or mix a 32-byte secret into the hash.`,
        });
      } else if (f.flow === 'reveal') {
        const looksSecret = isSecretish(s.name) && hasBytes(s.type);
        // 128+ bits of private bytes written as-is: a key, a seed or a credential, whatever it is called.
        const keyMaterial = s.kind === 'witness' && s.type.k === 'bytes' && s.bits >= 128 && isKeyish(s.name) && !isFresh(s.name);
        if (rootName(s.name) === 'ownPublicKey')
          report({
            circuit: c.name,
            kind: 'published',
            // An officer's key set once (owner, authority) is the usual admin design; users' keys are the leak.
            severity: isRoleField(field) || isSetup(c.name) ? 'low' : 'medium',
            field,
            op,
            sources: src,
            bits: s.bits,
            title: `the caller's wallet key is published`,
            detail: `\`${field}\` ${op} receives ownPublicKey(), the caller's Zswap coin public key. Every call that does this ties the contract activity to the same wallet. ownPublicKey() is also supplied by the prover, so it does not authenticate the caller by itself.`,
            fix: `Identify users by persistentHash([domain, secret]) from private state; never authorise on ownPublicKey() alone.`,
          });
        else if (looksSecret || hiddenElsewhere.has(s.name))
          report({
            circuit: c.name,
            kind: 'secret-published',
            severity: looksSecret && s.kind === 'witness' ? 'critical' : 'high',
            field,
            op,
            sources: src,
            bits: s.bits,
            title: looksSecret ? `${who} looks like a secret key, and it is published` : `${who} is hidden behind a hash elsewhere, and published in the clear here`,
            detail: looksSecret
              ? `\`${field}\` ${op} receives ${who} (${typeText(s.type)}) in a form anyone can read back. Anyone who sees this transaction can act as its owner.`
              : `\`${field}\` ${op} receives ${who} (${typeText(s.type)}) as a readable value, while another circuit of this contract hashes it to keep it secret. Whatever that hash protects is public once this runs.`,
            fix: looksSecret
              ? `Publish persistentHash([domain, key]) as a public identifier instead, and keep the key itself in private state.`
              : `Keep the value in private state and publish only its hash. If this is the reveal step of a commit-reveal, mark the line with // tell:allow secret-published.`,
          });
        else if (keyMaterial || (s.kind === 'witness' && isSensitive(ownName(s.name))))
          report({
            circuit: c.name,
            kind: 'published',
            severity: 'medium',
            field,
            op,
            sources: src,
            bits: s.bits,
            title: keyMaterial ? `${who}, ${s.bits} bits of private bytes, is published as-is` : `${who}, a personal value, is published in the clear`,
            detail: keyMaterial
              ? `\`${field}\` ${op} receives ${who} (${typeText(s.type)}) unchanged. Private bytes this size are usually a key, a seed or a credential; if this one is, anyone who reads the chain can use it.`
              : `\`${field}\` ${op} receives ${who} (${typeText(s.type)}) as a readable value. Its name says it is personal data; once written, it is public forever.`,
            fix: `If it should stay private, store a commitment instead: persistentCommit(value, salt) with a random salt from private state. If it is meant to be public, mark the line with // tell:allow published.`,
          });
        else
          report({
            circuit: c.name,
            kind: 'published',
            severity: s.kind === 'argument' ? 'info' : 'low',
            field,
            op,
            sources: src,
            bits: s.bits,
            title: `${who} is published in the clear`,
            detail: `\`${field}\` ${op} receives ${who} (${typeText(s.type)}, ${s.bits} bits) as a readable value. Fine if it is meant to be public; a leak if not.`,
            fix: `If it should stay private, store a commitment instead: persistentCommit(value, salt) with a random salt from private state.`,
          });
      } else if (f.flow === 'predicate') {
        report({
          circuit: c.name,
          kind: 'predicate',
          severity: 'info',
          field,
          op,
          sources: src,
          bits: 1,
          via: f.via,
          title: `a yes/no fact about ${who} is published`,
          detail: `\`${field}\` ${op} depends on a comparison involving ${who}. Observers learn one bit about it per call.`,
          fix: `Usually intended (e.g. "age ≥ 18"). Prove it with assert() instead of storing it if the chain does not need to remember it.`,
        });
      } else if (f.flow === 'hidden' && f.tag && f.idTag && role === 'value' && perAction && [...flat(operand)].some(([k]) => isKeyish(sources.get(k)!.name) || isSecretish(sources.get(k)!.name))) {
        // Only identity material (a key, a secret) makes a signature; a hash of content does not.
        // The tag is stored next to each action: every action is signed with it.
        report({
          circuit: c.name,
          kind: 'attributable',
          // an officer (issuer, registrar) signing each record is usually the design
          severity: s.kind === 'argument' || isRoleField(field) || isRoleField(rootName(s.name)) ? 'low' : 'medium',
          field,
          op,
          sources: src,
          bits: 0,
          via: f.via,
          title: `every \`${c.name}\` stores the same tag derived from ${who}`,
          detail: `\`${field}\` ${op} stores ${f.via}(… ${who} …) as data on each call. The value is the same every time for the same holder, so all of one holder's \`${c.name}\` actions line up, and identifying one identifies all of them.`,
          fix: `Store a one-time tag instead: hash the secret together with a per-action public value (a post number, a counter) or a fresh random value.`,
        });
      } else if (f.flow === 'hidden' && f.tag) {
        report({
          circuit: c.name,
          kind: 'linkable',
          severity: 'info',
          field,
          op,
          sources: src,
          bits: 0,
          via: f.via,
          tagFp: f.fp,
          title: `${who} is hidden, but leaves the same tag every time`,
          detail: `\`${field}\` ${op} receives ${f.via}(… ${who} …). It cannot be reversed, but the same input always gives the same value, so every call that publishes it can be linked to the same holder.`,
          fix: `Fine for nullifiers and one-time registrations. For repeated actions, mix a per-action counter or a fresh random value into the hash.`,
        });
      }
    }
    for (const [k, f] of guard) {
      if (f.flow === 'hidden' && !f.tag) continue;
      const s = sources.get(k)!;
      // The circuit writes this value in the clear anyway: which path ran adds nothing.
      if (known.has(s.name)) continue;
      const who = whoOf(s);
      report({
        circuit: c.name,
        kind: 'branch',
        // A branch on a key reveals which authorised path the caller took, not the key.
        // ownPublicKey in a guard is an access check: it shows whether the caller is the officer.
        severity:
          s.kind === 'argument'
            ? 'info'
            : s.name === 'ownPublicKey' || isPositional(s.name) || isHint(s.name) || (isSecretish(s.name) && hasBytes(s.type))
              ? 'low'
              : 'medium',
        field,
        op,
        sources: [describe(k)],
        bits: 1,
        title: `whether \`${field}\` is touched depends on ${who}`,
        detail: `This ${op} on \`${field}\` only happens on one side of a condition involving ${who}. The public transcript shows which side ran, so observers learn the condition's outcome.`,
        fix: `Touch \`${field}\` on both paths (write the same shape of data either way), or move the decision into an assert.`,
      });
    }
  };

  // The expression each temporary was bound to, so asserts can be read for range bounds.
  const exprOf = new Map<string, SExpr>();
  const resolve = (x: SExpr, depth = 0): SExpr => (isVar(x) && depth < 8 && exprOf.has(x.v) ? resolve(exprOf.get(x.v)!, depth + 1) : x);
  // assert(x < N) or assert(x <= N): x has at most log2(N) bits, whatever its type allows.
  const boundFrom = (x: SExpr, depth = 0) => {
    const e = resolve(x);
    if (!isList(e) || depth > 6) return;
    const h = head(e);
    if ((h === '<' || h === '<=') && e.length === 4) {
      const lim = e[3];
      const v = val(e[2]);
      const l = flat(v);
      if (!Array.isArray(lim) && lim.t === 'num' && l.size === 1) {
        const [[k, f]] = [...l];
        const n = Number(lim.v) + (h === '<=' ? 1 : 0);
        if (f.flow === 'reveal' && n >= 1 && n < 2 ** 52) {
          const s = sources.get(k)!;
          s.bits = Math.min(s.bits, Math.max(1, Math.ceil(Math.log2(n))));
        }
      }
      return;
    }
    if (h === 'select' || h === 'and') for (const y of e.slice(1)) boundFrom(y, depth + 1);
  };
  for (const st of c.steps) {
    if (st.k === 'assert') {
      boundFrom(st.cond);
      const l = union(val(st.cond));
      const secret = [...l].filter(([, f]) => !(f.flow === 'hidden' && !f.tag)).map(([k]) => sources.get(k)!.name);
      if (secret.length) proves.push({ circuit: c.name, message: st.message, sources: [...new Set(secret)] });
      continue;
    }
    const { guard, target, expr } = st.b;
    exprOf.set(target, expr);
    const g = union(val(guard));
    if (head(expr) === 'public-ledger') {
      const l = expr as SExpr[];
      const fid = symName(l[1]);
      const field = p.ledger.get(fid)?.name ?? baseName(fid);
      const op = isSym(l[3]) ? l[3].v : 'op';
      // Ledger results are public, and may differ from call to call.
      env.set(target, { label: new Map(), varying: mutated.has(fid) || field === 'kernel' });
      if (field === 'kernel' && SHIELDED_KERNEL_OPS.has(op)) {
        // The coin itself is private, but whether a receive or spend happened at all is public.
        if (op !== 'self') {
          recordGuard(field, op, g, [], []);
          sink(field, op, empty(), g);
        }
        continue;
      }
      touches.add(field);
      // A Merkle root that must match the public root reveals nothing new.
      const operands = /^checkRoot/.test(op) ? [] : l.slice(4).map(val);
      recordGuard(field, op, g, operands, l.slice(4));
      const note = (v: Val): OperandNote[] =>
        [...flat(v)].map(([k, f]) => {
          const s = sources.get(k)!;
          return { source: s.name, kind: s.kind, flow: f.flow, via: f.via, bits: f.flow === 'reveal' ? s.bits : f.flow === 'guessable' ? (f.preimageBits ?? s.bits) : f.flow === 'predicate' ? 1 : 0, tag: f.tag };
        });
      const guardedBy = [...g].filter(([, f]) => !(f.flow === 'hidden' && !f.tag)).map(([k]) => sources.get(k)!.name);
      if (ops.length < 400) ops.push({ field, op, operands: (/^checkRoot/.test(op) ? [] : l.slice(4)).map((x) => note(val(x))), guardedBy: [...new Set(guardedBy)] });
      // A branch on a value this same operation publishes in the clear tells nothing new.
      const shown = new Set([...union(...operands)].filter(([, f]) => f.flow === 'reveal').map(([k]) => k));
      const gs: Label = shown.size ? new Map([...g].filter(([k]) => !shown.has(k))) : g;
      if (operands.length === 2 && /^(insert|write)/.test(op)) {
        sink(field, op, operands[0], gs, 'key');
        // Per action: the key changes between calls (a counter) or the caller picks it (a post id).
        const perAction = anyVarying([operands[0]]) || [...flat(operands[0])].some(([k, f]) => f.flow === 'reveal' && sources.get(k)!.kind === 'argument');
        sink(field, op, operands[1], new Map(), 'value', perAction);
      } else sink(field, op, { label: union(...operands) }, gs, op === 'write' ? 'value' : 'key');
      continue;
    }
    const v = val(expr);
    if (g.size) {
      const lab = union(v);
      for (const [k, f] of withFlow(g, (f) => (f.flow === 'hidden' && !f.tag ? f : { flow: 'predicate', via: 'branch' }))) lab.set(k, mergeFact(lab.get(k), f));
      env.set(target, { label: lab });
    } else env.set(target, v);
  }

  // An exported circuit's result is part of the public transaction, like a ledger write.
  if (c.ret) {
    const r = val(c.ret);
    if (flat(r).size) {
      ops.push({ field: 'return', op: 'value', operands: [[...flat(r)].map(([k, f]) => ({ source: sources.get(k)!.name, kind: sources.get(k)!.kind, flow: f.flow, via: f.via, bits: f.flow === 'reveal' ? sources.get(k)!.bits : f.flow === 'guessable' ? (f.preimageBits ?? sources.get(k)!.bits) : f.flow === 'predicate' ? 1 : 0, tag: f.tag }))], guardedBy: [] });
      sink('return', 'value', r, new Map(), 'value');
    }
  }
  // A branch that runs the same operation on the same field on both paths shows nothing:
  // the transcript looks the same either way.
  const balanced = (f: Finding) => {
    const keys = f.sources.map((x) => `${x.kind === 'witness' ? 'w' : 'a'}:${x.name}`);
    const runs = (guarded.get(`${f.field}|${f.op}`) ?? []).filter((r) => keys.some((k) => r.keys.has(k)));
    return runs.length >= 2 && runs.every((r) => r.sig === runs[0].sig);
  };
  for (const [id, f] of findings) if (f.kind === 'branch' && balanced(f)) findings.delete(id);
  const list = [...findings.values()];
  // Nothing in this circuit ties the transaction to its caller (no reusable tag, no wallet key):
  // a branch then publishes an anonymous choice, like a public tally.
  const opsOn = (field: string) => new Set(ops.filter((o) => o.field === field).map((o) => o.op));
  const oneTime = (field: string) => opsOn(field).has('member') && opsOn(field).has('insert');
  const identified = list.some(
    (f) =>
      ((f.kind === 'linkable' || f.kind === 'attributable') && !oneTime(f.field)) ||
      // the wallet key, or a private identifier (16+ bytes) written in the clear
      (f.kind === 'published' && f.sources.some((x) => rootName(x.name) === 'ownPublicKey' || (x.kind === 'witness' && /^Bytes<(1[6-9]|[2-9]\d|\d{3,})>$/.test(x.type)))),
  );
  // ...unless the guarded operation itself writes an identity tag (a bidder filed under one set).
  const tagged = (field: string) => ops.some((o) => o.field === field && o.guardedBy.length && o.operands.some((xs) => xs.some((x) => x.tag)));
  for (const f of list)
    if (f.kind === 'branch' && f.severity === 'medium' && !identified && !tagged(f.field)) {
      f.severity = 'low';
      f.detail += ` Nothing else this circuit publishes ties the transaction to its caller, so this reads like a public tally of anonymous choices.`;
    }
  for (const f of list) {
    const roots = [...new Set(f.sources.map((x) => rootName(x.name)))];
    if (f.kind === 'branch' && f.sources.length > 1 && roots.length === 1) {
      const who = whoOf({ kind: f.sources[0].kind, name: roots[0] });
      if (isPositional(roots[0]) || isHint(roots[0])) {
        f.title = `whether \`${f.field}\` is touched depends on ${who} (${f.sources.length} parts)`;
        f.bits = f.sources.length;
        continue;
      }
      f.title = `how many of the ${f.sources.length} entries of ${who} are in use shows on chain`;
      f.detail = `Each entry of ${who} is checked with its own condition, and ledger operations (${(f.fields ?? []).slice(0, 3).join(', ')}) run only for some of them. The public transcript counts the operations, so observers learn how many entries were in use, and in which positions.`;
      f.fix = `Pad the loop: run the same ledger operations for every slot (against a dummy key for unused ones), or prove the aggregate with asserts instead of per-entry lookups.`;
      f.detail = f.detail.replace(/involving .*?\./, `involving ${who}.`);
      f.bits = f.sources.length;
    }
    if (f.kind === 'guessable-hash' && f.sources.some((x) => x.bits <= 1) && f.title.startsWith('which way')) {
      f.bits = Math.max(f.bits, f.sources.length);
      f.detail = f.detail.replace(/\(about \d+ bits? in all\)/, `(about ${f.bits} bit${f.bits === 1 ? '' : 's'} in all)`).replace(/choices made from [^ ]+ /, `choices made from ${whoOf({ kind: f.sources[0].kind, name: roots[0] })} `);
    }
  }
  for (const f of list)
    if (f.kind === 'guessable-hash' && f.sources.length > 1) {
      const root = [...new Set(f.sources.map((x) => x.name.replace(/[.[].*$/, '')))];
      const names = root.length === 1 ? `${f.sources.length} parts of ${whoOf({ kind: f.sources[0].kind, name: root[0] })}` : f.sources.map((x) => whoOf(x)).join(' + ');
      f.title = f.title.replace(/^(which way ).*?( steered)/, `$1${names}$2`).replace(/^.*?( is hidden behind)/, `${names} are hidden behind`).replace(' are hidden behind a', ' are hidden behind a');
    }
  for (const f of list)
    if (f.kind === 'linkable' && f.sources.length > 1) {
      const names = f.sources.map((x) => whoOf(x)).join(' + ');
      f.title = `${names} are hidden, but leave the same tag every time`;
      f.detail = f.detail.replace(/receives (\w+)\(… .*? …\)/, `receives $1(… ${names} …)`);
    }
  const publishedBits = list.reduce((a, f) => a + (f.kind === 'linkable' || f.kind === 'attributable' ? 0 : f.bits), 0);
  return {
    name: c.name,
    privateInputs: [...sources.values()].filter((s) => !/[.[]/.test(s.name)).map((s) => ({ name: s.name, kind: s.kind, type: typeText(s.type), bits: s.bits })),
    publishedBits,
    findings: list,
    proves,
    touches: [...touches],
    ops,
  };
}

// "divMod[0]" -> "divMod()[0]"; arguments are named as such.
export function whoOf(s: { kind: SourceKind; name: string }): string {
  if (s.kind === 'argument') return `argument \`${s.name}\``;
  const m = s.name.match(/^([^.[]+)(.*)$/)!;
  return `${m[1]}()${m[2]}`;
}

function fmtTries(bits: number): string {
  if (bits <= 20) return (2 ** bits).toLocaleString('en-US');
  return `2^${bits}`;
}

// The same tag published by several circuits links those transactions together.
function linkAcrossCircuits(findings: Finding[]) {
  // Only identical tags link transactions: same hash, same inputs, same domain separator.
  // A membership leaf and a nullifier from the same key are different values and link nothing.
  const byTag = new Map<string, Finding[]>();
  for (const f of findings) if (f.kind === 'linkable') byTag.set(f.tagFp ?? f.sources.map((s) => s.name).join(','), [...(byTag.get(f.tagFp ?? f.sources.map((s) => s.name).join(',')) ?? []), f]);
  for (const fs of byTag.values()) {
    const circuits = [...new Set(fs.map((f) => f.circuit))];
    if (circuits.length > 1)
      for (const f of fs) {
        f.severity = 'low';
        f.detail += ` The same tag appears in ${circuits.map((c) => `\`${c}\``).join(', ')}, so those transactions can be tied to one person.`;
      }
  }
}

// `const r = disclose(role);` marks an argument public in so many words: a hash of it hides nothing
// the author meant to hide.
export function declaredPublic(findings: Finding[], src: string) {
  for (const f of findings) {
    if (f.kind !== 'guessable-hash' || f.severity === 'low' || f.severity === 'info') continue;
    const args = f.sources.filter((s) => s.kind === 'argument');
    if (args.length === 0 || args.length !== f.sources.length) continue;
    const esc = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (args.every((a) => new RegExp(`disclose\\(\\s*${esc(a.name)}\\s*\\)`).test(src))) {
      f.severity = 'low';
      f.detail += ' The source discloses this argument directly, so it is treated as public on purpose.';
    }
  }
}

// Point each finding at the most likely source line.
function locate(findings: Finding[], src: string) {
  const lines = src.split('\n');
  const circuitStart = (name: string) => lines.findIndex((l) => new RegExp(`circuit\\s+${name}\\b`).test(l));
  for (const f of findings) {
    const start = circuitStart(f.circuit);
    const fieldRe = new RegExp(`\\b${f.field}\\b\\s*(\\.|=|\\+=|-=)`);
    let hit = -1;
    if (start >= 0) {
      for (let i = start; i < lines.length; i++) {
        if (i > start && /^\s*(export\s+)?(pure\s+)?circuit\s/.test(lines[i])) break;
        if (fieldRe.test(lines[i])) {
          hit = i;
          if (f.sources.some((s) => lines[i].includes(s.name))) break;
        }
      }
    }
    if (hit < 0) hit = lines.findIndex((l) => fieldRe.test(l));
    if (hit < 0) hit = start;
    if (hit >= 0) f.line = hit + 1;
  }
}
