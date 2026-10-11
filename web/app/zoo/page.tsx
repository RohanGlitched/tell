import crypto from 'node:crypto';
import type { Metadata } from 'next';
import Link from 'next/link';
import CodePane from '@/components/CodePane';
import zoo from '@/data/zoo.json';
import precomputed from '@/data/sample-results.json';
import type { ScanResponse } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Leak zoo',
  description: 'Five small Compact contracts that leak, each with its fix, Tell’s finding, and an attack test that recovers the secret from public state.',
};

type Case = {
  id: string;
  name: string;
  kind: string;
  severity: 'critical' | 'high' | 'medium';
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
    finding: 'choice() is hidden behind a persistentHash anyone can reverse: about 8 bits, at most 256 tries.',
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
];

export default function ZooPage() {
  const src = new Map(zoo.map((z) => [z.id, z]));
  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-10 sm:px-6">
      <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.015em] sm:text-[46px]">The leak zoo</h1>
      <p className="mt-3 max-w-[66ch] text-[17px] text-[var(--graphite)]">
        Five small contracts, each with one leak a careful developer could ship, and its fix. For every pair, Tell reports the leak on the left and nothing above
        low on the right, and an attack test reads the secret back out of public state. Ten attack tests and sixty precision tests <a href="https://github.com/RohanGlitched/tell/actions/workflows/ci.yml">run in CI</a>.
      </p>
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
                <span className={`rounded-sm px-2 py-0.5 text-[12px] font-semibold uppercase ${c.severity === 'medium' ? 'bg-[var(--hi)] text-[#151b2c]' : 'bg-[var(--red)] text-white'}`}>
                  {c.severity}
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
