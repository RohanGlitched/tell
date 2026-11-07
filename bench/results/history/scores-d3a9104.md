## Labelled set (zoo + bench cases), medium and above

| Tool | Leaks found (TP) | Missed (FN) | False alarms (FP) | Safe files with no false alarm | Real non-privacy findings | Leak quantified | Leak shown by a shipped attack test |
|---|---|---|---|---|---|---|---|
| tell | 16 / 21 | 5 | 1 | 18 / 19 | 0 | 14 / 16 | 5 |
| nightshade | 3 / 21 | 18 | 0 | 19 / 19 | 1 | 1 / 3 | 0 |
| nightshade-all | 3 / 21 | 18 | 0 | 19 / 19 | 2 | 1 / 3 | 0 |
| nightshade-policy | 13 / 21 | 8 | 9 | 14 / 19 | 1 | 1 / 13 | 0 |
| compact-guard | 4 / 21 | 17 | 1 | 18 / 19 | 0 | 4 / 4 | 0 |
| compact-lint | 0 / 21 | 21 | 0 | 19 / 19 | 1 | 0 / 0 | 0 |
| oz-detectors | 0 / 21 | 21 | 0 | 19 / 19 | 0 | 0 / 0 | 0 |

## Labelled set, all severities (info and low included)

| Tool | Leaks found (TP) | Missed (FN) | False alarms (FP) | Safe files with no false alarm | Real non-privacy findings | Findings in total |
|---|---|---|---|---|---|---|
| tell | 19 / 21 | 2 | 2 | 17 / 19 | 0 | 55 |
| nightshade | 3 / 21 | 18 | 0 | 19 / 19 | 3 | 6 |
| nightshade-all | 4 / 21 | 17 | 0 | 19 / 19 | 15 | 19 |
| nightshade-policy | 13 / 21 | 8 | 9 | 14 / 19 | 3 | 29 |
| compact-guard | 7 / 21 | 14 | 1 | 18 / 19 | 6 | 14 |
| compact-lint | 0 / 21 | 21 | 0 | 19 / 19 | 1 | 1 |
| oz-detectors | 0 / 21 | 21 | 0 | 19 / 19 | 0 | 0 |

## Midnight examples (29 contracts at 377495c), medium and above, hand-labelled

Distinct real privacy leaks found by any tool: 1 (election-reveal-links-vote).

| Tool | Analysis complete | Findings (medium+) | Real privacy leak | Intended disclosure | Real non-privacy | False alarm | Distinct privacy leaks found | Findings, all severities |
|---|---|---|---|---|---|---|---|---|
| tell | 26 / 29 | 2 | 1 | 0 | 0 | 1 | 1 / 1 | 157 |
| nightshade | 19 / 29 (14 pragma-adjusted) | 0 | 0 | 0 | 0 | 0 | 0 / 1 | 7 |
| nightshade-all | 3 / 29 (14 pragma-adjusted) | 31 | 0 | 0 | 6 | 25 | 0 / 1 | 94 |
| nightshade-policy | 19 / 29 (14 pragma-adjusted) | 59 | 2 | 51 | 0 | 6 | 1 / 1 | 66 |
| compact-guard | 29 / 29 | 6 | 0 | 3 | 0 | 3 | 0 / 1 | 81 |
| compact-lint | 29 / 29 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | 0 |
| oz-detectors | 22 / 29 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | 0 |

## Per-file matrix (labelled set, medium and above)

| File | Truth | tell | nightshade | nightshade-all | nightshade-policy | compact-guard | compact-lint | oz-detectors |
|---|---|---|---|---|---|---|---|---|
| cases/L01-assert-bound-hash | leak (guessable-hash) | TP critical | missed | missed [incomplete] | missed | missed | missed | missed |
| cases/L02-type-width-hash | leak (guessable-hash) | TP critical | missed | missed [incomplete] | missed | TP medium | missed | missed |
| cases/L03-hash-public-arg | leak (guessable-hash) | TP critical | missed | missed [incomplete] | missed | missed | missed | missed |
| cases/L04-commit-constant-nonce | leak (guessable-hash) | TP critical | TP medium | TP medium | TP medium | low: low | missed | missed |
| cases/L05-commit-public-nonce | leak (guessable-hash) | TP critical | missed | missed | missed | low: low | missed | missed |
| cases/L06-branch-unbalanced | leak (branch) | low: low | missed | missed | TP high | missed | missed | missed |
| cases/L07-same-tag-every-action | leak (linkable-tag) | TP medium | missed | missed [incomplete] | missed | missed | missed | missed |
| cases/L08-cast-not-hash | leak (secret-published) | TP medium | missed | missed | TP high | missed | missed | missed |
| cases/L09-secret-returned | leak (secret-published) | TP critical | missed | missed | TP high | missed | missed | missed |
| cases/L10-count-in-loop | leak (branch) | low: low | missed | missed [incomplete] | TP high | missed | missed | missed |
| cases/L11-set-member | leak (linkable-tag) | low: info | missed | missed [incomplete] | missed | missed | missed | missed |
| cases/L12-constructor-leak | leak (secret-published) | missed | missed | missed | TP high | missed | missed | missed |
| cases/L13-preimage-published | leak (secret-published) | TP critical | TP medium | TP medium | TP high | missed | missed | missed |
| cases/L14-boolean-hash | leak (guessable-hash) | TP critical | missed | missed [incomplete] | missed | TP medium | missed | missed |
| cases/L15-cell-hash | leak (guessable-hash) | TP critical | TP medium | TP medium [incomplete] | TP medium | TP medium | missed | missed |
| cases/L16-public-digest-as-key | leak (secret-published) | missed | missed | low: info [incomplete] | TP high | low: low | missed | missed |
| cases/N01-merkle-unbound-path | nonprivacy (soundness) | clean | bug found (info) | bug found (info) [incomplete] | FP declared-secret-publication, declared-secret-publication | bug found (low) | bug found (high) | clean |
| cases/S01-assert-bound-commit | safe (guessable-hash) | clean | clean | clean | clean | clean | clean | clean |
| cases/S02-type-width-commit | safe (guessable-hash) | clean | clean | clean | clean | clean | clean | clean |
| cases/S03-hash-public-arg-salted | safe (guessable-hash) | clean | clean | clean | clean | clean | clean | clean |
| cases/S04-commit-random-nonce | safe (guessable-hash) | clean | clean | clean | clean | clean | clean | clean |
| cases/S05-branch-balanced | safe (branch) | clean (1 low/info) | clean | clean | FP declared-secret-publication, declared-secret-publication | clean | clean | clean |
| cases/S06-per-action-tag | safe (linkable-tag) | clean | clean | clean [incomplete] | clean | clean | clean | clean |
| cases/S07-key-hashed | safe (secret-published) | FP attributable | clean | clean [incomplete] | clean | clean | clean | clean |
| cases/S08-public-key-returned | safe (secret-published) | clean | clean | clean [incomplete] | clean | clean | clean | clean |
| cases/S09-count-committed | safe (branch) | clean | clean | clean | clean | clean | clean | clean |
| cases/S10-merkle-checkroot | safe (linkable-tag) | clean | clean | clean [incomplete] | FP declared-secret-publication, declared-secret-publication | clean | clean | clean |
| cases/S11-constructor-hash | safe (secret-published) | clean | clean | clean [incomplete] | clean | clean | clean | clean |
| cases/S12-public-fact | safe (published) | clean | clean | clean [incomplete] | clean | clean | clean | clean |
| cases/S13-separate-key-domain | safe (secret-published) | clean | clean | clean [incomplete] | FP declared-secret-publication | clean | clean | clean |
| zoo/ballot-fixed | safe | clean | clean | clean [incomplete] | clean | FP CG002 | clean | clean |
| zoo/ballot-leaky | leak (guessable-hash) | TP critical | missed | missed [incomplete] | TP high | TP medium | missed | missed |
| zoo/board-fixed | safe | clean | clean | clean [incomplete] | FP declared-secret-publication, declared-secret-publication | clean | clean | clean |
| zoo/board-leaky | leak (linkable-tag) | TP medium | missed | missed [incomplete] | missed | missed | missed | missed |
| zoo/payband-fixed | safe | clean | clean | clean [incomplete] | clean | clean | clean | clean |
| zoo/payband-leaky | leak (guessable-hash) | TP critical | missed | missed [incomplete] | TP high | missed | missed | missed |
| zoo/reserve-fixed | safe | clean | clean | clean | clean | clean | clean | clean |
| zoo/reserve-leaky | leak (branch) | TP medium | missed | missed | TP high | missed | missed | missed |
| zoo/vault-fixed | safe | clean | clean | clean [incomplete] | clean | clean | clean | clean |
| zoo/vault-leaky | leak (secret-published) | TP critical | missed | missed | TP high | missed | missed | missed |

## Ground truth of the labelled set

| File | Truth | Class | Circuit | Why |
|---|---|---|---|---|
| cases/L01-assert-bound-hash | leak | guessable-hash | rate | rating is Uint<64> but asserted below 10, so the published hash has 10 possible preimages; hashing 0..9 recovers every rating. |
| cases/L02-type-width-hash | leak | guessable-hash | answer_ | a Uint<8> answer has 256 values; the published hash is reversed by hashing all 256. |
| cases/L03-hash-public-arg | leak | guessable-hash | record | hash(id, income): id is a disclosed argument written in the same call, income is asserted below 1,000,000 (20 bits); about a million hashes per record recover it. Two inputs, only one unknown. |
| cases/L04-commit-constant-nonce | leak | guessable-hash | pick_ | persistentCommit with pad(32, "nonce") as randomness is a plain hash; the pick is asserted below 3, so three guesses recover it. |
| cases/L05-commit-public-nonce | leak | guessable-hash | pick_ | the randomness is the public round counter, readable by anyone; with the pick asserted below 3, three guesses per round recover it. The nonce is not a constant, so a constant-only check does not see it. |
| cases/L06-branch-unbalanced | leak | branch | check | the transcript shows which counter moved, so every check reveals whether the hidden balance is above the limit (1 bit per call). |
| cases/L07-same-tag-every-action | leak | linkable-tag | checkIn | every check-in stores hash(key) next to the place, so all check-ins by one person share a tag; one identified check-in reveals that person's whole history. |
| cases/L08-cast-not-hash | leak | secret-published | enroll | degradeToTransient is a type conversion, not a hash; the stored field is the key. |
| cases/L09-secret-returned | leak | secret-published | recoveryCode | an exported circuit's result is part of the public transaction, so the returned recovery code is public. |
| cases/L10-count-in-loop | leak | branch | submit | for each of eight hidden scores the circuit increments `passes` only if it is at least 50; the transcript shows how many (and which) scores passed. |
| cases/L11-set-member | leak | linkable-tag | claim | the claim discloses hash(key) to test Set.member, so the transcript names which member claimed, and every claim by that member carries the same tag. An anonymous claim needs a Merkle proof. |
| cases/L12-constructor-leak | leak | secret-published | constructor | the constructor stores the deployer's admin secret as-is; it is in the deploy transaction's initial state. |
| cases/L13-preimage-published | leak | secret-published | redeem | the voucher secret matches a stored hash (authorization), then is written to a public log; anyone can reuse it where the hash is accepted. |
| cases/L14-boolean-hash | leak | guessable-hash | consent | two possible preimages; hashing true and false reads every answer. |
| cases/L15-cell-hash | leak | guessable-hash | answer_ | the same Uint<8> hash as L02, written to a plain ledger cell instead of a map value: 256 guesses. |
| cases/L16-public-digest-as-key | leak | secret-published | register | the account id is hash(seed) and is public; the encryption key pair uses the same hash as its private scalar, so anyone holding the account id holds the private key. (Class taken from Nightshade rule publicly-derivable-encryption-secret.) |
| cases/N01-merkle-unbound-path | nonprivacy | soundness | claim | privacy-safe like S10, but the path.leaf binding is missing: anyone can replay a public leaf's path and pass. A real security bug outside privacy; a privacy scanner is not expected to flag it. |
| cases/S01-assert-bound-commit | safe | guessable-hash | rate | same rating, but persistentCommit with a 32-byte witness salt; the ten guesses no longer match. |
| cases/S02-type-width-commit | safe | guessable-hash | answer_ | same Uint<8> answer under persistentCommit with a witness salt. |
| cases/S03-hash-public-arg-salted | safe | guessable-hash | record | same record as a commitment with a witness salt. |
| cases/S04-commit-random-nonce | safe | guessable-hash | pick_ | same pick, randomness from a witness. |
| cases/S05-branch-balanced | safe | branch | check | both sides insert a salted commitment into the same set; the transcript is the same shape either way and the values are hidden. |
| cases/S06-per-action-tag | safe | linkable-tag | checkIn | the tag hashes the key with the check-in number, so no two check-ins share a tag. |
| cases/S07-key-hashed | safe | secret-published | enroll | a 256-bit key under persistentHash; only the hash is stored (one device, one tag: not linkable across actions). |
| cases/S08-public-key-returned | safe | secret-published | myId | returns the domain-separated hash of the key (the usual public key), not the key. |
| cases/S09-count-committed | safe | branch | submit | the pass count is folded inside the circuit and only a salted commitment is published. |
| cases/S10-merkle-checkroot | safe | linkable-tag | claim | checkRoot reveals only the root; the path is bound to the recomputed leaf. (Claims are unlimited here; double-claim prevention would need a nullifier, which is a separate concern.) |
| cases/S11-constructor-hash | safe | secret-published | constructor | the constructor and the check use a domain-separated hash of the secret. |
| cases/S12-public-fact | safe | published | close | the poll owner closes the poll with a public flag that is supposed to be public; the flag is a circuit argument, not private data. |
| cases/S13-separate-key-domain | safe | secret-published | register | the public id and the private scalar come from differently tagged hashes of the seed; the id says nothing about the scalar. |
| zoo/ballot-fixed | safe |  |  |  |
| zoo/ballot-leaky | leak | guessable-hash | vote | hash(choice) with choice asserted below 4: four hashes read every vote |
| zoo/board-fixed | safe |  |  |  |
| zoo/board-leaky | leak | linkable-tag | post | every post stores the same hash(memberKey) as author: one identified post unmasks all of a member's posts |
| zoo/payband-fixed | safe |  |  |  |
| zoo/payband-leaky | leak | guessable-hash | file | hash(public employee id, salary): only the salary is unknown and it falls to brute force |
| zoo/reserve-fixed | safe |  |  |  |
| zoo/reserve-leaky | leak | branch | bid | which set is written reveals whether each hidden bid meets the reserve |
| zoo/vault-fixed | safe |  |  |  |
| zoo/vault-leaky | leak | secret-published | claim | the owner's secret key is written to the ledger |
