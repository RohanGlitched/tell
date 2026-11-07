// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The demo disclosures, shared by the Preprod deploy (chain/scripts/deploy-desk.ts) and
// the offline dry run (desk/scripts/dry-run.ts). The project is Tell itself and the
// findings are the leak zoo's own leaks, which are public by design.

export const DEMO_REPO = 'https://github.com/RohanGlitched/tell';

/**
 * The maintainer credentials the demo registers: five public repositories with one owner,
 * Tell's author, so the off-chain check (does the key's holder control the repository?) is
 * that owner's own. Five leaves make the anonymity set of an acknowledgement five, not one.
 * The first is Tell itself, the project the demo's findings are about.
 */
export const DEMO_MAINTAINERS = [
  { key: 'tell', repo: DEMO_REPO },
  { key: 'petri', repo: 'https://github.com/RohanGlitched/petri' },
  { key: 'sheaf', repo: 'https://github.com/RohanGlitched/sheaf' },
  { key: 'avow', repo: 'https://github.com/RohanGlitched/avow' },
  { key: 'segundo', repo: 'https://github.com/RohanGlitched/segundo' },
] as const;

export const DEMO_FINDINGS = [
  {
    key: 'ballot',
    researcher: 'desk-researcher',
    text: 'zoo/contracts/ballot-leaky.compact, vote(): ballots.insert(tag, disclose(choiceHash(c))) after assert(c < 4). A hash of a 2-bit value: hashing the four candidates recovers every vote from public state. Fix: persistentCommit(c, salt) with a 32-byte salt from private state.',
  },
  {
    key: 'board',
    researcher: 'desk-researcher',
    text: 'zoo/contracts/board-leaky.compact, post(): authors.insert(n, tag) stores the same memberTag(memberKey()) on every post, so one identified post unmasks all of that member’s posts. Fix: prove membership in a Merkle tree and store a one-time tag, hash(memberKey, n).',
  },
  {
    key: 'vault',
    researcher: 'desk-researcher-2',
    text: 'zoo/contracts/vault-leaky.compact, claim(): owner = disclose(secretKey()). The owner key itself is on the ledger: anyone can withdraw. Fix: store persistentHash([domain, key]) and prove knowledge of the key.',
  },
] as const;

/** 90 days: how long a finding stays sealed if the maintainer never fixes it. */
export const DEMO_EMBARGO = 90n * 86_400n;

/** The rules version a grade was made with: a package version as major·10000 + minor·100 + patch. */
export const rulesVersion = (semver: string) => BigInt(semver.split('.').reduce((a, x) => a * 100 + Number(x), 0));
