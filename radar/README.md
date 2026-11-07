# Tell Radar

Tell reads source code. Radar reads only the chain. It takes every contract it can find on Midnight Preprod, decodes its public state and the public transcript of its recent calls, and looks for three things that need no source to see:

1. **Guessable hashes.** A `persistentHash` of a small value is a lookup, not a secret. Radar hashes small domains the way the Compact runtime does and looks for the digests among every 32-byte value on chain. A hit names the hidden value, and anyone can check it by hashing it again.
2. **Repeated hidden values.** A map whose 32-byte values repeat cannot hold salted commitments: 32-byte random openings never collide. If six entries have four distinct values, they came from a small set, even when Radar cannot name the set.
3. **Linkable tags.** The same 32-byte value in several calls of a contract ties those calls together (the same tag on every action). The same value in two contracts ties those together too.

The acceptance test is Tell's own pair of ballots on Preprod. From chain data alone, Radar reads all six votes off the leaky ballot and nothing off the fixed one (`test/ballot.test.ts`, on a cached snapshot, no network).

## Run it

```bash
export RADAR_BLOCKFROST_FILE=../chain/secrets/blockfrost-preprod   # or BLOCKFROST_PROJECT_ID
export RADAR_HOME=~/mn/work/radar                                     # cache, tables, private notes

npx tsx src/cli.ts crawl    --network preprod --days 14 --budget 4100  # which contracts acted, newest blocks first
npx tsx src/cli.ts discover --network preprod --dir path/to/repos      # 64-hex strings in files that are Preprod contracts
npx tsx src/cli.ts scan     --network preprod [--addresses file] [--max N] [--actions 100] [--budget N] [--deep]
npm test -w radar
```

`scan` writes `radar/out/report.json` (counts only) and `$RADAR_HOME/private/details-preprod.json` (addresses, recovered values, linked transactions). Every indexer answer is cached under `$RADAR_HOME/gql`, so a second run sends nothing it already has; `--offline` sends nothing at all. `--budget` caps the requests one run may send (default 500).

## Method

- **Encoding.** `persistentHash` is SHA-256 over the value's atoms, each written little-endian at the full width of its alignment: one byte for `Uint<8>` and `Boolean`, eight for `Uint<64>`, 32 for `Field` and `Bytes<32>`. Radar hashes with Node's SHA-256 directly (about 200,000 a second per thread) and `test/hash.test.ts` checks it against `@midnight-ntwrk/compact-runtime` for every type and family it uses.
- **Domains.** Plain `Uint<8>` to `Uint<128>`, `Field` and `Boolean` values up to 2^24 (from precomputed tables, built once and kept in `$RADAR_HOME/tables`); short labels `pad(32, "...")`; and the usual domain-separated pair `[pad(32, prefix), value]` with the value as `Field`/`Bytes<32>`, `Uint<8>` or `Uint<64>`. Prefixes come from a general word list (`src/words.ts`) and from the contract's own entry-point names, which are public. Single words get values up to 1,024; two-word prefixes (`a:b`, `a_b`, `a-b`, `a/b`, `a.b`, `ab`, `a:b:`) get values below 16, or 256 with `--deep`.
- **Targets.** Every 32-byte atom in a contract's state (cells, map keys, map values) and in its calls' transcripts that looks like a digest: not mostly zeros, not a padded label.
- **State.** Decoded with the runtime's `ContractState`; no field names, only the ledger's shape. Merkle tree leaves are stored hashed and are counted, not searched.
- **Transcripts.** Each call's raw transaction is decoded with `@midnight-ntwrk/ledger-v8`; every aligned value in the guaranteed and fallible programs counts as touched by that call.
- **Links.** A value seen in two or more calls of one contract is a cluster. A cluster present in 80% or more of a contract's calls (with three or more calls) is counted apart, as a constant: an admin key or a configuration value.

## Limits

- Only small domains fall. A hash of a secret key, a salted `persistentCommit`, or a value with 64 random bits is out of reach, which is exactly the fix Tell recommends.
- A domain separator Radar's word list cannot build (an unusual word, a version suffix, a different separator) hides a small domain from the brute force. The repeated-value check still sees it when values repeat.
- Tuples, structs and vectors other than `[Bytes<32>, value]`, and `transientHash` (Poseidon, about 700 a second in the runtime), are not searched yet.
- Only the most recent calls (`--actions`, 100 by default) of each contract are decoded.
- Coverage depends on finding the contracts. The indexer has no list of contracts; `crawl` reads blocks, 50 per request (the indexer's complexity limit). See the coverage note in the report for the window actually read.

## Ethics

Radar reads only public chain data. The published report has counts and nothing that identifies a contract, except Tell's own two ballots. The per-contract details stay private, outside the repository, and are for writing to the teams concerned, the same way the source survey was handled.
