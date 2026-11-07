import crypto from 'node:crypto';
import Link from 'next/link';
import { Bar, GradeSeal, Sev } from '@/components/brand';
import { MarginSection, StatusPill } from '@/components/ui';
import { Ticks } from '@/components/Ticks';
import Wave3Band from '@/components/Wave3Band';
import { fixedBallot, leakyBallot, short } from '@/lib/ballots';
import { business, desk, numberWord, zooCounts } from '@/lib/content';
import deskDeployment from '@/data/desk-deployment.json';
import { fixOf, KIND_LABEL, SEVERITY_ORDER, type ScanResponse } from '@/lib/types';
import integrations from '@/data/integrations.json';
import samples from '@/data/samples.json';
import precomputed from '@/data/sample-results.json';
import survey from '@/data/survey.json';

// Lines the compiler accepts, and what Tell says about each.
const COMPILER_ROWS = [
  ['disclose(hash(vote))', '2 bits', 'Asserted below four, so four guesses recover it.'],
  ['disclose(hash(id, salary))', 'guessable', '`id` is public in the same call; the salary falls to brute force.'],
  ['if (disclose(bid >= reserve)) a.insert(t)', '1 bit', 'Which set was written shows which side of the reserve the bid is on.'],
  ['posts.insert(n, disclose(hash(key)))', 'linkable', 'The same tag on every post: one identified post unmasks them all.'],
  ['owner = disclose(degradeToTransient(sk))', 'in the clear', 'A cast, not a hash. The key itself is on the ledger.'],
];

const STEPS = [
  ['Compile', 'Runs the Compact compiler your `pragma` asks for, preferring 0.31.1 for Ledger 8 and 0.36.0 for Ledger 9 (mainnet since November 6).'],
  ['Read the circuits', 'Uses the compiler’s `reduce-to-circuit` form: helpers inlined, loops unrolled, every step a guarded binding.'],
  ['Trace and count', 'Follows each witness and argument through hashes, casts and branches to every public write, counting the bits that survive.'],
  ['Grade and report', 'A to F per contract and a fix per finding, as text, JSON, SARIF or a report you can share.'],
];

const GRADE_FILL: Record<string, string> = { A: 'var(--indigo)', B: 'var(--violet)', C: '#b3a6ff', D: 'var(--marker-soft)', F: 'var(--marker)' };

export default function Home() {
  const leaky = leakyBallot();
  const fixed = fixedBallot();
  const sample = samples.find((s) => s.id === 'ballot-leaky')!;
  const res = (precomputed as unknown as Record<string, ScanResponse>)[crypto.createHash('sha256').update(sample.source).digest('hex')];
  const report = res?.contracts[0];
  const findings = (report?.report?.findings ?? []).filter((f) => !f.suppressed).sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const critical = findings.find((f) => f.severity === 'critical');
  // the engine's own verified patch for it, when the precomputed scan carries one (scripts/sample-results.ts)
  const cp = critical ? fixOf(critical).patch : null;
  const verified = cp?.verified
    ? { gradeAfter: cp.gradeAfter, lines: cp.diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).slice(0, 8) }
    : null;
  const total = Object.values(survey.grades).reduce((a, b) => a + b, 0);
  const serious = new Set(survey.cases.map((c) => c.project)).size;
  const items = integrations.items;
  const deskAddr = (deskDeployment as { address?: string }).address ?? null;

  return (
    <div>
      {/* Hero: the leaky ballot's ledger on Preprod, every vote showing through its redaction */}
      <section className="on-indigo">
        <div className="wrap grid items-center gap-10 pb-14 pt-9 lg:grid-cols-2 lg:gap-16 lg:pb-[88px] lg:pt-16">
          <div>
            <h1 className="max-w-[17ch] text-[34px] leading-[1.1] sm:text-[46px]">Your contract hides the vote. The ledger still shows it.</h1>
            <p className="mt-5 max-w-[46ch] text-[16px] text-[var(--on-indigo-3)] sm:text-[18px]">
              Tell finds what a Midnight Compact contract reveals about its private inputs, measures it in bits, and shows the fix before you deploy.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/scan" className="btn btn-pri">
                Scan a contract
              </Link>
              <Link href="/how#ci" className="btn btn-line border-[#5c53a8] text-white">
                Add the GitHub Action
              </Link>
            </div>
            <p className="mt-5 text-[14px] text-[var(--on-indigo-2)]">
              Free and open source, Apache-2.0. In CI: <code className="text-white">uses: RohanGlitched/tell@v1</code>
            </p>
          </div>
          <figure className="overflow-hidden rounded-lg bg-white text-[var(--ink)] shadow-[0_30px_60px_-30px_rgba(0,0,0,.6)]" aria-label="The public ledger of the leaky ballot on Midnight Preprod, with every vote recovered">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--rule)] px-5 pb-3.5 pt-4">
              <b className="font-[family-name:var(--serif)] text-[18px] font-semibold">ballots, as stored on Preprod</b>
              <a href={`https://preprod.midnightexplorer.com/contracts/${leaky.address}`} className="mono text-[12px] text-[var(--faint)] no-underline hover:underline">
                {short(leaky.address, 8, 8)}
              </a>
            </div>
            <ol className="px-5 pb-2.5 pt-1.5">
              {leaky.rows.map((r) => (
                <li key={r.voteTx} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-dashed border-[var(--rule)] py-2 text-[14px] last:border-b-0 sm:grid-cols-[150px_1fr_auto]">
                  <span className="mono whitespace-nowrap text-[12.5px] text-[var(--graphite)]" title={r.voteTx}>
                    vote {short(r.voteTx, 6, 4)}
                  </span>
                  <span className="mono hidden truncate text-[12px] text-[var(--faint)] sm:block" title={r.value ?? ''}>
                    {r.value ? short(r.value, 6, 4) : ''}
                  </span>
                  <Bar see={r.choice} width={96} height={22} label={`hidden vote, recovered: ${r.choice}`} />
                </li>
              ))}
            </ol>
            <div className="grid grid-cols-[auto_1fr] items-center gap-3.5 border-t border-[#f9c4df] bg-[var(--marker-soft)] px-5 py-4">
              <GradeSeal grade="F" size={46} caption={null} />
              <p className="text-[14px] text-[#6a1240]">
                <b className="text-[var(--marker)]">
                  {leaky.rows.length} of {leaky.rows.length} votes recovered in four guesses.
                </b>{' '}
                Each is <code>hash(choice)</code> with only four possible choices. <Link href="/live">Read them from the indexer now</Link>.
              </p>
            </div>
          </figure>
        </div>
      </section>

      <Wave3Band />

      <div className="wrap pb-8 pt-16 sm:pt-24">
        <div className="marg">
          <p className="margin-note">
            <b>Why this happens</b>Compact checks that private data is disclosed on purpose. It does not check how much the disclosure gives away.
          </p>
          <p className="max-w-[34ch] font-[family-name:var(--serif)] text-[22px] leading-[1.4] sm:text-[28px]">
            Midnight keeps private inputs off the chain. What a contract does with them can still give them away: a hash of a vote, a branch on a balance, the same
            tag on every post. Every contract has a <Bar see="tell" width="3.2em" height={28} className="!text-[15px] align-middle" />.
          </p>
        </div>
      </div>

      <MarginSection note="Compiler and Tell" noteText="Five lines that compile, five secrets that leak." title={<>Tell starts where <code className="text-[0.8em]">disclose()</code> stops.</>} intro="Each line below is accepted by the compiler. Tell reads the compiler's own output and says what each one costs.">
        <div className="overflow-hidden rounded-lg border border-[var(--rule)]">
          {COMPILER_ROWS.map(([code, cost, says]) => (
            <div key={code} className="grid border-t border-[var(--rule)] first:border-t-0 md:grid-cols-[1.1fr_1fr]">
              <div className="mono overflow-x-auto whitespace-nowrap bg-[var(--mist)] px-5 py-4 text-[13.5px]">
                {code}
                <small className="mt-1 block whitespace-normal font-[family-name:var(--sans)] text-[12px] text-[var(--faint)]">compiler: accepted</small>
              </div>
              <div className="grid gap-1 px-5 py-4 text-[14.5px] text-[var(--graphite)] sm:grid-cols-[96px_1fr] sm:gap-3.5">
                <b className="mono whitespace-nowrap text-[12.5px] font-medium text-[var(--marker)]">{cost}</b>
                <span>
                  <Ticks text={says} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </MarginSection>

      {report?.ok && (
        <MarginSection id="report" note="The report" noteText="Written to be read by a developer today and attached to an audit tomorrow." title="Findings an auditor would write, in the time it takes to compile.">
          <div className="grid overflow-hidden rounded-lg border border-[var(--rule)] shadow-[0_30px_60px_-44px_rgba(26,20,70,.5)] lg:grid-cols-[1.25fr_1fr]">
            <div className="px-5 py-6 sm:px-8 sm:py-7">
              <div className="flex items-center gap-4 border-b-2 border-[var(--indigo)] pb-5">
                <GradeSeal grade={report.grade!} size={58} caption={null} />
                <div>
                  <h3 className="font-[family-name:var(--serif)] text-[21px] font-semibold">ballot-leaky.compact</h3>
                  <p className="text-[13.5px] text-[var(--faint)]">
                    Compact {report.compiler}. Circuits {report.report!.circuits.map((c) => c.name).join(' and ')}. {findings.length} findings.
                  </p>
                </div>
              </div>
              <ol>
                {findings.map((f, i) => (
                  <li key={i} className="grid grid-cols-[40px_1fr_auto] items-baseline gap-3 border-b border-[var(--rule)] py-4 last:border-b-0">
                    <span className="mono text-[12.5px] text-[var(--faint)]">F-{i + 1}</span>
                    <div>
                      <p className="font-semibold">{KIND_LABEL[f.kind]}</p>
                      <p className="mt-1 text-[14px] text-[var(--graphite)]">
                        <Ticks text={f.title} />. Circuit <code>{f.circuit}</code>
                        {f.line ? `, line ${f.line}` : ''}.
                      </p>
                    </div>
                    <Sev s={f.severity} />
                  </li>
                ))}
              </ol>
            </div>
            <div className="border-t border-[var(--rule)] bg-[var(--mist)] px-5 py-6 sm:px-7 lg:border-l lg:border-t-0">
              <h4 className="mb-2.5 text-[13px] font-semibold text-[var(--graphite)]">What a chain observer records when vote runs</h4>
              <ol className="mono text-[12.5px] leading-[1.9]">
                <li>
                  <span className="inline-block w-6 text-[var(--faint)]">1</span>voters.member(tag)
                </li>
                <li>
                  <span className="inline-block w-6 text-[var(--faint)]">2</span>ballots.member(tag)
                </li>
                <li>
                  <span className="inline-block w-6 text-[var(--faint)]">3</span>ballots.insert(tag, <mark className="rounded-[2px] bg-[var(--marker-soft)] px-1 text-[var(--marker-ink)]">hash(choice()), {critical?.bits ?? 2} bits</mark>)
                </li>
              </ol>
              <h4 className="mb-2.5 mt-5 text-[13px] font-semibold text-[var(--graphite)]">{verified ? 'The fix Tell wrote and verified' : 'The fix, from the leak zoo'}</h4>
              <div className="diff">
                {verified ? (
                  verified.lines.map((l, i) => (
                    <div key={i} className={`l ${l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : 'ctx'}`}>
                      {l.startsWith('@@') ? '…' : l}
                    </div>
                  ))
                ) : (
                  <>
                    <div className="l add">+ witness ballotSalt(): Bytes&lt;32&gt;;</div>
                    <div className="l del">- ballots.insert(tag, disclose(choiceHash(c)));</div>
                    <div className="l add">+ ballots.insert(tag, disclose(persistentCommit&lt;Uint&lt;8&gt;&gt;(c, ballotSalt())));</div>
                  </>
                )}
              </div>
              <h4 className="mb-2.5 mt-5 text-[13px] font-semibold text-[var(--graphite)]">Scanned again</h4>
              <div className="flex flex-wrap gap-2">
                <span className="stamp">Compiles</span>
                <span className="stamp">Finding gone</span>
                <span className="stamp">Grade F to {verified?.gradeAfter ?? 'B'}</span>
              </div>
              <Link href="/scan?sample=ballot-leaky" className="btn btn-ink btn-sm mt-6">
                Open the full report
              </Link>
            </div>
          </div>
        </MarginSection>
      )}

      <section className="bg-[var(--mist)] py-16 sm:py-[88px]">
        <div className="wrap">
          <div className="marg mb-10">
            <p className="margin-note">
              <b>How it works</b>Static analysis of what the compiler builds. No model, no sampling.
            </p>
            <h2 className="max-w-[24ch] text-[26px] leading-[1.2] sm:text-[32px]">It reads your contract the way the compiler does.</h2>
          </div>
          <ol className="grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([t, d], i) => (
              <li key={t}>
                <span className="font-[family-name:var(--serif)] text-[40px] leading-none text-[var(--violet)]">{i + 1}</span>
                <h3 className="mb-1.5 mt-3.5 text-[17px] font-semibold">{t}</h3>
                <p className="text-[15px] text-[var(--graphite)]">
                  <Ticks text={d} />
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-[15px]">
            <Link href="/how">How Tell works, and what it cannot see</Link>
          </p>
        </div>
      </section>

      <MarginSection id="integrations" note="Integrations" noteText="One engine, wherever the contract is being written." title="Run it where you work.">
        <div className="border-t-2 border-[var(--indigo)]">
          {items.map((it) => (
            <div key={it.id} className="grid gap-4 border-b border-[var(--rule)] py-5 md:grid-cols-[200px_1fr_1.1fr] md:gap-8">
              <h3 className="font-[family-name:var(--serif)] text-[20px] font-semibold">
                {it.href ? <Link href={it.href} className="no-underline hover:underline">{it.name}</Link> : it.name}
                {it.tag && <small className="mt-0.5 block font-[family-name:var(--sans)] text-[12.5px] font-medium text-[var(--marker)]">{it.tag}</small>}
              </h3>
              <p className="text-[15px] text-[var(--graphite)]">{it.what}</p>
              {it.shipped && it.snippet ? (
                <pre className="mono whitespace-pre-wrap break-words rounded-md bg-[var(--mist)] px-3.5 py-3 text-[12.5px] leading-[1.7]">{it.snippet}</pre>
              ) : (
                <p>
                  <StatusPill status="in progress" label="coming in Wave 3" />
                </p>
              )}
            </div>
          ))}
        </div>
      </MarginSection>

      <section id="evidence" className="on-violet py-16 sm:py-[88px]">
        <div className="wrap">
          <div className="marg mb-10">
            <p className="margin-note">
              <b>Evidence</b>All of it reproducible from the open repository.
            </p>
            <div>
              <h2 className="max-w-[24ch] text-[26px] leading-[1.2] text-white sm:text-[32px]">Proved on Midnight Preprod, not just in a test.</h2>
              <p className="mt-3.5 max-w-[62ch] text-[17px] text-[#e1dbff]">
                Two ballots, the same {leaky.rows.length} votes, one line apart. The site reads both from the indexer and runs the attack Tell predicted.
              </p>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <EvidenceBox title="Leaky ballot" address={leaky.address} result={`${leaky.rows.length} of ${leaky.rows.length} votes recovered`} tone="leak" note="Hash the four candidates, match the ledger.">
              {leaky.rows.map((r) => (
                <Bar key={r.voteTx} see={r.choice} width="100%" height={30} />
              ))}
            </EvidenceBox>
            <EvidenceBox title="Fixed ballot" address={fixed.address} result={`0 of ${fixed.votes} recovered`} tone="sealed" note="Each vote is a commitment with a salt only the voter holds.">
              {Array.from({ length: fixed.votes }, (_, i) => (
                <Bar key={i} width="100%" height={30} />
              ))}
            </EvidenceBox>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div className="rounded-lg bg-white p-5 text-[var(--ink)] sm:p-6">
              <h3 className="font-[family-name:var(--serif)] text-[19px] font-semibold">Every buildathon app, scanned</h3>
              <p className="mt-1 text-[14px] text-[var(--graphite)]">
                {survey.repositoriesListed} public repositories, {survey.contractsAnalyzed} contracts compiled, {survey.projectsAnalyzed} projects analysed circuit by circuit. {serious} with a finding at
                medium or worse, each read by hand.
              </p>
              <div className="mb-2.5 mt-4 flex h-[34px] gap-0.5 overflow-hidden rounded" role="img" aria-label={`Grades across ${total} projects: ${Object.entries(survey.grades).map(([g, n]) => `${g} ${n}`).join(', ')}`}>
                {Object.entries(survey.grades)
                  .filter(([, n]) => n > 0)
                  .map(([g, n]) => (
                    <span key={g} style={{ flex: n, minWidth: 5, background: GRADE_FILL[g] }} />
                  ))}
              </div>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--graphite)]">
                {Object.entries(survey.grades)
                  .filter(([, n]) => n > 0)
                  .map(([g, n]) => (
                    <span key={g}>
                      <i className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[2px]" style={{ background: GRADE_FILL[g] }} />
                      {g} {n}
                    </span>
                  ))}
              </p>
              <Link href="/survey" className="mt-4 inline-block text-[14px]">
                Read the survey
              </Link>
            </div>
            <div className="rounded-lg bg-white p-5 text-[var(--ink)] sm:p-6">
              <h3 className="font-[family-name:var(--serif)] text-[19px] font-semibold">The leak zoo</h3>
              <p className="mt-1 text-[14px] text-[var(--graphite)]">
                {numberWord(zooCounts.pairs, true)} leaks, {numberWord(zooCounts.pairs)} fixes ({zooCounts.contracts} contracts), 18 attack tests in CI.
</p>
              <ul className="mt-3">
                {[
                  ['ballot', 'hash(vote)'],
                  ['payband', 'hash(id, salary)'],
                  ['reserve', 'branch on a bid'],
                  ['board', 'same tag per post'],
                  ['vault', 'key cast to public'],
                  ['raffle', 'hash in the constructor'],
                  ['faucet', 'shielded mint, public nonce'],
                  ['deposit', 'bid paid in the clear'],
                  ['poll', 'hash in a Ledger 9 event'],
                ].map(([id, what]) => (
                  <li key={id} className="grid grid-cols-[84px_1fr_auto] gap-3 border-b border-dashed border-[var(--rule)] py-2 text-[14px] last:border-b-0">
                    <Link href={`/zoo#${id}`} className="font-semibold no-underline hover:underline">
                      {id}
                    </Link>
                    <code className="text-[var(--graphite)]">{what}</code>
                    <span className="text-[12.5px] font-semibold text-[var(--sealed)]">attacked, fixed</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="desk" className="on-indigo py-16 sm:py-[88px]">
        <div className="wrap">
          <div className="marg mb-10">
            <p className="margin-note">
              <b>Tell Desk</b>Coordinated disclosure for privacy leaks, on Midnight.
            </p>
            <div>
              <h2 className="max-w-[24ch] text-[26px] leading-[1.2] text-white sm:text-[32px]">Tell the team before you tell the world.</h2>
              <p className="mt-3.5 max-w-[62ch] text-[17px] text-[var(--on-indigo)]">
                A public report of a privacy leak exposes the users first. Tell Desk seals the finding on Midnight, lets the team answer and fix it without
                announcing an open bug, and records the contract’s grade for wallets to read.
              </p>
              <p className="mt-3">
                <StatusPill status={deskAddr ? 'live' : 'in progress'} label={deskAddr ? 'live on Preprod' : 'deploying to Preprod'} />
              </p>
            </div>
          </div>
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
            <div className="relative rounded-lg bg-white p-6 text-[var(--ink)]">
              <span className="text-[13px] text-[var(--faint)]">To the maintainers of a contract</span>
              <h3 className="mb-3.5 mt-1.5 font-[family-name:var(--serif)] text-[21px] font-semibold">Sealed finding</h3>
              <div className="grid gap-2.5">
                {['92%', '78%', '85%', '40%'].map((w) => (
                  <Bar key={w} width={w} height={12} />
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-[13px] text-[var(--graphite)]">
                <span>On chain: a commitment, a time, a status</span>
                <span>Embargo: 90 days</span>
              </div>
              <span className="absolute -bottom-5 right-5 grid h-16 w-16 place-items-center rounded-full bg-[var(--marker)] font-[family-name:var(--serif)] text-[26px] font-semibold text-white shadow-[0_8px_20px_-6px_rgba(255,62,165,.6)]">
                T
              </span>
            </div>
            <div>
              <ol className="border-t border-[var(--indigo-3)]">
                {desk.flow.slice(0, 3).map((s, i) => (
                  <li key={s.step} className="grid grid-cols-[40px_1fr] gap-3 border-b border-[var(--indigo-3)] py-4">
                    <span className="font-[family-name:var(--serif)] text-[22px] text-[var(--marker)]">{i + 1}</span>
                    <div>
                      <b className="block font-semibold">{s.step}</b>
                      <p className="text-[14.5px] text-[var(--on-indigo)]">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <Link href="/desk" className="btn btn-line mt-6 border-[#5c53a8] text-white">
                How Tell Desk works
              </Link>
            </div>
          </div>
        </div>
      </section>

      <MarginSection id="pricing" note="Who pays" noteText="The engine, CLI, Action and every rule are Apache-2.0." title="Free for open source. Paid for private code and audit work.">
        <div className="grid border-t-2 border-[var(--indigo)] sm:grid-cols-2 lg:grid-cols-4">
          {business.offers.slice(0, 4).map((o, i) => (
            <div key={o.id} className={`flex flex-col border-[var(--rule)] pb-6 pt-6 sm:pr-5 ${i > 0 ? 'max-sm:border-t lg:border-l lg:pl-5' : ''} ${i % 2 === 1 ? 'sm:border-l sm:pl-5' : ''} ${i >= 2 ? 'sm:max-lg:border-t' : ''}`}>
              <h3 className="font-[family-name:var(--serif)] text-[21px] font-semibold">{o.name}</h3>
              <p className="mt-1">
                <StatusPill status={o.status} />
              </p>
              <p className="mt-4 font-[family-name:var(--serif)] text-[26px]">{o.price ?? <span className="text-[18px] text-[var(--faint)]">Not priced yet</span>}</p>
              {o.priceNote && <p className="text-[13px] text-[var(--faint)]">{o.priceNote}</p>}
              <ul className="mb-5 mt-4 grid gap-2 text-[14.5px] text-[var(--graphite)]">
                {o.includes.map((x) => (
                  <li key={x} className="relative pl-[18px]">
                    <span className="absolute left-0 top-[0.6em] h-[7px] w-[10px] rounded-[1px]" style={{ background: o.status === 'live' ? 'var(--indigo)' : 'var(--marker)' }} />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Link href="/teams" className="btn btn-quiet mt-4">
          Who Tell is for
        </Link>
      </MarginSection>

      <section className="bg-[var(--mist)] py-16 sm:py-20">
        <div className="wrap grid items-center gap-6 lg:grid-cols-[var(--margin-col)_1fr_auto] lg:gap-12">
          <p className="margin-note">
            <b>Before you deploy</b>A contract’s history is public forever.
          </p>
          <h2 className="text-[26px] sm:text-[30px]">Find the tell before someone else does.</h2>
          <Link href="/scan" className="btn btn-pri justify-self-start">
            Scan a contract
          </Link>
        </div>
      </section>
    </div>
  );
}

function EvidenceBox({ title, address, result, tone, note, children }: { title: string; address: string; result: string; tone: 'leak' | 'sealed'; note: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white p-5 text-[var(--ink)] sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <b className="font-[family-name:var(--serif)] text-[19px] font-semibold">{title}</b>
        <a href={`https://preprod.midnightexplorer.com/contracts/${address}`} className="mono text-[12px] text-[var(--faint)] no-underline hover:underline">
          {short(address, 8, 8)}
        </a>
      </div>
      <div className="my-4 grid grid-cols-6 gap-1.5 sm:gap-2">{children}</div>
      <p className={`font-[family-name:var(--serif)] text-[22px] font-medium ${tone === 'leak' ? 'text-[var(--marker)]' : 'text-[var(--sealed)]'}`}>{result}</p>
      <p className="mt-1 text-[14px] text-[var(--graphite)]">
        {note} <Link href="/live">See it live</Link>
      </p>
    </div>
  );
}
