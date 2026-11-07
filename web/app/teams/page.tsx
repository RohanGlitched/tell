import type { Metadata } from 'next';
import Link from 'next/link';
import { business, fmtDate } from '@/lib/content';
import { CtaRow, Page, PageHead, Section, StatusPill } from '@/components/ui';
import InterestForm from '@/components/InterestForm';
import CompareTable from '@/components/CompareTable';
import compare from '@/data/compare.json';

export const metadata: Metadata = {
  title: 'For teams',
  description: 'Who Tell is for and who pays: free open-source core, a hosted pull-request bot for private repositories, an audit-firm license and ecosystem sponsorship.',
};

// $15,000, or $15,000–30,000 for a range; rounded to the nearest thousand
const usd = (n: number) => `$${(Math.round(n / 1000) * 1000).toLocaleString('en-US')}`;
const range = (a: number, b: number) => (a === b ? `≈ ${usd(a)}` : `${usd(a)}–${usd(b).slice(1)}`);

export default function TeamsPage() {
  const b = business;
  const segName = new Map(b.segments.map((s) => [s.id, s.name]));
  const m = b.market;
  const low = m.lines.reduce((n, l) => n + l.low, 0);
  const high = m.lines.reduce((n, l) => n + l.high, 0);
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

      <Section id="offers" tone="mist" note="Offers" noteText="Planned prices are hypotheses to test in pilots. Nothing is sold yet." title="What is free, what is paid" intro="Each offer says what it includes, whether anyone can use it yet, and the price we will test. Public code never pays.">
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

      <Section
        id="market"
        note="Market"
        noteText={`Counts are sourced; prices are hypotheses. As of ${fmtDate(m.asOf)}.`}
        title="How big it can get, counted from the bottom"
        intro={m.intro}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse bg-white text-[14.5px]" data-testid="market-table">
            <thead>
              <tr className="border-b-2 border-[var(--indigo)] text-left align-bottom">
                <th className="py-2 pl-4 pr-4 font-semibold">Stream</th>
                <th className="py-2 pr-4 font-semibold">Count</th>
                <th className="py-2 pr-4 font-semibold">Price we will test</th>
                <th className="py-2 pr-4 text-right font-semibold">A year</th>
              </tr>
            </thead>
            <tbody>
              {m.lines.map((l) => (
                <tr key={l.label} className="border-b border-[var(--rule)] align-top">
                  <td className="py-3 pl-4 pr-4">
                    <span className="font-medium">{l.label}</span>
                    <p className="mt-1 max-w-[52ch] text-[13.5px] text-[var(--graphite)]">{l.basis}</p>
                    <p className="mt-1 text-[12.5px] text-[var(--faint)]">{l.status}</p>
                  </td>
                  <td className="num whitespace-nowrap py-3 pr-4">
                    {l.count} {l.unit}
                  </td>
                  <td className="py-3 pr-4 text-[var(--graphite)]">{l.price}</td>
                  <td className="num whitespace-nowrap py-3 pr-4 text-right">{range(l.low, l.high)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--indigo)] align-top">
                <td className="py-3 pl-4 pr-4 font-semibold" colSpan={3}>
                  Ceiling today, if every one of them paid
                </td>
                <td className="num whitespace-nowrap py-3 pr-4 text-right font-[family-name:var(--serif)] text-[19px] font-medium" data-testid="market-total">
                  {range(low, high)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <p className="border-t border-[var(--rule)] pt-4 text-[15px] text-[var(--graphite)]">{m.seats}</p>
          <p className="border-t border-[var(--rule)] pt-4 text-[15px]">{m.path}</p>
        </div>
      </Section>

      <Section
        id="compare"
        note="Benchmark"
        noteText={`Five tools, 69 Compact files, every number reproducible from bench/. Tell measured with the ${compare.engine}.`}
        title="How Tell compares"
        intro={`The other analyzers a Midnight team can run today, on the same files: ${compare.corpus.replace(/^69 Compact files: /, '')}.`}
      >
        <CompareTable />
      </Section>

      <Section id="principles" tone="mist" note="Principles" noteText="What stays free, and why." title="How we decide">
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

      <Section id="interest" note="Contact" noteText="A public GitHub issue you review before sending. Nothing stored here." title="Tell us what you need" intro="A pilot, a license, a template integration, or just a question. This opens a GitHub issue you can edit before sending.">
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
