# Proposed README changes for Wave 3 (engine)

For the lead to merge into the top-level README. Everything below is implemented and tested in
this branch; numbers come from runs listed at the end.

## Badge

`Compact 0.29–0.35` becomes `Compact 0.29–0.36`.

## "What it finds" table: rows to add or change

| Finding | Severity | Example |
|---|---|---|
| Shielded coin with a public nonce | medium / low | `mintShieldedToken(d, 100, evolveNonce(n, ledgerNonce), left(ownPublicKey()))`: the nonce, color and amount are public, so anyone with a list of wallet keys can tell who received each coin (MIP-0011 calls the derived-nonce mint "recipient-public") |
| Private value as a public token amount | medium | `receiveUnshielded(color, disclose(bidAmount()))`: a sealed bid locked as an unshielded deposit is the bid; also minted amounts and the amount fields of standard events |
| Wallet key published | medium | `ownPublicKey()`, or a `ZswapCoinPublicKey` / `UserAddress` from private state, stored or emitted, names the wallet |

Existing rows now also cover three new places a value can go public:

- **The constructor.** What it writes is the contract's initial public state, readable by anyone the moment the contract is deployed. Findings point at the constructor's line.
- **Events** (`emit`, Ledger 9, Compact 0.33+). An event is part of the public transaction, like a ledger write.
- **Cross-contract calls** (Ledger 9). Compact requires call arguments to be disclosed; Tell treats them as public, and a branch that decides which contract or circuit is called is a secret-dependent branch.

Severity rules for the new cases:

- Shielded coin: the commitment is `hash(nonce, color, value, recipient)`. If no private input with at least 112 unknown bits reaches the nonce (wallet keys do not count: they are identifiers, not secrets), each private input to the value or recipient is exposed. Medium if any of them comes from private state (a witness, `ownPublicKey()`); low if all are the caller's own arguments. A coin minted to the contract itself with a public amount exposes nothing and is not reported.
- Public token amount: a witness value used as the amount of `mintShielded`, `mintUnshielded`, an unshielded send or receive, or a standard token event is medium when the contract keeps that value hidden somewhere else (inside a published hash or commitment) or its name says it is personal (salary, income, …). Witnesses also fetch public data and arithmetic hints, so other witness amounts stay low, and arguments stay info.
- Wallet key from private state written to the ledger or an event: medium, low in officer fields (`owner`, `admin`, …) and in the constructor. From an argument: info. The recipient of an unshielded transfer is public by design and is not reported as a leak.
- A hash whose other inputs are already public counts only its private part: `hash(tag, vote)` with `tag` on the ledger (in this call or any other circuit) is a hash of the vote.
- A secret-dependent branch is dropped only when every operation it touches looks the same on both paths (before, only the first operation was compared).

## "How it works", step 1 and 2

1. **Runs the real Compact compiler** with `--trace-passes --skip-zk`, matched to the contract's `pragma`, preferring 0.31.1 and falling back through 0.36, 0.35, 0.34, 0.30 and 0.29. Contracts that use Ledger 9 features (events, contract calls) declare `pragma language_version >= 0.25`, which 0.31.1 does not accept, so they go to 0.36.
2. **Reads the compiler's own `reduce-to-circuit` form**: helpers inlined, loops unrolled, every step a guarded binding. The constructor is not proved, so it never reaches that pass; Tell takes it from the last pass that still has it (`drop-safe-casts`) and lowers it to the same guarded bindings. Compilers before 0.31 and 0.36 print some forms differently (0.36 writes field types as operands, `(field->bytes 32 (field-native) x)`); Tell normalises all of them.

## "Evidence" bullets

- **Leak zoo**: nine leaky contracts and their fixes (five Ledger 8 originals, three new: a raffle whose constructor seals the winner with a guessable hash, a faucet minting shielded coins with a public nonce, a sealed-bid deposit paid in the clear; one Ledger 9: a poll that emits hash(choice) as a receipt event). Each leak is carried out by an attack test that reads only public data (initial state, ledger state, transaction effects, events); each fix stops it. 18 attack tests in CI.
- **Precision tests**: see the counts at the end.

## "Limits"

Replace "It does not yet analyse constructors" with: "It treats cross-contract call arguments as public, as the compiler does; whether a particular callee actually publishes them depends on the callee's code, which Tell analyses separately."

## Ledger 9 constructs and compiler choice

Compiled only by 0.33 and later (language 0.25+), so 0.31.1 rejects them: `emit` and the standard event types, `contract` declarations and cross-contract calls, `kernel.caller()` (0.35), `serialize`/`deserialize`, `sha512`, the secp256r1 and Curve25519 types, `secp256r1EcdsaVerify` and `ed25519Verify` (0.35, flag-free in 0.36). Midnight's own Ledger 9 examples declare `pragma language_version >= 0.25.0`, which skips 0.31.1. A contract with a looser pragma that uses them fails on 0.31.1 and Tell falls back to the next installed compiler that builds it (tested).

## Numbers (from runs on this branch)

- Engine precision tests: 87 before, 152 now (`npm test -w engine`).
- Zoo attack tests: 10 before, 18 now (`npm test -w zoo`): 16 on Ledger 8 contracts (runtime 0.16), 2 on the Ledger 9 poll (Compact 0.36, runtime 0.21).
- `scripts/zoo-check.ts --compiler 0.36.0`: all 18 zoo contracts pass (every leaky one has a medium-or-worse finding, every fix none).
- Survey sample (48 contracts from 36 repositories, chosen for constructors and token operations, compiled once and analysed by the old and new engine): no crashes; 2 new findings at medium or worse, both read by hand and both real (a shielded mint whose nonce is `evolveNonce(counter, contract address)`, and an invoice amount the contract hides in a commitment but settles as an unshielded deposit); 5 new low shielded-coin findings (contract-held coins paid to an argument recipient); constructors add 84 info and 4 low findings (an officer's `ownPublicKey()` stored at deploy) and 9 linkable tags.

## Roadmap row

`Wave 3 | … constructor analysis; shielded token and DUST patterns in the zoo` is done except DUST: no DUST-specific leak was found that the IR exposes (DUST is spent by the wallet for fees, outside contract code).
