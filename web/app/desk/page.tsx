import type { Metadata } from 'next';
import Link from 'next/link';
import { desk } from '@/lib/content';
import deployment from '@/data/desk-deployment.json';
import { NETWORKS, type NetworkName } from '@/lib/networks';
import { Bar } from '@/components/brand';
import { Closer, Page, PageHead, Section, StatusPill } from '@/components/ui';
import DualLedger from '@/components/DualLedger';
import DeskLive, { DeskCliSlot } from '@/components/DeskBoard';

export const metadata: Metadata = {
  title: 'Tell Desk',
  description: 'A Midnight contract for private, provable disclosure of privacy leaks, and a public registry of Tell’s privacy grades that wallets can read.',
};

export default function DeskPage() {
  const d = desk;
  const address = (deployment as { address?: string }).address ?? null;
  const net = NETWORKS[(d.network as NetworkName) ?? 'preprod'];
  return (
    <Page>
      <PageHead
        kicker={`Tell Desk · a Midnight contract · ${net.label}`}
        title="Tell the team before you tell the world."
        aside={
          <figure className="relative rounded-lg bg-white p-6 text-[var(--ink)] shadow-[0_30px_60px_-30px_rgba(0,0,0,.6)]" aria-label="A sealed report: its contents redacted, its seal on chain">
            <span className="text-[13px] text-[var(--faint)]">To the maintainers of a contract</span>
            <h2 className="mb-3.5 mt-1.5 font-[family-name:var(--serif)] text-[21px] font-semibold">Sealed finding</h2>
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
          </figure>
        }
      >
        <p>
          A public report of a privacy leak exposes the users first. Tell Desk seals a finding on Midnight so the researcher can prove they found it, the
          team can answer and fix it without announcing an open bug, and anyone can check the report once it is revealed. It also holds Tell’s privacy
          grades, keyed by code hash, for wallets to read.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 text-[14px]">
          <StatusPill status={address ? 'live' : 'in progress'} label={address ? `live on ${net.label}` : `deploying to ${net.label}`} />
          {address && (
            <a href={`${net.explorer}/contracts/${address}`} className="mono whitespace-nowrap">
              {address.slice(0, 10)}…{address.slice(-8)}
            </a>
          )}
          <a href={`https://github.com/RohanGlitched/tell/blob/main/${d.contractPath}`} className="whitespace-nowrap">
            Contract source
          </a>
          <a href="https://github.com/RohanGlitched/tell/tree/main/desk" className="whitespace-nowrap">
            README and tests
          </a>
        </div>
      </PageHead>

      <Section
        id="ledgers"
        note="Dual ledger"
        noteText="Midnight's public ledger, and private state on each person's device."
        title="What is public and what stays private"
        intro="Desk puts on the public ledger only what someone must be able to check without trusting anyone. Everything else enters only as a witness to a zero-knowledge proof."
      >
        <DualLedger pub={d.publicLedger} priv={d.privateState} caption={`From ${d.contractPath}. Before a reveal the ledger does not say which project a report is about.`} />
      </Section>

      <Section id="flow" tone="mist" note="The flow" noteText="Seal, acknowledge, fix, reveal; grades alongside." title="How a disclosure goes">
        <ol className="grid gap-px overflow-hidden rounded-lg border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-5">
          {d.flow.map((f, i) => (
            <li key={f.step} className="bg-white p-5">
              <span className="font-[family-name:var(--serif)] text-[30px] leading-none text-[var(--violet)]">{i + 1}</span>
              <h3 className="mt-2 text-[17px] font-semibold">{f.step}</h3>
              <p className="mt-1.5 text-[14.5px] text-[var(--graphite)]">{f.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="live"
        note="Indexer"
        noteText="Read the same way the live ballot page reads its contracts."
        title={`On ${net.label}, live`}
        intro="Every report Desk holds, every reveal and every grade, straight from the chain."
      >
        <DeskLive />
      </Section>

      <Section id="circuits" tone="mist" note="Every disclose()" noteText="Tell scans its own contract: grade A, no suppressions." title="What each circuit puts on the public ledger">
        <div className="overflow-x-auto rounded-lg border border-[var(--rule)] bg-white">
          <table className="w-full min-w-[620px] border-collapse text-[14.5px]">
            <thead>
              <tr className="border-b-2 border-[var(--indigo)] text-left">
                <th className="px-4 py-2 font-semibold">Circuit</th>
                <th className="px-4 py-2 font-semibold">Does</th>
                <th className="px-4 py-2 font-semibold">Discloses</th>
              </tr>
            </thead>
            <tbody>
              {d.circuits.map((c) => (
                <tr key={c.name} className="border-b border-[var(--rule)] align-top last:border-b-0">
                  <td className="mono px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5">{c.does}</td>
                  <td className="px-4 py-2.5 text-[var(--graphite)]">{c.discloses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="try" tone="indigo" note="Run it" noteText="Each party's secrets stay on their own machine." title="Use the Desk client">
        <DeskCliSlot />
      </Section>

      <Section id="why" note="Why on chain" noteText="Trust the ledger, not our server." title="Why a contract, not a database">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            ['Priority anyone can check', 'The seal time is a block time. Once revealed, the text hashes to the digest and the opening matches the seal: the finding existed, in this form, then.'],
            ['No announcement of an open bug', 'Before a reveal the chain does not say which project a report is about, and an acknowledgement shows neither the maintainer nor the project.'],
            ['Grades a wallet can read', 'The registry is keyed by code hash, which a wallet computes from any contract address. Tell’s attestations and maintainers’ self-reports are kept apart.'],
          ].map(([t, x]) => (
            <div key={t} className="border-t border-[var(--rule)] pt-4">
              <h3 className="font-[family-name:var(--serif)] text-[19px] font-medium">{t}</h3>
              <p className="mt-1.5 text-[15px] text-[var(--graphite)]">{x}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-[14.5px] text-[var(--graphite)]">
          Limits, from the README: maintainer credentials cannot be revoked yet, nothing limits spam seals yet, and transaction timing is public. The demo
          runs every role from one house wallet. <Link href="/live">The ballots on Preprod</Link> show the other half: what Tell finds before a contract ships.
        </p>
      </Section>
      <Closer />
    </Page>
  );
}
