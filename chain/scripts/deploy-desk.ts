// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Deploys Tell Desk v2 with the house wallet and runs the whole demo lifecycle on it, in
// one process:
//   1. Tell (attester) registers five maintainer credentials, one per public repository of
//      Tell's author (desk/scripts/demo-data.ts), so an acknowledgement hides among five
//   2. a researcher seals two findings about the leak zoo; a second researcher seals one more
//   3. Tell, as researcher, seals one report per outreach note it sent on November 7, read
//      from the private file secrets/outreach-notes.json (skipped if absent); only each
//      seal's commitment reaches the chain, never the repository or the text
//   4. Tell's maintainer acknowledges two zoo reports and marks one fixed
//   5. the researcher reveals the fixed one; the opening and the text are published
//   6. Tell attests the grades of the two Preprod ballots (code hash read from the chain,
//      grade from scanning the source) and of Desk itself; Tell's maintainer self-reports
//      Desk's grade for the Tell project
// Every step is saved to desk-<network>.json as it lands, so a rerun resumes where it stopped.
// A version 1 record found there is first moved to desk-<network>-v1.json, keeping its address.
//
//   npm run compact:keys -w desk                       # proving keys, once
//   TELL_NETWORK=preprod npm run deploy:desk -w chain
//
// Knobs: DESK_FRESH=1 (sync the wallet from genesis), DESK_TRIES (attempts per step, default 4),
// DESK_SETTLE_MS (wait after the first sync, default 60 s), DESK_STEP_PAUSE_MS (wait after each
// step, default 45 s).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { House, ROOT, SECRETS, logger, NET, NETWORK } from '../src/house.js';
import { providers } from '../src/providers.js';
import {
  DeskClient,
  attesterHash,
  maintainerPublicKey,
  codeHash,
  codeHashOfState,
  emptyPrivateState,
  reportDigest,
  toHex,
  fromHex,
  type GradeLetter,
} from '../../desk/src/index.js';
import { scanFile } from '../../engine/src/index.js';
import { DEMO_EMBARGO, DEMO_FINDINGS, DEMO_MAINTAINERS, DEMO_REPO, rulesVersion } from '../../desk/scripts/demo-data.js';

const VERSION = 2;
const DESK = path.resolve(ROOT, '../desk');
const KEYS = path.join(DESK, 'keys/desk');
const ZOO = path.resolve(ROOT, '../zoo/contracts');
const OUT = path.join(ROOT, `desk-${NETWORK}.json`);
const OUT_V1 = path.join(ROOT, `desk-${NETWORK}-v1.json`);
const BALLOTS = path.join(ROOT, NETWORK === 'preview' ? 'deployments.json' : `deployments-${NETWORK}.json`);
const ROLES = path.join(SECRETS, `desk-roles-${NETWORK}.json`);
// Private inputs and outputs: the outreach notes (repository and text), and the openings of their seals.
const OUTREACH_IN = path.join(SECRETS, 'outreach-notes.json');
const OUTREACH_OPENINGS = path.join(SECRETS, `desk-outreach-openings-${NETWORK}.json`);
const EMBARGO = DEMO_EMBARGO;
const RULES = rulesVersion(JSON.parse(fs.readFileSync(path.resolve(ROOT, '../engine/package.json'), 'utf8')).version);
const REPO = DEMO_REPO;
const FINDINGS = DEMO_FINDINGS;

// Writes a file in one step (a crash never leaves half of it).
function writeAtomic(file: string, text: string, mode?: number) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- roles (secrets, never printed)

// Made once, kept with the house seed. Version 1 had one maintainer secret (`maintainer`); it
// becomes Tell's own, and each other repository gets its own.
type Roles = { attester: string; researcher: string; researcher2: string; maintainer?: string; maintainers?: Record<string, string> };
function roles(): Roles & { maintainers: Record<string, string> } {
  const r = () => randomBytes(32).toString('hex');
  const R: Roles = fs.existsSync(ROLES) ? JSON.parse(fs.readFileSync(ROLES, 'utf8')) : { attester: r(), researcher: r(), researcher2: r() };
  const maintainers = { ...(R.maintainers ?? {}) };
  for (const m of DEMO_MAINTAINERS) maintainers[m.key] ??= m.key === 'tell' && R.maintainer ? R.maintainer : r();
  const next = { ...R, maintainers };
  if (JSON.stringify(next) !== JSON.stringify(R)) {
    fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
    writeAtomic(ROLES, JSON.stringify(next), 0o600);
  }
  return next;
}

// ---------------------------------------------------------------- the outreach notes (private input)

type OutreachNote = { key: string; repo: string; text: string };
function outreachNotes(): OutreachNote[] {
  if (!fs.existsSync(OUTREACH_IN)) {
    logger.info(`no ${path.relative(ROOT, OUTREACH_IN)}; skipping the outreach seals`);
    return [];
  }
  // An array of { key, repo, text }, { notes: [...] }, or { [key]: { repo, text } }.
  const raw = JSON.parse(fs.readFileSync(OUTREACH_IN, 'utf8'));
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.notes) ? raw.notes : Object.entries(raw ?? {}).map(([key, v]) => ({ key, ...(v as object) }));
  const notes: OutreachNote[] = [];
  list.forEach((n, i) => {
    const x = n as Partial<OutreachNote>;
    if (typeof x?.key === 'string' && x.key && typeof x.repo === 'string' && x.repo && typeof x.text === 'string' && x.text) notes.push({ key: x.key, repo: x.repo, text: x.text });
    else logger.warn(`outreach note ${i + 1} lacks a key, repo or text; skipping it`);
  });
  const keys = new Set(notes.map((n) => n.key));
  if (keys.size !== notes.length) throw new Error('outreach note keys must be unique');
  if (notes.length !== 12) logger.warn(`${notes.length} outreach notes (12 were sent on November 7)`);
  return notes;
}

// ---------------------------------------------------------------- the record

type Step = { step: string; txId: string; at: string; [k: string]: unknown };
type Out = {
  network: string;
  contract: 'tell-desk';
  version: number;
  previous?: { version: number; address?: string; record: string };
  address?: string;
  deployTx?: string;
  attesterHash?: string;
  embargoSeconds?: number;
  rulesVersion?: number;
  // The repositories with a registered maintainer credential (the anonymity set), sorted, not in leaf order.
  maintainers?: { count: number; repos: string[] };
  steps: Step[];
  // Zoo findings: the digest stays here (and off the site) until the report is revealed.
  reports: Record<string, { id: string; text?: string; digest: string; revealed: boolean; repo?: string }>;
  // Outreach seals: the note's key and the seal's id only; the repository and text stay private.
  outreach: Record<string, { id: string }>;
  grades: { contract: string; address?: string; codeHash: string; grade: GradeLetter; selfReported: boolean; repo?: string }[];
};

// A version 1 record moves aside, untouched, so its address stays on file.
if (fs.existsSync(OUT)) {
  const prev = JSON.parse(fs.readFileSync(OUT, 'utf8')) as Partial<Out>;
  if ((prev.version ?? 1) < VERSION) {
    if (fs.existsSync(OUT_V1)) throw new Error(`${path.basename(OUT)} holds a version 1 record but ${path.basename(OUT_V1)} already exists; move one of them by hand`);
    fs.renameSync(OUT, OUT_V1);
    logger.info(`moved the version 1 record (Desk at ${prev.address ?? 'no address'}) to ${path.basename(OUT_V1)}`);
  }
}
const v1 = fs.existsSync(OUT_V1) ? (JSON.parse(fs.readFileSync(OUT_V1, 'utf8')) as Partial<Out>) : undefined;
const out: Out = fs.existsSync(OUT)
  ? { outreach: {}, ...JSON.parse(fs.readFileSync(OUT, 'utf8')) }
  : {
      network: NETWORK,
      contract: 'tell-desk',
      version: VERSION,
      ...(v1 ? { previous: { version: 1, address: v1.address, record: path.basename(OUT_V1) } } : {}),
      steps: [],
      reports: {},
      outreach: {},
      grades: [],
    };
const save = () => writeAtomic(OUT, JSON.stringify(out, null, 2) + '\n');
const done = (step: string) => out.steps.find((s) => s.step === step);

if (!fs.existsSync(path.join(KEYS, 'keys'))) throw new Error(`No proving keys at ${KEYS}: run \`npm run compact:keys -w desk\` first.`);
const vkDir = path.join(KEYS, 'keys');
if (!fs.existsSync(path.join(vkDir, 'acceptHandOver.verifier'))) throw new Error(`The keys at ${KEYS} are for Desk version 1: rerun \`npm run compact:keys -w desk\`.`);

// Each credential is for a real public repository: check they exist before spending anything.
for (const m of DEMO_MAINTAINERS) {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', m.repo, 'HEAD'], { stdio: 'ignore', timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  } catch {
    throw new Error(`${m.repo} is not a reachable public repository; fix DEMO_MAINTAINERS in desk/scripts/demo-data.ts`);
  }
}
const NOTES = outreachNotes();

// ---------------------------------------------------------------- the wallet

// DESK_FRESH=1 ignores the saved wallet state and syncs from genesis (slow, but a saved DUST state
// that disagrees with the node makes every fee proof fail with error 170).
const house = await House.open({ fresh: process.env.DESK_FRESH === '1' });
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
// A store of its own, apart from version 1's private states.
const p = providers(house, KEYS, 'tell-desk-v2');
const secret = (h: string) => fromHex(h);
const maintainerId = (key: string) => (key === 'tell' ? 'desk-maintainer' : `desk-maintainer-${key}`);

// ---------------------------------------------------------------- deploy

let desk: DeskClient;
if (!out.address) {
  logger.info('deploying Tell Desk v2…');
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
for (const m of DEMO_MAINTAINERS) await desk.update(maintainerId(m.key), (ps) => ({ ...ps, maintainerSecret: secret(R.maintainers[m.key]) }));

// ---------------------------------------------------------------- maintainer credentials

// Each maintainer hands Tell only maintainerKey(secret). Tell's off-chain check (does the key's
// holder control the repository?) is trivial here: one owner holds all five. Steps are numbered,
// not named, so the record does not say which leaf is which repository.
for (const [i, m] of DEMO_MAINTAINERS.entries()) {
  await step(`register maintainer ${i + 1}`, () => desk.registerMaintainer('desk-tell', maintainerPublicKey(secret(R.maintainers[m.key])), m.repo));
}
out.maintainers = { count: DEMO_MAINTAINERS.length, repos: DEMO_MAINTAINERS.map((m) => m.repo).sort() };
save();

// ---------------------------------------------------------------- disclosure lifecycle

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

// The outreach notes. The opening (digest, project, nonce) goes to Tell's private state and to a
// private file with the house seed, so Tell can later hand it to the team or reveal it.
const openings: Record<string, unknown> = fs.existsSync(OUTREACH_OPENINGS) ? JSON.parse(fs.readFileSync(OUTREACH_OPENINGS, 'utf8')) : {};
for (const n of NOTES) {
  const s = await step(`seal outreach ${n.key}`, async () => {
    const r = await desk.seal('desk-researcher', n.text, n.repo);
    openings[n.key] = r.note;
    writeAtomic(OUTREACH_OPENINGS, JSON.stringify(openings, null, 2) + '\n', 0o600);
    return { txId: r.txId, id: r.id };
  });
  out.outreach[n.key] ??= { id: s.id as string };
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
out.reports.ballot.repo = REPO;
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
    out.grades.push({ contract: 'tell-desk', address: desk.address, codeHash: toHex(deskHashFinal), grade: deskGrade, selfReported, ...(selfReported ? { repo: REPO } : {}) });
save();

// ---------------------------------------------------------------- what the chain now shows

const view = await desk.view();
logger.info(
  `Tell Desk v2: ${view.reports.length} reports (${view.reports.map((r) => r.status + (r.opening ? ', revealed' : '')).join('; ')}), ` +
    `${view.grades.length} grades, ${view.selfGrades.length} self-reported, ${view.maintainerCredentials} maintainer credentials`,
);
logger.info(`done; ${NET.explorer}/contracts/${desk.address}`);
await house.stop();
process.exit(0);
