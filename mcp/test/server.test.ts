// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The MCP server end to end: an MCP client calls each tool over the SDK's
// in-memory transport, against the leak zoo compiled by the real compiler.

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../src/mcp.js';
import { installedCompilers, type ContractSummary, type FixCheck } from '../src/tell.js';
import { RULES } from '../src/rules.js';

const ZOO = path.resolve(__dirname, '../../zoo/contracts');
const zoo = (name: string) => fs.readFileSync(path.join(ZOO, `${name}.compact`), 'utf8');
const lineOf = (src: string, needle: string) => src.split('\n').findIndex((l) => l.includes(needle)) + 1;

let client: Client;

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  client = new Client({ name: 'tell-test', version: '0.0.0' });
  await client.connect(clientSide);
});
afterAll(async () => client?.close());

const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as CallToolResult;
const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
const contracts = (r: CallToolResult) => (r.structuredContent as { contracts: ContractSummary[] }).contracts;
const serious = (c: ContractSummary) => c.findings.filter((f) => f.severity !== 'info' && f.severity !== 'low');

describe('server surface', () => {
  it('lists the three tools with input schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['tell_check_fix', 'tell_explain_rule', 'tell_scan']);
    const scan = tools.find((t) => t.name === 'tell_scan')!;
    expect(Object.keys(scan.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['source', 'path', 'compiler', 'includeInfo']));
    expect(scan.annotations?.readOnlyHint).toBe(true);
  });

  it('serves the rules as a resource, and each rule on its own', async () => {
    const all = await client.readResource({ uri: 'tell://rules' });
    const rules = JSON.parse((all.contents[0] as { text: string }).text);
    expect(rules.map((r: { id: string }) => r.id)).toEqual(RULES.map((r) => r.id));
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(expect.arrayContaining(['tell://rules', 'tell://rules/branch']));
    const one = await client.readResource({ uri: 'tell://rules/branch' });
    expect((one.contents[0] as { text: string }).text).toContain('qualified.insert(tag)');
  });

  it('offers a privacy-review prompt', async () => {
    const p = await client.getPrompt({ name: 'privacy-review', arguments: { path: 'contracts/vote.compact' } });
    expect(JSON.stringify(p.messages)).toContain('tell_check_fix');
  });
});

describe('tell_explain_rule', () => {
  for (const r of RULES)
    it(`explains ${r.id} with a leak and a fix`, async () => {
      const res = await call('tell_explain_rule', { rule: r.id });
      expect(res.isError).toBeFalsy();
      const t = text(res);
      expect(t).toContain(`(\`${r.id}\`)`);
      expect(t).toContain('## Leak');
      expect(t).toContain('## Fix');
      expect((res.structuredContent as { id: string }).id).toBe(r.id);
    });

  it('accepts a SARIF rule id', async () => {
    const res = await call('tell_explain_rule', { rule: 'tell/guessable-hash/critical' });
    expect((res.structuredContent as { id: string }).id).toBe('guessable-hash');
  });

  it('says which rules exist when the id is unknown', async () => {
    const res = await call('tell_explain_rule', { rule: 'reentrancy' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('guessable-hash');
  });
});

describe('input checks', () => {
  it('tell_scan needs source or path', async () => {
    const res = await call('tell_scan', {});
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/source.*path/);
  });

  it('tell_scan reports a missing path', async () => {
    const res = await call('tell_scan', { path: path.join(ZOO, 'no-such.compact') });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('No such file');
  });
});

const compilers = await installedCompilers();
const hasCompiler = compilers.length > 0;
if (!hasCompiler) console.warn('No Compact compiler installed: skipping the scans (install with `compact update 0.31.1`).');

// Each leaky zoo contract: the rule and severity Tell must report, and the source it names.
const CASES: [string, string, string, string][] = [
  ['ballot', 'guessable-hash', 'critical', 'choice'],
  ['payband', 'guessable-hash', 'critical', 'salary'],
  ['reserve', 'branch', 'medium', 'amount'],
  ['vault', 'secret-published', 'critical', 'secretKey'],
  ['board', 'attributable', 'medium', 'memberKey'],
];

describe.skipIf(!hasCompiler)('tell_scan against the leak zoo', () => {
  for (const [name, rule, severity, source] of CASES) {
    it(`${name}-leaky (by path): reports the ${rule}`, async () => {
      const res = await call('tell_scan', { path: path.join(ZOO, `${name}-leaky.compact`) });
      expect(res.isError).toBeFalsy();
      const [c] = contracts(res);
      expect(c.ok).toBe(true);
      const hits = c.findings.filter((f) => f.rule === rule);
      expect(hits).toHaveLength(1);
      expect(hits[0].severity).toBe(severity);
      expect(hits[0].sources.join(' ')).toContain(source);
      expect(hits[0].line).toBeGreaterThan(0);
      expect(hits[0].fix.length).toBeGreaterThan(10);
      expect(serious(c)).toHaveLength(1);
      expect(c.grade).toBe(severity === 'critical' ? 'F' : 'C');
    });
    it(`${name}-fixed (as source text): nothing above low`, async () => {
      const res = await call('tell_scan', { source: zoo(`${name}-fixed`) });
      const [c] = contracts(res);
      expect(c.ok).toBe(true);
      expect(serious(c)).toEqual([]);
      expect(['A', 'B']).toContain(c.grade);
    });
  }

  it('pins the ballot leak to its line, in bits, with the public transcript', async () => {
    const src = zoo('ballot-leaky');
    const res = await call('tell_scan', { source: src });
    const f = contracts(res)[0].findings.find((x) => x.rule === 'guessable-hash')!;
    expect(f.line).toBe(lineOf(src, 'ballots.insert(tag'));
    expect(f.bits).toBe(2);
    expect(f.circuit).toBe('vote');
    expect(f.publicTranscript.join('\n')).toMatch(/ballots\.insert\(.*guessable, 2 bits/);
    const vote = contracts(res)[0].circuits.find((c) => c.name === 'vote')!;
    expect(vote.publicTranscript.some((l) => l.startsWith('ballots.insert('))).toBe(true);
    expect(text(res)).toContain('grade F');
  });

  it('scans a directory: all ten zoo contracts', async () => {
    const res = await call('tell_scan', { path: ZOO });
    const cs = contracts(res);
    expect(cs).toHaveLength(10);
    expect(cs.every((c) => c.ok)).toBe(true);
    expect(cs.filter((c) => c.file.endsWith('-leaky.compact')).every((c) => serious(c).length === 1)).toBe(true);
  });

  it('uses the compiler version asked for', async () => {
    const want = compilers.find((c) => c.version === '0.31.1')?.version ?? compilers[0].version;
    const res = await call('tell_scan', { source: zoo('vault-leaky'), compiler: want });
    expect(contracts(res)[0].compiler).toBe(want);
  });

  it('says which compilers are installed when the one asked for is not', async () => {
    const res = await call('tell_scan', { source: zoo('vault-leaky'), compiler: '9.9.9' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('not installed');
  });

  it('scans unsaved text next to its path and leaves nothing behind', async () => {
    const before = fs.readdirSync(ZOO).sort();
    const res = await call('tell_scan', { source: zoo('vault-leaky'), path: path.join(ZOO, 'vault-draft.compact') });
    expect(contracts(res)[0].file).toBe(path.join(ZOO, 'vault-draft.compact'));
    expect(contracts(res)[0].grade).toBe('F');
    expect(fs.readdirSync(ZOO).sort()).toEqual(before);
  });

  it('returns the compiler error for a contract that does not compile', async () => {
    const res = await call('tell_scan', { source: 'pragma language_version 0.23;\nexport circuit f(): [] { nope; }\n' });
    expect(res.isError).toBe(true);
    expect(contracts(res)[0].ok).toBe(false);
  });

  it('lists info findings only when asked: a published yes/no fact', async () => {
    const src = [
      'pragma language_version 0.23;',
      'import CompactStandardLibrary;',
      'export ledger approved: Boolean;',
      'witness creditScore(): Uint<16>;',
      'export circuit apply(): [] {',
      '  approved = disclose(creditScore() >= 700);',
      '}',
    ].join('\n');
    const quiet = contracts(await call('tell_scan', { source: src }))[0];
    expect(quiet.findings).toEqual([]);
    expect(quiet.infoFindingsHidden).toBeGreaterThan(0);
    const all = contracts(await call('tell_scan', { source: src, includeInfo: true }))[0];
    expect(all.findings.map((f) => f.rule)).toContain('predicate');
  });
});

describe.skipIf(!hasCompiler)('tell_check_fix', () => {
  for (const [name, rule] of CASES)
    it(`${name}: the zoo's fix resolves the ${rule}`, async () => {
      const res = await call('tell_check_fix', { original: zoo(`${name}-leaky`), revised: zoo(`${name}-fixed`) });
      const c = res.structuredContent as FixCheck;
      expect(res.isError).toBeFalsy();
      expect(c.resolved.map((f) => f.rule)).toContain(rule);
      expect(c.remaining.filter((f) => f.severity !== 'low')).toEqual([]);
      expect(c.introduced.filter((f) => f.severity !== 'low')).toEqual([]);
      expect(['A', 'B']).toContain(c.gradeAfter);
      expect(text(res)).toMatch(/^Grade [CF] → [AB]\./);
    });

  it('an unchanged contract keeps its finding', async () => {
    const src = zoo('ballot-leaky');
    const c = (await call('tell_check_fix', { original: src, revised: src })).structuredContent as FixCheck;
    expect(c.gradeBefore).toBe('F');
    expect(c.gradeAfter).toBe('F');
    expect(c.clean).toBe(false);
    expect(c.remaining.map((f) => f.rule)).toContain('guessable-hash');
    expect(c.resolved).toEqual([]);
  });

  it('a half fix shows what is still leaking: a commitment with a constant salt', async () => {
    const leaky = zoo('ballot-leaky');
    // A commitment whose salt is a constant hides nothing: hashing the four choices still works.
    const revised = leaky.replace('disclose(choiceHash(c))', 'disclose(persistentCommit<Uint<8>>(c, pad(32, "ballot:salt")))');
    expect(revised).not.toBe(leaky);
    const c = (await call('tell_check_fix', { original: leaky, revised })).structuredContent as FixCheck;
    expect(c.gradeAfter).not.toBe('A');
    expect([...c.remaining, ...c.introduced].map((f) => f.rule)).toContain('guessable-hash');
  });

  it('a revision that does not compile is an error, not a pass', async () => {
    const res = await call('tell_check_fix', { original: zoo('vault-leaky'), revised: 'pragma language_version 0.23;\nexport circuit f(): [] { nope; }\n' });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as FixCheck).ok).toBe(false);
  });
});
