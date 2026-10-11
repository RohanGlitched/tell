import Link from 'next/link';
import Lamp, { type HeroRow } from '@/components/Lamp';
import Scanner from '@/components/Scanner';
import Census, { type CensusProject } from '@/components/Census';
import hero from '@/data/hero.json';
import samples from '@/data/samples.json';
import survey from '@/data/survey.json';

// Lines the compiler accepts, and what Tell says about each.
const COMPILER_ROWS = [
  ['disclose(hash(vote))', 'accepted', '2 bits once asserted below four: four guesses recover it'],
  ['disclose(hash(id, salary))', 'accepted', 'id is public in the same call; salary falls to brute force'],
  ['if (disclose(bid ≥ reserve)) a.insert(t) else b.insert(t)', 'accepted', 'which set was written shows the bid’s side'],
  ['posts.insert(n, disclose(hash(key)))', 'accepted', 'same tag on every post: one identified post unmasks all'],
  ['owner = disclose(degradeToTransient(sk))', 'accepted', 'a cast, not a hash: the key is on the ledger'],
];

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
            compiler each one asks for. Every finding at medium or worse was read by hand against the source. No team is named; findings are for the team concerned.
          </p>
        </div>
        <dl className="mt-10 grid gap-6 sm:grid-cols-3">
          <Big n={`${analyzed}`} label="projects analyzed, circuit by circuit" />
          <Big n={`${linkPct}%`} label="publish a fixed tag that can tie a user’s transactions together; usually by design, so reported as info or low" />
          <Big n={`${serious}`} label="have a finding at medium or worse, each read by hand against the source" circled />
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
          <div>
            {/* phones: one card per line; the three columns do not fit */}
            <ol className="border-t-2 border-[var(--ink)] sm:hidden">
              {COMPILER_ROWS.map(([code, c, t]) => (
                <li key={code} className="border-b border-[var(--rule)] py-3">
                  <code className="block break-words text-[13px] leading-[1.5]">{code}</code>
                  <p className="mt-1.5 text-[14px] text-[var(--graphite)]">Compiler: {c}</p>
                  <p className="mt-0.5 text-[15px]">
                    <span className="font-semibold">Tell: </span>
                    {t}
                  </p>
                </li>
              ))}
            </ol>
            <table className="hidden w-full border-collapse text-[14.5px] sm:table">
              <thead>
                <tr className="border-b-2 border-[var(--ink)] text-left">
                  <th className="py-2 pr-3 font-semibold">This line</th>
                  <th className="py-2 pr-3 font-semibold">Compiler</th>
                  <th className="py-2 font-semibold">Tell</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {COMPILER_ROWS.map(([code, c, t]) => (
                  <tr key={code} className="border-b border-[var(--rule)]">
                    <td className="mono break-words py-2.5 pr-3 text-[12.5px]">{code}</td>
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
          <p className="mt-2 max-w-[62ch] text-[16px] text-[var(--graphite)]">Pick a sample or paste your own. The real Compact compiler runs on every contract you paste.</p>
          <div className="mt-8">
            <Scanner samples={samples} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-4 pt-16 sm:px-6">
        <h2 className="text-[34px] font-extrabold sm:text-[40px]">Add it to your repository</h2>
        <p className="mt-2 max-w-[62ch] text-[16px] text-[var(--graphite)]">Three steps, and every pull request that touches a contract gets checked.</p>
        <ol className="mt-8 grid gap-4 lg:grid-cols-3">
          <li className="sheet flex flex-col rounded-sm p-5">
            <span className="display text-[40px] font-extrabold leading-none text-[var(--faint)]">1</span>
            <h3 className="mt-3 text-[19px] font-bold">Try it here</h3>
            <p className="mt-2 text-[15px] text-[var(--graphite)]">Paste a contract or a public GitHub repository on the scan page. Nothing to install.</p>
            <Link href="/scan" className="mt-auto pt-4 font-semibold">
              Open the scanner
            </Link>
          </li>
          <li className="sheet flex flex-col rounded-sm p-5">
            <span className="display text-[40px] font-extrabold leading-none text-[var(--faint)]">2</span>
            <h3 className="mt-3 text-[19px] font-bold">Run it in CI</h3>
            <pre className="mono mt-3 whitespace-pre-wrap break-words rounded-sm bg-[var(--uv)] p-3 text-[12.5px] leading-[1.7] text-[#e9e6ff]">{`- uses: RohanGlitched/tell@v1
  with:
    path: contract
    fail-on: high`}</pre>
            <p className="mt-3 text-[15px] text-[var(--graphite)]">Findings show up in GitHub code scanning, on the line that leaks.</p>
          </li>
          <li className="sheet flex flex-col rounded-sm p-5">
            <span className="display text-[40px] font-extrabold leading-none text-[var(--faint)]">3</span>
            <h3 className="mt-3 text-[19px] font-bold">Mark what you meant</h3>
            <pre className="mono mt-3 whitespace-pre-wrap break-words rounded-sm bg-[var(--uv)] p-3 text-[12.5px] leading-[1.7] text-[#e9e6ff]">{`// the reveal publishes the seed
seeds.insert(slot, s); // tell:allow secret-published`}</pre>
            <p className="mt-3 text-[15px] text-[var(--graphite)]">Some disclosures are the point. Say so once and Tell stops reporting them.</p>
          </li>
        </ol>
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

      <section className="mx-auto max-w-[1180px] px-4 pb-8 sm:px-6">
        <div className="grid gap-10 border-t-2 border-[var(--ink)] pt-10 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 className="text-[30px] font-extrabold leading-[1.08] sm:text-[38px]">Where Tell goes next</h2>
            <p className="mt-4 text-[16px] text-[var(--graphite)]">
              The scanner, the command line, the GitHub Action, every rule and the leak zoo stay free and open source. On other chains, analyzers like this are
              kept alive by audit work, ecosystem grants, or by becoming part of the chain’s own toolchain. Hosted-only analysis has the weakest record. Tell
              follows that pattern:
            </p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15.5px]">
              <li>
                <b>An ecosystem tooling grant</b> pays for rule research and for keeping up with every compiler release.
              </li>
              <li>
                <b>Audit firms</b> use Tell’s per-circuit disclosure map as the privacy section of a Compact review.
              </li>
              <li>
                <b>The compiler.</b> Tell already reads the compiler’s own output; running as one of its passes is the goal, not a threat.
              </li>
              <li>
                <b>Production teams, later:</b> history and dashboards for private repositories, once mainnet has the teams for it. Public repositories stay free.
              </li>
            </ol>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-sm border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2">
            {[
              ['Now', 'Scanner, CLI, GitHub Action with SARIF, leak zoo with attack tests, survey of every buildathon app.'],
              ['Wave 3', 'Pull request comments with the fix inline. Constructor analysis. Shielded token and DUST patterns in the zoo.'],
              ['Next', 'A VS Code extension that marks leaking lines as you type. A Tell check in Midnight’s project templates.'],
              ['Later', 'Hosted checks with history per contract, team dashboards, and a privacy report auditors can attach.'],
            ].map(([w, d]) => (
              <li key={w} className="bg-[var(--sheet)] p-5">
                <span className="text-[17px] font-bold">{w}</span>
                <p className="mt-2 text-[15px] text-[var(--graphite)]">{d}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {[
            ['What exists today', 'The compiler says whether data goes public. OpenZeppelin’s Compact security detectors check loop bounds and assertion messages. Nothing measures how much a disclosure gives away. Tell does, and its rules could feed those tools.'],
            ['If the compiler absorbs it', 'That is the plan. Tell reads the compiler’s own reduce-to-circuit form and is built to run as a pass.'],
            ['Undocumented compiler output', 'Tell reads compilers 0.29 to 0.35 and normalises both output shapes they print. Tracking each new release is the maintenance a grant pays for.'],
            ['A small developer base', 'Running costs are near zero: the scanner is one serverless function. Tell can live on grant scale until mainnet usage grows.'],
          ].map(([t, d]) => (
            <div key={t} className="border-t border-[var(--rule)] pt-4">
              <h3 className="text-[17px] font-bold">{t}</h3>
              <p className="mt-1.5 text-[15px] text-[var(--graphite)]">{d}</p>
            </div>
          ))}
        </div>
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
