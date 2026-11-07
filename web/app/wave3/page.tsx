import type { Metadata } from 'next';
import Link from 'next/link';
import { adoption, fmtDate, wave3, type CriterionId, type FeedbackRow } from '@/lib/content';
import { CtaRow, Evidence, Page, PageHead, Section, Stat, StatusPill } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Wave 3: you said, we did',
  description: 'Every point from the Midnight Buildathon Wave 2 review of Tell, in the reviewer’s words, with what we did about it and where to check.',
};

const CRITERION_SHORT: Record<CriterionId, string> = {
  engineering: 'Engineering',
  qa: 'QA',
  product: 'Product',
  ux: 'UX',
  communication: 'Communication',
  business: 'Business',
};

export default function Wave3Page() {
  const w = wave3;
  const done = w.feedback.filter((f) => f.status === 'done').length;
  const order: CriterionId[] = ['engineering', 'product', 'business', 'ux', 'qa', 'communication'];
  const grouped = order.map((c) => [c, w.feedback.filter((f) => f.criterion === c)] as const).filter(([, rows]) => rows.length > 0);

  return (
    <Page>
      <PageHead
        kicker={`Midnight Buildathon · Wave 3 · updated ${fmtDate(w.updatedAt)}`}
        title="You said. We did."
        aside={
          // Wave 2 scores at a glance, as a document; each links to its criterion below.
          <figure className="overflow-hidden rounded-lg bg-white text-[var(--ink)] shadow-[0_30px_60px_-30px_rgba(0,0,0,.6)]">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--rule)] px-5 pb-3.5 pt-4">
              <b className="font-[family-name:var(--serif)] text-[18px] font-semibold">Wave 2 review, scores out of 10</b>
              <span className="mono text-[12px] text-[var(--faint)]">{fmtDate(w.wave2.reviewedOn)}</span>
            </div>
            <dl className="px-5 py-1.5" data-testid="wave2-scores">
              {w.criteria.map((c) => (
                <div key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-dashed border-[var(--rule)] py-2 last:border-b-0 sm:grid-cols-[1fr_120px_auto]">
                  <dt className="text-[14px]">
                    <a href={`#criterion-${c.id}`} className="no-underline hover:underline">
                      {c.name}
                    </a>{' '}
                    <span className="text-[12.5px] text-[var(--faint)]">{c.weight}%</span>
                  </dt>
                  <span className="hidden h-2 overflow-hidden rounded-[2px] bg-[var(--mist)] sm:block" aria-hidden="true">
                    <span className="block h-full rounded-[2px] bg-[var(--indigo)]" style={{ width: `${c.wave2 * 10}%` }} />
                  </span>
                  <dd className="num font-[family-name:var(--serif)] text-[20px] font-medium">{c.wave2}</dd>
                </div>
              ))}
            </dl>
            <div className="border-t border-[#f9c4df] bg-[var(--marker-soft)] px-5 py-3.5 text-[14px] text-[#6a1240]">
              <b className="text-[var(--marker)]">
                {w.feedback.length} points raised: {done} done, {w.feedback.filter((f) => f.status === 'in progress').length} in progress.
              </b>{' '}
              Each one is answered below.
            </div>
          </figure>
        }
      >
        <p>{w.summary}</p>
        <p>
          Wave 2: {w.wave2.points} points, tied for the top, {w.wave2.prize}. Reviewed by {w.wave2.reviewer} on {fmtDate(w.wave2.reviewedOn)}.
        </p>
      </PageHead>

      <Section
        id="feedback"
        note="The review"
        noteText="Quoted as written. Statuses change as work ships."
        title="The feedback, point by point"
        intro="Each row starts with the review's own words, then says what we did about it and links to the evidence."
      >
        <div className="space-y-12">
          {grouped.map(([c, rows]) => (
            <div key={c}>
              <h3 className="label">{CRITERION_SHORT[c]}</h3>
              <ol className="mt-3 border-t border-[var(--rule)]">
                {rows.map((f) => (
                  <FeedbackItem key={f.id} f={f} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="criteria"
        tone="mist"
        note="The rubric"
        noteText="Six criteria, weighted as the Wave 3 rubric weights them."
        title="What changed, criterion by criterion"
        intro="The six rubric criteria with their Wave 3 weights, the Wave 2 score, and the work aimed at each."
      >
        <div className="grid gap-5 md:grid-cols-2">
          {w.criteria.map((c) => (
            <article key={c.id} id={`criterion-${c.id}`} className="scroll-mt-20 rounded-lg border border-[var(--rule)] bg-white p-5 sm:p-6" data-testid={`criterion-${c.id}`}>
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-[family-name:var(--serif)] text-[21px] font-medium">{c.name}</h3>
                <span className="mono text-[13px] text-[var(--graphite)]">
                  weight {c.weight}% · Wave 2: {c.wave2}/10
                </span>
              </header>
              <p className="mt-1 text-[14px] text-[var(--graphite)]">Judged on: {c.judged}</p>
              <ul className="mt-4 space-y-2.5">
                {c.changes.map((ch) => (
                  <li key={ch.text} className="grid grid-cols-[auto_1fr] items-start gap-3 text-[15px]">
                    <StatusPill status={ch.status} />
                    <span>{ch.href ? <ChangeLink href={ch.href}>{ch.text}</ChangeLink> : ch.text}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <Section
        id="substitutes"
        note="The alternatives"
        noteText="Named in the business review."
        title="The substitutes, one by one"
        intro="The review named the alternatives a Midnight team has today. Here is each one, what it does, and how Tell sits beside it."
      >
        <ol className="border-t-2 border-[var(--indigo)]">
          {w.substitutes.map((s) => (
            <li key={s.name} className="grid gap-3 border-b border-[var(--rule)] py-5 md:grid-cols-[1fr_1fr_1.4fr]">
              <div>
                <h3 className="font-[family-name:var(--serif)] text-[20px] font-medium">{s.name}</h3>
                <div className="mt-2">
                  <StatusPill status={s.status} />
                </div>
              </div>
              <p className="text-[15px] text-[var(--graphite)]">
                <span className="label block">What it does</span>
                {s.what}
              </p>
              <p className="text-[15px]">
                <span className="label block">Tell beside it</span>
                {s.answer} {s.href && <ChangeLink href={s.href}>More</ChangeLink>}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="market" tone="violet" note="Commercial" noteText="Read from GitHub by a script, with the date." title="A live product, with the numbers as they are" intro="The Wave 2 recap asked for live products, users and revenue, even if the numbers are small. These are ours, read from GitHub by a script.">
        <dl className="grid gap-5 rounded-lg bg-white p-5 text-[var(--ink)] sm:grid-cols-4 sm:p-6">
          <Stat n={adoption.repo.stars ?? '–'} label="GitHub stars" />
          <Stat n={adoption.action.counted ? (adoption.action.otherRepositories ?? 0) : '–'} label={adoption.action.counted ? 'other repositories using the Action' : 'repositories using the Action: counted with a token'} />
          <Stat n={adoption.totals.contacted} label="teams and example repositories contacted" />
          <Stat n={adoption.totals.fixed} label="leaks fixed after a note" />
        </dl>
        <p className="mt-4 text-[14px] text-[#e1dbff] [&_a]:text-white">
          Fetched {fmtDate(adoption.fetchedAt)}. <Link href="/adoption">The adoption page</Link> has the method and every row; <Link href="/teams">who pays</Link> has the offers.
        </p>
      </Section>

      <Section id="learned" note="Bringing it to market" noteText="What the Wave 2 recap asked teams to share." title="What we learned, and what would help">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h3 className="label">Learned</h3>
            <ul className="mt-3 space-y-5">
              {w.learned.map((l) => (
                <li key={l.title}>
                  <h4 className="font-[family-name:var(--serif)] text-[19px] font-medium">{l.title}</h4>
                  <p className="mt-1 text-[15px] text-[var(--graphite)]">{l.text}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="label">How the Midnight ecosystem could help</h3>
            <ul className="mt-3 space-y-5">
              {w.ask.map((l) => (
                <li key={l.title}>
                  <h4 className="font-[family-name:var(--serif)] text-[19px] font-medium">{l.title}</h4>
                  <p className="mt-1 text-[15px] text-[var(--graphite)]">{l.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section id="next" tone="mist" note="Verify" noteText="Every claim on this page links to something you can open." title="Check it yourself">
        <p className="max-w-[66ch] text-[16px] text-[var(--graphite)]">
          Everything on this page links to something you can open: a contract on Preprod, a page that reads it, a script that counts. Start anywhere.
        </p>
        <CtaRow
          links={[
            { href: '/scan', label: 'Scan a contract', primary: true },
            { href: '/live', label: 'Live on Preprod' },
            { href: '/desk', label: 'Tell Desk' },
            { href: '/adoption', label: 'Adoption' },
            { href: '/teams', label: 'Who pays' },
          ]}
        />
      </Section>
    </Page>
  );
}

function FeedbackItem({ f }: { f: FeedbackRow }) {
  return (
    <li className="grid gap-4 border-b border-[var(--rule)] py-6 lg:grid-cols-[1.1fr_1.3fr_0.8fr]" data-testid="feedback-row" id={`fb-${f.id}`}>
      <figure>
        <blockquote className="font-[family-name:var(--serif)] text-[19px] leading-snug">“{f.quote}”</blockquote>
        <figcaption className="mt-2 text-[13px] text-[var(--graphite)]">{f.source}</figcaption>
      </figure>
      <div>
        <div className="flex items-center gap-2">
          <span className="label">What we did</span>
          <StatusPill status={f.status} />
        </div>
        <p className="mt-1.5 text-[15px]">{f.did}</p>
      </div>
      <div>
        <span className="label">Evidence</span>
        <div className="mt-1.5">
          <Evidence links={f.evidence} />
        </div>
      </div>
    </li>
  );
}

function ChangeLink({ href, children }: { href: string; children: React.ReactNode }) {
  return href.startsWith('/') ? <Link href={href}>{children}</Link> : <a href={href}>{children}</a>;
}
