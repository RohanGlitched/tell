# Tell Desk

Private, provable responsible disclosure on Midnight, and a public registry of Tell's privacy grades.

Tell finds privacy leaks in Compact contracts. Telling a team about one is the delicate part: the finding is itself a secret until it is fixed, the researcher wants proof they found it first, and the team wants to answer without advertising that it has an open bug. Tell Desk is a Compact contract for exactly that, and it is where Tell records the grades it gives contracts, so wallets and dApps can read a contract's grade from the chain.

Its first real use is Tell's own outreach. On November 7, 2026 Tell sent twelve leak notes: eleven to buildathon teams and one to [midnightntwrk/midnight-examples#90](https://github.com/midnightntwrk/midnight-examples/issues/90). The notes went out first, by the usual channels; the version 2 deploy script then seals one report per note, from a private file that never enters the repository. A seal therefore proves that a note existed, in that exact form, no later than its seal time (not the time it was sent), and the chain holds only the commitment: not the team, the repository or the text. The script also seals three findings about Tell's own leak zoo and runs those through the whole lifecycle (acknowledge, fix, reveal), since the zoo's leaks are public by design.

| Path | What |
|---|---|
| [`contracts/desk.compact`](contracts/desk.compact) | the contract (version 2) |
| [`src/`](src) | witnesses, a midnight-js client (seal, acknowledge, fix, reveal, register, attest), a public-state reader, an in-memory simulator |
| [`test/desk.test.ts`](test/desk.test.ts) | lifecycle, rejections, and an attacker who reads only public data |
| [`scripts/`](scripts) | compile, the demo's credentials and findings, and an offline dry run of the Preprod demo |
| [`../chain/scripts/deploy-desk.ts`](../chain/scripts/deploy-desk.ts) | deploys Desk with the house wallet and runs the demo lifecycle |

## How a disclosure goes

1. **Seal.** The researcher writes the report and seals it. The ledger stores `persistentCommit({digest, project}, nonce)` as the report id, a researcher tag, the seal time and the status `pending`. `digest` is SHA-256 of the report text; `project` is SHA-256 of the canonical repository URL. Both, and the 32-byte nonce, stay in the researcher's private state. The researcher sends the text and the opening to the maintainer off chain (Tell's private leak notes).
2. **Acknowledge.** The maintainer proves, in zero knowledge, that they hold the opening of this report and a maintainer credential registered for the project it commits to. Status becomes `acknowledged`. The proof shows neither the credential nor the project.
3. **Fix.** Same proof; status becomes `fixed`.
4. **Reveal.** Anyone holding the opening publishes it: once the report is fixed, or once the embargo (90 days on Preprod) has passed without a fix. The ledger then holds the digest, the project and the nonce. Anyone with the published text can check that it hashes to the digest and that the opening matches the seal, so the seal time proves the finding existed, in this exact form, then.
5. **Retract.** Before acknowledgement, the researcher can withdraw a report by proving the tag is theirs.

A status change is stamped with the caller's time, checked against the block time, and never dated before the report's last change.

## Registering a maintainer

A maintainer credential binds a secret to one project, and only Tell's attester key can add one.

1. The maintainer makes a 32-byte secret and keeps it in their private state. They send Tell only their **maintainer key**, `persistentHash("tell-desk:maintainer-key", secret)` ([`maintainerPublicKey`](src/client.ts)), and the repository, over a private channel.
2. Tell checks, off chain, that whoever sent that key controls the repository. The procedure: Tell replies with a random challenge; the maintainer commits it to the repository's default branch (or posts it from an account with write access); Tell confirms it there. The repository then shows only a random string, never the key.
3. Tell calls `registerMaintainer(key, project)`. The circuit builds the leaf, `persistentHash("tell-desk:maintainer", key, project)`, and inserts it into the tree. The key and the project are circuit inputs: a Midnight transaction carries only a hiding commitment to its inputs (the ledger's `ContractCall.communicationCommitment`), not the inputs themselves, so neither is published. Only the leaf is, and without the key nobody can test it against a guessed project.
4. To act, the maintainer's proof rebuilds the leaf from `maintainerKey(secret)` and the project the report commits to, and shows it is in the tree. A key Tell checked for project A gives a leaf for project A and nothing else.

Version 1 had the attester insert a leaf the maintainer computed. Tell could not look inside it, so a maintainer verified for one repository could hand in a leaf for another and acknowledge, fix or self-grade as that project's maintainer. Version 2 closes that: the leaf is built in the circuit from what Tell checked.

A leaf can be registered only once (a `registered` set beside the tree), so the count of credentials is the count of distinct ones: the anonymity set an acknowledgement hides in. The demo registers five, one for each of five public repositories with one owner, Tell's author ([`scripts/demo-data.ts`](scripts/demo-data.ts)): RohanGlitched/tell, petri, sheaf, avow and segundo. In the demo the off-chain check is trivial (one person holds all five secrets), and the deploy script only confirms each repository is reachable with `git ls-remote`. The record lists the five repositories sorted, not in leaf order.

## Grades

Tell's attester key records `code hash → grade, rules version, scan`; a grade is only replaced by a later scan. The code hash is SHA-256 over every circuit's name and verifier key, so a wallet can compute it from the contract state the indexer returns for any address ([`codeHashOfState`](src/view.ts)).

A registered maintainer can publish a grade for a contract of their own project. Self-reports sit apart from Tell's, flagged, and keyed by `persistentHash("tell-desk:self-grade", code hash, project)`: one slot per project and code. Version 1 keyed them by code hash alone, so the first registered maintainer to claim a code hash locked every other project out of it, the real team included. Version 2 has two properties:

- **No squatting.** Writing a project's slot takes a credential for that project, so nobody can take another team's slot or block it.
- **Shared code works.** The same code hash can belong to several projects (a shared example, a fork); each publishes its own self-report.

Why not have Tell bind each code hash to one project instead? Identical code ships in more than one project, so a one-owner binding would be wrong for exactly those contracts, and it would bring Tell back into every self-report. Keying by project keeps a self-report what it is: a public, attributable claim by the named project.

Readers: [`gradeFor(state, codeHash, project?)`](src/view.ts) returns Tell's attestation if there is one; otherwise the self-report of the project the caller names (the dApp a wallet is talking to says which repository it is). Without a project it returns nothing rather than pick some project's claim. [`selfGradesFor(state, codeHash)`](src/view.ts) lists every self-report for a code hash, each with its project id.

## What is public and what is private

Midnight gives every contract two ledgers: the public one, which everyone replicates, and private state, which stays on each user's device and enters only as witnesses to zero-knowledge proofs. Desk puts on the public ledger only what someone must be able to check without trusting anyone.

| Data | Where | Why |
|---|---|---|
| Report text | nowhere on chain; only its SHA-256, and only after reveal | the content is the secret |
| Report digest, project id, nonce | researcher's and maintainer's private state; public only on reveal | the opening of the seal |
| Report id = `persistentCommit({digest, project}, nonce)` | public | a hiding, binding commitment: the receipt that proves priority |
| Researcher secret | researcher's private state | authorship; never leaves the device |
| Researcher tag = `persistentHash("tell-desk:researcher", secret, id)` | public | lets the researcher prove a report is theirs (retract) without any stable identifier: every report's tag is different |
| Maintainer secret | maintainer's private state | the credential; never leaves the device |
| Maintainer key = `persistentHash("tell-desk:maintainer-key", secret)` | the maintainer and Tell, off chain; a private input to `registerMaintainer` | what Tell checks and registers |
| Credential leaf = `persistentHash("tell-desk:maintainer", key, project)` | public, as a leaf of a Merkle tree and in `registered` | built by the circuit; hides the key, the secret and the project |
| Merkle path to the leaf | maintainer's device (built from the public tree) | a witness; only the root it leads to is disclosed |
| Seal time, last status change | public | the transaction's own block shows when it happened; the contract only checks the claimed time against block time |
| Status | public | the point of the desk: anyone can see a report was answered and fixed |
| Attester hash, proposed next attester hash | public | officer keys: `persistentHash("tell-desk:attester", secret)` |
| Grades, self-reported grades | public | a registry; wallets read it |

Before a reveal, the ledger does not say which project a report is about. A public project id would have let teams find their reports on chain, but it would also announce "this project has an unfixed bug" to everyone else; the maintainer learns of the report from the off-chain note instead, and the chain shows only that some registered maintainer answered it.

## Every disclose(), justified

| Circuit | `disclose(…)` | What becomes public | Why it is safe |
|---|---|---|---|
| constructor | `attesterHash`, `embargoSeconds` | the attester's key hash, the disclosure policy | configuration, public on purpose |
| `stamp` (used by seal, and through `restamp` by acknowledge, markFixed, retract) | `now` | the caller's claimed time | the block already says when the transaction ran; the contract asserts `now ≤ block time < now + 2 h` (and, for a status change, `now ≥` the last change) |
| `proveMaintainer` | `merkleTreePathRoot(path)` | a root of the maintainer tree | every maintainer proving against the current tree gets the same root; it says "some registered maintainer", not which |
| `seal` | `sealOf(draft)` | the report id | a commitment with a fresh 32-byte nonce: hiding even to someone who guesses the exact text and project |
| `seal` | `researcherTag(secret, id)` | the tag | keyed by a 256-bit secret and different per report: unlinkable across reports |
| `acknowledge`, `markFixed`, `retract` | `id` | which report | an argument that is public already (the report id) |
| `reveal` | `id`, `opening` | digest, project and nonce of a fixed or expired report | the reveal step of a commit-reveal: publishing it is the point |
| `registerMaintainer` | `maintainerLeaf(key, project)` | a credential leaf | a hash of the maintainer key (itself a hash of a 256-bit secret) and the project; the key and project stay private inputs |
| `attest`, `selfGrade` | code hash, grade, rules, scan (and project for self-grades) | a grade | a public registry; a self-report is a public claim, so it names its project |
| `handOver` | proposed attester hash | the next officer key | configuration; it takes effect only on `acceptHandOver` |

`acceptHandOver` discloses nothing new: it copies the already public proposed key into `attester`. No branch depends on a secret: the only `if`s test whether a public code hash (or code-and-project slot) already has a grade.

## Threat model

An attacker reads everything public: the ledger state and the public part of every transaction. A contract call on chain carries its address, entry point, public transcripts (every ledger operation with the values it reads and writes), the proof, and a hiding commitment to its inputs and outputs (`ContractCall` in `@midnight-ntwrk/ledger-v8`). The simulator ([`src/simulator.ts`](src/simulator.ts)) records exactly that as a transaction's public view, and the prover's inputs and result apart; the tests in [`test/desk.test.ts`](test/desk.test.ts) play the attacker on the public view and use the prover's view only as a control:

- **Linking reports to a researcher.** Tags are keyed hashes of the researcher secret and the report id. Two reports by one researcher share no public value at all, exactly like two reports by different researchers.
- **Recovering a report before reveal.** The digest appears nowhere in public data. The seal is a commitment with a 32-byte nonce, so even guessing the exact text and project does not match it.
- **Learning which project has an open report.** The project id appears nowhere in public data until the reveal, including in the registrations.
- **Identifying the maintainer.** Among the registered credentials (five in the demo; one would identify the answerer), nothing singles one out. The maintainer secret and key never appear; acknowledgements carry neither the credential leaf nor the project. Two acknowledgements by one maintainer share only the tree root, which every maintainer's proof made at that time shares too (the client always proves against the latest root, so the root says when the proof was made, not who made it).
- **Acting for another project.** A maintainer verified for project A cannot acknowledge, fix or self-grade for project B, even holding B's opening; nor can a dishonest prover with someone else's tree path or an invented one. A wrong nonce, digest or project cannot reveal; nothing can be revealed twice, or before a fix while the embargo runs. Only the attester can attest, register or propose a hand-over, and only the proposed key can accept it.
- **Squatting a self-grade slot.** A second project publishes its own self-report for the same code; a project without a credential for A cannot write A's slot.

### Version 2 review

With the two holes above fixed, the rest of the contract was checked again:

- **Replay.** Every state-changing circuit checks state that its first run changed: a seal's existence, a report's status, a reveal, a registered leaf, a scan number, a pending hand-over. A replayed call fails. A replayed `handOver` sets the same proposal, and fails once the role has moved, since the attester check reads the current key.
- **Double registration.** Rejected (`registered`), so one credential cannot pass for two in the anonymity set.
- **Double reveal, reveal after retraction, early reveal.** Rejected.
- **Embargo.** It runs from the seal time, which may be up to 2 hours before the block (the proving window), so a reveal can come at most 2 hours early. An acknowledged report that is never fixed opens after the embargo too; acknowledging cannot stall a reveal.
- **Time order.** Version 1 let a status change carry a time before the seal (inside the 2-hour window). Version 2 rejects it.
- **Hand-over.** Version 1 moved the attester role in one call, so a mistyped key locked the role away for good. Version 2 proposes, and the role moves only when the holder of the proposed key accepts; proposing zero cancels.
- **Griefing.** Anyone can seal, so seals can be spammed (below). Only the maintainer of the report's project can move it forward, and only its researcher can retract it.
- **Linkability of acknowledgements.** They share only the root, and the anonymity set is the number of distinct credentials in that root: five in the demo.

What Desk does not hide:

- Timing. Transactions are public, so the seal, acknowledgement and fix times are visible, and a small anonymity set (few registered maintainers, few reports) makes timing correlation easier.
- Tell, as registrar, knows which credential leaf belongs to which project: it checked the key and built the leaf. It cannot see which leaf produced an acknowledgement.
- Who submits. Each transaction is balanced and submitted by some wallet; Desk does not hide which one. A researcher who wants no wallet tied to their seals can hand the proven transaction to someone else to pay for: the house wallet already has `sponsor()`, which attaches only a DUST fee to another party's proven transaction ([`chain/src/house.ts`](../chain/src/house.ts)). Wiring it to Desk is a next step.
- A self-reported grade states that a contract belongs to a project; the chain cannot check that claim, which is why it is flagged, kept apart from Tell's grades, and names the project that made it. Any registered project can make such a claim about any code under its own name, so a reader should ask for the project it expects.

## Tell scans its own contract

```
$ npx tsx engine/src/cli.ts desk/contracts/desk.compact
desk/contracts/desk.compact  grade A  compact 0.31.1, 11 circuits  26 info
```

Grade A with no suppressions: all 26 findings are info, each a circuit argument written on purpose (report ids, times, the reveal's opening, grades, the proposed attester key). `registerMaintainer` has none: it publishes only a hash of its inputs. CI fails if anything at low or above appears. The contract compiles with Compact 0.31.1, 0.35.0 and 0.36.0. 0.31.1 targets Ledger 8 (Preprod, where Desk is deployed); 0.36.0 targets Ledger 9 (mainnet since November 6). CI checks the later two in the `desk-compilers` job: it compiles Desk with each, runs [`compat/`](compat) on the runtime that compiler targets (compact-runtime 0.20 and 0.21, where circuits are async), and scans it at grade A with the same compiler.

## Tests

`npm test -w desk`: 40 tests in the simulator ([`src/simulator.ts`](src/simulator.ts)), which runs the compiled contract with a controllable block time and records the public part of every transaction.

- **Lifecycle (13):** seal; seal → acknowledge → fix → reveal with the reveal checked against the text; either side reveals; reveal after the embargo; retract; credentials survive later registrations; attestations and their scan order; self-reported grades; two projects self-grading the same code; the two-step attester hand-over; a mistyped hand-over that is never accepted and is cancelled; registration building the leaf from the checked key and project; canonical project ids.
- **Rejections (18):** a maintainer of another project; a maintainer verified for A acting for B in acknowledge, markFixed and selfGrade; an unregistered maintainer; a dishonest prover with someone else's tree path or an invented one; a second registration of one credential; the opening of another report; out-of-order status changes; a status change dated before the last one; a wrong nonce, digest or project at reveal; a second reveal; a reveal under embargo; a duplicate seal; future or back-dated seal times; retraction by someone else; every attester circuit called by a non-attester; grades outside A to F; a self-grade for a project the maintainer is not registered for, or into another project's slot.
- **Attacker (9):** listed under the threat model above, plus a control showing the attacker's scanner does find what is public, and a registration test showing the key and project are absent from public data and present only in the prover's view.

`compat/desk-compat.test.ts`: tests of the same contract built with Compact 0.35.0 or 0.36.0, on a simulator for the newer runtime's API: the lifecycle with the reveal checked against the seal, the embargo, rejections, grades and self-grades, and the public-data attacker (including a registration, which publishes the credential leaf but not the maintainer key or the project). CI also builds the proving keys and runs the offline dry run on every push.

`npm run dry-run -w desk` runs the Preprod demo offline: it loads the proving keys, computes Desk's code hash, grades the sources with the engine, runs the same lifecycle in the simulator (five credentials, three zoo findings, twelve stand-in outreach seals, acknowledgements, a fix, a reveal, three attestations and a self-grade) and checks the revealed report against its text.

## Run it

```bash
compact update 0.31.1            # targets Ledger 8 (Preprod)
npm install
npm run compact -w desk          # compile (no proving keys) for the simulator
npm test -w desk                 # lifecycle, rejections, attacker tests
npm run compact:keys -w desk     # proving keys, for a deploy (about 2 minutes)
npm run dry-run -w desk          # the Preprod demo, offline
TELL_NETWORK=preprod npm run deploy:desk -w chain   # needs chain/secrets (house wallet, Blockfrost)
```

The deploy reads `chain/secrets/outreach-notes.json` if it exists (a list of `{ key, repo, text }`, git-ignored) and writes each seal's opening to `chain/secrets/desk-outreach-openings-<network>.json`, so Tell can later hand it to the team or reveal it. `chain/desk-<network>.json` records each outreach seal by key and report id only; the website's copy drops the keys too ([`web/scripts/contracts.mjs`](../web/scripts/contracts.mjs)). A version 1 record found there is moved to `chain/desk-<network>-v1.json` first, so the old address stays on file.

## On Preprod

Version 1 (`c3b70e8e…f88943d6`) was deployed on November 7, 2026 and ran three steps (deploy, one credential, one seal) before the review above; it is kept for history in `chain/desk-preprod-v1.json`. Version 2 is a fresh deployment at a new address, made by the script above.

## Limits and next steps

- Maintainer credentials cannot be revoked yet (a Merkle tree only grows); rotation would add a revocation set of credential nullifiers.
- The tree holds 1,024 credentials (depth 10).
- Tell's off-chain check is a procedure, not code: the demo's five credentials share one owner.
- Anyone can seal a report about any project; nothing limits spam yet (a small fee, or a researcher credential in a second tree, would).
- The demo runs every role from one house wallet: registrations, seals, acknowledgements, the fix, the reveal and the grades are all submitted by the same wallet, seconds to minutes apart, so an observer sees one operator doing everything, and the five-credential anonymity set hides nothing from someone who notices that. In use, the researcher and the maintainer each run the client on their own device with their own private state and submit from separate wallets, or hand the proven transaction to a sponsor to pay the fee (see "Who submits" above).
- The anonymity claims hold only with more than one credential: an acknowledgement hides among the registered credentials, and with one it would say who answered. The `/desk` page shows the live count.
- A bounty escrow in unshielded tNIGHT, paid to the researcher on reveal, is not built: paying out needs the researcher's address on chain at the reveal, which would tie their wallet to the report; doing it privately needs a shielded payout.
