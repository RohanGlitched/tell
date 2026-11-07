// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// A scan result as a file: JSON (the API response), SARIF 2.1.0 (GitHub code scanning,
// same rule ids as the CLI's engine/src/sarif.ts) or Markdown (for a review or an issue).
// Browser-side, so nothing is sent anywhere to make the file.

import { behaviourOf, fixOf, GRADE_TEXT, KIND_LABEL, SEVERITY_ORDER, type FindingKind, type ScanResponse, type Severity } from './types';

const SITE = 'https://tell-midnight.vercel.app';

const RULE_TEXT: Record<FindingKind, { name: string; short: string }> = {
  'guessable-hash': { name: 'GuessableHash', short: 'A private value is hidden behind a hash or commitment that can be brute-forced' },
  'secret-published': { name: 'SecretPublished', short: 'A value that looks like a secret key reaches the public ledger' },
  published: { name: 'PublishedInClear', short: 'A private input is written to the public ledger as a readable value' },
  branch: { name: 'SecretDependentBranch', short: 'Which ledger operations run depends on a private value' },
  predicate: { name: 'PublishedPredicate', short: 'A yes/no fact about a private value is written to the public ledger' },
  attributable: { name: 'AttributableActions', short: 'Each action stores the same tag derived from a private key' },
  linkable: { name: 'LinkableTag', short: 'The same hash of a private value is published on every call' },
};
const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' };
const SCORE: Record<Severity, string> = { critical: '9.5', high: '8.0', medium: '5.5', low: '3.0', info: '1.0' };

const strip = (s: string) => s.replace(/`([^`\n]+)`/g, '$1');

export function reportName(result: ScanResponse): string {
  return `tell-${result.repo ? result.repo.replace(/\//g, '-') : (result.contracts[0]?.file ?? 'contract').replace(/\.compact$/, '')}`;
}

export function toJson(result: ScanResponse): string {
  return JSON.stringify(result, null, 2);
}

export function toSarif(result: ScanResponse): string {
  const found = result.contracts.flatMap((c) => (c.report?.findings ?? []).filter((f) => !f.suppressed).map((f) => ({ c, f })));
  const ruleId = (k: FindingKind, s: Severity) => `tell/${k}/${s}`;
  const ids = [...new Set(found.map(({ f }) => ruleId(f.kind, f.severity)))].sort();
  const sarif = {
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
                name: `${RULE_TEXT[k].name}${sev[0].toUpperCase()}${sev.slice(1)}`,
                shortDescription: { text: RULE_TEXT[k].short },
                defaultConfiguration: { level: LEVEL[sev] },
                properties: { tags: ['security', 'privacy', 'midnight', 'compact'], 'security-severity': SCORE[sev], precision: 'high' },
              };
            }),
          },
        },
        ...(result.repo && result.commit ? { versionControlProvenance: [{ repositoryUri: `https://github.com/${result.repo}`, revisionId: result.commit }] } : {}),
        results: found.map(({ c, f }) => ({
          ruleId: ruleId(f.kind, f.severity),
          ruleIndex: ids.indexOf(ruleId(f.kind, f.severity)),
          level: LEVEL[f.severity],
          message: { text: strip(`${f.circuit}: ${f.title}. ${f.detail} Fix: ${fixOf(f).text}`) },
          properties: { bits: f.bits },
          locations: [{ physicalLocation: { artifactLocation: { uri: c.file }, region: { startLine: f.line ?? 1 } } }],
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

export function toMarkdown(result: ScanResponse, now = new Date()): string {
  const out: string[] = [];
  const subject = result.kind === 'repo' ? `\`${result.repo}\`${result.commit ? ` at \`${result.commit.slice(0, 7)}\`` : ''}` : 'a pasted contract';
  out.push(`# Tell privacy report`, '', `Scan of ${subject}, ${now.toISOString().slice(0, 10)}. Made with [Tell](${SITE}), a privacy leak scanner for Midnight Compact contracts.`, '');
  out.push('| Contract | Grade | Compiler | Findings |', '|---|---|---|---|');
  for (const c of result.contracts) {
    const counts = SEVERITY_ORDER.filter((s) => c.counts?.[s]).map((s) => `${c.counts![s]} ${s}`).join(', ') || 'none';
    out.push(`| \`${c.file}\` | ${c.ok ? `**${c.grade}**` : 'did not compile'} | ${c.compiler ?? '–'} | ${c.ok ? counts : '–'} |`);
  }
  for (const c of result.contracts) {
    out.push('', `## ${c.file}`, '');
    if (!c.ok) {
      out.push('This contract did not compile:', '', '```', (c.error ?? '').replace(/^Exception:\s*/gm, '').trim(), '```');
      continue;
    }
    out.push(`Grade **${c.grade}**: ${GRADE_TEXT[c.grade!]}`, '');
    const findings = c.report!.findings.filter((f) => !f.suppressed).sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
    if (findings.length === 0) out.push('No disclosures found.');
    for (const f of findings) {
      const where = f.line ? (result.repo && result.commit ? `[line ${f.line}](https://github.com/${result.repo}/blob/${result.commit}/${c.file}#L${f.line})` : `line ${f.line}`) : '';
      const { text, patch } = fixOf(f);
      out.push(`### ${f.severity.toUpperCase()} · ${KIND_LABEL[f.kind]} · \`${f.circuit}\`${f.bits > 0 ? ` · ${f.bits} bit${f.bits === 1 ? '' : 's'}` : ''}${where ? ` · ${where}` : ''}`, '');
      out.push(f.title, '', f.detail, '', `**Fix:** ${text}`);
      if (patch) out.push('', `Proposed patch${patch.verified ? `, verified by re-scan${patch.gradeAfter ? ` (grade after: ${patch.gradeAfter})` : ''}` : ''}:`, '', '```diff', patch.diff.trim(), '```');
      const behaviour = patch ? behaviourOf(patch) : null;
      if (behaviour) out.push('', `**Changes behaviour:** ${behaviour}`);
      out.push('');
    }
  }
  out.push('', '---', '', 'Findings come from static analysis of what the Compact compiler builds. They describe what the public transcript can reveal, not proof that anyone has read it.');
  return out.join('\n') + '\n';
}

export function downloadText(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
