// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell's rules, one per finding kind, with a leak and its fix. The examples
// are the leak zoo's contracts (zoo/contracts), cut to the lines that matter,
// and the engine's own regression cases (engine/test/fixtures/src).

export type RuleId = 'guessable-hash' | 'secret-published' | 'published' | 'branch' | 'predicate' | 'attributable' | 'linkable' | 'derivable-secret';

export type Rule = {
  id: RuleId;
  name: string;
  severities: string;
  summary: string;
  explanation: string;
  quiet?: string;
  example: { source: string; leak: string; fix: string; attack: string };
};

export const RULES: Rule[] = [
  {
    id: 'guessable-hash',
    name: 'Guessable hash',
    severities: 'critical / high',
    summary: 'A private value is hidden behind a hash or commitment whose only unknown input is small, so brute force recovers it.',
    explanation:
      'Hashing a small value does not hide it: anyone can hash every candidate and compare with what is on the ledger. Tell counts the unknown bits that go into the hash. `assert(x < N)` bounds a value to log2(N) bits, so a vote among four candidates is 2 bits whatever its type, and inputs the same call already publishes (an employee id used as the map key) add nothing. Critical up to 40 unknown bits, high below 112.',
    quiet: 'A commitment whose randomness is a strong private value (a 32-byte salt) is hiding, and is not reported.',
    example: {
      source: 'zoo/contracts/ballot-leaky.compact, ballot-fixed.compact',
      leak: [
        'witness choice(): Uint<8>;',
        '',
        'export circuit vote(): [] {',
        '  const tag = disclose(voterTag(voterKey()));',
        '  const c = choice();',
        '  assert(c < 4, "there are four candidates");',
        '  ballots.insert(tag, disclose(choiceHash(c)));   // persistentHash of the choice: 2 bits',
        '}',
      ].join('\n'),
      fix: [
        'witness ballotSalt(): Bytes<32>;',
        '',
        '  ballots.insert(tag, disclose(persistentCommit<Uint<8>>(c, ballotSalt())));',
      ].join('\n'),
      attack: 'Hash the four choices and match them against the public ballots map: every vote is recovered. With a 32-byte salt held by the voter, the same attack matches nothing.',
    },
  },
  {
    id: 'secret-published',
    name: 'Secret in the clear',
    severities: 'critical / high',
    summary: 'A value that looks like a secret key reaches the public ledger as a readable value, or is returned from a circuit.',
    explanation:
      'Witness results are private, but `disclose()` of the value itself (or a reversible cast of it, such as `degradeToTransient`) puts it on the ledger for everyone. Tell also reports a value that the contract hashes as a key in one circuit and writes raw in another, and a secret returned from an exported circuit.',
    example: {
      source: 'zoo/contracts/vault-leaky.compact, vault-fixed.compact',
      leak: ['witness secretKey(): Bytes<32>;', '', 'export circuit claim(): [] {', '  owner = disclose(secretKey());', '}'].join('\n'),
      fix: [
        'export pure circuit publicKey(sk: Bytes<32>): Bytes<32> {',
        '  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "vault:owner"), sk]);',
        '}',
        '',
        'export circuit claim(): [] {',
        '  owner = disclose(publicKey(secretKey()));',
        '}',
      ].join('\n'),
      attack: 'Read owner from the ledger, use it as the secret key, and withdraw. A hash of the key does not work as a key.',
    },
  },
  {
    id: 'published',
    name: 'Published value',
    severities: 'medium / low / info',
    summary: 'A private input is written to the public ledger as a readable value.',
    explanation:
      'Usually on purpose (an amount, a public message), and listed as info so nothing is hidden. It is medium when the value is private bytes (a seed or private key by name: seed, key, secret, sk; not a public key, id or commitment), personal data (a salary, an age, a location), or a user\'s wallet key from `ownPublicKey()`, which ties all their activity to one wallet. An officer key set once (owner, authority) is low: that is the usual admin design. Mark a value that is public on purpose with `// tell:allow published` on the line.',
    example: {
      source: 'engine/test/fixtures/src/case-seeds-allow.compact, case-wallet-key.compact',
      leak: ['witness seed(): Bytes<32>;', '', 'export circuit reveal(slot: Uint<8>): [] {', '  const s = seed();', '  seeds.insert(disclose(slot), disclose(s));', '}', '', 'export circuit join(): [] {', '  players.insert(disclose(ownPublicKey()));', '}'].join('\n'),
      fix: [
        '// If the value must stay private, store a salted commitment:',
        '  seeds.insert(disclose(slot), disclose(persistentCommit<Bytes<32>>(s, seedSalt())));',
        '',
        '// If it is public on purpose, say so once:',
        '  seeds.insert(disclose(slot), disclose(s)); // tell:allow published',
        '',
        '// For players, store a hash of a per-contract secret instead of the wallet key.',
      ].join('\n'),
      attack: 'Read the value from the ledger. For a wallet key, group every transaction that stores it.',
    },
  },
  {
    id: 'branch',
    name: 'Secret-dependent branch',
    severities: 'medium / low',
    summary: 'Which ledger operations run depends on a private value, so the public transcript shows which way the branch went.',
    explanation:
      'Every ledger operation and whether it ran at all is public. Writing `qualified` on one path and `belowReserve` on the other publishes the comparison. Count leaks are the same thing: a fixed-size loop that only touches the ledger for used slots. Low when nothing in the circuit identifies the caller (an anonymous tally), or when the branch is on a tree position, a division hint or the current time.',
    quiet: 'A branch is not reported when both paths run the same operation with the same public operands, or when the value is published anyway.',
    example: {
      source: 'zoo/contracts/reserve-leaky.compact, reserve-fixed.compact',
      leak: [
        '  const a = amount();',
        '  bids.insert(tag, disclose(persistentCommit<Uint<64>>(a, bidSalt())));',
        '  if (disclose(a >= reserve)) {',
        '    qualified.insert(tag);',
        '  } else {',
        '    belowReserve.insert(tag);',
        '  }',
      ].join('\n'),
      fix: ['  const a = amount();', '  assert(a >= reserve, "bids below the reserve are not accepted");', '  bids.insert(tag, disclose(persistentCommit<Uint<64>>(a, bidSalt())));'].join('\n'),
      attack: 'Read the two sets: which bidders met the reserve is public. With the assert, every accepted bid leaves an identical trace.',
    },
  },
  {
    id: 'predicate',
    name: 'Published yes/no fact',
    severities: 'info',
    summary: 'A comparison over a private value is written to the ledger: one bit per call.',
    explanation: 'Usually intended (an eligibility flag, a passed check). Listed so nothing is hidden. Use `assert()` when the chain does not need to store the fact.',
    example: {
      source: 'illustrative; mcp/test checks that Tell reports it',
      leak: ['witness creditScore(): Uint<16>;', '', 'export circuit apply(): [] {', '  approved = disclose(creditScore() >= 700);', '}'].join('\n'),
      fix: ['export circuit apply(): [] {', '  assert(creditScore() >= 700, "score too low");', '  approved = true;', '}'].join('\n'),
      attack: 'Read approved: one bit about the score per applicant.',
    },
  },
  {
    id: 'attributable',
    name: 'Same tag on every action',
    severities: 'medium',
    summary: 'Each repeated action stores the same hash of a key, so one identified action unmasks all the others.',
    explanation:
      'A deterministic tag such as `hash(memberKey)` stored with every post hides who the member is, but groups all their posts. If any one post is tied to a person, every post is. Use a Merkle membership proof and a one-time tag per action, for example `hash(key, post number)`.',
    example: {
      source: 'zoo/contracts/board-leaky.compact, board-fixed.compact',
      leak: ['export circuit post(text: Bytes<32>): [] {', '  const tag = disclose(memberTag(memberKey()));', '  assert(members.member(tag), "members only");', '  const n = count.read() as Uint<32>;', '  posts.insert(n, disclose(text));', '  authors.insert(n, tag);', '}'].join('\n'),
      fix: [
        'export circuit post(text: Bytes<32>): [] {',
        '  const sk = memberKey();',
        '  const path = memberPath(memberLeaf(sk));',
        '  assert(members.checkRoot(disclose(merkleTreePathRoot<10, Bytes<32>>(path))), "members only");',
        '  const n = count.read() as Uint<32>;',
        '  tags.insert(disclose(persistentHash<Vector<3, Bytes<32>>>([pad(32, "board:post"), sk, (n as Field) as Bytes<32>])));',
        '  posts.insert(n, disclose(text));',
        '}',
      ].join('\n'),
      attack: 'Group the public authors map by tag: five posts by two members split 3 and 2. With one-time tags, five posts carry five unrelated tags.',
    },
  },
  {
    id: 'linkable',
    name: 'Linkable tag',
    severities: 'medium / low / info',
    summary: 'The same hash of a key is published by several circuits, tying a user\'s transactions together.',
    explanation:
      'Fine for registrations and nullifiers, where linking is the point. Worth a look when the circuits are meant to be unlinkable (register, commit, reveal). Mix in a per-action counter or fresh randomness for repeated actions. Low when a key tag has no domain separator and no contract address, so any contract hashing the same secret the same way publishes the same tag. Medium when a circuit proves membership by looking up the caller\'s own tag (`Set.member(hash(key))`): the lookup key is public, so every call names the member; prove membership with a Merkle `checkRoot` instead.',
    quiet: 'Hashes that mix in a per-use nonce, salt or a changing counter link nothing and are not reported.',
    example: {
      source: 'zoo/contracts/ballot-leaky.compact (register and vote)',
      leak: ['export circuit register(): [] {', '  voters.insert(disclose(voterTag(voterKey())));', '}', '', 'export circuit vote(): [] {', '  const tag = disclose(voterTag(voterKey()));', '  ballots.insert(tag, ...);', '}'].join('\n'),
      fix: '// Expected for a voter roll: the tag links register to vote by design.\n// To unlink them, register a Merkle leaf and vote with a nullifier hash(key, election id).',
      attack: 'Match the tag in voters with the key of ballots: who registered is who voted.',
    },
  },
  {
    id: 'derivable-secret',
    name: 'Public value used as a private key',
    severities: 'critical',
    summary: 'A public key is made from a private scalar that anyone can compute, because the contract also publishes that value.',
    explanation:
      '`ecMulGenerator(k)` is a public key whose private key is `k`. When `k` is a hash the contract also writes to the ledger (an account id, say), or a public function of one, with nothing secret mixed in, everyone holds the private key: they can decrypt what is encrypted to it or sign as it. Derive the key under its own domain separator so it differs from every published value.',
    quiet: 'Different domain separators for the published id and the key (`hash("app:id", seed)` and `hash("app:enc", seed)`) are not reported.',
    example: {
      source: 'bench/cases/L16-public-digest-as-key.compact, S13-separate-key-domain.compact',
      leak: ['witness seed(): Bytes<32>;', '', 'export circuit register(): [] {', '  const id = persistentHash<Vector<1, Bytes<32>>>([seed()]);', '  accountId = disclose(id);', '  encKey = disclose(ecMulGenerator(degradeToTransient(id)));   // private key = accountId', '}'].join('\n'),
      fix: [
        'export circuit register(): [] {',
        '  accountId = disclose(persistentHash<Vector<2, Bytes<32>>>([pad(32, "acct:id"), seed()]));',
        '  const k = persistentHash<Vector<2, Bytes<32>>>([pad(32, "acct:enc"), seed()]);',
        '  encKey = disclose(ecMulGenerator(degradeToTransient(k)));',
        '}',
      ].join('\n'),
      attack: 'Read accountId, compute degradeToTransient(accountId) and use it as the private key of encKey.',
    },
  },
];

export const ruleById = (id: string): Rule | undefined => RULES.find((r) => r.id === id);

export function ruleMarkdown(r: Rule): string {
  return [
    `# ${r.name} (\`${r.id}\`)`,
    '',
    `Severity: ${r.severities}`,
    '',
    r.summary,
    '',
    r.explanation,
    ...(r.quiet ? ['', `Not reported: ${r.quiet}`] : []),
    '',
    `## Leak (${r.example.source})`,
    '',
    '```compact',
    r.example.leak,
    '```',
    '',
    '## Fix',
    '',
    '```compact',
    r.example.fix,
    '```',
    '',
    `Attack: ${r.example.attack}`,
    '',
    'More: https://tell-midnight.vercel.app/how',
  ].join('\n');
}
