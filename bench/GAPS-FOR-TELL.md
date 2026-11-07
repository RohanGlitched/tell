# Gaps for Tell, from the benchmark

Privacy issues that another tool reported and Tell missed or underrated in the first run (Tell `d3a9104`, Nov 7, 2026), what was done about each, and the evidence. Cases are in `cases/` and `../zoo/contracts`; numbers in [RESULTS.md](RESULTS.md). The engine changes are in `engine/src/analyze.ts` and `engine/src/policy.ts`; their tests in `engine/test/gaps.test.ts`.

## Status

| # | Gap | Status | Where it shows |
|---|---|---|---|
| 1 | Constructors not analysed (L12) | **closed** by the Wave 3 engine (constructor analysis landed before this pass) | L12: TP critical |
| 2 | Published hash reused as a private scalar (L16) | **closed**: new rule `derivable-secret` (critical) | L16: TP critical; S13 quiet; zoo `keyring` pair with an attack test |
| 3 | Branches in circuits that name no caller (L06, L10) | **kept at low, on evidence**, with the reasoning in the finding text and README Limits; a policy can raise them | L06, L10: low (FN at medium, by decision) |
| 4 | Hashes of a secret with no domain or contract tag | **closed**: low with no separator and no contract address; a note with a separator only | `engine/test/fixtures/src/case-cross-link.compact` |
| 5 | Shielded coin nonce reaching a circuit result | **closed as not a leak, on evidence**: a circuit's result is not on chain. Tell's own rating of returned values was wrong and is fixed; L09 relabelled | chips `mint` no longer reported; L09 now `not-public` |
| 6 | Declared intent (a policy file) | **closed**: `tell.json` / `.tellrc.json`, used by the CLI, the Action and the MCP tools | S07 quiet with a one-line policy (`tell-policy` row); S05 fixed without one |
| - | `Set.member(hash(key))` in an "anonymous" claim (L11; no tool caught it) | **closed**: medium | L11: TP medium; zoo `club` pair with an attack test |

## 1. Constructors

- **Case:** `cases/L12-constructor-leak.compact` (`admin = disclose(adminSecret())` in the constructor).
- **Status:** found at critical by the current engine (`secret-published`, constructor line: a 32-byte secret-named witness written as-is), which reads the constructor from the compiler's `drop-safe-casts` pass and lowers it to the same guarded bindings. Nothing was added in this pass; the old run predates that engine.

## 2. A published hash used as a private key

- **Case:** `cases/L16-public-digest-as-key.compact`; safe counterpart `S13-separate-key-domain.compact`.
- **Rule (`derivable-secret`, critical):** `ecMulGenerator(k)` makes a public key with private key `k`. When every private input of `k` reaches it only through values the contract publishes (a hash written to the ledger, or a public function of one, such as `hash("enc", id)` with `id` published) and nothing secret is mixed in, and the resulting public key reaches a public output, anyone holds the private key.
- **Look-alikes that stay quiet** (tested): the secret itself as the scalar while only its hash is published; differently tagged hashes for the id and the scalar (S13); a verification step `ecMul(pk, c)` with a public challenge; a public key returned rather than published.
- **A precision fix it needed:** fingerprints of nested one-way functions were inherited, so publishing `ecMulGenerator(hash(s))` counted as publishing `hash(s)`. A one-way function of a hidden value now has its own fingerprint.
- **Scope, honestly:** only `ecMulGenerator` (key generation). `ecMul(P, s)` with a public `s` is normal in signature verification and is not reported. A published hash reused as the preimage of an authorisation hash elsewhere would need to know that two witnesses return the same value, which static analysis cannot see.
- **On someone else's cases:** run on Nightshade's published corpus, the rule fires on all three of Nightshade's positives for this class (`library-public-encryption-secret-positive`, `privacy16/account-key-domain/positive`, `privacy16/public-scalar-seed21/positive`) and reports nothing at medium or above on their six corrected and look-alike programs ([labels/nightshade-corpus.md](labels/nightshade-corpus.md)).
- **Zoo:** `keyring-leaky` / `keyring-fixed`, with `zoo/test/linking.test.ts` recovering every user's private key from the public account id (and none from the fixed contract).

## 3. Branches in circuits that name no caller

- **Cases:** `cases/L06-branch-unbalanced.compact`, `cases/L10-count-in-loop.compact`.
- **The question:** can a Midnight contract-call transaction be tied to its submitter outside the circuit? If so, a branch on a private value tells observers something about a known person and should be medium, as Nightshade's policy run rates it.
- **Evidence** (Midnight docs, `midnight-docs` at `a11fc9d`, and the ledger API reference for ledger 8.1.2):
  - Fees are paid in DUST, "a shielded capacity resource" built on "the commitment/nullifier paradigm"; a DUST spend is a self-spend whose public parts are a fee, a nullifier, a new commitment and a proof (`DustSpend { vFee, oldNullifier, newCommitment, proof }`, `docs/concepts/dust-architecture.mdx`). It does not name the owner or the NIGHT that generates it.
  - A contract call carries the address, entry point, transcripts, a communication commitment and a proof (`ContractCall`). No wallet key, unless the circuit publishes one (`ownPublicKey()`, which Tell reports) or the wallet adds an unshielded offer, which is signed and does name its owner.
  - What remains: network metadata (the submitting node), timing, an unshielded payment in the same transaction, a DApp that submits for its users.
- **Decision:** keep low when nothing in the circuit identifies the caller (as before), and say so in the finding: the text now names the evidence (fees in shielded DUST) and what would identify callers, and tells the user to declare `"caller": "identified"` in `tell.json` if that is their case, which rates the same branch medium. The README's Limits section states the assumption. L06 and L10 therefore remain misses at medium in the default run, by decision; they are found at low.

## 4. Hashes of a secret without a domain or contract tag

- **Probe:** `engine/test/fixtures/src/case-cross-link.compact`.
- **Rule:** a published tag that is a hash of key material (a witness named as a key or secret, or declared secret) and that contains neither a non-zero byte-string literal (a domain separator) nor the contract's address (`kernel.self()`): low, "the same in every contract hashing it this way". With a separator but no address: the info finding gets one sentence (other deployments of the same contract, if the user keeps one secret for them, publish the same tag). With the address: nothing added.
- **Noise control:** hashes of content (not keys), public keys (`ecMulGenerator`, where "domain separator" does not apply) and commitments with a strong salt are left alone. On Midnight's examples the rule raises no severity: the only unseparated key tag is `secret-message`'s `publishMessageHash` (the example's own lesson 1), which was already low because the same tag is published by other circuits; it now says why it links across contracts. The one-sentence note appears on 17 info or low tag findings across the examples (election, battleship, roulette, silent-auction, and others) whose tags have a separator but no contract address. In the bench cases it raises L16's account id from info to low.

## 5. Shielded coin nonces in a circuit result, and what a result reveals

- **The question:** is an exported circuit's return value public? Tell assumed yes (and rated L09 critical); Nightshade calls it an application output, "not necessarily a public ledger".
- **Evidence:**
  - The ledger's `ContractCall` has `address`, `entryPoint`, `guaranteedTranscript`, `fallibleTranscript`, `communicationCommitment` and `proof`; the inputs and outputs are not fields. `communicationCommitment(input, output, rand)` in compact-runtime commits to them with randomness.
  - `docs/concepts/how-midnight-works/building-blocks.mdx`: the communication commitment "commits to the inputs and outputs of the circuit that the call targets", and is how one contract calls another.
  - `docs/guides/build-a-private-smart-contract.mdx`: "A return value is not written to the ledger or readable in the transaction, which carries only a randomized commitment to the call's inputs and outputs. The compiler still requires `disclose()` when the returned value comes from a witness, because the value leaves the circuit, to your DApp or to a calling contract."
  - Some tutorials list "returns from exported circuits" among public outputs (`private-party/smart-contract.mdx`); the ledger structure and the guide above are what Tell follows.
- **Change:** findings whose only sink is the return value are kept but capped at low, with that explanation; a returned value no longer counts as known to an observer (so it no longer weakens other hashes or marks a caller as identified).
- **Consequences:** `cases/L09-secret-returned.compact` was relabelled from `leak` to `not-public` (a correct observation of a value leaving the proof, not a public leak): this removes one of Tell's own true positives from the first run. The shielded-chips `mint` circuit, which returns the minted coin's info with its nonce, is no longer reported: the nonce goes to the DApp, which needs it to spend the coin, and the source's claim that the nonce "is never published" holds. Gap 5's suggested rule (a nonce reaching a public output is medium) is therefore not added for returns; a nonce written to the ledger or an event is still covered by the existing rules.

## 6. Declared intent

- **Format:** `tell.json` or `.tellrc.json`, the nearest one at or above the contract up to the repository root; `--policy <file>` and `--no-policy` on the CLI; a `policy` input on the Action; a `policy` argument on the MCP tools (`tell_scan`, `tell_check_fix`). The web scanner is unchanged (out of scope for this pass). Documented in the README ("Declared intent").
- **Fields:** `witnesses` and `arguments` (`secret` or `public`), `circuits.<name>.once`, `circuits.<name>.caller` and a top-level `caller` (`anonymous` or `identified`), `intended` (findings kept but suppressed, with the reason), `files` (per-file overrides). Unknown keys and values are errors, so a typo never turns into "no policy".
- **S07** (a per-device key tag read as "the same tag on every action", Tell's one medium false alarm): one line, `"circuits": {"enroll": {"once": true}}`, in `bench/policies/tell.json`; reported in the `tell-policy` row, separately from the default run.
- **S05** (a balanced branch reported as a yes/no fact, info): fixed in the analysis, no policy needed. A salted commitment computed on one side of a branch no longer counts as a published yes/no fact; the branch rule, which drops branches that look the same on both sides, decides.

## L11: membership shown by a lookup

- **Case:** `cases/L11-set-member.compact`.
- **Rule (medium, kind `linkable`):** a circuit tests `Set.member` with a deterministic hash of the caller's key material, does not insert into or remove from that set itself (a one-time nullifier does), does not otherwise write the same tag (that is judged as its own finding), and the set is not an officer list (`admins`, `owner`, …). The lookup key is in the public transcript, so each call names the member and lines up with their other calls. Maps are excluded: a Map keyed by the caller's tag is an account record (a balance, a bid) read by design. A policy can declare the caller identified, or the circuit once per member, which keeps it at info.
- **Precision work it needed:** a field of a changing ledger value (a queue's head) is now treated as changing, so `hash(sk, shot)` in battleship is not mistaken for a member tag.
- **Zoo:** `club-leaky` / `club-fixed` (a Merkle `checkRoot` and a one-time nullifier); `zoo/test/linking.test.ts` reads each claim's public transcript and names the member who made it, and finds no member leaf in any claim of the fixed contract.
- **Side effect on the auto-fix:** board's verified fix (a one-time tag per post) leaves the membership lookup of the old tag in place. Tell now reports that lookup on its own (medium), so the patched board grades C instead of B; the patch's note already named it, and the zoo's Merkle version is the full fix.

## Checked and not a gap

- **Preimage checked against a ledger hash, then published** (Nightshade `ledger-bound-preimage-publication`): Tell reports it high or critical, also with a neutral witness name.
- **Constant commitment randomness** (Nightshade `predictable-commitment-randomness`): critical, including for a wide value.
- **Whole-struct disclosure** (compact-guard CG007): Tell measures each field separately.
- **`ownPublicKey()` used for authorization** (compact-guard CG001, Nightshade `public-key-membership-authorization`): an authentication issue, not a disclosure; Tell's wallet-key rule covers the privacy side.
