import type { Metadata } from 'next';
import Link from 'next/link';
import { adoption, fmtDate, surveyRerun, type OutreachRow, type SurveySnapshot } from '@/lib/content';
import { CtaRow, Page, PageHead, Section, Slot, Stat, StatusPill } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Adoption',
  description: 'Who uses Tell, read from GitHub’s public API: stars, repositories running the Action, outreach to Midnight teams and what got fixed.',
};

const STATE_TEXT: Record<OutreachRow['state'], string> = {
  pending: 'not sent yet',
  sent: 'note sent',
  open: 'open',
  closed: 'closed',
  merged: 'merged',
  unknown: 'could not read',
};

const KIND_TEXT: Record<OutreachRow['kind'], string> = { issue: 'GitHub issue', pr: 'pull request', note: 'private note' };

export default function AdoptionPage() {
  const a = adoption;
  const teams = a.outreach.filter((o) => !o.official);
  const official = a.outreach.filter((o) => o.official);
  const fetched = a.fetchedAt ? `${fmtDate(a.fetchedAt)}, ${new Date(a.fetchedAt).toISOString().slice(11, 16)} UTC` : 'not yet';

  return (
    <Page>
      <PageHead kicker={`Read from GitHub on ${fetched}`} title="Who uses Tell">
        <p>
          The numbers below are as small as they are. A script reads them from GitHub’s public API and the page shows them with the date. Teams we wrote to
          are never named here: they appear as Project A, Project B, with their sector. Midnight’s own example repositories are named and linked.
        </p>
      </PageHead>

      <dl className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4" data-testid="adoption-figures">
        <Stat n={a.repo.stars ?? '–'} label="stars on RohanGlitched/tell" />
        <Stat n={a.repo.forks ?? '–'} label="forks" />
        <Stat
          n={a.action.counted ? (a.action.otherRepositories ?? 0) : '–'}
          label="repositories outside ours running the Tell Action"
          note={a.action.counted ? undefined : 'Counted only when the script runs with a GitHub token (code search needs one).'}
        />
        <Stat n={`${a.totals.fixed} / ${a.totals.contacted}`} label="leaks fixed, of the teams and repositories contacted" />
      </dl>

      <Section
        id="outreach"
        title="Outreach to teams"
        intro="Teams whose contracts had a finding in the survey that we confirmed by hand get a private note: the line, what it gives away, and the fix. Here is where each note stands."
      >
        <OutreachTable rows={teams} />
        <p className="mt-3 text-[14px] text-[var(--graphite)]">
          {a.totals.contacted} contacted · {a.totals.replied} replied · {a.totals.fixed} fixed · {a.totals.open} still open. Replies count comments from anyone other than us.
        </p>
      </Section>

      <Section id="examples" title="Midnight’s own examples" intro="Findings in the official example repositories, filed as public issues.">
        <OutreachTable rows={official} />
      </Section>

      <Section
        id="rerun"
        title="The survey, before and after"
        intro={
          <>
            The <Link href="/survey">buildathon survey</Link> run again over the same repositories, to see whether anything changed after the notes went out.
          </>
        }
      >
        <div className="mb-4">
          <StatusPill status={surveyRerun.status} />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Snapshot title="Before" s={surveyRerun.before} />
          {surveyRerun.after ? (
            <Snapshot title="After" s={surveyRerun.after} />
          ) : (
            <Slot title="After: re-run pending" testId="rerun-slot">
              {surveyRerun.note}
            </Slot>
          )}
        </div>
      </Section>

      <Section id="repository" title="The repository">
        <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Stat n={a.repo.watchers ?? '–'} label="watching" />
          <Stat n={a.repo.openIssues ?? '–'} label="open issues and pull requests" />
          <Stat n={a.traffic?.uniqueVisitors14d ?? '–'} label="unique visitors, last 14 days" note={a.traffic ? undefined : 'Traffic needs a token with push access.'} />
          <Stat n={a.traffic?.uniqueCloners14d ?? '–'} label="unique cloners, last 14 days" note={a.traffic ? undefined : 'Traffic needs a token with push access.'} />
        </dl>
      </Section>

      <Section id="method" title="How these numbers are made">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3 text-[15.5px]">
            <p>
              <code>web/scripts/adoption.mjs</code> calls GitHub’s REST API and writes <code>web/data/adoption.json</code>, which this page renders. Run it
              yourself:
            </p>
            <pre className="mono overflow-x-auto rounded-sm bg-[var(--uv)] p-3 text-[12.5px] leading-[1.7] text-[#e9e6ff]">{`node web/scripts/adoption.mjs
# with a token, also counts repositories using the Action:
GITHUB_TOKEN=… node web/scripts/adoption.mjs`}</pre>
            <p className="text-[var(--graphite)]">{a.action.reason}</p>
            <p className="text-[var(--graphite)]">
              Team issue URLs live in a file kept out of the public repository; the output holds only labels, states and counts.
            </p>
          </div>
          <div>
            <h3 className="text-[17px] font-bold">Last run</h3>
            <ul className="mt-2 space-y-1 text-[14.5px] text-[var(--graphite)]">
              <li>Fetched: {fetched}</li>
              <li>Authenticated: {a.authenticated ? 'yes' : 'no'}</li>
              <li>Problems: {a.errors.length ? a.errors.join('; ') : 'none'}</li>
            </ul>
          </div>
        </div>
        <CtaRow
          links={[
            { href: '/wave3', label: 'What changed in Wave 3', primary: true },
            { href: '/teams', label: 'Who Tell is for' },
            { href: '/survey', label: 'The survey' },
          ]}
        />
      </Section>
    </Page>
  );
}

function OutreachTable({ rows }: { rows: OutreachRow[] }) {
  if (rows.length === 0) return <p className="text-[15px] text-[var(--graphite)]">Nothing recorded yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[14.5px]" data-testid="outreach-table">
        <thead>
          <tr className="border-b-2 border-[var(--ink)] text-left">
            <th className="py-2 pr-3 font-semibold">Who</th>
            <th className="py-2 pr-3 font-semibold">About</th>
            <th className="py-2 pr-3 font-semibold">How</th>
            <th className="py-2 pr-3 font-semibold">Since</th>
            <th className="py-2 pr-3 font-semibold">State</th>
            <th className="py-2 pr-3 text-right font-semibold">Replies</th>
            <th className="py-2 font-semibold">Fixed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-b border-[var(--rule)] align-top">
              <td className="py-2.5 pr-3 font-medium">
                {/* only midnightntwrk repositories carry a URL in adoption.json */}
                {o.official && o.url ? <a href={o.url}>{o.label}</a> : o.label}
              </td>
              <td className="py-2.5 pr-3 text-[var(--graphite)]">{o.topic ?? '–'}</td>
              <td className="py-2.5 pr-3 text-[var(--graphite)]">{KIND_TEXT[o.kind]}</td>
              <td className="num py-2.5 pr-3 text-[var(--graphite)]">{o.openedAt ? fmtDate(o.openedAt) : '–'}</td>
              <td className="py-2.5 pr-3">{STATE_TEXT[o.state]}</td>
              <td className="num py-2.5 pr-3 text-right">{o.replies ?? '–'}</td>
              <td className="py-2.5">{o.fixed ? (o.official && o.fixUrl ? <a href={o.fixUrl}>yes</a> : 'yes') : 'not yet'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Snapshot({ title, s }: { title: string; s: SurveySnapshot }) {
  const total = Object.values(s.grades).reduce((x, y) => x + y, 0);
  return (
    <div className="sheet rounded-sm p-5">
      <p className="label">
        {title} · {fmtDate(s.date)}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-4">
        <div>
          <dt className="text-[13px] text-[var(--graphite)]">projects</dt>
          <dd className="display num text-[30px] font-extrabold">{s.projectsAnalyzed}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-[var(--graphite)]">contracts</dt>
          <dd className="display num text-[30px] font-extrabold">{s.contractsAnalyzed}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-[var(--graphite)]">medium or worse</dt>
          <dd className="display num text-[30px] font-extrabold">{s.mediumOrWorse}</dd>
        </div>
      </dl>
      <p className="mono mt-3 text-[13px] text-[var(--graphite)]">
        {(['A', 'B', 'C', 'D', 'F'] as const).map((g) => `${g} ${s.grades[g]}`).join(' · ')} ({total} graded)
      </p>
    </div>
  );
}
