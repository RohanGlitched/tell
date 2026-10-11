// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// SARIF 2.1.0, so GitHub code scanning shows Tell's findings on the pull request.

import path from 'node:path';
import type { ContractResult } from './index.js';
import type { FindingKind, Severity } from './analyze.js';

const RULES: Record<FindingKind, { name: string; short: string; help: string }> = {
  'guessable-hash': {
    name: 'GuessableHash',
    short: 'A private value is hidden behind a hash or commitment that can be brute-forced',
    help: 'Hashing a small value (a vote, an age, an amount) does not hide it: anyone can hash every candidate and compare. Use persistentCommit(value, salt) with a 32-byte random salt from private state.',
  },
  'secret-published': {
    name: 'SecretPublished',
    short: 'A value that looks like a secret key reaches the public ledger',
    help: 'Publish a hash of the key as an identifier; never the key.',
  },
  published: {
    name: 'PublishedInClear',
    short: 'A private input is written to the public ledger as a readable value',
    help: 'Intended for public data. If it should stay private, store a salted commitment instead.',
  },
  branch: {
    name: 'SecretDependentBranch',
    short: 'Which ledger operations run depends on a private value',
    help: 'The public transcript lists every ledger operation. Touch the same fields on both branches, or replace the branch with an assert.',
  },
  predicate: {
    name: 'PublishedPredicate',
    short: 'A yes/no fact about a private value is written to the public ledger',
    help: 'Usually intended. Use assert() when the chain does not need to store the fact.',
  },
  attributable: {
    name: 'AttributableActions',
    short: 'Each action stores the same tag derived from a private key',
    help: 'Storing a deterministic tag with every action lets anyone group one holder’s actions. Use a one-time tag per action.',
  },
  linkable: {
    name: 'LinkableTag',
    short: 'The same hash of a private value is published on every call',
    help: 'Deterministic tags link a holder’s transactions. Mix in a per-action counter or fresh randomness for repeated actions.',
  },
};

const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' };
const SCORE: Record<Severity, string> = { critical: '9.5', high: '8.0', medium: '5.5', low: '3.0', info: '1.0' };

// GitHub reads an alert's severity from its rule, so there is one rule per kind and severity.
export function toSarif(results: ContractResult[], root: string) {
  const found = results.flatMap((r) => (r.report?.findings ?? []).filter((f) => !f.suppressed).map((f) => ({ r, f })));
  const ruleId = (k: FindingKind, s: Severity) => `tell/${k}/${s}`;
  const ids = [...new Set(found.map(({ f }) => ruleId(f.kind, f.severity)))].sort();
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Tell',
            informationUri: 'https://github.com/RohanGlitched/tell',
            version: '1.0.0',
            rules: ids.map((id) => {
              const [, k, sev] = id.split('/') as [string, FindingKind, Severity];
              return {
                id,
                name: `${RULES[k].name}${sev[0].toUpperCase()}${sev.slice(1)}`,
                shortDescription: { text: RULES[k].short },
                help: { text: RULES[k].help },
                defaultConfiguration: { level: LEVEL[sev] },
                properties: { tags: ['security', 'privacy', 'midnight', 'compact'], 'security-severity': SCORE[sev], precision: 'high' },
              };
            }),
          },
        },
        results: found.map(({ r, f }) => ({
          ruleId: ruleId(f.kind, f.severity),
          ruleIndex: ids.indexOf(ruleId(f.kind, f.severity)),
          level: LEVEL[f.severity],
          message: { text: `${f.circuit}: ${f.title}. ${f.detail} Fix: ${f.fix}` },
          properties: { bits: f.bits },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: path.relative(root, r.file).split(path.sep).join('/') },
                region: { startLine: f.line ?? 1 },
              },
            },
          ],
        })),
      },
    ],
  };
}
