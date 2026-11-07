import crypto from 'node:crypto';
import type { Metadata } from 'next';
import Link from 'next/link';
import CodePane from '@/components/CodePane';
import zoo from '@/data/zoo.json';
import precomputed from '@/data/sample-results.json';
import type { ScanResponse } from '@/lib/types';
import { PageHead } from '@/components/ui';
import { numberWord, tests, zooCounts } from '@/lib/content';

export const metadata: Metadata = {
  title: 'Leak zoo',
  description: `${numberWord(zooCounts.pairs, true)} small Compact contracts that leak, each with its fix, Tell’s finding, and an attack test that recovers the secret from public state.`,
};

type Case = {
  id: string;
  name: string;
  kind: string;
  severity: 'critical' | 'high' | 'medium'; // fallback; the precomputed scan's worst finding wins
  story: string;
  finding: string;
  attack: string;
  fix: string;
};

const CASES: Case[] = [
  {
    id: 'ballot',
    name: 'The secret ballot',
    kind: 'Guessable hash',
    severity: 'critical',
    story: 'Each vote is stored as hash(choice). It looks like a commitment. With four candidates, it is a lookup table.',
    finding: 'choice() is hidden behind a persistentHash anyone can reverse: 2 bits once the contract asserts c < 4, at most 4 tries.',
    attack: 'The test casts twelve votes, then hashes the four choices and matches them against the public ballots map: every vote recovered.',
    fix: 'persistentCommit(choice, salt) with a 32-byte salt that only the voter holds. The same attack matches nothing.',
  },
  {
    id: 'payband',
    name: 'The salary record',
    kind: 'Guessable hash',
    severity: 'critical',
    story: 'An employer files hash(employee id, salary) so staff can prove their pay to a lender later. The id is the public map key, so the salary is the only unknown.',
    finding: 'salary() is hidden behind a persistentHash anyone can reverse; Tell notices the employee id is published in the same call and does not count it as secret.',
    attack: 'The test brute-forces monthly salaries from ₹50 to ₹1,00,000 in ₹50 steps against the public records: all three salaries recovered in under a second.',
    fix: 'A commitment to the whole payslip with a random salt handed to the employee with the slip.',
  },
  {
    id: 'reserve',
    name: 'The sealed sale',
    kind: 'Secret-dependent branch',
    severity: 'medium',
    story: 'Bids are committed properly, but the contract files each bidder under qualified or belowReserve depending on the hidden amount.',
    finding: 'Whether qualified is touched depends on amount(). The public transcript names the set that was written.',
    attack: 'The test places five bids and reads the two sets: which bidders met the reserve is public.',
    fix: 'Assert the reserve instead of branching on it: every accepted bid leaves an identical trace, low bids never land.',
  },
  {
    id: 'vault',
    name: 'The vault',
    kind: 'Secret in the clear',
    severity: 'critical',
    story: 'The vault remembers its owner by storing the owner’s secret key.',
    finding: 'secretKey() looks like a secret key, and it is written to owner as a readable value.',
    attack: 'The test reads owner from the ledger, uses it as its own secret key, and withdraws.',
    fix: 'Store a hash of the key; prove knowledge of the key in the circuit. The thief’s copy of the hash does not work as a key.',
  },
  {
    id: 'board',
    name: 'The staff board',
    kind: 'Same tag on every action',
    severity: 'medium',
    story: 'An anonymous feedback board. Nobody learns who a member is, but every post stores the same author tag.',
    finding: 'Every post stores the same tag derived from memberKey(): one identified post unmasks all of that person’s posts.',
    attack: 'Two members write five posts; grouping the public authors map by tag splits them 3 and 2.',
    fix: 'A Merkle membership proof plus a one-time tag hash(key, post number) per post. Five posts, five unrelated tags.',
  },
  {
    id: 'raffle',
    name: 'The raffle',
    kind: 'Guessable hash, in the constructor',
    severity: 'critical',
    story: 'The organiser seals the winning number at deploy time as hash(number). There are 10,000 tickets, and the seal sits in the contract’s initial state.',
    finding: 'The constructor writes a hash whose only unknown is the winning number, about 14 bits. Tell now traces constructors the same way as circuits.',
    attack: 'The test deploys the raffle and hashes every ticket against the initial state: the winning number is read before a single ticket is sold.',
    fix: 'Seal the number in a commitment salted with 32 random bytes from the organiser’s private state. The same search finds nothing; the organiser can still open the draw.',
  },
  {
    id: 'faucet',
    name: 'The faucet',
    kind: 'Shielded mint, public nonce',
    severity: 'high',
    story: 'A faucet mints a shielded coin to each caller, deriving the coin nonce from a counter in the public ledger. The token and amount are public too.',
    finding: 'With the nonce, colour and value public, the coin commitment’s only unknown is the recipient: one hash per known wallet key says who received each coin.',
    attack: 'The test mints to four claimers and matches every coin commitment against eight known wallet keys: each recipient is named.',
    fix: 'Derive the nonce from a 32-byte seed in each claimer’s private state, as Midnight’s shielded token tutorial does. The commitment then hides who received the coin.',
  },
  {
    id: 'deposit',
    name: 'The deposit',
    kind: 'Private amount, paid in the clear',
    severity: 'high',
    story: 'Bids are sealed in salted commitments, which is right. Then each bidder locks exactly the bid amount in unshielded tokens.',
    finding: 'The unshielded amount locked by the circuit is the private bid: token amounts are part of every transaction’s public transcript.',
    attack: 'The test reads every sealed bid straight from the deposits.',
    fix: 'Every bidder locks the same public bond, the auction’s ceiling, and the difference is refunded after the bids are opened. The deposits say nothing.',
  },
  {
    id: 'club',
    name: 'The members’ club',
    kind: 'Linkable tag',
    severity: 'medium',
    story: 'An “anonymous” claim for members. The key stays private, but a claim proves membership by looking the caller’s own leaf up in the member set.',
    finding: 'The key of a Set lookup is part of the public transcript: every claim carries the claimant’s leaf, which ties it to their join and to all their other claims.',
    attack: 'The test matches each claim’s transcript to the member who joined with that leaf.',
    fix: 'Members join a Merkle tree; a claim proves some leaf is the caller’s without saying which, and spends a one-time nullifier from a different hash domain.',
  },
  {
    id: 'keyring',
    name: 'The keyring',
    kind: 'Private key derivable from public data',
    severity: 'critical',
    story: 'Each user registers an account id, hash(seed), and an encryption key. To save a derivation, the private scalar of that key is the same hash.',
    finding: 'ecMulGenerator(k) is a public key with private key k, and k here is the account id the contract publishes: anyone holds the private key.',
    attack: 'The test reads each account id from the ledger and opens the matching encryption key with it.',
    fix: 'Derive the account id and the private scalar from the seed under two different domain separators; the id says nothing about the scalar.',
  },
  {
    id: 'poll',
    name: 'The poll (Ledger 9)',
    kind: 'Guessable hash, in an event',
    severity: 'critical',
    story: 'The ledger keeps each vote as a salted commitment. Then the contract emits a receipt event so voters can find their vote, and the receipt is hash(choice).',
    finding: 'Events are part of the public transaction, like ledger writes. Tell reads Compact 0.36 and Ledger 9 events: four hashes recover every vote.',
    attack: 'The test casts votes and matches the four candidate hashes against the emitted receipts.',
    fix: 'The receipt carries the same salted commitment the ledger stores; a voter finds it with the salt from their private state.',
  },
];

export default function ZooPage() {
  const src = new Map(zoo.map((z) => [z.id, z]));
  return (
    <>
      <PageHead kicker="Evidence" title="The leak zoo">
        <p>
          {numberWord(zooCounts.pairs, true)} pairs of small contracts ({zooCounts.contracts} in all, {zooCounts.ledger8} pairs on Ledger 8 and {zooCounts.ledger9} on Ledger 9), each a leak
          a careful developer could ship and its fix: votes, salaries, bids, keys, tags, membership claims, a constructor, shielded and unshielded tokens, and a Ledger 9 event.
          For every pair Tell reports the leak on the left, and an attack test reads the secret back out of public state. {tests.zoo.attack} attack tests, and auto-fix tests that apply Tell’s verified patches to the five original leaky contracts and run the attacks again, <a href="https://github.com/RohanGlitched/tell/actions/workflows/ci.yml">run in CI</a>.
        </p>
      </PageHead>
    <div className="wrap pb-16 pt-12 sm:pt-14">
      <nav aria-label="Cases" className="mt-6 flex flex-wrap gap-2 text-[14px]">
        {CASES.map((c) => (
          <a key={c.id} href={`#${c.id}`} className="inline-flex min-h-[44px] items-center rounded border border-[var(--rule)] px-3 no-underline hover:border-[var(--ink)] sm:min-h-[36px]">
            {c.name}
          </a>
        ))}
      </nav>

      <div className="mt-12 space-y-20">
        {CASES.map((c, i) => {
          const s = src.get(c.id)!;
          const leaky = trim(s.leaky);
          const fixed = trim(s.fixed);
          return (
            <section key={c.id} id={c.id} className="scroll-mt-20">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="mono text-[13px] text-[var(--graphite)]">{String(i + 1).padStart(2, '0')}</span>
                <h2 className="text-[26px] font-semibold">{c.name}</h2>
                <span className="sev" data-sev={worst(s.leaky) ?? c.severity}>
                  {worst(s.leaky) ?? c.severity}
                </span>
                <span className="text-[14px] text-[var(--graphite)]">{c.kind}</span>
              </div>
              <p className="mt-2 max-w-[70ch] text-[16px]">{c.story}</p>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <CodePane title={`${c.id}-leaky.compact`} code={leaky} tone="red" marks={leakLines(s.leaky)} />
                <CodePane title={`${c.id}-fixed.compact`} code={fixed} tone="ink" marks={changedLines(leaky, fixed)} />
              </div>
              <dl className="mt-5 grid gap-4 text-[15px] md:grid-cols-3">
                <Note term="Tell reports" text={c.finding} />
                <Note term="The attack test" text={c.attack} />
                <Note term="The fix" text={c.fix} />
              </dl>
              <p className="mt-5">
                <Link
                  href={`/scan?sample=${c.id}-leaky`}
                  className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--ink)] px-4 text-[15px] font-semibold no-underline hover:bg-[var(--sheet)]"
                >
                  Scan the leaky version yourself →
                </Link>
              </p>
            </section>
          );
        })}
      </div>
    </div>
    </>
  );
}

// Drop the licence header so the code that matters fits the card.
const trim = (code: string) => code.replace(/^(\/\/.*\n)+\n?/, '').trim();

// The precomputed scan of each leaky contract (the same engine as the scanner) says which
// lines leak at medium or worse; shift them by the header that trim() drops.
const RESULTS = precomputed as unknown as Record<string, ScanResponse>;
function leakLines(full: string): number[] {
  const res = RESULTS[crypto.createHash('sha256').update(full).digest('hex')];
  const kept = full.replace(/^(\/\/.*\n)+\n?/, '').trimStart();
  const dropped = full.slice(0, full.length - kept.length).split('\n').length - 1;
  const lines = (res?.contracts[0]?.report?.findings ?? [])
    .filter((f) => !f.suppressed && f.line && ['critical', 'high', 'medium'].includes(f.severity))
    .map((f) => f.line! - dropped);
  return [...new Set(lines)].filter((n) => n > 0);
}

// The worst finding the precomputed scan reports for a contract (null before the samples are regenerated).
function worst(full: string): string | null {
  const res = RESULTS[crypto.createHash('sha256').update(full).digest('hex')];
  const sev = (res?.contracts[0]?.report?.findings ?? []).filter((f) => !f.suppressed).map((f) => f.severity);
  return ['critical', 'high', 'medium', 'low', 'info'].find((s) => sev.includes(s as never)) ?? null;
}

// Lines of the fix that do not appear in the leaky version.
function changedLines(leaky: string, fixed: string): number[] {
  const before = new Set(leaky.split('\n').map((l) => l.trim()));
  return fixed
    .split('\n')
    .map((l, i) => (l.trim() && !before.has(l.trim()) ? i + 1 : 0))
    .filter((n) => n > 0);
}

function Note({ term, text }: { term: string; text: string }) {
  return (
    <div className="border-t border-[var(--rule)] pt-3">
      <dt className="text-[14px] font-semibold">{term}</dt>
      <dd className="mt-1 text-[var(--ink)]">{text}</dd>
    </div>
  );
}
