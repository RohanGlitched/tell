// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The Tell MCP server: tools a coding agent calls to check what a Compact
// contract reveals, read why, and confirm a fix before the contract ships.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RULES, ruleById, ruleMarkdown } from './rules.js';
import { compareResults, scan, summarize } from './tell.js';
import type { Policy } from '@tell/engine';
import { reportText } from './format.js';

export const VERSION = '0.1.0';

const ok = (text: string, structured: Record<string, unknown>): CallToolResult => ({ content: [{ type: 'text', text }], structuredContent: structured });
const fail = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true });

const compilerArg = z
  .string()
  .regex(/^\d+\.\d+(\.\d+)?$/, 'a version such as 0.31.1')
  .optional()
  .describe('Compact compiler version, for example "0.31.1". Default: the version the pragma accepts, preferring 0.31.1 for Ledger 8 and 0.36.0 for Ledger 9 (mainnet since Nov 6, 2026).');

const RULE_IDS = RULES.map((r) => r.id) as [string, ...string[]];

const policyArg = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    'Declared intent, the same JSON a tell.json holds: {"witnesses": {"name": "secret" | "public"}, "arguments": {"circuit.arg": "secret" | "public"}, "circuits": {"name": {"once": true, "caller": "identified"}}, "caller": "anonymous" | "identified", "intended": [{"kind", "circuit", "field", "source", "reason"}]}. Default: the nearest tell.json above `path`, if any.',
  );

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'tell', title: 'Tell: privacy leak scanner for Midnight Compact', version: VERSION },
    {
      instructions:
        'Tell measures what a Midnight Compact contract reveals on the public ledger: guessable hashes of votes or amounts, secrets in the clear, branches on private values, linkable tags. Run tell_scan on every contract you write or change before deploying it. For each finding, apply the fix text (tell_explain_rule shows a worked example), then call tell_check_fix with the original and revised source until the grade is A, or until only findings you have confirmed are intended remain (mark those with `// tell:allow <rule>` on the line).',
    },
  );

  server.registerTool(
    'tell_scan',
    {
      title: 'Scan a Compact contract for privacy leaks',
      description:
        'Compile a Midnight Compact contract with the real compiler and report what each circuit reveals: grade A to F, each finding (what is revealed, bits, severity, line, fix) and the public transcript of every circuit. Pass `source` (contract text), `path` (a .compact file or a directory of contracts), or both (unsaved text that imports files next to `path`).',
      inputSchema: {
        source: z.string().min(1).optional().describe('Compact source text of one contract.'),
        path: z.string().min(1).optional().describe('A .compact file or a directory to scan. With `source`, where the contract lives, so includes resolve.'),
        compiler: compilerArg,
        includeInfo: z.boolean().optional().describe('Also list info-level findings: values published on purpose. Default false.'),
        policy: policyArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ source, path, compiler, includeInfo, policy }) => {
      if (source === undefined && path === undefined) return fail('Give `source` (Compact text) or `path` (a .compact file or directory).');
      let results;
      try {
        results = await scan({ source, path, compiler, policy: policy as Policy | undefined });
      } catch (e) {
        return fail((e as Error).message);
      }
      if (results.length === 0) return fail(`No Compact contracts found under ${path}.`);
      const contracts = results.map((r) => summarize(r, { includeInfo }));
      const text = results.map((r) => reportText(r, { includeInfo })).join('\n\n---\n\n');
      const res = ok(text, { contracts });
      if (results.every((r) => !r.ok)) res.isError = true;
      return res;
    },
  );

  server.registerTool(
    'tell_check_fix',
    {
      title: 'Check that a revision fixes Tell findings',
      description:
        'Scan the original and the revised version of a Compact contract and compare: grade before and after, which findings are resolved, which remain and which are new. Call it after each edit until the grade is A.',
      inputSchema: {
        original: z.string().min(1).describe('Compact source before the change.'),
        revised: z.string().min(1).describe('Compact source after the change.'),
        path: z.string().min(1).optional().describe('Where the contract lives, so includes resolve. Optional.'),
        compiler: compilerArg,
        policy: policyArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ original, revised, path, compiler, policy }) => {
      let before, after;
      try {
        [before] = await scan({ source: original, path, compiler, policy: policy as Policy | undefined });
        [after] = await scan({ source: revised, path, compiler, policy: policy as Policy | undefined });
      } catch (e) {
        return fail((e as Error).message);
      }
      if (!before.ok) return fail(`The original contract does not compile: ${before.error}`);
      const check = compareResults(before, after);
      const lines = [check.verdict];
      for (const f of check.resolved) lines.push(`resolved: [${f.severity}] ${f.rule} in ${f.circuit}: ${f.revealed}`);
      for (const f of check.remaining)
        lines.push(`remaining: [${f.severity}${f.severityBefore ? `, was ${f.severityBefore}` : ''}] ${f.rule} in ${f.circuit}${f.line ? `, line ${f.line}` : ''}: ${f.revealed}\n  fix: ${f.fix}`);
      for (const f of check.introduced) lines.push(`new: [${f.severity}] ${f.rule} in ${f.circuit}${f.line ? `, line ${f.line}` : ''}: ${f.revealed}\n  fix: ${f.fix}`);
      const res = ok(lines.join('\n'), check as unknown as Record<string, unknown>);
      if (!check.ok) res.isError = true;
      return res;
    },
  );

  server.registerTool(
    'tell_explain_rule',
    {
      title: 'Explain a Tell rule',
      description: `Explain one of Tell's rules with a leaking example and its fix, taken from Tell's leak zoo. Rule ids: ${RULE_IDS.join(', ')} (the \`rule\` field of a finding).`,
      inputSchema: { rule: z.string().min(1).describe(`One of: ${RULE_IDS.join(', ')}.`) },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ rule }) => {
      const r = ruleById(rule.trim().replace(/^tell\//, '').split('/')[0]);
      if (!r) return fail(`Unknown rule "${rule}". Rules: ${RULE_IDS.join(', ')}.`);
      return ok(ruleMarkdown(r), r as unknown as Record<string, unknown>);
    },
  );

  server.registerResource(
    'rules',
    'tell://rules',
    { title: "Tell's rules", description: 'Every rule Tell reports, with severities, a leak and its fix.', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(RULES, null, 2) }] }),
  );

  server.registerResource(
    'rule',
    new ResourceTemplate('tell://rules/{id}', {
      list: async () => ({ resources: RULES.map((r) => ({ uri: `tell://rules/${r.id}`, name: r.id, title: r.name, mimeType: 'text/markdown' })) }),
    }),
    { title: 'A Tell rule', description: 'One rule as Markdown.', mimeType: 'text/markdown' },
    async (uri, { id }) => {
      const r = ruleById(String(id));
      if (!r) throw new Error(`Unknown rule ${id}`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: ruleMarkdown(r) }] };
    },
  );

  server.registerPrompt(
    'privacy-review',
    {
      title: 'Privacy review of a Compact contract',
      description: 'Scan a contract with Tell and fix what it reveals until the grade is A.',
      argsSchema: { path: z.string().describe('The .compact file or directory to review.') },
    },
    ({ path }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review the privacy of the Compact contract at ${path}. Call tell_scan on it. For every finding at low or above, explain what an observer of the chain learns, then change the contract to stop it (tell_explain_rule has a worked fix for each rule). After each change, call tell_check_fix with the original and the revised source. Stop when the grade is A, or when every remaining finding is intended: mark those with \`// tell:allow <rule>\` and say why.`,
          },
        },
      ],
    }),
  );

  return server;
}
