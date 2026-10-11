// Shapes shared by the scanner UI and the API (kept free of Node imports).
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingKind = 'guessable-hash' | 'secret-published' | 'published' | 'branch' | 'predicate' | 'linkable' | 'attributable';

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
  fix: string;
  line?: number;
  fields?: string[];
  suppressed?: boolean;
};

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
  grade?: 'A' | 'B' | 'C' | 'D' | 'F';
  report?: { circuits: CircuitReport[]; findings: Finding[]; unknownForms: string[] };
  counts?: Record<Severity, number>;
};

export type ScanResponse = {
  kind: 'source' | 'repo';
  repo?: string;
  commit?: string | null;
  contracts: ContractResult[];
  skipped?: number;
  compilers: string[];
  ms: number;
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
};

export const GRADE_TEXT: Record<string, string> = {
  A: 'Nothing found beyond what the contract means to publish.',
  B: 'Only low-risk notes: tags that link calls, values published on purpose.',
  C: 'Something private shows through: a branch, a count, or a tag on every action.',
  D: 'A private value can be recovered from public data.',
  F: 'A secret is effectively public: a key in the clear or a tiny-domain hash.',
};
