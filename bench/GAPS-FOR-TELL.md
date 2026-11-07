# Gaps for Tell, from the benchmark

Privacy issues that another tool reports and Tell misses or underrates, in priority order. Each item names the competitor rule, a minimal example, why it is a real leak, what Tell does today (checked by running it), and a suggested rule. Cases are in `bench/cases`; numbers in [RESULTS.md](RESULTS.md).

## 1. Constructors are not analysed

- **Who catches it:** Nightshade `declared-secret-publication` with a secrets policy (high). Nobody else.
- **Case:** `cases/L12-constructor-leak.compact`

```compact
witness adminSecret(): Bytes<32>;
constructor() {
  admin = disclose(adminSecret());
}
export circuit act(): [] {
  assert(admin == adminSecret(), "admin only");
  actions.increment(1);
}
```

- **Why it leaks:** the constructor's ledger writes are the contract's initial public state. The admin secret is readable by anyone from the deploy transaction, and (as Nightshade's `spoofable-authorization` also notes) anyone can then pass the admin check.
- **Tell today:** no finding; the constructor is not traced. `cases/S11-constructor-hash.compact` is the safe counterpart.
- **Suggested rule:** run the same source tracing over the constructor's circuit in the `reduce-to-circuit` output (witnesses and constructor arguments as sources; constructor arguments the source wraps in `disclose()` are public on purpose, as for circuit arguments). Already on Tell's Wave 3 roadmap.

## 2. A published hash reused as a private scalar

- **Who catches it:** Nightshade `publicly-derivable-encryption-secret` (default-on, high; written for this class, did not fire on this case), `published-digest-generator-scalar-review` (opt-in, info; fired), and `declared-secret-publication` with a policy (high). compact-guard CG006 points at the missing domain separation (low).
- **Case:** `cases/L16-public-digest-as-key.compact`

```compact
export circuit register(): [] {
  const id = persistentHash<Vector<1, Bytes<32>>>([seed()]);
  accountId = disclose(id);
  encKey = disclose(ecMulGenerator(degradeToTransient(id)));
}
```

- **Why it leaks:** `encKey` is a public key whose private scalar is `id`, and `id` is on the ledger as `accountId`. Anyone can decrypt what is encrypted to `encKey`, or sign as it.
- **Tell today:** one info note that `accountId` is a stable tag ("it cannot be reversed"). The fact that the same hash is used as secret key material is not seen. Safe counterpart: `cases/S13-separate-key-domain.compact` (differently tagged hashes).
- **Suggested rule:** when an expression is published (on the ledger or in a return) and the *same* expression (same tag fingerprint, which Tell already computes for linkable tags) is used as secret material elsewhere, report critical: as the scalar of `ecMulGenerator`/`ecMul`, as commitment randomness, or as the preimage of a hash that guards something. The published value then is the secret.

## 3. Branches in circuits that name no caller: severity

- **Who catches it:** Nightshade `declared-secret-publication` with a policy, as implicit flows (high).
- **Cases:** `cases/L06-branch-unbalanced.compact`, `cases/L10-count-in-loop.compact`

```compact
export circuit check(): [] {
  if (disclose(balance() > limit)) { above.increment(1); } else { below.increment(1); }
}
```

- **Why it can leak:** the counter that moved is public, so each call reveals one bit about the caller's balance (L10: how many of eight scores passed). Tell rates this low because nothing in the circuit identifies the caller.
- **Tell today:** branch, low (both cases). It does find them.
- **Suggested change:** decide and document whether a Midnight transaction can be linked to its submitter outside the circuit (fee payment, wallet coins spent in the same transaction, the submitting node, timing). If it can, rate these medium like the identified case. If it cannot, keep low and say why in the finding text, so a reviewer sees the assumption. Either way this is calibration, not a missing rule.

## 4. Hashes of secrets without a domain or contract tag (cross-contract linkability)

- **Who catches it:** compact-guard CG006 (review: "Hash input has no recognized nonempty literal domain prefix").
- **Example** (probe, not in the corpus):

```compact
witness secretKey(): Bytes<32>;
export circuit join(): [] {
  members.insert(disclose(persistentHash<Bytes<32>>(secretKey())));
}
```

- **Why it leaks:** a user who reuses a wallet secret across dapps publishes the same tag in every contract that hashes it the same way, so their activity links across contracts. Midnight's own `private-bid` example avoids this on purpose by hashing `kernel.self().bytes` into the key ("a bidder cannot be linked across auctions by their key").
- **Tell today:** info, "leaves the same tag every time": linkability inside the contract only.
- **Suggested rule:** for a secret-derived tag that is published, check for a literal domain prefix and for `kernel.self()` in the preimage. Neither present: low, "linkable across contracts"; prefix but no contract address: info. Keep CG006's distinction that a domain tag does not help against guessing.

## 5. Shielded coin nonces reaching a public output

- **Who catches it:** Nightshade `exported-shielded-descriptor` (opt-in, info).
- **Example:** `examples/shielded-chips/contract/chips.compact`, `mint` (and a probe):

```compact
export circuit mint(recipient: ZswapCoinPublicKey, amount: Uint<64>, nonce: Bytes<32>): ShieldedCoinInfo {
  return mintShieldedToken(pad(32, "probe:token"), disclose(amount), disclose(nonce),
                           left<ZswapCoinPublicKey, ContractAddress>(disclose(recipient)));
}
```

- **Why it may leak:** a coin's commitment is computed from its info (nonce, color, value) and the recipient's key. If the nonce is public, anyone can try candidate recipient keys against the commitment and identify who was paid. The chips source states that keeping the nonce unpublished "is what keeps the recipient private", and then returns the coin info from an exported circuit.
- **Tell today:** info, "argument `nonce` is published in the clear", the same as any argument the source wraps in `disclose()`.
- **Suggested rule:** treat a coin nonce (the `nonce` passed to `mintShieldedToken`, or `ShieldedCoinInfo.nonce` from a send or mint result) reaching a public output as "recipient can be identified", medium, regardless of `disclose()`. First confirm with Midnight how exported-circuit results are exposed: Tell treats them as part of the public transaction, Nightshade as an application-output boundary that is "not necessarily a public ledger". The answer also decides how Tell rates L09-style returns.

## 6. Declared intent (a policy file)

- **Who has it:** Nightshade `policies.secrets` (which witnesses and parameters are secret, which forms are allowed, which sinks count).
- **Why it matters for Tell:** two of Tell's false alarms come from guessing intent from shape and names: S07 (a per-device key tag read as "the same tag on every action") and S05 (a balanced branch reported as a published yes/no fact at info). A small optional file (for example `tell.json`: secret and public witnesses, one-time circuits, an "anonymous caller" flag per circuit) would let users remove these without per-line `tell:allow` comments, and would let the branch rating in item 3 follow the contract's own threat model.
- **Suggested:** optional, never required; Tell's inference stays the default.

## Also missed by Tell, with no competitor rule

- `cases/L11-set-member.compact`: an "anonymous" claim that tests `Set.member(disclose(hash(key)))`. Tell reports it at info as a linkable tag; it identifies which member acted, and every claim by that member, so medium is closer. No other tool reports it (compact-guard's CG004 covers low-entropy or raw keys only).

## Checked and not a gap

- **Preimage checked against a ledger hash, then published** (Nightshade `ledger-bound-preimage-publication`): Tell reports it high or critical, also when the witness has a neutral name (probe with `witness code()`: "hidden behind a hash elsewhere, and published in the clear here", high).
- **Constant commitment randomness** (Nightshade `predictable-commitment-randomness`): Tell reports it critical, including for a wide value (`persistentCommit<Uint<64>>(amount(), pad(32, "fixed"))`).
- **Whole-struct disclosure** (compact-guard CG007): Tell already measures each field separately.
- **`ownPublicKey()` used for authorization** (compact-guard CG001, Nightshade `public-key-membership-authorization`): an authentication issue, not a disclosure; Tell's wallet-key rule covers the privacy side.
