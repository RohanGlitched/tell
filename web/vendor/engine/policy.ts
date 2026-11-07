// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Declared intent: an optional `tell.json` (or `.tellrc.json`) that says what the contract
// means to keep private and what it publishes on purpose. Tell infers intent from shape and
// names by default; a policy replaces the guess where the author knows better. It complements
// `// tell:allow` comments, which silence one line; a policy states the threat model once.
//
//   {
//     "witnesses": { "deviceKey": "secret", "now": "public" },
//     "arguments": { "enroll.device": "public", "pin": "secret" },
//     "circuits": { "enroll": { "once": true }, "check": { "caller": "identified" } },
//     "caller": "anonymous",
//     "intended": [{ "kind": "published", "field": "winner", "reason": "the draw is public" }],
//     "files": { "contracts/board.compact": { "circuits": { "post": { "once": true } } } }
//   }
//
// witnesses / arguments  "secret": treat it as private data whatever its name says.
//                        "public": an observer already knows it; it adds no secrecy to a hash.
//                        Arguments are named `circuit.arg`, or `arg` for every circuit.
// circuits.<c>.once      each holder runs this circuit once (an enrolment, a registration):
//                        a tag it stores links nothing.
// circuits.<c>.caller    "identified": the transaction can be tied to its sender outside the
//                        circuit (a known operator account, an app that submits for its users).
//                        Branches and member lookups then rate as for an identified caller.
//                        "anonymous" (the default) is what Midnight gives by itself; see README.
// caller                 the same, for every circuit.
// intended               disclosures the contract makes on purpose. A finding matching every
//                        given key (kind, circuit, field, source) is kept but marked suppressed.
// files                  per-file overrides, keyed by a path relative to the policy file (or
//                        a file name); merged over the top-level settings.

import fs from 'node:fs';
import path from 'node:path';
import type { Finding, FindingKind } from './analyze.js';

export type Visibility = 'secret' | 'public';
export type CallerModel = 'anonymous' | 'identified';
export type Intended = { kind?: FindingKind; circuit?: string; field?: string; source?: string; reason?: string };
export type CircuitPolicy = { once?: boolean; caller?: CallerModel };
export type PolicyBody = {
  witnesses?: Record<string, Visibility>;
  arguments?: Record<string, Visibility>;
  circuits?: Record<string, CircuitPolicy>;
  caller?: CallerModel;
  intended?: Intended[];
};
export type Policy = PolicyBody & { version?: number; files?: Record<string, PolicyBody> };
// A policy resolved for one contract file, with where it came from.
export type ResolvedPolicy = PolicyBody & { source: string };

export const POLICY_FILES = ['tell.json', '.tellrc.json'];
const KINDS: FindingKind[] = ['guessable-hash', 'secret-published', 'published', 'branch', 'predicate', 'linkable', 'attributable', 'shielded-coin', 'derivable-secret'];

// Throws with a readable message on anything it does not understand: a typo in a policy
// must not silently turn into "no policy".
export function parsePolicy(text: string, where = 'policy'): Policy {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new Error(`${where}: not valid JSON (${(e as Error).message})`);
  }
  const fail = (m: string): never => {
    throw new Error(`${where}: ${m}`);
  };
  const obj = (v: unknown, at: string): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${at} must be an object`));
  const body = (v: unknown, at: string, top: boolean): PolicyBody => {
    const o = obj(v, at);
    const allowed = ['witnesses', 'arguments', 'circuits', 'caller', 'intended', ...(top ? ['version', 'files', '$schema'] : [])];
    for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${at}: unknown key "${k}" (expected ${allowed.join(', ')})`);
    const vis = (m: unknown, a: string) => {
      const r = obj(m, a);
      for (const [k, x] of Object.entries(r)) if (x !== 'secret' && x !== 'public') fail(`${a}.${k} must be "secret" or "public"`);
      return r as Record<string, Visibility>;
    };
    const caller = (x: unknown, a: string) => (x === undefined || x === 'anonymous' || x === 'identified' ? (x as CallerModel | undefined) : fail(`${a} must be "anonymous" or "identified"`));
    const out: PolicyBody = {};
    if (o.witnesses !== undefined) out.witnesses = vis(o.witnesses, `${at}.witnesses`);
    if (o.arguments !== undefined) out.arguments = vis(o.arguments, `${at}.arguments`);
    if (o.caller !== undefined) out.caller = caller(o.caller, `${at}.caller`);
    if (o.circuits !== undefined) {
      out.circuits = {};
      for (const [c, x] of Object.entries(obj(o.circuits, `${at}.circuits`))) {
        const cp = obj(x, `${at}.circuits.${c}`);
        for (const k of Object.keys(cp)) if (!['once', 'caller'].includes(k)) fail(`${at}.circuits.${c}: unknown key "${k}" (expected once, caller)`);
        if (cp.once !== undefined && typeof cp.once !== 'boolean') fail(`${at}.circuits.${c}.once must be true or false`);
        // only the keys given, so a per-file entry does not erase the top level's other settings
        const entry: CircuitPolicy = {};
        if (cp.once !== undefined) entry.once = cp.once as boolean;
        if (cp.caller !== undefined) entry.caller = caller(cp.caller, `${at}.circuits.${c}.caller`);
        out.circuits[c] = entry;
      }
    }
    if (o.intended !== undefined) {
      if (!Array.isArray(o.intended)) fail(`${at}.intended must be a list`);
      out.intended = (o.intended as unknown[]).map((x, i) => {
        const e = obj(x, `${at}.intended[${i}]`);
        for (const k of Object.keys(e)) if (!['kind', 'circuit', 'field', 'source', 'reason'].includes(k)) fail(`${at}.intended[${i}]: unknown key "${k}"`);
        if (e.kind !== undefined && !KINDS.includes(e.kind as FindingKind)) fail(`${at}.intended[${i}].kind must be one of ${KINDS.join(', ')}`);
        if (!['kind', 'circuit', 'field', 'source'].some((k) => typeof e[k] === 'string')) fail(`${at}.intended[${i}] needs at least one of kind, circuit, field, source`);
        return e as Intended;
      });
    }
    return out;
  };
  const top = body(j, where, true) as Policy;
  const o = j as Record<string, unknown>;
  if (o.version !== undefined && o.version !== 1) fail(`version must be 1`);
  if (o.files !== undefined) {
    top.files = {};
    for (const [k, v] of Object.entries(obj(o.files, `${where}.files`))) top.files[k] = body(v, `${where}.files["${k}"]`, false);
  }
  return top;
}

// The nearest tell.json or .tellrc.json at or above the contract's directory, stopping at a
// repository root (a directory with .git) so one project's policy never applies to another.
export function findPolicyFile(file: string): string | null {
  let d = path.dirname(path.resolve(file));
  for (;;) {
    for (const n of POLICY_FILES) {
      const p = path.join(d, n);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    if (fs.existsSync(path.join(d, '.git'))) return null;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

// The settings that apply to one contract: the top level, then a matching `files` entry over it.
export function resolvePolicy(policy: Policy, policyFile: string | null, contractFile: string): ResolvedPolicy {
  const out: ResolvedPolicy = { source: policyFile ?? 'inline', witnesses: { ...policy.witnesses }, arguments: { ...policy.arguments }, circuits: { ...policy.circuits }, caller: policy.caller, intended: [...(policy.intended ?? [])] };
  const rel = policyFile ? path.relative(path.dirname(policyFile), path.resolve(contractFile)).split(path.sep).join('/') : path.basename(contractFile);
  for (const [k, b] of Object.entries(policy.files ?? {})) {
    const key = k.replace(/^\.\//, '');
    if (key !== rel && key !== path.basename(contractFile)) continue;
    Object.assign(out.witnesses!, b.witnesses);
    Object.assign(out.arguments!, b.arguments);
    for (const [c, cp] of Object.entries(b.circuits ?? {})) out.circuits![c] = { ...own(out.circuits, c), ...cp };
    if (b.caller) out.caller = b.caller;
    out.intended!.push(...(b.intended ?? []));
  }
  return out;
}

// Load the policy for a contract: an explicit file, an inline object, or the nearest file found.
export function policyFor(contractFile: string, opt: { policyFile?: string | null; policy?: Policy } = {}): ResolvedPolicy | undefined {
  if (opt.policy) return resolvePolicy(opt.policy, null, contractFile);
  if (opt.policyFile === null) return undefined; // --no-policy
  const p = opt.policyFile ?? findPolicyFile(contractFile);
  if (!p) return undefined;
  const text = fs.readFileSync(p, 'utf8');
  // A found tell.json that is a list is saved scan results (tell --json-out tell.json), not a policy.
  if (!opt.policyFile && /^\s*\[/.test(text)) return undefined;
  return resolvePolicy(parsePolicy(text, p), p, contractFile);
}

// Lookups the analysis uses. Own keys only: a circuit is called `constructor`, and
// `circuits["constructor"]` must not find Object's constructor.
export const own = <T,>(o: Record<string, T> | undefined, k: string): T | undefined => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
export function witnessVisibility(pol: PolicyBody | undefined, witness: string): Visibility | undefined {
  return own(pol?.witnesses, witness);
}
export function argumentVisibility(pol: PolicyBody | undefined, circuit: string, arg: string): Visibility | undefined {
  return own(pol?.arguments, `${circuit}.${arg}`) ?? own(pol?.arguments, arg);
}
export function circuitPolicy(pol: PolicyBody | undefined, circuit: string): CircuitPolicy {
  return own(pol?.circuits, circuit) ?? {};
}
export function callerOf(pol: PolicyBody | undefined, circuit: string): CallerModel {
  return circuitPolicy(pol, circuit).caller ?? pol?.caller ?? 'anonymous';
}

// Mark findings the policy declares intended: kept in the report, suppressed, with the reason.
export function applyIntended(findings: Finding[], pol: PolicyBody | undefined) {
  for (const e of pol?.intended ?? []) {
    for (const f of findings) {
      if (e.kind && f.kind !== e.kind) continue;
      if (e.circuit && f.circuit !== e.circuit) continue;
      if (e.field && f.field !== e.field && !(f.fields ?? []).some((x) => x.split('.')[0] === e.field)) continue;
      if (e.source && !f.sources.some((s) => s.name === e.source || s.name.replace(/[.[].*$/, '') === e.source)) continue;
      f.suppressed = true;
      f.suppressedBy = `policy${e.reason ? `: ${e.reason}` : ''}`;
    }
  }
}
