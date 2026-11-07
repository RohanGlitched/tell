# Tell for VS Code

Tell marks the lines of a Midnight Compact contract that give private data away, says how many bits, and shows the fix. It runs the real Compact compiler on each contract when you open or save it, reads the compiler's own circuit form, and traces every private input to the public ledger. Same engine as the [Tell CLI, GitHub Action and web scanner](https://github.com/RohanGlitched/tell).

## What it does

- **Diagnostics on open and on save** for every `.compact` contract. Severity follows Tell's: critical and high are errors, medium a warning, low information; info findings (values published on purpose) are hidden unless `tell.minSeverity` is `info`. The message says what is revealed and how many bits, for example `critical: choice() is hidden behind a persistentHash anyone can reverse (2 bits)`.
- **Related information** on each diagnostic: the public transcript line a chain observer sees, such as `ballots.insert(persistentHash(voterKey()): same tag each call, persistentHash(choice()): guessable, 2 bits)`, linked to the ledger field's declaration.
- **Hover** on a marked line: what leaks, Tell's explanation, the fix, the transcript, and a link to the full fix.
- **Quick fix "Show Tell's fix"** (the light bulb, or `Ctrl+.`): opens a side preview with the finding, the change to make, and the rule with a worked leak and fix from Tell's leak zoo.
- **Status bar grade** for the active contract, A to F: red for D and F, amber for C. Click it for the Problems panel.
- `// tell:allow` and `// tell:allow <rule>` on a line (or the line above) silence a finding, as in the CLI.

Module and include files (no `export circuit`, `export ledger` or `constructor` of their own) are not scanned on their own; the contract that includes them is.

## What you see

These are described in words; there are no screenshots in this README yet.

1. A contract with `ballots.insert(tag, disclose(choiceHash(c)));` gets a red squiggle under that statement. The Problems panel lists `critical: choice() is hidden behind a persistentHash anyone can reverse (2 bits)` with source `Tell` and code `guessable-hash`, and below it the related line `public transcript of vote: ballots.insert(...)`.
2. Hovering the squiggle shows the explanation, the fix (`persistentCommit(choice, salt)` with a 32-byte salt) and a "Show Tell's fix" link.
3. The status bar reads `Tell: F` on a red background. After the fix and a save it reads `Tell: A`.

## Requirements

- The Compact compiler, installed with Midnight's `compact` tool: `compact update 0.31.1` (Tell prefers 0.31.1 for Ledger 8 contracts and uses 0.36.0 for Ledger 9 contracts (mainnet since November 6, 2026; `compact update 0.36.0`), and falls back to any installed version the contract's pragma accepts). Tell looks in `~/.compact/versions`, or in `tell.compilerDirs`.
- Linux or macOS, or Windows through **WSL**: the compiler runs on Linux, so open the folder in WSL (Remote - WSL) and install the extension there. The extension declares itself a workspace extension, so in a remote window it runs on the remote side, next to the compiler.
- For syntax highlighting, snippets and compiler errors, install Midnight's own Compact extension (distributed as a `.vsix` from Midnight's release page; see [docs.midnight.network](https://docs.midnight.network/compact/compilation-and-tooling/vscode-plugin)). Tell does not ship a grammar so it does not compete with it; the two work side by side. Tell matches files by their `.compact` extension, whatever language id another extension gives them, and activates in any workspace that contains one.

## Settings

| Setting | Default | What |
|---|---|---|
| `tell.enable` | `true` | Scan Compact contracts. |
| `tell.scanOnSave` | `true` | Scan each time a contract is saved. |
| `tell.scanOnOpen` | `true` | Scan when a contract is opened. |
| `tell.minSeverity` | `low` | Show findings at this severity or worse. |
| `tell.compilerVersion` | empty | Use this compiler version, for example `0.31.1`. Empty: what the pragma accepts, preferring 0.31.1. |
| `tell.compilerDirs` | `[]` | Directories holding `compactc.bin`, or paths to it. Empty: everything `compact update` installed. |
| `tell.cliPath` | empty | Run an external Tell CLI instead of the bundled engine: a clone's `engine/src/cli.ts` (run with `npx tsx`) or a `tell` executable, called with `--json`. |

Commands: **Tell: Scan this contract**, **Tell: Show Tell's fix** (from a diagnostic), **Tell: Show output** (the log of each scan, with compile errors).

## Install

Build the `.vsix` from a clone (in WSL on Windows):

```bash
npm install
npm run package -w vscode     # writes vscode/dist/tell-vscode.vsix
code --install-extension vscode/dist/tell-vscode.vsix
```

In a Remote - WSL window, run the last command from the WSL terminal so it installs on the WSL side. The extension is not on the Marketplace yet.

## Development

```bash
npm test -w vscode        # mapping, parsing, status and runner tests (no VS Code instance needed)
npm run typecheck -w vscode
npm run build -w vscode   # dist/extension.cjs, the engine bundled in
```

The tests build Tell results from the compiler output recorded in `engine/test/fixtures`, so the mapping tests run without a compiler; the runner tests use the real compiler when one is installed and are skipped otherwise.

## License

Apache-2.0
