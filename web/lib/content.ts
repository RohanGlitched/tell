// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Typed views of the content files in web/data/ that the Wave 3 pages render.
// The JSON files are edited by hand (wave3, business, desk, survey-rerun, outreach) or
// written by a script (adoption: scripts/adoption.mjs). The shapes are documented here.

import wave3Json from '@/data/wave3.json';
import businessJson from '@/data/business.json';
import adoptionJson from '@/data/adoption.json';
import rerunJson from '@/data/survey-rerun.json';
import deskJson from '@/data/desk.json';
import zooJson from '@/data/zoo.json';

// Work status. "done": shipped and linked; "in progress": being built now; "planned": not
// started; "pilot": offered to a first user; "live": an offer anyone can use today.
export type Status = 'done' | 'in progress' | 'planned' | 'pilot' | 'live';
export const STATUS_LABEL: Record<Status, string> = { done: 'done', 'in progress': 'in progress', planned: 'planned', pilot: 'pilot', live: 'live' };

export type Link = { label: string; href: string | null };

// ---- wave3.json ----------------------------------------------------------------------------
export type CriterionId = 'engineering' | 'qa' | 'product' | 'ux' | 'communication' | 'business';

export type FeedbackRow = {
  id: string;
  criterion: CriterionId;
  source: string; // where the words come from: "Backend engineering review (29/30)"
  quote: string; // verbatim, from the judge
  did: string; // what we did, plain words
  status: Status;
  evidence: Link[];
};

export type Criterion = {
  id: CriterionId;
  name: string;
  weight: number; // percent of the Wave 3 score
  wave2: number; // out of 10
  judged: string; // what the rubric looks at
  changes: { text: string; status: Status; href: string | null }[];
};

export type Substitute = { name: string; what: string; answer: string; status: Status; href: string | null };

export type Wave3 = {
  updatedAt: string;
  wave2: { reviewedOn: string; reviewer: string; points: number; prize: string; scores: Record<CriterionId, number> };
  highlights: { title: string; text: string; href: string; status: Status }[]; // the home-page band
  summary: string;
  feedback: FeedbackRow[];
  criteria: Criterion[];
  substitutes: Substitute[];
  learned: { title: string; text: string }[];
  ask: { title: string; text: string }[];
};

export const wave3 = wave3Json as Wave3;

// ---- business.json -------------------------------------------------------------------------
export type Segment = { id: string; name: string; who: string; need: string; gets: string; pays: string; status: Status };
export type Offer = {
  id: string;
  name: string;
  for: string[]; // segment ids
  what: string;
  includes: string[];
  status: Status;
  price: string | null; // null: not priced yet (the lead fills it)
  priceNote: string | null;
};
export type Business = {
  updatedAt: string;
  segments: Segment[];
  offers: Offer[];
  numbers: { label: string; value: string | null; source: string | null }[];
  principles: { title: string; text: string }[];
  // a bottom-up sum: sourced counts times hypothesis prices (BUSINESS-RESEARCH.md)
  market: {
    asOf: string;
    intro: string;
    lines: { label: string; count: number; unit: string; price: string; low: number; high: number; basis: string; status: string }[];
    seats: string;
    path: string;
  };
  contact: { repo: string; label: string };
};
export const business = businessJson as Business;

// ---- adoption.json (written by scripts/adoption.mjs; anonymised, no team URLs) ----------------
export type OutreachKind = 'issue' | 'pr' | 'note';
export type OutreachRow = {
  id: string;
  label: string; // "Project A (supply chain)" or, for midnightntwrk repos only, the repo name
  sector: string | null;
  kind: OutreachKind;
  official: boolean; // a midnightntwrk repository: may be named and linked
  url: string | null; // only set when official
  openedAt: string | null;
  state: 'pending' | 'sent' | 'open' | 'closed' | 'merged' | 'unknown';
  replies: number | null;
  fixed: boolean; // the lead recorded a fix commit
  fixUrl: string | null; // only set when official
  topic: string | null;
};
export type Adoption = {
  fetchedAt: string | null;
  authenticated: boolean;
  repo: { name: string; stars: number | null; forks: number | null; watchers: number | null; openIssues: number | null };
  traffic: { views14d: number | null; uniqueVisitors14d: number | null; clones14d: number | null; uniqueCloners14d: number | null } | null;
  action: { counted: boolean; reason: string | null; repositories: number | null; ownRepositories: number | null; officialRepositories: number | null; otherRepositories: number | null };
  outreach: OutreachRow[];
  totals: { contacted: number; replied: number; fixed: number; open: number };
  errors: string[];
};
export const adoption = adoptionJson as Adoption;

// ---- survey-rerun.json -----------------------------------------------------------------------
export type SurveySnapshot = {
  date: string;
  projectsAnalyzed: number;
  contractsAnalyzed: number;
  grades: Record<'A' | 'B' | 'C' | 'D' | 'F', number>;
  mediumOrWorse: number; // projects with a finding at medium or worse
};
export type SurveyRerun = { status: Status; note: string; before: SurveySnapshot; after: SurveySnapshot | null };
export const surveyRerun = rerunJson as SurveyRerun;

// ---- desk.json -------------------------------------------------------------------------------
export type LedgerField = { name: string; type: string; holds: string; who: string };
export type Desk = {
  status: Status;
  network: string;
  address: string | null; // null until deployed (the lead fills it)
  deployTx: string | null;
  contractPath: string;
  fieldsConfirmed: boolean; // false: the fields below are the design, not yet checked against desk/
  publicLedger: LedgerField[];
  privateState: LedgerField[];
  circuits: { name: string; does: string; discloses: string }[];
  flow: { step: string; text: string }[];
};
export const desk = deskJson as Desk;

// ---- zoo.json ---------------------------------------------------------------------------------
// Counts for copy, taken from the zoo itself (scripts/samples.mjs copies every pair), so a new
// pair updates every page that mentions the zoo.
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const numberWord = (n: number, capital = false) => {
  const w = WORDS[n] ?? String(n);
  return capital ? w[0].toUpperCase() + w.slice(1) : w;
};
const isLedger9 = (z: { leaky: string }) => /Ledger 9/.test(z.leaky.split('\n')[0] ?? '');
export const zooCounts = {
  pairs: zooJson.length,
  contracts: zooJson.length * 2,
  ledger9: zooJson.filter(isLedger9).length,
  ledger8: zooJson.filter((z) => !isLedger9(z)).length,
};

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'not yet';
