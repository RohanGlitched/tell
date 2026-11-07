// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Server-side reads of Tell Desk's public state for /api/desk, the same way lib/live.ts reads
// the ballots: an indexer public-data provider, then desk's own public-state reader
// (desk/src/view.ts, copied to vendor/desk). No keys, no private state.

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import deployment from '@/data/desk-deployment.json';
import { indexer, NETWORK } from './live';
import { codeHashOfState, gradeFor, readDesk as readView, selfGradesFor, type DeskView, type GradeView } from '@/vendor/desk/view';
import { pureCircuits } from '@/vendor/desk/contract';
import { fromHex, projectId, toHex } from '@/vendor/desk/codec';

type Dep = {
  version?: number;
  network?: string;
  address?: string;
  deployTx?: string;
  steps?: { step: string; txId: string; at: string }[];
  reports?: Record<string, { id: string; text?: string; digest?: string; revealed: boolean; repo?: string }>; // digest only once revealed
  grades?: { contract: string; address?: string; codeHash: string; grade: string; selfReported: boolean; repo?: string }[];
  // the repositories with a registered maintainer credential (sorted, not in leaf order)
  maintainers?: { count: number; repos: string[] };
  // outreach notes sealed by Tell: how many, and their report ids (keys and texts stay private)
  outreach?: { sealed: number; ids: string[] };
  previous?: { version: number; address?: string };
};
const DEP = deployment as Dep;

export class NotDeployed extends Error {}

export type DeskReport = DeskView['reports'][number] & {
  // for a revealed report: the opening on the ledger matches the seal (checked here, from public data)
  sealMatches?: boolean;
  // the published text and repository, when the deployment record carries them (for the verify form)
  published?: { text?: string; repo?: string };
};
// `repo`: for a self-report, the repository whose project id made the claim, when it is one Desk knows.
export type DeskGrade = GradeView & { contract?: string; address?: string; repo?: string };
export type DeskResponse = Omit<DeskView, 'reports' | 'grades' | 'selfGrades'> & {
  network: string;
  address: string;
  readAt: string;
  reports: DeskReport[];
  grades: DeskGrade[];
  selfGrades: DeskGrade[];
  steps: { step: string; txId: string; at: string }[];
  // the record's own notes: which repositories hold credentials, the outreach seals, the earlier version
  maintainerRepos: string[];
  outreachIds: string[];
  previousAddress: string | null;
};

export const deskAddress = () => DEP.address ?? null;

let cache: { at: number; data: DeskResponse } | null = null;

// Project id (hex) -> repository, for the repositories the deployment record names.
let repoNames: Promise<Map<string, string>> | null = null;
const knownRepos = () =>
  (repoNames ??= Promise.all(
    [...new Set([...(DEP.maintainers?.repos ?? []), ...(DEP.grades ?? []).flatMap((g) => (g.repo ? [g.repo] : []))])].map(async (r) => [toHex(await projectId(r)), r] as const),
  ).then((xs) => new Map(xs)));

function provider() {
  setNetworkId(NETWORK);
  return indexerPublicDataProvider(...indexer());
}

async function deskState() {
  const address = DEP.address;
  if (!address) throw new NotDeployed('Tell Desk is not deployed yet');
  // The reader here is version 2's; a version 1 record (no `version`) points at a contract it cannot decode.
  if (DEP.version !== 2) throw new NotDeployed('Tell Desk version 2 is not deployed yet');
  const st = await provider().queryContractState(address);
  if (!st) throw new Error(`no contract state at ${address}`);
  return { address, st };
}

export async function readDesk(): Promise<DeskResponse> {
  if (cache && Date.now() - cache.at < 15_000) return cache.data;
  const { address, st } = await deskState();
  const view = readView(st.data);
  const published = new Map(Object.values(DEP.reports ?? {}).map((r) => [r.id, r]));
  const known = new Map((DEP.grades ?? []).map((g) => [g.codeHash, g]));
  const reports: DeskReport[] = view.reports.map((r) => {
    const pub = published.get(r.id);
    const sealMatches = r.opening
      ? toHex(pureCircuits.sealOf({ finding: { digest: fromHex(r.opening.digest), project: fromHex(r.opening.project) }, nonce: fromHex(r.opening.nonce) })) === r.id
      : undefined;
    return { ...r, sealMatches, ...(r.opening && pub ? { published: { text: pub.text, repo: pub.repo } } : {}) };
  });
  const repos = await knownRepos();
  const named = (g: GradeView): DeskGrade => {
    const k = known.get(g.codeHash);
    const repo = g.project ? repos.get(g.project) : undefined;
    return { ...g, ...(k ? { contract: k.contract, address: k.address } : {}), ...(repo ? { repo } : {}) };
  };
  const data: DeskResponse = {
    ...view,
    network: NETWORK,
    address,
    readAt: new Date().toISOString(),
    reports,
    grades: view.grades.map(named),
    selfGrades: view.selfGrades.map(named),
    steps: DEP.steps ?? [],
    maintainerRepos: DEP.maintainers?.repos ?? [],
    outreachIds: DEP.outreach?.ids ?? [],
    previousAddress: DEP.previous?.address ?? null,
  };
  cache = { at: Date.now(), data };
  return data;
}

// A contract's grade as a wallet would read it: its code hash from the indexer, then the registry.
// `grade` is Tell's attestation; `selfReports` lists every project's own claim for that code, each
// naming the project that made it (the same code can ship in several projects).
export async function gradeOfAddress(address: string): Promise<{ address: string; codeHash: string; grade: DeskGrade | null; selfReports: DeskGrade[] }> {
  const pdp = provider();
  const target = await pdp.queryContractState(address);
  if (!target) throw new UserFacing('No contract at that address on this network.');
  const hash = await codeHashOfState(target as never);
  const { st } = await deskState();
  const g = gradeFor(st.data, hash);
  const k = (DEP.grades ?? []).find((x) => x.codeHash === toHex(hash));
  const repos = await knownRepos();
  const selfReports = selfGradesFor(st.data, hash).map((s) => ({ ...s, ...(k ? { contract: k.contract } : {}), ...(s.project && repos.get(s.project) ? { repo: repos.get(s.project) } : {}) }));
  return { address, codeHash: toHex(hash), grade: g ? { ...g, ...(k ? { contract: k.contract } : {}) } : null, selfReports };
}

export class UserFacing extends Error {}
