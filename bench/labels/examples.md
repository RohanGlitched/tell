# Labels: Midnight's examples (midnight-examples at 377495c)

Every finding at medium or above, from every tool and configuration, labelled by hand against the source. Line numbers are the tool's own. Labels: `real-privacy` (private data becomes public in a way the contract does not intend or document), `intended` (a correct observation of a disclosure the contract makes on purpose, usually with a comment saying so), `real-other` (true, not about privacy), `false-alarm`. Keys are in `labels.json`.

Low and info findings on the examples are counted but not labelled (Tell 155, compact-guard 75, Nightshade with every rule 63).

## Tell

| Contract | Finding | Label | Reason |
|---|---|---|---|
| election | branch medium, line 100 (`revealVote`) | real-privacy (`election-reveal-links-vote`) | `revealVote` inserts the voter's persistent key into `revealedVoters` and then increments `candidate0VoteCounter` or `candidate1VoteCounter` depending on the vote, in the same transaction. The counter that moved is public, so each voter's choice is tied to the key they registered with. Revealing the tally is the design; tying each vote to its voter is not stated anywhere. Tell's own test suite already records this one. |
| roulette | branch medium, line 148 (`claimWinnings`) | false-alarm | The branch is inside the standard library's `sendShielded` (change or no change), driven by the escrowed coin's value. That value is already public (`betValues.insert(pubPlayer, disclose(coin.value))` in `betColor`), and here the full value is sent, so the branch always goes the same way. The line number points into `houseDeposit` because of inlining. |

## compact-guard

| Contract | Finding | Label | Reason |
|---|---|---|---|
| chips | CG001 medium, lines 172 and 360 ("authorization depends on ownPublicKey()") | false-alarm | `burn` passes `ownPublicKey()` as the refund target and `_burn` asserts it is not the zero address. That is routing change back to the caller, not authorization; the file explicitly says it never authenticates with `ownPublicKey()` (MIP-0011). |
| zk-loan | CG002 medium, line 106 (hash of the 16-bit PIN) | false-alarm | `persistentHash<Uint<16>>(pin)` is never published on its own; it is hashed again together with the 256-bit user secret. Guessing the PIN does not help without the secret. |
| zk-loan | CG004 medium, lines 176 and 177 (`providers.member(disclose(providerId))`) | intended | Reveals which credit provider attested. The source says so: "Disclosing the id reveals WHICH provider attested, but nothing about the profile." |
| bridged-usdc-mint | CG004 medium, line 84 (`usedNonces.member(nonceKey)`) | intended | The CCTP nonce is public bridge data, used for replay protection. (Separately, and outside privacy: `messageNonce()` is a witness that nothing binds to the signed message bytes, so the replay check can be sidestepped by supplying a fresh nonce. No tool reports this.) |

## Nightshade, every rule (`nightshade-all`)

All of these come from opt-in review rules; the default selection reports none of them.

| Contract | Finding | Label | Reason |
|---|---|---|---|
| battleship | nullifier-check-without-insert, lines 130, 152, 173, 216 | false-alarm | `!boardHits.member(shot)` rejects repeating a previous hit; hits are inserted in the check step, misses are allowed to repeat. This is game logic, not a nullifier. |
| battleship | nullifier-check-without-insert, lines 186, 229 | false-alarm | `!board.member(honestyCheckHash)` checks a claimed miss against the committed ship positions. Not a nullifier. |
| battleship | unasserted-security-result, lines 198, 241 | false-alarm | `winState = hitCount == 2 ? ... : ...` stores the comparison on purpose. |
| private-bid | caller-supplied-time-review, line 82 | false-alarm | `amount >= minimumBid` compares a bid amount, not a time. |
| private-party | inconsistent-access-control, lines 48, 80 | false-alarm | `rsvp` and `checkIn` are guest actions that move `partyState` when the list fills; no organizer check is meant to apply. |
| private-tip-jar | caller-supplied-ledger-equality, line 94 | false-alarm | `coin.color == tipColor` checks the token color of a coin the transaction actually receives; it is not a password check. |
| roulette | caller-supplied-ledger-equality, line 162 | false-alarm | Same color check for chips. |
| silent-auction | inconsistent-access-control, lines 91, 154 | false-alarm | `bid` closes the auction when it fills and `claimWin` marks it paid; both are meant for bidders. |
| chips | default-recipient-or-owner, lines 175, 210 | false-alarm | The all-zero recipient is `shieldedBurnAddress()`: burning is the purpose of these functions. |
| tip-token | unbounded-mint, line 29 | real-other | True: anyone can mint any amount. The file says it is a test faucet, "never deploy something like it". |
| chips | unbounded-mint, line 144 | real-other | True: the house can mint any amount (house-only by `requireHouse`). A policy choice, correctly described. |
| token-transfers | unbounded-mint, lines 9, 57, 61 | real-other | True for this demo contract: no cap and no caller check. |
| zk-loan | nullifier-check-without-insert, lines 132, 133, 153, 287, 296, 299, 311, 315 | false-alarm | These are blacklist, migration and loan-existence checks, not nullifiers; several are followed by an insert in the same circuit. |

## Nightshade with a secrets policy (`nightshade-policy`)

Policy: every witness is secret, allowed forms `hash` and `commitment` (the shape of Nightshade's shipped `examples/review/secret-policy.json`). A user who writes a policy for one contract would declare fewer secrets or allow more forms; this run shows what the generic policy reports.

| Contract | Finding | Label | Reason |
|---|---|---|---|
| battleship | lines 73, 108 (`board1State`/`board2State` from `localSetBoard`) | false-alarm | The witness result is asserted equal to `BoardState.SET` before it is written, so the published value is a constant. |
| battleship | lines 186, 187, 192–195, 198, 229, 230, 235–238, 241 (`localCheckBoard` result) | intended | Announcing hit or miss is the game; the source discloses `shotState` explicitly. |
| calculator | line 32 (`divMod` quotient to `result`) | intended | The calculator publishes results by design; the source comments on it. |
| election | line 74 (`commitVote`) | false-alarm | The stored value is `hash(vote, sk)` with a 256-bit secret; it cannot be guessed. The policy treats the cast as `derived`. |
| election | lines 100, 102 (`revealVote` counters) | real-privacy (`election-reveal-links-vote`) | The same leak as Tell's: the vote is tied to the voter's key. |
| roulette | line 267 (`forfeit` stores the derived coin) | intended | The comment explains the forfeited coin moves into the public pool under a one-way derived nonce; its value is already public. |
| silent-auction | lines 81, 83 (bidder key as map key) | intended | The per-dapp bidder key is public by design ("hash a public key specific to this DApp"). |
| silent-auction | lines 87, 90, 91 (`highestBid`, `bidders.size`, `auctionState`) | false-alarm | The written values depend only on the public bid and public ledger state; the secret only reaches them through a key that is already public. |
| zk-loan | lines 165, 176, 177, 229, 233, 236, 297–326 (`getUserSecret`, `getAttestedScoringWitness`) | intended | The PIN-derived user key is the documented public loan-map key; the tier outcome and the provider id are the documented disclosures; `changePin` names old and new keys together, which the source states ("not an unlinkable one"). |

## Not labelled, worth a look

Tell (info, "argument `nonce` is published") and Nightshade with every rule (`exported-shielded-descriptor`, info) both point at `chips.mint`, which returns the minted `ShieldedCoinInfo`, nonce included, from an exported circuit. The source says the nonce "is a circuit argument, so it is never published, which is what keeps the recipient private". Whether an exported circuit's result is public depends on how the application handles it: Tell treats it as part of the public transaction, Nightshade calls it an application-output boundary, "not necessarily a public ledger". If the result is public, the recipient can be recovered by trying candidate keys against the coin commitment. This needs confirmation from Midnight before anyone reports it.
