# Results: Compact privacy benchmark, November 7, 2026

Seven configurations of five tools, run on 69 Compact files: Tell's leak zoo (10), 30 cases written for this benchmark, and 29 contracts from Midnight's official examples. How the corpus, the ground truth and the scoring work is in [README.md](README.md); every number below comes from `node bench/score.mjs` over the files in [`results/`](results), and the full per-file matrix is in [`results/scores.md`](results/scores.md).

**Read this first.** Tell's author wrote this benchmark, the zoo is Tell's own development set, and the 30 cases were written knowing what Tell looks for (one case class, L16, was taken from a Nightshade rule). Treat the labelled-set numbers as "does each tool handle these patterns", not as a population accuracy. The examples set has no planted leaks and is the less biased half. Each tool also covers things this benchmark does not measure: Nightshade has 96 rules, most of them about authorization, tokens, Merkle proofs and time, not privacy.

## Tools

| Tool | Version | What it is |
|---|---|---|
| [Tell](https://github.com/RohanGlitched/tell) | 0.1.0 (`d3a9104`) | privacy scanner over the compiler's `reduce-to-circuit` output; counts bits |
| [Nightshade](https://github.com/DicksonWu654/nightshade) | 0.1.1 (release tarball) | offline static analyzer, 96 rules, several about disclosure; run three ways: default, every rule that needs no policy, and default plus a secrets policy |
| [compact-guard](https://github.com/KAMEVETRICS/compact-guard) | 0.1.0, `152b05d` | tree-sitter analyzer with provenance tracking, rules CG001–CG008 |
| [compact-lint](https://github.com/wbaxterh/compact-lint) | 0.1.0, `812a6cc` | one rule: a witness Merkle path not bound to its leaf |
| [OpenZeppelin Compact Security Detectors](https://github.com/OpenZeppelin/compact-security-detectors-sdk) | `compact-scanner` v0.0.3 binary | two detectors: loop array bounds, verbose assertion messages |
| [midnight-expert `/audit-compact`](https://github.com/midnightntwrk/midnight-expert) | `212d7c2` | not run (needs a paid model), see below |

Run time over all 69 files, one file at a time on a shared WSL machine: Tell 594 s (it compiles every file with the Compact compiler), Nightshade 71–116 s, compact-guard 13 s, compact-lint 3 s, OpenZeppelin 1 s.

## Labelled set: 21 planted leaks, 18 safe files, 1 non-privacy bug

### Medium and above

| Tool | Leaks found | False alarms | Safe files with no false alarm | Leak quantified | Leak read back by a shipped attack test |
|---|---|---|---|---|---|
| Tell | **16 / 21** | 1 | 18 / 19 | 14 of 16 (bits) | 5 (zoo, 10/10 tests pass) |
| Nightshade, default | 3 / 21 | **0** | **19 / 19** | 1 of 3 (domain size) | 0 |
| Nightshade, every rule | 3 / 21 | 0 | 19 / 19 | 1 of 3 | 0 |
| Nightshade, secrets policy | 13 / 21 | 9 | 14 / 19 | 1 of 13 | 0 |
| compact-guard | 4 / 21 | 1 | 18 / 19 | 4 of 4 (domain size) | 0 |
| compact-lint | 0 / 21 | 0 | 19 / 19 | n/a | 0 |
| OpenZeppelin detectors | 0 / 21 | 0 | 19 / 19 | n/a | 0 |

"Safe files" counts the 18 safe files plus N01, which is privacy-safe. compact-lint and the OpenZeppelin detectors are not privacy tools; they are here because they are the other Compact analyzers people use, and compact-lint is the only tool that reports N01 (its bug class) at error severity.

### All severities (low and info included)

| Tool | Leaks found | False alarms | Findings in total |
|---|---|---|---|
| Tell | 19 / 21 | 2 | 55 |
| Nightshade, default | 3 / 21 | 0 | 6 |
| Nightshade, every rule | 4 / 21 | 0 | 19 |
| Nightshade, secrets policy | 13 / 21 | 9 | 29 |
| compact-guard | 7 / 21 | 1 | 14 |
| compact-lint | 0 / 21 | 0 | 1 |
| OpenZeppelin detectors | 0 / 21 | 0 | 0 |

### Per case, medium and above

`TP` = the planted leak found (with severity); `low`/`info` = found only below medium; `FP` = false alarm; `-` = nothing. NS = Nightshade.

| Case | What leaks | Tell | NS default | NS policy | compact-guard |
|---|---|---|---|---|---|
| zoo ballot | hash(choice), choice asserted < 4 (2 bits) | TP critical | - | TP high | TP medium |
| zoo payband | hash(public id, salary) | TP critical | - | TP high | - |
| zoo reserve | branch: which set is written | TP medium | - | TP high | - |
| zoo board | the same author tag on every post | TP medium | - | - | - |
| zoo vault | secret key written to the ledger | TP critical | - | TP high | - |
| L01 | hash of a Uint<64> asserted < 10 | TP critical | - | - | - |
| L02 | hash of a Uint<8> into a Map value | TP critical | - | - | TP medium |
| L03 | hash(public id, income < 1,000,000) | TP critical | - | - | - |
| L04 | commitment with a constant nonce | TP critical | TP medium | TP medium | low |
| L05 | commitment with a public ledger counter as nonce | TP critical | - | - | low |
| L06 | different counter per branch side | low | - | TP high | - |
| L07 | the same tag on every check-in | TP medium | - | - | - |
| L08 | `degradeToTransient(key)` stored | TP medium | - | TP high | - |
| L09 | secret returned from an exported circuit | TP critical | - | TP high | - |
| L10 | count of passing scores in a fixed loop | low | - | TP high | - |
| L11 | `Set.member(hash(key))` in an "anonymous" claim | info | - | - | - |
| L12 | constructor writes a secret | - | - | TP high | - |
| L13 | secret checked against a stored hash, then published | TP critical | TP medium | TP high | - |
| L14 | hash of a Boolean into a Map value | TP critical | - | - | TP medium |
| L15 | hash of a Uint<8> into a Cell | TP critical | TP medium | TP medium | TP medium |
| L16 | published hash reused as a private scalar | - | - (info with every rule) | TP high | low |
| S05 | same operation on both branch sides | info FP | - | FP high ×2 | - |
| S07 | one hashed key per device | FP medium | - | - | - |
| S10, zoo board fixed | Merkle `checkRoot` membership | - | - | FP high ×2 each | - |
| S13 | separate hash domains for id and key | - | - | FP high | - |
| zoo ballot fixed | salted commitment | - | - | - | FP medium (pure helper) |
| N01 | Merkle path not bound to its leaf (not privacy) | - | info | FP high ×2 | low (correct, CG005) |

Safe files not listed (S01–S04, S06, S08, S09, S11, S12 and the other fixed zoo contracts) have no false alarm at medium or above from any tool. Every label, with its reason, is in [labels/labelled-set.md](labels/labelled-set.md).

## Midnight's examples: 29 contracts, hand-labelled

| Tool | Analysis complete | Findings, medium+ | Real privacy leak | Intended disclosure | Real, not privacy | False alarm | Findings, all severities |
|---|---|---|---|---|---|---|---|
| Tell | 26 / 29 | 2 | 1 | 0 | 0 | 1 | 157 |
| Nightshade, default | 19 / 29 | 0 | 0 | 0 | 0 | 0 | 7 |
| Nightshade, every rule | 3 / 29 | 31 | 0 | 0 | 6 | 25 | 94 |
| Nightshade, secrets policy | 19 / 29 | 59 | 2 | 51 | 0 | 6 | 66 |
| compact-guard | 29 / 29 | 6 | 0 | 3 | 0 | 3 | 81 |
| compact-lint | 29 / 29 | 0 | 0 | 0 | 0 | 0 | 0 |
| OpenZeppelin detectors | 22 / 29 | 0 | 0 | 0 | 0 | 0 | 0 |

One distinct real privacy leak was found at medium or above, by two tools: the election example's `revealVote` puts the voter's registered key and the counter for their choice in the same transaction, so every revealed vote is tied to its voter. Tell (branch, medium) and Nightshade with a secrets policy (declared-secret-publication, high) both report it. Every finding and its reason is in [labels/examples.md](labels/examples.md).

Coverage notes:

- **Nightshade 0.1.1 does not accept `pragma language_version 0.28`** (compiler 0.36.0, released Nov 4). The 14 contracts under `examples/` were scanned as language 0.27 under the 0.35.0 profile, marked `adjusted`; all 14 completed. The 10 incomplete contracts are all in `experimental/q2-ledger9`: dynamic cross-contract calls and the new secp256k1 types are not modelled yet, and Nightshade says so instead of reporting a clean result.
- With every rule selected, Nightshade marks 26 of 29 examples (and most of the labelled set) incomplete: the opt-in review rules report missing evidence. That is its documented behaviour, not a crash.
- **Tell could not analyse 3 experimental contracts** because Compact 0.36.0 rejects them (`AxelarGateway`: duplicate binding of `mint_token`; `recover-secp`: unbound type `Secp256k1EcdsaSignatureWithRecovery`; `SelfRecursion`: type cycle). Tell only analyses what the compiler accepts.
- The OpenZeppelin binary panics on 7 of 29 examples (unhandled `ERROR` nodes, `Opaque<"string">`, a binary-expression type mismatch); its grammar predates current Compact.
- compact-guard and compact-lint complete everything (tree-sitter, no compiler).

## Where Tell does better

- **Small-domain hashes that are not small by type.** L01 (a Uint<64> asserted below 10), L03 and zoo payband (a public id hashed with a small secret) are found only by Tell, which reads `assert` bounds and discounts inputs that are public in the same call. Nightshade's `low-entropy-hash-disclosure` and compact-guard's CG002 use the declared type's domain (at most 65,536 values for both), do not read `assert` bounds, and do not count a circuit argument disclosed in the same call as known; Nightshade's rule also leaves hashes with more than one private input out of scope, as its documentation says.
- **Hashes stored as Map values.** L02, L14 and zoo ballot write a small-domain hash with `Map.insert`. Nightshade's low-entropy rule reports `persistentHash<Uint<8>>(answer())` written to a Cell (L15) but not the identical hash written as a Map value (L02); the same happens with `persistentHash<Boolean>` (reported into a Cell in a separate probe, not into a Map value in L14). compact-guard handles both.
- **A commitment whose nonce is public but not constant** (L05, a ledger counter): Tell critical; compact-guard reports it at review level (CG003, "constant or public ledger data"); Nightshade's `predictable-commitment-randomness` covers constant randomness only, as documented.
- **The same tag on every action** (L07, zoo board): only Tell.
- **Numbers.** 14 of Tell's 16 medium-or-worse detections state how much leaks, in bits (2 bits for a vote among four, 20 bits for an income below a million). compact-guard states a domain bound for its 4 detections (2^8); Nightshade does for one (256 values).
- **Shown, not only reported.** The five zoo leaks are carried out by attack tests that read the secret back from public ledger state, and the fixes stop them: `npm test -w zoo` passes 10 of 10. No other tool ships exploit tests (Nightshade's generated testing checks the analyzer itself, "not an exploit generator").
- **Few findings to read on real code.** On the examples Tell gives 2 findings at medium or above, one of them the only real leak found; 155 more are low or info (mostly "argument published on purpose" and tag notes).

## Where the others do better

- **Constructors.** L12 (a constructor writing a secret) is found only by Nightshade with a secrets policy. Tell does not analyse constructors yet; its README says so.
- **A published hash reused as a private key** (L16). Nightshade has a rule written for this class (`publicly-derivable-encryption-secret`, default-on, which did not fire on this case; its opt-in `published-digest-generator-scalar-review` did, at info) and its policy run reports it high. compact-guard's CG006 points at the missing domain separation (low). Tell reports nothing.
- **Branches when nothing identifies the caller** (L06, L10). Tell rates these low on purpose (an anonymous tally is fine). Nightshade with a policy reports both as high. If the transaction itself identifies the caller, Tell's rating is too low; see [GAPS-FOR-TELL.md](GAPS-FOR-TELL.md).
- **Precision of the default configuration.** Nightshade's default selection raised no false alarm at medium or above on any of the 69 files, and none at any severity on the labelled set (low and info findings on the examples were not labelled). compact-lint and OpenZeppelin also raised none, but they also report little. Tell raised one false alarm at medium (S07: a per-device key tag read as "the same tag on every action") and one at info (S05).
- **Things that are not privacy.** Nightshade reports that the leaked vault key and the L12 admin secret let anyone pass the owner check (`spoofable-authorization`); compact-lint (error), compact-guard (CG005) and Nightshade (info) report N01's unbound Merkle path. Tell is silent on all of these, by design. On the examples, Nightshade's opt-in rules find 6 true non-privacy observations (unbounded mints in demo token contracts) among 31 findings.
- **Running without a compiler.** Every other tool works from source text and takes about a second per file or less; Tell needs the Compact compiler the contract's pragma asks for, and cannot analyse code the compiler rejects.

## What costs precision

- **Nightshade with a secrets policy** finds the most planted leaks after Tell (13 of 21) and is the only tool to catch L12, but a generic policy ("every witness is secret; hashes and commitments are allowed") produces 9 false alarms on the labelled set (Merkle `checkRoot` membership, a balanced branch, a public key derived from a separate hash domain) and 51 findings on the examples that are disclosures the contracts make on purpose. Policies written per contract would cut both; that is the trade-off Nightshade documents.
- **Nightshade with every rule** adds review rules aimed at nullifiers, access-control conventions, time and mint caps. On the examples, 25 of its 31 medium findings are false alarms (blacklist and game checks read as nullifiers, a bid amount read as a time, a burn address read as a default recipient).
- **compact-guard** has 3 false alarms in 6 medium findings on the examples (an `ownPublicKey()` refund address read as authorization; a PIN hash that is hashed again with a 256-bit secret) and one on the labelled set (an exported pure helper that is never called on chain).

## Not run: midnight-expert `/compact-core:audit-compact`

Midnight's official `midnight-expert` repository ships `/compact-core:audit-compact`, an LLM command: it compiles the contract with `compact compile --skip-zk`, dispatches one `security-reviewer` agent that walks a threat catalog (privacy leakage among its categories) and a witness trust-boundary reference, then confirms Critical and High findings mechanically with its `midnight-verify` step. It needs a paid model to run, so it is not scored here. Its answers vary between runs and models, which is what deterministic tools avoid; on the other hand it can reason about intent ("this disclosure is the documented reveal step"), which is where every static tool here, Tell included, loses precision.

## One thing worth a second look

Tell (info) and Nightshade with every rule (`exported-shielded-descriptor`, info) both show that `shielded-chips/chips.compact`'s exported `mint` returns the minted coin's `ShieldedCoinInfo`, nonce included, while the source says the nonce "is never published, which is what keeps the recipient private". Whether that return value is public depends on how exported results are exposed, which the two tools model differently. Unconfirmed; details in [labels/examples.md](labels/examples.md).

## Reproduce

```bash
npm ci && compact update 0.31.1 && compact update 0.36.0
bash bench/install.sh
node bench/run.mjs
node bench/score.mjs
```
