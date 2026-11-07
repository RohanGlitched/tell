// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// On-chain smoke test of the live site (.github/workflows/smoke.yml): reads Midnight Preprod
// through the site's own APIs, the way the /live and /desk pages do.
//   /api/live  the leaky ballot gives up every vote (6 of 6), the fixed one none (0 of 6), and the
//              recovered tally matches the votes recorded at deploy time
//   /api/desk  Tell Desk's state decodes: an address, at least one sealed report, and no sealed
//              report shows its content
// Addresses come from the API, not from this file, so a redeploy needs no change here.
//   node .github/scripts/smoke.mjs [base URL]
import fs from 'node:fs';

const BASE = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'https://tell-midnight.vercel.app').replace(/\/$/, '');
const HEX64 = /^[0-9a-f]{64}$/;
const failures = [];
const lines = [];
const check = (ok, what) => {
  lines.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  console.log(`${ok ? 'ok  ' : '::error title=Smoke::'}${what}`);
  if (!ok) failures.push(what);
  return ok;
};

// The indexer behind the APIs sometimes answers 502 for a moment: three tries, 15 s apart.
async function get(path) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { 'cache-control': 'no-cache', 'user-agent': 'tell-smoke' }, signal: AbortSignal.timeout(45_000) });
      const body = await r.json().catch(() => null);
      if (r.ok && body) return body;
      last = `${r.status} ${body?.error ?? ''}`.trim();
    } catch (e) {
      last = e.message;
    }
    if (i < 3) {
      console.log(`::warning title=Smoke::GET ${path} failed (${last}); retrying in 15 s`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
  throw new Error(`GET ${path}: ${last}`);
}

// ---- the ballots
try {
  const live = await get('/api/live');
  check(live.network === 'preprod', `/api/live reads Midnight Preprod (network: ${live.network})`);
  const leaky = live.ballots?.find((b) => b.contract === 'ballot-leaky');
  const fixed = live.ballots?.find((b) => b.contract === 'ballot-fixed');
  if (check(!!leaky && HEX64.test(leaky.address), `leaky ballot read at ${leaky?.address}`)) {
    const got = leaky.ballots.filter((b) => b.recovered).length;
    check(leaky.ballots.length === 6 && got === 6, `leaky ballot: ${got} of ${leaky.ballots.length} votes recovered from public data (want 6 of 6)`);
    // the recovered votes are the votes cast, as the deployment record has them
    const dep = JSON.parse(fs.readFileSync(new URL('../../web/data/deployments.json', import.meta.url), 'utf8')).contracts?.['ballot-leaky'];
    if (dep && dep.address === leaky.address) {
      const want = {};
      for (const v of dep.votes) want[v.choice] = (want[v.choice] ?? 0) + 1;
      const same = Object.keys({ ...want, ...leaky.tally }).every((k) => want[k] === leaky.tally?.[k]);
      check(same, `recovered tally ${JSON.stringify(leaky.tally)} matches the votes cast ${JSON.stringify(want)}`);
    } else console.log(`note: the leaky ballot is not the one in web/data/deployments.json; tally not compared`);
  }
  if (check(!!fixed && HEX64.test(fixed.address), `fixed ballot read at ${fixed?.address}`)) {
    const got = fixed.ballots.filter((b) => b.recovered).length;
    check(fixed.ballots.length === 6 && got === 0, `fixed ballot: ${got} of ${fixed.ballots.length} votes recovered (want 0 of 6)`);
    check(fixed.tally === null, 'fixed ballot: no tally can be computed from public data');
  }
} catch (e) {
  check(false, e.message);
}

// ---- Tell Desk
try {
  const desk = await get('/api/desk');
  check(desk.network === 'preprod', `/api/desk reads Midnight Preprod (network: ${desk.network})`);
  check(HEX64.test(desk.address ?? ''), `Tell Desk address from the API: ${desk.address}`);
  check(Number.isInteger(desk.sealedCount) && desk.sealedCount >= 1, `Tell Desk sealedCount ${desk.sealedCount} (want at least 1)`);
  const reports = Array.isArray(desk.reports) ? desk.reports : [];
  check(reports.length >= 1, `Tell Desk state decodes: ${reports.length} report(s)`);
  const STATUSES = new Set(['pending', 'acknowledged', 'fixed', 'retracted']);
  check(reports.every((r) => HEX64.test(r.id) && STATUSES.has(r.status) && Number.isInteger(r.sealedAt) && r.sealedAt > 0), 'every report has an id, a status and a seal time');
  // a sealed report shows nothing about its content until it is revealed
  const sealed = reports.filter((r) => !r.opening);
  check(sealed.every((r) => !r.published && !JSON.stringify(r).includes('digest')), `${sealed.length} sealed report(s) carry no digest or text`);
  check(Array.isArray(desk.grades) && Array.isArray(desk.selfGrades), `grades decode: ${desk.grades?.length} attested, ${desk.selfGrades?.length} self-reported`);
} catch (e) {
  check(false, e.message);
}

if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### On-chain smoke test: ${BASE}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed against ${BASE}`);
  process.exit(1);
}
console.log(`\nall checks passed against ${BASE}`);
