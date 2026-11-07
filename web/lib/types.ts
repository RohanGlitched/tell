// Shapes shared by the scanner UI and the API (kept free of Node imports).
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingKind = 'guessable-hash' | 'secret-published' | 'published' | 'branch' | 'predicate' | 'linkable' | 'attributable' | 'shielded-coin' | 'derivable-secret';

export type Finding = {
  circuit: string;
  kind: FindingKind;
  severity: Severity;
  field: string;
  op: string;
  sources: { name: string; kind: 'witness' | 'argument'; type: string; bits: number }[];
  bits: number;
  via?: string;
  title: string;
  detail: string;
  // Today a sentence. When the engine's auto-fix ships it may be a verified patch instead
  // (or alongside, as `patch`); `fixOf()` reads either shape.
  fix: string | VerifiedFix;
  patch?: VerifiedFix;
  line?: number;
  fields?: string[];
  suppressed?: boolean;
};

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

// A patch the engine proposes for a finding. `verified`: the engine re-compiled and re-scanned
// the patched contract and the finding is gone; `gradeAfter` is the grade it measured.
export type VerifiedFix = {
  diff: string; // unified diff against the scanned file
  verified: boolean;
  gradeAfter?: Grade;
  text?: string; // the rewrite in words, when the patch carries it
  rule?: string; // the engine's rewrite rule (commit-hash, hash-key, one-time-tag, assert-branch, commit-value)
  notes?: string[]; // the engine's notes on the rewrite (engine/src/fix.ts Suggestion.notes)
  behaviourChange?: boolean; // the patched contract rejects calls the original accepted
};

// One line on how a patch changes what the contract accepts, or null when it does not. The
// engine's assert-branch rewrite turns a branch on a private value into an assert, so calls that
// took the other path are now rejected. Read from the patch's notes or flag when the API sends
// them, else from the rule and the assert line in the diff (precomputed samples carry only these).
export function behaviourOf(p: VerifiedFix): string | null {
  if (!(p.behaviourChange ?? p.rule === 'assert-branch')) return null;
  const note = p.notes?.find((n) => /^This changes behaviour/.test(n));
  if (note) return note.replace(/^This changes behaviour:\s*/, '').replace(/^./, (c) => c.toUpperCase()).split(/(?<=\.)\s/)[0];
  const m = p.diff.match(/^\+\s*assert\((.+), "this call does not meet the condition"\);/m);
  if (m) {
    const negated = /^!\(.*\)$/.test(m[1]);
    const cond = negated ? m[1].slice(2, -1) : m[1];
    return `Calls where \`${cond}\` is ${negated ? 'true' : 'false'} are now rejected instead of taking the other path.`;
  }
  return 'Calls that took the other branch are now rejected instead of being accepted.';
}

// The fix in words and the patch, whichever shape the API sent.
export function fixOf(f: Finding): { text: string; patch: VerifiedFix | null } {
  const obj = typeof f.fix === 'object' && f.fix ? f.fix : null;
  const patch = f.patch ?? (obj && typeof obj.diff === 'string' && obj.diff.trim() ? obj : null);
  const text = typeof f.fix === 'string' ? f.fix : (obj?.text ?? patch?.text ?? '');
  return { text, patch: patch && typeof patch.diff === 'string' && patch.diff.trim() ? patch : null };
}

export type CircuitReport = {
  name: string;
  privateInputs: { name: string; kind: 'witness' | 'argument'; type: string; bits: number }[];
  publishedBits: number;
  findings: Finding[];
  proves: { circuit: string; message: string; sources: string[] }[];
  touches: string[];
};

export type ContractResult = {
  file: string;
  compiler: string | null;
  language: string | null;
  ok: boolean;
  error?: string;
  grade?: Grade;
  report?: { circuits: CircuitReport[]; findings: Finding[]; unknownForms: string[] };
  counts?: Record<Severity, number>;
  // every verified patch applied together and verified again as a whole (engine planFixes)
  fixes?: { diff: string; applied: number; gradeBefore: Grade | null; gradeAfter: Grade | null };
};

export type ScanResponse = {
  kind: 'source' | 'repo';
  repo?: string;
  commit?: string | null;
  contracts: ContractResult[];
  skipped?: number;
  compilers: string[];
  ms: number;
  // a sample's result, made ahead of time by the same engine and compiler
  precomputed?: boolean;
};

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const KIND_LABEL: Record<FindingKind, string> = {
  'guessable-hash': 'Guessable hash',
  'secret-published': 'Secret in the clear',
  published: 'Published value',
  branch: 'Secret-dependent branch',
  predicate: 'Published yes/no fact',
  linkable: 'Linkable tag',
  attributable: 'Same tag on every action',
  'shielded-coin': 'Coin with a public nonce',
  'derivable-secret': 'Private key derivable from public data',
};

export const GRADE_TEXT: Record<string, string> = {
  A: 'Nothing found beyond what the contract means to publish.',
  B: 'Only low-risk notes: tags that link calls, values published on purpose.',
  C: 'Something private shows through: a branch, a count, or a tag on every action.',
  D: 'A private value can be recovered from public data.',
  F: 'A secret is effectively public: a key in the clear or a tiny-domain hash.',
};
