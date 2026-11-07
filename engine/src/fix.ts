// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Fixes for what Tell finds. For each finding where a mechanical rewrite is sound, Tell writes
// a patch to the .compact source, the same rewrite the leak zoo's fixed contracts make. A patch
// is only offered once it is verified: the patched contract is compiled with the same compiler
// and scanned again, and it must compile, lose the finding and gain nothing at medium or worse.
// Where no rewrite is safe, the suggestion is a precise manual fix instead.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Finding, Report } from './analyze.js';
import { scanFile, gradeOf, severityRank, type ContractResult, type Grade } from './index.js';
import { findCompilers, type Compiler } from './compile.js';

export type FixRule = 'commit-hash' | 'hash-key' | 'one-time-tag' | 'assert-branch' | 'commit-value';

export const FIX_RULES: Record<FixRule, string> = {
  'commit-hash': 'A guessable hash becomes a commitment with a fresh 32-byte nonce from a new witness.',
  'hash-key': 'A key written in the clear becomes a domain-separated hash of the key; checks against it hash the same way.',
  'one-time-tag': 'The same tag on every action becomes a one-time tag: hash(domain, secret, entry key), or a commitment with a fresh nonce.',
  'assert-branch': 'A branch on a private value becomes an assert, so every accepted call touches the same fields.',
  'commit-value': 'A personal value written in the clear becomes a commitment with a fresh nonce; the ledger field holds Bytes<32>.',
};

export type Edit = { start: number; end: number; text: string };

export type Proposal =
  | { rule: FixRule; summary: string; notes: string[]; edits: Edit[]; witness?: string }
  | { rule: null; manual: string };

export type Verification = {
  ok: boolean;
  compiles: boolean;
  compiler: string | null;
  // the finding is no longer reported (nothing left above info for the same circuit, kind and field)
  gone: boolean;
  // findings at medium or worse that the original did not have
  newFindings: Finding[];
  gradeBefore: Grade | null;
  gradeAfter: Grade | null;
  error?: string;
};

export type Suggestion = {
  key: string;
  finding: Finding;
  rule: FixRule | null;
  summary: string;
  notes: string[];
  // set when no verified patch exists
  manual?: string;
  // set only for a verified patch
  patch?: { source: string; diff: string; range: ChangedRange; witness?: string };
  verification?: Verification;
};

export type FilePlan = {
  file: string;
  grade: Grade | null;
  suggestions: Suggestion[];
  // every verified patch applied together, verified again as a whole
  combined?: { source: string; diff: string; applied: string[]; verification: Verification };
};

// ---------------------------------------------------------------------------------------------
// Reading Compact source: just enough structure to place an edit, with offsets into the original.

// Comments and string contents blanked to spaces (same length), so brackets and names match safely.
export function mask(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      const e = j < 0 ? src.length : j;
      out += ' '.repeat(e - i);
      i = e;
    } else if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      const e = j < 0 ? src.length : j + 2;
      out += src.slice(i, e).replace(/[^\n]/g, ' ');
      i = e;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      const closed = src[j] === '"';
      const e = closed ? j + 1 : j;
      out += '"' + ' '.repeat(Math.max(0, e - i - (closed ? 2 : 1))) + (closed ? '"' : '');
      i = e;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const OPEN = '([{';
const CLOSE = ')]}';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function closeOf(m: string, i: number): number {
  let depth = 0;
  for (let j = i; j < m.length; j++) {
    if (OPEN.includes(m[j])) depth++;
    else if (CLOSE.includes(m[j]) && --depth === 0) return j;
  }
  return -1;
}

// `Vector<2, Bytes<32>>` after a name: the matching `>`, or -1 when `<` is a comparison.
function genericEnd(m: string, i: number): number {
  let depth = 0;
  for (let j = i; j < m.length; j++) {
    const ch = m[j];
    if (ch === '<') depth++;
    else if (ch === '>') {
      if (--depth === 0) return j;
    } else if (!/[\w\s,[\]."]/.test(ch)) return -1;
  }
  return -1;
}

type Range = [number, number];
const trimRange = (m: string, s: number, e: number): Range => {
  while (s < e && /\s/.test(m[s])) s++;
  while (e > s && /\s/.test(m[e - 1])) e--;
  return [s, e];
};

// Top-level comma-separated parts of m[start, end), skipping brackets and type arguments.
export function splitTop(m: string, start: number, end: number): Range[] {
  const out: Range[] = [];
  let depth = 0;
  let s = start;
  for (let j = start; j < end; j++) {
    const ch = m[j];
    if (ch === '<' && j > 0 && /\w/.test(m[j - 1])) {
      const g = genericEnd(m, j);
      if (g > 0 && g < end) {
        j = g;
        continue;
      }
    }
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      out.push(trimRange(m, s, j));
      s = j + 1;
    }
  }
  out.push(trimRange(m, s, end));
  return out.filter(([a, b]) => b > a);
}

class Source {
  readonly m: string;
  private starts: number[] = [0];
  constructor(
    readonly src: string,
    readonly file = 'contract.compact',
  ) {
    this.m = mask(src);
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') this.starts.push(i + 1);
  }
  lineStart(line: number) {
    return this.starts[Math.max(0, Math.min(line - 1, this.starts.length - 1))];
  }
  lineEnd(line: number) {
    const s = this.starts[line] ?? this.src.length + 1;
    return s - 1;
  }
  lineOf(off: number) {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
  indentAt(off: number) {
    const s = this.lineStart(this.lineOf(off));
    return this.src.slice(s).match(/^[ \t]*/)![0];
  }
  text(r: Range) {
    return this.src.slice(r[0], r[1]);
  }
  masked(r: Range) {
    return this.m.slice(r[0], r[1]);
  }
  get stem() {
    return path.basename(this.file).replace(/\.compact$/, '');
  }

  // A circuit's declaration line and body braces.
  circuit(name: string): { decl: number; open: number; close: number } | null {
    const re = new RegExp(`(^|\\n)[ \\t]*((?:export\\s+)?(?:pure\\s+)?circuit\\s+${esc(name)}\\b)`, 'g');
    const hit = re.exec(this.m);
    if (!hit) return null;
    const decl = hit.index + hit[0].indexOf(hit[2]);
    const paren = this.m.indexOf('(', decl);
    const pclose = paren < 0 ? -1 : closeOf(this.m, paren);
    const open = pclose < 0 ? -1 : this.m.indexOf('{', pclose);
    const close = open < 0 ? -1 : closeOf(this.m, open);
    return close < 0 ? null : { decl, open, close };
  }

  circuitNames(): string[] {
    return [...this.m.matchAll(/\bcircuit\s+(\w+)/g)].map((x) => x[1]);
  }

  identifiers(): Set<string> {
    return new Set([...this.m.matchAll(/\b[A-Za-z_]\w*\b/g)].map((x) => x[0]));
  }

  // `const x = expr;` bindings in a circuit body, in order.
  consts(body: Range): { name: string; expr: Range; at: number }[] {
    const out: { name: string; expr: Range; at: number }[] = [];
    const re = /\bconst\s+(\w+)\s*(?::[^=;]+)?=(?!=)/g;
    re.lastIndex = body[0];
    for (let x = re.exec(this.m); x && x.index < body[1]; x = re.exec(this.m)) {
      const s = x.index + x[0].length;
      const e = this.statementEnd(s, body[1]);
      out.push({ name: x[1], expr: trimRange(this.m, s, e), at: x.index });
    }
    return out;
  }

  // The `;` that ends the statement starting at s (at bracket depth 0).
  statementEnd(s: number, limit = this.m.length): number {
    let depth = 0;
    for (let j = s; j < limit; j++) {
      const ch = this.m[j];
      if (OPEN.includes(ch)) depth++;
      else if (CLOSE.includes(ch)) {
        if (--depth < 0) return j;
      } else if (ch === ';' && depth === 0) return j;
    }
    return limit;
  }

  // Ledger declarations: name, type text and the type's offsets.
  ledger(): Map<string, LedgerDecl> {
    const out = new Map<string, LedgerDecl>();
    const re = /\b(?:export\s+)?(?:sealed\s+)?ledger\s+(\w+)\s*:\s*/g;
    for (const x of this.m.matchAll(re)) {
      const s = x.index! + x[0].length;
      const e = this.m.indexOf(';', s);
      if (e < 0) continue;
      const type = trimRange(this.m, s, e);
      const t = this.text(type);
      const g = t.match(/^(\w+)\s*</);
      let kind = g ? g[1] : t;
      let args: Range[] = [];
      if (g) {
        const lt = type[0] + t.indexOf('<');
        const gt = genericEnd(this.m, lt);
        if (gt > 0) args = splitTop(this.m, lt + 1, gt);
      }
      if (!['Map', 'Set', 'Counter', 'List', 'MerkleTree', 'HistoricMerkleTree'].includes(kind)) {
        kind = 'Cell';
        args = [type];
      }
      out.set(x[1], { name: x[1], kind, type, args });
    }
    return out;
  }

  // The text an expression can stand for: itself, the consts it names (bound before `at` in the
  // circuit), and the bodies of the circuits it calls.
  expand(r: Range, body: Range | null, depth = 0, seen = new Set<string>()): string {
    let out = this.masked(r);
    if (depth > 5) return out;
    if (body)
      for (const k of this.consts(body).filter((k) => k.at < r[0]).reverse())
        if (!seen.has(k.name) && new RegExp(`\\b${esc(k.name)}\\b`).test(this.masked(r))) {
          seen.add(k.name);
          out += ' ' + this.expand(k.expr, body, depth + 1, seen);
        }
    for (const name of this.circuitNames())
      if (!seen.has('circuit:' + name) && new RegExp(`\\b${esc(name)}\\s*\\(`).test(this.masked(r))) {
        seen.add('circuit:' + name);
        const c = this.circuit(name);
        if (c) out += ' ' + this.expand([c.open, c.close + 1], [c.open, c.close + 1], depth + 1, seen);
      }
    return out;
  }
}

type LedgerDecl = { name: string; kind: string; type: Range; args: Range[] };

// The written expression's type at an operation: a Map's key or value, a Set's element, a cell.
function positionType(src: Source, d: LedgerDecl | undefined, op: string, argIndex: number): { text: string; range: Range } | null {
  if (!d) return null;
  const at = (i: number) => (d.args[i] ? { text: src.text(d.args[i]).replace(/\s+/g, ' '), range: d.args[i] } : null);
  if (d.kind === 'Map' && op === 'insert') return at(argIndex);
  if ((d.kind === 'Set' && op === 'insert') || (d.kind === 'List' && /^push/.test(op))) return at(0);
  if (d.kind === 'Cell' && op === 'write') return at(0);
  return null;
}

const normType = (t: string | undefined) => (t ?? '').replace(/\s+/g, '');
const isBytes32 = (t: string | undefined) => normType(t) === 'Bytes<32>';

// `disclose(x)` -> x
function stripDisclose(src: Source, r: Range): Range {
  const t = src.masked(r);
  const m = t.match(/^disclose\s*\(/);
  if (m) {
    const open = r[0] + m[0].length - 1;
    if (closeOf(src.m, open) === r[1] - 1) return stripDisclose(src, trimRange(src.m, open + 1, r[1] - 1));
  }
  return r;
}

type OpSite = { kind: 'call'; at: number; args: Range[]; stmt: Range } | { kind: 'write'; at: number; args: Range[]; stmt: Range };

const rootName = (n: string) => n.replace(/[.[].*$/, '');
const mentionsSource = (text: string, s: Finding['sources'][number]) =>
  s.kind === 'witness' ? new RegExp(`\\b${esc(rootName(s.name))}\\s*\\(`).test(text) : new RegExp(`\\b${esc(rootName(s.name))}\\b`).test(text);

// The ledger operation a finding points at: on its line first, then anywhere in the circuit.
function findOp(src: Source, f: Finding): { site: OpSite; body: Range } | null {
  const c = src.circuit(f.circuit);
  if (!c) return null;
  const body: Range = [c.open, c.close + 1];
  const sites: OpSite[] = [];
  if (f.op === 'write') {
    const re = new RegExp(`(?<![\\w.])${esc(f.field)}\\s*=(?!=)`, 'g');
    re.lastIndex = body[0];
    for (let x = re.exec(src.m); x && x.index < body[1]; x = re.exec(src.m)) {
      const s = x.index + x[0].length;
      const e = src.statementEnd(s, body[1]);
      sites.push({ kind: 'write', at: x.index, args: [trimRange(src.m, s, e)], stmt: [x.index, e + 1] });
    }
  }
  const re = new RegExp(`(?<![\\w.])${esc(f.field)}\\s*\\.\\s*${esc(f.op)}\\s*\\(`, 'g');
  re.lastIndex = body[0];
  for (let x = re.exec(src.m); x && x.index < body[1]; x = re.exec(src.m)) {
    const open = x.index + x[0].length - 1;
    const close = closeOf(src.m, open);
    if (close < 0) continue;
    sites.push({ kind: 'call', at: x.index, args: splitTop(src.m, open + 1, close), stmt: [x.index, src.statementEnd(close, body[1]) + 1] });
  }
  if (sites.length === 0) return null;
  const onLine = sites.filter((s) => f.line && src.lineOf(s.at) === f.line);
  const relevant = (s: OpSite) => s.args.some((a) => f.sources.some((x) => mentionsSource(src.expand(a, body), x)));
  const site = onLine.find(relevant) ?? onLine[0] ?? sites.find(relevant) ?? sites[0];
  return { site, body };
}

function freshName(src: Source, base: string): string {
  const ids = src.identifiers();
  const clean = base.replace(/\W/g, '') || 'value';
  let n = `${clean}Nonce`;
  for (let i = 2; ids.has(n); i++) n = `${clean}Nonce${i}`;
  return n;
}

// Insert a witness declaration just above the circuit that uses it (above its doc comment).
function witnessEdit(src: Source, circuit: string, name: string): Edit {
  const c = src.circuit(circuit)!;
  let line = src.lineOf(c.decl);
  while (line > 1 && /^\s*\/\//.test(src.src.slice(src.lineStart(line - 1), src.lineEnd(line - 1)))) line--;
  const at = src.lineStart(line);
  return { start: at, end: at, text: `witness ${name}(): Bytes<32>; // fresh random bytes per call, kept to open the commitment\n\n` };
}

const domain = (src: Source, field: string) => JSON.stringify(`${src.stem}:${field}`.slice(0, 32));

const nonceNote = (w: string, reused = false) =>
  reused
    ? `Uses the \`${w}\` witness the contract already declares. Off-chain it must return 32 fresh random bytes on every call, kept in private state with the value; they are needed to open or prove the commitment later.`
    : `Off-chain: implement the \`${w}\` witness to return 32 fresh random bytes on every call and keep them in private state with the value; they are needed to open or prove the commitment later.`;

const where = (f: Finding) => `\`${f.field}\` ${f.op} in \`${f.circuit}\`${f.line ? ` (line ${f.line})` : ''}`;

const isSerious = (f: Finding) => !f.suppressed && severityRank(f.severity) <= severityRank('medium');
// What gets a fix: medium or worse, and branches on private state rated low only because nothing
// identifies the caller (each call still leaks its outcome, so the fix is still worth offering).
const isFixTarget = (f: Finding) => isSerious(f) || (!f.suppressed && f.kind === 'branch' && f.severity === 'low' && f.sources.every((s) => s.kind === 'witness') && f.detail.includes('anonymous choices'));

// A local check for key material by name (the analyzer has its own; this one only picks a rewrite).
const KEYISH = /(^|[^a-z])(secret|sk|seed|priv|private|mnemonic|password|passphrase|key)([^a-z]|$)/i;
const words = (n: string) => n.split(/[._\s]+|(?<=[a-z0-9])(?=[A-Z])/).join(' ').toLowerCase();
const keyish = (n: string) => KEYISH.test(words(rootName(n))) && !/\b(pub|public|pk|id|commitment|hash)\b/.test(words(rootName(n)));

// ---------------------------------------------------------------------------------------------
// The rewrites.

export function propose(srcText: string, f: Finding, report?: Report, file?: string): Proposal {
  const src = new Source(srcText, file);
  const manual = (text: string): Proposal => ({ rule: null, manual: text });
  if (f.field === 'return') return manual(`A circuit's result is not on chain, but it leaves the proof: your DApp, or a contract that calls \`${f.circuit}\`, receives it and may publish it. If only the DApp needs ${f.sources.map((s) => `\`${s.name}\``).join(', ')}, read it from private state there instead; otherwise return a hash or a commitment, or nothing.`);
  if (f.kind === 'derivable-secret') return manual(`${where(f)}: ${f.fix}`);
  if (f.field === 'kernel') return manual(`${where(f)} is a token operation whose operands are public by design. ${f.fix}`);
  const src0 = f.sources[0];
  switch (f.kind) {
    case 'guessable-hash':
      if (f.detail.includes('yes/no choices')) return manual(`${f.fix} The unknown inputs here are yes/no selectors (such as Merkle path bits); hide them only if the leaf position is private.`);
      return commitHash(src, f) ?? manual(`${where(f)}: ${f.fix}`);
    case 'secret-published':
      if (src0 && keyish(src0.name)) return hashKey(src, f) ?? manual(`${where(f)}: ${f.fix}`);
      return manual(`${where(f)} writes ${src0 ? `\`${src0.name}\`` : 'a value'} in the clear while another circuit hashes it. If this is the reveal step of a commit-reveal, mark the line with \`// tell:allow secret-published\`; otherwise publish the same hash here instead of the value.`);
    case 'published':
      if (src0 && rootName(src0.name) === 'ownPublicKey')
        return manual(
          `${where(f)} stores the caller's wallet key. Identify the user by a secret instead: declare \`witness ${f.field}SecretKey(): Bytes<32>;\`, store \`persistentHash<Vector<2, Bytes<32>>>([pad(32, ${domain(src, f.field)}), ${f.field}SecretKey()])\`, and check the caller by recomputing the same hash.`,
        );
      if (src0 && src0.kind === 'witness' && keyish(src0.name) && isBytes32(src0.type)) return hashKey(src, f) ?? manual(`${where(f)}: ${f.fix}`);
      return commitValue(src, f) ?? manual(`${where(f)}: ${f.fix}`);
    case 'attributable':
      return oneTimeTag(src, f, report) ?? manual(`${where(f)}: ${f.fix}`);
    case 'branch':
    {
      const r = assertBranch(src, f);
      return typeof r === 'string' ? manual(r) : r;
    }
    default:
      return manual(`${where(f)}: ${f.fix}`);
  }
}

// Wrap the written hash in a commitment with a fresh nonce: hash(vote) -> commit(hash(vote), nonce).
// A commitment whose randomness is constant or public is fixed where it is wrong: its randomness
// is replaced, commit(v, pad(32, "salt")) -> commit(v, nonce()), never committed a second time.
function commitHash(src: Source, f: Finding): Proposal | null {
  const hit = findOp(src, f);
  if (!hit) return null;
  const { site, body } = hit;
  const idx = pickArg(src, site, body, f, (t) => (f.via ? t.includes(f.via) : true));
  if (idx < 0) return null;
  const arg = site.args[idx];
  const n = nonceWitness(src, f.field, body);
  const edits: Edit[] = n.declare ? [witnessEdit(src, f.circuit, n.name)] : [];
  const notes = [nonceNote(n.name, !n.declare)];
  const salt = f.via === 'persistentCommit' || f.via === 'transientCommit' ? commitRandomness(src, stripDisclose(src, arg), body) : null;
  if (salt) {
    const text = salt.transient ? `degradeToTransient(${n.name}())` : `${n.name}()`;
    return {
      rule: 'commit-hash',
      summary: `give the ${salt.transient ? 'transientCommit' : 'persistentCommit'} fresh randomness: replace \`${src.text(salt.range).replace(/\s+/g, ' ')}\` with \`${text}\``,
      notes: [...notes, `The committed value is unchanged; only its randomness is. Code that opens these commitments needs the nonce now kept in private state.`],
      edits: [...edits, { start: salt.range[0], end: salt.range[1], text }],
      witness: n.name,
    };
  }
  const t = positionType(src, src.ledger().get(f.field), f.op, idx);
  if (!t) return null;
  const inner = src.text(stripDisclose(src, arg));
  let text: string;
  if (isBytes32(t.text)) text = `disclose(persistentCommit<Bytes<32>>(${inner}, ${n.name}()))`;
  else if (normType(t.text) === 'Field') text = `disclose(transientCommit<Field>(${inner}, degradeToTransient(${n.name}())))`;
  else return null;
  return {
    rule: 'commit-hash',
    summary: `store a commitment with a fresh nonce instead of the guessable ${f.via ?? 'hash'}`,
    notes: [...notes, `Anything that recomputed the old value to look this entry up (off-chain code, or a helper such as an exported hash circuit) must use persistentCommit with the stored nonce instead.`],
    edits: [...edits, { start: arg[0], end: arg[1], text }],
    witness: n.name,
  };
}

// The randomness argument of persistentCommit / transientCommit in `r`, written directly or
// through a `const` in the same circuit, when it is not already a witness call.
function commitRandomness(src: Source, r: Range, body: Range, depth = 0): { range: Range; transient: boolean } | null {
  const t = src.masked(r);
  const name = t.match(/^\w+$/)?.[0];
  if (name && depth < 4) {
    const c = src.consts(body).filter((x) => x.name === name && x.at < r[0]).at(-1);
    return c ? commitRandomness(src, stripDisclose(src, c.expr), body, depth + 1) : null;
  }
  const m = t.match(/^(persistentCommit|transientCommit)\s*/);
  if (!m) return null;
  let open = r[0] + m[0].length;
  if (src.m[open] === '<') {
    const g = genericEnd(src.m, open);
    if (g < 0) return null;
    open = g + 1 + (src.m.slice(g + 1).match(/^\s*/)?.[0].length ?? 0);
  }
  if (src.m[open] !== '(' || closeOf(src.m, open) !== r[1] - 1) return null;
  const parts = splitTop(src.m, open + 1, r[1] - 1);
  if (parts.length !== 2) return null;
  return { range: parts[1], transient: m[1] === 'transientCommit' };
}

// The witness a fix draws its randomness from: a Bytes<32> witness the contract already declares
// and names as randomness (`ballotSalt`, `bidNonce`) that this circuit does not call yet, so one
// call never uses the same bytes twice; otherwise a new one named after the field.
const RANDOM_WORDS = ['salt', 'nonce', 'rand', 'random', 'randomness', 'blind', 'blinding', 'entropy'];
function nonceWitness(src: Source, field: string, body: Range): { name: string; declare: boolean } {
  const decls = [...src.m.matchAll(/\bwitness\s+(\w+)\s*\(\s*\)\s*:\s*Bytes\s*<\s*32\s*>/g)].map((x) => x[1]);
  const named = decls.filter((n) => n.split(/[._]|(?<=[a-z0-9])(?=[A-Z])/).some((w) => RANDOM_WORDS.includes(w.toLowerCase())));
  // calls, not the declaration `witness n(): Bytes<32>`
  const callsIn = (n: string, r: Range) => [...src.m.slice(r[0], r[1]).matchAll(new RegExp(`\\b${esc(n)}\\s*\\(\\s*\\)(?!\\s*:)`, 'g'))].length;
  const free = named.filter((n) => callsIn(n, body) === 0);
  // prefer one nothing calls (a salt the edit that introduced the leak stopped using)
  const unused = free.find((n) => callsIn(n, [0, src.m.length]) === 0);
  const pick = unused ?? free[0];
  return pick ? { name: pick, declare: false } : { name: freshName(src, field), declare: true };
}

// Which operand of the operation carries the finding.
function pickArg(src: Source, site: OpSite, body: Range, f: Finding, also: (expanded: string) => boolean = () => true): number {
  const scored = site.args.map((a, i) => {
    const t = src.expand(a, body);
    return { i, src: f.sources.some((s) => mentionsSource(t, s)), also: also(t) };
  });
  const best = [...scored].reverse().find((x) => x.src && x.also) ?? [...scored].reverse().find((x) => x.src);
  return best ? best.i : -1;
}

// A key in the clear becomes hash(domain, key), and every comparison against the field hashes too.
function hashKey(src: Source, f: Finding): Proposal | null {
  const hit = findOp(src, f);
  if (!hit) return null;
  const { site, body } = hit;
  const idx = pickArg(src, site, body, f);
  if (idx < 0) return null;
  const t = positionType(src, src.ledger().get(f.field), f.op, idx);
  if (!t || !isBytes32(t.text)) return null;
  const dom = domain(src, f.field);
  const hash = (x: string) => `persistentHash<Vector<2, Bytes<32>>>([pad(32, ${dom}), ${x}])`;
  const arg = site.args[idx];
  const edits: Edit[] = [{ start: arg[0], end: arg[1], text: `disclose(${hash(src.text(stripDisclose(src, arg)))})` }];
  const checks: string[] = [];
  // `field == x` and `x == field` anywhere in the contract, where x carries the same secret
  const s = f.sources[0];
  const cmp = new RegExp(`(?<![\\w.])${esc(f.field)}\\b(?!\\s*[.(\\[])\\s*(==|!=)|(==|!=)\\s*${esc(f.field)}\\b(?!\\s*[.(\\[])`, 'g');
  for (const x of src.m.matchAll(cmp)) {
    const opAt = x.index! + x[0].search(/==|!=/);
    const left = x[0].startsWith(f.field) || /^\w/.test(x[0]);
    const operand = left ? operandAfter(src, opAt + 2) : operandBefore(src, opAt);
    if (!operand) continue;
    const cBody = enclosingCircuitBody(src, opAt);
    if (!mentionsSource(src.expand(operand, cBody), s)) continue;
    if (edits.some((e) => e.start < operand[1] && operand[0] < e.end)) continue;
    const inner = stripDisclose(src, operand);
    const wrapped = inner[0] !== operand[0] ? `disclose(${hash(src.text(inner))})` : hash(src.text(inner));
    edits.push({ start: operand[0], end: operand[1], text: wrapped });
    checks.push(`line ${src.lineOf(operand[0])}`);
  }
  return {
    rule: 'hash-key',
    summary: `publish a hash of the key instead of the key`,
    notes: [
      `The ledger keeps persistentHash([${dom}, key]); the key never leaves private state.` + (checks.length ? ` Checks against \`${f.field}\` now hash the same way (${checks.join(', ')}).` : ''),
      `Any off-chain code that reads \`${f.field}\` gets the hash, not the key.`,
    ],
    edits,
  };
}

function enclosingCircuitBody(src: Source, at: number): Range | null {
  for (const n of src.circuitNames()) {
    const c = src.circuit(n);
    if (c && c.open < at && at < c.close) return [c.open, c.close + 1];
  }
  return null;
}

function operandAfter(src: Source, s: number): Range | null {
  const m = src.m;
  let depth = 0;
  let j = s;
  for (; j < m.length; j++) {
    const ch = m[j];
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (ch === ',' || ch === ';' || ch === '?' || m.startsWith('&&', j) || m.startsWith('||', j))) break;
  }
  const r = trimRange(m, s, j);
  return r[1] > r[0] ? r : null;
}

function operandBefore(src: Source, e: number): Range | null {
  const m = src.m;
  let depth = 0;
  let j = e - 1;
  for (; j >= 0; j--) {
    const ch = m[j];
    if (CLOSE.includes(ch)) depth++;
    else if (OPEN.includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (ch === ',' || ch === ';' || ch === '=' || ch === '!' || ch === '{' || m.startsWith('&&', j - 1) || m.startsWith('||', j - 1))) break;
  }
  const r = trimRange(m, j + 1, e);
  return r[1] > r[0] ? r : null;
}

// The same tag on every action becomes one per entry: hash(domain, secret, entry key).
function oneTimeTag(src: Source, f: Finding, report?: Report): Proposal | null {
  const hit = findOp(src, f);
  if (!hit) return null;
  const { site, body } = hit;
  const decl = src.ledger().get(f.field);
  const idx = pickArg(src, site, body, f);
  if (idx < 0) return null;
  const arg = site.args[idx];
  const t = positionType(src, decl, f.op, idx);
  if (!t || !isBytes32(t.text)) return null;
  const s = f.sources[0];
  const notes: string[] = [];
  // Linked anyway: the same tag read by another operation of this circuit (a membership check).
  const cr = report?.circuits.find((c) => c.name === f.circuit);
  const reads = (cr?.ops ?? []).filter((o) => o.field !== f.field && o.operands.some((xs) => xs.some((x) => x.tag && x.source === s.name)));
  for (const o of reads)
    notes.push(
      `\`${o.field}.${o.op}\` still receives the same tag in every \`${f.circuit}\` transcript, so the transactions themselves stay linkable. To make them unlinkable too, prove membership with a Merkle path that never names the leaf (see zoo/contracts/board-fixed.compact).`,
    );
  const secretCall = s.kind === 'witness' && isBytes32(s.type) ? src.expand(arg, body).match(new RegExp(`\\b${esc(rootName(s.name))}\\s*\\(\\s*\\)`))?.[0] : undefined;
  const keyArg = decl?.kind === 'Map' && f.op === 'insert' && idx === 1 ? site.args[0] : null;
  const keyType = keyArg ? positionType(src, decl, 'insert', 0)?.text : undefined;
  const asBytes = (k: string, ty: string | undefined) => {
    const n = normType(ty);
    if (n === 'Bytes<32>') return k;
    const p = /^\w+$/.test(k) ? k : `(${k})`;
    if (n === 'Field') return `${p} as Bytes<32>`;
    if (/^Uint<[\d.]+>$/.test(n) || n === 'Boolean') return `(${p} as Field) as Bytes<32>`;
    return null;
  };
  const keyBytes = keyArg ? asBytes(src.text(stripDisclose(src, keyArg)), keyType) : null;
  if (secretCall && keyBytes) {
    const dom = domain(src, f.field);
    return {
      rule: 'one-time-tag',
      summary: `store a one-time tag, hash(domain, secret, entry key), instead of the same tag on every entry`,
      notes: [`Each entry now carries persistentHash([${dom}, ${secretCall}, key]): different for every entry, and only the holder of the secret can recompute it to prove authorship.`, ...notes],
      edits: [{ start: arg[0], end: arg[1], text: `disclose(persistentHash<Vector<3, Bytes<32>>>([pad(32, ${dom}), ${secretCall.replace(/\s+/g, '')}, ${keyBytes}]))` }],
    };
  }
  const n = nonceWitness(src, f.field, body);
  const w = n.name;
  return {
    rule: 'one-time-tag',
    summary: `store a commitment to the tag with a fresh nonce, different on every entry`,
    notes: [nonceNote(w, !n.declare), ...notes],
    edits: [...(n.declare ? [witnessEdit(src, f.circuit, w)] : []), { start: arg[0], end: arg[1], text: `disclose(persistentCommit<Bytes<32>>(${src.text(stripDisclose(src, arg))}, ${w}()))` }],
    witness: w,
  };
}

// if (secret) { A } else { B }  ->  assert(secret, …); A
// When the rewrite does not apply, the reason, as the manual fix text.
function assertBranch(src: Source, f: Finding): Proposal | string {
  const who = f.sources.map((s) => `\`${s.name}\``).join(', ');
  const general = `Either touch \`${f.field}\` the same way on both paths (the same operation with the same shape of data, e.g. a salted commitment to the outcome), or require one outcome with assert() so every accepted call does the same thing.`;
  const c = src.circuit(f.circuit);
  if (!c || !f.line) return `${where(f)} depends on ${who}, but Tell could not find the branch in the source (it may be inside an inlined helper). ${general}`;
  const at = src.lineStart(f.line) + (src.src.slice(src.lineStart(f.line)).match(/^\s*/)?.[0].length ?? 0);
  type If = { start: number; cond: Range; then: Range; els: Range | null; end: number };
  const ifs: If[] = [];
  const re = /\bif\s*\(/g;
  re.lastIndex = c.open;
  for (let x = re.exec(src.m); x && x.index < c.close; x = re.exec(src.m)) {
    const open = x.index + x[0].length - 1;
    const close = closeOf(src.m, open);
    const tb = src.m.slice(close + 1).search(/\S/) + close + 1;
    if (src.m[tb] !== '{') continue;
    const te = closeOf(src.m, tb);
    let end = te + 1;
    let els: Range | null = null;
    const rest = src.m.slice(te + 1);
    const e = rest.match(/^\s*else\s*/);
    if (e) {
      const eb = te + 1 + e[0].length;
      if (src.m[eb] !== '{') continue; // else-if chains are not rewritten
      const ee = closeOf(src.m, eb);
      els = [eb, ee + 1];
      end = ee + 1;
    }
    ifs.push({ start: x.index, cond: trimRange(src.m, open + 1, close), then: [tb, te + 1], els, end });
  }
  const inside = ifs.filter((i) => i.start < at && at < i.end).sort((a, b) => a.end - a.start - (b.end - b.start));
  const it = inside[0];
  if (!it)
    return `${where(f)} depends on ${who} through a condition Tell cannot rewrite automatically: it is not a braced \`if { } else { }\` block in \`${f.circuit}\` (an \`else if\` chain, a conditional expression \`c ? a : b\`, or a branch inside a helper circuit or the standard library). ${general}`;
  // a branch inside a loop is a count leak: an assert there would change what the loop means
  const loops = [...src.m.slice(c.open, c.close).matchAll(/\bfor\s*\(/g)].map((x) => c.open + x.index!);
  for (const l of loops) {
    const p = closeOf(src.m, src.m.indexOf('(', l));
    const b = src.m.slice(p + 1).search(/\S/) + p + 1;
    if (src.m[b] === '{' && b < it.start && it.end <= closeOf(src.m, b))
      return `${where(f)} runs inside a loop, once per entry, depending on ${who}: the transcript counts how many entries took this path. An assert would change what the loop means, so Tell does not rewrite it. Pad the loop instead: run the same ledger operation for every entry (against a dummy key for the ones that do not qualify), or prove the aggregate with asserts and store one commitment to it.`;
  }
  const blockText = (r: Range) => src.src.slice(r[0] + 1, r[1] - 1);
  const thenEmpty = !/\S/.test(src.masked([it.then[0] + 1, it.then[1] - 1]));
  const keepElse = thenEmpty && it.els !== null;
  const cond = src.text(stripDisclose(src, it.cond));
  const indent = src.indentAt(it.start);
  const kept = blockText(keepElse ? it.els! : it.then);
  const lines = kept.split('\n').filter((l, i, a) => !((i === 0 || i === a.length - 1) && !l.trim()));
  const inner = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length));
  const body = lines.map((l) => (l.trim() ? indent + l.slice(Number.isFinite(inner) ? inner : 0) : '')).join('\n');
  const assertion = keepElse ? `assert(!(${cond}), "this call does not meet the condition");` : `assert(${cond}, "this call does not meet the condition");`;
  const dropped = src.masked(keepElse ? it.then : (it.els ?? [0, 0]));
  const droppedFields = [...new Set([...dropped.matchAll(/\b(\w+)\s*\.\s*\w+\s*\(/g)].map((x) => x[1]).filter((n) => src.ledger().has(n)))];
  return {
    rule: 'assert-branch',
    summary: `require the condition with assert, so every accepted call touches the same fields`,
    notes: [
      `This changes behaviour: calls where \`${cond}\` is ${keepElse ? 'true' : 'false'} are now rejected instead of taking the other path. If both outcomes must be accepted, the branch cannot be hidden by a rewrite; record a commitment to the outcome instead.`,
      ...(droppedFields.length ? [`${droppedFields.map((n) => `\`${n}\``).join(', ')} ${droppedFields.length === 1 ? 'is' : 'are'} no longer written here and can be removed if nothing else uses ${droppedFields.length === 1 ? 'it' : 'them'}.`] : []),
    ],
    edits: [{ start: it.start, end: it.end, text: `${assertion}\n${body}`.replace(/\n$/, '') }],
  };
}

// A personal value in the clear becomes commit(value, nonce); the field's type becomes Bytes<32>.
function commitValue(src: Source, f: Finding): Proposal | null {
  const hit = findOp(src, f);
  if (!hit) return null;
  const { site, body } = hit;
  const idx = pickArg(src, site, body, f);
  if (idx < 0) return null;
  const t = positionType(src, src.ledger().get(f.field), f.op, idx);
  if (!t) return null;
  const arg = site.args[idx];
  const n = nonceWitness(src, f.field, body);
  const w = n.name;
  const edits: Edit[] = [...(n.declare ? [witnessEdit(src, f.circuit, w)] : []), { start: arg[0], end: arg[1], text: `disclose(persistentCommit<${t.text}>(${src.text(stripDisclose(src, arg))}, ${w}()))` }];
  if (!isBytes32(t.text)) edits.push({ start: t.range[0], end: t.range[1], text: 'Bytes<32>' });
  return {
    rule: 'commit-value',
    summary: `store a commitment to the value with a fresh nonce instead of the value`,
    notes: [nonceNote(w, !n.declare), ...(isBytes32(t.text) ? [] : [`\`${f.field}\` now holds Bytes<32> commitments instead of ${t.text}; code that reads it must open the commitment instead.`])],
    edits,
    witness: w,
  };
}

export function applyEdits(src: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].end > sorted[i - 1].start) throw new Error('overlapping edits');
  let out = src;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Diffs.

type DiffOp = { t: ' ' | '-' | '+'; s: string; a: number; b: number };

function diffLines(a: string[], b: string[]): DiffOp[] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const A = a.slice(p, a.length - q);
  const B = b.slice(p, b.length - q);
  // LCS over the middle; contracts are small, edits are local
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: DiffOp[] = [];
  for (let i = 0; i < p; i++) ops.push({ t: ' ', s: a[i], a: i, b: i });
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) {
      ops.push({ t: ' ', s: A[i], a: p + i, b: p + j });
      i++;
      j++;
    } else if (i < A.length && (j >= B.length || dp[i + 1][j] >= dp[i][j + 1])) {
      ops.push({ t: '-', s: A[i], a: p + i, b: p + j });
      i++;
    } else {
      ops.push({ t: '+', s: B[j], a: p + i, b: p + j });
      j++;
    }
  }
  for (let k = 0; k < q; k++) ops.push({ t: ' ', s: a[a.length - q + k], a: a.length - q + k, b: b.length - q + k });
  return ops;
}

export function unifiedDiff(before: string, after: string, name: string, context = 3): string {
  if (before === after) return '';
  const split = (s: string) => (s.endsWith('\n') ? s.slice(0, -1) : s).split('\n');
  const ops = diffLines(split(before), split(after));
  const changed = ops.map((o, i) => (o.t !== ' ' ? i : -1)).filter((i) => i >= 0);
  const hunks: [number, number][] = [];
  for (const i of changed) {
    const s = Math.max(0, i - context);
    const e = Math.min(ops.length - 1, i + context);
    const last = hunks.at(-1);
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else hunks.push([s, e]);
  }
  const out = name.startsWith('../') || path.isAbsolute(name) ? [`--- ${name}`, `+++ ${name}`] : [`--- a/${name}`, `+++ b/${name}`];
  for (const [s, e] of hunks) {
    const part = ops.slice(s, e + 1);
    const aLines = part.filter((o) => o.t !== '+').length;
    const bLines = part.filter((o) => o.t !== '-').length;
    const aStart = (part.find((o) => o.t !== '+')?.a ?? part[0].a) + (aLines ? 1 : 0);
    const bStart = (part.find((o) => o.t !== '-')?.b ?? part[0].b) + (bLines ? 1 : 0);
    out.push(`@@ -${aStart},${aLines} +${bStart},${bLines} @@`);
    for (const o of part) out.push(o.t + o.s);
  }
  return out.join('\n') + '\n';
}

// The smallest block of original lines (1-based, inclusive) whose replacement turns before into
// after. A pure insertion is widened to the line above it, so it can be shown as a replacement.
export type ChangedRange = { start: number; end: number; lines: string[] };
export function changedRange(before: string, after: string): ChangedRange | null {
  if (before === after) return null;
  const a = before.split('\n');
  const b = after.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  let s = p;
  let e = a.length - q; // exclusive
  let bs = p;
  let be = b.length - q;
  if (e === s) {
    if (s > 0) {
      s--;
      bs--;
    } else {
      e++;
      be++;
    }
  }
  return { start: s + 1, end: e, lines: b.slice(bs, be) };
}

// ---------------------------------------------------------------------------------------------
// Verification and planning.

export const findingKey = (f: Finding, file = '') =>
  crypto
    .createHash('sha1')
    .update([file, f.circuit, f.kind, f.field, f.sources.map((s) => s.name).sort().join(',')].join('|'))
    .digest('hex')
    .slice(0, 12);

const same = (a: Finding, b: Finding) => a.circuit === b.circuit && a.kind === b.kind && a.field === b.field;

export async function verifyPatch(file: string, patched: string, before: ContractResult, target: Finding | null, compilers: Compiler[]): Promise<Verification & { result?: ContractResult }> {
  const pinned = compilers.filter((c) => c.version === before.compiler);
  const use = pinned.length ? pinned : compilers;
  const tmp = path.join(path.dirname(file), `.${path.basename(file, '.compact')}.tell-fix-${process.pid}-${crypto.randomBytes(3).toString('hex')}.compact`);
  fs.writeFileSync(tmp, patched);
  let r: ContractResult;
  try {
    r = await scanFile(tmp, use);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  r = { ...r, file };
  const gradeBefore = before.grade ?? null;
  if (!r.ok) return { ok: false, compiles: false, compiler: r.compiler, gone: false, newFindings: [], gradeBefore, gradeAfter: null, error: r.error };
  const live = r.report!.findings.filter((f) => !f.suppressed);
  const gone = target ? !live.some((g) => same(g, target) && g.severity !== 'info') : true;
  const old = (before.report?.findings ?? []).filter((f) => !f.suppressed);
  // A one-time tag per action leaves the same circuit's membership lookup of the old tag in place.
  // Tell reports that lookup on its own once the tag is no longer stored with every action; it was
  // there before the patch (the patch's notes name it), so it is not new.
  const remainingLookup = (g: Finding) =>
    target?.kind === 'attributable' && g.kind === 'linkable' && g.circuit === target.circuit && g.op === 'member' && g.sources.some((s) => target.sources.some((t) => t.name === s.name));
  const newFindings = live.filter((g) => isSerious(g) && !remainingLookup(g) && !old.some((o) => same(o, g) && severityRank(o.severity) <= severityRank(g.severity) && (!target || !same(o, target))));
  return { ok: gone && newFindings.length === 0, compiles: true, compiler: r.compiler, gone, newFindings, gradeBefore, gradeAfter: r.grade ?? gradeOf(live), result: r };
}

export function describeVerification(v: Verification): string {
  if (!v.compiles) return `does not compile${v.compiler ? ` with Compact ${v.compiler}` : ''}`;
  const parts = [`compiles with Compact ${v.compiler}`, v.gone ? 'finding gone' : 'finding still reported'];
  if (v.newFindings.length) parts.push(`${v.newFindings.length} new finding${v.newFindings.length === 1 ? '' : 's'} at medium or worse`);
  parts.push(`grade ${v.gradeBefore ?? '?'} → ${v.gradeAfter ?? '?'}`);
  return parts.join(', ');
}

export type PlanOptions = { compilers?: Compiler[]; root?: string };

export async function planFixes(result: ContractResult, opts: PlanOptions = {}): Promise<FilePlan> {
  const plan: FilePlan = { file: result.file, grade: result.grade ?? null, suggestions: [] };
  if (!result.ok || !result.report) return plan;
  const compilers = opts.compilers ?? (await findCompilers());
  const src = fs.readFileSync(result.file, 'utf8');
  const relTo = opts.root ? path.relative(opts.root, result.file) : path.basename(result.file);
  const rel = (relTo.startsWith('..') ? result.file : relTo).split(path.sep).join('/');
  const targets = result.report.findings.filter(isFixTarget).sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const seen = new Set<string>();
  for (const f of targets) {
    const key = findingKey(f, rel);
    if (seen.has(key)) continue;
    seen.add(key);
    const p = propose(src, f, result.report, result.file);
    if (p.rule === null) {
      plan.suggestions.push({ key, finding: f, rule: null, summary: 'manual fix', notes: [], manual: p.manual });
      continue;
    }
    let patched: string;
    try {
      patched = applyEdits(src, p.edits);
    } catch {
      plan.suggestions.push({ key, finding: f, rule: null, summary: 'manual fix', notes: [], manual: `${where(f)}: ${f.fix}` });
      continue;
    }
    const v = await verifyPatch(result.file, patched, result, f, compilers);
    const { result: _r, ...verification } = v;
    if (v.ok)
      plan.suggestions.push({
        key,
        finding: f,
        rule: p.rule,
        summary: p.summary,
        notes: p.notes,
        patch: { source: patched, diff: unifiedDiff(src, patched, rel), range: changedRange(src, patched)!, witness: p.witness },
        verification,
      });
    else
      plan.suggestions.push({
        key,
        finding: f,
        rule: null,
        summary: 'manual fix',
        notes: [],
        manual: `A rewrite (${p.summary}) was tried and rejected: it ${verification.compiles ? (verification.gone ? 'adds new findings' : 'does not remove the finding') : 'does not compile'}. ${where(f)}: ${f.fix}`,
        verification,
      });
  }
  const ok = plan.suggestions.filter((s) => s.patch);
  if (ok.length === 1) {
    const s = ok[0];
    plan.combined = { source: s.patch!.source, diff: s.patch!.diff, applied: [s.key], verification: s.verification! };
  } else if (ok.length > 1) {
    // Apply one at a time against the latest scan, so offsets and findings stay current.
    let cur = src;
    let curRes = result;
    const applied: string[] = [];
    let last: Verification | null = null;
    for (const s of ok) {
      const f = curRes.report!.findings.find((g) => isFixTarget(g) && findingKey(g, rel) === s.key);
      if (!f) continue;
      const p = propose(cur, f, curRes.report, result.file);
      if (p.rule === null) continue;
      let next: string;
      try {
        next = applyEdits(cur, p.edits);
      } catch {
        continue;
      }
      const v = await verifyPatch(result.file, next, curRes, f, compilers);
      if (!v.ok || !v.result) continue;
      cur = next;
      curRes = v.result;
      applied.push(s.key);
      const { result: _x, ...rest } = v;
      last = rest;
    }
    if (last && applied.length) plan.combined = { source: cur, diff: unifiedDiff(src, cur, rel), applied, verification: { ...last, gradeBefore: result.grade ?? null } };
  }
  return plan;
}
