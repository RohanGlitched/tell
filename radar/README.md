# Tell Radar

Tell reads source code. Radar reads only the chain. It takes every contract it can find on Midnight Preprod, decodes its public state and the public transcript of its recent calls, and looks for three things that need no source to see:

1. **Guessable hashes.** A `persistentHash` of a small value is a lookup, not a secret. Radar hashes small domains the way the Compact runtime does and looks for the digests among every 32-byte value on chain. A hit names the hidden value, and anyone can check it by hashing it again.
2. **Repeated hidden values.** A map whose 32-byte values repeat cannot hold salted commitments: 32-byte random openings never collide. If six entries have four distinct values, they came from a small set, even when Radar cannot name the set.
3. **Linkable tags.** The same 32-byte value in several calls of a contract ties those calls together (the same tag on every action). The same value in two contracts ties those together too.

The acceptance test is Tell's own pair of ballots on Preprod. From chain data alone, Radar reads all six votes off the leaky ballot and nothing off the fixed one (`test/ballot.test.ts`, on a cached snapshot, no network).

## First scan of Preprod (7 November 2026)

Counts only; [`out/report.json`](out/report.json) has the rest. No contract except Tell's two ballots is named.

| | |
|---|---|
| Contracts scanned | 329 after overlaps: every contract that acted in the last 14 days (258), Preprod contracts named in buildathon repositories (70) and Tell's two ballots |
| Decoded | 329 of 329 states; 178,098 state cells; 5,014 calls' transcripts |
| 32-byte values matched | 146,059 distinct, against 320 million hashed candidates |
| Guessable hashes | 4 values recovered, all in Tell's leaky ballot: the four candidates, `persistentHash<Vector<2, Bytes<32>>>([pad(32, "ballot:choice"), n as Field as Bytes<32>])`. Nothing in any other contract |
| Repeated hidden values | 31 maps in 27 contracts out of 178 maps of digests: 17 hold one value in every entry (a reused key or constant), 11 hold between 2 and 16 values (a small-set sign), 3 hold more |
| Linkable tags | 173 of the 229 contracts with calls reuse a 32-byte value across calls (5,306 clusters, the largest 72 calls); in 84, one value appears in every call |
| Shared between contracts | 207 values appear in more than one contract (132 contracts involved) |

Tell's ballots, the acceptance test on live data: the leaky ballot gives 6 of 6 votes (candidate 0 once, 1 once, 2 three times, 3 once, which is Asha, Bilal, Chen ×3, Dara); the fixed ballot gives 0 of 6 and no repeated values. Both still link each voter's `register` call to their `vote` call by the voter tag (6 clusters each), which Tell reports as a low finding.

Reading it honestly: the brute force found nothing outside Tell's own leaky contract, so small-domain hashing is not common among the contracts live on Preprod, or it uses separators and shapes Radar does not yet try. The repeated-value and linkability counts are signs, not proofs; each needs reading against the contract before anyone is told about it.

Cost: about 3,850 indexer requests for the 14-day crawl, 87 for checking 3,445 candidate addresses, and about 260 for the contracts (each a state and its last 100 calls). Decoding the 329 contracts took about 20 minutes once; the hashing takes under 4 minutes on 3 threads at about 1.15 GB peak memory.

## Run it

```bash
export RADAR_BLOCKFROST_FILE=../chain/secrets/blockfrost-preprod   # or BLOCKFROST_PROJECT_ID
export RADAR_HOME=~/mn/work/radar                                     # cache, tables, private notes

npx tsx src/cli.ts tables                                              # numeric hash tables, once (400 MB on disk)
npx tsx src/cli.ts crawl    --network preprod --days 14 --budget 4100  # which contracts acted, newest blocks first
npx tsx src/cli.ts discover --network preprod --dir path/to/repos      # 64-hex strings in files that are Preprod contracts
npx tsx src/cli.ts scan     --network preprod [--addresses file] [--max N] [--actions 100] [--budget N] [--deep]
npm test -w radar
```

Radar is meant to run beside other work: it hashes on `RADAR_THREADS` threads (4 at most by default), keeps the numeric tables on disk and reads them in 8 MB slices, produces two-word prefixes 200,000 at a time, and stops itself if its memory passes `RADAR_MAX_RSS_MB` (1,500 by default). Decoded contracts are kept under `$RADAR_HOME/digest`, so only the first scan pays for decoding transactions.

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
- Coverage depends on finding the contracts. See below.

## Finding every contract

The indexer (Blockfrost-hosted for Preprod) has no query that lists contracts. `contract(address)` and the `contractActions` subscription both need an address, and `contractEvents` needs one too. The only complete route is reading every block:

- One request can ask for 50 blocks with the contract addresses in their transactions; 62 is rejected as "Query is too complex".
- Preprod's tip was block 3,315,086 on 7 November 2026, so the whole history is about 66,300 requests. Blockfrost's free tier is 50,000 requests a day, shared with Tell's live site, so a full crawl has to be spread over two or more days (`crawl` resumes where it stopped and `--budget` caps each run).
- A sample of 500 blocks spread over the whole history had 71 blocks with transactions and 65 contract actions: roughly 430,000 contract actions in all.

The scan in `out/report.json` covers the last 14 days of blocks (201,601 blocks, about 4,000 requests) plus every 64-hex string in the 111 public buildathon repositories that turned out to be a Preprod contract (`discover`, about 90 requests for 3,445 candidates).

## Ethics

Radar reads only public chain data. The published report has counts and nothing that identifies a contract, except Tell's own two ballots. The per-contract details stay private, outside the repository, and are for writing to the teams concerned, the same way the source survey was handled.
