import type { Metadata } from 'next';
import Scanner from '@/components/Scanner';
import samples from '@/data/samples.json';

export const metadata: Metadata = {
  title: 'Scan a contract',
  description: 'Paste a Compact contract or a GitHub repository. Tell compiles it with the matching Compact compiler and shows what each circuit reveals.',
};

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  const { sample } = await searchParams;
  const initial = samples.find((s) => s.id === sample)?.source;
  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-10 sm:px-6">
      <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.015em] sm:text-[42px]">Scan a contract</h1>
      <p className="mt-3 max-w-[64ch] text-[17px] text-[var(--graphite)]">
        Paste Compact source or a public repository. Tell compiles it with the real compiler your pragma asks for, traces every private input through every
        circuit, and marks what reaches the public ledger: in the clear, behind a guessable hash, through a branch, or as a tag that links a user’s calls.
      </p>
      <div className="mt-8">
        <Scanner samples={samples} initial={initial} />
      </div>
    </div>
  );
}
