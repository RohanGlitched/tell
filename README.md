# Tell

**A privacy leak scanner for Midnight.** Midnight keeps a contract's private inputs off the chain. What the contract does with them can still give them away: a hash of a vote, a branch on a balance, the same tag on every post. Tell reads a Compact contract the way the compiler does and shows, in bits, what each circuit tells the world.

Built for the [Midnight Buildathon](https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG) (Wave 2, October 2026). Apache-2.0.

## What it finds

| Finding | Severity | Example |
|---|---|---|
| Guessable hash | critical / high | `ballots.insert(tag, persistentHash(choice))`: four candidates, four guesses |
| Secret in the clear | critical | `owner = disclose(secretKey())` |
| Secret-dependent branch | medium | writing `qualified` or `belowReserve` depending on a hidden bid; count leaks in fixed-size loops |
| Same tag on every action | medium | every post stores `hash(memberKey)`, so one identified post unmasks the rest |
| Linkable tag | low / info | the same `hash(sk)` in register, commit and reveal |
| Published value / yes-no fact | info | values written on purpose, listed so nothing is hidden |

## How it works

1. Runs the real Compact compiler (`--trace-passes --skip-zk`), matched to the contract's pragma, preferring 0.31.1 (the ledger live today).
2. Reads the compiler's own `reduce-to-circuit` form: helpers inlined, loops unrolled, every step a guarded binding.
3. Traces every witness result and circuit argument through hashes, commitments, comparisons, struct fields and branches to every public ledger operation.
4. Grades A to F and reports as text, JSON or SARIF (GitHub code scanning).

## Run it

```bash
compact update 0.31.1
npm install
npx tsx engine/src/cli.ts path/to/contracts            # readable report
npx tsx engine/src/cli.ts . --sarif tell.sarif --fail-on high
```

In CI, use this repository as an action:

```yaml
- uses: RohanGlitched/tell@v1
  with: { path: contract, fail-on: high }
```

## Evidence

- **Leak zoo** (`zoo/`): five leaky contracts and their fixes. Each leak is carried out by an attack test that reads the secret back out of public state; each fix stops it.
- **Precision tests** (`engine/test`): every zoo leak reported exactly once, nothing above low on the fixes, plus findings in Midnight's own examples.
- **Survey** (`survey/`): every public repository linked from the buildathon on AKINDO, scanned. Results are published in aggregate; teams are told privately first.

## Layout

| Path | What |
|---|---|
| `engine/` | analyzer, CLI, SARIF |
| `zoo/` | leaky/fixed contract pairs, attack tests |
| `web/` | website: scanner, survey, zoo, live demo |
| `chain/` | Midnight Preview house wallet and deploy scripts |
| `action.yml` | GitHub Action |
