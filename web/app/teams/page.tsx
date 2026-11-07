import type { Metadata } from 'next';
import Link from 'next/link';
import { business, fmtDate } from '@/lib/content';
import { CtaRow, Page, PageHead, Section, StatusPill } from '@/components/ui';
import InterestForm from '@/components/InterestForm';

export const metadata: Metadata = {
  title: 'For teams',
  description: 'Who Tell is for and who pays: free open-source core, a hosted pull-request bot for private repositories, an audit-firm license and ecosystem sponsorship.',
};

export default function TeamsPage() {
  const b = business;
  const segName = new Map(b.segments.map((s) => [s.id, s.name]));
  return (
    <Page>
      <PageHead kicker={`For teams · updated ${fmtDate(b.updatedAt)}`} title="Who Tell is for, and who pays">
        <p>
          The analyzer is free and stays free. Money comes from running it where the work is private or heavy: private repositories, audit firms, and the
          ecosystem work that keeps up with every compiler release. Every offer below is marked live, pilot or planned.
        </p>
      </PageHead>

      <Section id="segments" note="Audience" noteText="Not just the few dozen teams writing Compact." title="Five kinds of user" intro="It starts with the teams writing Compact, but they are not the only ones who need to know what a contract gives away.">
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {b.segments.map((s, i) => (
            <li key={s.id} className="flex flex-col rounded-lg border border-[var(--rule)] bg-white p-5" data-testid="segment">
              <div className="flex items-center justify-between gap-2">
                <span className="font-[family-name:var(--serif)] text-[34px] leading-none text-[var(--violet)]">{i + 1}</span>
                <StatusPill status={s.status} />
              </div>
              <h3 className="mt-3 font-[family-name:var(--serif)] text-[20px] font-medium">{s.name}</h3>
              <p className="mt-1 text-[14.5px] text-[var(--graphite)]">{s.who}</p>
              <dl className="mt-3 space-y-2 text-[14.5px]">
                <div>
                  <dt className="label">Needs</dt>
                  <dd>{s.need}</dd>
                </div>
                <div>
                  <dt className="label">Gets</dt>
                  <dd>{s.gets}</dd>
                </div>
                <div>
                  <dt className="label">Pays</dt>
                  <dd>{s.pays}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="offers" tone="mist" note="Offers" noteText="Prices come from data/business.json and stay empty until set." title="What is free, what is paid" intro="Prices appear here once they are set. Until then, an offer says what it includes and whether anyone can use it yet.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse bg-white text-[14.5px]" data-testid="offers-table">
            <thead>
              <tr className="border-b-2 border-[var(--indigo)] text-left align-bottom">
                <th className="py-2 pl-4 pr-4 font-semibold">Offer</th>
                <th className="py-2 pr-4 font-semibold">For</th>
                <th className="py-2 pr-4 font-semibold">Includes</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 font-semibold">Price</th>
              </tr>
            </thead>
            <tbody>
              {b.offers.map((o) => (
                <tr key={o.id} className="border-b border-[var(--rule)] align-top">
                  <td className="py-3 pl-4 pr-4">
                    <span className="font-[family-name:var(--serif)] text-[17px] font-medium">{o.name}</span>
                    <p className="mt-1 max-w-[42ch] text-[var(--graphite)]">{o.what}</p>
                  </td>
                  <td className="py-3 pr-4 text-[var(--graphite)]">{o.for.map((id) => segName.get(id) ?? id).join(', ')}</td>
                  <td className="py-3 pr-4">
                    <ul className="list-disc space-y-0.5 pl-4">
                      {o.includes.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusPill status={o.status} />
                  </td>
                  <td className="py-3">
                    {o.price ? <span className="font-[family-name:var(--serif)] text-[19px]">{o.price}</span> : <span className="text-[var(--faint)]">not priced yet</span>}
                    {o.priceNote && <p className="mt-1 text-[13px] text-[var(--graphite)]">{o.priceNote}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="principles" note="Principles" noteText="What stays free, and why." title="How we decide">
        <div className="grid gap-6 md:grid-cols-3">
          {b.principles.map((p) => (
            <div key={p.title} className="border-t border-[var(--rule)] pt-4">
              <h3 className="font-[family-name:var(--serif)] text-[19px] font-medium">{p.title}</h3>
              <p className="mt-1.5 text-[15px] text-[var(--graphite)]">{p.text}</p>
            </div>
          ))}
        </div>
        {b.numbers.some((n) => n.value) && (
          <dl className="mt-10 grid gap-6 sm:grid-cols-3">
            {b.numbers
              .filter((n) => n.value)
              .map((n) => (
                <div key={n.label} className="border-t-2 border-[var(--indigo)] pt-3">
                  <dt className="num font-[family-name:var(--serif)] text-[40px] font-medium leading-none">{n.value}</dt>
                  <dd className="mt-2 text-[14.5px] text-[var(--graphite)]">
                    {n.source ? n.source.startsWith('/') ? <Link href={n.source}>{n.label}</Link> : <a href={n.source}>{n.label}</a> : n.label}
                  </dd>
                </div>
              ))}
          </dl>
        )}
      </Section>

      <Section id="interest" tone="mist" note="Contact" noteText="A public GitHub issue you review before sending. Nothing stored here." title="Tell us what you need" intro="A pilot, a license, a template integration, or just a question. This opens a GitHub issue you can edit before sending.">
        <div className="max-w-[760px]">
          <InterestForm repo={b.contact.repo} label={b.contact.label} segments={b.segments.map(({ id, name }) => ({ id, name }))} offers={b.offers.map(({ id, name }) => ({ id, name }))} />
        </div>
        <CtaRow
          links={[
            { href: '/scan', label: 'Try the scanner', primary: true },
            { href: '/adoption', label: 'Adoption so far' },
            { href: '/wave3', label: 'What changed in Wave 3' },
          ]}
        />
      </Section>
    </Page>
  );
}
