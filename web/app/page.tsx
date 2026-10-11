import Link from 'next/link';
import Lamp, { type HeroRow } from '@/components/Lamp';
import Scanner from '@/components/Scanner';
import Census, { type CensusProject } from '@/components/Census';
import hero from '@/data/hero.json';
import samples from '@/data/samples.json';
import survey from '@/data/survey.json';

export default function Home() {
  const rows = hero.rows as HeroRow[];
  const analyzed = survey.projectsAnalyzed;
  const linkPct = Math.round((survey.linkableProjects / analyzed) * 100);
  const serious = new Set(survey.cases.map((c) => c.project)).size;
  const count = (c: string) => rows.filter((r) => r.contract === c).length;

  return (
    <div>
      <Lamp rows={rows}>
        <p className="label">A privacy leak scanner for Midnight</p>
        <h1 className="mt-3 text-[46px] font-extrabold leading-[0.98] sm:text-[62px]">Every contract has a tell.</h1>
        <p className="mt-5 text-[17px] text-[var(--graphite)]">
          Behind this card is the public ledger state of five “private” contracts, run through Midnight’s own contract runtime. Move the lamp over it. {count('ballot')} votes,{' '}
          {count('payband')} salaries, an author behind every post, a bid behind every set, and one secret key, all readable by anyone.
        </p>
        <p className="mt-3 text-[17px]">
          Tell finds these before you deploy. It reads a Compact contract the way the compiler does and shows, in bits, what each circuit gives away.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/scan" className="inline-flex min-h-[46px] items-center rounded-sm bg-[var(--ink)] px-5 font-semibold text-[var(--paper)] no-underline">
            Scan a contract
          </Link>
          <Link href="/survey" className="inline-flex min-h-[46px] items-center rounded-sm border border-[var(--ink)] px-5 font-semibold no-underline">
            {analyzed} apps, surveyed
          </Link>
        </div>
      </Lamp>

      <section className="mx-auto max-w-[1180px] px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1fr_1.2fr] md:items-end">
          <h2 className="text-[34px] font-extrabold leading-[1.05] sm:text-[44px]">
            We put every Midnight Buildathon app under the lamp.
          </h2>
          <p className="text-[17px] text-[var(--graphite)]">
            All {survey.repositoriesListed} public repositories linked from the buildathon, {survey.contractsAnalyzed} contracts compiled with the
            compiler each one asks for. Every serious finding was read by hand against the source. No team is named; each is contacted privately.
          </p>
        </div>
        <dl className="mt-10 grid gap-6 sm:grid-cols-3">
          <Big n={`${analyzed}`} label="projects analyzed, circuit by circuit" />
          <Big n={`${linkPct}%`} label="publish a fixed tag that ties each user’s transactions together" />
          <Big n={`${serious}`} label="leak something private at medium severity or worse" circled />
        </dl>
        <div className="mt-14">
          <Census projects={survey.projects as CensusProject[]} />
        </div>
        <p className="mt-8">
          <Link href="/survey" className="font-semibold">
            Read the survey
          </Link>
        </p>
      </section>

      <section className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-6">
        <div className="grid gap-10 border-t-2 border-[var(--ink)] pt-10 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <h2 className="text-[30px] font-extrabold leading-[1.08] sm:text-[38px]">“Doesn’t the compiler already check this?”</h2>
            <p className="mt-4 text-[16px]">
              Half of it. Compact makes you write <code>disclose()</code> wherever private data may reach the ledger. That answers <em>whether</em>{' '}
              something goes public. It cannot answer <em>how much</em> it gives away, and that is where every leak in the survey lives.
            </p>
            <p className="mt-3 text-[16px] text-[var(--graphite)]">
              Tell starts where <code>disclose()</code> stops. It works on the compiler’s own output, so it complements the compiler instead of
              competing with it, and could run as one of its passes.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14.5px]">
              <thead>
                <tr className="border-b-2 border-[var(--ink)] text-left">
                  <th className="py-2 pr-3 font-semibold">This line</th>
                  <th className="py-2 pr-3 font-semibold">Compiler</th>
                  <th className="py-2 font-semibold">Tell</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {[
                  ['disclose(hash(vote))', 'accepted', '8 bits, four guesses recover it'],
                  ['disclose(hash(id, salary))', 'accepted', 'id is public in the same call; salary falls to brute force'],
                  ['if (disclose(bid ≥ reserve)) a.insert(t) else b.insert(t)', 'accepted', 'which set was written shows the bid’s side'],
                  ['posts.insert(n, disclose(hash(key)))', 'accepted', 'same tag on every post: one identified post unmasks all'],
                  ['owner = disclose(degradeToTransient(sk))', 'accepted', 'a cast, not a hash: the key is on the ledger'],
                ].map(([code, c, t]) => (
                  <tr key={code} className="border-b border-[var(--rule)]">
                    <td className="mono py-2.5 pr-3 text-[12.5px]">{code}</td>
                    <td className="py-2.5 pr-3 text-[var(--graphite)]">{c}</td>
                    <td className="py-2.5">{t}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {[
            ['Midnight developers', 'Run it in CI. Findings land on the pull request with the line and the fix, before a contract is deployed and its history is public forever.'],
            ['Auditors and reviewers', 'A map of every disclosure, in bits, per circuit and field: where to look first in a review, and evidence for the report.'],
            ['The users of those apps', 'The people whose votes, salaries and locations these contracts hold. They never see Tell; they just stop being readable.'],
          ].map(([t, d]) => (
            <div key={t} className="sheet rounded-sm p-5">
              <h3 className="text-[19px] font-bold">{t}</h3>
              <p className="mt-2 text-[15px] text-[var(--graphite)]">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-[var(--rule)] bg-[var(--sheet)]">
        <div className="mx-auto max-w-[1180px] px-4 py-16 sm:px-6">
          <h2 className="text-[34px] font-extrabold sm:text-[40px]">Put your contract under the lamp</h2>
          <p className="mt-2 max-w-[62ch] text-[16px] text-[var(--graphite)]">Pick a sample or paste your own. The real Compact compiler runs on every scan.</p>
          <div className="mt-8">
            <Scanner samples={samples} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-4 py-16 sm:px-6">
        <h2 className="text-[34px] font-extrabold sm:text-[40px]">Five ways a private contract talks</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Guessable hash', 'hash(vote) has four answers', 'ballot'],
            ['Guessable hash', 'hash(id, salary) has a few thousand', 'payband'],
            ['Branch on a secret', 'the set you write says the bid', 'reserve'],
            ['Same tag, every action', 'one post names them all', 'board'],
            ['Key in the clear', 'the owner field is the key', 'vault'],
          ].map(([k, d, id]) => (
            <li key={id}>
              <Link href={`/zoo#${id}`} className="sheet block h-full rounded-sm p-5 no-underline hover:border-[var(--ink)]">
                <span className="label">{k}</span>
                <span className="hand mt-2 block text-[20px] leading-snug">{d}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[15px] text-[var(--graphite)]">
          Each one comes with its fix and an attack test that recovers the secret from public state. <Link href="/zoo">Open the leak zoo</Link>.
        </p>
      </section>
    </div>
  );
}

function Big({ n, label, circled }: { n: string; label: string; circled?: boolean }) {
  return (
    <div className="border-t-2 border-[var(--ink)] pt-4">
      <dt className="display num text-[64px] font-extrabold leading-none tracking-[-0.04em]">{circled ? <span className="circled">{n}</span> : n}</dt>
      <dd className="mt-3 max-w-[30ch] text-[15px] text-[var(--graphite)]">{label}</dd>
    </div>
  );
}
