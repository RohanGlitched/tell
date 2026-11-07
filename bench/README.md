# Compact privacy benchmark

A head-to-head run of the static analyzers that exist for Midnight's Compact language, on a labelled corpus, with the scoring and every hand label in the open. Results and the narrative are in [RESULTS.md](RESULTS.md); rules other tools have that Tell lacks are in [GAPS-FOR-TELL.md](GAPS-FOR-TELL.md).

Written by Tell's author. That is a conflict of interest, so everything needed to check or overturn a number is here: the corpus, the ground truth, each tool's raw-normalised output, the label for every finding with the reasoning, and one command to run it all again.

## Tools

| Tool | Version run | Source | How it was run |
|---|---|---|---|
| [Tell](https://github.com/RohanGlitched/tell) | 0.1.0 at this commit | this repository | `npx tsx engine/src/cli.ts <file> --json --no-policy`, and with `--policy bench/policies/tell.json` (runs the Compact compiler its pragma asks for) |
| [Nightshade](https://github.com/DicksonWu654/nightshade) | 0.1.1 | release tarball `nightshade-compact-0.1.1.tgz` (sha256 `fee7af6c…a3d6`) | three configurations, below |
| [compact-guard](https://github.com/KAMEVETRICS/compact-guard) | 0.1.0, commit `152b05d` (Oct 19, 2026) | source build (no releases) | `compact-guard --format json --fail-on none <file>`, all eight rules |
| [compact-lint](https://github.com/wbaxterh/compact-lint) | 0.1.0, commit `812a6cc` (Oct 1, 2026) | source (no dependencies) | `compact-lint --json <file>` |
| [OpenZeppelin Compact Security Detectors](https://github.com/OpenZeppelin/compact-security-detectors-sdk) | `compact-scanner` release v0.0.3 (reports 0.0.2) | release binary (binary sha256 `7e076e23…f4b8`, the same binary Nightshade's evaluation used) | `compact-scanner scan <file>`, both detectors |
| [midnight-expert `/audit-compact`](https://github.com/midnightntwrk/midnight-expert) | commit `212d7c2` | not run | an LLM review command; running it needs a paid model. See RESULTS.md |

Nightshade is run three ways so that no setting the author documents is left out:

- `nightshade`: the default `audit` selection, what a user gets out of the box.
- `nightshade-all`: every registered rule that runs without a policy (opt-in review rules included) plus the `hygiene` profile.
- `nightshade-policy`: the default selection plus a secrets policy declaring every witness of the file secret, with `hash` and `commitment` as allowed forms. This is the shape of Nightshade's own shipped example (`examples/review/secret-policy.json`) and enables its `declared-secret-publication` rule, which needs declared intent.

Nightshade 0.1.1 has profiles up to compiler 0.35.0 (language 0.27). Midnight's examples now declare `pragma language_version 0.28` (compiler 0.36.0, released Nov 4, 2026), which Nightshade rejects as unsupported. For those files the benchmark scans a copy with the pragma set to `0.27` under the 0.35.0 profile and marks the result `adjusted`; nothing else in the file is changed. The other tools do not check pragmas.

The OpenZeppelin SDK cannot be built from source today: its `tree-sitter-compact` submodule (`github.com/midnight-ntwrk/tree-sitter-compact`) is no longer public. Its v0.0.3 release binary is used instead.

## Corpus

| Set | Files | Ground truth |
|---|---|---|
| Tell's leak zoo (`zoo/contracts`) | 10 leaky, 10 fixed | each leaky contract has one leak, carried out by an attack test in `zoo/test/` (`attacks`, `deploy-tokens`, `linking`); the fixes have none (`truth.json`) |
| Bench cases (`bench/cases`) | 15 leaky, 13 safe, 1 non-privacy bug, 1 not-public value | written for this benchmark; truth, class, circuit and line in each file's header. All compile under Compact 0.31.1. L09 was relabelled `not-public` on Nov 7 (a circuit's result is not on chain) |
| Midnight's examples ([midnightntwrk/midnight-examples](https://github.com/midnightntwrk/midnight-examples) at `377495c`) | 29 contracts in `examples/` and `experimental/q2-ledger9` | no planted truth: every medium-or-worse finding from every tool is labelled by hand in `labels/examples.md` |

`zk-loan/contract/schnorr.compact` is a module imported by `zk-loan.compact`, not a contract, so it is scanned through its importer. `packages/mnkit` holds templates and copies of the examples and is left out.

The bench cases target what a privacy scanner has to get right: a small-domain hash bounded by an `assert` versus by its type; a hash of a public id with a small secret; a commitment with a constant or a public nonce; a branch with a different ledger operation on each side versus the same operation on both; one tag on every action versus a fresh tag; a cast mistaken for a hash; a secret returned from a circuit; a count leaked in a fixed loop; `Set.member` versus a Merkle `checkRoot`; a constructor leak; a secret checked against a stored hash and then published; a published hash reused as a private key; and a safe counterpart for each. `N01` is a Merkle path not bound to its leaf: a real soundness bug that is not a privacy leak, included so that tools covering other bug classes are shown doing so.

## Scoring

- A finding **finds the leak** (TP) when it comes from a rule about privacy and sits in the circuit that holds the planted leak (the body of that circuit or constructor). Findings from rules about other things (authorization, domain separation, Merkle binding, loop bounds) never count as finding a privacy leak, but they are labelled and reported.
- Every other finding is labelled by hand: `real-privacy` (a real disclosure beyond the planted one), `intended` (a correct observation of a disclosure the contract makes on purpose and documents), `real-other` (a real issue that is not about privacy), or `false-alarm`. The reason for each is in `labels/*.md`, the labels in `labels/labels.json`.
- **FP** counts `false-alarm` findings only. Scores are given for medium-and-above and for all severities. Severity maps: compact-guard and compact-lint `error` = high, `warning` = medium, `review` = low; Nightshade, Tell and OpenZeppelin use their own levels.
- **Quantified**: the finding states how much is revealed (bits, a domain size, a number of guesses).
- **Shown by a shipped attack test**: a test in the tool's repository reads the secret back from public state. Only Tell's zoo has these; the bench cases have none.

## Reproduce

Linux x86-64 or WSL, Node 22 or 24, git, curl, python3, and the Compact toolchain (`compact` devtools) with compilers 0.31.1 and 0.36.0 for Tell.

```bash
npm ci                                   # Tell's own dependencies
compact update 0.31.1 && compact update 0.36.0
bash bench/install.sh                    # pinned tools into bench/.tools, examples into bench/.corpus
node bench/run.mjs                       # every tool on every file -> bench/results/<tool>.json
node bench/score.mjs                     # -> bench/results/scores.md and scores.json
```

Tell runs in two configurations: `tell` (`--no-policy`, inference only) and `tell-policy` (with [`policies/tell.json`](policies), intent stated in a file's header that Tell cannot infer). `NIGHTSHADE_REPO=bench/.tools/nightshade-src node bench/nightshade-corpus.mjs` runs Tell on Nightshade's own published regression corpus (`tests/corpus`, drafts excluded) and writes `results/nightshade-corpus.json`; its hand labels are in [`labels/nightshade-corpus.md`](labels/nightshade-corpus.md).

`node bench/run.mjs --tools compact-guard --sets cases` reruns one tool on one set; results for other sets are kept. `node bench/score.mjs --todo` lists findings that have no hand label yet (a new tool version can produce new ones). Tools run one file at a time; nothing contacts a network after installation, and nothing needs an account or a paid service.
