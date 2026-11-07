// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Pull request review: diff hunks to commentable lines, suggestion rendering, re-run dedupe,
// the job summary, and the whole review step against a fake GitHub API (no network).
//
// fixtures/review/results.json is real `tell --fix-dry-run --json-out` output for four zoo
// contracts, with the checkout path replaced by /work.

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { commentableLines, placeComment, renderComment, desiredComments, planReview, renderSummary, parseMarker, markerOf, type ResultWithFixes, type ExistingComment, type PrFile } from '../src/review.js';
import { runReview, type ReviewEnv } from '../src/action.js';

const results = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'review', 'results.json'), 'utf8')) as ResultWithFixes[];
const zoo = path.join(__dirname, '..', '..', 'zoo', 'contracts');
const byName = (n: string) => results.find((r) => r.file.endsWith(`/${n}.compact`))!;
const ROOT = '/work';

// A pull request that adds the whole file: every line is commentable, in one hunk.
const added = (name: string): PrFile => {
  const lines = fs.readFileSync(path.join(zoo, `${name}.compact`), 'utf8').replace(/\n$/, '').split('\n');
  return { filename: `zoo/contracts/${name}.compact`, status: 'added', patch: `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n') };
};
// A pull request that only edits around line 36 of the ballot.
const ballotEdit: PrFile = {
  filename: 'zoo/contracts/ballot-leaky.compact',
  status: 'modified',
  patch: ['@@ -33,5 +33,5 @@ export circuit vote(): [] {', '   assert(!ballots.member(tag), "already voted");', '   const c = choice();', '-  assert(c < 5, "there are four candidates");', '+  assert(c < 4, "there are four candidates");', '   ballots.insert(tag, disclose(choiceHash(c)));', ' }'].join('\n'),
};

describe('diff hunks', () => {
  it('maps right-side lines to hunks, skipping deleted lines', () => {
    const patch = ['@@ -1,3 +1,4 @@', ' a', '-b', '+B', '+B2', ' c', '@@ -20,2 +21,3 @@ circuit f', ' x', '+y', ' z', '\\ No newline at end of file'].join('\n');
    const m = commentableLines(patch);
    expect([...m.entries()]).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [21, 1],
      [22, 1],
      [23, 1],
    ]);
    expect(commentableLines(undefined).size).toBe(0);
  });
});

describe('placing a comment', () => {
  const sug = (n: string) => byName(n).fixes!.suggestions[0];
  it('a fix inside the diff becomes a multi-line suggestion over exactly the lines it replaces', () => {
    const s = sug('ballot-leaky');
    expect(placeComment(s.finding, s, commentableLines(added('ballot-leaky').patch))).toEqual({ line: 36, startLine: 30, suggestion: true });
    const v = sug('vault-leaky');
    expect(placeComment(v.finding, v, commentableLines(added('vault-leaky').patch))).toEqual({ line: 23, startLine: 19, suggestion: true });
  });
  it('a one-line fix is a one-line suggestion', () => {
    const s = sug('board-leaky');
    expect(placeComment(s.finding, s, commentableLines(added('board-leaky').patch))).toEqual({ line: 33, suggestion: true });
  });
  it('a fix reaching outside the diff is shown as a diff on the finding line instead', () => {
    const s = sug('ballot-leaky');
    expect(placeComment(s.finding, s, commentableLines(ballotEdit.patch))).toEqual({ line: 36, suggestion: false });
  });
  it('a patch on lines next to the finding, inside its hunk, is still a one-click suggestion', () => {
    const s = sug('ballot-leaky');
    const f = { ...s.finding, line: 36 };
    const moved = { ...s, patch: { ...s.patch!, range: { start: 37, end: 37, lines: ['  x'] } } };
    const hunk = commentableLines('@@ -34,5 +34,5 @@\n a\n b\n-c\n+c2\n d\n e');
    expect(placeComment(f, moved, hunk)).toEqual({ line: 37, suggestion: true });
    // but not across hunks
    const two = commentableLines('@@ -35,2 +35,2 @@\n a\n+b\n@@ -60,2 +60,2 @@\n x\n+y');
    expect(placeComment(f, { ...s, patch: { ...s.patch!, range: { start: 60, end: 60, lines: ['y'] } } }, two)).toEqual({ line: 36, suggestion: false });
  });
  it('a finding on an unchanged line gets no inline comment', () => {
    const s = sug('vault-leaky');
    expect(placeComment(s.finding, s, commentableLines('@@ -1,2 +1,2 @@\n a\n+b'))).toBeNull();
  });
});

describe('comment bodies', () => {
  it('says what is revealed in bits, the severity, and the verified fix as a suggestion', () => {
    const s = byName('ballot-leaky').fixes!.suggestions[0];
    const body = renderComment(s.finding, s.key, s, { line: 36, startLine: 30, suggestion: true });
    expect(parseMarker(body)).toEqual({ key: s.key, resolved: false });
    expect(body).toContain('**Tell · critical · guessable hash** in `vote` (`ballots` insert)');
    expect(body).toContain('**Revealed:** 2 bits of `choice` (Uint<8>); at most 4 guesses recover it.');
    expect(body).toContain('Compiles with Compact 0.31.1, finding gone, grade F → B.');
    const block = body.slice(body.indexOf('```suggestion\n') + 14, body.indexOf('\n```', body.indexOf('```suggestion')));
    expect(block.split('\n')).toEqual(s.patch!.range.lines);
    expect(block).toContain('witness ballotsNonce(): Bytes<32>;');
    expect(block).toContain('persistentCommit<Bytes<32>>(choiceHash(c), ballotsNonce())');
    expect(body).toContain('Off-chain: implement the `ballotsNonce` witness');
  });
  it('falls back to a diff in a details block when the patch is wider than the comment', () => {
    const s = byName('ballot-leaky').fixes!.suggestions[0];
    const body = renderComment(s.finding, s.key, s, { line: 36, suggestion: false });
    expect(body).not.toContain('```suggestion');
    expect(body).toContain('<details><summary>Patch');
    expect(body).toContain('```diff\n--- a/zoo/contracts/ballot-leaky.compact');
  });
  it('without suggest-fixes, the comment names the fix in words', () => {
    const s = byName('vault-leaky').fixes!.suggestions[0];
    const body = renderComment(s.finding, s.key, s, { line: 19, suggestion: false }, { suggest: false });
    expect(body).not.toContain('```');
    expect(body).toContain('**Fix:** Publish persistentHash([domain, key])');
    expect(body).toContain('**Revealed:** all 256 bits of `secretKey` (Bytes<32>).');
  });
});

describe('what a pull request gets', () => {
  it('one comment per medium-or-worse finding on a changed line; fixed contracts get none', () => {
    const files = ['ballot-leaky', 'vault-leaky', 'board-leaky', 'ballot-fixed'].map(added);
    const { comments, outside } = desiredComments(results, files, { root: ROOT });
    expect(comments.map((c) => [c.path, c.startLine, c.line])).toEqual([
      ['zoo/contracts/ballot-leaky.compact', 30, 36],
      ['zoo/contracts/vault-leaky.compact', 19, 23],
      ['zoo/contracts/board-leaky.compact', undefined, 33],
    ]);
    expect(outside).toEqual([]);
  });
  it('findings in files the pull request does not touch are listed as outside the diff', () => {
    const { comments, outside } = desiredComments(results, [ballotEdit], { root: ROOT });
    expect(comments).toHaveLength(1);
    expect(outside.map((o) => o.path).sort()).toEqual(['zoo/contracts/board-leaky.compact', 'zoo/contracts/vault-leaky.compact']);
  });
  it('a lower threshold comments on low findings too', () => {
    const { comments } = desiredComments(results, [added('ballot-fixed')], { root: ROOT, minSeverity: 'low' });
    expect(comments.length).toBeGreaterThan(0);
    expect(comments.every((c) => c.finding.severity === 'low')).toBe(true);
  });
});

describe('re-runs', () => {
  const files = ['ballot-leaky', 'vault-leaky'].map(added);
  const { comments } = desiredComments(results, files, { root: ROOT });
  const scannedPaths = results.map((r) => path.relative(ROOT, r.file));
  const opts = { scannedPaths, headSha: 'abcdef1234567890' };
  const existingFor = (i: number, patch: Partial<ExistingComment> = {}): ExistingComment => ({ id: 100 + i, path: comments[i].path, line: comments[i].line, body: comments[i].body, ...patch });

  it('first run: create every comment', () => {
    expect(planReview(comments, [], opts).map((a) => a.type)).toEqual(['create', 'create']);
  });
  it('same findings again: nothing is posted twice', () => {
    expect(planReview(comments, [existingFor(0), existingFor(1)], opts)).toEqual([
      { type: 'skip', id: 100, key: comments[0].key },
      { type: 'skip', id: 101, key: comments[1].key },
    ]);
  });
  it('a changed body is updated in place; comments by people are ignored', () => {
    const people: ExistingComment = { id: 5, path: comments[0].path, line: 36, body: 'Looks fine to me' };
    const acts = planReview(comments, [people, existingFor(0, { body: comments[0].body.replace('grade F → B', 'grade F → C') }), existingFor(1)], opts);
    expect(acts[0]).toMatchObject({ type: 'update', id: 100, reason: 'changed', body: comments[0].body });
    expect(acts[1]).toMatchObject({ type: 'skip', id: 101 });
    expect(acts).toHaveLength(2);
  });
  it('an outdated comment is superseded by a new one on the current line', () => {
    const acts = planReview(comments.slice(0, 1), [existingFor(0, { line: null })], opts);
    expect(acts.map((a) => a.type)).toEqual(['create', 'update']);
    expect(acts[1]).toMatchObject({ id: 100, reason: 'superseded' });
    expect(parseMarker((acts[1] as { body: string }).body)).toEqual({ key: comments[0].key, resolved: true });
  });
  it('a finding that is gone marks its comment resolved, once, and only for files this run scanned', () => {
    const gone = planReview(comments.slice(0, 1), [existingFor(0), existingFor(1)], opts);
    expect(gone[1]).toMatchObject({ type: 'update', id: 101, reason: 'resolved' });
    expect((gone[1] as { body: string }).body).toContain('no longer reported as of `abcdef1`');
    const resolvedBody = (gone[1] as { body: string }).body;
    expect(planReview(comments.slice(0, 1), [existingFor(0), existingFor(1, { body: resolvedBody })], opts)).toHaveLength(1);
    expect(planReview([], [existingFor(1)], { ...opts, scannedPaths: [] })).toEqual([]);
  });
  it('markers round-trip', () => {
    expect(parseMarker(markerOf('0123456789ab'))).toEqual({ key: '0123456789ab', resolved: false });
    expect(parseMarker(markerOf('0123456789ab', 'resolved'))).toEqual({ key: '0123456789ab', resolved: true });
    expect(parseMarker('no marker')).toBeNull();
  });
});

describe('job summary', () => {
  const md = renderSummary(results, { root: ROOT });
  it('a grade per contract, with the grade after verified fixes', () => {
    expect(md).toContain('| Contract | Grade | After verified fixes | Findings | Compiler |');
    expect(md).toContain('| `zoo/contracts/ballot-leaky.compact` | **F** | **B** (1 fix) | 1 critical, 2 low | 0.31.1 |');
    expect(md).toContain('| `zoo/contracts/vault-leaky.compact` | **F** | **A** (1 fix) |');
    expect(md).toContain('| `zoo/contracts/ballot-fixed.compact` | **B** | nothing to fix |');
  });
  it('a findings table and the combined patch', () => {
    expect(md).toContain('| critical | `zoo/contracts/ballot-leaky.compact:36` `vote` |');
    expect(md).toContain('| 2 bits of `choice` (Uint<8>); at most 4 guesses recover it | verified: store a commitment');
    expect(md).toContain('```diff\n--- a/zoo/contracts/ballot-leaky.compact');
  });
  it('no fixes requested: no after column', () => {
    const plain = results.map(({ fixes: _f, ...r }) => r);
    expect(renderSummary(plain, { root: ROOT })).toContain('| Contract | Grade | Findings | Compiler |');
  });
});

describe('the review step, against a fake GitHub API', () => {
  type Call = { method: string; url: string; body?: Record<string, unknown> };
  const fakeGitHub = (files: PrFile[], existing: ExistingComment[] = [], status = 200) => {
    const calls: Call[] = [];
    const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
      const reply = (data: unknown, s = status) => ({ ok: s < 300, status: s, json: async () => data, text: async () => JSON.stringify(data) });
      if (status >= 300) return reply({ message: 'Resource not accessible by integration' });
      if (method === 'GET' && url.includes('/files')) return reply(url.includes('page=1') ? files : []);
      if (method === 'GET' && url.includes('/comments')) return reply(url.includes('page=1') ? existing : []);
      return reply({ id: 1 }, 201);
    };
    return { calls, fetchImpl };
  };
  const env: ReviewEnv = {
    token: 't',
    eventName: 'pull_request',
    event: { pull_request: { number: 7, head: { sha: 'feedface00000000' } } },
    repository: 'acme/app',
    apiUrl: 'https://api.github.test',
    workspace: ROOT,
    comment: true,
    suggest: true,
    minSeverity: 'medium',
  };

  it('posts inline comments with suggestions on the head commit', async () => {
    const gh = fakeGitHub(['ballot-leaky', 'vault-leaky', 'board-leaky'].map(added));
    const out = await runReview(results, env, gh.fetchImpl);
    const posts = gh.calls.filter((c) => c.method === 'POST');
    expect(posts.map((p) => p.url)).toEqual(Array(3).fill('https://api.github.test/repos/acme/app/pulls/7/comments'));
    expect(posts[0].body).toMatchObject({ commit_id: 'feedface00000000', path: 'zoo/contracts/ballot-leaky.compact', start_line: 30, start_side: 'RIGHT', line: 36, side: 'RIGHT' });
    expect(posts[2].body).not.toHaveProperty('start_line');
    expect(out).toMatchObject({ posted: 3, skipped: 0, warnings: [] });
    expect(out.summary).toContain('## Tell privacy scan');
  });

  it('a second run with the same results posts nothing', async () => {
    const first = fakeGitHub(['ballot-leaky', 'vault-leaky', 'board-leaky'].map(added));
    await runReview(results, env, first.fetchImpl);
    const existing = first.calls.filter((c) => c.method === 'POST').map((c, i) => ({ id: i + 1, path: c.body!.path as string, line: c.body!.line as number, body: c.body!.body as string }));
    const second = fakeGitHub(['ballot-leaky', 'vault-leaky', 'board-leaky'].map(added), existing);
    const out = await runReview(results, env, second.fetchImpl);
    expect(second.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(out).toMatchObject({ posted: 0, updated: 0, skipped: 3 });
  });

  it('on a push, only the summary is written', async () => {
    const gh = fakeGitHub([]);
    const out = await runReview(results, { ...env, eventName: 'push', event: undefined }, gh.fetchImpl);
    expect(gh.calls).toEqual([]);
    expect(out.summary).toContain('**F**');
  });

  it('a read-only token is a warning, not a failure', async () => {
    const gh = fakeGitHub([], [], 403);
    const out = await runReview(results, env, gh.fetchImpl);
    expect(out.posted).toBe(0);
    expect(out.warnings[0]).toContain('pull-requests: write');
    expect(out.summary).toContain('## Tell privacy scan');
  });
});
