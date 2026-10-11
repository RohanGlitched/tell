import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'Tell traces private inputs through the Compact compiler’s own circuit form to every public ledger operation, then grades what leaks.',
};

const STEPS = [
  {
    t: 'Compile with the real compiler',
    d: 'Tell reads the contract’s pragma and runs the Compact compiler that accepts it, preferring 0.31.1 (the compiler for the ledger live today) and falling back through every other version the pragma allows. No proving keys are built, so this takes about a second.',
    code: 'compactc --trace-passes --skip-zk contract.compact',
  },
  {
    t: 'Take the compiler’s own circuit form',
    d: 'Among the compiler’s passes is reduce-to-circuit: helper circuits inlined, loops unrolled, every step a guarded binding. Tell reads exactly this, so it sees the contract the way the proof does, never a re-implementation of Compact.',
    code: '(= %guard %t.12 (public-ledger %ballots insert %tag %h))',
  },
  {
    t: 'Trace every private input',
    d: 'Witness results and circuit arguments are private by Compact’s rules. Tell follows each one through hashes, commitments, comparisons, struct fields and branches, keeping track of how much of it survives: the value itself, a guessable function of it, a yes/no fact, or nothing.',
    code: 'choice(): Uint<8> → persistentHash → 8 unknown bits',
  },
  {
    t: 'Read the public transcript',
    d: 'Every ledger operation is public: its operands, and whether it ran at all. Each operand and each branch guard is checked against the traced inputs.',
    code: 'ballots.insert(tag, hash(choice)) → guessable, 256 tries',
  },
  {
    t: 'Grade and report',
    d: 'Findings are grouped per idea, pinned to a source line, graded A to F, and exported as text, JSON or SARIF for GitHub code scanning.',
    code: 'grade F · 1 critical · ballot-leaky.compact:36',
  },
];

const KINDS = [
  ['Guessable hash', 'critical / high', 'A hash or commitment whose only unknown input is small: a vote, an age, a salary, a location. Brute force recovers it. Critical up to 40 bits.'],
  ['Secret in the clear', 'critical', 'A value that looks like a secret key reaches the ledger as a readable value.'],
  ['Secret-dependent branch', 'medium', 'Which ledger operations run depends on a private value. Includes count leaks: a fixed-size loop that only touches the ledger for used slots.'],
  ['Same tag on every action', 'medium', 'Each repeated action stores the same hash of a key, so one identified action unmasks the rest.'],
  ['Linkable tag', 'low / info', 'The same hash of a key is published by several circuits, tying a user’s transactions together. Fine for registrations and nullifiers.'],
  ['Published value', 'low / info', 'A private input is written as a readable value. Usually on purpose; listed so nothing is hidden.'],
  ['Published yes/no fact', 'info', 'A comparison over a private value is stored: one bit per call.'],
];

const QUIET = [
  'A commitment whose randomness is a strong private value: hiding and unlinkable.',
  'Shielded-coin plumbing (coin commitments, nullifiers): the protocol’s own privacy.',
  'A Merkle root passed to checkRoot: it must equal a public root anyway.',
  'An input the same call already publishes: it adds no secrecy to a hash, and is not reported twice.',
  'Hashes that mix in a per-use nonce, salt or a changing counter: one-time values link nothing.',
  'Branches on tree positions, division hints and the current time: public in practice, reported as low.',
  'Caller-supplied arguments: Compact treats them as private, but they are usually public inputs, so they are capped at low.',
];

const CHANGELOG = [
  ['2026-10-12', 'Survey of every public Midnight Buildathon repository; compiler fallback across pragma ranges; count-leak wording; per-use nonce and struct-field rules.'],
  ['2026-10-12', 'Web scanner with leak map; SARIF export; suppression comments.'],
  ['2026-10-11', 'Engine: compiler trace reader, information flow, five finding kinds; leak zoo with attack tests.'],
];

export default function HowPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-10 sm:px-6">
      <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.015em] sm:text-[46px]">How Tell works</h1>
      <p className="mt-3 max-w-[66ch] text-[17px] text-[var(--graphite)]">
        Midnight proves a circuit ran correctly over private inputs. The proof hides the inputs, but the transaction still carries a public transcript: every
        ledger read and write, with its operands. Tell asks one question of each contract: what can someone reading that transcript work out about the
        private inputs?
      </p>

      <ol className="mt-12 space-y-0">
        {STEPS.map((s, i) => (
          <li key={s.t} className="grid gap-4 border-t border-[var(--rule)] py-6 md:grid-cols-[48px_1fr_1fr]">
            <span className="mono text-[13px] text-[var(--graphite)]">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h2 className="text-[19px] font-semibold">{s.t}</h2>
              <p className="mt-2 text-[15px]">{s.d}</p>
            </div>
            <pre className="tape mono self-start overflow-x-auto rounded-sm px-6 py-3 text-[12.5px]">{s.code}</pre>
          </li>
        ))}
      </ol>

      <section className="mt-14">
        <h2 className="text-[24px] font-semibold">What Tell reports</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-[15px]">
            <thead>
              <tr className="border-b-2 border-[var(--ink)] text-left">
                <th className="py-2 pr-4 font-semibold">Finding</th>
                <th className="py-2 pr-4 font-semibold">Severity</th>
                <th className="py-2 font-semibold">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {KINDS.map(([k, s, d]) => (
                <tr key={k} className="border-b border-[var(--rule)] align-top">
                  <td className="py-3 pr-4 font-medium">{k}</td>
                  <td className="whitespace-nowrap py-3 pr-4 text-[var(--graphite)]">{s}</td>
                  <td className="py-3">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[14px] text-[var(--graphite)]">Grades: F for any critical, D for any high, C for any medium, B for low notes only, A otherwise.</p>
      </section>

      <section className="mt-14 grid gap-10 md:grid-cols-2">
        <div>
          <h2 className="text-[24px] font-semibold">What Tell deliberately does not flag</h2>
          <p className="mt-2 text-[15px] text-[var(--graphite)]">
            Each of these rules came from reading real contracts in the survey and removing a false alarm.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px]">
            {QUIET.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
        <div id="limits" className="scroll-mt-20">
          <h2 className="text-[24px] font-semibold">Limits</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px]">
            <li>Tell sees the contract, not the dApp around it. A frontend that logs a secret, or a server that sees it, is out of scope.</li>
            <li>It cannot read intent. A value published on purpose looks like a leak; that is why published values are info and why suppression exists.</li>
            <li>Entropy comes from types. A Bytes&lt;32&gt; that holds a short name is treated as 256 bits; a Uint&lt;64&gt; amount is treated as guessable in practice.</li>
            <li>Range asserts over a secret narrow its domain further than Tell assumes; real brute force can be cheaper than the bits shown.</li>
            <li>Contracts must compile with a released compiler. Unreleased language versions are reported, not guessed at.</li>
          </ul>
        </div>
      </section>

      <section id="cli" className="mt-14 scroll-mt-20">
        <h2 className="text-[24px] font-semibold">Command line</h2>
        <p className="mt-2 text-[15px]">Needs Node 22+ and the Compact toolchain (<code>compact update 0.31.1</code>).</p>
        <pre className="mono mt-3 overflow-x-auto rounded-sm border border-[var(--rule)] bg-[var(--sheet)] p-4 text-[13px] leading-[1.7]">
          {`git clone https://github.com/RohanGlitched/tell && cd tell && npm install
npx tsx engine/src/cli.ts path/to/your/contracts          # readable report
npx tsx engine/src/cli.ts . --json > tell.json             # machine-readable
npx tsx engine/src/cli.ts . --sarif tell.sarif --fail-on high`}
        </pre>
      </section>

      <section id="ci" className="mt-14 scroll-mt-20">
        <h2 className="text-[24px] font-semibold">In CI</h2>
        <p className="mt-2 text-[15px]">The repository is a GitHub Action. Findings appear in the pull request and the Security tab.</p>
        <pre className="mono mt-3 overflow-x-auto rounded-sm border border-[var(--rule)] bg-[var(--sheet)] p-4 text-[13px] leading-[1.7]">
          {`# .github/workflows/tell.yml
on: [push, pull_request]
permissions: { contents: read, security-events: write }
jobs:
  tell:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: RohanGlitched/tell@v1
        with:
          path: contract
          fail-on: high`}
        </pre>
      </section>

      <section id="suppress" className="mt-14 scroll-mt-20">
        <h2 className="text-[24px] font-semibold">Marking a finding intended</h2>
        <p className="mt-2 max-w-[66ch] text-[15px]">
          Put <code>tell:allow</code> in a comment on the line Tell points at, or the line above. Name the kind to silence only that kind. Suppressed findings
          still appear in JSON, marked, so a reviewer can see what was waived.
        </p>
        <pre className="mono mt-3 overflow-x-auto rounded-sm border border-[var(--rule)] bg-[var(--sheet)] p-4 text-[13px] leading-[1.7]">
          {`// the reveal phase publishes the seed by design
seeds.insert(slot, s); // tell:allow secret-published`}
        </pre>
      </section>

      <section id="changelog" className="mt-14 scroll-mt-20">
        <h2 className="text-[24px] font-semibold">Changelog</h2>
        <ul className="mt-3 space-y-2 text-[15px]">
          {CHANGELOG.map(([d, t], i) => (
            <li key={i} className="grid gap-1 sm:grid-cols-[120px_1fr]">
              <span className="mono text-[13px] text-[var(--graphite)]">{d}</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[15px]">
          <Link href="/scan">Scan a contract</Link> · <Link href="/zoo">See the leak zoo</Link>
        </p>
      </section>
    </div>
  );
}
