# Tell Desk

Private, provable responsible disclosure on Midnight, and a public registry of Tell's privacy grades.

Tell finds privacy leaks in Compact contracts. Telling a team about one is the delicate part: the finding is itself a secret until it is fixed, the researcher wants proof they found it first, and the team wants to answer without advertising that it has an open bug. Tell Desk is a Compact contract for exactly that, and it is where Tell records the grades it gives contracts, so wallets and dApps can read a contract's grade from the chain. The leak notes Tell sends buildathon teams are its first use: each finding sealed before it is sent, so the team's answer and fix are on record and the finding has a timestamp nobody has to take on trust.

| Path | What |
|---|---|
| [`contracts/desk.compact`](contracts/desk.compact) | the contract |
| [`src/`](src) | witnesses, a midnight-js client (seal, acknowledge, fix, reveal, attest), a public-state reader, an in-memory simulator |
| [`test/desk.test.ts`](test/desk.test.ts) | lifecycle, rejections, and an attacker who reads only public data |
| [`scripts/`](scripts) | compile, the demo's findings, and an offline dry run of the Preprod demo |
| [`../chain/scripts/deploy-desk.ts`](../chain/scripts/deploy-desk.ts) | deploys Desk with the house wallet and runs the demo lifecycle |

## How a disclosure goes

1. **Seal.** The researcher writes the report and seals it. The ledger stores `persistentCommit({digest, project}, nonce)` as the report id, a researcher tag, the seal time and the status `pending`. `digest` is SHA-256 of the report text; `project` is SHA-256 of the canonical repository URL. Both, and the 32-byte nonce, stay in the researcher's private state. The researcher sends the text and the opening to the maintainer off chain (Tell's private leak notes).
2. **Acknowledge.** The maintainer proves, in zero knowledge, that they hold the opening of this report and a maintainer credential registered for the project it commits to. Status becomes `acknowledged`. The proof shows neither the credential nor the project.
3. **Fix.** Same proof; status becomes `fixed`.
4. **Reveal.** Anyone holding the opening publishes it: once the report is fixed, or once the embargo (90 days on Preprod) has passed without a fix. The ledger then holds the digest, the project and the nonce. Anyone with the published text can check that it hashes to the digest and that the opening matches the seal, so the seal time proves the finding existed, in this exact form, then.
5. **Retract.** Before acknowledgement, the researcher can withdraw a report by proving the tag is theirs.

Grades: Tell's attester key registers maintainer credentials and records `code hash → grade, rules version, scan`. A registered maintainer can publish a grade for a contract of their own project; it is stored separately and flagged as self-reported. The code hash is SHA-256 over every circuit's name and verifier key, so a wallet can compute it from the contract state the indexer returns for any address ([`codeHashOfState`](src/view.ts)).

## What is public and what is private

Midnight gives every contract two ledgers: the public one, which everyone replicates, and private state, which stays on each user's device and enters only as witnesses to zero-knowledge proofs. Desk puts on the public ledger only what someone must be able to check without trusting anyone.

| Data | Where | Why |
|---|---|---|
| Report text | nowhere on chain; only its SHA-256, and only after reveal | the content is the secret |
| Report digest, project id, nonce | researcher's and maintainer's private state; public only on reveal | the opening of the seal |
| Report id = `persistentCommit({digest, project}, nonce)` | public | a hiding, binding commitment: the receipt that proves priority |
| Researcher secret | researcher's private state | authorship; never leaves the device |
| Researcher tag = `persistentHash("tell-desk:researcher", secret, id)` | public | lets the researcher prove a report is theirs (retract) without any stable identifier: every report's tag is different |
| Maintainer secret | maintainer's private state | the credential |
| Credential leaf = `persistentHash("tell-desk:maintainer", secret, project)` | public, as a leaf of a Merkle tree | registered once by Tell; hides both the secret and the project |
| Merkle path to the leaf | maintainer's device (built from the public tree) | a witness; only the root it leads to is disclosed |
| Seal time, last status change | public | the transaction's own block shows when it happened; the contract only checks the claimed time against block time |
| Status | public | the point of the desk: anyone can see a report was answered and fixed |
| Attester hash | public | officer key: `persistentHash("tell-desk:attester", secret)` |
| Grades | public | a registry; wallets read it |

Before a reveal, the ledger does not say which project a report is about. A public project id would have let teams find their reports on chain, but it would also announce "this project has an unfixed bug" to everyone else; the maintainer learns of the report from the off-chain note instead, and the chain shows only that some registered maintainer answered it.

## Every disclose(), justified

| Circuit | `disclose(…)` | What becomes public | Why it is safe |
|---|---|---|---|
| constructor | `attesterHash`, `embargoSeconds` | the attester's key hash, the disclosure policy | configuration, public on purpose |
| `stamp` (used by seal, acknowledge, markFixed, retract) | `now` | the caller's claimed time | the block already says when the transaction ran; the contract asserts `now ≤ block time < now + 2 h` |
| `proveMaintainer` | `merkleTreePathRoot(path)` | a root of the maintainer tree | every maintainer proving against the current tree gets the same root; it says "some registered maintainer", not which |
| `seal` | `sealOf(draft)` | the report id | a commitment with a fresh 32-byte nonce: hiding even to someone who guesses the exact text and project |
| `seal` | `researcherTag(secret, id)` | the tag | keyed by a 256-bit secret and different per report: unlinkable across reports |
| `acknowledge`, `markFixed`, `retract` | `id` | which report | an argument that is public already (the report id) |
| `reveal` | `id`, `opening` | digest, project and nonce of a fixed or expired report | the reveal step of a commit-reveal: publishing it is the point |
| `registerMaintainer` | `leaf` | a credential leaf | a hash of a 256-bit secret and the project |
| `attest`, `selfGrade` | code hash, grade, rules, scan (and project for self-grades) | a grade | a public registry; a self-report is a public claim, so it names its project |
| `handOver` | new attester hash | the next officer key | configuration |

No branch depends on a secret: the only `if`s test whether a public code hash already has a grade.

## Threat model

An attacker reads everything public: the ledger state and the public part of every transaction (circuit arguments, results and the public transcript). Tests in [`test/desk.test.ts`](test/desk.test.ts) play that attacker:

- **Linking reports to a researcher.** Tags are keyed hashes of the researcher secret and the report id. Two reports by one researcher share no public value at all, exactly like two reports by different researchers.
- **Recovering a report before reveal.** The digest appears nowhere in public data. The seal is a commitment with a 32-byte nonce, so even guessing the exact text and project does not match it.
- **Learning which project has an open report.** The project id appears nowhere in public data until the reveal.
- **Identifying the maintainer.** The maintainer secret never appears; acknowledgements carry neither the credential leaf nor the project. Two acknowledgements by one maintainer share only the tree root, which every maintainer's proof made at that time shares too (the client always proves against the latest root, so the root says when the proof was made, not who made it).
- **Forging.** A maintainer of another project, an unregistered one, or a dishonest prover passing someone else's tree path or an invented path cannot acknowledge. A wrong nonce, digest or project cannot reveal; nothing can be revealed twice, or before a fix while the embargo runs. Only the attester can attest, register or hand over.

What Desk does not hide:

- Timing. Transactions are public, so the seal, acknowledgement and fix times are visible, and a small anonymity set (few registered maintainers, few reports) makes timing correlation easier.
- Tell, as registrar, knows which credential leaf belongs to which project: it registered them after checking the maintainer controls the repository. It cannot see which leaf produced an acknowledgement.
- Who submits. Each transaction is balanced and submitted by some wallet; Desk does not hide which one. A researcher who wants no wallet tied to their seals can hand the proven transaction to someone else to pay for: the house wallet already has `sponsor()`, which attaches only a DUST fee to another party's proven transaction ([`chain/src/house.ts`](../chain/src/house.ts)). Wiring it to Desk is a next step.
- A self-reported grade states that a contract belongs to a project; the chain cannot check that claim, which is why it is flagged and kept apart from Tell's own grades.

## Tell scans its own contract

```
$ npx tsx engine/src/cli.ts desk/contracts/desk.compact
desk/contracts/desk.compact  grade A  compact 0.31.1, 9 circuits  25 info
```

Grade A with no suppressions: all 25 findings are info, each a circuit argument written on purpose (report ids, times, the reveal's opening, grades, the credential leaf). CI fails if anything at low or above appears. The contract compiles with Compact 0.31.1 (the ledger live today), 0.35.0 and 0.36.0.

## Tests

`npm test -w desk`: 33 tests in the simulator ([`src/simulator.ts`](src/simulator.ts)), which runs the compiled contract with a controllable block time and records the public part of every transaction.

- **Lifecycle (10):** seal; seal → acknowledge → fix → reveal with the reveal checked against the text; either side reveals; reveal after the embargo; retract; credentials survive later registrations; attestations and their scan order; self-reported grades; attester hand-over; canonical project ids.
- **Rejections (15):** a maintainer of another project, an unregistered one, a dishonest prover with someone else's tree path or an invented one, the opening of another report, out-of-order status changes, a wrong nonce, digest or project at reveal, a second reveal, a reveal under embargo, a duplicate seal, future or back-dated seal times, retraction by someone else, every attester circuit called by a non-attester, grades outside A to F, self-grade squatting.
- **Attacker (8):** listed under the threat model above, plus a control showing the attacker's scanner does find what is public.

`npm run dry-run -w desk` runs the Preprod demo offline: it loads the proving keys, computes Desk's code hash, grades the sources with the engine, runs the same lifecycle in the simulator and checks the revealed report against its text.

## Run it

```bash
compact update 0.31.1
npm install
npm run compact -w desk          # compile (no proving keys) for the simulator
npm test -w desk                 # lifecycle, rejections, attacker tests
npm run compact:keys -w desk     # proving keys, for a deploy (about 2 minutes)
npm run dry-run -w desk          # the Preprod demo, offline
TELL_NETWORK=preprod npm run deploy:desk -w chain   # needs chain/secrets (house wallet, Blockfrost)
```

## Limits and next steps

- Maintainer credentials cannot be revoked yet (a Merkle tree only grows); rotation would add a revocation set of credential nullifiers.
- Anyone can seal a report about any project; nothing limits spam yet (a small fee, or a researcher credential in a second tree, would).
- The demo runs every role from the house wallet. In use, the researcher and the maintainer each run the client on their own device with their own private state.
- A bounty escrow in unshielded tNIGHT, paid to the researcher on reveal, is not built: paying out needs the researcher's address on chain at the reveal, which would tie their wallet to the report; doing it privately needs a shielded payout.
