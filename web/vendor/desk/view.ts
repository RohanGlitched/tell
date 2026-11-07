// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// What anyone can read from Tell Desk's public state: no keys, no private state.
// The website feeds this the contract state it gets from the indexer.

import { ledger, pureCircuits, Status, type Opening } from './contract.js';
import { codeHash, equalBytes, gradeToLetter, reportDigest, toHex, projectId, type GradeLetter } from './codec.js';

export type ReportView = {
  id: string;
  /** Different for every report; only its researcher can link it to themselves. */
  tag: string;
  sealedAt: number;
  updatedAt: number;
  status: 'pending' | 'acknowledged' | 'fixed' | 'retracted';
  /** Present once revealed: what the seal committed to. */
  opening?: { digest: string; project: string; nonce: string };
};

export type GradeView = { codeHash: string; grade: GradeLetter; rules: number; scan: number; selfReported: boolean; project?: string };

export type DeskView = {
  attester: string;
  /** A hand-over in progress: the proposed next officer key, until its holder accepts. */
  pendingAttester?: string;
  embargoSeconds: number;
  sealedCount: number;
  /** Distinct registered credentials: the anonymity set of a proof made against the latest root. */
  maintainerCredentials: number;
  maintainerRoot: string;
  reports: ReportView[];
  grades: GradeView[];
  selfGrades: GradeView[];
};

const STATUS: ReportView['status'][] = ['pending', 'acknowledged', 'fixed', 'retracted'];

const openingView = (o: Opening) => ({ digest: toHex(o.finding.digest), project: toHex(o.finding.project), nonce: toHex(o.nonce) });

type GradeRecord = { codeHash: Uint8Array; grade: bigint; rules: bigint; scan: bigint; selfReported: boolean; project: Uint8Array };
const gradeView = (g: GradeRecord): GradeView => ({
  codeHash: toHex(g.codeHash),
  grade: gradeToLetter(g.grade),
  rules: Number(g.rules),
  scan: Number(g.scan),
  selfReported: g.selfReported,
  ...(g.selfReported ? { project: toHex(g.project) } : {}),
});
const isZero = (b: Uint8Array) => b.every((x) => x === 0);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readDesk(state: any): DeskView {
  const l = ledger(state);
  const reports: ReportView[] = [];
  for (const [id, r] of l.reports) {
    const key = toHex(id);
    reports.push({
      id: key,
      tag: toHex(r.tag),
      sealedAt: Number(r.sealedAt),
      updatedAt: Number(r.updatedAt),
      status: STATUS[r.status as number] ?? 'pending',
      opening: l.openings.member(id) ? openingView(l.openings.lookup(id)) : undefined,
    });
  }
  reports.sort((a, b) => a.sealedAt - b.sealedAt || a.id.localeCompare(b.id));
  return {
    attester: toHex(l.attester),
    ...(isZero(l.nextAttester) ? {} : { pendingAttester: toHex(l.nextAttester) }),
    embargoSeconds: Number(l.embargo),
    sealedCount: Number(l.sealedCount),
    maintainerCredentials: Number(l.registered.size()),
    maintainerRoot: l.maintainers.root().field.toString(16),
    reports,
    grades: [...l.grades].map(([, g]) => gradeView(g)),
    selfGrades: [...l.selfGrades].map(([, g]) => gradeView(g)),
  };
}

/**
 * Every self-reported grade for a contract's code, one per project that published one. The
 * same code can belong to several projects (a shared example, a fork), so each has its own.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function selfGradesFor(state: any, codeHash: Uint8Array): GradeView[] {
  const l = ledger(state);
  return [...l.selfGrades].filter(([, g]) => equalBytes(g.codeHash, codeHash)).map(([, g]) => gradeView(g));
}

/**
 * A contract's grade as a wallet would show it: Tell's attestation first; otherwise, when the
 * caller names the project it expects the contract to belong to (a hash from `projectId`),
 * that project's self-report. A self-report from some other project is never picked for the
 * caller: use `selfGradesFor` to list them all, each with the project that made the claim.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function gradeFor(state: any, codeHash: Uint8Array, project?: Uint8Array): GradeView | undefined {
  const l = ledger(state);
  if (l.grades.member(codeHash)) return gradeView(l.grades.lookup(codeHash));
  if (!project) return undefined;
  const k = pureCircuits.selfGradeKey(codeHash, project);
  return l.selfGrades.member(k) ? gradeView(l.selfGrades.lookup(k)) : undefined;
}

/**
 * Checks a revealed report against the text published off chain: the text hashes to the
 * revealed digest, the repository to the revealed project, and the opening to the seal.
 * Together with `sealedAt`, this proves the finding existed, in this exact form, then.
 */
export async function verifyReveal(report: ReportView, text: string, repoUrl: string): Promise<{ digest: boolean; project: boolean; seal: boolean }> {
  if (!report.opening) return { digest: false, project: false, seal: false };
  const o = report.opening;
  const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
  const opening: Opening = { finding: { digest: hexToBytes(o.digest), project: hexToBytes(o.project) }, nonce: hexToBytes(o.nonce) };
  return {
    digest: equalBytes(await reportDigest(text), opening.finding.digest),
    project: equalBytes(await projectId(repoUrl), opening.finding.project),
    seal: toHex(pureCircuits.sealOf(opening)) === report.id,
  };
}

/** The code hash of a deployed contract, from the full contract state the indexer returns for its address. */
export function codeHashOfState(contractState: { operations(): (string | Uint8Array)[]; operation(n: string | Uint8Array): { verifierKey: Uint8Array } | undefined }) {
  const circuits = contractState.operations().map((n) => ({
    name: typeof n === 'string' ? n : new TextDecoder().decode(n),
    verifierKey: contractState.operation(n)!.verifierKey,
  }));
  return codeHash(circuits);
}

export { Status };
