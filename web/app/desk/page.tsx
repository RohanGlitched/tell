import type { Metadata } from 'next';
import Link from 'next/link';
import { desk } from '@/lib/content';
import { NETWORKS, type NetworkName } from '@/lib/networks';
import { CtaRow, Page, PageHead, Section, Slot, StatusPill } from '@/components/ui';
import DualLedger from '@/components/DualLedger';
import { DeskRegistry, DeskWalletSlot } from '@/components/DeskBoard';

export const metadata: Metadata = {
  title: 'Tell Desk',
  description: 'A Midnight contract for sealed privacy reports and an on-chain grade registry: the grade is public, the report stays in your private state.',
};

export default function DeskPage() {
  const d = desk;
  const net = NETWORKS[(d.network as NetworkName) ?? 'preprod'];
  return (
    <Page>
      <PageHead kicker={`Tell Desk · a Midnight contract · ${net.label}`} title="The grade is public. The report is yours.">
        <p>
          A Tell report lists every place a contract leaks, so publishing it would help attackers before the fixes land. A grade on its own is easy to
          fake. Tell Desk does both jobs: the grade goes on Midnight’s public ledger, the report stays in your private state, and a commitment on chain
          proves which report the grade came from.
        </p>
      </PageHead>

      <div className="mt-6 flex flex-wrap items-center gap-3 text-[14px]">
        <StatusPill status={d.status} />
        {d.address ? (
          <a href={`${net.explorer}/contracts/${d.address}`} className="mono">
            {d.address.slice(0, 10)}…{d.address.slice(-8)}
          </a>
        ) : (
          <span className="text-[var(--graphite)]">Contract address appears here once it is deployed to {net.label}.</span>
        )}
        <a href={`https://github.com/RohanGlitched/tell/tree/main/${d.contractPath}`}>Contract source</a>
      </div>

      <Section
        id="ledgers"
        title="Two ledgers, one contract"
        intro="Every Midnight contract splits its data in two. This is how Tell Desk splits it: the public side holds only what a reader needs to trust a grade, and the private side holds everything the grade is based on."
      >
        <DualLedger
          pub={d.publicLedger}
          priv={d.privateState}
          caption={d.fieldsConfirmed ? `Fields as declared in ${d.contractPath}.` : 'The design, being checked against the contract as it is built; field names may change.'}
        />
      </Section>

      <Section id="flow" title="Seal, file, read" intro="What happens from a scan to a grade a wallet can show.">
        <ol className="grid gap-px overflow-hidden rounded-sm border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-5">
          {d.flow.map((f, i) => (
            <li key={f.step} className="bg-[var(--sheet)] p-5">
              <span className="mono text-[13px] text-[var(--graphite)]">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="mt-1 text-[18px] font-bold">{f.step}</h3>
              <p className="mt-1.5 text-[14.5px] text-[var(--graphite)]">{f.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="circuits" title="What each circuit discloses" intro="Tell scans its own contract the same way it scans yours. For each circuit, this is what reaches the public ledger.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[14.5px]">
            <thead>
              <tr className="border-b-2 border-[var(--ink)] text-left">
                <th className="py-2 pr-4 font-semibold">Circuit</th>
                <th className="py-2 pr-4 font-semibold">Does</th>
                <th className="py-2 font-semibold">Puts on the public ledger</th>
              </tr>
            </thead>
            <tbody>
              {d.circuits.map((c) => (
                <tr key={c.name} className="border-b border-[var(--rule)] align-top">
                  <td className="mono py-2.5 pr-4 font-medium">{c.name}</td>
                  <td className="py-2.5 pr-4">{c.does}</td>
                  <td className="py-2.5 text-[var(--graphite)]">{c.discloses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="try" title="File a grade" intro="Connect a Lace wallet on Preprod, seal a report from a scan you ran here, and file it.">
        <DeskWalletSlot />
      </Section>

      <Section id="registry" title="The registry, live" intro="Every grade filed so far, read from Midnight’s indexer, the same way the live ballot page reads its contracts.">
        <DeskRegistry />
      </Section>

      <Section id="why" title="Why a contract, not a database">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            ['Anyone can check it', 'A wallet reads the grade straight from the chain. It does not have to trust our server, or any server.'],
            ['The report stays sealed', 'Publishing findings before they are fixed tells attackers where to look. The commitment lets an auditor confirm the report later without anyone else seeing it.'],
            ['Grades can’t be swapped', 'Only the filer tag that filed a grade can replace it, and the scanner hash says which rules produced it.'],
          ].map(([t, x]) => (
            <div key={t} className="border-t border-[var(--rule)] pt-4">
              <h3 className="text-[17px] font-bold">{t}</h3>
              <p className="mt-1.5 text-[15px] text-[var(--graphite)]">{x}</p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <Slot title="Contract tests">Test counts for desk/ appear here once the contract’s tests are in CI.</Slot>
        </div>
        <CtaRow
          links={[
            { href: '/scan', label: 'Scan a contract first', primary: true },
            { href: '/live', label: 'The ballots on Preprod' },
            { href: '/teams', label: 'Who reads grades' },
          ]}
        />
        <p className="mt-6 text-[14px] text-[var(--graphite)]">
          The two demo ballots are on <Link href="/live">Preprod already</Link>; Tell Desk joins them there.
        </p>
      </Section>
    </Page>
  );
}
