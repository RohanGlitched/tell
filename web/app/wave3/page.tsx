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
      <PageHead kicker={`Midnight Buildathon · Wave 3 · updated ${fmtDate(w.updatedAt)}`} title="You said. We did.">
        <p>{w.summary}</p>
        <p>
          Wave 2: {w.wave2.points} points, tied for the top, {w.wave2.prize}. Reviewed by {w.wave2.reviewer} on {fmtDate(w.wave2.reviewedOn)}.{' '}
          <span className="text-[var(--ink)]">
            {w.feedback.length} points raised: {done} done, {w.feedback.filter((f) => f.status === 'in progress').length} in progress.
          </span>
        </p>
      </PageHead>

      {/* Wave 2 scores at a glance; each links to its row in the criterion section. */}
      <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-3 lg:grid-cols-6" data-testid="wave2-scores">
        {w.criteria.map((c) => (
          <div key={c.id} className="bg-[var(--sheet)] p-4">
            <dt className="text-[13px] text-[var(--graphite)]">
              <a href={`#criterion-${c.id}`} className="no-underline hover:underline">
                {c.name}
              </a>
            </dt>
            <dd className="mt-1 flex items-baseline gap-2">
              <span className="display num text-[34px] font-extrabold leading-none">{c.wave2}</span>
              <span className="text-[13px] text-[var(--faint)]">/ 10 · weight {c.weight}%</span>
            </dd>
          </div>
        ))}
      </dl>

      <Section
        id="feedback"
        title="The feedback, point by point"
        intro="Each row starts with the review's own words, then says what we did about it and links to the evidence. Items marked 'in progress' are being built now; this page changes as they ship."
      >
        <div className="space-y-12">
          {grouped.map(([c, rows]) => (
            <div key={c}>
              <h3 className="label text-[13px] uppercase tracking-[0.06em]">{CRITERION_SHORT[c]}</h3>
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
        title="What changed, criterion by criterion"
        intro="The six rubric criteria with their Wave 3 weights, the Wave 2 score, and the work aimed at each."
      >
        <div className="grid gap-5 md:grid-cols-2">
          {w.criteria.map((c) => (
            <article key={c.id} id={`criterion-${c.id}`} className="sheet scroll-mt-20 rounded-sm p-5" data-testid={`criterion-${c.id}`}>
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[20px] font-bold">{c.name}</h3>
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
        title="The substitutes, one by one"
        intro="The review named the alternatives a Midnight team has today. Here is each one, what it does, and how Tell sits beside it."
      >
        <ol className="border-t-2 border-[var(--ink)]">
          {w.substitutes.map((s) => (
            <li key={s.name} className="grid gap-3 border-b border-[var(--rule)] py-5 md:grid-cols-[1fr_1fr_1.4fr]">
              <div>
                <h3 className="text-[18px] font-bold">{s.name}</h3>
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

      <Section id="market" title="A live product, with the numbers as they are" intro="The Wave 2 recap asked for live products, users and revenue, even if the numbers are small. These are ours, read from GitHub by a script.">
        <dl className="grid gap-6 sm:grid-cols-4">
          <Stat n={adoption.repo.stars ?? '–'} label="GitHub stars" />
          <Stat n={adoption.action.counted ? (adoption.action.otherRepositories ?? 0) : '–'} label={adoption.action.counted ? 'other repositories using the Action' : 'repositories using the Action: counted with a token'} />
          <Stat n={adoption.totals.contacted} label="teams and example repositories contacted" />
          <Stat n={adoption.totals.fixed} label="leaks fixed after a note" />
        </dl>
        <p className="mt-4 text-[14px] text-[var(--graphite)]">
          Fetched {fmtDate(adoption.fetchedAt)}. <Link href="/adoption">The adoption page</Link> has the method and every row; <Link href="/teams">who pays</Link> has the offers.
        </p>
      </Section>

      <Section id="learned" title="What we learned, and what would help">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h3 className="label text-[13px] uppercase tracking-[0.06em]">Learned</h3>
            <ul className="mt-3 space-y-5">
              {w.learned.map((l) => (
                <li key={l.title}>
                  <h4 className="text-[17px] font-bold">{l.title}</h4>
                  <p className="mt-1 text-[15px] text-[var(--graphite)]">{l.text}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="label text-[13px] uppercase tracking-[0.06em]">How the Midnight ecosystem could help</h3>
            <ul className="mt-3 space-y-5">
              {w.ask.map((l) => (
                <li key={l.title}>
                  <h4 className="text-[17px] font-bold">{l.title}</h4>
                  <p className="mt-1 text-[15px] text-[var(--graphite)]">{l.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section id="next" title="Check it yourself">
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
        <blockquote className="hand text-[19px] leading-snug">“{f.quote}”</blockquote>
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
