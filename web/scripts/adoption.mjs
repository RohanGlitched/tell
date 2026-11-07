// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Reads Tell's adoption numbers from GitHub's public API and writes web/data/adoption.json,
// which the /adoption page renders with the fetch date.
//
//   node web/scripts/adoption.mjs                 # unauthenticated: repo stats and outreach issues
//   GITHUB_TOKEN=… node web/scripts/adoption.mjs  # also: repositories using the Action (code search
//                                                 # needs a token) and traffic, if the token can read it
//
// Outreach comes from web/data/outreach.json, merged with web/data/outreach.local.json when it
// exists (git-ignored; for team URLs that should not be in the public repository). The output is
// anonymised: team repositories are counted and labelled ("Project A (supply chain)"), never named
// or linked. Only repositories owned by midnightntwrk keep their URL.
// The token is only ever sent to api.github.com and is never printed.

import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DATA = path.resolve(here, '..', 'data');
const REPO = 'RohanGlitched/tell';
const OWN = 'rohanglitched';
const OFFICIAL = 'midnightntwrk';
const TOKEN = process.env.GITHUB_TOKEN?.trim() || null;
const errors = [];

async function gh(p, accept = 'application/vnd.github+json') {
  try {
    const res = await fetch(`https://api.github.com${p}`, {
      headers: {
        accept,
        'user-agent': 'tell-adoption-script',
        'x-github-api-version': '2022-11-28',
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, status: res.status, json: null };
    return { ok: true, status: res.status, json: await res.json() };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: e.name };
  }
}

// GitHub path for an error message: the API path only, no query string or headers.
const where = (p) => p.split('?')[0];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
  } catch {
    return fallback;
  }
}

function parseIssueUrl(url) {
  const m = typeof url === 'string' && url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/);
  return m ? { owner: m[1], name: m[2], number: Number(m[4]), pr: m[3] === 'pull' } : null;
}

// ---- the repository itself ------------------------------------------------------------------
const repoRes = await gh(`/repos/${REPO}`);
if (!repoRes.ok) errors.push(`repository stats: GitHub answered ${repoRes.status || 'nothing'}`);
const r = repoRes.json ?? {};
const repo = {
  name: REPO,
  stars: r.stargazers_count ?? null,
  forks: r.forks_count ?? null,
  watchers: r.subscribers_count ?? null,
  openIssues: r.open_issues_count ?? null,
};

// ---- traffic: only with a token that has push access; otherwise left out -----------------------
// GitHub keeps 14 days of traffic. Each run merges the days it sees into the history already in
// adoption.json (a day seen again takes the newer count), so totals since the first run survive.
// Unique visitors cannot be added up across days, so the history keeps them per day only.
// Referrers are sites (github.com, google.com), never people.
let traffic = null;
if (TOKEN) {
  const [v, c, refs] = await Promise.all([gh(`/repos/${REPO}/traffic/views`), gh(`/repos/${REPO}/traffic/clones`), gh(`/repos/${REPO}/traffic/popular/referrers`)]);
  if (v.ok && c.ok) {
    const byDay = new Map((readJson('adoption.json', {}).traffic?.daily ?? []).map((d) => [d.date, d]));
    const merge = (list, count, uniques) => {
      for (const x of list ?? []) {
        const date = String(x.timestamp).slice(0, 10);
        byDay.set(date, { date, views: 0, uniqueVisitors: 0, clones: 0, uniqueCloners: 0, ...byDay.get(date), [count]: x.count, [uniques]: x.uniques });
      }
    };
    merge(v.json.views, 'views', 'uniqueVisitors');
    merge(c.json.clones, 'clones', 'uniqueCloners');
    const daily = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    traffic = {
      views14d: v.json.count,
      uniqueVisitors14d: v.json.uniques,
      clones14d: c.json.count,
      uniqueCloners14d: c.json.uniques,
      since: daily[0]?.date ?? null,
      viewsSince: daily.reduce((n, d) => n + (d.views ?? 0), 0),
      clonesSince: daily.reduce((n, d) => n + (d.clones ?? 0), 0),
      referrers: refs.ok ? refs.json.map((x) => ({ site: x.referrer, views: x.count, unique: x.uniques })) : null,
      daily,
    };
  } else {
    errors.push(`traffic: GitHub answered ${v.status || c.status || 'nothing'} (traffic needs a token with push access to ${REPO})`);
  }
}

// ---- repositories using the Action: code search, which needs authentication --------------------
let action = { counted: false, reason: 'GitHub code search needs a token; run with GITHUB_TOKEN to count repositories using the Action.', repositories: null, ownRepositories: null, officialRepositories: null, otherRepositories: null };
if (TOKEN) {
  const repos = new Set();
  let failed = false;
  for (let page = 1; page <= 5; page++) {
    const q = encodeURIComponent(`"${REPO}@" language:YAML`);
    const s = await gh(`/search/code?q=${q}&per_page=100&page=${page}`);
    if (!s.ok) {
      failed = true;
      errors.push(`code search: GitHub answered ${s.status || 'nothing'}`);
      break;
    }
    for (const item of s.json.items ?? []) repos.add(item.repository.full_name);
    if ((s.json.items ?? []).length < 100) break;
  }
  if (!failed || repos.size > 0) {
    const all = [...repos];
    const own = all.filter((n) => n.split('/')[0].toLowerCase() === OWN).length;
    const official = all.filter((n) => n.split('/')[0].toLowerCase() === OFFICIAL).length;
    action = {
      counted: true,
      reason: 'GitHub code search over workflow files that reference the Action. It covers default branches only, and GitHub does not promise a complete index.',
      repositories: all.length,
      ownRepositories: own,
      officialRepositories: official,
      otherRepositories: all.length - own - official,
    };
  }
}

// ---- outreach --------------------------------------------------------------------------------
const outreachFile = readJson('outreach.json', { entries: [] });
const local = readJson('outreach.local.json', {});
const outreach = [];
for (const base of outreachFile.entries ?? []) {
  const e = { ...base, ...(local[base.id] ?? {}) };
  const ref = parseIssueUrl(e.url);
  // official: the URL's owner is midnightntwrk (or, before a URL is recorded, an "mn-" entry)
  const official = ref ? ref.owner.toLowerCase() === OFFICIAL : String(e.id).startsWith('mn-');
  const label = official ? e.label : `${e.label}${e.sector ? ` (${e.sector})` : ''}`;
  const row = {
    id: e.id,
    label,
    sector: e.sector ?? null,
    kind: e.kind ?? (ref ? (ref.pr ? 'pr' : 'issue') : 'note'),
    official,
    url: official && ref ? e.url : null,
    openedAt: e.sentAt ?? null,
    state: e.state ?? (e.sentAt ? 'sent' : 'pending'),
    replies: typeof e.replies === 'number' ? e.replies : null,
    fixed: Boolean(e.fixCommit),
    fixUrl: official && e.fixCommit ? e.fixCommit : null,
    topic: e.topic ?? null,
  };
  if (ref) {
    const base = `/repos/${ref.owner}/${ref.name}/issues/${ref.number}`;
    const issue = await gh(base);
    if (issue.ok) {
      row.openedAt = issue.json.created_at;
      row.state = issue.json.state;
      // replies: comments from anyone other than the person who opened it
      const comments = await gh(`${base}/comments?per_page=100`);
      if (comments.ok) row.replies = comments.json.filter((c) => c.user?.login !== issue.json.user?.login && c.user?.type !== 'Bot' && !/bot|claassistant/i.test(c.user?.login ?? '')).length;
      else row.replies = issue.json.comments;
      if (ref.pr) {
        const pr = await gh(`/repos/${ref.owner}/${ref.name}/pulls/${ref.number}`);
        if (pr.ok && pr.json.merged) {
          row.state = 'merged';
          row.fixed = true;
        }
      }
    } else {
      // never name the repository in the error for a team entry
      errors.push(`outreach ${official ? where(base) : row.label}: GitHub answered ${issue.status || 'nothing'}`);
      row.state = 'unknown';
    }
  }
  outreach.push(row);
}

const totals = {
  contacted: outreach.filter((o) => o.state !== 'pending').length,
  replied: outreach.filter((o) => (o.replies ?? 0) > 0).length,
  fixed: outreach.filter((o) => o.fixed).length,
  open: outreach.filter((o) => o.state === 'open').length,
};

// Team rows are published only as totals: per-row order, dates, sectors or topics could be joined
// with the public issues to say which team has which finding. Midnight's own examples keep a row.
const teamRows = outreach.filter((o) => !o.official);
const teams = {
  contacted: teamRows.filter((o) => o.state !== 'pending').length,
  replied: teamRows.filter((o) => (o.replies ?? 0) > 0).length,
  fixed: teamRows.filter((o) => o.fixed).length,
  open: teamRows.filter((o) => o.state === 'open').length,
};
const out = { fetchedAt: new Date().toISOString(), authenticated: Boolean(TOKEN), repo, traffic, action, outreach: outreach.filter((o) => o.official), teams, totals, errors };
fs.writeFileSync(path.join(DATA, 'adoption.json'), JSON.stringify(out, null, 2) + '\n');
console.log(
  `adoption.json written: ${repo.stars ?? '?'} stars, ${repo.forks ?? '?'} forks; Action ${action.counted ? `${action.repositories} repositories` : 'not counted (no token)'}; outreach ${totals.contacted} contacted, ${totals.replied} replied, ${totals.fixed} fixed${errors.length ? `; ${errors.length} problem(s): ${errors.join('; ')}` : ''}`,
);
