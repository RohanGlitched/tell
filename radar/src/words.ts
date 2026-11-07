// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The vocabulary Radar guesses domain separators and labels from. It is a
// general list of words that name things in contracts (no contract's actual
// separators are listed), plus whatever a contract says about itself on chain:
// its entry-point names are public, and their parts are added per scan.

export const COMMON_WORDS: string[] = [
  // identity and access
  'user', 'users', 'owner', 'admin', 'member', 'members', 'voter', 'voters', 'player', 'players', 'account', 'accounts',
  'identity', 'id', 'key', 'pk', 'sk', 'pubkey', 'secret', 'auth', 'role', 'issuer', 'holder', 'agent', 'device', 'patient',
  'doctor', 'employee', 'employer', 'student', 'org', 'group', 'team', 'party', 'sender', 'receiver', 'recipient', 'creator',
  // voting and governance
  'vote', 'votes', 'ballot', 'ballots', 'choice', 'option', 'options', 'candidate', 'poll', 'proposal', 'election', 'tally',
  'yes', 'no', 'abstain', 'dao', 'quorum',
  // markets and money
  'bid', 'bids', 'ask', 'offer', 'order', 'auction', 'price', 'amount', 'balance', 'value', 'token', 'coin', 'payment', 'pay',
  'fee', 'escrow', 'loan', 'credit', 'score', 'salary', 'income', 'reserve', 'deposit', 'withdraw', 'trade', 'swap', 'pool',
  'invoice', 'tip', 'donation', 'fund', 'grant', 'bounty', 'reward', 'stake', 'market', 'item', 'asset', 'nft',
  // commitments and protocol words
  'commit', 'commitment', 'reveal', 'nullifier', 'nonce', 'salt', 'hash', 'tag', 'domain', 'seed', 'proof', 'claim', 'attest',
  'attestation', 'credential', 'cert', 'certificate', 'signature', 'sig', 'leaf', 'root', 'state', 'round', 'epoch', 'session',
  'counter', 'index', 'slot', 'version', 'ticket', 'entry', 'record', 'report', 'message', 'msg', 'post', 'comment', 'board',
  // games and misc
  'game', 'move', 'guess', 'card', 'hand', 'dice', 'roll', 'ship', 'board', 'shot', 'hit', 'miss', 'win', 'winner', 'level',
  'age', 'country', 'region', 'location', 'status', 'kyc', 'health', 'medical', 'data', 'email', 'name', 'midnight', 'contract',
  'app', 'dapp', 'prefix', 'v1',
];

export const SEPARATORS = [':', '_', '-', '/', '.', ''];

/** Lower-case parts of an entry-point name: "castVote" -> ["cast", "vote", "castvote", "cast_vote"]. */
export function nameParts(name: string): string[] {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map((s) => s.toLowerCase());
  const out = new Set<string>([name, ...parts]);
  if (parts.length > 1) {
    out.add(parts.join(''));
    out.add(parts.join('_'));
  }
  return [...out].filter((s) => s.length > 0 && Buffer.byteLength(s) <= 32);
}

export function vocabulary(entryPoints: Iterable<string> = []): string[] {
  const out = new Set(COMMON_WORDS);
  for (const e of entryPoints) for (const p of nameParts(e)) out.add(p);
  return [...out];
}

/** Single-word separators: "w" and "w:". */
export function singlePrefixes(words: string[]): string[] {
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    if (Buffer.byteLength(w) < 32) out.add(`${w}:`);
  }
  return [...out];
}

/** Two-word separators: "a:b", "a_b", "a-b", "a/b", "a.b", "ab" and "a:b:". */
export function pairPrefixes(words: string[]): string[] {
  const out = new Set<string>();
  for (const a of words) for (const b of words) {
    if (a === b) continue;
    for (const s of SEPARATORS) {
      const p = `${a}${s}${b}`;
      if (Buffer.byteLength(p) <= 32) out.add(p);
    }
    const t = `${a}:${b}:`;
    if (Buffer.byteLength(t) <= 32) out.add(t);
  }
  return [...out];
}
