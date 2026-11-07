# Labels: zoo and bench cases

A finding from a privacy rule inside the circuit that holds a planted leak is matched automatically; the most severe one is the `tp`, any others on the same leak are `dup`. Every other finding on the zoo and the bench cases, at every severity, has a hand label below. Keys are in `labels.json`.

Principle used throughout: a finding counts as finding the leak only when what it says is wrong, or what it says to fix, addresses that leak. A true statement about something else is `real-other` (not privacy), `intended` (a disclosure the contract makes on purpose) or `real-privacy` (a true privacy observation that is not the planted leak).

## Tell

| File | Finding | Label | Reason |
|---|---|---|---|
| cases/S07 | attributable medium, line 19 ("every `enroll` stores the same tag") | false-alarm | Each device enrolls once under its own key, and the tag is that device's public key. Nothing is repeated across actions. |
| cases/S05 | predicate info, line 28 ("a yes/no fact about balance() is published") | false-alarm | Both sides insert a salted commitment into the same set, so the transcript is the same either way. No bit is published. |
| cases/L16 | linkable info, line 21 | real-privacy, not the leak | True (the account id is a stable tag), but it says the hash "cannot be reversed" and does not see that the same hash is the private scalar of `encKey`. Tell has no finding on the leak itself. |
| zoo/ballot-*, board-leaky (join), reserve-fixed, vault-fixed | linkable low/info on the voter, member, bidder or owner tag | intended | These contracts use one pseudonymous tag per user by design (register then vote, one bid per bidder, one owner). Tell's note is true and rated low or info. |
| cases/S08, S13 | linkable info | intended | The returned id (S08) and the account id (S13) are meant to be stable public identifiers. |
| zoo/board-fixed, payband-fixed; cases/L11, N01, S01, S02, S03, S06, S07, S10, S12 | published info on a circuit argument the source wraps in `disclose()` | intended | Item ids, question ids, employee ids, places, device ids, Merkle leaves and the close flag are public by design; Tell lists them at info as "written on purpose". |

Tell's misses at medium and above: L06 and L10 are reported, but at low (Tell lowers a branch to low when nothing in the circuit identifies the caller); L11 is reported at info (the tag in `Set.member` is "linkable", not "identifies the member"); L12 (constructor) and L16 (published digest reused as a private scalar) have no finding.

## Nightshade (all three configurations share labels)

| File | Finding | Label | Reason |
|---|---|---|---|
| zoo/vault-leaky | spoofable-authorization high, line 23 (withdraw) | real-other | True and serious: `owner` holds the raw key, so anyone who reads it passes the check. A consequence of the leak, stated as an authentication problem. |
| cases/L12 | spoofable-authorization low, line 24 (act) | real-other | Same pattern: the admin secret is on the ledger after the constructor, so anyone can act. Not reported as a disclosure. |
| zoo/vault-leaky | unconstrained-witness-to-state medium, line 19 (claim) | real-other | Points at the leaking line, but its problem is a missing value-specific assertion; adding one would not stop the key being published. |
| cases/N01 | merkle-leaf-binding-review info, line 27 | real-other | The planted soundness bug. Correct (info, opt-in review). |
| zoo/board-fixed, cases/N01, S10 | merkle-insert-without-dedupe info | real-other | True: `join` does not check for a duplicate leaf. |
| cases/L01, S01 | unused-declaration info (`raterKey`) | real-other | True: the cases declare a witness they never call. |
| cases/L15, L16, S12, S13 | write-only-ledger info | real-other | True for these minimal cases; the fields exist to be read off chain. |
| zoo/board-fixed (line 34), cases/N01 (27), S10 (28) | declared-secret-publication high: the member key and path "influence `members.checkRoot`" | false-alarm | `checkRoot` reveals only whether the computed root is a valid root; the key and path stay hidden. This is the anonymous-membership pattern. |
| cases/S05, lines 26 and 28 | declared-secret-publication high: balance "influences `checks.insert`" | false-alarm | Both branches perform the same insert of a salted commitment; the implicit flow is not observable. |
| cases/S13, line 22 | declared-secret-publication high: seed "influences `encKey`" | false-alarm | `encKey` is a public key derived from a separately tagged hash of the seed; publishing a public key is the point. The secrets policy used (allowed forms `hash`, `commitment`) classifies it as `derived`. |

Matched automatically and checked by hand: `predictable-commitment-randomness` on L04, `ledger-bound-preimage-publication` on L13, `low-entropy-hash-disclosure` on L15, and `declared-secret-publication` (policy run) on zoo ballot, payband, reserve, vault and cases L06, L08, L09, L10, L12, L13, L16. On L16 the policy finding is at the `encKey` write, which is where the leak lands. `published-digest-generator-scalar-review` (info, opt-in) on L16 is the rule written for exactly this leak.

## compact-guard

| File | Finding | Label | Reason |
|---|---|---|---|
| zoo/ballot-leaky | CG002 medium, line 23 (`choiceHash`) | tp | Reported at the helper, but its evidence lists `vote` as an entry circuit reaching it with `witness choice`; that is the planted leak (findings are deduplicated by line, so the helper line carries it). |
| zoo/ballot-fixed | CG002 medium, line 24 (`choiceHash`) | false-alarm | `choiceHash` is an exported *pure* circuit that nothing on chain calls in the fixed contract; its result is never written to the ledger. The fixed `vote` stores a salted commitment. |
| cases/L01, L02, L03, L14, L15 | CG006 low (no domain tag in the hash) | real-other | True: these hashes have no domain-separation prefix. It is hygiene, not what leaks; a domain tag does not stop guessing a small preimage. |
| cases/L16 | CG006 low, line 20 | tp | Here the missing domain separation *is* the leak: the public id and the private scalar are the same unseparated hash. The rule's advice ("review domain separation") is the fix. Counted at low severity. |
| cases/N01 | CG005 low, line 27 | real-other | The planted non-privacy bug (Merkle path not bound to the leaf). Correct. |

Matched automatically: CG002 on L02, L14, L15; CG003 (review = low) on L04 and L05, the only tool other than Tell to see the public-ledger nonce in L05.

## compact-lint

| File | Finding | Label | Reason |
|---|---|---|---|
| cases/N01 | unbound-witness-path error, line 27 | real-other | The planted non-privacy bug. Correct, and at error severity. |

## OpenZeppelin detectors

No findings on the labelled set.
