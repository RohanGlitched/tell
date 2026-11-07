// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Deploys Tell Desk with the house wallet and runs a demo lifecycle on it:
//   1. Tell (attester) registers a maintainer credential for Tell's own repository
//   2. a researcher seals two findings about the leak zoo; a second researcher seals one more
//   3. the maintainer acknowledges two of them and marks one fixed
//   4. the researcher reveals the fixed one; the opening and the text are published
//   5. Tell attests the grades of the two Preprod ballots (code hash read from the chain,
//      grade from scanning the source) and of Desk itself; the maintainer self-reports one
// Every step is saved to desk-<network>.json as it lands, so a rerun resumes where it stopped.
//
//   npm run compact:keys -w desk                       # proving keys, once
//   TELL_NETWORK=preprod npm run deploy:desk -w chain

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { House, ROOT, SECRETS, logger, NET, NETWORK } from '../src/house.js';
import { providers } from '../src/providers.js';
import {
  DeskClient,
  attesterHash,
  credentialLeaf,
  codeHash,
  codeHashOfState,
  emptyPrivateState,
  reportDigest,
  toHex,
  fromHex,
  type GradeLetter,
} from '../../desk/src/index.js';
import { scanFile } from '../../engine/src/index.js';
import { DEMO_EMBARGO, DEMO_FINDINGS, DEMO_REPO, rulesVersion } from '../../desk/scripts/demo-data.js';

const DESK = path.resolve(ROOT, '../desk');
const KEYS = path.join(DESK, 'keys/desk');
const ZOO = path.resolve(ROOT, '../zoo/contracts');
const OUT = path.join(ROOT, `desk-${NETWORK}.json`);
const BALLOTS = path.join(ROOT, NETWORK === 'preview' ? 'deployments.json' : `deployments-${NETWORK}.json`);
const ROLES = path.join(SECRETS, `desk-roles-${NETWORK}.json`);
const EMBARGO = DEMO_EMBARGO;
const RULES = rulesVersion(JSON.parse(fs.readFileSync(path.resolve(ROOT, '../engine/package.json'), 'utf8')).version);
const REPO = DEMO_REPO;
const FINDINGS = DEMO_FINDINGS;

// Role secrets: made once, kept with the house seed, never printed.
type Roles = { attester: string; researcher: string; researcher2: string; maintainer: string };
function roles(): Roles {
  if (!fs.existsSync(ROLES)) {
    const r = () => randomBytes(32).toString('hex');
    fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
    fs.writeFileSync(ROLES, JSON.stringify({ attester: r(), researcher: r(), researcher2: r(), maintainer: r() }), { mode: 0o600 });
  }
  return JSON.parse(fs.readFileSync(ROLES, 'utf8'));
}

type Step = { step: string; txId: string; at: string; [k: string]: unknown };
type Out = {
  network: string;
  contract: 'tell-desk';
  address?: string;
  deployTx?: string;
  attesterHash?: string;
  embargoSeconds?: number;
  rulesVersion?: number;
  steps: Step[];
  reports: Record<string, { id: string; text?: string; digest: string; revealed: boolean }>;
  grades: { contract: string; address?: string; codeHash: string; grade: GradeLetter; selfReported: boolean }[];
};
const out: Out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { network: NETWORK, contract: 'tell-desk', steps: [], reports: {}, grades: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
const done = (step: string) => out.steps.find((s) => s.step === step);

if (!fs.existsSync(path.join(KEYS, 'keys'))) throw new Error(`No proving keys at ${KEYS}: run \`npm run compact:keys -w desk\` first.`);

const house = await House.open();
await house.start();
await house.sync();
// After a restore from saved state the wallet may not have applied every DUST event yet; building a
// fee before then is rejected as InvalidDustSpendProof (node error 170). Give it time, then resync.
await new Promise((r) => setTimeout(r, Number(process.env.DESK_SETTLE_MS ?? 60_000)));
await house.sync();
logger.info(await house.summary());

// The node rejects a transaction that spends DUST the wallet has not yet seen settle; resync and retry.
// A failed submission can leave this wallet instance holding a lock on its DUST UTXO, so with
// DESK_TRIES=1 the script exits instead and an outer loop restarts it with a fresh wallet; finished
// steps are skipped because they are recorded in the output file.
async function retry<T>(what: string, f: () => Promise<T>, tries = Number(process.env.DESK_TRIES ?? 4)): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries) throw e;
      logger.warn(`${what} failed (${String(e).slice(0, 160)}); resyncing and retrying (${i}/${tries - 1})`);
      await new Promise((r) => setTimeout(r, 20_000 * i));
      await house.sync();
    }
  }
}

async function step(name: string, f: () => Promise<{ txId: string; [k: string]: unknown }>): Promise<Step> {
  const prev = done(name);
  if (prev) return prev;
  const t = Date.now();
  const r = await retry(name, f);
  const s: Step = { ...r, step: name, at: new Date().toISOString() };
  out.steps.push(s);
  save();
  logger.info(`${name}: ${r.txId} (${Math.round((Date.now() - t) / 1000)} s)`);
  // Let the DUST change from this transaction settle before the next one pays a fee.
  await new Promise((r) => setTimeout(r, Number(process.env.DESK_STEP_PAUSE_MS ?? 45_000)));
  await house.sync();
  return s;
}

const R = roles();
const p = providers(house, KEYS, 'tell-desk');
const secret = (h: string) => fromHex(h);

// ---------------------------------------------------------------- deploy

let desk: DeskClient;
if (!out.address) {
  logger.info('deploying Tell Desk…');
  const t = Date.now();
  const { client, txId } = await retry('deploy desk', () =>
    DeskClient.deploy(p as never, KEYS, {
      attesterHash: attesterHash(secret(R.attester)),
      embargoSeconds: EMBARGO,
      privateStateId: 'desk-tell',
      initialPrivateState: { ...emptyPrivateState(), attesterSecret: secret(R.attester) },
    }),
  );
  desk = client;
  Object.assign(out, { address: client.address, deployTx: txId, attesterHash: toHex(attesterHash(secret(R.attester))), embargoSeconds: Number(EMBARGO), rulesVersion: Number(RULES) });
  save();
  logger.info(`Tell Desk at ${client.address} (${Math.round((Date.now() - t) / 1000)} s)`);
} else {
  desk = DeskClient.join(p as never, KEYS, out.address);
}

// Each role's secrets live in its own private state (the encrypted local store).
await desk.update('desk-tell', (ps) => ({ ...ps, attesterSecret: secret(R.attester) }));
await desk.update('desk-researcher', (ps) => ({ ...ps, researcherSecret: secret(R.researcher) }));
await desk.update('desk-researcher-2', (ps) => ({ ...ps, researcherSecret: secret(R.researcher2) }));
await desk.update('desk-maintainer', (ps) => ({ ...ps, maintainerSecret: secret(R.maintainer) }));

// ---------------------------------------------------------------- disclosure lifecycle

await step('register maintainer', async () => desk.registerMaintainer('desk-tell', await credentialLeaf(secret(R.maintainer), REPO)));

for (const f of FINDINGS) {
  const s = await step(`seal ${f.key}`, async () => {
    const r = await desk.seal(f.researcher, f.text, REPO);
    // The researcher sends the note (and the text) to the maintainer, off chain.
    await desk.receive('desk-maintainer', r.note);
    return { txId: r.txId, id: r.id };
  });
  out.reports[f.key] ??= { id: s.id as string, digest: toHex(await reportDigest(f.text)), revealed: false };
  save();
}
const id = (k: string) => out.reports[k].id;

await step('acknowledge ballot', () => desk.acknowledge('desk-maintainer', id('ballot')));
await step('acknowledge board', () => desk.acknowledge('desk-maintainer', id('board')));
await step('fix ballot', () => desk.markFixed('desk-maintainer', id('ballot')));
await step('reveal ballot', () => desk.reveal('desk-researcher', id('ballot')));
// Revealed: the text is public now, so anyone can check it against the on-chain digest.
out.reports.ballot.revealed = true;
out.reports.ballot.text = FINDINGS[0].text;
save();

// ---------------------------------------------------------------- grades

const scan = BigInt(Math.floor(Date.now() / 1000));
const gradeOfSource = async (file: string) => {
  const r = await scanFile(file);
  if (!r.ok || !r.grade) throw new Error(`Tell could not scan ${file}: ${r.error}`);
  return r.grade as GradeLetter;
};

const ballots = fs.existsSync(BALLOTS) ? (JSON.parse(fs.readFileSync(BALLOTS, 'utf8')) as Record<string, { address: string }>) : {};
for (const name of ['ballot-leaky', 'ballot-fixed']) {
  const address = ballots[name]?.address;
  if (!address) {
    logger.warn(`${name} is not deployed on ${NETWORK}; skipping its grade`);
    continue;
  }
  const state = await p.publicDataProvider.queryContractState(address as never);
  if (!state) throw new Error(`no contract state for ${name} at ${address}`);
  const hash = await codeHashOfState(state as never);
  const grade = await gradeOfSource(path.join(ZOO, `${name}.compact`));
  await step(`attest ${name}`, async () => ({ ...(await desk.attest('desk-tell', hash, grade, RULES, scan)), codeHash: toHex(hash), grade }));
  if (!out.grades.some((g) => g.contract === name)) out.grades.push({ contract: name, address, codeHash: toHex(hash), grade, selfReported: false });
  save();
}

// Desk grades itself: its code hash from its own verifier keys, its grade from Tell's scan.
const vkDir = path.join(KEYS, 'keys');
const deskHash = await codeHash(
  fs
    .readdirSync(vkDir)
    .filter((f) => f.endsWith('.verifier'))
    .map((f) => ({ name: f.replace(/\.verifier$/, ''), verifierKey: new Uint8Array(fs.readFileSync(path.join(vkDir, f))) })),
);
const onChain = await p.publicDataProvider.queryContractState(desk.address as never);
if (onChain && toHex(await codeHashOfState(onChain as never)) !== toHex(deskHash)) logger.warn('Desk code hash from local keys differs from the chain; using the chain');
const deskHashFinal = onChain ? await codeHashOfState(onChain as never) : deskHash;
const deskGrade = await gradeOfSource(path.join(DESK, 'contracts/desk.compact'));
await step('attest tell-desk', async () => ({ ...(await desk.attest('desk-tell', deskHashFinal, deskGrade, RULES, scan)), codeHash: toHex(deskHashFinal), grade: deskGrade }));
await step('self-grade tell-desk', async () => ({ ...(await desk.selfGrade('desk-maintainer', deskHashFinal, REPO, deskGrade, RULES, scan)), codeHash: toHex(deskHashFinal), grade: deskGrade }));
for (const selfReported of [false, true])
  if (!out.grades.some((g) => g.contract === 'tell-desk' && g.selfReported === selfReported))
    out.grades.push({ contract: 'tell-desk', address: desk.address, codeHash: toHex(deskHashFinal), grade: deskGrade, selfReported });
save();

// ---------------------------------------------------------------- what the chain now shows

const view = await desk.view();
logger.info(
  `Tell Desk: ${view.reports.length} reports (${view.reports.map((r) => r.status + (r.opening ? ', revealed' : '')).join('; ')}), ` +
    `${view.grades.length} grades, ${view.selfGrades.length} self-reported, ${view.maintainerCredentials} maintainer credentials`,
);
logger.info(`done; ${NET.explorer}/contracts/${desk.address}`);
await house.stop();
process.exit(0);
