// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The Preprod demo, offline: the same roles, findings and grades as
// chain/scripts/deploy-desk.ts, run in the simulator. Checks everything the deploy
// needs except the network: the proving keys load, the code hash computes, the engine
// grades the sources, and the lifecycle goes through. Prints what the chain would show.
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
  credentialLeaf,
  fromHex,
  gradeToNumber,
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
import { DEMO_EMBARGO, DEMO_FINDINGS, DEMO_REPO, rulesVersion } from './demo-data.js';

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
const R = { attester: randomBytes32(), researcher: randomBytes32(), researcher2: randomBytes32(), maintainer: randomBytes32() };
const sim = new DeskSimulator(pureCircuits.attesterKey(R.attester), DEMO_EMBARGO, { time: Math.floor(Date.now() / 1000) });
const ps: Record<string, DeskPrivateState> = {
  'desk-tell': { attesterSecret: R.attester, openings: {} },
  'desk-researcher': { researcherSecret: R.researcher, openings: {} },
  'desk-researcher-2': { researcherSecret: R.researcher2, openings: {} },
  'desk-maintainer': { maintainerSecret: R.maintainer, openings: {} },
};
const now = () => BigInt(sim.time);

sim.call(ps['desk-tell'], 'registerMaintainer', await credentialLeaf(R.maintainer, DEMO_REPO));
const ids: Record<string, string> = {};
for (const f of DEMO_FINDINGS) {
  const who = ps[f.researcher];
  who.draft = await newOpening(f.text, DEMO_REPO);
  const id = toHex(sim.call(who, 'seal', now()).result as Uint8Array);
  who.openings[id] = who.draft;
  // the note travels off chain; the maintainer stores it
  const note = noteOf(id, who.draft);
  ps['desk-maintainer'].openings[id] = openingOfNote(note);
  who.draft = undefined;
  ids[f.key] = id;
  sim.advance(60);
}
sim.call(ps['desk-maintainer'], 'acknowledge', fromHex(ids.ballot), now());
sim.call(ps['desk-maintainer'], 'acknowledge', fromHex(ids.board), now());
sim.advance(3600);
sim.call(ps['desk-maintainer'], 'markFixed', fromHex(ids.ballot), now());
sim.call(ps['desk-researcher'], 'reveal', fromHex(ids.ballot), ps['desk-researcher'].openings[ids.ballot]);
const scan = BigInt(Math.floor(Date.now() / 1000));
for (const g of grades) sim.call(ps['desk-tell'], 'attest', g.hash, gradeToNumber(g.grade), RULES, scan);
sim.call(ps['desk-maintainer'], 'selfGrade', deskHash, await projectId(DEMO_REPO), gradeToNumber(grades[0].grade), RULES, scan);
ok(`lifecycle: ${sim.transactions.length} transactions (${[...new Set(sim.transactions.map((t) => t.circuit))].join(', ')})`);

// 3. What the chain would show.
const view = readDesk(sim.publicState);
const revealed = view.reports.find((r) => r.id === ids.ballot)!;
const check = await verifyReveal(revealed, DEMO_FINDINGS[0].text, DEMO_REPO);
if (!check.digest || !check.project || !check.seal) throw new Error(`reveal does not verify: ${JSON.stringify(check)}`);
ok('the revealed report verifies against its published text');
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
