// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell Desk in the simulator: the disclosure lifecycle, every rejection the contract
// must make, and an attacker who reads only public data (ledger state and the public
// part of every transaction: its circuit and public transcript) and tries to link,
// recover or identify.

import { describe, it, expect, beforeEach } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  DeskSimulator,
  pureCircuits,
  Status,
  witnesses,
  readDesk,
  gradeFor,
  selfGradesFor,
  verifyReveal,
  projectId,
  reportDigest,
  toHex,
  randomBytes32,
  gradeToNumber,
  canonicalRepo,
  newOpening,
  type DeskPrivateState,
  type Opening,
} from '../src/index.js';

setNetworkId('undeployed');

const DAY = 86_400;
const EMBARGO = 90n * BigInt(DAY);
const REPO_A = 'https://github.com/example-org/sealed-bids';
const REPO_B = 'https://github.com/another-team/payroll';
const TEXT_1 = 'bid() writes hash(bid) to the ledger; bids are below 10,000, so a table of 10,000 hashes recovers every bid.';
const TEXT_2 = 'register() stores the same hash(memberKey) on every post, so one identified post unmasks the rest.';

// ---------------------------------------------------------------- the attacker's tools

// Every byte string and number in a value: ledger state, transaction inputs, outputs, transcripts.
function atoms(x: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (x === null || x === undefined) return out;
  if (x instanceof Uint8Array) {
    out.push(toHex(x));
    return out;
  }
  if (typeof x === 'bigint') {
    out.push(x.toString(16));
    return out;
  }
  if (typeof x !== 'object' || seen.has(x)) return out;
  seen.add(x);
  if (x instanceof Map) for (const [k, v] of x) (atoms(k, out, seen), atoms(v, out, seen));
  else if (Array.isArray(x)) for (const v of x) atoms(v, out, seen);
  else for (const v of Object.values(x)) atoms(v, out, seen);
  return out;
}

// Everything public: the whole encoded contract state plus the public part of every transaction
// (its public transcript; a call's inputs and outputs travel only inside a hiding commitment).
function publicAtoms(sim: DeskSimulator): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = sim.publicState as any;
  const state = (s.state ?? s).encode();
  return [...atoms(state), ...sim.transactions.flatMap((t) => atoms(t.view))];
}

// Whether `secret` shows up anywhere in `haystack`, whole or as a 16-byte piece, either byte order.
function appears(secret: Uint8Array, haystack: string[]): boolean {
  const pieces = [secret.slice(0, 16), secret.slice(16), Uint8Array.from(secret).reverse().slice(0, 16)].map(toHex);
  return haystack.some((h) => pieces.some((p) => h.includes(p)));
}

// 32-byte values (and long fields) in a transaction's public view.
const values32 = (view: unknown) => new Set(atoms(view).filter((h) => h.length >= 40));

// ---------------------------------------------------------------- the world

type World = Awaited<ReturnType<typeof world>>;

async function world(opts: { witnesses?: Partial<typeof witnesses> } = {}) {
  const attesterSecret = randomBytes32();
  const sim = new DeskSimulator(pureCircuits.attesterKey(attesterSecret), EMBARGO, opts);
  const tell: DeskPrivateState = { attesterSecret, openings: {} };
  const researcher: DeskPrivateState = { researcherSecret: randomBytes32(), openings: {} };
  const otherResearcher: DeskPrivateState = { researcherSecret: randomBytes32(), openings: {} };
  const maintainerA: DeskPrivateState = { maintainerSecret: randomBytes32(), openings: {} };
  const maintainerB: DeskPrivateState = { maintainerSecret: randomBytes32(), openings: {} };
  const projectA = await projectId(REPO_A);
  const projectB = await projectId(REPO_B);
  // Each maintainer hands Tell only their key, a hash of their secret; Tell checks off chain
  // that the key's holder controls the repository and registers (key, project).
  const pkA = pureCircuits.maintainerKey(maintainerA.maintainerSecret!);
  const pkB = pureCircuits.maintainerKey(maintainerB.maintainerSecret!);
  const leafA = pureCircuits.maintainerLeaf(pkA, projectA);
  const leafB = pureCircuits.maintainerLeaf(pkB, projectB);
  sim.call(tell, 'registerMaintainer', pkA, projectA);
  sim.call(tell, 'registerMaintainer', pkB, projectB);
  const now = () => BigInt(sim.time);

  // The researcher seals a report; the opening goes into their private state and,
  // off chain, to the maintainer of the project it is about.
  const seal = async (who: DeskPrivateState, text: string, repo: string, to?: DeskPrivateState) => {
    const opening = await newOpening(text, repo);
    who.draft = opening;
    const { result } = sim.call(who, 'seal', now());
    const id = result as Uint8Array;
    who.draft = undefined;
    who.openings[toHex(id)] = opening;
    if (to) to.openings[toHex(id)] = opening;
    return { id, opening };
  };
  return { sim, tell, researcher, otherResearcher, maintainerA, maintainerB, projectA, projectB, pkA, pkB, leafA, leafB, now, seal };
}

const report = (w: World, id: Uint8Array) => w.sim.ledger.reports.lookup(id);

// ---------------------------------------------------------------- lifecycle

describe('lifecycle', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it('seal stores a commitment-keyed record: tag, time, pending; nothing about the content', async () => {
    const { id, opening } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    expect(toHex(id)).toBe(toHex(pureCircuits.sealOf(opening)));
    const r = report(w, id);
    expect(r.status).toBe(Status.pending);
    expect(r.sealedAt).toBe(w.now());
    expect(r.updatedAt).toBe(w.now());
    expect(toHex(r.tag)).toBe(toHex(pureCircuits.researcherTag(w.researcher.researcherSecret!, id)));
    expect(w.sim.ledger.sealedCount).toBe(1n);
    expect(w.sim.ledger.openings.isEmpty()).toBe(true);
  });

  it('seal, acknowledge, fix, reveal: the reveal proves the finding existed at seal time', async () => {
    const { id } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    const sealedAt = w.now();
    w.sim.advance(2 * DAY);
    w.sim.call(w.maintainerA, 'acknowledge', id, w.now());
    expect(report(w, id).status).toBe(Status.acknowledged);
    expect(report(w, id).updatedAt).toBe(sealedAt + 2n * BigInt(DAY));
    w.sim.advance(10 * DAY);
    w.sim.call(w.maintainerA, 'markFixed', id, w.now());
    expect(report(w, id).status).toBe(Status.fixed);
    w.sim.call(w.researcher, 'reveal', id, w.researcher.openings[toHex(id)]);

    const view = readDesk(w.sim.publicState);
    const r = view.reports.find((x) => x.id === toHex(id))!;
    expect(r.status).toBe('fixed');
    expect(r.sealedAt).toBe(Number(sealedAt));
    expect(r.opening?.digest).toBe(toHex(await reportDigest(TEXT_1)));
    expect(r.opening?.project).toBe(toHex(w.projectA));
    expect(await verifyReveal(r, TEXT_1, REPO_A)).toEqual({ digest: true, project: true, seal: true });
    // a different text, or the right text about another project, does not verify
    expect((await verifyReveal(r, TEXT_1 + ' ', REPO_A)).digest).toBe(false);
    expect((await verifyReveal(r, TEXT_1, REPO_B)).project).toBe(false);
  });

  it('either side can reveal: the maintainer opens a fixed report', async () => {
    const { id, opening } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    w.sim.call(w.maintainerA, 'acknowledge', id, w.now());
    w.sim.call(w.maintainerA, 'markFixed', id, w.now());
    w.sim.call(w.maintainerA, 'reveal', id, opening);
    expect(w.sim.ledger.openings.member(id)).toBe(true);
  });

  it('after the embargo the researcher can reveal a report the maintainer never fixed', async () => {
    const { id, opening } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    w.sim.advance(Number(EMBARGO) - 60);
    expect(() => w.sim.call(w.researcher, 'reveal', id, opening)).toThrow(/still under embargo/);
    w.sim.advance(60);
    w.sim.call(w.researcher, 'reveal', id, opening);
    expect(report(w, id).status).toBe(Status.pending);
    expect(w.sim.ledger.openings.member(id)).toBe(true);
  });

  it('the researcher can retract a pending report; it can then be neither acknowledged nor revealed', async () => {
    const { id, opening } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    w.sim.call(w.researcher, 'retract', id, w.now());
    expect(report(w, id).status).toBe(Status.retracted);
    expect(() => w.sim.call(w.maintainerA, 'acknowledge', id, w.now())).toThrow(/not awaiting acknowledgement/);
    w.sim.advance(Number(EMBARGO));
    expect(() => w.sim.call(w.researcher, 'reveal', id, opening)).toThrow(/retracted/);
  });

  it('a credential stays usable after more maintainers are registered (historic root)', async () => {
    const { id } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    for (let i = 0; i < 5; i++) w.sim.call(w.tell, 'registerMaintainer', randomBytes32(), randomBytes32());
    w.sim.call(w.maintainerA, 'acknowledge', id, w.now());
    expect(report(w, id).status).toBe(Status.acknowledged);
    expect(w.sim.ledger.maintainers.firstFree()).toBe(7n);
  });

  it('Tell attests grades by contract code hash; a later scan replaces an earlier one', () => {
    const code = randomBytes32();
    w.sim.call(w.tell, 'attest', code, gradeToNumber('C'), 3n, 10n);
    expect(gradeFor(w.sim.publicState, code)).toMatchObject({ grade: 'C', rules: 3, scan: 10, selfReported: false });
    w.sim.call(w.tell, 'attest', code, gradeToNumber('A'), 4n, 11n);
    expect(gradeFor(w.sim.publicState, code)).toMatchObject({ grade: 'A', rules: 4, scan: 11 });
    expect(() => w.sim.call(w.tell, 'attest', code, gradeToNumber('F'), 4n, 11n)).toThrow(/later scan/);
    expect(() => w.sim.call(w.tell, 'attest', code, gradeToNumber('F'), 4n, 9n)).toThrow(/later scan/);
    expect(readDesk(w.sim.publicState).grades).toHaveLength(1);
  });

  it('a maintainer self-publishes a grade, flagged as self-reported and kept apart from Tell’s', () => {
    const code = randomBytes32();
    const slot = pureCircuits.selfGradeKey(code, w.projectA);
    w.sim.call(w.maintainerA, 'selfGrade', code, w.projectA, gradeToNumber('B'), 4n, 1n);
    expect(gradeFor(w.sim.publicState, code, w.projectA)).toMatchObject({ codeHash: toHex(code), grade: 'B', selfReported: true, project: toHex(w.projectA) });
    expect(w.sim.ledger.grades.member(code)).toBe(false);
    // a reader who names no project gets no self-report: it cannot know whose claim to trust
    expect(gradeFor(w.sim.publicState, code)).toBeUndefined();
    // Tell's own attestation takes precedence for readers
    w.sim.call(w.tell, 'attest', code, gradeToNumber('D'), 4n, 1n);
    expect(gradeFor(w.sim.publicState, code, w.projectA)).toMatchObject({ grade: 'D', selfReported: false });
    expect(w.sim.ledger.selfGrades.lookup(slot).grade).toBe(gradeToNumber('B'));
    // the same project can update its self-report with a later scan
    w.sim.call(w.maintainerA, 'selfGrade', code, w.projectA, gradeToNumber('A'), 4n, 2n);
    expect(w.sim.ledger.selfGrades.lookup(slot).grade).toBe(gradeToNumber('A'));
    expect(readDesk(w.sim.publicState).selfGrades).toEqual([expect.objectContaining({ codeHash: toHex(code), grade: 'A', project: toHex(w.projectA) })]);
  });

  it('two projects shipping the same code each publish their own self-grade; neither locks out the other', () => {
    // the same code hash under two projects (a shared example, a fork): A claims first
    const code = randomBytes32();
    w.sim.call(w.maintainerA, 'selfGrade', code, w.projectA, gradeToNumber('F'), 4n, 9n);
    // B still publishes its own, in its own slot, even with an earlier scan number
    w.sim.call(w.maintainerB, 'selfGrade', code, w.projectB, gradeToNumber('A'), 4n, 1n);
    expect(gradeFor(w.sim.publicState, code, w.projectB)).toMatchObject({ grade: 'A', project: toHex(w.projectB) });
    expect(gradeFor(w.sim.publicState, code, w.projectA)).toMatchObject({ grade: 'F', project: toHex(w.projectA) });
    const all = selfGradesFor(w.sim.publicState, code);
    expect(all.map((g) => g.project).sort()).toEqual([toHex(w.projectA), toHex(w.projectB)].sort());
    // each slot moves only with its own project's later scans
    w.sim.call(w.maintainerB, 'selfGrade', code, w.projectB, gradeToNumber('B'), 4n, 2n);
    expect(gradeFor(w.sim.publicState, code, w.projectA)?.grade).toBe('F');
    expect(gradeFor(w.sim.publicState, code, w.projectB)?.grade).toBe('B');
  });

  it('the attester role is handed over in two steps; the old key works until the new one accepts', () => {
    const next = randomBytes32();
    const nextTell: DeskPrivateState = { attesterSecret: next, openings: {} };
    w.sim.call(w.tell, 'handOver', pureCircuits.attesterKey(next));
    expect(readDesk(w.sim.publicState).pendingAttester).toBe(toHex(pureCircuits.attesterKey(next)));
    // proposed, not yet accepted: the old key still works, the new one does not yet
    w.sim.call(w.tell, 'attest', randomBytes32(), 0n, 1n, 1n);
    expect(() => w.sim.call(nextTell, 'attest', randomBytes32(), 0n, 1n, 1n)).toThrow(/not the attester/);
    w.sim.call(nextTell, 'acceptHandOver');
    expect(toHex(w.sim.ledger.attester)).toBe(toHex(pureCircuits.attesterKey(next)));
    expect(readDesk(w.sim.publicState).pendingAttester).toBeUndefined();
    expect(() => w.sim.call(w.tell, 'attest', randomBytes32(), 0n, 1n, 1n)).toThrow(/not the attester/);
    w.sim.call(nextTell, 'attest', randomBytes32(), 0n, 1n, 1n);
    expect(w.sim.ledger.grades.size()).toBe(2n);
  });

  it('a mistyped hand-over cannot lock the role away: it is never accepted and can be cancelled', () => {
    w.sim.call(w.tell, 'handOver', randomBytes32()); // nobody holds the secret behind this key
    expect(() => w.sim.call(w.tell, 'acceptHandOver')).toThrow(/not the proposed attester/);
    w.sim.call(w.tell, 'handOver', new Uint8Array(32)); // cancel
    expect(() => w.sim.call(w.tell, 'acceptHandOver')).toThrow(/no hand-over pending/);
    w.sim.call(w.tell, 'attest', randomBytes32(), 0n, 1n, 1n);
    expect(w.sim.ledger.grades.size()).toBe(1n);
  });

  it('registration builds the leaf from the key and project Tell checked', () => {
    expect(w.sim.ledger.maintainers.findPathForLeaf(w.leafA)).toBeDefined();
    expect(w.sim.ledger.registered.member(w.leafA)).toBe(true);
    expect(readDesk(w.sim.publicState).maintainerCredentials).toBe(2);
    // the leaf for any other project and the same key is not in the tree
    expect(w.sim.ledger.maintainers.findPathForLeaf(pureCircuits.maintainerLeaf(w.pkA, w.projectB))).toBeUndefined();
  });

  it('project ids are canonical: URL spellings of one repository agree', async () => {
    const forms = ['https://github.com/Example-Org/Sealed-Bids.git', 'git@github.com:example-org/sealed-bids.git', 'github.com/example-org/sealed-bids/', 'https://www.github.com/example-org/sealed-bids#readme'];
    for (const f of forms) expect(canonicalRepo(f)).toBe('github.com/example-org/sealed-bids');
    for (const f of forms) expect(toHex(await projectId(f))).toBe(toHex(w.projectA));
  });
});

// ---------------------------------------------------------------- rejections

describe('the contract rejects', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it('a maintainer of another project acknowledging (even holding the opening)', async () => {
    const { id } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerB);
    expect(() => w.sim.call(w.maintainerB, 'acknowledge', id, w.now())).toThrow(/not registered/);
    expect(report(w, id).status).toBe(Status.pending);
  });

  it('an unregistered maintainer, or one with no opening', async () => {
    const { id } = await w.seal(w.researcher, TEXT_1, REPO_A);
    const stranger: DeskPrivateState = { maintainerSecret: randomBytes32(), openings: { [toHex(id)]: w.researcher.openings[toHex(id)] } };
    expect(() => w.sim.call(stranger, 'acknowledge', id, w.now())).toThrow(/not registered/);
    expect(() => w.sim.call(w.maintainerA, 'acknowledge', id, w.now())).toThrow(/no opening/);
  });

  it('a maintainer verified for project A acting for project B, in every circuit that needs a credential', async () => {
    // Version 1 took a leaf from the maintainer, so A could have handed Tell a leaf built for
    // project B. Now Tell registers (key, project) after checking that A controls project A only.
    const forB = await w.seal(w.researcher, TEXT_2, REPO_B, w.maintainerB);
    w.maintainerA.openings[toHex(forB.id)] = forB.opening; // A even holds the opening
    expect(() => w.sim.call(w.maintainerA, 'acknowledge', forB.id, w.now())).toThrow(/not registered/);
    w.sim.call(w.maintainerB, 'acknowledge', forB.id, w.now());
    expect(() => w.sim.call(w.maintainerA, 'markFixed', forB.id, w.now())).toThrow(/not registered/);
    expect(() => w.sim.call(w.maintainerA, 'selfGrade', randomBytes32(), w.projectB, 0n, 1n, 1n)).toThrow(/not registered/);
    expect(report(w, forB.id).status).toBe(Status.acknowledged);
    // nor does a dishonest prover get through by inventing a path to its own leaf for B
    const evil = await world({
      witnesses: {
        maintainerPath: ({ privateState }, leaf) => [privateState, { leaf, path: Array.from({ length: 10 }, () => ({ sibling: { field: 0n }, goes_left: true })) }] as never,
      },
    });
    const forB2 = await evil.seal(evil.researcher, TEXT_2, REPO_B, evil.maintainerA);
    expect(() => evil.sim.call(evil.maintainerA, 'acknowledge', forB2.id, evil.now())).toThrow(/not a registered maintainer/);
  });

  it('registering the same credential twice', () => {
    expect(() => w.sim.call(w.tell, 'registerMaintainer', w.pkA, w.projectA)).toThrow(/already registered/);
    expect(w.sim.ledger.maintainers.firstFree()).toBe(2n);
    // the same maintainer key for a second project is a different credential
    w.sim.call(w.tell, 'registerMaintainer', w.pkA, w.projectB);
    expect(w.sim.ledger.registered.size()).toBe(3n);
  });

  it('a status change dated before the report’s last change', async () => {
    const { id } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    w.sim.advance(600);
    // inside the two-hour window, but earlier than the seal
    expect(() => w.sim.call(w.maintainerA, 'acknowledge', id, w.now() - 1200n)).toThrow(/before the report's last change/);
    w.sim.call(w.maintainerA, 'acknowledge', id, w.now() - 300n);
    expect(report(w, id).updatedAt).toBe(w.now() - 300n);
  });

  it('a dishonest prover passing another maintainer’s tree path', async () => {
    // maintainer B's device lies: for any leaf it returns the path to maintainer A's credential
    const evil = await world({
      witnesses: {
        maintainerPath: ({ privateState, ledger }, _leaf) => [privateState, ledger.maintainers.findPathForLeaf(leafOfA)!] as never,
      },
    });
    const leafOfA = evil.leafA;
    const { id } = await evil.seal(evil.researcher, TEXT_1, REPO_A, evil.maintainerB);
    expect(() => evil.sim.call(evil.maintainerB, 'acknowledge', id, evil.now())).toThrow(/path is for another credential/);
  });

  it('a dishonest prover inventing a tree path for an unregistered credential', async () => {
    // the path ends at the right leaf, but its siblings are made up, so its root was never the tree's
    const forged = await world({
      witnesses: {
        maintainerPath: ({ privateState }, leaf) =>
          [privateState, { leaf, path: Array.from({ length: 10 }, (_, i) => ({ sibling: { field: BigInt(i + 1) }, goes_left: i % 2 === 0 })) }] as never,
      },
    });
    const { id } = await forged.seal(forged.researcher, TEXT_1, REPO_A, forged.maintainerB);
    expect(() => forged.sim.call(forged.maintainerB, 'acknowledge', id, forged.now())).toThrow(/not a registered maintainer/);
  });

  it('an acknowledgement with the opening of a different report', async () => {
    const one = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    const two = await w.seal(w.researcher, TEXT_2, REPO_A, w.maintainerA);
    w.maintainerA.openings[toHex(one.id)] = two.opening;
    expect(() => w.sim.call(w.maintainerA, 'acknowledge', one.id, w.now())).toThrow(/opening does not match/);
  });

  it('acknowledging twice, fixing before acknowledging, unknown reports', async () => {
    const { id } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    expect(() => w.sim.call(w.maintainerA, 'markFixed', id, w.now())).toThrow(/not acknowledged/);
    w.sim.call(w.maintainerA, 'acknowledge', id, w.now());
    expect(() => w.sim.call(w.maintainerA, 'acknowledge', id, w.now())).toThrow(/not awaiting acknowledgement/);
    expect(() => w.sim.call(w.maintainerA, 'acknowledge', randomBytes32(), w.now())).toThrow(/no such report/);
  });

  it('a reveal with the wrong nonce, the wrong digest or the wrong project', async () => {
    const { id, opening } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    w.sim.call(w.maintainerA, 'acknowledge', id, w.now());
    w.sim.call(w.maintainerA, 'markFixed', id, w.now());
    const wrong: Opening[] = [
      { ...opening, nonce: randomBytes32() },
      { ...opening, finding: { ...opening.finding, digest: await reportDigest(TEXT_2) } },
      { ...opening, finding: { ...opening.finding, project: w.projectB } },
    ];
    for (const o of wrong) expect(() => w.sim.call(w.researcher, 'reveal', id, o)).toThrow(/opening does not match/);
    expect(w.sim.ledger.openings.member(id)).toBe(false);
  });

  it('revealing twice', async () => {
    const { id, opening } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    w.sim.call(w.maintainerA, 'acknowledge', id, w.now());
    w.sim.call(w.maintainerA, 'markFixed', id, w.now());
    w.sim.call(w.researcher, 'reveal', id, opening);
    expect(() => w.sim.call(w.maintainerA, 'reveal', id, opening)).toThrow(/already revealed/);
  });

  it('revealing an acknowledged but unfixed report before the embargo ends', async () => {
    const { id, opening } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    w.sim.call(w.maintainerA, 'acknowledge', id, w.now());
    w.sim.advance(30 * DAY);
    expect(() => w.sim.call(w.researcher, 'reveal', id, opening)).toThrow(/still under embargo/);
  });

  it('sealing the same opening twice', async () => {
    const opening = await newOpening(TEXT_1, REPO_A);
    w.researcher.draft = opening;
    w.sim.call(w.researcher, 'seal', w.now());
    expect(() => w.sim.call(w.researcher, 'seal', w.now())).toThrow(/already sealed/);
  });

  it('a seal time in the future or older than the window (no back-dating for priority)', async () => {
    w.researcher.draft = await newOpening(TEXT_1, REPO_A);
    expect(() => w.sim.call(w.researcher, 'seal', w.now() + 60n)).toThrow(/future/);
    expect(() => w.sim.call(w.researcher, 'seal', w.now() - 7200n)).toThrow(/too old/);
    w.sim.call(w.researcher, 'seal', w.now() - 7199n);
  });

  it('someone else retracting a researcher’s report', async () => {
    const { id } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    expect(() => w.sim.call(w.otherResearcher, 'retract', id, w.now())).toThrow(/not the researcher/);
    w.sim.call(w.maintainerA, 'acknowledge', id, w.now());
    expect(() => w.sim.call(w.researcher, 'retract', id, w.now())).toThrow(/only a sealed report/);
  });

  it('anyone but the attester attesting, registering maintainers or handing over', () => {
    const impostor: DeskPrivateState = { attesterSecret: randomBytes32(), openings: {} };
    expect(() => w.sim.call(impostor, 'attest', randomBytes32(), 0n, 1n, 1n)).toThrow(/not the attester/);
    expect(() => w.sim.call(impostor, 'registerMaintainer', randomBytes32(), randomBytes32())).toThrow(/not the attester/);
    expect(() => w.sim.call(impostor, 'handOver', randomBytes32())).toThrow(/not the attester/);
    expect(() => w.sim.call(impostor, 'acceptHandOver')).toThrow(/no hand-over pending/);
    expect(() => w.sim.call(w.maintainerA, 'attest', randomBytes32(), 0n, 1n, 1n)).toThrow(/attester secret/);
    expect(w.sim.ledger.grades.isEmpty()).toBe(true);
    expect(w.sim.ledger.maintainers.firstFree()).toBe(2n);
  });

  it('grades outside A to F', () => {
    expect(() => w.sim.call(w.tell, 'attest', randomBytes32(), 5n, 1n, 1n)).toThrow(/A, B, C, D or F/);
    expect(() => w.sim.call(w.maintainerA, 'selfGrade', randomBytes32(), w.projectA, 7n, 1n, 1n)).toThrow(/A, B, C, D or F/);
  });

  it('a self-grade for a project the maintainer is not registered for, or replacing another project’s', () => {
    const code = randomBytes32();
    expect(() => w.sim.call(w.maintainerA, 'selfGrade', code, w.projectB, 0n, 1n, 1n)).toThrow(/not registered/);
    w.sim.call(w.maintainerA, 'selfGrade', code, w.projectA, 2n, 1n, 1n);
    // B's only way into A's slot is to prove a credential for project A, which it does not hold
    expect(() => w.sim.call(w.maintainerB, 'selfGrade', code, w.projectA, 0n, 1n, 2n)).toThrow(/not registered/);
    expect(() => w.sim.call(w.maintainerA, 'selfGrade', code, w.projectA, 0n, 1n, 1n)).toThrow(/later scan/);
    expect(gradeFor(w.sim.publicState, code, w.projectA)?.grade).toBe('C');
  });
});

// ---------------------------------------------------------------- the attacker

describe('an attacker reading only public data', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it('sees what is public: the scanner finds report ids and tags (control)', async () => {
    const { id } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    const pub = publicAtoms(w.sim);
    expect(appears(id, pub)).toBe(true);
    expect(appears(report(w, id).tag, pub)).toBe(true);
    expect(appears(w.leafA, pub)).toBe(true); // registration publishes the credential leaf
  });

  it('learns only the leaf from a registration: neither the maintainer key nor the project', () => {
    const reg = w.sim.transactions.filter((t) => t.circuit === 'registerMaintainer');
    expect(reg).toHaveLength(2);
    const pub = publicAtoms(w.sim);
    for (const x of [w.pkA, w.pkB, w.projectA, w.projectB]) expect(appears(x, pub)).toBe(false);
    expect(appears(w.leafA, pub) && appears(w.leafB, pub)).toBe(true);
    // control: the key and the project are the circuit's inputs, which only the prover sees
    expect(appears(w.projectA, atoms(reg[0].prover))).toBe(true);
    expect(appears(w.pkA, atoms(reg[0].prover))).toBe(true);
  });

  it('cannot link two reports by the same researcher', async () => {
    const a = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    const b = await w.seal(w.researcher, TEXT_2, REPO_A, w.maintainerA);
    const c = await w.seal(w.otherResearcher, TEXT_2, REPO_B, w.maintainerB);
    const [ta, tb, tc] = [a, b, c].map((r) => toHex(report(w, r.id).tag));
    expect(new Set([ta, tb, tc]).size).toBe(3);
    // the public records and seal transactions of a and b share no value at all, exactly
    // like a and c: same-researcher pairs look the same as different-researcher pairs
    const seals = w.sim.transactions.filter((t) => t.circuit === 'seal').map((t) => values32(t.view));
    const shared = (x: Set<string>, y: Set<string>) => [...x].filter((v) => y.has(v));
    expect(shared(seals[0], seals[1])).toEqual([]);
    expect(shared(seals[0], seals[2])).toEqual([]);
    // the tag is a keyed hash: without the researcher secret, guessing it from the id fails
    expect(toHex(pureCircuits.researcherTag(new Uint8Array(32), a.id))).not.toBe(ta);
    expect(appears(w.researcher.researcherSecret!, publicAtoms(w.sim))).toBe(false);
  });

  it('cannot recover the digest from the seal, even knowing the exact text and project', async () => {
    const { id } = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    const digest = await reportDigest(TEXT_1);
    expect(appears(digest, publicAtoms(w.sim))).toBe(false);
    // the attacker guesses the text and the project exactly; without the 32-byte nonce no seal matches
    const guesses = [new Uint8Array(32), digest, w.projectA, id, ...Array.from({ length: 200 }, randomBytes32)];
    const hits = guesses.filter((nonce) => toHex(pureCircuits.sealOf({ finding: { digest, project: w.projectA }, nonce })) === toHex(id));
    expect(hits).toEqual([]);
  });

  it('cannot tell which project a pending report is about', async () => {
    const a = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    w.sim.call(w.maintainerA, 'acknowledge', a.id, w.now());
    await w.seal(w.otherResearcher, TEXT_2, REPO_B, w.maintainerB);
    const pub = publicAtoms(w.sim);
    expect(appears(w.projectA, pub)).toBe(false);
    expect(appears(w.projectB, pub)).toBe(false);
    // once revealed, it is public on purpose
    w.sim.call(w.maintainerA, 'markFixed', a.id, w.now());
    w.sim.call(w.researcher, 'reveal', a.id, a.opening);
    expect(appears(w.projectA, publicAtoms(w.sim))).toBe(true);
    expect(appears(w.projectB, publicAtoms(w.sim))).toBe(false);
  });

  it('never sees a maintainer’s secret, and their acknowledgements do not carry their credential', async () => {
    const a = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    const b = await w.seal(w.otherResearcher, TEXT_2, REPO_A, w.maintainerA);
    w.sim.call(w.maintainerA, 'acknowledge', a.id, w.now());
    w.sim.call(w.maintainerA, 'acknowledge', b.id, w.now());
    w.sim.call(w.maintainerA, 'markFixed', a.id, w.now());
    const pub = publicAtoms(w.sim);
    expect(appears(w.maintainerA.maintainerSecret!, pub)).toBe(false);
    const maintainerTxs = w.sim.transactions.filter((t) => t.circuit === 'acknowledge' || t.circuit === 'markFixed');
    expect(maintainerTxs).toHaveLength(3);
    for (const t of maintainerTxs) expect(appears(w.leafA, atoms(t.view))).toBe(false);
  });

  it('cannot link two acknowledgements to one maintainer: they share only the tree root everyone uses', async () => {
    const a = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    const b = await w.seal(w.researcher, TEXT_2, REPO_A, w.maintainerA);
    const c = await w.seal(w.researcher, TEXT_2, REPO_B, w.maintainerB);
    // the root as a transcript carries it: a field element, little-endian
    const be = w.sim.ledger.maintainers.root().field.toString(16).padStart(64, '0');
    const root = be.match(/../g)!.reverse().join('');
    for (const r of [a, b]) w.sim.call(w.maintainerA, 'acknowledge', r.id, w.now());
    w.sim.call(w.maintainerB, 'acknowledge', c.id, w.now());
    const acks = w.sim.transactions.filter((t) => t.circuit === 'acknowledge').map((t) => values32(t.view));
    const shared = (x: Set<string>, y: Set<string>) => [...x].filter((v) => y.has(v));
    // same maintainer (a, b) and different maintainers (a, c) share exactly the same thing: the root
    // (trailing zero bytes of an encoded value are dropped, hence the prefix check)
    for (const pair of [shared(acks[0], acks[1]), shared(acks[0], acks[2])]) {
      expect(pair).toHaveLength(1);
      expect(root.startsWith(pair[0])).toBe(true);
    }
  });

  it('a researcher’s retraction adds nothing that links it to their other reports', async () => {
    const a = await w.seal(w.researcher, TEXT_1, REPO_A, w.maintainerA);
    const b = await w.seal(w.researcher, TEXT_2, REPO_B, w.maintainerB);
    w.sim.call(w.researcher, 'retract', a.id, w.now());
    const retract = values32(w.sim.transactions.at(-1)!.view);
    expect(retract.has(toHex(report(w, b.id).tag))).toBe(false);
    expect(retract.has(toHex(b.id))).toBe(false);
    expect(appears(w.researcher.researcherSecret!, publicAtoms(w.sim))).toBe(false);
  });

  it('never sees the attester secret, only its hash', () => {
    w.sim.call(w.tell, 'attest', randomBytes32(), 0n, 1n, 1n);
    const pub = publicAtoms(w.sim);
    expect(appears(w.tell.attesterSecret!, pub)).toBe(false);
    expect(appears(w.sim.ledger.attester, pub)).toBe(true);
  });
});
