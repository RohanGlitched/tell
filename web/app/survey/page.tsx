import type { Metadata } from 'next';
import Link from 'next/link';
import survey from '@/data/survey.json';
import { KIND_LABEL, type FindingKind, type Severity } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Buildathon survey',
  description: 'Tell scanned every public repository in the Midnight Buildathon. What Midnight apps give away, in aggregate.',
};

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const GRADE_COLOR: Record<string, string> = { A: 'var(--ink)', B: 'var(--graphite)', C: 'var(--amber)', D: 'var(--red)', F: 'var(--red)' };

export default function SurveyPage() {
  const s = survey;
  const total = Object.values(s.grades).reduce((a, b) => a + b, 0);
  const linkPct = Math.round((s.linkableProjects / s.projectsAnalyzed) * 100);
  const seriousProjects = new Set(s.cases.map((c) => c.project)).size;
  const notCompiled = s.contractsNotCompiled.reduce((a, b) => a + b.n, 0);
  const date = new Date(s.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-10 sm:px-6">
      <p className="text-[14px] font-medium text-[var(--graphite)]">Survey, {date}</p>
      <h1 className="mt-2 max-w-[22ch] text-[34px] font-semibold leading-tight tracking-[-0.015em] sm:text-[46px]">
        What {s.projectsAnalyzed} Midnight apps give away
      </h1>
      <p className="mt-4 max-w-[66ch] text-[17px] text-[var(--graphite)]">{s.method}</p>

      <dl className="mt-10 grid gap-6 sm:grid-cols-4">
        <Fig n={s.projectsAnalyzed} label={`projects analyzed, from ${s.repositoriesListed} repositories linked on AKINDO`} />
        <Fig n={s.contractsAnalyzed} label="Compact contracts compiled and traced, circuit by circuit" />
        <Fig n={`${linkPct}%`} label="publish a fixed tag that ties a user’s transactions together" />
        <Fig n={seriousProjects} label="leak something private at medium severity or worse" circled />
      </dl>

      <section className="mt-16">
        <h2 className="text-[24px] font-semibold">Grades</h2>
        <p className="mt-2 max-w-[64ch] text-[15px] text-[var(--graphite)]">Each project is graded by its worst contract. Most are clean or carry only low-risk notes.</p>
        <div className="mt-5 flex h-12 w-full overflow-hidden rounded-sm border border-[var(--rule)]" role="img" aria-label={Object.entries(s.grades).map(([g, n]) => `${g}: ${n}`).join(', ')}>
          {Object.entries(s.grades)
            .filter(([, n]) => n > 0)
            .map(([g, n]) => (
              <div key={g} className="grid place-items-center text-[13px] font-semibold text-[var(--paper)]" style={{ width: `${(n / total) * 100}%`, background: GRADE_COLOR[g] }}>
                {(n / total) * 100 > 6 ? `${g} · ${n}` : g}
              </div>
            ))}
        </div>
        <ul className="mt-3 grid gap-1 text-[14px] sm:grid-cols-5">
          {Object.entries(s.grades).map(([g, n]) => (
            <li key={g}>
              <span className="font-semibold" style={{ color: GRADE_COLOR[g] }}>
                {g}
              </span>{' '}
              <span className="num">{n}</span> project{n === 1 ? '' : 's'}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16 grid gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h2 className="text-[24px] font-semibold">The pattern most apps share</h2>
          <p className="mt-3 max-w-[60ch] text-[16px]">
            <span className="hl">{linkPct}% of projects</span> identify a user by a hash of their secret key, the way Midnight’s own examples do, and publish it on
            every call. The key stays safe, but every transaction carrying that tag can be tied to the same person: register, vote, reveal; bet, bet, claim.
          </p>
          <pre className="mono mt-4 overflow-x-auto rounded-sm border border-[var(--rule)] bg-[var(--sheet)] p-4 text-[13px] leading-[1.7]">
            {`// the common pattern
const me = persistentHash([pad(32, "app:pk"), localSk()]);
bets.insert(roundId, disclose(me));      // same value, every bet

// one-time tags instead
const tag = persistentHash([pad(32, "app:bet"), localSk(), roundId]);`}
          </pre>
          <p className="mt-3 text-[14px] text-[var(--graphite)]">
            Fine for a one-time registration or a nullifier. For repeated actions, Tell flags it, and the{' '}
            <Link href="/zoo#board">staff-board case in the zoo</Link> shows the fix with a Merkle membership proof.
          </p>
        </div>
        <div>
          <h2 className="text-[24px] font-semibold">Projects with each kind of finding</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b-2 border-[var(--ink)] text-left">
                  <th className="py-2 pr-3 font-semibold">Kind</th>
                  {SEVS.map((v) => (
                    <th key={v} className="px-2 py-2 text-right font-medium capitalize text-[var(--graphite)]">
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(s.kinds) as FindingKind[]).map((k) => (
                  <tr key={k} className="border-b border-[var(--rule)]">
                    <td className="py-2 pr-3">{KIND_LABEL[k]}</td>
                    {SEVS.map((v) => {
                      const n = (s.kinds as Record<string, Record<string, number>>)[k][v];
                      return (
                        <td key={v} className={`num px-2 py-2 text-right ${n && (v === 'critical' || v === 'high') ? 'font-semibold text-[var(--red)]' : n ? '' : 'text-[var(--faint)]'}`}>
                          {n ?? '·'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-[var(--graphite)]">Counts are projects, not findings. Info-level rows are values published on purpose, listed so nothing is hidden.</p>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-[24px] font-semibold">The serious ones</h2>
        <p className="mt-2 max-w-[66ch] text-[15px] text-[var(--graphite)]">
          Every finding at medium or above was read by hand against the source before it was counted. Each team is contacted privately; none is named here
          without their agreement.
        </p>
        <ol className="mt-5 space-y-2">
          {s.cases.map((c, i) => (
            <li key={i} className="sheet flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm px-4 py-3">
              <span className={`rounded-sm px-2 py-0.5 text-[12px] font-semibold uppercase ${c.severity === 'high' || c.severity === 'critical' ? 'bg-[var(--red)] text-white' : 'bg-[var(--hi)] text-[#151b2c]'}`}>
                {c.severity}
              </span>
              <span className="mono text-[13px] text-[var(--graphite)]">{c.project}</span>
              <span className="text-[15px]">{c.title}</span>
              {'count' in c && (c as { count: number }).count > 1 && <span className="text-[13px] text-[var(--graphite)]">in {(c as { count: number }).count} contracts</span>}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 grid gap-10 md:grid-cols-2">
        <div>
          <h2 className="text-[24px] font-semibold">What the survey could not see</h2>
          <p className="mt-3 text-[15px]">
            {notCompiled} of {s.contractsFound} contract files were not analyzed:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px]">
            {s.contractsNotCompiled.map((c) => (
              <li key={c.cause}>
                <span className="num">{c.n}</span> {c.cause === 'other' ? 'are experiments, test fixtures or include files that do not compile on their own' : c.cause}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[14px] text-[var(--graphite)]">
            Tell only sees what a contract does on chain. It cannot see what a frontend or server does with the same data, and it cannot tell intent: a value
            published on purpose looks the same as a leak, which is why most published values are listed as info.
          </p>
        </div>
        <div>
          <h2 className="text-[24px] font-semibold">Reproduce it</h2>
          <pre className="mono mt-3 overflow-x-auto rounded-sm border border-[var(--rule)] bg-[var(--sheet)] p-4 text-[13px] leading-[1.7]">
            {`git clone https://github.com/RohanGlitched/tell
cd tell && npm install
# clone the repositories listed in survey/repos.txt into ~/survey
npx tsx engine/scripts/survey.ts ~/survey survey/results.json
npx tsx engine/scripts/summarize.ts survey/results.json web/data/survey.json`}
          </pre>
          <p className="mt-3 text-[14px] text-[var(--graphite)]">Each result is pinned to the commit that was scanned, so a fixed repository shows up as fixed on the next run.</p>
        </div>
      </section>
    </div>
  );
}

function Fig({ n, label, circled }: { n: number | string; label: string; circled?: boolean }) {
  return (
    <div className="border-t-2 border-[var(--ink)] pt-3">
      <dt className="num text-[38px] font-semibold leading-none tracking-[-0.02em]">{circled ? <span className="circled">{n}</span> : n}</dt>
      <dd className="mt-2 text-[14px] text-[var(--graphite)]">{label}</dd>
    </div>
  );
}
