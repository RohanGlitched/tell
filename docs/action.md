# Tell in GitHub Actions

Tell runs as a composite GitHub Action. On every run it scans your Compact contracts with the real compiler, writes a job summary and sends the findings to code scanning. On a pull request it also comments on the changed lines that leak, says how many bits each one gives away, and offers the fix as a suggestion you can commit from the pull request, once Tell has compiled the fixed contract and scanned it again.

## Add it to a repository

Copy [`examples/tell-pr-review.yml`](../examples/tell-pr-review.yml) to `.github/workflows/tell.yml`:

```yaml
name: tell

on:
  pull_request:
    paths: ['**/*.compact']
  push:
    branches: [main]
    paths: ['**/*.compact']

permissions:
  contents: read          # check out the code
  pull-requests: write    # inline review comments
  security-events: write  # findings in code scanning (SARIF)

jobs:
  tell:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: RohanGlitched/tell@v1
        with:
          path: contract
          fail-on: high
```

Set `path` to the directories or files that hold your contracts.

## Permissions

| Permission | Why | Without it |
|---|---|---|
| `contents: read` | check out the code | nothing to scan |
| `pull-requests: write` | post and update review comments | the job summary and code scanning still work; the log shows a warning and no comments are posted |
| `security-events: write` | upload SARIF to code scanning | set `upload-sarif: 'false'` |

The comments are posted with the workflow's own `GITHUB_TOKEN` (the `github-token` input defaults to it). Pull requests from forks get a read-only token, so Tell skips the comments there with a warning and still writes the summary. Running on `pull_request_target` to get a write token means building code from the fork with that token; only do that if you have read GitHub's guidance on it.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `path` | `.` | directories or files with `.compact` contracts, space-separated |
| `fail-on` | `high` | fail the job at this severity or worse: `critical`, `high`, `medium`, `low`, `info` or `none` |
| `compact-version` | `0.31.1` | Compact toolchain to install |
| `upload-sarif` | `true` | send findings to GitHub code scanning |
| `comment` | `true` | on pull requests, post review comments on changed lines |
| `suggest-fixes` | `true` | work out verified fixes and offer them in comments and the summary |
| `comment-on` | `medium` | lowest severity that gets an inline comment |
| `github-token` | `${{ github.token }}` | token for the comments |

Outputs: `sarif` (path of the SARIF file) and `results` (path of the JSON results, with the fixes when `suggest-fixes` is on).

## What a pull request gets

One review comment per finding at `comment-on` or worse that sits on a line the pull request adds or changes. Each comment says:

- the severity and the kind of leak, the circuit and the ledger operation;
- what is revealed, in bits: "2 bits of `choice` (Uint<8>); at most 4 guesses recover it", "all 256 bits of `secretKey`", "1 bit about `amount` per call";
- the fix. When Tell has a verified patch and every line it changes is inside the pull request's diff (up to 15 lines), the patch is a GitHub suggestion covering exactly those lines, so **Commit suggestion** applies it. Otherwise the patch is shown as a diff in a collapsed block. Where no rewrite is safe, the comment gives the manual fix in words.

A comment on the board contract from the leak zoo looks like this:

````markdown
**Tell · medium · same tag on every action** in `post` (`authors` insert)

every `post` stores the same tag derived from memberKey(). **Revealed:** no bits of `memberKey`
itself, but every action by the same holder carries the same value.

**Verified fix:** store a one-time tag, hash(domain, secret, entry key), instead of the same tag
on every entry. Compiles with Compact 0.31.1, finding gone, grade C → B.

```suggestion
  authors.insert(n, disclose(persistentHash<Vector<3, Bytes<32>>>([pad(32, "board-leaky:authors"), memberKey(), (n as Field) as Bytes<32>])));
```
- `members.member` still receives the same tag in every `post` transcript, so the transactions
  themselves stay linkable. To make them unlinkable too, prove membership with a Merkle path ...
````

Findings on lines the pull request does not touch are not commented inline; they are counted in the job summary and appear in code scanning.

### Re-runs

Every comment carries a hidden marker, `<!-- tell:v1 key=… -->`, keyed on the file, circuit, kind of finding, ledger field and private inputs (not the line, so moving code does not create a new key). On the next push Tell:

- leaves a comment alone when it would say the same thing;
- edits it in place when the text changed (a new grade, a different fix);
- posts a fresh comment when the old one is outdated (its line left the diff), and marks the old one as moved;
- marks a comment resolved when its finding is no longer reported, keeping the earlier text in a collapsed block.

Comments written by people are never touched.

## The job summary

Every run, push or pull request, writes a summary to the job page: a grade per contract, the grade after applying every verified fix, a table of findings at `comment-on` or worse with the bits revealed and the fix, and the combined patch.

## How fixes are verified

For each finding at medium or worse, Tell tries the rewrite for that kind of leak (the same rewrite the leak zoo's fixed contracts make). A patch is only offered if:

1. the patched contract compiles with the same compiler version that compiled the original;
2. scanning the patched contract no longer reports that finding (nothing above info for the same circuit, kind and field);
3. the patched contract has no new finding at medium or worse.

Otherwise the comment says the rewrite was tried and rejected, and gives the manual fix.

| Finding | Rewrite | Notes |
|---|---|---|
| guessable hash | `disclose(hash(x))` becomes `disclose(persistentCommit<Bytes<32>>(hash(x), xNonce()))`, with a new `witness xNonce(): Bytes<32>;` | the DApp must return 32 fresh random bytes for the nonce on every call and keep them to open the commitment later |
| secret key in the clear | `owner = disclose(sk)` becomes `owner = disclose(persistentHash<Vector<2, Bytes<32>>>([pad(32, "<file>:<field>"), sk]))`; every `owner == …sk…` check in the contract is hashed the same way | off-chain code that reads the field gets the hash |
| same tag on every action | a Map entry's tag becomes `persistentHash([domain, secret, entry key])`, different per entry; elsewhere a commitment with a fresh nonce | other operations that still read the same tag (a membership check) are named in the comment |
| secret-dependent branch | `if (disclose(c)) { A } else { B }` becomes `assert(c, …); A` | changes behaviour: calls on the other path are rejected. Not offered inside loops |
| personal value in the clear | the value becomes a commitment with a fresh nonce and the field's type becomes `Bytes<32>` | rejected by verification when the rest of the contract reads the field as a number |

Manual only: a wallet key (`ownPublicKey()`) stored as an identity, a secret returned from a circuit, a value written raw here and hashed elsewhere (often a commit-reveal), token operations, and hashes whose only unknowns are Merkle path bits.

## On your machine

```bash
npx tsx engine/src/cli.ts contract --fix-dry-run   # print each verified fix as a unified diff
npx tsx engine/src/cli.ts contract --fix           # apply them, then scan again
```

`--fix` writes all verified fixes for a file together, applied one at a time and verified again as a whole. With `--fail-on`, the exit code reflects the files after the fix.

## Silencing a finding

Some disclosures are the point. Mark the line and Tell stops reporting it, in comments, the summary and code scanning:

```compact
seeds.insert(slot, s); // tell:allow published
```
