// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The Preprod demo, offline: the same roles, credentials, findings and grades as
// chain/scripts/deploy-desk.ts, run in the simulator. Checks everything the deploy
// needs except the network: the proving keys load, the code hash computes, the engine
// grades the sources, and the lifecycle goes through. Prints what the chain would show.
// The deploy also seals Tell's outreach notes from a private file; here twelve stand-in
// notes take their place, so the counts match.
//   npx tsx desk/scripts/dry-run.ts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { scanFile } from '../../engine/src/index.js';
import {
  DeskSimulator,
  compiledDesk,
  codeHash,
  fromHex,
  gradeFor,
  gradeToNumber,
  maintainerPublicKey,
  newOpening,
  noteOf,
  openingOfNote,
  projectId,
  pureCircuits,
  randomBytes32,
  readDesk,
  toHex,
  verifyReveal,
  type DeskPrivateState,
  type GradeLetter,
} from '../src/index.js';
import { DEMO_EMBARGO, DEMO_FINDINGS, DEMO_MAINTAINERS, DEMO_REPO, rulesVersion } from './demo-data.js';

setNetworkId('undeployed');
const DESK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = path.join(DESK, 'keys/desk');
const ZOO = path.resolve(DESK, '../zoo');
const RULES = rulesVersion(JSON.parse(fs.readFileSync(path.resolve(DESK, '../engine/package.json'), 'utf8')).version);

const verifierKeys = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.verifier'))
    .map((f) => ({ name: f.replace(/\.verifier$/, ''), verifierKey: new Uint8Array(fs.readFileSync(path.join(dir, f))) }));

const ok = (what: string) => console.log(`ok  ${what}`);

// 1. The deploy's inputs.
if (!fs.existsSync(path.join(KEYS, 'keys'))) throw new Error(`no proving keys at ${KEYS}: run \`npm run compact:keys -w desk\``);
compiledDesk(KEYS);
const vks = verifierKeys(path.join(KEYS, 'keys'));
const deskHash = await codeHash(vks);
ok(`proving keys load; ${vks.length} circuits; Desk code hash ${toHex(deskHash).slice(0, 16)}…`);

const grade = async (file: string) => {
  const r = await scanFile(file);
  if (!r.ok || !r.grade) throw new Error(`Tell could not scan ${file}: ${r.error}`);
  return r.grade as GradeLetter;
};
const grades: { name: string; hash: Uint8Array; grade: GradeLetter }[] = [{ name: 'tell-desk', hash: deskHash, grade: await grade(path.join(DESK, 'contracts/desk.compact')) }];
for (const name of ['ballot-leaky', 'ballot-fixed']) {
  const keys = path.join(ZOO, 'keys', name, 'keys');
  // On Preprod the ballots' hashes come from their on-chain state; here, from local keys if built.
  const hash = fs.existsSync(keys) ? await codeHash(verifierKeys(keys)) : randomBytes32();
  grades.push({ name, hash, grade: await grade(path.join(ZOO, 'contracts', `${name}.compact`)) });
}
ok(`Tell grades: ${grades.map((g) => `${g.name} ${g.grade}`).join(', ')} (rules ${RULES})`);

// 2. The lifecycle, role by role, as the deploy runs it.
const R = { attester: randomBytes32(), researcher: randomBytes32(), researcher2: randomBytes32() };
const sim = new DeskSimulator(pureCircuits.attesterKey(R.attester), DEMO_EMBARGO, { time: Math.floor(Date.now() / 1000) });
const ps: Record<string, DeskPrivateState> = {
  'desk-tell': { attesterSecret: R.attester, openings: {} },
  'desk-researcher': { researcherSecret: R.researcher, openings: {} },
  'desk-researcher-2': { researcherSecret: R.researcher2, openings: {} },
};
const maintainerId = (key: string) => (key === 'tell' ? 'desk-maintainer' : `desk-maintainer-${key}`);
const now = () => BigInt(sim.time);

// Five credentials: each maintainer hands Tell only maintainerKey(secret); Tell registers it with the project.
for (const m of DEMO_MAINTAINERS) {
  const sk = randomBytes32();
  ps[maintainerId(m.key)] = { maintainerSecret: sk, openings: {} };
  sim.call(ps['desk-tell'], 'registerMaintainer', maintainerPublicKey(sk), await projectId(m.repo));
}
const M = ps[maintainerId('tell')];

const ids: Record<string, string> = {};
for (const f of DEMO_FINDINGS) {
  const who = ps[f.researcher];
  who.draft = await newOpening(f.text, DEMO_REPO);
  const id = toHex(sim.call(who, 'seal', now()).result as Uint8Array);
  who.openings[id] = who.draft;
  // the note travels off chain; the maintainer stores it
  M.openings[id] = openingOfNote(noteOf(id, who.draft));
  who.draft = undefined;
  ids[f.key] = id;
  sim.advance(60);
}
// Outreach notes: sealed by Tell as researcher; only the commitments reach the chain.
for (let i = 1; i <= 12; i++) {
  const who = ps['desk-researcher'];
  who.draft = await newOpening(`stand-in outreach note ${i}`, `https://github.com/example-team-${i}/contract`);
  const id = toHex(sim.call(who, 'seal', now()).result as Uint8Array);
  who.openings[id] = who.draft;
  who.draft = undefined;
}
sim.call(M, 'acknowledge', fromHex(ids.ballot), now());
sim.call(M, 'acknowledge', fromHex(ids.board), now());
sim.advance(3600);
sim.call(M, 'markFixed', fromHex(ids.ballot), now());
sim.call(ps['desk-researcher'], 'reveal', fromHex(ids.ballot), ps['desk-researcher'].openings[ids.ballot]);
const scan = BigInt(Math.floor(Date.now() / 1000));
for (const g of grades) sim.call(ps['desk-tell'], 'attest', g.hash, gradeToNumber(g.grade), RULES, scan);
const tellProject = await projectId(DEMO_REPO);
sim.call(M, 'selfGrade', deskHash, tellProject, gradeToNumber(grades[0].grade), RULES, scan);
ok(`lifecycle: ${sim.transactions.length} transactions (${[...new Set(sim.transactions.map((t) => t.circuit))].join(', ')})`);

// 3. What the chain would show.
const view = readDesk(sim.publicState);
const revealed = view.reports.find((r) => r.id === ids.ballot)!;
const check = await verifyReveal(revealed, DEMO_FINDINGS[0].text, DEMO_REPO);
if (!check.digest || !check.project || !check.seal) throw new Error(`reveal does not verify: ${JSON.stringify(check)}`);
ok('the revealed report verifies against its published text');
if (view.maintainerCredentials !== DEMO_MAINTAINERS.length) throw new Error(`expected ${DEMO_MAINTAINERS.length} credentials, found ${view.maintainerCredentials}`);
if (gradeFor(sim.publicState, deskHash, tellProject)?.grade !== grades[0].grade) throw new Error('Desk’s grade does not read back');
ok(`${view.maintainerCredentials} maintainer credentials; Desk’s grade reads back by code hash`);
console.log(
  JSON.stringify(
    {
      reports: view.reports.map((r) => ({ id: r.id.slice(0, 16) + '…', status: r.status, revealed: !!r.opening })),
      grades: view.grades.map((g) => ({ codeHash: g.codeHash.slice(0, 16) + '…', grade: g.grade })),
      selfGrades: view.selfGrades.map((g) => ({ codeHash: g.codeHash.slice(0, 16) + '…', grade: g.grade, project: g.project?.slice(0, 16) + '…' })),
      maintainerCredentials: view.maintainerCredentials,
    },
    null,
    2,
  ),
);
