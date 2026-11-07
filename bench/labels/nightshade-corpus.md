# Labels: Tell on Nightshade's published corpus

Nightshade's 300-root evaluation set is private: its `docs/evaluation.md` says "the assembled input set and per-source results are private and unavailable for reproduction". What Nightshade does publish is its regression corpus, `tests/corpus` in [DicksonWu654/nightshade](https://github.com/DicksonWu654/nightshade) at `9ef4aea` (Oct 24, 2026): synthetic positive, corrected and look-alike programs that its author labelled for individual Nightshade detectors, plus copies of Midnight examples with planted bugs. Tell's author wrote none of it, which is the point of this run. `drafts/` (work in progress, not registered in a manifest) was left out.

Command: `NIGHTSHADE_REPO=<clone> node bench/nightshade-corpus.mjs` (Tell `d62e618`, `--no-policy`, one file at a time). Raw output: [`../results/nightshade-corpus.json`](../results/nightshade-corpus.json), with Nightshade's own labels for each file attached.

## Coverage

| | Files |
|---|---|
| Contract files (with a `pragma`; modules are scanned through their importers) | 465 |
| Analysed | 443 |
| Compiler rejected | 22, all for a missing OpenZeppelin Compact library (`access/Ownable.compact`, `security/Pausable.compact`, `token/NonFungibleToken.compact`, `security/Initializable.compact`), which Nightshade's tests supply and a plain scan does not |
| Tell crashed or timed out | 0 |
| Analysed with a compiler form Tell treats conservatively | 30 (`cast-to-field`, Compact 0.36; the value flows through unchanged) |

Run time 3,275 s, about 7 s per file, on a shared WSL machine (Tell compiles every file).

## Findings

847 in all: 11 critical, 6 high, 13 medium, 90 low, 727 info. The 30 at medium or above are in 21 files; every one is labelled below.

| Label | Count |
|---|---|
| real privacy issue | 23 (9 of them the caller's wallet key written to the ledger, in Nightshade's authorization test cases) |
| intended disclosure | 4 |
| false alarm | 3 |

## Nightshade's own privacy cases

Nightshade labels 41 files for its privacy rules (`ledger-bound-preimage-publication`, `declared-secret-publication`, `low-entropy-hash-disclosure`, `publicly-derivable-encryption-secret`, `published-digest-generator-scalar-review`, `exported-shielded-descriptor`): 14 positives and 27 corrected, look-alike or safe programs.

- **Positives: Tell reports 9 of 14 at medium or above.** The 5 it does not are all a value *returned* from an exported circuit (`vulnerable/exported-return`, `full-slice`, `numeric-cast`, `counter-exported-shielded-descriptor-positive`, `privacy16/shielded-result-return/positive`). Tell reports each at low or info, on purpose: a circuit's result is not on chain (see GAPS-FOR-TELL.md item 5), and Nightshade's own `exported-shielded-descriptor` documentation calls it an application output, "not necessarily a public ledger". By the on-chain standard Tell uses, these are not misses; by Nightshade's (a declared secret leaving the circuit), they are.
- **The three new rules on someone else's cases.** `derivable-secret` fires on all three Nightshade positives for its class (`library-public-encryption-secret-positive`, `privacy16/account-key-domain/positive`, `privacy16/public-scalar-seed21/positive`) and reports nothing at medium or above on their six corrected and look-alike programs.
- **Negatives: Tell is quiet on 24 of 27.** On the other 3 it reports a secret published in the clear, and in each case that is true; Nightshade's corpus README says a negative "means quiet for the named detector; it does not establish that the entire program is secure":
  - `known-bugs/bboard-published-preimage-lookalike.compact` line 55, `leaked = disclose(localSecretKey())`: the look-alike calls the witness a second time instead of reusing the checked value, which is out of scope for the preimage rule, but it still writes the owner's secret key to the ledger.
  - `safe/distinct-witness-calls.compact` line 12: the same shape for a `Field` credential checked against `ownerHash`. An honest prover's second call returns the same value, so the credential that guards `ownerHash` is published.
  - `safe/separate-branches.compact` line 14: the secret is checked in one branch and published in the other; whenever the second branch runs, the owner's secret is on the ledger.

## Every finding at medium or above

| # | File | Tell finding | Label | Reason |
|---|---|---|---|---|
| 1 | known-bugs/bboard-declared-secret-positive | secret-published critical, line 47 | real-privacy | `diagnosticKey = disclose(localSecretKey())`; Nightshade's positive. |
| 2 | known-bugs/bboard-published-preimage-lookalike | secret-published critical, line 55 | real-privacy | The secret key itself is written (see above). |
| 3 | known-bugs/bboard-published-preimage-positive | secret-published critical, line 55 | real-privacy | Nightshade's positive. |
| 4, 6, 8 | known-bugs/counter-native-key-gate-{corrected,lookalike,positive} | secret-published high, constructor line 11/12 | false-alarm | `secretOwnerCommitment = disclose(secretCommitment)`: a commitment, read as a secret key because its name contains "secret". |
| 5, 7 | known-bugs/counter-native-key-gate-{lookalike,positive} | published medium, line 16 | real-privacy | `posterPk = disclose(ownPublicKey().bytes)`: the caller's wallet key on the ledger ties their transactions together. |
| 9 | known-bugs/counter-small-domain-hash-positive | guessable-hash high, line 30 | real-privacy | `persistentHash<Boolean>(choice)`: two hashes recover it. Nightshade's positive (high, not critical, because `choice` is a circuit argument). |
| 10 | known-bugs/library-public-encryption-secret-positive | derivable-secret critical, line 13 | real-privacy | Nightshade's positive for `publicly-derivable-encryption-secret`. |
| 11 | safe/distinct-witness-calls | secret-published high, line 12 | real-privacy | See above. |
| 12 | safe/separate-branches | secret-published critical, line 14 | real-privacy | See above. |
| 13, 15 | synthetic-regressions/auth16/spoofable-authorization-case-1-{corrected,lookalike} | linkable medium ("which member made each call"), line 72/73 | intended | `roleMembers.member(disclose(accessControlIdentity()))` is a role check: naming which role member acted is the design. Tell exempts officer fields by name (`admins`, `owner`, …) but not `roleMembers`. |
| 14, 16–20 | synthetic-regressions/auth16/spoofable-authorization-case-1-lookalike | published medium, lines 68–102 | real-privacy | `routedPublicKey = disclose(ownPublicKey().bytes)` in six circuits. |
| 21 | synthetic-regressions/auth16/spoofable-authorization-case-1-positive | published medium, line 45 | real-privacy | `roleMembers.member(disclose(ownPublicKey().bytes))`: the wallet key in a public lookup. |
| 22 | synthetic-regressions/privacy16/account-key-domain/positive | derivable-secret critical, line 18 | real-privacy | Nightshade's positive for `published-digest-generator-scalar-review`. |
| 23 | synthetic-regressions/privacy16/public-scalar-seed21/positive | derivable-secret critical, line 48 | real-privacy | Same. |
| 24 | synthetic-regressions/state16/resettable-list-nonce-case-18-recipient-mixed-seed-lookalike | guessable-hash high, line 18 | intended | The memo index is the only unknown input of `evolveNonce`, but the source discloses it explicitly; recovering it reveals nothing the contract hides. |
| 25 | synthetic-regressions/state16/resettable-list-nonce-case-18-recipient-other-reset-lookalike | shielded-coin medium, line 19 | real-privacy | `mintShieldedToken(…, evolveNonce(memoIndex, constant), recipient)`: the nonce is public, so the recipient can be confirmed against candidate keys (MIP-0011's "recipient-public" mint). |
| 26 | same file | branch medium, line 12 | intended | Which kernel path runs depends on whether the recipient is a user or a contract; the source discloses the recipient. |
| 27 | vulnerable/declared-secret | secret-published critical, line 6 | real-privacy | `published = disclose(forward(secret()))`; Nightshade's policy example. |
| 28–30 | vulnerable/{direct,early-disclose,interprocedural} | secret-published critical | real-privacy | Nightshade's positives for `ledger-bound-preimage-publication`. |

## What this run taught

- The three false alarms are one name heuristic: `secretCommitment` matches "secret". Fixed after the run (a name that also says commitment, hash, digest, tag or public is not read as a secret key; `engine/test/fixtures/src/case-secret-names.compact`); re-scanning the three files, the constructor finding is gone in each, and what remains at medium (in two of them) is the wallet-key finding labelled real above.
- Role sets: `roleMembers` should count as an officer field for the membership-lookup rule. Not changed yet; recorded here.
- Returned values: Nightshade and Tell now agree that a result is not on chain; they differ on whether a secret leaving the circuit to the DApp should rate high. Tell rates it low and says why.
- A byte-slice of a secret (`full-slice`) produces one low finding per byte (32), which is noise; grouping projections of one value into one finding is on the list.
