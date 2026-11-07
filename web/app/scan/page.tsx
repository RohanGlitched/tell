import type { Metadata } from 'next';
import Scanner from '@/components/Scanner';
import samples from '@/data/samples.json';

export const metadata: Metadata = {
  title: 'Scan a contract',
  description: 'Paste a Compact contract or a GitHub repository. Tell compiles it with the matching Compact compiler and writes a privacy report: grade, numbered findings, transcript and fix.',
};

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  const { sample } = await searchParams;
  return (
    <div className="min-h-[70vh] bg-[var(--desk)] pb-16">
      <div className="mx-auto max-w-[1400px] px-3 pt-6 sm:px-6 sm:pt-8">
        <div className="no-print mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 xl:pl-[228px] lg:pr-[288px]">
          <h1 className="text-[26px] sm:text-[30px]">Scan a contract</h1>
          <p className="text-[13.5px] text-[var(--graphite)]">The real Compact compiler, then every private input traced to the public ledger.</p>
        </div>
        <Scanner samples={samples} sample={sample} />
      </div>
    </div>
  );
}
