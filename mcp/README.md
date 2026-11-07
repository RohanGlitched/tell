# Tell MCP server

Coding agents write Compact contracts now, and they write `persistentHash(vote)` as readily as people do. This server gives any MCP client (Claude Code, Claude Desktop, Cursor, VS Code, and others) Tell's privacy check as tools, so an agent can scan the contract it just wrote, read why a line leaks, apply the fix and confirm it, before the contract is deployed and its history is public for good.

It runs the real Compact compiler and Tell's engine on your machine. Nothing is sent anywhere.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `tell_scan` | `source` (contract text) and/or `path` (a `.compact` file or a directory), optional `compiler` version, optional `includeInfo`, optional `policy` (the JSON a `tell.json` holds; by default the nearest `tell.json` above `path` applies) | Per contract: grade A to F, counts per severity, each finding (rule, severity, circuit, line, what is revealed, bits, detail, fix, the public transcript line it shows up in) and each circuit's private inputs and public transcript. |
| `tell_check_fix` | `original` and `revised` source, optional `path`, `compiler` and `policy` | Grade before and after, which findings are resolved, which remain (with any severity change) and which are new, and a one-line verdict. An agent calls it after each edit until the grade is A, or only findings it has confirmed are intended remain. |
| `tell_explain_rule` | `rule` (a finding's `rule`, e.g. `guessable-hash`, or a SARIF id like `tell/branch/medium`) | What the rule means, when it is quiet, and a leaking example with its fix, from Tell's leak zoo. |

Also:

- Resource `tell://rules`: every rule as JSON; `tell://rules/{id}`: one rule as Markdown.
- Prompt `privacy-review` (argument `path`): scan, fix, re-check until the grade is A.

With `source` only, the text is written to a fresh temporary directory (`TELL_TMPDIR`, else the OS temp directory) and removed after the scan. With `source` and `path`, it is written next to `path` under a hidden temporary name, so `include` and module imports resolve as in your project, and removed after the scan.

### Example

An agent writes a ballot that stores `persistentHash(choice)` after `assert(c < 4)` and calls `tell_scan` with the source. The text part of the result reads (from a real run on `zoo/contracts/ballot-leaky.compact`):

```
contract.compact: grade F, compact 0.31.1, 2 circuits: 1 critical, 2 low

[critical] guessable-hash in vote, line 36: choice() is hidden behind a persistentHash anyone can reverse (2 bits)
  `ballots` receives persistentHash(… choice() …), but the only unknown input is choice() (Uint<8>), about 2 bits. Anyone reading the chain can try every value (at most 4 tries) and recover it.
  fix: Use persistentCommit(value, salt) with a fresh 32-byte random salt kept in private state, or mix a 32-byte secret into the hash.
  public: ballots.member(persistentHash(voterKey()): same tag each call)
  public: ballots.insert(persistentHash(voterKey()): same tag each call, persistentHash(choice()): guessable, 2 bits)

[low] linkable in register, line 27: voterKey() is hidden, but leaves the same tag every time (linkable)
  ...
```

The structured part has the same data as JSON. The agent swaps the hash for `persistentCommit(c, ballotSalt())` (the zoo's fix), calls `tell_check_fix` with both versions, and is told the guessable hash is resolved and only the two low linkable-tag findings, which a voter roll needs, remain.

Try it over stdio, the way a client starts the server: `npm run build -w mcp && node mcp/scripts/smoke.mjs [file.compact]` (or `--src` to run the TypeScript source).

## Requirements

- Node.js 22 or later.
- The Compact compiler: `compact update 0.31.1` (Tell prefers 0.31.1 for Ledger 8 contracts and uses 0.36.0 for Ledger 9 contracts (mainnet since November 6, 2026; `compact update 0.36.0`), and falls back to any installed version the contract's pragma accepts). Tell finds compilers under `~/.compact/versions`, or in `TELL_COMPILERS` (comma-separated directories holding `compactc.bin`).
- On Windows, the compiler runs in WSL, so the server runs in WSL too (see Claude Desktop below).

## Set up

From a clone of [RohanGlitched/tell](https://github.com/RohanGlitched/tell):

```bash
npm install
npm run build -w mcp        # mcp/dist/server.js, the engine bundled in
```

Then point your client at `node /path/to/tell/mcp/dist/server.js`. Without building, `/path/to/tell/node_modules/.bin/tsx /path/to/tell/mcp/src/server.ts` runs the source directly, and from the clone's root `npx tsx mcp/src/server.ts` does the same.

The package is ready to publish to npm as `tell-compact-mcp` (`npm pack -w mcp` builds it); it is not published yet. Once it is, `npx -y tell-compact-mcp` replaces the `node .../dist/server.js` command below.

### Claude Code

```bash
claude mcp add tell -- node /path/to/tell/mcp/dist/server.js
# for every project:
claude mcp add --scope user tell -- node /path/to/tell/mcp/dist/server.js
```

### Claude Desktop

`claude_desktop_config.json` (Settings, Developer, Edit config). On Linux or macOS:

```json
{
  "mcpServers": {
    "tell": { "command": "node", "args": ["/path/to/tell/mcp/dist/server.js"] }
  }
}
```

On Windows, with the clone and the compiler in WSL (nvm users keep the `source` part):

```json
{
  "mcpServers": {
    "tell": {
      "command": "wsl.exe",
      "args": ["-e", "bash", "-lc", "source ~/.nvm/nvm.sh >/dev/null; node ~/tell/mcp/dist/server.js"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for all projects:

```json
{
  "mcpServers": {
    "tell": { "command": "node", "args": ["/path/to/tell/mcp/dist/server.js"] }
  }
}
```

### VS Code (agent mode)

`.vscode/mcp.json` in the workspace:

```json
{
  "servers": {
    "tell": { "type": "stdio", "command": "node", "args": ["/path/to/tell/mcp/dist/server.js"] }
  }
}
```

In a Remote - WSL window the server runs on the WSL side, next to the compiler. For diagnostics in the editor itself, see the [Tell VS Code extension](../vscode).

### Environment

| Variable | What |
|---|---|
| `TELL_COMPILERS` | Comma-separated directories holding `compactc.bin`, instead of `~/.compact/versions`. |
| `TELL_PREFERRED_COMPILER` | Version tried first when the pragma allows several (default `0.31.1`). |
| `TELL_TMPDIR` | Where source text is written for a scan (default the OS temp directory). |

## Tests

```bash
npm test -w mcp
```

An MCP client talks to the server over the SDK's in-memory transport and calls every tool: each leaky zoo contract is reported with the right rule and severity, each fixed one is clean, `tell_check_fix` confirms each zoo fix and catches a half fix (a commitment with a constant salt) and a revision that does not compile. Scans need the compiler; without one those tests are skipped and the rest still run.

## License

Apache-2.0
