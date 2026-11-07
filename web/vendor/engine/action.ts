// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The GitHub Action's review step. Reads the scan results the CLI wrote (--json-out), writes the
// job summary, and on pull requests posts review comments on the changed lines of .compact files,
// with the verified fix as a suggestion. A failed API call is a warning, never a failed job.
//
//   tsx action.ts --results tell.json
//
// Environment: GITHUB_TOKEN (pull-requests: write), GITHUB_EVENT_NAME, GITHUB_EVENT_PATH,
// GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_STEP_SUMMARY, GITHUB_WORKSPACE,
// TELL_COMMENT (true|false), TELL_SUGGEST (true|false), TELL_COMMENT_ON (a severity).

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Severity } from './analyze.js';
import { desiredComments, planReview, renderSummary, type ExistingComment, type PrFile, type ResultWithFixes, type ReviewAction } from './review.js';

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type ReviewEnv = {
  token?: string;
  eventName?: string;
  event?: { pull_request?: { number: number; head: { sha: string } } };
  repository?: string;
  apiUrl?: string;
  workspace: string;
  comment: boolean;
  suggest: boolean;
  minSeverity: Severity;
};

export type ReviewOutcome = { summary: string; posted: number; updated: number; skipped: number; resolved: number; outside: number; warnings: string[] };

export async function runReview(results: ResultWithFixes[], env: ReviewEnv, fetchImpl: Fetch): Promise<ReviewOutcome> {
  const outcome: ReviewOutcome = { summary: '', posted: 0, updated: 0, skipped: 0, resolved: 0, outside: 0, warnings: [] };
  const pr = env.event?.pull_request;
  const isPr = (env.eventName === 'pull_request' || env.eventName === 'pull_request_target') && !!pr;
  let outside: { path: string; finding: import('./analyze.js').Finding }[] | undefined;
  if (isPr && env.comment) {
    if (!env.token || !env.repository) outcome.warnings.push('No GITHUB_TOKEN or repository: skipping pull request comments.');
    else {
      try {
        const api = new Api(env.apiUrl ?? 'https://api.github.com', env.repository, env.token, fetchImpl);
        const files = await api.pages<PrFile>(`/pulls/${pr!.number}/files`);
        const want = desiredComments(results, files, { root: env.workspace, minSeverity: env.minSeverity, suggest: env.suggest });
        outside = want.outside;
        const existing = (await api.pages<{ id: number; path: string; line: number | null; body: string }>(`/pulls/${pr!.number}/comments`)).map(
          (c): ExistingComment => ({ id: c.id, path: c.path, line: c.line ?? null, body: c.body ?? '' }),
        );
        const scannedPaths = results.map((r) => relPath(env.workspace, r.file));
        const actions = planReview(want.comments, existing, { scannedPaths, headSha: pr!.head.sha });
        await apply(api, actions, pr!.number, pr!.head.sha, outcome);
      } catch (e) {
        outcome.warnings.push(`Pull request comments were not posted: ${(e as Error).message}`);
      }
    }
  }
  outcome.outside = outside?.length ?? 0;
  outcome.summary = renderSummary(results, { root: env.workspace, minSeverity: env.minSeverity, outside });
  return outcome;
}

async function apply(api: Api, actions: ReviewAction[], pr: number, sha: string, outcome: ReviewOutcome) {
  for (const a of actions) {
    try {
      if (a.type === 'skip') outcome.skipped++;
      else if (a.type === 'create') {
        const c = a.comment;
        await api.call('POST', `/pulls/${pr}/comments`, {
          body: c.body,
          commit_id: sha,
          path: c.path,
          line: c.line,
          side: 'RIGHT',
          ...(c.startLine !== undefined && c.startLine < c.line ? { start_line: c.startLine, start_side: 'RIGHT' } : {}),
        });
        outcome.posted++;
      } else {
        await api.call('PATCH', `/pulls/comments/${a.id}`, { body: a.body });
        if (a.reason === 'resolved') outcome.resolved++;
        else outcome.updated++;
      }
    } catch (e) {
      outcome.warnings.push(`${a.type} failed: ${(e as Error).message}`);
    }
  }
}

const relPath = (root: string, file: string) => {
  const r = file.startsWith(root) ? file.slice(root.length).replace(/^[\\/]+/, '') : file;
  return r.split('\\').join('/');
};

class Api {
  constructor(
    private base: string,
    private repo: string,
    private token: string,
    private fetchImpl: Fetch,
  ) {}
  private headers() {
    return { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'tell-action' };
  }
  async call(method: string, p: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}/repos/${this.repo}${p}`, { method, headers: this.headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      const hint = res.status === 403 ? ' (the workflow needs `permissions: pull-requests: write`; pull requests from forks get a read-only token)' : '';
      throw new Error(`${method} ${p}: HTTP ${res.status}${hint} ${text}`);
    }
    return res.status === 204 ? null : res.json();
  }
  async pages<T>(p: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 30; page++) {
      const batch = (await this.call('GET', `${p}${p.includes('?') ? '&' : '?'}per_page=100&page=${page}`)) as T[];
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }
}

// Entry point when run by the Action.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const resultsFile = args[args.indexOf('--results') + 1];
  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8')) as ResultWithFixes[];
  const e = process.env;
  const event = e.GITHUB_EVENT_PATH && fs.existsSync(e.GITHUB_EVENT_PATH) ? JSON.parse(fs.readFileSync(e.GITHUB_EVENT_PATH, 'utf8')) : undefined;
  const sev = (e.TELL_COMMENT_ON ?? 'medium') as Severity;
  const outcome = await runReview(
    results,
    {
      token: e.GITHUB_TOKEN,
      eventName: e.GITHUB_EVENT_NAME,
      event,
      repository: e.GITHUB_REPOSITORY,
      apiUrl: e.GITHUB_API_URL,
      workspace: e.GITHUB_WORKSPACE ?? process.cwd(),
      comment: e.TELL_COMMENT !== 'false',
      suggest: e.TELL_SUGGEST !== 'false',
      minSeverity: ['critical', 'high', 'medium', 'low', 'info'].includes(sev) ? sev : 'medium',
    },
    fetch as unknown as Fetch,
  );
  if (e.GITHUB_STEP_SUMMARY) fs.appendFileSync(e.GITHUB_STEP_SUMMARY, outcome.summary + '\n');
  else process.stdout.write(outcome.summary + '\n');
  for (const w of outcome.warnings) console.log(`::warning title=Tell::${w.replace(/\r?\n/g, ' ')}`);
  console.log(`Tell review: ${outcome.posted} posted, ${outcome.updated} updated, ${outcome.skipped} unchanged, ${outcome.resolved} marked resolved, ${outcome.outside} outside the diff.`);
}
