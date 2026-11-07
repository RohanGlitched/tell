# Draft note to Nightshade's author (not sent)

For the lead to edit and decide whether to send, for example as a GitHub discussion or issue on DicksonWu654/nightshade. Plain text below the line.

---

Hi Dickson,

I maintain Tell (github.com/RohanGlitched/tell), a privacy scanner for Compact that reads the compiler's `reduce-to-circuit` output and counts how many bits each public operation reveals. Nightshade is the most thorough Compact analyzer I have run, and I learned a lot from its documentation, in particular how carefully it separates complete from incomplete analysis.

I ran a small head-to-head benchmark of the Compact analyzers I could find (Nightshade 0.1.1 three ways, compact-guard, compact-lint, OpenZeppelin's detectors, Tell), and I would like to offer the corpus as a shared benchmark that both of us, and anyone else, can add to:

- `bench/cases`: 30 small contracts, each with its truth, class, circuit and line in a header comment (a small-domain hash bounded by an `assert` rather than its type, a hash of a public id with a small secret, constant and public commitment nonces, balanced and unbalanced branches, a published hash reused as a private key, `Set.member` against a Merkle `checkRoot`, a constructor leak, and a safe counterpart for each).
- Tell's leak zoo (`zoo/contracts`): leaky and fixed contract pairs whose leaks are carried out by attack tests that read the secret back from public state.
- The scoring script, the normalised output of every tool, and a hand label with a reason for every finding.

Everything is Apache-2.0 and lives in `bench/` of the Tell repository; `bench/README.md` explains how to reproduce it. I wrote the benchmark, which is a conflict of interest, so I also ran Tell on Nightshade's own published corpus (`tests/corpus`, drafts excluded) and reported those results as they came out, including Tell's misses and false alarms. Corrections to any label are very welcome, and I would happily take cases from you.

Some results that may be useful to you:

1. **A small-domain hash written as a Map value is not reported.** `low-entropy-hash-disclosure` reports `persistentHash<Uint<8>>(answer())` written to a Cell, but not the identical hash written as a Map value (`answers.insert(key, disclose(persistentHash<Uint<8>>(answer())))`, `bench/cases/L02-type-width-hash.compact`). The same happens with `persistentHash<Boolean>` (`L14-boolean-hash.compact`; a Cell probe is reported). It looks like the sink for Map values may not be wired into that rule.
2. **`publicly-derivable-encryption-secret` did not fire on `bench/cases/L16-public-digest-as-key.compact`**, a published `persistentHash([seed])` used as the scalar of `ecMulGenerator` and stored as a public key; the opt-in `published-digest-generator-scalar-review` did (info). It may be outside the rule's documented scope; I could not tell from the catalog.
3. **Exported circuit results.** Nightshade's `exported-shielded-descriptor` treats an exported circuit's result as an application output that is "not necessarily a public ledger". I checked, and you were right where Tell was wrong: a ledger `ContractCall` carries only a communication commitment (a randomized commitment to the inputs and outputs), not the result. Tell now rates returned values low, and the benchmark case that assumed otherwise was relabelled.

4. **Three of your corpus negatives publish a secret.** Tell, run on `tests/corpus`, reports a secret written in the clear in `known-bugs/bboard-published-preimage-lookalike.compact` (line 55, `leaked = disclose(localSecretKey())`), `safe/distinct-witness-calls.compact` (line 12) and `safe/separate-branches.compact` (line 14). I understand they are negatives for `ledger-bound-preimage-publication` only, as your corpus README says; mentioning it in case a comment in those files would help other readers. Tell's full results on your corpus, with a label and reason for every medium-or-worse finding, are in `bench/labels/nightshade-corpus.md`, including Tell's own false alarms.

If a shared benchmark is interesting to you, I would suggest a neutral repository (or a directory in either project) with one contract per case, a machine-readable truth header, and a runner that each tool plugs into. I am glad to do the work of moving it and keeping Tell's runner in line with yours.

Thanks for building Nightshade and documenting it so carefully.

Rohan
